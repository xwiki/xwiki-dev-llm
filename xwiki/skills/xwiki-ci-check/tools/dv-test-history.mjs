#!/usr/bin/env node
/*
 * Runs `dv-test-history`, the Develocity analyser in `xwiki/xwiki-dev-tools`, and prints the part
 * of its report that is worth a model's context.
 *
 * **The division of labour this tool exists to enforce: `dv-test-history` establishes the facts,
 * `xwiki-ci-check` decides and acts on them.** Jenkins knows what is red in the eight builds it
 * still retains; Develocity knows every execution of that test for 28 days, across every branch,
 * browser, database and servlet container, grouped by what actually failed. "Fails only on Firefox,
 * started on the 28th, never alone in its build" is not a thing this sweep can derive, and it is
 * the thing that makes the difference between a report and an analysis.
 *
 * Two problems stand between the sweep and that tool, and this wrapper is both of their answers.
 *
 * **Where it is.** It is not vendored here: it is 2300 lines maintained by somebody else, and a copy
 * would rot silently while looking current. So it is *invoked* from a checkout — the developer's
 * own, or one this script clones into the plugin's state directory, which is what a routine's fresh
 * sandbox gets every morning. `XWIKI_DEV_TOOLS` overrides both.
 *
 * **How much of it enters the conversation.** The full report for one test is ~34 KB — measured on
 * `NavigationPanelAdministrationIT#navigationPanelAdministration`, 2026-09-18 — which is most of a
 * deep incident's whole budget spent on tables nobody reads. The report is therefore always written
 * to a file, and what lands on stdout is its header and `## Key findings`: the failure rate, the
 * enrichment ("only on firefox, p=3e-12"), the change points, and one line per distinct failure.
 * That is ~2 KB and it is the analysis. `--section F1` then prints the one failure group that
 * matches the incident at hand, and `--full` prints everything, for a human.
 *
 * Costs real requests — 123 Develocity + 19 Jenkins for that same test — so the skill spends it on
 * a deep class-1 incident and on nothing else.
 *
 * Usage:
 *   node dv-test-history.mjs 'org.xwiki.foo.AllIT$NestedBarIT#baz'   # header + key findings
 *   node dv-test-history.mjs --section F1 'org.xwiki.foo.AllIT$NestedBarIT#baz'
 *   node dv-test-history.mjs --full 'org.xwiki.foo.AllIT$NestedBarIT#baz'
 *   node dv-test-history.mjs --recent-failures 24   # what failed lately, new vs known
 *   node dv-test-history.mjs --where                # resolved script path, then exit
 *
 * Every other option is passed through untouched (`--days`, `--json <file>`, `--group-by`, …);
 * `dv-test-history --help` lists them.
 *
 * Environment: DEVELOCITY_MCP_ACCESS_KEY, the bare access key this plugin's `.mcp.json` already
 * uses for the `develocity` MCP server, or DEVELOCITY_ACCESS_KEY, the Maven extension's host-scoped
 * form of the same key, which is unscoped here before use. With neither set the tool's own fallbacks
 * (`~/.gitconfig`, a literal token in a Claude MCP config) still apply. DEVELOCITY_URL defaults to
 * XWiki's server. XWIKI_DEV_TOOLS points at a checkout or at the script.
 *
 * Exit code 3 means it could not run at all — no python3, no checkout, no network to clone one.
 * Anything else non-zero is the tool's own. Both mean the same thing to the caller: there are no
 * Develocity facts this morning, carry on with what Jenkins gave you.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateRoot } from '../../../scripts/state-dir.mjs';

const REPO = 'https://github.com/xwiki/xwiki-dev-tools.git';
const SCRIPT = join('bash', 'dv-test-history');
const DEFAULT_SERVER = 'https://community.develocity.cloud';
// Enough for the header, the key findings and a long list of failure groups, and short of a report
// that has decided to be a whole document. A truncated print still names the file it came from.
const MAX_LINES = 140;

/** No checkout, no tool: the one failure the caller is expected to shrug off. */
class Unavailable extends Error {}

/**
 * Where the tool is, in the order a machine is likely to have it: named, sitting next to this
 * repo the way XWiki checkouts sit next to each other, or cloned here once.
 */
function resolveScript() {
  const named = process.env.XWIKI_DEV_TOOLS;
  if (named) {
    const candidate = named.endsWith('dv-test-history') ? named : join(named, SCRIPT);
    if (!existsSync(candidate)) throw new Unavailable(`XWIKI_DEV_TOOLS names ${candidate}, which does not exist`);
    return candidate;
  }
  const sibling = join(dirname(repoRoot()), 'xwiki-dev-tools', SCRIPT);
  if (existsSync(sibling)) return sibling;
  return clonedScript();
}

/** The root of the checkout this runs from, so the sibling lookup means something. */
function repoRoot() {
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim() : process.cwd();
}

/**
 * A clone of our own, refreshed when it is already there. The refresh fails soft: a stale copy of
 * an analyser is worth incomparably more than no analyser, and a sandbox with no network is exactly
 * where this would otherwise become fatal.
 */
function clonedScript() {
  const checkout = join(stateRoot(), 'xwiki-dev-tools');
  const script = join(checkout, SCRIPT);
  if (existsSync(script)) {
    spawnSync('git', ['-C', checkout, 'pull', '--ff-only', '-q'], { stdio: 'ignore', timeout: 30000 });
    return script;
  }
  process.stderr.write(`cloning ${REPO} into ${checkout}\n`);
  const clone = spawnSync('git', ['clone', '--depth', '1', '-q', REPO, checkout],
    { stdio: 'inherit', timeout: 120000 });
  if (clone.status !== 0 || !existsSync(script)) throw new Unavailable(`could not clone ${REPO} into ${checkout}`);
  return script;
}

/**
 * The credential, under either of its two names — the tool's own fallbacks cover the rest.
 *
 * `DEVELOCITY_MCP_ACCESS_KEY` comes first because it is the one this plugin documents and it holds
 * the key *bare*, which is what an `Authorization: Bearer` header needs. `DEVELOCITY_ACCESS_KEY` is
 * the Maven and Gradle extensions' variable, and they require it host-scoped —
 * `community.develocity.cloud=<key>`, optionally several hosts separated by `;` — so the entry for
 * the server being queried is picked out of it and the prefix dropped. Sending the whole string as a
 * token is a 401 on every request, on precisely the machine that set the build up correctly.
 */
function credentials(argv, server) {
  const out = [];
  const token = process.env.DEVELOCITY_MCP_ACCESS_KEY || bareKey(process.env.DEVELOCITY_ACCESS_KEY, server);
  if (token && !argv.includes('--token')) out.push('--token', token);
  if (!argv.includes('--server')) out.push('--server', server);
  return out;
}

/** A host-scoped Maven access key reduced to the key itself, for the host being queried. */
function bareKey(value, server) {
  if (!value) return null;
  const host = new URL(server).host;
  const entries = value.split(';').map(entry => entry.trim()).filter(Boolean);
  const scoped = entries.find(entry => entry.startsWith(`${host}=`));
  if (scoped) return scoped.slice(host.length + 1);
  // A single unscoped value is already the bare key; several, none of them ours, is nothing usable.
  return entries.length === 1 && !entries[0].includes('=') ? entries[0] : null;
}

/**
 * The header and `## Key findings` — everything before the first numbered section. A report with no
 * key findings (the `--recent-failures` listing) is its own summary and is printed whole.
 */
function summarise(report, section) {
  const lines = report.split('\n');
  if (section) {
    const start = lines.findIndex(line => new RegExp(`^#{2,3} ${section}\\b`).test(line));
    if (start === -1) return [`(no section ${section} in the report)`];
    const end = lines.findIndex((line, index) => index > start && /^#{2,3} /.test(line));
    return lines.slice(start, end === -1 ? lines.length : end);
  }
  const numbered = lines.findIndex(line => /^## \d+\. /.test(line));
  if (numbered === -1) return lines;
  return [...lines.slice(0, numbered), ...lines.filter(line => /^### F\d+ — /.test(line))];
}

// ---- The same facts, for a tool instead of a reader --------------------------------------------

/**
 * The analyser's findings about one test, structured, for `ci-check.mjs` to put in the work order.
 *
 * The CLI above prints a report for a human (or for a model reading a terminal); this returns the
 * same run's conclusions as data, so that the sweep can carry them into the paste, the digest and a
 * commit comment whether or not a model ever runs. It is the reason `ageDays` can be honest: that
 * number is the current streak in the eight builds Jenkins retains, and `firstSeen` here is when
 * the failure actually started, across every branch, in 28 days of executions.
 *
 * Both of the analyser's outputs are read, and each for what only it has: the JSON for the counts,
 * the configurations and the scan ids, and the report's `## Key findings` for the sentences it
 * *derived* — the enrichment with its p-value, the change points, how many clean runs a claim of
 * "fixed" would need. Those are quoted verbatim rather than recomputed here: re-deriving a Fisher
 * exact test in this file is how the two layers start disagreeing about the same test, and the
 * division of labour is that this one does not do analysis.
 *
 * Never throws: every failure — no checkout, no `python3`, no credential, a timeout, a test
 * Develocity has never heard of — comes back as `{unavailable}`, because a sweep that dies on a
 * laptop with nothing configured is worse than a sweep with no Develocity facts in it.
 *
 * @param {string} test `container#testCase`, as the work order's `tests` holds it.
 * @param {{days?: number, match?: string, timeoutMs?: number, artifacts?: number}} options
 *   `match` is the incident's own error line: a test with several distinct failures gets the group
 *   that matches *this* incident, not its most frequent one.
 * @returns {object} the facts, or `{unavailable: <why>}`.
 */
export function develocityFacts(test, { days = 28, match = null, timeoutMs = 300000, artifacts = 3 } = {}) {
  let script;
  try {
    script = resolveScript();
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    return { unavailable: error.message };
  }
  const dir = mkdtempSync(join(tmpdir(), 'dv-facts-'));
  const report = join(dir, 'report.md');
  const raw = join(dir, 'report.json');
  const server = process.env.DEVELOCITY_URL || DEFAULT_SERVER;
  const args = [test, '--days', String(days), '--artifacts', String(artifacts), '-o', report, '--json', raw];
  const run = spawnSync('python3', [script, ...args, ...credentials([], server)],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs });
  if (run.error?.code === 'ENOENT') return { unavailable: 'python3 is not on the PATH' };
  if (run.error?.code === 'ETIMEDOUT') return { unavailable: `timed out after ${Math.round(timeoutMs / 1000)}s` };
  if (run.status !== 0 || !existsSync(raw)) {
    // The analyser's own last words, which name the cause (a 401, an unknown test) far better than
    // the exit code does.
    // Trimmed: a 401 answers with its whole problem document, and this string is carried in the
    // work order, where the reader needs the cause and not the server's JSON.
    const said = (run.stderr || '').trim().split('\n').filter(Boolean).pop();
    return { unavailable: (said || `dv-test-history exited ${run.status}`).slice(0, 160) };
  }
  try {
    return factsOf(JSON.parse(readFileSync(raw, 'utf8')),
      existsSync(report) ? readFileSync(report, 'utf8') : '', { match, server, report, days });
  } catch (error) {
    return { unavailable: `could not read the analysis: ${error.message}` };
  }
}

const DAY = 86400000;
const daysAgo = at => Math.floor((Date.now() - at) / DAY);
const day = at => new Date(at).toISOString().slice(0, 10);
const percent = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : 'n/a');

/** The numbers from the JSON, the derived sentences from the report, and nothing either invented. */
function factsOf(raw, markdown, { match, server, report, days }) {
  const groups = raw.groups || [];
  const group = pickGroup(groups, match);
  const configs = Object.entries(raw.configs || {});
  const failing = configs.filter(([, row]) => row.fail_count > 0)
    .sort((a, b) => b[1].fail_count - a[1].fail_count);
  const recent = [...(group?.occurrences || [])].sort((a, b) => b.time - a.time);
  const artifact = (group?.artifacts || [])[0];
  return {
    test: `${raw.container}#${raw.test}`,
    windowDays: days,
    runs: raw.totals?.runs ?? null,
    failures: raw.totals?.failures ?? null,
    failRate: percent(raw.totals?.failures ?? 0, raw.totals?.runs ?? 0),
    distinct: groups.length,
    // Which of the test's distinct failures this is, and how much of its history it accounts for.
    group: group && {
      label: group.label,
      exception: group.exception,
      count: group.count,
      share: percent(group.count, raw.totals?.failures ?? 0),
      message: (group.normalised_message || '').slice(0, 200)
    },
    // When it started, as against the streak Jenkins can see. A flicker whose current streak is one
    // build has been failing for three weeks, and that is the difference between "a commit last
    // night broke this" and "this has always been broken and the window is a coincidence".
    firstSeen: group?.first ? day(group.first) : null,
    firstSeenDays: group?.first ? daysAgo(group.first) : null,
    lastSeen: group?.last ? day(group.last) : null,
    lastSeenDays: group?.last ? daysAgo(group.last) : null,
    // `new` is what `--recent-failures` calls a failure Develocity had not seen before today; it is
    // the one that may genuinely belong to a commit in the regression window.
    news: group?.first == null ? null : daysAgo(group.first) <= 1 ? 'new' : 'known',
    configsRun: configs.length,
    configsFailing: failing.length,
    configs: failing.slice(0, 3).map(([name, row]) =>
      `${name} — ${row.fail_count}/${row.runs} (${percent(row.fail_count, row.runs)})`),
    // The analyser's own conclusions, in its words. Capped because a report with many distinct
    // failures lists one bullet per failure and this is a work-order field, not a document.
    findings: keyFindings(markdown).slice(0, 6),
    scans: [...new Set(recent.map(occurrence => occurrence.scan_id))].slice(0, 2)
      .map(id => `${server}/s/${id}`),
    // Jenkins keeps these for a few days only, so most failures have none — when there is one it is
    // the single most useful link in a flicker issue.
    artifacts: artifact && (artifact.screenshot || artifact.video)
      ? { screenshot: artifact.screenshot || null, video: artifact.video || null, config: artifact.config }
      : undefined,
    report
  };
}

/**
 * The failure group this incident is about.
 *
 * A test that fails two different ways has two groups, and answering with the bigger one would
 * describe last month's failure while this morning's is something else. The incident's own error
 * line decides: its exception class, then the words of its message. No match at all is honest — the
 * group is left out rather than guessed, and the counts above still stand for the whole test.
 */
function pickGroup(groups, match) {
  if (!groups.length) return null;
  if (!match) return groups[0];
  const wanted = String(match).toLowerCase();
  const scored = groups.map(group => {
    const exception = (group.exception || '').toLowerCase();
    const words = (group.normalised_message || '').toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(word => word.length > 3).slice(0, 10);
    const overlap = words.filter(word => wanted.includes(word)).length;
    return { group, score: (wanted.includes(spelt(group.exception)) ? 4 : 0)
      + (exception && wanted.includes(exception) ? 3 : 0) + overlap };
  }).sort((a, b) => b.score - a.score || b.group.count - a.group.count);
  return scored[0].score > 0 ? scored[0].group : null;
}

/**
 * An exception class name as its own message spells it: `StaleElementReferenceException` ⇒ "stale
 * element reference".
 *
 * This is what identifies a WebDriver failure, and it has to be derived because the analyser
 * deliberately drops the detail message of exceptions whose wording is driver-specific — so the
 * group for a stale element carries no words to match on, while every *other* group carries the
 * word "element" and would win a match on word overlap alone. Measured on
 * `AllIT$NestedLinkIT#editPageLink`, whose stale-element failure was attributed to the
 * `NoSuchElementException` group until the name was scored.
 */
const spelt = exception => (exception || '').split('.').pop().replace(/Exception$/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/** The report's `## Key findings` bullets — the part that is analysis rather than tabulation. */
function keyFindings(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => /^## Key findings\b/.test(line));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end)
    .filter(line => line.startsWith('* '))
    .map(line => line.slice(2).trim());
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') && argv.length === 1) {
    const header = readFileSync(new URL(import.meta.url)).toString().split('*/')[0];
    process.stdout.write(header.replace(/^\/\*\n| \* ?/gm, ''));
    return 0;
  }
  let script;
  try {
    script = resolveScript();
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    process.stderr.write(`dv-test-history unavailable: ${error.message}\n`);
    return 3;
  }
  if (argv[0] === '--where') {
    process.stdout.write(`${script}\n`);
    return 0;
  }

  const full = argv.includes('--full');
  const sectionAt = argv.indexOf('--section');
  const section = sectionAt === -1 ? null : argv[sectionAt + 1];
  const passthrough = argv.filter((arg, index) =>
    arg !== '--full' && (sectionAt === -1 || (index !== sectionAt && index !== sectionAt + 1)));
  // `-o` is how the bulk stays out of the conversation, so it is always passed — the caller's own
  // wins, and then the caller knows where the report is without being told.
  const given = passthrough.findIndex(arg => arg === '-o' || arg === '--output');
  const report = given === -1
    ? join(mkdtempSync(join(tmpdir(), 'dv-test-history-')), 'report.md')
    : passthrough[given + 1];
  const args = given === -1 ? [...passthrough, '-o', report] : passthrough;

  const server = process.env.DEVELOCITY_URL || DEFAULT_SERVER;
  const run = spawnSync('python3', [script, ...args, ...credentials(passthrough, server)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (run.error?.code === 'ENOENT') {
    process.stderr.write('dv-test-history unavailable: python3 is not on the PATH\n');
    return 3;
  }
  if (run.status !== 0 || !existsSync(report)) return run.status ?? 1;

  const text = readFileSync(report, 'utf8');
  const out = full ? text.split('\n') : summarise(text, section);
  process.stdout.write(`${out.slice(0, MAX_LINES).join('\n')}\n`);
  if (out.length > MAX_LINES) process.stdout.write(`\n_(${out.length - MAX_LINES} more lines)_\n`);
  if (!full) process.stdout.write(`\nFull report: ${report} — one failure group with \`--section F1\`.\n`);
  return 0;
}

// Run only when this file *is* the command. `ci-check.mjs` imports `develocityFacts` from here, and
// a module that exits the process on import would take the sweep with it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
