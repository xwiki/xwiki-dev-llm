#!/usr/bin/env node
/*
 * Sweeps the CI jobs of every maintained XWiki branch and emits a pre-digested JSON work order:
 * one entry per *incident* — a distinct cause, not a distinct symptom — already classified, aged,
 * attributed to a commit and checked against what was said about it last time.
 *
 * Read-only by construction: it talks to ci.xwiki.org, jira.xwiki.org and the GitHub read API and
 * writes nothing anywhere. Everything this tool decides is deterministic, so it costs no model
 * tokens; the judgement calls — root-causing, wording a message to a human, writing a fix — are
 * the SKILL.md's, and the writes are the writer tools'. See skills/xwiki-ci-check/SKILL.md.
 *
 * The output is deliberately small: matched error lines, candidate commits and ages, never a
 * console log and never a full test report. That is what keeps a bad morning a 5k-token run.
 *
 * This file is the command line and the run, in the order the run does things; what each step
 * knows is in `lib/`: `logs` (a red build's own log), `sweep` (jobs, incidents, blame, budget),
 * `blame`, `github`, `fix-signals` (what may already answer an incident), `room`, `policy`
 * (branches) and `render` (paste, grid, delta, digest). Their unit tests are under `tests/` at the
 * repository root, which the plugin does not ship.
 */

import { closedFlickers, knownFlickers } from '../../../scripts/jira-flickers.mjs';
import { develocityFacts } from './dv-test-history.mjs';
import { gateFacts, nameAuthors } from './sonar-gate.mjs';
import { recallable } from './memory.mjs';
import { readFileSync } from 'node:fs';
import { blameKeys, names, sameBuildPeer } from './lib/blame.mjs';
import { fixedElsewhere, forwardFix, inFlightFix, infraSnapshotGap, staleSnapshot } from './lib/fix-signals.mjs';
import { github, priorComment, priorPrComment, token, tokenFallback } from './lib/github.mjs';
import { basename } from './lib/logs.mjs';
import { branchRank } from './lib/policy.mjs';
import {
  FIX_HEAD, deltaOf, fixName, isGate, publicView, renderDetail, renderDigest, securityOnly, stateLine, unreleasable
} from './lib/render.mjs';
import { chatClaim, chatOf, issueClaim, memoryOfArgs, mentionsOf } from './lib/room.mjs';
import { discover, incidentsOf, investigate, jobHistory, oneKindPerCause, severity } from './lib/sweep.mjs';
import { DAY, daysSince, plural, settled } from './lib/util.mjs';

const USAGE = `Usage: node ci-check.mjs [options]

  --repos <a,b,c>     Repos to sweep (default: xwiki-commons,xwiki-rendering,xwiki-platform)
  --branch <name>     Only this branch (default: every master/stable-* branch Jenkins has)
  --horizon <days>    Blame horizon: no write is proposed for an older incident (default 7)
  --budget <n>        Incidents marked for deep treatment (default 5)
  --history <n>       Builds of history to age and rate a failure over (default 8)
  --blame-history <n> Builds a deep test breakage with no green build in --history is walked back
                      over to find one to blame from (default 25, about what Jenkins retains)
  --absence <days>    Days without a build that make a dev/LTS branch an incident (default 3)
  --max-console <n>   Consecutive broken builds whose log is read, per job (default 4)
  --no-github         Skip blame attribution and the "already commented?" check
  --no-develocity     Skip the Develocity history of deep class-1 incidents (one call each)
  --rehearse-stabilise Pick the stabilisation candidate even past an open release blocker, so the
                      dry run can exercise references/stabilise.md. Marks the work order a
                      rehearsal: commit-comment.mjs and pull-request.mjs refuse --write from it.
  --full              Emit every field of every incident (debugging; the default is digested)
  --pretty            Human-readable summary instead of the JSON work order
  --render-detail <f> Render the paste body from a work order written earlier ('-' for stdin),
                      instead of sweeping. Add --live to drop the "dry run" header, and
                      --proof-ran once a run of summary.stabilise.prove started (references/prove.md).
  --delta <f>         Classify the incidents of a work order ('-' for stdin) against the state the
                      last digest carried, instead of sweeping. NEW / CHANGED / FIXED / SAME, the
                      repo × branch status grid, and the state for the next run. Reads yesterday's
                      with --previous.
  --render-digest <f> Render the Matrix digest from a work order ('-' for stdin) against --previous,
                      instead of sweeping: the grid, the rows, their order and links, with a marker
                      for what only the run knows. --paste <url> fills the paste link.
  --previous <f>      What matrix.mjs --last-state printed (default: an unknown yesterday).
  --chat <f>          What matrix.mjs --since printed ('-' for stdin): the room's messages since
                      the last digest. They can only ever buy an incident silence, never raise one.
  --memory <f>        What matrix.mjs --last-memory printed: what the last runs concluded. An
                      incident analysed in the last two days and unchanged since is recalled, not
                      re-analysed, and its deep slot goes to the next one.

Reads GitHub through GH_TOKEN_BOT (or GITHUB_TOKEN / GH_TOKEN — reads are identity-neutral).
Without one, blame and comment-dedupe are unavailable and every incident comes back tier "unknown".
`;

function parseArgs(argv) {
  const out = {
    repos: ['xwiki-commons', 'xwiki-rendering', 'xwiki-platform'], branch: null, horizon: 7,
    budget: 5, history: 8, blameHistory: 25, absence: 3, maxConsole: 4, github: true, develocity: true,
    full: false, pretty: false, rehearseStabilise: false,
    renderDetail: null, live: false, delta: null, previous: null, chat: null, memory: null, renderDigest: null,
    paste: null
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--repos') out.repos = argv[++i].split(',').filter(Boolean);
    else if (key === '--branch') out.branch = argv[++i];
    else if (key === '--horizon') out.horizon = Number(argv[++i]);
    else if (key === '--budget') out.budget = Number(argv[++i]);
    else if (key === '--history') out.history = Number(argv[++i]);
    else if (key === '--blame-history') out.blameHistory = Number(argv[++i]);
    else if (key === '--absence') out.absence = Number(argv[++i]);
    else if (key === '--max-console') out.maxConsole = Number(argv[++i]);
    else if (key === '--no-github') out.github = false;
    else if (key === '--no-develocity') out.develocity = false;
    else if (key === '--rehearse-stabilise') out.rehearseStabilise = true;
    else if (key === '--full') out.full = true;
    else if (key === '--pretty') out.pretty = true;
    else if (key === '--render-detail') out.renderDetail = argv[++i];
    else if (key === '--delta') out.delta = argv[++i];
    else if (key === '--render-digest') out.renderDigest = argv[++i];
    else if (key === '--paste') out.paste = argv[++i];
    else if (key === '--previous') out.previous = argv[++i];
    else if (key === '--chat') out.chat = argv[++i];
    else if (key === '--memory') out.memory = argv[++i];
    else if (key === '--live') out.live = true;
    else if (key === '--proof-ran') out.proofRan = true;
    else if (key === '--help' || key === '-h') out.help = true;
    else { console.error(`Unknown argument [${key}]\n\n${USAGE}`); process.exit(2); }
  }
  return out;
}


// ---- Run -------------------------------------------------------------------------------------

// stdout is asynchronous on a pipe (macOS): process.exit() right after a write cuts off whatever the
// reader has not drained yet, so exit from the callback of a write queued behind it instead.
const exitAfterOutput = code => new Promise(() => process.stdout.write('', () => process.exit(code)));

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  await exitAfterOutput(0);
}

// Rendering reads a work order and sweeps nothing, so the paste can be re-rendered — after a fix to
// the wording, or on another machine — without a second pass over Jenkins.
if (args.renderDetail) {
  const source = readFileSync(args.renderDetail === '-' ? 0 : args.renderDetail, 'utf8');
  console.log(renderDetail(JSON.parse(source), args));
  await exitAfterOutput(0);
}

// The delta reads two files and no server, so yesterday's comparison can be redone — after a fix
// to the classification, or on another machine — without a second pass over Jenkins either.
if (args.delta || args.renderDigest) {
  const report = publicView(JSON.parse(readFileSync((args.delta || args.renderDigest) === '-' ? 0 : args.delta || args.renderDigest, 'utf8')));
  const previous = args.previous ? JSON.parse(readFileSync(args.previous, 'utf8')) : { available: false };
  console.log(args.delta ? JSON.stringify(deltaOf(report, previous), null, 2) : renderDigest(report, previous, args));
  await exitAfterOutput(0);
}

const flickerFor = await knownFlickers();
// The *closed* flicker issues, looked up the same way. A hit is never a reason to stay quiet — it is
// the run's most actionable finding, because somebody has already written the fix. Which of the two
// readings applies is settled by comparing the issue's `fixVersions` with the branch that is red
// (references/fix-signals.md), and that comparison is the report's to make, not this tool's: encoding it here
// would turn a version-numbering guess into an assertion that sends someone to do a backport.
const closedFlickerFor = await closedFlickers().catch(() => () => null);
// Read before the sweep, and read from a file: the sweep itself holds no Matrix credential and must
// stay runnable on a laptop with nothing configured, where `chat.messages` is simply empty.
const chat = chatOf(args);
const targets = await discover(args.repos, args.branch);

const byId = new Map();
const jobsById = new Map();
// Both jobs of the target, for the passes that compare one against the other.
const targetJobs = new Map();
for (const target of targets) {
  const jobs = await Promise.all(target.jobs.map(job => jobHistory(job, args.history)));
  for (const incident of await incidentsOf(target, args, flickerFor, closedFlickerFor)) {
    incident.beyondHorizon = incident.ageDays != null && incident.ageDays > args.horizon;
    // The id is what a comment marker carries, so it has to be unique: two incidents sharing one
    // would share a marker, and the first of them to be commented on would silence the other for
    // good. The same signature twice means the same cause seen in two regression windows — one
    // incident, dated from the older of the two.
    const existing = byId.get(incident.id);
    if (existing) {
      existing.tests = [...new Set([...(existing.tests || []), ...(incident.tests || [])])];
      if (existing.testCount != null) existing.testCount = existing.tests.length;
      if ((incident.ageDays ?? -1) > (existing.ageDays ?? -1)) {
        Object.assign(existing, {
          ageDays: incident.ageDays, ageIsLowerBound: incident.ageIsLowerBound,
          firstBadBuild: incident.firstBadBuild, lastGoodBuild: incident.lastGoodBuild,
          window: incident.window, beyondHorizon: incident.beyondHorizon
        });
      }
      continue;
    }
    byId.set(incident.id, incident);
    // Every incident of a target shares its jobs; blame reads the one it came from, or the main one.
    const label = incident.window?.job || incident.job || 'main';
    jobsById.set(incident.id, jobs.find(job => job.label === label) || jobs[0]);
    targetJobs.set(incident.id, jobs);
  }
}
const incidents = [...byId.values()];

// Two views a per-incident walk cannot produce, both about not saying the same thing four times.
//
// A signature is branch-independent by construction — only the incident *id* is branch-scoped — so
// one break reaching master and three stable branches is one cause seen four times. `alsoOn` names
// the other branches; `primary` marks the single incident of the group that carries the analysis,
// the comment and the paste's paragraph. Four analyses of one cause spend four of the five deep
// slots to reach the same conclusion, and four comments ping one person four times for one mistake.
const sameCause = new Map();
for (const incident of incidents) {
  if (!incident.signature) continue;
  // Keyed by repo as well as by signature: `main:Build/enforcer:rule-failed` is how an enforcer
  // break signs itself in every repo there is, and commons' break is not platform's.
  const cause = `${incident.repo}\u0000${incident.signature}`;
  sameCause.set(cause, [...(sameCause.get(cause) || []), incident]);
}
for (const group of sameCause.values()) {
  if (group.length < 2) continue;
  // master first, then the newest maintained branch, then whichever saw it first: a fix is written
  // where development is, so that is the branch whose commit a reader can act on.
  group.sort((a, b) => branchRank(a.branch) - branchRank(b.branch) || (b.ageDays ?? -1) - (a.ageDays ?? -1));
  oneKindPerCause(group);
  for (const [index, incident] of group.entries()) {
    incident.alsoOn = group.filter(other => other !== incident).map(other => other.branch);
    incident.crossBranch = 'also-red';
    incident.primary = index === 0;
    if (index) {
      incident.blame ??= {
        tier: 'none',
        suspects: [],
        reason: `the same signature is red on ${group[0].branch} and analysed there — one cause, one analysis`
      };
    }
  }
}
// Before the budget is allocated, not after: an incident whose fix has already landed must not
// spend a deep slot reaching a conclusion the branch already holds, and must not ping anyone.
for (const incident of incidents) {
  // The stale snapshot first, because it is the only one of the four that says the test was never
  // broken: where a build ran new test code against old jars *and* someone has since pushed a fix,
  // reporting the fix implies there was something to fix. Then a landed commit, then an open PR — a
  // commit will be judged by the next build, a PR is only somebody's intent. A fix on another
  // branch comes last: it is the only one where nobody has moved on *this* branch yet, so what it
  // buys is not silence about work in progress but the sha to hand to `xwiki-backport`.
  //
  // The two chat values sit where their evidence deserves. `announced` is second, behind the stale
  // snapshot alone, because it makes the same claim: the test was never broken by the commit it
  // would be pinned on, so everything after it would be analysis of a non-event. `being-handled` is
  // near the end, ahead only of the backport pass, because a sentence of intent is weaker evidence
  // than a landed commit and weaker than an open PR — where either of those exists it should be
  // what the reader is pointed at. `issueClaim` is the same claim made on the JIRA issue, which is
  // the other place people write it.
  incident.fixState = await staleSnapshot(incident, targetJobs.get(incident.id) || [], args)
    || chatClaim(incident, chat, 'announced')
    || await forwardFix(incident, jobsById.get(incident.id), args)
    || await inFlightFix(incident, args)
    || chatClaim(incident, chat, 'being-handled')
    || await issueClaim(incident)
    || await fixedElsewhere(incident, targets, args);
  if (incident.fixState?.kind === 'fixed-elsewhere') incident.crossBranch = 'fixed-elsewhere';
  // An Environment Tests setup failure while the jars lag the checkout: a fact for the analysis, never an answer.
  if (!incident.fixState) incident.snapshotGap = await infraSnapshotGap(incident, targetJobs.get(incident.id) || [], args) || undefined;
  // Where the room does not suppress, it still *informs*. A message naming this incident is the one
  // thing no dashboard can show — the root cause somebody already found, the issue they filed, the
  // person who owns it — so it is attached whatever the phrase matcher made of it, and the digest
  // cites it. This is data about the incident, never an instruction about what to do with it.
  incident.chat = mentionsOf(incident, chat).slice(-3);
  // A partial fix changes nothing about what is written: the tests it does not cover are still
  // broken, still attributable and still worth a comment. It is reported beside the incident, and
  // that is all it earns.
  if (!settled(incident)) continue;
  incident.blame = {
    tier: 'none', suspects: [],
    reason: `${FIX_HEAD[incident.fixState.kind].whole.toLowerCase()} by ` +
      `${fixName(incident.fixState)}, ${incident.fixState.where}`
  };
}

// `flickerGroup`: several methods of one test class flickering are one flaky suite, whatever branch
// each was seen on, and one issue listing them all. Neither the branch nor the build number is in
// the key — five issues for five methods of one nested suite, or three for three branches, is how
// an auto-filer is switched off in its first week.
//
// **After the answers, not before.** Filing an issue is a write, and §3's rule is that an incident
// something already answers earns no write of any kind — so a flicker somebody has just claimed in
// the room, or that an open PR names, must not still be printed under "issues to open". Computing
// the group first and the answer second is how the paste came to contradict its own rule, which the
// room pass makes an everyday case: a flicker is exactly what people claim in chat.
for (const incident of incidents) {
  if (incident.kind !== 'flicker' || !incident.proven || incident.jira || incident.beyondHorizon) continue;
  // On the incident that carries the cause, never on its peers: they are its branch list, and a
  // peer flickering under a primary that fails every build belongs to a test that is broken, not
  // flaky — its issue is the breakage's comment, not a flicker issue (references/flicker-issues.md).
  if (incident.primary === false) continue;
  // A *closed* issue for this exact test is still an issue. Filing a second one for a flicker the
  // team already tracked and fixed is the duplicate that discredits an auto-filer fastest, and the
  // answer §5 gives is to comment on that issue rather than open a new one.
  if (incident.jiraClosed) continue;
  if (settled(incident)) continue;
  incident.flickerGroup = `${incident.repo}/${incident.signature.split('#')[0].split(/[.$]/).pop()}`;
}

incidents.sort((a, b) => severity(a) - severity(b) || (b.testCount || 1) - (a.testCount || 1));
// Beyond the horizon nothing may be written, so spending root-cause budget there buys nothing:
// those incidents are aggregated into one digest line and that is all.
// A failing quality gate takes the first slot: it is the run's first fix (§5), costs no log
// reading, and only a deep incident carries the blame its commit comment needs.
const gateFirst = incident => (/sonar-gate:failed$/.test(incident.signature || '') ? 0 : 1);
// What an earlier morning concluded about an incident that has not changed since is reused, not
// re-derived — and its slot goes to the next incident, which otherwise starved below the budget
// every morning, behind the same five (PDFExportIT#pageRevision, 2026-10-11..14). A conclusion
// older than two days is re-examined: facts move, and a recalled answer must not outlive them.
const memory = memoryOfArgs(args);
const today = new Date().toISOString().slice(0, 10);
for (const incident of incidents) {
  const entry = memory[incident.id];
  // When the run last spent its stabilisation slot proving this one's culprit (§5): once a week at most.
  incident.provedOn = entry?.proved;
  // Except a release blocker whose culprit has been asked: whether anyone answered is the news, and
  // only an investigation reads the commit's thread (2026-10-18, a6747deb54 asked and never answered).
  // A paste from before `asked` says it in its rendered Next cell instead.
  const wasAsked = entry?.asked || /^(done → (already commented|asked)|bot → \[commented\])/m.test(entry?.next || '');
  if (wasAsked && unreleasable(incident)) continue;
  if (incident.primary !== false && !settled(incident) && recallable(entry, stateLine(incident), today)) {
    incident.recalled = { analysedOn: entry.analysedOn, why: entry.why, next: entry.next, analysis: entry.analysis };
  }
}
// Beyond the horizon nothing is *written*, but a break that is still there is still worth knowing
// the cause of: 16.10.x's ObjectEditorIT failed every Firefox run for four weeks and every morning
// said "counted, not written about". So a long-standing breakage — not a flicker, which is the
// stabilisation slot's — competes for what slots the recent incidents leave.
const longStanding = incident => incident.beyondHorizon && unreleasable(incident);
const deep = incidents.filter(incident => incident.alerting && (!incident.beyondHorizon || longStanding(incident))
  && !settled(incident) && incident.primary !== false && !incident.recalled)
  .sort((a, b) => Number(!!a.beyondHorizon) - Number(!!b.beyondHorizon) || gateFirst(a) - gateFirst(b))
  .slice(0, args.budget);
for (const incident of deep) {
  incident.deep = true;
  await investigate(incident, jobsById.get(incident.id), args);
}

// ---- Develocity: the 28 days Jenkins does not keep --------------------------------------------
//
// The sweep's own numbers are a statistic about one job's retained history — `1/7 builds, 1/4 envs`
// — and they are all Jenkins can give: it holds eight builds of one branch. Develocity holds every
// execution of that test for 28 days, on every branch, browser, database and servlet container,
// grouped by what actually failed, and says instead "6 failures in 347 executions, every one of
// them on Chrome (p=0.0008), and about 30 consecutive clean runs would be needed before a fix could
// be claimed". `dv-test-history` derives that (references/deep-analysis.md); this puts it in the work order, so the
// paste and the commit comment carry the facts whether or not a model ever runs, and so the model
// reports them instead of inferring them from one stage log.
//
// **It is also what makes `ageDays` honest.** That number is the current streak in the builds
// Jenkins still has; `develocity.firstSeen` is the day the failure actually started. A flicker
// whose streak is one build and whose first failure was three weeks ago did not come from a commit
// in tonight's window, and no amount of Jenkins history can say so.
//
// Deep class-1 incidents only — ~120 requests and ~10 s each — and off at the first refusal: no
// checkout, no `python3`, no key, no network, and the sweep carries on with what Jenkins gave it,
// which is the whole of its behaviour before this pass existed.
let develocityOff = args.develocity ? null : 'disabled with --no-develocity';
for (const incident of deep) {
  if (develocityOff || incident.class !== 1 || !incident.tests?.length) continue;
  // A class-level failure (`@AfterAll`, `@BeforeAll`) has no method to look up: SubWikiIT's teardown
  // came back "null failures in null executions" on 2026-10-19.
  if (incident.tests[0].endsWith('#')) continue;
  // The test that names the incident, and the incident's own error line so that a test failing two
  // different ways is described by the failure *this* incident is about.
  const facts = develocityFacts(incident.tests[0], { match: incident.evidence?.[0] });
  if (facts.unavailable) {
    develocityOff = facts.unavailable;
    process.stderr.write(`develocity history unavailable: ${facts.unavailable}\n`);
    continue;
  }
  incident.develocity = facts;
}

// ---- The quality gate: what failed it, and whose code is under it -----------------------------
//
// A gate failure is the one incident whose cause is not in Jenkins at all. The stage log says
// `QUALITY GATE STATUS: FAILED` and stops, so the blame pass has nothing to overlap and the window's
// commits are a list of people none of whom can be shown to have caused anything — which is how
// this came to be reported as authorless. It is not: SonarCloud holds the failing condition, the
// new-code issues under it, and for each the file, the line, the rule, the day it was raised and
// usually the SCM author of the line. This reads that, and then asks GitHub which commit last
// touched that file on the day the issue appeared.
//
// **Whose code, not who broke the build**, and the distinction is kept all the way into the paste:
// the gate turned red when an analysis ran, the code under it was written days earlier, and the
// author of a line is not automatically the author of a failure. So it lands in `sonar.culprits`
// and never in `blame` — it is named in the report, and nobody is pinged on the strength of it.
const GATE_RE = /sonar-gate:failed$/;
// How far back a commit may be and still be what raised an issue. The analysis runs nightly, so it
// sees a change within a day of the push; anything older was analysed already and passed.
const GATE_INTRO_DAYS = 2;
const gateCache = new Map();
let sonarOff = null;
for (const incident of incidents) {
  if (!GATE_RE.test(incident.signature || '') || incident.primary === false || sonarOff) continue;
  const key = `${incident.repo}/${incident.branch}`;
  if (!gateCache.has(key)) gateCache.set(key, await gateFacts(incident.repo, incident.branch));
  const facts = await gateCache.get(key);
  if (facts.unavailable) {
    sonarOff = facts.unavailable;
    process.stderr.write(`quality gate facts unavailable: ${facts.unavailable}\n`);
    continue;
  }
  // The newest issues only. The gate went red for the newest one; the rest are the backlog that
  // keeps it red, and naming twelve authors is naming nobody.
  const newest = facts.issues.slice(0, 4);
  for (const issue of newest) {
    if (!args.github || !issue.file || !issue.raisedOn) continue;
    // The commits that touched that file in the two days up to the analysis that raised the issue.
    // `until` is the end of that day — an analysis runs after the push it analyses, never before —
    // and the window is short on purpose: a nightly analysis sees a change within a day, so a file
    // with *no* commit in it did not have this issue introduced by a commit at all. That is the
    // new-rule-on-old-code case, and the honest answer there is that nobody caused it.
    const until = `${issue.raisedOn}T23:59:59Z`;
    const since = new Date(`${issue.raisedOn}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - (GATE_INTRO_DAYS - 1));
    const path = `/repos/xwiki/${incident.repo}/commits?sha=${encodeURIComponent(incident.branch)}` +
      `&path=${encodeURIComponent(issue.file)}&since=${since.toISOString()}&until=${until}&per_page=10`;
    try {
      const commits = (await github(path)) || [];
      issue.commits = commits.filter(commit => (commit.parents || []).length < 2).map(commit => ({
        sha: commit.sha,
        short: commit.sha.slice(0, 10),
        author: commit.author?.login || commit.commit?.author?.name || null,
        // Only to turn SonarCloud's address for the line into this login; `nameAuthors` drops it.
        email: commit.commit?.author?.email || null,
        title: (commit.commit?.message || '').split('\n')[0].slice(0, 100),
        date: (commit.commit?.author?.date || '').slice(0, 10),
        url: commit.html_url
      }));
      issue.commit = issue.commits[0];
    } catch {
      // A path lookup that fails costs the issue its commit and nothing else: the file, the line
      // and the Sonar author are already the answer to "who", and the sha was the convenience.
    }
  }
  // One name per person, with what each of them is on the hook for. `author` is Sonar's line
  // author, by now a GitHub login (`nameAuthors`: an address never leaves this tool), and
  // `commit.author` is the GitHub account that last touched the file — the same person by two
  // routes when they agree, and two candidates worth printing when they do not.
  nameAuthors(newest);
  const by = new Map();
  for (const issue of newest) {
    // Sonar's author is the author of the *line*, which is the closer claim; the commit is only the
    // last one to touch that file by the day the issue appeared, and on a file several people edit
    // that is somebody else. So the commit fills in when there is no line author, and is printed
    // beside the name rather than counted as a second one.
    const who = issue.author || issue.commit?.author;
    if (!who) continue;
    const entry = by.get(who) || { who, issues: 0, files: new Set(), commits: new Set() };
    entry.issues++;
    entry.files.add(issue.file.split('/').pop());
    if (issue.commit) entry.commits.add(issue.commit.short);
    by.set(who, entry);
  }
  incident.sonar = {
    ...facts,
    issues: newest,
    culprits: [...by.values()].sort((a, b) => b.issues - a.issues).slice(0, 4)
      .map(entry => ({ who: entry.who, issues: entry.issues,
        files: [...entry.files].slice(0, 3), commits: [...entry.commits].slice(0, 3) }))
  };
  await gateCulprit(incident, newest, args);
}

/**
 * When one person, and only one, put the code under the failing condition there, say it to them.
 *
 * Unequivocal means exactly that, and both routes have to agree: every commit that touched any of
 * the gate-causing files in the two days before the analysis is by **one** author, and SonarCloud
 * attributes the lines to at most one person. Two names anywhere — two people's changes both under
 * the gate, or a line author who is not the committer — and the incident keeps its `none` blame and
 * is reported to the room instead. That asymmetry is the same one the rest of this file lives by: a
 * missing comment costs a morning, a comment in the wrong person's name costs the system.
 *
 * A file with no commit in the window is not a vote for silence and not a vote for anyone: the
 * issue came from a new rule run over old code, and it takes no part in the decision.
 *
 * **The pull request first, then the commit.** These changes land squashed with their PR number in
 * the subject, and the PR is where the change was reviewed, where its author and its reviewer both
 * get the notification, and where a Sonar decoration would have been seen had it run in time. §4's
 * "the commit, never the PR" is about a test breakage days later; a gate issue belongs to a review.
 */
async function gateCulprit(incident, issues, args) {
  if (!args.github || !token || incident.beyondHorizon) return;
  const commits = issues.flatMap(issue => issue.commits || []);
  const authors = new Set(commits.map(commit => commit.author).filter(Boolean));
  const lineAuthors = new Set(issues.map(issue => issue.author).filter(Boolean));
  // A line author is the committer only when one of the window's commits carries their address
  // (`nameAuthors`); anyone else is a second person under the gate. A file with no commit in the
  // window takes no part, as above.
  const strangers = issues.filter(issue => issue.commits?.length
    && (issue.authorUnresolved || (issue.author && !authors.has(issue.author))));
  incident.sonar.unequivocal = authors.size === 1 && lineAuthors.size <= 1 && !strangers.length;
  if (!incident.sonar.unequivocal) {
    incident.sonar.equivocalBecause = authors.size === 0
      ? 'no commit touched these files in the two days before the analysis — a rule applied to existing code'
      : authors.size === 1
        ? 'SonarCloud attributes a line under the failing condition to someone other than the one committer'
          + ' — nobody is pinged for a gate two people could have caused'
        : `${authors.size} people touched the files under the failing condition`
          + `${lineAuthors.size > 1 ? `, and SonarCloud attributes the lines to ${lineAuthors.size} of them` : ''}`
          + ' — nobody is pinged for a gate two people could have caused';
    // The blame line and the gate block must not say different things about the same incident.
    incident.blame = { tier: 'none', suspects: [], reason: incident.sonar.equivocalBecause };
    return;
  }
  // The newest commit of the one author: the one that made the gate fail, where several of theirs
  // touch the same file.
  const [culprit] = [...commits].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  let target = { kind: 'commit', sha: culprit.sha, short: culprit.short, url: culprit.url };
  try {
    const [pull] = (await github(`/repos/xwiki/${incident.repo}/commits/${culprit.sha}/pulls`)) || [];
    if (pull) target = { kind: 'pr', number: pull.number, title: pull.title, url: pull.html_url, sha: culprit.sha, short: culprit.short };
  } catch {
    // No PR lookup, no PR: the commit is always a valid target and is what §4 would have used.
  }
  incident.sonar.target = target;
  incident.blame = {
    tier: 'likely',
    reason: `the only person who touched the files under the failing condition in the two days `
      + `before the analysis${[...lineAuthors].length ? `, and SonarCloud attributes the lines to `
      + `${[...lineAuthors][0]}` : ''}`,
    culprit: { ...culprit, files: issues.map(issue => issue.file) },
    suspects: []
  };
  // The commit too, for a PR: the gate's comment lands there when it shares that commit with
  // another incident (one comment per commit, see `oneCommentPerCommit`).
  incident.notified = (target.kind === 'pr' ? await priorPrComment(incident.repo, target.number, incident.id) : null)
    ?? await priorComment(incident.repo, culprit.sha, incident.id);
  incident.silent = !!incident.notified && incident.notified.state === incident.state;
}

// ---- Stabilisation: the one flicker this run may try to fix ------------------------------------
//
// The routine's headline act is a *fix*, not a report — but not at any cost and not at any moment.
// **What blocks a release comes first.** A compile break, a broken pom, a failing quality gate or a
// test that now fails in every build is red for everyone and a re-run does not clear it; a flicker
// costs whoever hit it a re-run and blocks nobody. So a run with any of the first open spends its
// attention there and proposes no stabilisation at all, and the paste says which incidents held it
// back. Ranking the other way round is how a routine comes to offer a flake fix on the morning
// master does not compile.
//
// **A build break is first however old it is** — a quality gate red for a fortnight is a fortnight
// of releases blocked, not furniture, and §5 sends the run's fix effort there. A *systematic test*
// breakage is capped by the horizon instead: beyond it nothing may be written about the incident at
// all, so it cannot be the thing the run works on instead.
const blocksRelease = incident => incident.alerting && incident.primary !== false && !settled(incident)
  && (incident.class === 2
    || (incident.class === 1 && incident.state === 'systematic' && !incident.beyondHorizon));

// What may be stabilised: a flicker the team has already triaged (`jira`), that has proven itself
// (two builds, two days), that nothing already answers, and that is inside the horizon — the same
// four brakes every other write here has. `systematic` is excluded twice over: it is a blocker
// above, and §4 says a "flicker" failing every time is a regression or a stale triage, not a flake.
// Never on a security-only line: it takes no ordinary fix, and a PR there would name it in public
// (okf/processes/release.md).
const securityOnlyLines = securityOnly(targets.map(target => target.branch));
const stabilisable = incident => incident.class === 1 && incident.kind === 'flicker' && incident.proven
  && incident.jira && !incident.fixState && incident.alerting && !incident.beyondHorizon
  && incident.primary !== false && incident.state !== 'systematic' && !securityOnlyLines.includes(incident.branch);

// A question asked on the culprit at least two mornings ago, and nobody has written in that thread
// since. The digest names who was asked (references/digest.md), and a blocker in that state is what
// the stabilisation slot proves instead of a flake (§5).
const UNANSWERED_HOURS = 36;
for (const incident of incidents) {
  const asked = incident.silent && incident.notified;
  if (asked && !asked.replies && Date.now() - Date.parse(asked.at) >= UNANSWERED_HOURS * 3600000) {
    incident.unanswered = { since: asked.at.slice(0, 10), url: asked.url, author: incident.blame?.culprit?.author || null };
  }
}

const blockers = incidents.filter(blocksRelease);
// A morning with a blocker open spends no slot on a flake — but the slot's hour is exactly what a
// functional test's proof costs, and an analysed breakage whose culprit is not answering is the one
// incident a proof moves: "could you check?" becomes a stated cause, or the suspicion is dropped.
const recentlyProved = incident => incident.provedOn
  && (Date.parse(today) - Date.parse(incident.provedOn)) / DAY < 7;
const proveCandidate = incident => incident.class === 1 && incident.deep && incident.unanswered
  && incident.blame?.culprit?.sha && incident.tests?.length && !recentlyProved(incident)
  && !securityOnlyLines.includes(incident.branch);
// Highest failure rate first: it costs the most re-runs, and its recent failures are the ones whose
// screenshot, video and logs Jenkins still holds — the evidence the investigation starts from.
const stabiliseCandidates = incidents.filter(stabilisable)
  .sort((a, b) => (b.failRatio || 0) - (a.failRatio || 0));
let stabilise = { skipped: 'no proven, filed, unanswered flicker inside the horizon' };
if (blockers.length && !args.rehearseStabilise) {
  stabilise = {
    skipped: `${plural(blockers.length, 'release-blocking incident')} open, and what blocks a `
      + `release comes first — a flicker costs a re-run and blocks nobody`,
    // All of them: the count above and the paste's header count every one, and a list cut at five
    // read as a contradiction of both.
    blockers: blockers.map(incident => incident.id)
  };
  const [proving] = blockers.filter(proveCandidate);
  if (proving) {
    proving.prove = true;
    const { culprit } = proving.blame;
    const configs = proving.develocity?.configs || [];
    // The cheapest place to prove it: the highest failure rate on any branch it is red on, since the
    // clean parent runs a proof needs fall with the rate. On 2026-10-19 the slot was offered master's
    // 14.1% (20 parent runs, more than the hour) and gave up, while 18.9.x failed 7 runs in 10 (3).
    const branches = [proving.branch, ...(proving.alsoOn || [])];
    const [best] = (proving.develocity?.rates || [])
      .filter(rate => rate.runs >= 5 && branches.some(branch => rate.name.startsWith(`${branch} /`)))
      .map(rate => ({ ...rate, r: rate.failures / rate.runs }))
      .sort((a, b) => b.r - a.r);
    stabilise.prove = {
      id: proving.id, test: proving.tests[0], sha: culprit.sha, short: culprit.short, author: culprit.author,
      asked: proving.unanswered.since,
      ...(best ? {
        configuration: best.name,
        branch: best.name.split(' /')[0],
        rate: `${best.failures}/${best.runs}`,
        parentRuns: best.r >= 1 ? 1 : Math.ceil(Math.log(0.05) / Math.log(1 - best.r))
      } : {
        configuration: configs.find(config => config.startsWith(`${proving.branch} /`)) || proving.envs?.[0] || configs[0] || null
      })
    };
  }
} else if (stabiliseCandidates.length) {
  const [pick] = stabiliseCandidates;
  pick.stabilise = true;
  // The configuration to reproduce on, the failure group and the archived screenshot and video come
  // from Develocity — so the candidate gets the history whether or not it won a deep slot. One extra
  // invocation, once per run, and only on the mornings nothing more urgent is open.
  if (!pick.develocity && !develocityOff && pick.tests?.length) {
    const facts = develocityFacts(pick.tests[0], { match: pick.evidence?.[0] });
    if (facts.unavailable) develocityOff = facts.unavailable;
    else pick.develocity = facts;
  }
  // The configuration the failure concentrates in *on this branch*: `develocity` counts the test
  // everywhere it runs, and its worst configuration may be another branch's.
  const configs = pick.develocity?.configs || [];
  stabilise = {
    id: pick.id, jira: pick.jira.key, failedIn: pick.failedIn,
    configuration: configs.find(config => config.startsWith(`${pick.branch} /`)) || pick.envs?.[0] || configs[0] || null,
    others: stabiliseCandidates.length - 1,
    // A rehearsal ignores the blockers so that stabilise.md can be exercised at all; it still names
    // them, and the work order it is in can never be written from.
    ...(args.rehearseStabilise ? { rehearsal: true, blockers: blockers.map(incident => incident.id) } : {})
  };
}

for (const incident of incidents) {
  incident.deep ??= false;
  incident.blame ??= { tier: 'none', reason: 'below the per-run budget: reported, not investigated', suspects: [] };
  delete incident.window?.firstBad;
  delete incident.window?.lastGood;
  incident.commentable = commentTarget(incident);
}
for (const incident of incidents.filter(entry => entry.prove)) {
  // Already asked in this state, so the only comment left is the proof: a new marker state, posted
  // once, and only with `--proof reproduced` (commit-comment.mjs refuses anything less).
  const { culprit, tier } = incident.blame;
  incident.commentable = { repo: incident.repo, state: `${incident.state}+reproduced`, tier, sha: culprit.sha,
    author: culprit.author || null, url: culprit.url, followUp: 'reproduced' };
}
oneCommentPerCommit(incidents);
for (const incident of incidents) incident.provable = provableTarget(incident);
sameBuildComment(incidents);

/**
 * A build break with no green build of its own goes in the comment of the test that first failed in
 * the same build of the same job (`sameBuildPeer`): one comment per commit (§4), carried by whichever
 * incident has a window. A `provable` peer hands its suspects to the break, which becomes the carrier,
 * because the break is the one the run reproduces.
 */
function sameBuildComment(all) {
  const jobOf = incident => incident.window?.job || incident.job || 'main';
  for (const incident of all) {
    const peer = sameBuildPeer(incident, all, jobOf);
    if (!peer) continue;
    if (peer.commentable) {
      peer.commentable.covers = [...(peer.commentable.covers || []), { id: incident.id, state: incident.state }];
      incident.commentedWith = peer.id;
    } else {
      incident.provable = { ...peer.provable, state: incident.state, sameBuildAs: peer.id,
        covers: [...(peer.provable.covers || []), { id: peer.id, state: peer.state }] };
      peer.provable = null;
      peer.commentedWith = incident.id;
    }
  }
}

/**
 * At most one comment per commit per run (§4): a gate whose PR squashed into the commit a build
 * break blames is one change, and two comments on it from one morning are one too many. The first
 * incident in severity order carries the comment, with every other one in `covers` — its marker
 * goes on that comment too, so tomorrow's run finds each of them already said — and the others
 * lose `commentable` and point at it with `commentedWith`. The commit is preferred over the PR as
 * the carrier's target, because every incident's "already said" lookup reads the commit.
 */
function oneCommentPerCommit(all) {
  const byCommit = new Map();
  for (const incident of all.filter(entry => entry.commentable?.sha)) {
    const key = `${incident.repo}\u0000${incident.commentable.sha}`;
    byCommit.set(key, [...(byCommit.get(key) || []), incident]);
  }
  for (const group of byCommit.values()) {
    if (group.length < 2) continue;
    const [carrier, ...rest] = group;
    const { pr, ...onCommit } = carrier.commentable;
    const commit = group.find(entry => !entry.commentable.pr)?.commentable;
    carrier.commentable = {
      ...(pr && commit ? { ...onCommit, url: commit.url } : carrier.commentable),
      covers: rest.map(entry => ({ id: entry.id, state: entry.state }))
    };
    for (const entry of rest) {
      entry.commentable = null;
      entry.commentedWith = carrier.id;
    }
  }
}

/**
 * Where §4 may comment on this incident, or null — SKILL.md §4's skip list, applied here so that it
 * is a field rather than a paragraph, and so that `commit-comment.mjs --work-order` can refuse any
 * other target. Null when something answers the whole incident, when it is the same cause seen on
 * another branch, when it was already said in this state, beyond the horizon, or without a
 * `certain`/`likely` culprit — and for a gate, without its one unequivocal author.
 *
 * A partial or an unconfirmed (`candidate`) answer leaves the incident live, as everywhere else
 * here; confirming a candidate is the model's (references/fix-signals.md), and a confirmed one
 * earns no comment.
 */
function commentTarget(incident) {
  if (settled(incident) || incident.primary === false || incident.silent || incident.beyondHorizon) return null;
  const at = { repo: incident.repo, state: incident.state, tier: incident.blame?.tier };
  if (isGate(incident)) {
    const target = incident.sonar?.unequivocal && incident.sonar.target;
    if (!target) return null;
    return target.kind === 'pr' ? { ...at, pr: target.number, sha: target.sha, url: target.url }
      : { ...at, sha: target.sha, url: target.url };
  }
  const { culprit, tier } = incident.blame || {};
  if (!culprit || !['certain', 'likely'].includes(tier)) return null;
  return { ...at, sha: culprit.sha, author: culprit.author || null, url: culprit.url };
}

/**
 * Where a comment may go once the model has *proven* a culprit the tool could not pick.
 *
 * File overlap is conservative by construction: two commits touching one module is `ambiguous`,
 * even when the failure names the very lines one of them wrote (2026-10-17, `xwiki-platform-node`:
 * the run reproduced the lint error on b565ea607d's lines, assigned its fix PR to its author, and
 * the digest still said "no owner found"). So a deep, unanswered, `ambiguous` incident lists the
 * suspects a proof may pick from — never anyone outside the window — and `commit-comment.mjs`
 * refuses a comment that does not name the proof it rests on (references/commit-comment.md).
 *
 * A `likely` pick is a file match too, and can be the wrong one: on 2026-10-22 the run proved
 * `in-diff` that 18958b0492 made the requiredrights ITs fail, while the tool had picked a CSS
 * change, and nobody was told. So such an incident lists the suspects as well, with `instead` naming
 * the pick a `reproduced` or `in-diff` proof may replace — unless its comment also answers other
 * incidents (`covers`), which blamed the pick and not the proven commit.
 */
function provableTarget(incident) {
  const pick = incident.commentable;
  const overridable = pick?.tier === 'likely' && !pick.followUp && !pick.pr && !pick.covers?.length;
  if (!incident.deep || (pick && !overridable) || incident.commentedWith || settled(incident)
    || incident.primary === false || incident.silent || incident.beyondHorizon || isGate(incident)) return null;
  if (!overridable && incident.blame?.tier !== 'ambiguous') return null;
  const suspects = (incident.blame.suspects || []).filter(commit => commit.author && commit.sha !== pick?.sha)
    .slice(0, 20).map(commit => ({ sha: commit.sha, short: commit.short, author: commit.author, url: commit.url }));
  if (!suspects.length) return null;
  return { repo: incident.repo, state: incident.state, suspects, ...(overridable ? { instead: pick.sha } : {}) };
}

const jobStatus = [];
for (const target of targets) {
  for (const job of await Promise.all(target.jobs.map(j => jobHistory(j, args.history)))) {
    const latest = job.builds[0];
    jobStatus.push({
      repo: target.repo, branch: target.branch, job: job.label, branchClass: target.branchClass,
      build: latest?.number ?? null, result: latest?.result ?? null,
      failed: latest?.failCount ?? null, age: latest ? daysSince(latest.timestamp) : null,
      url: latest ? `${job.url}/${latest.number}` : job.url
    });
  }
}

/**
 * The reference files this run's fields call for, each with the step it is read before.
 *
 * Every one of them is opened on a trigger — a field on some incident — and a trigger sentence in
 * SKILL.md is one a model can skim past; a list in the work order, naming the file and the moment,
 * is not. Only what the work order can see is here: whether a run is local (references/local-run.md)
 * or posts a digest (references/digest.md) is the mode's, and SKILL.md says so.
 */
function toRead(incidents, stabilise) {
  const live = incidents.filter(incident => incident.primary !== false && !incident.beyondHorizon);
  const read = {};
  const when = (test, file, why) => { if (test) read[`references/${file}`] = why; };
  when(incidents.some(incident => isGate(incident) && incident.primary !== false), 'quality-gate.md',
    'before the quality-gate row\'s cells, its comment or handing it to xwiki-fix-sonarqube-issue (§3)');
  when(live.some(incident => incident.deep), 'deep-analysis.md', 'before root-causing a deep incident (§3)');
  when(live.some(incident => incident.fixState?.candidate || incident.fixState?.kind === 'fixed-elsewhere'
    || incident.jiraClosed), 'fix-signals.md',
  'before the line or Next cell of a candidate fix-in-flight, a fixed-elsewhere or a jiraClosed incident (§3)');
  when(live.some(incident => incident.commentable || incident.provable), 'commit-comment.md',
    'before writing a commit comment, or proving a culprit the tool could not pick (§4)');
  when(live.some(incident => incident.deep && !settled(incident)), 'fix-prs.md', 'before preparing a fix PR (§5)');
  when(live.some(incident => incident.flickerGroup || incident.jiraClosed), 'flicker-issues.md',
    'before filing a flicker issue, or commenting on a closed one (§5)');
  when(stabilise.prove, 'prove.md', 'before running the prove incident\'s test at its culprit and its parent (§5)');
  when(stabilise.id, 'stabilise.md', 'before invoking xwiki-fix-flickering-docker-test for the stabilise incident (§5)');
  when(incidents.length, 'paste.md', 'before filling the paste\'s markers (§6)');
  return read;
}

/**
 * What the model is given.
 *
 * An incident inside the budget is handed everything needed to root-cause it; one below the line is
 * a single line, because it is going to be reported and not analysed. The difference is not
 * cosmetic — the untrimmed work order for one red morning is ~90 KB, most of it the file lists of
 * commits nobody is going to read, and spending that on context is the one cost this whole design
 * exists to avoid.
 */
function digest(incident, keys) {
  const compact = {
    id: incident.id, repo: incident.repo, branch: incident.branch, branchClass: incident.branchClass,
    class: incident.class, kind: incident.kind, state: incident.state,
    ageDays: incident.ageDays, ageIsLowerBound: incident.ageIsLowerBound,
    beyondHorizon: incident.beyondHorizon, testCount: incident.testCount ?? (incident.tests?.length || null),
    jira: incident.jira?.key || null, proven: incident.proven, deep: incident.deep,
    // Tests of one class failing in exactly the same builds: one cause, and every issue tracking a part of it.
    cofailing: incident.cofailing || undefined, jiras: incident.jiras,
    // §4's skip list, already applied: where a comment may go, or nothing.
    commentable: incident.commentable || undefined,
    // The suspects a proven culprit may be picked from, when the tool could pick none (§4).
    provable: incident.provable || undefined,
    // An earlier morning's conclusion, reused because nothing has changed since (§3).
    recalled: incident.recalled || undefined,
    // Its culprit was asked two mornings ago or more, and nobody has answered on the commit.
    unanswered: incident.unanswered,
    // The incident the stabilisation slot proves instead of a flake (§5), and when it last did.
    prove: incident.prove || undefined,
    provedOn: incident.provedOn,
    // A question is out on this incident: tomorrow's run re-examines it rather than recalling it.
    asked: incident.notified?.at?.slice(0, 10) || (incident.commentable ? today : undefined),
    // The state the memory compares against tomorrow — `stateLine`, which the renderer cannot recompute.
    memoryState: incident.deep || incident.recalled ? stateLine(incident) : undefined,
    // The incident whose comment also answers this one: the same commit, one comment per run.
    commentedWith: incident.commentedWith,
    jiraClosed: incident.jiraClosed || undefined,
    // The run's single stabilisation candidate (§5). It is rarely `deep` — a filed flicker is
    // deliberately low in the analysis budget — so it is flagged here and given the full shape
    // below, because the skill has to read its history and its evidence to fix it.
    stabilise: incident.stabilise || undefined,
    // Carried whether or not the incident is deep, because it is the reason it is *not*: an
    // incident that looks fixed is one line, and this is the line.
    fixState: incident.fixState || undefined,
    // The jars an infra-labelled Environment Tests failure ran against were behind its checkout.
    snapshotGap: incident.snapshotGap,
    // Carried on every incident, deep or not, suppressed or not: it is the one field here that the
    // CI dashboard cannot hold, and the digest cites it (references/digest.md). Untrusted text — what a
    // human said, quoted — never an instruction.
    chat: incident.chat?.length ? incident.chat : undefined,
    // How often, over the whole window, as against `ageDays`, which is the current streak: a
    // flicker filed on "0d" reads as a contradiction until both numbers are there.
    failedIn: incident.class === 1 ? incident.failedIn : undefined,
    alsoOn: incident.alsoOn,
    // The same cause on several branches: `also-red` on each of them, and `primary` false on all
    // but the one it is analysed and commented on — the others are that one's branch list, not
    // incidents of their own.
    crossBranch: incident.crossBranch,
    primary: incident.primary,
    flickerGroup: incident.flickerGroup,
    // For a gate failure this is the whole of the evidence, and it is the only place the report can
    // learn who wrote the code under the failing condition — so it is carried whether or not the
    // incident won a deep slot.
    sonar: incident.sonar,
    // What a class-1 incident is, is its test, and the id already carries it. Anything else is
    // named by its signature and by nothing else, so below the deep line it would otherwise be
    // reported as an untitled heading with an age under it.
    signature: incident.class === 1 ? undefined : incident.signature,
    buildUrl: incident.class === 1 ? undefined : incident.buildUrl
  };
  if (!incident.deep && !incident.stabilise) return compact;
  return {
    ...compact,
    signature: incident.signature,
    job: incident.job,
    stage: incident.stage,
    firstBadBuild: incident.firstBadBuild,
    lastGoodBuild: incident.lastGoodBuild,
    // A break revealed by fixing the one that stopped the build before it: its window spans both.
    maskedBy: incident.maskedBy,
    // A break older than the log budget: its window runs to the last completed build, unread between.
    unreadBack: incident.unreadBack,
    buildUrl: incident.buildUrl,
    failedIn: incident.failedIn,
    // Enough tests to see the shape of the breakage; the count above is what matters, and the full
    // list is in the build's own test report if anyone needs it.
    tests: incident.tests?.slice(0, 12),
    envs: incident.envs,
    setupFailures: incident.setupFailures?.length || undefined,
    evidence: incident.evidence,
    // 28 days of this test's executions, everywhere it runs: the failure rate, the configurations
    // it concentrates in, the day it started, and the analyser's own conclusions in its words.
    develocity: incident.develocity,
    silent: incident.silent,
    notified: incident.notified,
    blame: incident.blame && {
      ...incident.blame,
      culprit: incident.blame.culprit && {
        ...incident.blame.culprit,
        filesChanged: incident.blame.culprit.files.length,
        files: incident.blame.culprit.files.slice(0, 20)
      },
      // One line per suspect, ready to drop into the paste. A suspect is only ever *listed* —
      // the one that may be acted on is `culprit`, which keeps its full shape. Emitting each
      // suspect's 200 changed files instead costs thousands of tokens to say nothing.
      suspects: (incident.blame.suspects || []).slice(0, 20).map(commit => {
        const relevant = commit.files
          .filter(file => keys.paths.some(key => file.toLowerCase().includes(key.toLowerCase())));
        const named = keys.words.filter(word => names(commit, word));
        const marks = [
          relevant.length ? `relevant: ${relevant.slice(0, 3).map(basename).join(', ')}` : null,
          named.length ? `names ${named.join(', ')}` : null
        ].filter(Boolean);
        return `${commit.short} ${commit.author || commit.gitAuthor || '(unknown)'} — ${commit.title}` +
          ` [${commit.files.length} file(s)${marks.length ? `, ${marks.join(', ')}` : ''}]`;
      })
    }
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  // `commit-comment.mjs` and `pull-request.mjs` refuse --write against a work order carrying this.
  ...(args.rehearseStabilise ? { rehearsal: 'stabilise' } : {}),
  horizonDays: args.horizon,
  budget: args.budget,
  githubAuthenticated: !!token && args.github,
  githubTokenWarning: tokenFallback,
  jobs: jobStatus,
  summary: {
    jobs: jobStatus.length,
    red: jobStatus.filter(job => job.result && job.result !== 'SUCCESS').length,
    incidents: incidents.length,
    deep: deep.length,
    beyondHorizon: incidents.filter(incident => incident.beyondHorizon).length,
    alreadyCommented: incidents.filter(incident => incident.silent).length,
    answered: incidents.filter(settled).length,
    // Named, not silently absent: "no Develocity facts today" and "this failure has no history" are
    // different mornings, and the second one is news.
    develocity: develocityOff
      ? { unavailable: develocityOff }
      : { enriched: incidents.filter(incident => incident.develocity).length },
    collapsed: incidents.filter(incident => incident.primary === false).length,
    // Only ever present when a gate was red: on a morning with no gate failure there is nothing to
    // have been unable to read.
    sonar: sonarOff ? { unavailable: sonarOff } : undefined,
    // The one flicker this run may try to fix, or why it may not try — and the second is the more
    // common morning, which is the point of printing it (SKILL.md §5).
    stabilise,
    read: toRead(incidents, stabilise)
  },
  incidents: args.full ? incidents : incidents.map(incident => digest(incident, blameKeys(incident)))
};

if (!args.pretty) {
  console.log(JSON.stringify(report, (_key, value) => (value instanceof Set ? [...value] : value), 2));
} else {
  const { summary } = report;
  console.log(`CI sweep ${report.generatedAt.slice(0, 10)} — ${summary.red}/${summary.jobs} jobs red, ` +
    `${summary.incidents} incident(s), ${summary.deep} deep-treated`);
  for (const incident of incidents) {
    const age = incident.ageDays == null || (incident.ageIsLowerBound && !incident.ageDays) ? 'age?'
      : `${incident.ageIsLowerBound ? '≥' : ''}${incident.ageDays}d`;
    const who = incident.blame?.culprit
      ? `${incident.blame.tier} → ${incident.blame.culprit.short} (${incident.blame.culprit.author})`
      : incident.blame?.tier || '—';
    console.log(`${incident.deep ? '*' : ' '} [${incident.kind}] ${incident.id} — ${age}, ${who}` +
      `${incident.silent ? ' (already commented)' : ''}${incident.beyondHorizon ? ' (beyond horizon)' : ''}` +
      `${incident.fixState ? ` (${settled(incident) ? 'possibly answered'
        : incident.fixState.candidate ? 'candidate fix, unconfirmed' : 'partly answered'} by ` +
        `${fixName(incident.fixState)}, ${incident.fixState.where})` : ''}` +
      `${incident.primary === false ? ` (same cause as ${incident.alsoOn[0]} — collapsed)` : ''}` +
      `${incident.develocity ? ` [dv ${incident.develocity.failures}/${incident.develocity.runs} in ` +
        `${incident.develocity.windowDays}d, since ${incident.develocity.firstSeen}]` : ''}` +
      `${incident.stabilise ? ' (stabilisation candidate)' : ''}`);
  }
  console.log(summary.stabilise.id
    ? `Stabilise: ${summary.stabilise.id} (${summary.stabilise.jira})`
    : `Stabilise: none — ${summary.stabilise.skipped}`);
}
