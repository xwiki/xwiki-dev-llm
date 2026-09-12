#!/usr/bin/env node
/*
 * Collects the failing functional tests of one XWiki branch from ci.xwiki.org, joins them with the
 * open flickering issues on jira.xwiki.org, and (with --compare) says how each one fares on other
 * branches. Fetching and correlating only: the judgement calls belong to the SKILL.md that runs it.
 */

import {
  buildRevision, enc, getJSON, isPseudoTest, outcomes, releaseTrainJobs, testResults, testedBuilds
} from '../../../scripts/jenkins.mjs';

const JIRA = 'https://jira.xwiki.org';
// "Flickering tests" (filter 14240), the list the Release Plan links to.
const FLICKER_JQL = 'labels = flickering AND status in (Open, "In Progress", Reopened)';
// The JIRA field holding the fully-qualified test, e.g. a.b.AllIT$NestedFooIT#bar.
const FLICKER_FIELD = 'customfield_10870';

const USAGE = `Usage: node triage.mjs --branch <branch> [options]

  --branch <name>    Branch to triage, e.g. stable-17.10.x or master (required)
  --repos <a,b,c>    Repos to check (default: xwiki-commons,xwiki-rendering,xwiki-platform)
  --compare <a,b,c>  Also report how each failing test fares on these branches
  --max <n>          Cap the reported failures (default 40)
  --history <n>      Builds of history to rate each failure over (default 5, 0 to skip)
  --json             Emit JSON instead of the Markdown report

Run it from inside a clone of the repo to also get how far the branch has moved since the build.
`;

function parseArgs(argv) {
  const out = { repos: ['xwiki-commons', 'xwiki-rendering', 'xwiki-platform'], compare: [], max: 40, history: 5 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--branch') out.branch = argv[++i];
    else if (key === '--repos') out.repos = argv[++i].split(',').filter(Boolean);
    else if (key === '--compare') out.compare = argv[++i].split(',').filter(Boolean);
    else if (key === '--max') out.max = Number(argv[++i]);
    else if (key === '--history') out.history = Number(argv[++i]);
    else if (key === '--json') out.json = true;
    else { console.error(`Unknown argument [${key}]\n\n${USAGE}`); process.exit(2); }
  }
  if (!out.branch) { console.error(USAGE); process.exit(2); }
  return out;
}

/** The commit the build ran, and how far the branch has moved since (when run inside the clone). */
async function revision(buildUrl, repo, branch) {
  const sha = await buildRevision(buildUrl, repo);
  if (!sha) return null;
  const { execSync } = await import('node:child_process');
  try {
    const behind = execSync(`git rev-list --count ${sha}..origin/${branch}`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return { sha, behind: Number(behind.toString().trim()) };
  } catch {
    return { sha, behind: null };
  }
}

async function knownFlickers() {
  const data = await getJSON(
    `${JIRA}/rest/api/2/search?jql=${enc(FLICKER_JQL)}&maxResults=200&fields=summary,${FLICKER_FIELD}`);
  const byTest = new Map();
  const all = [];
  for (const issue of data?.issues || []) {
    const entry = { key: issue.key, summary: issue.fields.summary };
    all.push(entry);
    const ref = issue.fields[FLICKER_FIELD];
    if (ref) byTest.set(ref.trim().replace(/\(.*$/, ''), entry);
  }
  // Not every flicker issue fills the field in, so fall back to the summary — but only when it
  // names both the class and the method, since a bare method name matches far too much.
  return id => {
    const exact = byTest.get(id);
    if (exact) return exact;
    const [className, method] = id.split('#');
    const simpleName = className.split(/[.$]/).pop().replace(/^Nested/, '');
    return all.find(issue => issue.summary.includes(simpleName) && issue.summary.includes(method)) || null;
  };
}

/** @returns {Map} test id -> one row aggregating every job and environment of the branch. */
async function collect(branch, repos, history = 0) {
  const builds = [];
  const tests = new Map();
  const row = id => {
    if (!tests.has(id)) {
      tests.set(id, {
        id, jobs: new Set(), failed: new Set(), ran: new Set(), skipped: new Set(), detail: '',
        seenIn: 0, failedIn: 0
      });
    }
    return tests.get(id);
  };
  for (const job of releaseTrainJobs(repos, branch)) {
    const [build, ...older] = await testedBuilds(job.url, Math.max(1, history));
    if (!build) { builds.push({ ...job, build: null }); continue; }
    const buildUrl = `${job.url}/${build.number}`;
    builds.push({ ...job, build, history: older.length + 1, rev: await revision(buildUrl, job.repo, branch) });
    for (const test of (await testResults(buildUrl)).values()) {
      const target = row(test.id);
      // Environments are namespaced by job so that the two jobs' "default" ones stay distinct.
      for (const env of test.failed) target.failed.add(`${job.label}/${env}`);
      for (const env of test.ran) target.ran.add(`${job.label}/${env}`);
      for (const env of test.skipped) target.skipped.add(`${job.label}/${env}`);
      if (test.failed.size) target.jobs.add(job.label);
      if (test.detail && !target.detail) target.detail = test.detail;
      if (test.ran.size) { target.seenIn++; if (test.failed.size) target.failedIn++; }
    }
    // One build is one sample: a rate over several is what separates a flicker from a breakage.
    for (const build of older) {
      const { ran, failed } = await outcomes(`${job.url}/${build.number}`);
      for (const id of ran) { const target = row(id); target.seenIn++; if (failed.has(id)) target.failedIn++; }
    }
  }
  return { builds, tests };
}

/**
 * A test that failed in every environment that ran it is broken; one that failed in some of them
 * flickers. A single environment cannot tell the two apart — but failing every recent build can.
 */
function verdictOf(row) {
  const alwaysFails = row.seenIn > 1 && row.failedIn === row.seenIn;
  if (row.ran.size < 2) return alwaysFails ? 'systematic' : 'single env';
  return row.failed.size === row.ran.size || alwaysFails ? 'systematic' : 'intermittent';
}

/**
 * An open flicker issue is stale once its test fails everywhere, every time: that is no longer a
 * flicker. Failing every environment only in bursts stays a (bad) flicker, so it is not flagged.
 */
const staleIssue = (row, flicker) =>
  !!flicker && verdictOf(row) === 'systematic' && row.seenIn > 1 && row.failedIn === row.seenIn;

function report(branch, { builds, tests }, compareBranches, flickerFor, max) {
  const lines = [`# Test triage for [${branch}]`, ''];
  for (const job of builds) {
    if (!job.build) { lines.push(`- **${job.label}** — no build with test results`); continue; }
    const rev = job.rev;
    const staleness = !rev ? 'revision unknown'
      : `ran ${rev.sha.slice(0, 11)}` + (rev.behind == null ? '' : `, ${rev.behind} commit(s) behind the branch`);
    lines.push(`- **${job.label}** — #${job.build.number} ${job.build.result}, `
      + `${job.build.failCount}/${job.build.totalCount} failed, ${staleness}`
      + (job.history > 1 ? `, rated over ${job.history} builds` : ''));
  }

  const rows = [...tests.values()].filter(row => row.failed.size);
  const failures = rows.filter(row => !isPseudoTest(row.id));
  const pseudo = rows.filter(row => isPseudoTest(row.id));
  const order = { systematic: 0, 'single env': 1, intermittent: 2 };
  failures.sort((a, b) => order[verdictOf(a)] - order[verdictOf(b)]);

  lines.push('');
  if (!failures.length) lines.push('No failing test methods.');
  else {
    const columns = ['Test', 'Jobs', 'Failed/ran envs', 'Failed/ran builds', 'Verdict', 'JIRA',
      ...compareBranches];
    lines.push(`| ${columns.join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`);
    for (const row of failures.slice(0, max)) {
      const flicker = flickerFor(row.id);
      lines.push('| ' + [
        row.id,
        [...row.jobs].join(', '),
        `${row.failed.size}/${row.ran.size}` + (row.skipped.size ? ` (+${row.skipped.size} skipped)` : ''),
        `${row.failedIn}/${row.seenIn}`,
        verdictOf(row),
        flicker ? `${flicker.key}${staleIssue(row, flicker) ? ' **STALE**' : ' open'}` : '—',
        ...compareBranches.map(b => row.compare?.[b] || '?')
      ].join(' | ') + ' |');
    }
    if (failures.length > max) lines.push(`| _…and ${failures.length - max} more_ |${columns.slice(1).map(() => ' |').join('')}`);
    lines.push('', '## First error line',
      ...failures.slice(0, max).map(row => `- \`${row.id}\`: ${row.detail || '(none)'}`));
  }

  if (pseudo.length) {
    lines.push('', '## Not test methods (module setup failure, or forbidden content in the logs)',
      ...pseudo.slice(0, max).map(row => `- \`${row.id}\` (${[...row.jobs].join(', ')}): ${row.detail || '(none)'}`));
    if (pseudo.length > max) lines.push(`- _…and ${pseudo.length - max} more_`);
  }
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
const target = await collect(args.branch, args.repos, args.history);

for (const branch of args.compare) {
  const other = await collect(branch, args.repos);
  for (const row of target.tests.values()) {
    if (!row.failed.size) continue;
    const test = other.tests.get(row.id);
    row.compare ??= {};
    row.compare[branch] = !test ? 'absent'
      : test.failed.size ? `failed ${test.failed.size}/${test.ran.size}`
        : test.ran.size ? 'passed' : 'skipped';
  }
}

const flickerFor = await knownFlickers();
if (args.json) {
  const replacer = (_key, value) => (value instanceof Set ? [...value] : value);
  console.log(JSON.stringify({
    branch: args.branch,
    builds: target.builds,
    failures: [...target.tests.values()].filter(row => row.failed.size)
      .map(row => ({
        ...row, verdict: verdictOf(row), jira: flickerFor(row.id),
        staleIssue: !!staleIssue(row, flickerFor(row.id)), pseudo: isPseudoTest(row.id)
      }))
  }, replacer, 2));
} else {
  console.log(report(args.branch, target, args.compare, flickerFor, args.max));
}
