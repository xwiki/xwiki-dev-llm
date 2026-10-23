/*
 * The sweep: the jobs, their histories, the incidents built from them, their blame and their
 * budget. Part of ci-check.mjs.
 */

import {
  ENV_TESTS_FOLDER, MAIN_FOLDER, branchesOf, buildRevision, buildSummaries, isPseudoTest, jobUrl, outcomes,
  testResults
} from '../../../../scripts/jenkins.mjs';
import { attribute } from './blame.mjs';
import { commitsBetween, priorComment, token, unbuiltCommits } from './github.mjs';
import { diagnose, infraInDetail } from './logs.mjs';
import { withPolicy } from './policy.mjs';
import { jiraKey, securityOnly } from './render.mjs';
import { dayOf, daysSince } from './util.mjs';

// ---- Sweep -----------------------------------------------------------------------------------

/** Every job of every maintained branch, discovered from Jenkins rather than hardcoded. */
export async function discover(repos, only) {
  const targets = new Map();
  const add = (repo, branch, label, folder) => {
    const key = `${repo}/${branch}`;
    if (!targets.has(key)) targets.set(key, { repo, branch, jobs: [] });
    targets.get(key).jobs.push({ label, url: jobUrl(folder, repo, branch) });
  };
  for (const repo of repos) {
    for (const branch of await branchesOf(MAIN_FOLDER, repo)) {
      // feature-* branches are experiments whose red is nobody's emergency.
      if (branch !== 'master' && !branch.startsWith('stable-')) continue;
      if (only && branch !== only) continue;
      add(repo, branch, 'main', MAIN_FOLDER);
    }
  }
  if (repos.includes('xwiki-platform')) {
    for (const branch of await branchesOf(ENV_TESTS_FOLDER, 'xwiki-platform')) {
      if (targets.has(`xwiki-platform/${branch}`)) add('xwiki-platform', branch, 'env-tests', ENV_TESTS_FOLDER);
    }
  }
  // The security-only LTS line is not swept at all, unless named: it takes security fixes only, so a
  // red test there is nobody's daily work, and it filled the paste with the same long-standing rows
  // every morning (16.10.x, October 2026). The digest already withholds it (`publicView`).
  const retired = securityOnly([...targets.values()].map(target => target.branch)).filter(branch => branch !== only);
  for (const key of [...targets.keys()]) if (retired.includes(targets.get(key).branch)) targets.delete(key);
  const policy = new Map(withPolicy([...new Set([...targets.values()].map(t => t.branch))])
    .map(entry => [entry.branch, entry]));
  return [...targets.values()].map(target => ({ ...target, ...policy.get(target.branch) }));
}

/** One job's recent completed builds, newest first, plus the ones that produced test results. */
const historyCache = new Map();
export function jobHistory(job, history) {
  if (!historyCache.has(job.url)) {
    historyCache.set(job.url, (async () => {
      const builds = (await buildSummaries(job.url, history + 2)).filter(build => !build.building && build.result);
      return { ...job, builds, tested: builds.filter(build => build.totalCount != null) };
    })());
  }
  return historyCache.get(job.url);
}

// One build's test outcomes, fetched once. Three passes ask the same question of the same builds:
// the history walk that ages a failure, the flicker rating, and the cross-branch check that reads
// another branch's report looking for the build this failure stopped in.
const outcomesCache = new Map();
export const outcomesOf = buildUrl => {
  if (!outcomesCache.has(buildUrl)) outcomesCache.set(buildUrl, outcomes(buildUrl));
  return outcomesCache.get(buildUrl);
};

/**
 * Per test: where it failed now, and how it has behaved over the recent builds.
 *
 * The history walk skips builds that produced no test results, which is the point: a `FAILURE`
 * build between two `UNSTABLE` ones ran no test, and counting it as "did not fail" would make
 * every breakage look like it started today. (Jenkins' own `age`/`failedSince` make that mistake.)
 */
async function testHistory(job, args) {
  const [latest, ...older] = job.tested.slice(0, args.history);
  if (!latest) return new Map();

  // Only what is failing in the *latest* build can be an incident. A test that failed three builds
  // ago and passes today is history, not news — seeding the map from the older builds too is how
  // a sweep ends up reporting a dozen already-fixed failures as this morning's problem.
  const tests = new Map();
  for (const test of (await testResults(`${job.url}/${latest.number}`)).values()) {
    if (!test.failed.size) continue;
    tests.set(test.id, {
      id: test.id,
      job: job.label,
      jobUrl: job.url,
      failedEnvs: new Set([...test.failed].map(env => `${job.label}/${env}`)),
      ranEnvs: new Set([...test.ran].map(env => `${job.label}/${env}`)),
      detail: test.detail,
      failedBuilds: [latest],
      seenBuilds: [latest]
    });
  }
  if (!tests.size) return tests;

  for (const build of older) {
    const { ran, failed } = await outcomesOf(`${job.url}/${build.number}`);
    for (const [id, row] of tests) {
      if (!ran.has(id)) continue;
      row.seenBuilds.push(build);
      if (failed.has(id)) row.failedBuilds.push(build);
    }
  }
  return tests;
}

/**
 * Failing every environment that ran it is a breakage; failing some of them is a flicker. One
 * environment cannot tell the two apart on its own — but failing every build since it started can.
 */
function verdictOf(row) {
  const seen = row.perJob.reduce((total, job) => total + job.seenBuilds.length, 0);
  const failed = row.perJob.reduce((total, job) => total + job.failedBuilds.length, 0);
  const alwaysFails = seen > 1 && failed === seen;
  // The environment count has to be tested first. With a single environment "failed every
  // environment that ran it" is trivially true of anything failing at all, so reading it as
  // systematic would make every unit-test failure a breakage on the evidence of one run.
  if (row.ranEnvs.size < 2) {
    if (alwaysFails) return 'systematic';
    // One environment and no history to rate it over: the data says nothing yet. Calling that a
    // flicker is the mistake — a failure seen once is an event, and half of them are a breakage
    // that has simply not had a second build to prove itself in.
    return seen > 1 ? 'single env' : 'first seen';
  }
  return row.failedEnvs.size === row.ranEnvs.size || alwaysFails ? 'systematic' : 'intermittent';
}

/**
 * The build this test started failing in — the oldest of the unbroken run of failures ending now.
 *
 * Strictly per job: the main job and the Environment Tests job number their builds independently,
 * so a window walked over the two lists merged would compare build #57 of one with #57 of the
 * other and land anywhere.
 *
 * @returns {{job: string, firstBad: object, lastGood: object|null, atLeast: boolean}} `atLeast`
 *   when the walk ran out of history before finding a green build, so the age is a lower bound.
 */
function regressionWindow(row) {
  // seenBuilds is newest-first, as the history is fetched, and [0] is a failure by construction.
  const failed = new Set(row.failedBuilds.map(build => build.number));
  const at = (firstBad, lastGood, atLeast) => ({ job: row.job, jobUrl: row.jobUrl, firstBad, lastGood, atLeast });
  let firstBad = row.seenBuilds[0];
  for (const build of row.seenBuilds) {
    if (!failed.has(build.number)) return at(firstBad, build, false);
    firstBad = build;
  }
  return at(firstBad, null, true);
}

/** A failure seen once is an event; seen in two builds on two days it has earned an issue. */
const flickerProven = row => {
  const failures = row.perJob.flatMap(job => job.failedBuilds.map(build => ({ ...build, job: job.job })));
  const builds = new Set(failures.map(build => `${build.job}#${build.number}`));
  const days = new Set(failures.map(build => dayOf(build.timestamp)));
  return builds.size >= 2 && days.size >= 2;
};

/** Walks back through the consecutive broken builds that share the latest one's signature. */
export async function breakWindow(job, latest, signature, maxConsole) {
  const at = (firstBad, lastGood, atLeast) => ({ job: job.label, jobUrl: job.url, firstBad, lastGood, atLeast });
  let firstBad = latest;
  let read = 1;
  for (const build of job.builds.slice(job.builds.indexOf(latest) + 1)) {
    if (build.result === 'SUCCESS' || build.result === 'UNSTABLE') return at(firstBad, build, false);
    // Out of log budget, the window still ends at the last build that completed: reading the rest
    // could only move `firstBad`, never `lastGood`, as a masked window shows. Cut short, a break
    // that outlived the budget had no window, so no culprit and no "already commented": master's
    // `eslint:l10n.ts`, commented on 2026-10-18, read "no owner found" on 10-19 with its fix PR open.
    // The age stays a lower bound: the oldest broken build read is not where the break began.
    if (read >= maxConsole) {
      const { lastGood } = maskedWindow(job, build, firstBad, at);
      return { ...at(firstBad, lastGood, true), unread: true };
    }
    read++;
    const diagnosis = await diagnose(`${job.url}/${build.number}`);
    const older = [diagnosis, ...(diagnosis.also || [])].some(cause => cause.signature === signature)
      ? signature : diagnosis.signature;
    // A different cause is not where this one starts: a broken build stops at its first failure, so
    // everything after it went unbuilt and this break may have been there, hidden. On 2026-10-17 the
    // run fixed a lint error in `xwiki-platform-node`; the next build reached
    // `xwiki-platform-localization-webjar` and failed on the very ESLint rule the same commit had
    // enabled — and a window cut at the masking build held only the bot's own fix. So the window
    // reaches back to the last build that got past every module, and says what masked it.
    if (older !== signature) {
      return { ...maskedWindow(job, build, firstBad, at), masked: { by: older, build: build.number } };
    }
    firstBad = build;
  }
  return at(firstBad, null, true);
}

/** The window of a break hidden by an older, different one: back to the last build that completed. */
function maskedWindow(job, masking, firstBad, at) {
  const older = job.builds.slice(job.builds.indexOf(masking) + 1);
  const completed = older.find(build => build.result === 'SUCCESS' || build.result === 'UNSTABLE');
  return completed ? at(firstBad, completed, false) : at(firstBad, null, true);
}

// ---- Incident assembly -----------------------------------------------------------------------

const incidentId = (target, signature) => `${target.repo.replace(/^xwiki-/, '')}/${target.branch}/${signature}`;

/**
 * Flickers of one test class that failed in exactly the same builds, as one incident.
 *
 * Each test of a class can have its own old flicker issue, and each then got its own row, its own
 * "already tracked — the issue is where this gets settled", and no analysis: six `ExtensionIT`
 * tests on 16.10.x failed in the same four of eight builds for three mornings running, which is one
 * cause — the class, its fixture or its environment — and not six flickers. Two shared failing
 * builds at least: one is a coincidence any bad build produces.
 */
export function cofailing(flickering) {
  const groups = new Map();
  for (const entry of flickering) {
    const builds = entry.row.perJob
      .map(job => `${job.job}:${job.failedBuilds.map(build => build.number).sort().join(',')}`)
      .sort().join(' ');
    const failed = entry.row.perJob.reduce((n, job) => n + job.failedBuilds.length, 0);
    const key = failed >= 2 ? `${entry.incident.id.split('#')[0]}|${builds}` : entry.incident.id;
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  return [...groups.values()].map(group => {
    if (group.length === 1) return group[0].incident;
    const members = group.map(entry => entry.incident).sort((a, b) => a.id.localeCompare(b.id));
    const issues = [...new Set(members.map(member => member.jira && jiraKey(member)).filter(Boolean))];
    return {
      // The smallest test id names the group, as for a breakage: stable while the group holds.
      ...members[0],
      tests: members.map(member => member.tests[0]),
      testCount: members.length,
      evidence: members.slice(0, 3).map(member => `${member.tests[0]}: ${member.evidence[0]}`),
      jira: members.find(member => member.jira)?.jira || null,
      jiraClosed: members.some(member => member.jira) ? null
        : members.find(member => member.jiraClosed)?.jiraClosed || null,
      // Every issue that tracks one of them: they describe one cause, and whoever fixes it closes them all.
      jiras: issues.length > 1 ? issues : undefined,
      cofailing: true
    };
  });
}

/**
 * One cause read one way on every branch it is red on. `kind` is decided per job, so one cause could
 * be a flicker on master and a breakage on stable-18.9.x — as `SideMenuIT`'s seven tests were on
 * 2026-10-21, failing together since the same commit on both. A breakage seen on any branch is what
 * the cause is: the group is promoted to it, and keeps each branch's own `state`.
 *
 * @param {object[]} group the incidents of one repo sharing one signature
 */
export function oneKindPerCause(group) {
  if (!group.some(incident => incident.kind === 'test-breakage')) return;
  for (const incident of group) if (incident.kind === 'flicker') incident.kind = 'test-breakage';
}

export async function incidentsOf(target, args, flickerFor, closedFlickerFor) {
  const incidents = [];
  const jobs = await Promise.all(target.jobs.map(job => jobHistory(job, args.history)));

  // --- Class 5: absence. Only a branch that is supposed to move can be too quiet.
  const newest = Math.max(...jobs.flatMap(job => job.builds.map(build => build.timestamp)), 0);
  if (target.alerting && (!newest || daysSince(newest) >= args.absence)) {
    const unbuilt = await unbuiltCommits(target, jobs, args);
    // Quiet is not the symptom — *behind* is. A maintained branch nobody has committed to for a
    // week has a week-old build and is perfectly healthy; alerting on the clock alone fires on
    // every calm LTS branch every morning, which is how a digest gets ignored.
    if (unbuilt.behind !== 0) {
      incidents.push({
        ...base(target, 5, 'absence', 'no-build'),
        state: 'absent',
        evidence: [
          newest ? `last build ${daysSince(newest)} day(s) ago` : 'no build at all',
          unbuilt.reason
        ],
        ageDays: newest ? daysSince(newest) : null,
        unconfirmed: unbuilt.behind == null,
        blame: { tier: 'none', reason: 'nobody breaks a branch by not building it', suspects: [] }
      });
    }
  }

  // --- Classes 2 & 3: a job that broke before (or outside) its tests.
  for (const job of jobs) {
    const latest = job.builds[0];
    if (!latest || latest.result !== 'FAILURE') continue;
    const first = await diagnose(`${job.url}/${latest.number}`);
    // One incident per cause: an infrastructure failure of a parallel stage is not the first
    // stage's, and has its own window — it recurs while the first cause may be new.
    for (const diagnosis of [first, ...(first.also || [])]) {
      const window = await breakWindow(job, latest, diagnosis.signature, args.maxConsole);
      incidents.push({
        // The job is part of the identity: the main job and the environment matrix break
        // independently, and two incidents sharing an id would share a comment marker too, so one
        // would silence the other for good.
        ...base(target, CLASS_OF[diagnosis.kind], diagnosis.kind, `${job.label}:${diagnosis.signature}`),
        job: job.label,
        stage: diagnosis.stage,
        state: diagnosis.kind,
        file: diagnosis.file,
        evidence: diagnosis.evidence,
        ...ageOf(window),
        window
      });
    }
  }

  // --- Class 1: tests. Aggregated across the main job and the environment matrix, because one
  // broken test showing up in five environments is one incident, not five. The per-job rows are
  // kept alongside the aggregate: the envs merge, the build histories cannot (see regressionWindow).
  const rows = new Map();
  for (const job of jobs) {
    for (const [id, row] of await testHistory(job, args)) {
      if (!rows.has(id)) rows.set(id, { id, perJob: [], failedEnvs: new Set(), ranEnvs: new Set(), detail: '' });
      const aggregate = rows.get(id);
      aggregate.perJob.push(row);
      for (const env of row.failedEnvs) aggregate.failedEnvs.add(env);
      for (const env of row.ranEnvs) aggregate.ranEnvs.add(env);
      if (!aggregate.detail) aggregate.detail = row.detail;
    }
  }

  const breakages = [];
  const flickering = [];
  for (const [id, row] of rows) {
    const verdict = verdictOf(row);
    // The job that saw it break first owns the window: it is the one whose build revisions bound
    // the change that caused it.
    const window = row.perJob.map(regressionWindow)
      .reduce((oldest, current) => (current.firstBad.timestamp < oldest.firstBad.timestamp ? current : oldest));
    // Intermittent *is* the definition of a flicker: it passes sometimes. A single-environment
    // failure needs the evidence threshold instead — recurring across builds and days — before it
    // may be called one. Systematic is never a flicker, however often it has recurred; nor is a
    // whole class failing to set up (`initializationError`), which hides every test of its module.
    const flickers = !isPseudoTest(id)
      && (verdict === 'intermittent' || (verdict === 'single env' && flickerProven(row)));
    if (flickers) {
      const jira = flickerFor(id);
      const jiraClosed = jira ? null : closedFlickerFor(id);
      const failedBuilds = row.perJob.reduce((n, job) => n + job.failedBuilds.length, 0);
      const seenBuilds = row.perJob.reduce((n, job) => n + job.seenBuilds.length, 0);
      flickering.push({ row, incident: {
        ...base(target, 1, 'flicker', id),
        state: verdict,
        tests: [id],
        evidence: [row.detail || '(no error detail)'],
        failedIn: `${failedBuilds}/${seenBuilds} builds, ${row.failedEnvs.size}/${row.ranEnvs.size} envs`,
        // The same ratio as a number, for the one decision that has to compare two flickers: which
        // of them to stabilise first (the stabilisation pick below).
        failRatio: seenBuilds ? failedBuilds / seenBuilds : 0,
        // *Which* environments, not only how many: "fails on the two MySQL rows and passes on the
        // PostgreSQL ones" is a diagnosis, while "2/4 envs" is a statistic — and the matrix is the
        // only place that distinction can be read.
        envs: [...row.failedEnvs].map(env => env.replace(/^env-tests\//, '')),
        failingJobs: [...new Set(row.perJob.map(entry => entry.job))],
        jira,
        jiraClosed,
        proven: flickerProven(row),
        ...ageOf(window),
        window,
        blame: { tier: 'none', reason: 'a flicker rarely has a culprit commit', suspects: [] }
      } });
    } else {
      breakages.push({ id, row, window, verdict, pseudo: isPseudoTest(id) });
    }
  }

  incidents.push(...cofailing(flickering));

  // Tests that started failing in the same build broke together, and one cause deserves one
  // incident and one comment — never forty.
  const groups = new Map();
  for (const entry of breakages) {
    // Namespaced by job, since the two jobs number their builds independently.
    const key = `${entry.window.job}#${entry.window.firstBad.number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [, group] of groups) {
    const ids = group.map(entry => entry.id).sort();
    const window = group[0].window;
    const infra = infraInDetail(group.map(entry => entry.row.detail));
    if (infra) {
      // Reclassified, not just relabelled: an infra event has no culprit commit, so this also
      // stops the whole deep-treatment budget being spent looking for one.
      incidents.push({
        ...base(target, 3, 'infra', `${window.job}:${infra}`),
        state: infra,
        tests: ids,
        testCount: ids.length,
        evidence: [`${ids.length} test(s)/module(s) failed with: ${group[0].row.detail}`],
        ...ageOf(window),
        window,
        blame: { tier: 'none', reason: 'an infrastructure failure has no culprit commit', suspects: [] }
      });
      continue;
    }
    const groupJira = flickerFor(ids[0]);
    incidents.push({
      // The smallest test id names the group: stable from day to day, unlike a count or a hash,
      // which would change the moment the breakage spreads by one test and re-ping everybody.
      ...base(target, 1, 'test-breakage', ids[0]),
      // The weakest evidence in the group governs the wording: "first seen" must not be reported
      // as "systematic" just because it shares a build with something that is.
      state: group.some(entry => entry.verdict === 'systematic') && group.every(entry => entry.verdict !== 'first seen')
        ? 'systematic' : group[0].verdict,
      tests: ids,
      testCount: ids.length,
      setupFailures: group.filter(entry => entry.pseudo).map(entry => entry.id),
      evidence: group.slice(0, 3).map(entry => `${entry.id}: ${entry.row.detail || '(no error detail)'}`),
      failingJobs: [...new Set(group.flatMap(entry => entry.row.perJob.map(row => row.job)))],
      jira: groupJira,
      jiraClosed: groupJira ? null : closedFlickerFor(ids[0]),
      ...ageOf(window),
      window
    });
  }
  return incidents;
}

// Which numbered failure class each diagnosis belongs to (see SKILL.md).
const CLASS_OF = { infra: 3, 'build-break': 2, timeout: 4, unclassified: 2 };

const base = (target, failureClass, kind, signature) => ({
  id: incidentId(target, signature),
  repo: target.repo,
  branch: target.branch,
  branchClass: target.branchClass,
  alerting: target.alerting,
  class: failureClass,
  kind,
  signature
});

const ageOf = window => ({
  firstBadBuild: window.firstBad?.number ?? null,
  buildUrl: window.jobUrl && window.firstBad ? `${window.jobUrl}/${window.firstBad.number}` : null,
  lastGoodBuild: window.lastGood?.number ?? null,
  ageDays: window.firstBad ? daysSince(window.firstBad.timestamp) : null,
  ageIsLowerBound: window.atLeast,
  maskedBy: window.masked,
  unreadBack: window.unread || undefined
});

// ---- Blame + dedupe pass ---------------------------------------------------------------------

/**
 * Attribution and the "did we already say this?" check, for the incidents that earned the budget.
 *
 * Beyond the horizon nothing is attributed: feedback is only feedback while it is actionable, and
 * a fortnight-old breakage is archaeology the team already knows about. It also bounds the blast
 * radius on day one, when the branch has been red for weeks.
 */
export async function investigate(incident, job, args) {
  if (incident.blame) return;
  if (incident.kind === 'timeout') {
    incident.blame = { tier: 'none', reason: 'a stage that ran out of time has no single culprit', suspects: [] };
    return;
  }
  if (incident.beyondHorizon) {
    incident.blame = {
      tier: 'none', suspects: [],
      reason: `older than the ${args.horizon}-day horizon: nothing is written, and its start is older than `
        + 'what Jenkins retains — references/deep-analysis.md dates it from Develocity'
    };
    return;
  }
  if (!args.github || !token) {
    incident.blame = { tier: 'unknown', reason: 'no GitHub token: blame unavailable', suspects: [] };
    return;
  }
  // An open flicker issue means the team has already seen this test fail and decided it flickers.
  // Attributing today's occurrence to whoever last touched the area would ping someone for a fault
  // that is known not to be theirs. The exception is a *systematic* failure, where the evidence
  // outranks the issue: the test now fails every time, so the issue no longer describes it.
  if (incident.jira && incident.state !== 'systematic') {
    incident.blame = {
      tier: 'none', suspects: [],
      reason: `already tracked as a known flicker (${incident.jira.key}) — reported, nobody pinged`
    };
    return;
  }
  // A *closed* flicker issue is the same history: the likeliest explanation is that it still
  // flickers, not that today's commits broke it.
  if (incident.jiraClosed && incident.state !== 'systematic') {
    incident.blame = {
      tier: 'none', suspects: [],
      reason: `flickered before (${[incident.jiraClosed.key, ...(incident.jiraClosed.earlier || [])].join(', ')}) `
        + 'and is not failing every build — reported, nobody pinged'
    };
    return;
  }
  // `single env` passed in some of the builds examined: a commit does not break a test some of the
  // time.
  if (incident.class === 1 && incident.state === 'single env') {
    incident.blame = {
      tier: 'none', suspects: [],
      reason: 'passes in some builds of its one environment — not a breakage yet, nobody pinged'
    };
    return;
  }
  // A quality gate fails on aggregate coverage and issue counts over the whole project, not on a
  // change — so file overlap has nothing to overlap and the five commits in the window are five
  // people named under a failure none of them can be shown to have caused. There *is* an author —
  // SonarCloud carries the file, the line and the SCM author of every new-code issue under the
  // failing condition — but it is found there and not here, which is what references/quality-gate.md sends the
  // report to do.
  if (/sonar-gate:failed$/.test(incident.signature || '')) {
    incident.blame = {
      tier: 'none', suspects: [],
      reason: 'a quality gate fails on aggregate metrics, not on one change — `sonar.culprits` '
        + 'names the authors of the code under the failing condition instead'
    };
    return;
  }
  if (incident.class === 1 && incident.window && !incident.window.lastGood) {
    incident.window = await deeperTestWindow(incident, job, args);
    Object.assign(incident, ageOf(incident.window));
    // The horizon was checked against the shallow window's age, a lower bound: the deeper one can
    // date the breakage past it, and then it gets no write either.
    incident.beyondHorizon = incident.ageDays != null && incident.ageDays > args.horizon;
    if (incident.beyondHorizon) {
      incident.blame = { tier: 'none', reason: `older than the ${args.horizon}-day horizon`, suspects: [] };
      return;
    }
  }
  const { firstBad, lastGood } = incident.window || {};
  if (!firstBad || !lastGood) {
    incident.blame = { tier: 'ambiguous', reason: 'no green build in the fetched history', suspects: [] };
    return;
  }
  try {
    const headSha = await buildRevision(`${job.url}/${firstBad.number}`, incident.repo);
    const baseSha = await buildRevision(`${job.url}/${lastGood.number}`, incident.repo);
    if (!headSha || !baseSha || headSha === baseSha) {
      incident.blame = { tier: 'ambiguous', reason: 'the two builds ran the same revision', suspects: [] };
      return;
    }
    const commits = await commitsBetween(incident.repo, baseSha, headSha);
    incident.window.baseSha = baseSha;
    incident.window.headSha = headSha;
    incident.blame = attribute(incident, commits);
    if (incident.blame.culprit) {
      incident.notified = await priorComment(incident.repo, incident.blame.culprit.sha, incident.id);
      // A flicker that has become systematic is news, whatever was said about it before.
      incident.silent = !!incident.notified && incident.notified.state === incident.state;
    }
  } catch (error) {
    incident.blame = { tier: 'unknown', reason: `attribution failed: ${error.message}`, suspects: [] };
  }
}

/**
 * The regression window of a deep test breakage, walked back past `--history` to its last green.
 *
 * Eight builds rate a flicker well and blame a breakage badly: master builds three or four times a
 * day, so a test broken for two days had no green build left and came back `ambiguous` — nobody
 * told, nobody to assign a fix to. Builds where none of the tests ran are skipped, as in
 * `testHistory`.
 *
 * @returns {object} the deepened window, or the sweep's own when the walk finds no green build
 */
async function deeperTestWindow(incident, job, args) {
  const { window } = incident;
  if (!incident.tests?.length || !window.firstBad || args.blameHistory <= args.history) return window;
  const builds = (await buildSummaries(job.url, args.blameHistory))
    .filter(build => !build.building && build.result && build.totalCount != null);
  const start = builds.findIndex(build => build.number === window.firstBad.number);
  if (start < 0) return window;
  let firstBad = builds[start];
  for (const build of builds.slice(start + 1)) {
    const { ran, failed } = await outcomesOf(`${job.url}/${build.number}`);
    const present = incident.tests.filter(id => ran.has(id));
    if (!present.length) continue;
    if (present.every(id => !failed.has(id))) return { ...window, firstBad, lastGood: build, atLeast: false };
    firstBad = build;
  }
  return { ...window, firstBad, atLeast: true };
}

// ---- Budget ----------------------------------------------------------------------------------
// A ceiling, not a target: everything below the line is still reported, just without root-cause
// analysis. Ordered by what blocks the most people first, and — for the top entry — by what is
// also cheapest to attribute, since a build break names the file it broke.

export function severity(incident) {
  const onMaintained = incident.branchClass !== 'transient';
  if (!onMaintained) return 6;
  // Out of scope for v1: detected and reported honestly, but it gets no root-cause budget.
  if (incident.kind === 'timeout') return 5.5;
  // Below a plain breakage in the *analysis* budget, and nothing to do with how urgent it is: what
  // a gate failed on is in SonarCloud, not in the Jenkins log this budget pays to read, and the fix
  // belongs to `xwiki-fix-sonarqube-issue`. It is still the run's first fix (SKILL.md §5) and a
  // release blocker; it just must not hold a root-cause slot a breakage could use.
  if (/sonar-gate:failed$/.test(incident.signature || '')) return 2.75;
  if (incident.class === 2) return 1;
  // A test the team has triaged as a flicker that now fails *every* time is either a real
  // regression or a stale triage, and it is the one case §4 has an explicit rule for. Budget
  // pressure must not be able to hide it behind plain breakages.
  if (incident.class === 1 && incident.state === 'systematic' && incident.jira) return 1.5;
  if (incident.class === 1 && incident.kind === 'test-breakage') return 2;
  if (incident.class === 5) return 3;
  // Tests failing in exactly the same builds are one cause the per-test issues never looked at as
  // one, so they rank above any single flicker, tracked or not.
  if (incident.cofailing) return 3.5;
  if (incident.class === 1 && incident.kind === 'flicker' && !incident.jira) return 4;
  if (incident.class === 3) return 5;
  return 5.5;
}
