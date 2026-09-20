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
 */

import {
  branchesOf, buildRevision, buildSummaries, ENV_TESTS_FOLDER, failedNodesOf, isPseudoTest,
  jobUrl, MAIN_FOLDER, outcomes, stagesOf, stepConsole, stepLog, testResults
} from '../../../scripts/jenkins.mjs';
import { JIRA, knownFlickers, closedFlickers } from '../../../scripts/jira-flickers.mjs';
import { develocityFacts } from './dv-test-history.mjs';
import { gateFacts } from './sonar-gate.mjs';
import { readFileSync } from 'node:fs';

const USAGE = `Usage: node ci-check.mjs [options]

  --repos <a,b,c>     Repos to sweep (default: xwiki-commons,xwiki-rendering,xwiki-platform)
  --branch <name>     Only this branch (default: every master/stable-* branch Jenkins has)
  --horizon <days>    Blame horizon: no write is proposed for an older incident (default 7)
  --budget <n>        Incidents marked for deep treatment (default 5)
  --history <n>       Builds of history to age and rate a failure over (default 8)
  --absence <days>    Days without a build that make a dev/LTS branch an incident (default 3)
  --max-console <n>   Consecutive broken builds whose log is read, per job (default 4)
  --no-github         Skip blame attribution and the "already commented?" check
  --no-develocity     Skip the Develocity history of deep class-1 incidents (one call each)
  --full              Emit every field of every incident (debugging; the default is digested)
  --pretty            Human-readable summary instead of the JSON work order
  --render-detail <f> Render the paste body from a work order written earlier ('-' for stdin),
                      instead of sweeping. Add --live to drop the "dry run" header.
  --delta <f>         Classify the incidents of a work order ('-' for stdin) against the state the
                      last digest carried, instead of sweeping. NEW / CHANGED / FIXED / SAME, plus
                      the state for the next run. Reads yesterday's with --previous.
  --previous <f>      What matrix.mjs --last-state printed (default: an unknown yesterday).
  --chat <f>          What matrix.mjs --since printed ('-' for stdin): the room's messages since
                      the last digest. They can only ever buy an incident silence, never raise one.

Reads GitHub through GH_TOKEN_BOT (or GITHUB_TOKEN / GH_TOKEN — reads are identity-neutral).
Without one, blame and comment-dedupe are unavailable and every incident comes back tier "unknown".
`;

function parseArgs(argv) {
  const out = {
    repos: ['xwiki-commons', 'xwiki-rendering', 'xwiki-platform'], branch: null, horizon: 7,
    budget: 5, history: 8, absence: 3, maxConsole: 4, github: true, develocity: true,
    full: false, pretty: false,
    renderDetail: null, live: false, delta: null, previous: null, chat: null
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--repos') out.repos = argv[++i].split(',').filter(Boolean);
    else if (key === '--branch') out.branch = argv[++i];
    else if (key === '--horizon') out.horizon = Number(argv[++i]);
    else if (key === '--budget') out.budget = Number(argv[++i]);
    else if (key === '--history') out.history = Number(argv[++i]);
    else if (key === '--absence') out.absence = Number(argv[++i]);
    else if (key === '--max-console') out.maxConsole = Number(argv[++i]);
    else if (key === '--no-github') out.github = false;
    else if (key === '--no-develocity') out.develocity = false;
    else if (key === '--full') out.full = true;
    else if (key === '--pretty') out.pretty = true;
    else if (key === '--render-detail') out.renderDetail = argv[++i];
    else if (key === '--delta') out.delta = argv[++i];
    else if (key === '--previous') out.previous = argv[++i];
    else if (key === '--chat') out.chat = argv[++i];
    else if (key === '--live') out.live = true;
    else if (key === '--help' || key === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error(`Unknown argument [${key}]\n\n${USAGE}`); process.exit(2); }
  }
  return out;
}

const DAY = 86400000;
const daysSince = timestamp => Math.floor((Date.now() - timestamp) / DAY);
const dayOf = timestamp => new Date(timestamp).toISOString().slice(0, 10);

// ---- Branch policy ---------------------------------------------------------------------------
// master is where the next version is developed; a `*.4.x` / `*.10.x` stable branch is an LTS,
// maintained for a long time; every other stable branch is transient — cut at a release and rarely
// touched again, so *silence on it is health, not a symptom*. Alerting stops two cycles back: an
// XWiki cycle is a major version, so with 18.x current, 16.x is the oldest branch worth a ping.

const CYCLE_DEPTH = 2;

/** @returns {{class: 'dev'|'lts'|'transient', cycle: number|null}} */
export function classifyBranch(branch) {
  if (branch === 'master') return { class: 'dev', cycle: null };
  const version = branch.match(/^stable-(\d+)\.(\d+)\.x$/);
  if (!version) return { class: 'transient', cycle: null };
  const [, major, minor] = version.map(Number);
  // The long-term-supported minors. They are the cycle's last release (`.10`) and its mid-cycle
  // one (`.4`); everything else in the same cycle is a transient stable branch.
  const lts = minor === 4 || minor === 10;
  return { class: lts ? 'lts' : 'transient', cycle: major };
}

/** Annotates each branch with its class and whether this run is allowed to raise an alert on it. */
function withPolicy(branches) {
  const cycles = branches.map(b => classifyBranch(b).cycle).filter(c => c != null);
  const currentCycle = cycles.length ? Math.max(...cycles) : null;
  return branches.map(branch => {
    const { class: branchClass, cycle } = classifyBranch(branch);
    const inWindow = cycle == null || currentCycle == null || cycle >= currentCycle - CYCLE_DEPTH;
    return { branch, branchClass, cycle, alerting: branchClass !== 'transient' && inWindow };
  });
}

// ---- What a red build says about itself ------------------------------------------------------
// Narrow, explicitly listed patterns, matched in-script against the console log. Anything they do
// not match falls through to "unclassified" — a legitimate outcome that gets reported rather than
// guessed at, because a broad pattern against Testcontainers' image dumps matches everything.

const INFRA_PATTERNS = [
  { id: 'docker-rate-limit', re: /toomanyrequests|You have reached your pull rate limit/ },
  { id: 'github-unreachable', re: /fatal: unable to access 'https:\/\/github\.com|Failed to connect to github\.com/ },
  {
    id: 'repository-unreachable',
    re: /Could not transfer artifact .* (Connection timed out|Connection reset|502|503)/
  },
  { id: 'agent-lost', re: /Agent went offline|channel is already closed|Connection was broken: java\.io\.IOException/ },
  { id: 'disk-full', re: /No space left on device/ }
];

// Ordered: the first matcher that hits names the break. Each one's `locate` turns the matched line
// into a signature stable across builds — the tool plus *where*, never the message, which often
// carries a count or a timestamp.
const BREAK_MATCHERS = [
  {
    tool: 'checkstyle',
    re: /\[ERROR\]\s+(\S+\.java):\[(\d+)[,:]\d*\]\s+(?:\(\S+\)\s+)?(\S+):/,
    locate: m => `checkstyle:${basename(m[1])}:${m[2]}`,
    file: m => m[1]
  },
  {
    tool: 'compile',
    re: /\[ERROR\]\s+(\S+\.java):\[(\d+),\d+\]\s+(.+)/,
    locate: m => `compile:${basename(m[1])}:${m[2]}`,
    file: m => m[1]
  },
  {
    tool: 'license',
    re: /Missing header in:\s*(\S+)|\[ERROR\].*license.*Some files do not have the expected license header/,
    locate: m => `license:${m[1] ? basename(m[1]) : 'multiple'}`,
    file: m => m[1] || null
  },
  {
    tool: 'revapi',
    re: /\[ERROR\].*(?:revapi|API problems found|java\.(?:class|method|field)\.\S+)/,
    locate: () => 'revapi:api-break',
    file: () => null
  },
  {
    // `[ERROR]` is deliberately not required: Maven prints this message twice, once prefixed in the
    // build output and once bare inside the `MojoExecutionException` it dumps — and the bare one is
    // what survives in the 10 KiB log tail this tool reads first. Requiring the prefix left the tail
    // unclassified and paid for the whole console page to learn the same thing.
    tool: 'enforcer',
    // Only the first alternative may appear unprefixed: `Rule N: <class> failed with message` is
    // written by a failure and by nothing else. The other two keep `[ERROR]`, because
    // `[INFO] --- enforcer:…:enforce (enforcer-rules) @ … ---` is printed by every successful
    // Maven build, and matching it would sign half the breaks in the project as enforcer failures.
    re: /(?:Rule \d+: \S+ failed with message)|\[ERROR\].*(?:enforcer-rules|banned dependencies)/,
    locate: () => 'enforcer:rule-failed',
    file: () => null
  },
  {
    // Two wordings, because a gate failure surfaces in two places: the scanner prints
    // `QUALITY GATE STATUS: FAILED` into the Maven log, while Jenkins' own `waitForQualityGate`
    // step reports `Pipeline aborted due to quality gate failure: ERROR` as the stage's
    // `error.message` — and the stage error is what this tool reads, the console log being ~80 MB.
    // Matching only the scanner's wording leaves every gate failure `unclassified`, and so signed
    // by its raw message — while the marker that suppresses tomorrow's duplicate, and the window
    // that ages the break, both join on the signature.
    tool: 'sonar-gate',
    re: new RegExp(['QUALITY GATE STATUS: FAILED',
      'Quality gate (?:is|status is) (?:red|FAILED)',
      'Pipeline aborted due to quality gate failure'].join('|'), 'i'),
    locate: () => 'sonar-gate:failed',
    file: () => null
  },
  {
    tool: 'test-infrastructure',
    re: /\[ERROR\].*(?:There are test failures|Execution default-test of goal|surefire).*(?:forked VM|crashed)/,
    locate: () => 'surefire:vm-crash',
    file: () => null
  },
  {
    // Names the module but not the cause, which every matcher above does better — so it is `weak`:
    // tried only once they have all failed on the *full* log. Without that it would win by being
    // early, since Maven prints this resume line at the very end of a failed reactor and it is
    // therefore the one error that always survives inside the 10 KiB tail — hiding the goal that
    // actually failed, which sits further up. As a last resort it still beats `unclassified`: a
    // named module is what blame needs to score commits by file overlap.
    tool: 'maven-reactor',
    weak: true,
    re: /\[ERROR\]\s+mvn .*-rf :(\S+)/,
    locate: m => `maven:${m[1]}`,
    file: () => null
  }
];

const basename = path => path.split(/[\\/]/).pop();

// The same blips as INFRA_PATTERNS, but as they appear in a *test's* error detail rather than in a
// log: when the environment a docker test needs never comes up, every test of every module in that
// run reports a setup failure. That is one infra event, not forty broken modules — and forty
// broken modules is what it looks like until this is matched.
const INFRA_TEST_PATTERNS = [
  { id: 'agent-environment', re: /Error setting up the XWiki testing environment on agent/ },
  { id: 'docker-rate-limit', re: /toomanyrequests|pull rate limit/ },
  { id: 'container-start', re: /Could not start container|Timed out waiting for container|ContainerLaunchException/ }
];

const infraInDetail = details => {
  for (const pattern of INFRA_TEST_PATTERNS) {
    if (details.some(detail => pattern.re.test(detail || ''))) return pattern.id;
  }
  return null;
};

// The union of everything worth keeping from a log, plus a bare `[ERROR]` net so an unmatched
// break still comes back with its first error line to report.
// Never anchored to the start of a line: Jenkins prefixes every console line with a timestamp
// (`21:45:33,216 [ERROR] ...`), so `/^\[ERROR\]/` matches nothing at all on a real build.
const LOG_PATTERNS = [
  ...INFRA_PATTERNS.map(p => p.re), ...BREAK_MATCHERS.map(m => m.re), /\[ERROR\]/
];

/** The stage name, stripped of the part that changes between builds, to make it a signature. */
const stageKey = name => (name || 'unknown stage')
  .replace(/\s+for\s+.*$/, '')            // "Build for IT #11 for xwiki-…, xwiki-…" -> "Build"
  .replace(/#\d+/g, '#N')
  .trim()
  .slice(0, 60);

/**
 * Reads one broken build and says what broke it.
 *
 * Goes through the *stages*, never the console log: the failing stage names itself, its failing
 * step carries an `error.message`, and that step's own log is a few KB against the build's ~80 MB.
 * Reading the console instead would cost more bandwidth per build than this whole sweep.
 *
 * @returns {{kind: 'infra'|'build-break'|'timeout'|'unclassified', signature: string,
 *   file: string|null, stage: string|null, evidence: string[]}}
 */
async function diagnose(buildUrl) {
  const broken = (await stagesOf(buildUrl))
    .filter(stage => stage.status === 'FAILED' || stage.status === 'ABORTED');
  // One bag per failed stage, never merged. A broken build usually fails in a *cascade* — Main
  // breaks, so TestRelease breaks, so the quality gate breaks — and pooling their logs lets the
  // highest-priority matcher anywhere in the pile decide, which makes the answer depend on how far
  // the cascade happened to run. Two builds of one unchanged break then sign differently, and
  // `breakWindow` reads that as "a different cause", cuts the blame window to the last build's
  // commits, and names whoever is in it. The first failed stage is the cause; the rest follow it.
  const stages = [];
  for (const candidate of broken.slice(0, 2)) {
    const bag = { name: candidate.name, lines: [], truncated: [], nodeError: null };
    for (const node of (await failedNodesOf(candidate)).slice(0, 3)) {
      if (!bag.nodeError && node.error?.message) bag.nodeError = node.error.message.split('\n')[0].slice(0, 200);
      const { lines: log, hasMore, consoleUrl } = await stepLog(node);
      bag.lines.push(...keep(log));
      // Remember where the rest of a cut-off log is, without reading it: most breaks are named in
      // the tail, and the ones that are not are worth a second request only once that is known.
      if (hasMore && consoleUrl) bag.truncated.push(consoleUrl);
    }
    stages.push(bag);
  }
  const stage = stages[0]?.name ?? null;
  const nodeError = stages.find(bag => bag.nodeError)?.nodeError ?? null;
  const lines = stages.flatMap(bag => bag.lines);
  const at = key => (stage ? `${stageKey(stage)}/${key}` : key);

  for (const pattern of INFRA_PATTERNS) {
    const hit = lines.find(line => pattern.re.test(line)) || (nodeError?.match(pattern.re) ? nodeError : null);
    if (hit) return { kind: 'infra', signature: pattern.id, file: null, stage, evidence: [hit] };
  }
  // A stage that ran out of time is neither a broken build nor an infra blip, and pretending it is
  // one of those is worse than saying so. v1 reports it and stops there — no blame, no fix.
  if (/Timeout has been exceeded|script returned exit code 143/i.test(nodeError || '')) {
    return { kind: 'timeout', signature: at('timeout'), file: null, stage, evidence: [nodeError] };
  }
  let matched = null;
  for (const bag of stages) {
    matched = classify(bag.lines, bag.nodeError ?? nodeError, at, stage);
    // Maven prints `Failed to execute goal … on project X` above the stack trace it then dumps, so
    // on a long build that headline is exactly what falls out of the 10 KiB tail. Paying for the
    // full step log here is what turns "script returned exit code 1" into a named goal and module —
    // and it is paid only on a stage the tail could not explain.
    if (!matched && bag.truncated.length) {
      for (const consoleUrl of bag.truncated) bag.lines.push(...keep(await stepConsole(consoleUrl)));
      matched = classify(bag.lines, bag.nodeError ?? nodeError, at, stage);
    }
    if (matched) break;
  }
  // Only now, with every real matcher having failed on every stage's whole log, is the reactor's
  // resume line worth taking: it says which module broke and nothing about why.
  matched ??= classify(stages.flatMap(bag => bag.lines), nodeError, at, stage, { weak: true });
  if (matched) return matched;

  // Re-read from the bags rather than the snapshot above: a stage whose full log was fetched on the
  // way here has error lines the snapshot never saw, and they are the ones worth reporting.
  const errors = stages.flatMap(bag => bag.lines).filter(line => line.includes('[ERROR]')).slice(0, 5);
  const first = nodeError || errors[0] || 'no error line';
  return {
    kind: 'unclassified',
    // Normalised so the same unexplained break is the same incident tomorrow: digits vary between
    // builds (paths, counts, durations) and would otherwise make every run look like a new cause.
    signature: at(`unclassified:${first.slice(0, 80).replace(/\d+/g, 'N')}`),
    file: null,
    stage,
    evidence: nodeError ? [nodeError, ...errors]
      : (errors.length ? errors : ['(no error line found in the failing stage)'])
  };
}

/**
 * Only the lines worth matching against, bounded and trimmed the way a log grep would leave them —
 * plus, after each *named* pattern, the lines that continue it.
 *
 * A matched line is usually the headline of the error and not the error: Maven's enforcer prints
 * `Rule 0: … failed with message:` and puts the module, the dependency and the two versions on the
 * lines below, which match no pattern at all. Keeping the match alone kept the one line of the
 * failure that says nothing, and left a build break that names its cause looking anonymous. The
 * continuation stops at the next Maven log line, at a blank line and at a stack frame, which is
 * where such a message ends; the bare `[ERROR]` net drags nothing along, or a stack dump would
 * fill the budget on its own.
 */
const CONTINUATION_LINES = 14;
const NAMED_PATTERNS = [...INFRA_PATTERNS.map(p => p.re), ...BREAK_MATCHERS.map(m => m.re)];
const endsContinuation = line =>
  !line.trim() || /\[(?:INFO|WARNING|DEBUG)\]/.test(line) || /^\s*at\s+\S+\(/.test(line);

const keep = lines => {
  const wanted = new Set();
  lines.forEach((line, index) => {
    if (!LOG_PATTERNS.some(pattern => pattern.test(line))) return;
    wanted.add(index);
    if (!NAMED_PATTERNS.some(pattern => pattern.test(line))) return;
    for (let next = index + 1; next < lines.length && next <= index + CONTINUATION_LINES; next++) {
      if (endsContinuation(lines[next])) break;
      wanted.add(next);
    }
  });
  // `trimEnd`, not `trim`: a dependency tree is indented, and flattening it turns "who pulls what"
  // into an unreadable list of coordinates.
  return [...wanted].sort((a, b) => a - b).map(index => lines[index].trimEnd().slice(0, 300)).slice(0, 240);
};

/**
 * The first `BREAK_MATCHERS` entry that hits, or null when none does — separate from `diagnose` so
 * that it can be run repeatedly: on the cheap log tail, on the full log if that failed, and finally
 * with the `weak` matchers, which name a break too vaguely to be allowed to pre-empt the others.
 */
function classify(lines, nodeError, at, stage, { weak = false } = {}) {
  // The step's `error.message` is searched alongside its log because some breaks appear only
  // there: a Jenkins step that fails the build by itself — `waitForQualityGate` — writes its
  // reason into the node's error and nothing into any Maven log. It goes last so that a log line,
  // which carries the file and the position, still names the break when there is one.
  const candidates = nodeError ? [...lines, nodeError] : lines;
  for (const matcher of BREAK_MATCHERS.filter(m => Boolean(m.weak) === weak)) {
    for (let index = 0; index < candidates.length; index++) {
      const match = candidates[index].match(matcher.re);
      if (match) {
        return {
          kind: 'build-break', signature: at(matcher.locate(match)), file: matcher.file(match), stage,
          evidence: evidenceFrom(candidates, index, matcher)
        };
      }
    }
  }
  return null;
}

/**
 * The matched line, whatever continues it, and any further line the *same* matcher hits — a javac
 * run reports twenty errors and the second one is as much the break as the first. It stops at the
 * first line belonging to a different pattern, because past that point the log has moved on to
 * another failure and quoting it under this one's heading would misdescribe both.
 */
function evidenceFrom(lines, start, matcher) {
  const evidence = [];
  let budget = 1600;
  for (let index = start; index < lines.length && evidence.length < 16 && budget > 0; index++) {
    const line = lines[index];
    // Only a *named* pattern ends the quote. The bare `[ERROR]` net must not: Maven prefixes every
    // line of a multi-line message with `[ERROR]`, so breaking on it would cut the message off
    // after its first line — which is the whole point of quoting more than one.
    const continues = !NAMED_PATTERNS.some(pattern => pattern.test(line)) || matcher.re.test(line);
    if (index > start && !continues) break;
    evidence.push(line);
    budget -= line.length;
  }
  return evidence;
}

// ---- GitHub (read-only) ----------------------------------------------------------------------

const GITHUB = 'https://api.github.com';
// Reads may use whatever token is around — a developer running this by hand has their own, and the
// GitHub read API does not care whose it is. Writing is the opposite: `commit-comment.mjs` accepts
// the bot's token and nothing else, so no fallback here can ever put a human's name on a comment.
const tokens = [process.env.GH_TOKEN_BOT, process.env.GITHUB_TOKEN, process.env.GH_TOKEN].filter(Boolean);
let token = tokens[0];
let tokenFallback = null;

/**
 * One GitHub read.
 *
 * The bot's token can be refused wholesale rather than per-request — the `xwiki` org rejects a
 * fine-grained token whose lifetime exceeds 366 days, answering 403 to *every* call including a
 * plain public-repo read. That is a misconfiguration to fix, not a reason for the morning sweep to
 * report "no blame available" for days, so a read falls through to the next token available and
 * says so in the report. Writes have no such path.
 */
async function github(path) {
  for (let index = tokens.indexOf(token); ; index++) {
    const attempt = tokens[index];
    const res = await fetch(`${GITHUB}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'xwiki-ci-check',
        ...(attempt ? { Authorization: `Bearer ${attempt}` } : {})
      }
    });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    const refused = (res.status === 401 || res.status === 403) && index < tokens.length - 1;
    if (!refused) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
    tokenFallback ??= `the first GitHub token was refused (HTTP ${res.status}); reads fell back to `
      + 'the next one. Reads are identity-neutral, but writes will fail until GH_TOKEN_BOT works.';
    token = tokens[index + 1];
  }
}

/**
 * A commit's full record, fetched once per run.
 *
 * The same commit is compared against from several jobs of one branch — the main build and every
 * cell of the Environment Tests matrix — and the forward-fix pass below walks the same unbuilt
 * range as often as there are jobs. Without this, one push costs a request per job per commit.
 */
const commitDetails = new Map();
const detailOf = (repo, sha) => {
  const key = `${repo}/${sha}`;
  if (!commitDetails.has(key)) commitDetails.set(key, github(`/repos/xwiki/${repo}/commits/${sha}`));
  return commitDetails.get(key);
};

/**
 * The commits between two builds' *project* revisions, with their real authors and the files they
 * touched.
 *
 * GitHub, not Jenkins: `changeSets` is empty on every recent xwiki-commons build, and where it is
 * populated its `author.fullName` is frequently `noreply`, GitHub's merge-commit author. One
 * mechanism that works everywhere beats two that each work somewhere.
 */
async function commitsBetween(repo, baseSha, headSha, { maxCommits = 20 } = {}) {
  const data = await github(`/repos/xwiki/${repo}/compare/${baseSha}...${headSha}`);
  if (!data?.commits) return [];
  const commits = data.commits.filter(c => (c.parents || []).length < 2).slice(-maxCommits);
  return Promise.all(commits.map(async commit => {
    const detail = await detailOf(repo, commit.sha);
    return {
      sha: commit.sha,
      short: commit.sha.slice(0, 10),
      // `author` is the GitHub account; `commit.author` is the git identity, which for a merged PR
      // is often GitHub's `noreply` robot. Prefer the account, and never ping a `noreply`.
      author: commit.author?.login || null,
      gitAuthor: commit.commit?.author?.name || null,
      title: (commit.commit?.message || '').split('\n')[0].slice(0, 120),
      url: commit.html_url,
      date: commit.commit?.author?.date || null,
      files: (detail?.files || []).map(f => f.filename).slice(0, 200)
    };
  }));
}

/** Whether this incident was already commented on, and in what state. */
async function priorComment(repo, sha, incidentId) {
  return markerIn(await github(`/repos/xwiki/${repo}/commits/${sha}/comments`), incidentId);
}

/** The same question about a pull request, which is where a gate comment goes when there is one. */
async function priorPrComment(repo, number, incidentId) {
  return markerIn(await github(`/repos/xwiki/${repo}/issues/${number}/comments`), incidentId);
}

function markerIn(comments, incidentId) {
  for (const comment of comments || []) {
    const marker = (comment.body || '').match(/<!--\s*xwiki-ci-check:\s*(\S+)\s+state=(\S+)\s*-->/);
    if (marker && marker[1] === incidentId) {
      return { state: marker[2], url: comment.html_url, at: comment.created_at };
    }
  }
  return null;
}

/**
 * How many commits the branch has that CI has never built.
 *
 * @returns {{behind: number|null, reason: string}} `0` = CI is up to date and the silence is
 *   simply nobody committing; `null` = it could not be established (no token), which is reported
 *   as such rather than assumed either way.
 */
async function unbuiltCommits(target, jobs, args) {
  const main = jobs.find(job => job.label === 'main') || jobs[0];
  const latest = main?.builds[0];
  if (!latest) return { behind: null, reason: 'the job has no build at all' };
  if (!args.github || !token) return { behind: null, reason: 'unverified: no GitHub token to check the branch head' };
  try {
    const built = await buildRevision(`${main.url}/${latest.number}`, target.repo);
    const head = await github(`/repos/xwiki/${target.repo}/branches/${encodeURIComponent(target.branch)}`);
    const headSha = head?.commit?.sha;
    if (!built || !headSha) {
      return { behind: null, reason: 'unverified: the branch head or the built revision is unknown' };
    }
    if (built === headSha) return { behind: 0, reason: `CI is up to date with ${headSha.slice(0, 10)}` };
    const diff = await github(`/repos/xwiki/${target.repo}/compare/${built}...${headSha}`);
    const behind = diff?.ahead_by ?? null;
    return behind === 0
      ? { behind: 0, reason: `CI is up to date with ${headSha.slice(0, 10)}` }
      : { behind, reason: `${behind ?? 'some'} commit(s) pushed since build #${latest.number} have never been built` };
  } catch (error) {
    return { behind: null, reason: `unverified: ${error.message}` };
  }
}

// ---- Blame -----------------------------------------------------------------------------------
// Tier decides the wording, and the wording is the whole credibility of the system: a machine that
// asserts wrongly is switched off, one that asks is forgiven. `certain` may state, `likely` must
// only ask, `ambiguous` must not ping at all.

const touches = (commit, needle) =>
  !!needle && commit.files.some(file => file.toLowerCase().includes(needle.toLowerCase()));

// A Maven coordinate, `groupId:artifactId`, as every dependency report prints it — and an XWiki
// module id, which is the one token that appears both in a coordinate and in a repository path.
const COORDINATE_RE = /\b([a-z][\w.-]*\.[\w.-]+):([A-Za-z][\w.-]{2,})\b/g;
const MODULE_RE = /\bxwiki-[a-z0-9]+(?:-[a-z0-9]+)+\b/g;
// Words too generic to attribute anything: they are in most XWiki coordinates and most commit
// subjects, so scoring on them would make every commit in the window relevant, which is the same
// as none of them being.
const GENERIC = new Set(['xwiki', 'maven', 'java', 'core', 'test', 'tests', 'api', 'plugin', 'parent',
  'project', 'common', 'commons', 'platform', 'rendering', 'build', 'main', 'util', 'utils', 'jakarta',
  'javax', 'jdk', 'pom', 'model', 'legacy', 'oldcore', 'web']);

/**
 * What the failure itself names, split by how a commit can be shown to be about it.
 *
 * `paths` are matched against a commit's changed files; `words` against its subject line. The
 * second exists because the failures this tool sees most are dependency failures, and a dependency
 * bump changes a `pom.xml` and nothing else — the path says only "a pom", and the subject
 * ("Upgrade to Selenium 4.49.0") is the sole place the library is named. Without it every enforcer,
 * revapi and reactor break came back `ambiguous` with the commit that caused it in the list.
 */
function blameKeys(incident) {
  if (incident.file) return { paths: [basename(incident.file)], words: [] };
  // A test's own file, and the package directory it lives in — which is where its page objects and
  // fixtures sit too, and those break a test as readily as the test itself.
  const paths = (incident.tests || []).slice(0, 20).flatMap(id => {
    const className = id.split('#')[0];
    const simple = className.split(/[.$]/).pop();
    const packagePath = className.split('.').slice(0, -1).join('/');
    return [`${simple}.java`, packagePath].filter(Boolean);
  });
  const words = new Set();
  const text = [...(incident.evidence || []), incident.signature || ''].join('\n');
  for (const [, , artifact] of text.matchAll(COORDINATE_RE)) {
    if (artifact.startsWith('xwiki-')) paths.push(artifact);
    else {
      const word = artifact.split('-')[0].toLowerCase();
      if (word.length >= 4 && !GENERIC.has(word)) words.add(word);
    }
  }
  for (const module of text.matchAll(MODULE_RE)) paths.push(module[0]);
  return { paths: [...new Set(paths)], words: [...words] };
}

const names = (commit, word) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(commit.title || '');

function attribute(incident, commits) {
  if (!commits.length) return { tier: 'ambiguous', reason: 'no commit in the window', suspects: [] };
  const { paths, words } = blameKeys(incident);
  const byPath = commits.filter(commit => paths.some(key => touches(commit, key)));
  const byWord = commits.filter(commit => words.some(word => names(commit, word)));
  const pingable = byPath.filter(commit => commit.author);
  const named = byWord.filter(commit => commit.author);
  const authors = new Set(commits.map(commit => commit.author).filter(Boolean));

  // The failure names a file and exactly one commit in the window touched it. Nothing else in the
  // window can have caused it, so this one may be stated rather than asked.
  if (incident.file && pingable.length === 1) {
    return {
      tier: 'certain', culprit: pingable[0], suspects: commits,
      reason: `the only commit in the window touching ${basename(incident.file)}`
    };
  }
  if (pingable.length === 1) {
    return {
      tier: 'likely', culprit: pingable[0], suspects: commits,
      reason: incident.class === 2
        ? `the only commit in the window touching ${paths.find(key => touches(pingable[0], key))}, which the failure names`
        : 'the only commit in the window touching the failing test or its package'
    };
  }
  // Nothing touched the right path — but the failure named a library and exactly one commit in the
  // window says it changed that library. It stays `likely`, never `certain`: a subject line is what
  // an author wrote, not what the build observed, so this may only ask.
  if (named.length === 1) {
    return {
      tier: 'likely', culprit: named[0], suspects: commits,
      reason: `the only commit in the window whose subject names ${words.find(word => names(named[0], word))},` +
        ' which the failure reports'
    };
  }
  if (authors.size === 1 && commits.length <= 6) {
    const culprit = commits.find(commit => commit.author);
    return {
      tier: 'likely', culprit, suspects: commits,
      reason: `every one of the ${commits.length} commits in the window is by the same author`
    };
  }
  const relevant = new Set([...byPath, ...byWord]);
  return {
    tier: 'ambiguous', suspects: commits,
    reason: `${commits.length} commits by ${authors.size} author(s), ${relevant.size} of them relevant`
  };
}

// ---- Forward fix -----------------------------------------------------------------------------
// Blame looks backward, at the commits inside the regression window. Nothing looked forward, at
// what landed *after* CI last built the branch — so a break fixed at 22:27 was still being
// root-caused, and its author still being pinged, at 06:00 the next morning. That is the one
// failure mode that costs the whole system its credibility, because the reader already knows the
// answer the routine is missing.
//
// The unbuilt commits are the only place an unproven fix can be: anything older was built, and the
// build still failed. They are fetched once per job — every incident of a job shares them — and
// matched with the very keys blame uses, pointed the other way.

const unbuilt = new Map();

/**
 * The commits pushed to the branch since this job last built it.
 *
 * @returns {Promise<{build: number, commits: object[]}>} an empty list when the branch head is
 *   built, when there is no token, or when the lookup fails — see `forwardFix` on why failing open
 *   is the right direction here.
 */
function unbuiltOf(job, repo, branch, args) {
  const latest = job?.builds?.[0];
  if (!latest || !args.github || !token) return Promise.resolve({ build: null, commits: [] });
  const key = `${job.url}#${latest.number}`;
  if (!unbuilt.has(key)) {
    unbuilt.set(key, (async () => {
      try {
        const built = await buildRevision(`${job.url}/${latest.number}`, repo);
        const head = await github(`/repos/xwiki/${repo}/branches/${encodeURIComponent(branch)}`);
        const headSha = head?.commit?.sha;
        if (!built || !headSha || built === headSha) return { build: latest.number, commits: [] };
        // Ten, not the blame pass's twenty: a fix lands in the hours after the break, and a range
        // long enough to need more is a branch CI has stopped building, which is another incident.
        const commits = await commitsBetween(repo, built, headSha, { maxCommits: 10 });
        return { build: latest.number, commits };
      } catch {
        return { build: latest.number, commits: [] };
      }
    })());
  }
  return unbuilt.get(key);
}

/**
 * What a commit must name to look like *this* incident's fix — narrower than `blameKeys`, and the
 * asymmetry is the whole point.
 *
 * Backward, a commit touching the failing test's *package* is a fair suspect: the page objects and
 * fixtures beside it break a test as readily as the test itself, and the cost of a wrong guess is
 * a comment that asks. Forward, the cost of a wrong guess is silence about a live breakage — so
 * only the failing file itself counts, never the directory around it, and never the module.
 *
 * Measured on 2026-09-18: with the package key, `9dd4f149c8` (touching `VersionIT.java`) silenced
 * a systematic failure of `DocExtraTabsIT`, its neighbour in `org/xwiki/flamingo/test/docker`.
 */
function forwardKeys(incident) {
  // Grouped by the thing that has to be fixed, not by spelling: one group per failing test class,
  // holding the file names that class can live in. Coverage is then counted in tests, which is
  // what an incident is made of, rather than in keys, of which one test contributes several.
  if (incident.file) return { groups: [[basename(incident.file)]], words: [] };
  const groups = new Map();
  for (const id of (incident.tests || []).slice(0, 20)) {
    // `AllIT$NestedDocExtraTabsIT` is declared in `DocExtraTabsIT.java`: the `Nested` prefix names
    // the inner class the suite wraps it in, and no file carries it.
    const simple = id.split('#')[0].split(/[.$]/).pop();
    const keys = [...new Set([`${simple}.java`, `${simple.replace(/^Nested/, '')}.java`])];
    groups.set(keys.join('|'), keys);
  }
  // A dependency break names no file at all — the bump that caused it changed a pom and nothing
  // else — so the library its subject names is the only signal there is, forward as backward.
  return { groups: [...groups.values()], words: incident.class === 2 ? blameKeys(incident).words : [] };
}

/**
 * The unbuilt commit that looks like the fix for this incident, if there is one.
 *
 * **Fails open, always.** A lookup that errors, or a token that is missing, leaves the incident
 * exactly as it was: reported, attributed, commented on. The asymmetry is deliberate — missing a
 * fix costs one needless ping, which the wording of a `likely` comment already survives, whereas
 * inventing one buys silence about a real breakage.
 *
 * The newest match wins. Where several unbuilt commits touch the failing code, the last one is the
 * state of the branch now, and it is the state of the branch the next build will judge.
 */
async function forwardFix(incident, job, args) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  const { build, commits } = await unbuiltOf(job, incident.repo, incident.branch, args);
  if (!commits.length) return null;
  const { groups, words } = forwardKeys(incident);
  const paths = groups.flat();
  const [byPath] = commits.filter(commit => paths.some(key => touches(commit, key))).slice(-1);
  const [byWord] = commits.filter(commit => words.some(word => names(commit, word))).slice(-1);
  const commit = byPath || byWord;
  if (!commit) return null;
  // One incident spans the N tests that broke together, and an unbuilt commit may answer for only
  // some of them. Silencing all N on a fix for one is the same mistake as never looking forward at
  // all, so coverage is counted across *every* unbuilt commit and only a full house goes quiet.
  const covered = groups.filter(keys => commits.some(c => keys.some(key => touches(c, key))));
  const partial = groups.length > 1 && covered.length < groups.length;
  return {
    kind: 'fix-unbuilt',
    sha: commit.short,
    author: commit.author || commit.gitAuthor || null,
    title: commit.title,
    url: commit.url,
    afterBuild: build,
    where: `pushed after build #${build} and not yet built`,
    covers: covered.map(keys => keys[keys.length - 1].replace(/\.java$/, '')),
    of: groups.length,
    partial,
    reason: byPath
      ? `touches ${paths.find(key => touches(commit, key))}, which the failure names`
      : `its subject names ${words.find(word => names(commit, word))}, which the failure reports`
  };
}

/** Whether the branch already answers for the *whole* incident — the only case that goes quiet. */
const settled = incident => !!incident.fixState && !incident.fixState.partial;

// ---- In-flight fix ---------------------------------------------------------------------------
// The second place the answer can already exist, after the unbuilt commits above: an open pull
// request. It is weaker evidence than a landed commit — a PR that names the failing test may be its
// fix, or a rewrite that merely touches it — but it carries the same consequence, because a routine
// that root-causes a test somebody is visibly working on is arguing with the room. So it buys the
// same silence and says `may be in flight`, never `fixed`.
//
// One read per repo per run, never one per incident: the open PRs are listed once and every
// incident of that repo is matched against the same list.

const PR_DAYS = 14;
const pullRequests = new Map();

/**
 * The repo's open pull requests updated in the last `PR_DAYS` days, newest first.
 *
 * The plain list endpoint, not the search API: one is a core-quota read of a stable shape, the
 * other has its own 30-per-minute budget and a query syntax that has already moved once. Sorted by
 * update, the walk stops at the first PR outside the window — a branch nobody has touched in a
 * fortnight is not the fix for this morning's failure — and at three pages, which on
 * xwiki-platform (~230 open, ~100 of them recent) is well past where that happens.
 *
 * @returns {Promise<object[]>} an empty or short list when there is no token or the read fails —
 *   fewer matches, never a wrong one, the same direction `forwardFix` fails in.
 */
function openPullRequests(repo, args) {
  if (!args.github || !token) return Promise.resolve([]);
  if (!pullRequests.has(repo)) {
    pullRequests.set(repo, (async () => {
      const since = Date.now() - PR_DAYS * DAY;
      const out = [];
      try {
        for (let page = 1; page <= 3; page++) {
          const batch = await github(`/repos/xwiki/${repo}/pulls?state=open&sort=updated`
            + `&direction=desc&per_page=100&page=${page}`);
          if (!batch?.length) break;
          for (const pr of batch) {
            if (Date.parse(pr.updated_at) < since) return out;
            out.push({
              number: pr.number, title: pr.title || '', body: pr.body || '',
              base: pr.base?.ref || null, author: pr.user?.login || null,
              url: pr.html_url, updated: pr.updated_at
            });
          }
          if (batch.length < 100) break;
        }
      } catch { /* keep what was read */ }
      return out;
    })());
  }
  return pullRequests.get(repo);
}

/** Whether `text` names `word` on its own, rather than inside a longer identifier. */
const mentions = (text, word) =>
  new RegExp(`(?<![\\w$])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(text);

/**
 * What an open PR must name to look like this incident's fix.
 *
 * Class names, not file names: a PR body writes `DocExtraTabsIT`, never `DocExtraTabsIT.java`.
 * Only `.java` keys survive the crossing — `forwardKeys` also yields the failing *file* of a build
 * break, and a PR that mentions `pom.xml` names nothing at all.
 */
function inFlightKeys(incident) {
  const groups = forwardKeys(incident).groups.map(keys => keys
    .filter(key => key.endsWith('.java')).map(key => key.replace(/\.java$/, '')));
  return { groups, jira: incident.jira?.key || null };
}

/**
 * The open PR that looks like a fix for this incident, if there is one.
 *
 * Runs only where `forwardFix` found nothing at all: a commit that has landed on the branch is
 * better evidence than a proposal, and a *partial* forward fix is already the answer for the part
 * it covers. Fails open for the same reason it does there.
 */
async function inFlightFix(incident, args) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  // A PR against `master` cannot fix `stable-17.10.x`: its code is not going there, and silencing a
  // stable-branch incident on it hides a break nobody is working on.
  const prs = (await openPullRequests(incident.repo, args)).filter(pr => pr.base === incident.branch);
  const { groups, jira } = inFlightKeys(incident);
  // A group with no class name in it can never be covered, so an incident holding one can never go
  // quiet on this evidence — the `of` count stays the incident's real one.
  if (!prs.length || !groups.length || groups.some(keys => !keys.length)) return null;
  const text = pr => `${pr.title}\n${pr.body}`;
  const covers = (pr, keys) => keys.some(name => mentions(text(pr), name));
  // The JIRA key answers for the whole incident only when the incident *is* one test class: the key
  // is the flicker issue of the first failing test, and a PR fixing it says nothing about four
  // other classes that happen to have broken in the same build.
  const whole = pr => !!jira && groups.length === 1 && mentions(text(pr), jira);
  const matched = prs.filter(pr => whole(pr) || groups.some(keys => covers(pr, keys)));
  if (!matched.length) return null;
  const covered = groups.filter(keys => matched.some(pr => whole(pr) || covers(pr, keys)));
  if (!covered.length) return null;
  // The PR that explains the most of the incident, and the most recently updated of those — naming
  // a PR that mentions one of three failing classes, while another names all three, points the
  // reader at the wrong work. `matched` is already newest-first, and `sort` is stable.
  const reach = pr => (whole(pr) ? groups.length : groups.filter(keys => covers(pr, keys)).length);
  const [pr] = [...matched].sort((a, b) => reach(b) - reach(a));
  const named = groups.flat().find(name => mentions(text(pr), name));
  return {
    kind: 'fix-in-flight',
    number: pr.number,
    author: pr.author,
    title: pr.title,
    url: pr.url,
    where: `open, last updated ${dayOf(Date.parse(pr.updated))}`,
    covers: covered.map(keys => keys[keys.length - 1]),
    of: groups.length,
    partial: groups.length > 1 && covered.length < groups.length,
    reason: named
      ? `it names ${named}, the class the failure names`
      : `it names ${jira}, the issue this incident is tracked as`
  };
}

// ---- Stale snapshot ---------------------------------------------------------------------------
// The third way a red test is nobody's defect, and the only one where the *job* is what is wrong.
//
// Environment Tests builds only the test modules it was given; the rest of its WAR — oldcore, the
// web resources, the XARs — is the last snapshot deployed to Nexus (`okf/servers/jenkins.md`). A
// commit that adds a test *and* the production code that test needs is therefore red there until
// the next deployment, transiently and through no defect, with stack-trace line numbers that come
// from the *old* file. It looks exactly like a defect in the new test, and on 2026-09-17 it was
// two of them: `8d5a155efc` pushed `VersionIT` and `XWikiHibernateVersioningStore` together at
// 20:27, and build #1377 started 14 minutes later.
//
// What the jars held cannot be read back: XWiki's CI runs Maven without transfer progress, so no
// build log names a resolved artifact (measured on #1377: 192 KB of step console, no download
// line). The revisions bound it instead — see `deployedRevision`.

/** A production file: one the Environment Tests job takes from Nexus rather than building. */
const PRODUCTION_FILE = /\/src\/main\//;
/** …which its own test modules are not, page objects and fixtures included: those it builds. */
const TEST_MODULE = /-test(?:-[a-z]+)?\//;
const productionIn = commit =>
  commit.files.filter(path => PRODUCTION_FILE.test(path) && !TEST_MODULE.test(path));

/**
 * The newest revision the job's jars can possibly have held.
 *
 * An **upper** bound, deliberately: the main job deploys at the end of a build, so a build that had
 * started but not finished when this one began had deployed nothing, and the real snapshot is this
 * revision or older. Commits after it are certainly absent from the jars; commits before it may be.
 * Erring here means detecting less, which is the direction a detector that buys silence must fail
 * in. (Not the SUCCESS builds only: platform's main job has been `FAILURE` on every build for days
 * — the quality gate, after the deploy — and waiting for a green one would date the snapshot to
 * last week.)
 */
async function deployedRevision(main, startedAt, repo) {
  const prior = main.builds.find(build => build.timestamp <= startedAt);
  if (!prior) return null;
  return { number: prior.number, sha: await buildRevision(`${main.url}/${prior.number}`, repo) };
}

/** `14 minutes`, `3 hours` — how long before the build the commit landed. */
function shortly(before, after) {
  const minutes = Math.round((after - before) / 60000);
  if (minutes < 90) return plural(Math.max(1, minutes), 'minute');
  return plural(Math.round(minutes / 60), 'hour');
}

/**
 * Whether this incident is the job running new test code against older production code.
 *
 * The evidence is one commit doing both halves of the trap — touching the failing test class *and*
 * a production file — inside the gap between what the build could have resolved and what it checked
 * out. One commit, not two: a test change here and a production change there is an ordinary pair of
 * commits, and reading it as the trap would silence a real breakage on a coincidence.
 */
async function staleSnapshot(incident, jobs, args) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  // Failing in the environment job and *nowhere else*. The main job builds the whole repo from
  // source, so a commit carrying a test and its production code is consistent there — a test that
  // fails on both jobs is broken, whatever the snapshot held. `window.job` names only the job that
  // saw it break first, which is why this reads the jobs it is failing in now.
  const failing = incident.failingJobs || [incident.window?.job || incident.job];
  if (failing.length !== 1 || failing[0] !== 'env-tests') return null;
  if (!args.github || !token) return null;
  const env = jobs.find(job => job.label === 'env-tests');
  const main = jobs.find(job => job.label === 'main');
  const latest = env?.builds?.[0];
  // Only a failure that *started* in this build can be explained by what this build resolved. One
  // that survived the next run ran against jars that had caught up, and is a breakage.
  if (!latest || !main || incident.firstBadBuild !== latest.number) return null;
  try {
    const built = await buildRevision(`${env.url}/${latest.number}`, incident.repo);
    const deployed = await deployedRevision(main, latest.timestamp, incident.repo);
    if (!built || !deployed?.sha || built === deployed.sha) return null;
    const commits = await commitsBetween(incident.repo, deployed.sha, built, { maxCommits: 10 });
    const { groups } = forwardKeys(incident);
    const trap = commits.filter(commit => productionIn(commit).length);
    const covered = groups.filter(keys => trap.some(commit => keys.some(key => touches(commit, key))));
    if (!covered.length) return null;
    const [commit] = trap.filter(c => groups.some(keys => keys.some(key => touches(c, key)))).slice(-1);
    const production = productionIn(commit);
    return {
      kind: 'stale-snapshot',
      sha: commit.short,
      author: commit.author || commit.gitAuthor || null,
      title: commit.title,
      url: commit.url,
      where: commit.date
        ? `pushed ${shortly(Date.parse(commit.date), latest.timestamp)} before build #${latest.number} started`
        : `pushed after main build #${deployed.number}, which build #${latest.number} could not have`
          + ' resolved',
      covers: covered.map(keys => keys[keys.length - 1].replace(/\.java$/, '')),
      of: groups.length,
      partial: groups.length > 1 && covered.length < groups.length,
      reason: `it changes ${basename(production[0])} as well as the test, and Environment Tests `
        + 'builds only the test modules — the rest of its WAR is the last snapshot deployed to Nexus, '
        + 'which predates this commit'
    };
  } catch {
    return null;
  }
}

// ---- The room --------------------------------------------------------------------------------
// The fourth and fifth ways a red test is nobody's defect — and the only two the routine learns by
// listening rather than by measuring.
//
// A failure can be *announced*: "I'm pushing the reproduction test case today such that it will be
// executed tonight and fail". Nothing but the room knows that. Without it the
// sweep attributes tonight's red to the person who said it and comments on their commit — the worst
// output this tool has, because it is wrong in someone's name about something they told everyone
// about first. And a failure can be *claimed*: "I'm currently on XWIKI-23740", "I investigated the
// lock issue, it's the default isolation level on MySQL". Analysing that again is the noise.
//
// Three rules hold this together, and none of them is negotiable:
//
// 1. **Chat may suppress, never trigger.** It is untrusted text — anyone in the room writes it —
//    entering a context that writes to GitHub, JIRA and Matrix under a bot identity. If it can only
//    ever buy silence, the worst a hostile or joking message achieves is a quieter routine. The
//    asymmetry costs nothing, because suppression is where the whole value is.
// 2. **Chat never touches blame.** A culprit sourced from a joke would be wrong in someone's name.
//    Nothing here reaches `attribute`; it sets `fixState`, which *removes* a name.
// 3. **A claim decays.** Both values are anchored on the build that the incident's current streak
//    starts in, so a regression window that moves throws the claim away: "I'm on it" from last week
//    is not a reason to be quiet about a test that broke again this morning.
//
// Because this suppresses on a *sentence* where the other passes suppress on a commit, a PR or a
// timestamp, it is marked `fromChat`, and SKILL.md §6 requires the digest line it earns to be
// posted whatever else is cut. The routine's reading of the room goes back into the room, where the
// person who wrote the sentence is reading it and can say it was misread.

/** How long a claim of ownership is worth anything. Two mornings, not three. */
const CLAIM_HOURS = 48;

/**
 * A failure foretold, in the words people actually use for it.
 *
 * The window between the intent and the outcome is what this has to allow: the sentence that
 * started this whole pass is *"my plan is to push the reproduction test case on master today such
 * that it will be executed tonight and **fail**"*, where eight words separate `will` from `fail`.
 * Matching only the adjacent pair reads as narrow and is simply wrong — measured on 2026-09-18,
 * `will (?:fail|break)` misses that message, which is the one message the design exists for. So:
 * both halves, in order, inside one clause.
 */
const ANNOUNCES =
  /\b(?:will|going to|expected to|it'll)\b[^.!?\n]{0,60}?\b(?:fail|fails|break|breaks|be red|go red|turn red|not pass)\b/i;
/** …unless it says the opposite, which the same words do. */
const ANNOUNCES_NOT = /\b(?:not|never|shouldn't|should not|won't|will not|no longer)\s+(?:\w+\s+){0,3}?(?:fail|break)\b/i;
/** Somebody has taken it. */
const HANDLING =
  /\b(?:I(?:'m| am) (?:on it|on this|looking (?:at|into)|currently on|investigating|working on|debugging)|I(?:'ve| have) (?:reported|filed|opened|pushed a fix)|I(?:'ll| will) (?:fix|look at|push|handle)|working on (?:it|this)|taking (?:a look|this one))\b/i;

/** The room's messages, as `matrix.mjs --since` printed them, or none when it was not read. */
function chatOf(args) {
  if (!args.chat) return { available: false, messages: [] };
  try {
    const read = JSON.parse(readFileSync(args.chat === '-' ? 0 : args.chat, 'utf8'));
    return { available: read?.available !== false, messages: read?.messages || [] };
  } catch {
    return { available: false, messages: [] };
  }
}

/**
 * The names this incident answers to in prose: the simple class names of its failing tests, its
 * JIRA key, and its own build.
 *
 * Class names and not file names, exactly as `inFlightKeys` reasons — a chat message writes
 * `DocExtraTabsIT`, never `DocExtraTabsIT.java` — and grouped per failing class, so coverage is
 * counted in tests and an incident spanning five classes is not silenced by a sentence naming one.
 */
function chatKeys(incident) {
  const groups = forwardKeys(incident).groups
    .map(keys => keys.filter(key => key.endsWith('.java')).map(key => key.replace(/\.java$/, '')));
  return {
    groups,
    jira: incident.jira?.key || null,
    // `https://ci.xwiki.org/job/…/job/master/1377/` — the job path and the build number, which is
    // the one identifier a human pastes that matches an incident exactly rather than by name.
    build: incident.buildUrl ? incident.buildUrl.replace(/\/+$/, '') : null,
    // The packages and methods the incident's own tests are in, to tell its `ImageIT` from the
    // other `ImageIT`s the room talks about. See `namesIncident`.
    packages: [...new Set((incident.tests || []).map(id => id.split('#')[0].split(/[.$]/).slice(0, -1))
      .filter(parts => parts.length > 1).map(parts => parts.join('.')))],
    methods: [...new Set((incident.tests || []).map(id => id.split('#')[1]).filter(Boolean))]
  };
}

// A chat message is the *weakest* evidence any pass here runs on — a sentence, written by anyone,
// naming a class by the short name three modules happen to share — and it is the only evidence that
// buys silence without a build, a commit or a PR behind it. So it is matched more strictly than a
// pull request is, not more loosely, and these two guards are why.
//
// Both are contradictions, never requirements: a message that says nothing about the package or the
// method still matches, because that is how people write. It is a message that names a *different*
// one that is thrown away. Measured on the live room, 2026-09-18: without them, a discussion of
// `org.xwiki.ckeditor…ImageIT` on stable-18.8.x was attached to `org.xwiki.blocknote…ImageIT#editImage`
// on master, on nothing but the four letters they share.

/** Whether the message talks about some other module's class of the same name. */
const otherPackage = (message, keys) => {
  const named = message.names?.packages || [];
  return !!named.length && !!keys.packages.length
    && !named.some(one => keys.packages.some(ours => ours.startsWith(one) || one.startsWith(ours)));
};

/** Whether the message pins a method, and every method it pins belongs to some other failure. */
const otherMethod = (message, keys) => {
  const pinned = (message.names?.tests || []).filter(name => name.includes('#'));
  return !!pinned.length && !!keys.methods.length
    && !pinned.some(name => keys.methods.includes(name.split('#')[1]));
};

/** Whether `message` names this incident at all — the mechanical half, before any judging. */
function namesIncident(message, keys) {
  if (otherPackage(message, keys) || otherMethod(message, keys)) return null;
  const named = new Set(message.names?.tests || []);
  if (keys.jira && (message.names?.jira || []).includes(keys.jira)) return keys.groups;
  if (keys.build && (message.names?.builds || []).some(url => url.replace(/\/+$/, '') === keys.build)) {
    return keys.groups;
  }
  // A group is named when the message names the class, however it wrote it — bare, or with the
  // method, which `namesIn` emits both of.
  const covered = keys.groups.filter(group => group.some(name => named.has(name)
    || [...named].some(token => token.split('#')[0] === name)));
  return covered.length ? covered : null;
}

/**
 * What the room already said about this incident: an announcement made *before* the build that
 * shows it, or a claim of ownership made *after* it and still fresh.
 *
 * The two guards are timestamps, not prose, and they are what makes a sentence usable at all. An
 * announcement that post-dates the red build is a comment on it, not a warning; a claim that
 * pre-dates it was about a previous occurrence of the same test, which is precisely the "I'm on it
 * from last week" this must not honour.
 *
 * Fails open like every other pass: no chat file, an unreadable room, a message that matches
 * nothing — the incident is left exactly as it was, reported and attributed.
 */
function chatClaim(incident, chat, want) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  const brokeAt = incident.window?.firstBad?.timestamp;
  if (!brokeAt) return null;
  const keys = chatKeys(incident);
  if (!keys.groups.length || keys.groups.some(group => !group.length)) return null;
  const fresh = Date.now() - CLAIM_HOURS * 3600 * 1000;
  const wanted = message => {
    const at = Date.parse(message.at);
    return want === 'announced'
      ? at < brokeAt && ANNOUNCES.test(message.body) && !ANNOUNCES_NOT.test(message.body)
      : at >= brokeAt && at >= fresh && HANDLING.test(message.body);
  };
  const matched = chat.messages
    .map(message => ({ message, covers: wanted(message) ? namesIncident(message, keys) : null }))
    .filter(entry => entry.covers);
  if (!matched.length) return null;
  // The most explanatory message wins, and the most recent of those — the same rule `inFlightFix`
  // uses to avoid pointing a reader at the narrower of two answers.
  const [{ message }] = [...matched].reverse().sort((a, b) => b.covers.length - a.covers.length);
  // Coverage is counted over *every* matching message, as the other passes count it over every
  // commit: two people naming one failing class each answer for both, and only a full house is
  // `settled` and goes quiet.
  const covered = keys.groups.filter(group => matched.some(entry => entry.covers.includes(group)));
  return {
    kind: want,
    fromChat: true,
    author: message.sender,
    // Quoted, and bounded: what goes in the work order is evidence of what was said, not a channel
    // through which a long message reaches a model's instructions.
    title: `"${message.body.replace(/\s+/g, ' ').trim().slice(0, 200)}"`,
    url: message.permalink,
    at: message.at,
    where: want === 'announced'
      ? `said in the room ${shortly(Date.parse(message.at), brokeAt)} before build `
        + `#${incident.firstBadBuild} ran`
      : `said in the room on ${message.at.slice(0, 16).replace('T', ' ')}, after build `
        + `#${incident.firstBadBuild}`,
    covers: covered.map(group => group[group.length - 1]),
    of: keys.groups.length,
    partial: keys.groups.length > 1 && covered.length < keys.groups.length,
    reason: want === 'announced'
      ? 'the room was told this failure was coming, so the commit it would be pinned on did not '
        + 'break anything that was working'
      : 'somebody in the room has said they are on it, within the last two days and after this '
        + 'build'
  };
}

/**
 * Every message that names this incident, whatever it says about it.
 *
 * Separate from `chatClaim` on purpose: suppression needs a phrase and a timestamp to agree, but
 * *citing* the room needs neither. "I investigated the lock issue, it's the default isolation level
 * on MySQL — XWIKI-25019" suppresses nothing and is the single most useful line the digest can
 * carry about that incident, because the analysis is done and published and the routine's own would
 * be a worse copy of it.
 */
function mentionsOf(incident, chat) {
  if (incident.beyondHorizon || !chat.messages.length) return [];
  const keys = chatKeys(incident);
  if (!keys.groups.length) return [];
  return chat.messages.filter(message => namesIncident(message, keys)).map(message => ({
    at: message.at,
    sender: message.sender,
    said: message.body.replace(/\s+/g, ' ').trim().slice(0, 200),
    permalink: message.permalink
  }));
}

// The same claim, made where it is most often made. A flicker issue's comments are chat with an
// address on the envelope: attributable and topical by construction, so the matching costs nothing
// — there is no incident to match, the issue *is* the incident's issue. One anonymous read per key,
// cached, and only for an incident that has a key at all.

const issueComments = new Map();
const commentsOn = (key) => {
  if (!issueComments.has(key)) {
    issueComments.set(key, (async () => {
      try {
        const res = await fetch(`${JIRA}/rest/api/2/issue/${encodeURIComponent(key)}` +
          '?fields=comment', { headers: { Accept: 'application/json' } });
        if (!res.ok) return [];
        const body = await res.json();
        return (body?.fields?.comment?.comments || []).map(comment => ({
          at: comment.created,
          author: comment.author?.displayName || comment.author?.name || null,
          body: String(comment.body || '')
        }));
      } catch {
        return [];
      }
    })());
  }
  return issueComments.get(key);
};

/**
 * Whether the incident's own JIRA issue says somebody is on it, said after this break and recently.
 *
 * Bounded exactly as the chat claim is, and for the same reason: a flicker issue collects "I'm
 * looking at this" comments over months, and honouring a year-old one would silence the test
 * forever. Unlike chat this answers for the whole incident only when the incident *is* that issue's
 * test — the key is the first failing test's flicker issue, and a comment on it says nothing about
 * four other classes that broke in the same build.
 */
async function issueClaim(incident) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  const key = incident.jira?.key;
  const brokeAt = incident.window?.firstBad?.timestamp;
  // No GitHub gate: the flicker lookup already reads JIRA anonymously on every run, so the issue
  // this incident is tracked as is known even in the cheap mode, and asking it one more question
  // costs one anonymous GET, cached per key.
  if (!key || !brokeAt) return null;
  const { groups } = chatKeys(incident);
  if (groups.length !== 1) return null;
  const fresh = Date.now() - CLAIM_HOURS * 3600 * 1000;
  const [comment] = (await commentsOn(key)).filter(entry => {
    const at = Date.parse(entry.at);
    return at >= brokeAt && at >= fresh && HANDLING.test(entry.body);
  }).slice(-1);
  if (!comment) return null;
  return {
    kind: 'being-handled',
    fromChat: true,
    author: comment.author,
    title: `"${comment.body.replace(/\s+/g, ' ').trim().slice(0, 200)}"`,
    url: `${JIRA}/browse/${key}`,
    at: comment.at,
    where: `commented on ${key} on ${String(comment.at).slice(0, 16).replace('T', ' ')}, after `
      + `build #${incident.firstBadBuild}`,
    covers: groups[0].slice(-1),
    of: 1,
    partial: false,
    reason: `its own issue ${key} carries somebody saying they are on it, within the last two days `
      + 'and after this build'
  };
}

// ---- Fixed elsewhere --------------------------------------------------------------------------
// The fourth place the answer already exists, and the only one that is not on this branch at all.
//
// Commons, Rendering and Platform are developed on master and maintained on several stable
// branches, so a break reaches all of them and the fix is written once — on master, usually — and
// backported. A stable branch analysed from scratch at 06:00 is therefore a morning spent
// re-deriving a conclusion that has been a commit on another branch for a week, and the reader
// knows it. Nobody reads three branches side by side; the sweep already visits them all.
//
// What this buys is a *name*: the sha to hand to `xwiki-backport`. What it must never do is open
// the backport itself, or state the fix as a fact — a signature also goes green when the test is
// deleted. For a test that is excluded by construction below (it must still have *run* there); for
// a build break only the reader can tell, which is why the wording stays "verify before
// backporting" everywhere it is printed.

/** Branches ordered as a fix travels: master, then the newest LTS, then the rest. */
function branchRank(branch) {
  const { class: branchClass, cycle } = classifyBranch(branch);
  return { dev: 0, lts: 1, transient: 2 }[branchClass] * 1000 - (cycle ?? 0);
}

// Four, not every branch there is: the ones a fix is written on come first, and a sweep that walks
// eight branches' test reports looking for one sha has stopped being cheap.
const PEER_BRANCHES = 4;

/** The same job on the other maintained branches of this repo, best first. */
async function peerJobsOf(incident, targets, args) {
  // The job that is failing, not the repo's main one: a test red in the environment matrix is
  // answered by the environment matrix of another branch, and the two number their builds — and
  // run their tests — independently.
  const label = incident.failingJobs?.[0] || incident.window?.job || incident.job || 'main';
  const peers = targets
    .filter(target => target.repo === incident.repo && target.branch !== incident.branch
      && !(incident.alsoOn || []).includes(target.branch))
    .sort((a, b) => branchRank(a.branch) - branchRank(b.branch))
    .slice(0, PEER_BRANCHES);
  const out = [];
  for (const peer of peers) {
    const job = peer.jobs.find(entry => entry.label === label);
    if (job) out.push({ branch: peer.branch, job: await jobHistory(job, args.history) });
  }
  return out;
}

// Two consecutive failures, then two consecutive passes: what a fix looks like in a test report,
// and what flakiness does not. A test that failed once and passed once has said nothing — and a
// flicker on the peer branch produces exactly that pattern all day, which would otherwise be read
// as "fixed there" and buy silence about a real breakage here.
const HEALED_RUN = 2;

/**
 * Where these tests went red→green on a peer branch, as a *fix* and not as a flicker.
 *
 * @returns {Promise<{lastBad: object, firstGood: object, covered: string[]}|null>} `covered` is the
 *   subset of the tests answered by the one transition — the rest is still broken on both branches.
 */
async function healedTests(job, ids, args) {
  const builds = job.tested.slice(0, args.history);
  if (builds.length < HEALED_RUN * 2) return null;
  const [latest] = builds;
  const now = await outcomesOf(`${job.url}/${latest.number}`);
  // Ran *and* passed, so the walk below is paid for only where there is something to walk. A test
  // simply absent from the peer's report — deleted there, or in a module that branch no longer
  // builds — is the one way this pass could hand a reader a "fix" that removes the test, and
  // reading `ran` is the whole of the guard against it.
  const alive = ids.filter(id => now.ran.has(id) && !now.failed.has(id));
  if (!alive.length) return null;
  // Newest first, and only the builds that ran the test: a build that skipped it says nothing in
  // either direction, so counting it as a pass would turn a skipped module into a fix.
  const history = [];
  for (const build of builds) {
    const outcome = await outcomesOf(`${job.url}/${build.number}`);
    history.push({ build, outcome });
  }
  const transitions = new Map();
  for (const id of alive) {
    const seen = history.filter(entry => entry.outcome.ran.has(id));
    const green = seen.findIndex(entry => entry.outcome.failed.has(id));
    if (green < HEALED_RUN) continue;
    const older = seen.slice(green);
    const back = older.findIndex(entry => !entry.outcome.failed.has(id));
    // `-1` is a run of failures reaching the end of the fetched history, which is as long as the
    // history is — not an unbounded one, and not a pass.
    if ((back === -1 ? older.length : back) < HEALED_RUN) continue;
    const key = `${seen[green].build.number}→${seen[green - 1].build.number}`;
    transitions.set(key, {
      lastBad: seen[green].build,
      firstGood: seen[green - 1].build,
      covered: [...(transitions.get(key)?.covered || []), id]
    });
  }
  if (!transitions.size) return null;
  // One fix is one transition. Where the incident's tests healed in different builds, the largest
  // group is the one a single commit can answer for, and the rest is reported as unanswered.
  return [...transitions.values()].sort((a, b) => b.covered.length - a.covered.length)[0];
}

/** The same build-break signature, red and then green again, on a peer branch. */
async function healedBreak(job, signature, args) {
  const [latest, ...older] = job.builds;
  // A peer that is red right now says nothing worth a stage log: either it carries this break too —
  // which is `also-red`, not a fix — or it carries another one, and diagnosing it is how the sweep
  // would pay for every branch's console to learn that.
  if (!latest || latest.result === 'FAILURE') return null;
  let firstGood = latest;
  let read = 0;
  for (const build of older) {
    if (build.result === 'FAILURE') {
      if (read >= args.maxConsole) return null;
      read++;
      const { signature: found } = await diagnose(`${job.url}/${build.number}`);
      if (`${job.label}:${found}` === signature) return { lastBad: build, firstGood, covered: [signature] };
    }
    // Red for another reason is still a build this break was absent from, so it bounds the range
    // as tightly as a green one.
    firstGood = build;
  }
  return null;
}

/** The commit that did it, between the peer's last red build and its first green one. */
async function fixingCommit(incident, peer, healed) {
  const baseSha = await buildRevision(`${peer.job.url}/${healed.lastBad.number}`, incident.repo);
  const headSha = await buildRevision(`${peer.job.url}/${healed.firstGood.number}`, incident.repo);
  if (!baseSha || !headSha || baseSha === headSha) return null;
  const commits = await commitsBetween(incident.repo, baseSha, headSha);
  if (!commits.length) return null;
  const { groups, words } = forwardKeys(incident);
  const paths = groups.flat();
  // Blame's own two tests, pointed at the branch that healed: the failing file among a commit's
  // changed files, then — for a dependency break, which changes a pom and nothing else — the
  // library among the words of its subject. Where neither hits, a range of exactly one commit names
  // itself, and anything wider is a window, not a fix. A window is not something to hand to
  // `xwiki-backport`, so it is reported as no answer at all and the incident is analysed the
  // ordinary way.
  const [byPath] = commits.filter(commit => paths.some(key => touches(commit, key))).slice(-1);
  const [byWord] = commits.filter(commit => words.some(word => names(commit, word))).slice(-1);
  // A flicker stops failing on its own, and commits land in the window while it does — so for one
  // of those the range naming a single commit is a coincidence, not a fix, and naming its author in
  // the digest is the one mistake this design cannot afford. A systematic breakage does not fix
  // itself: there, the only commit between the last red build and the first green one is the fix.
  const alone = incident.kind !== 'flicker' && commits.length === 1;
  const commit = byPath || byWord || (alone ? commits[0] : null);
  if (!commit) return null;
  const total = incident.class === 1 ? ((incident.tests || []).length || 1) : 1;
  return {
    kind: 'fixed-elsewhere',
    sha: commit.short,
    author: commit.author || commit.gitAuthor || null,
    title: commit.title,
    url: commit.url,
    branch: peer.branch,
    where: `${peer.branch} has been green again since ${peer.job.label} #${healed.firstGood.number}`,
    covers: incident.class === 1
      ? [...new Set(healed.covered.map(id => testName(id).split('#')[0]))].slice(0, 6)
      : [healed.covered[0].split('/').pop()],
    of: total,
    partial: healed.covered.length < total,
    reason: byPath ? `it touches ${paths.find(key => touches(commit, key))}, which the failure names`
      : byWord ? `its subject names ${words.find(word => names(commit, word))}, which the failure reports`
        : 'it is the only commit between the last red build there and the first green one'
  };
}

/**
 * The commit on another branch that already answers this incident, if there is one.
 *
 * Fails open like every other pass here: a peer that cannot be read, a missing token, a range that
 * names no single commit — each leaves the incident exactly as it was, reported and attributed.
 */
async function fixedElsewhere(incident, targets, args) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  // Only a break that named itself. A quality gate fails on the whole project's aggregate coverage
  // and issue counts, so no commit anywhere "fixed" it — and measured on 2026-09-18, this pass
  // offered an unrelated bug fix from a third branch as the fix for the gate on two others, which
  // is the wrong-name-in-public failure the whole gate exists to prevent. `unclassified` is the
  // same risk one step weaker: its signature is a normalised error message, and the same message on
  // another branch is not evidence of the same cause.
  if (incident.class === 2 && (incident.kind !== 'build-break'
    || /sonar-gate:failed$/.test(incident.signature || ''))) return null;
  if (!args.github || !token) return null;
  const ids = (incident.tests || []).slice(0, 20);
  if (incident.class === 1 && !ids.length) return null;
  for (const peer of await peerJobsOf(incident, targets, args)) {
    try {
      const healed = incident.class === 1
        ? await healedTests(peer.job, ids, args)
        : await healedBreak(peer.job, incident.signature, args);
      const fix = healed && await fixingCommit(incident, peer, healed);
      if (fix) return fix;
    } catch {
      // A branch whose history or revisions cannot be read is a branch that says nothing.
    }
  }
  return null;
}

// ---- Sweep -----------------------------------------------------------------------------------

/** Every job of every maintained branch, discovered from Jenkins rather than hardcoded. */
async function discover(repos, only) {
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
  const policy = new Map(withPolicy([...new Set([...targets.values()].map(t => t.branch))])
    .map(entry => [entry.branch, entry]));
  return [...targets.values()].map(target => ({ ...target, ...policy.get(target.branch) }));
}

/** One job's recent completed builds, newest first, plus the ones that produced test results. */
const historyCache = new Map();
function jobHistory(job, history) {
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
const outcomesOf = buildUrl => {
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
async function breakWindow(job, latest, signature, maxConsole) {
  const at = (firstBad, lastGood, atLeast) => ({ job: job.label, jobUrl: job.url, firstBad, lastGood, atLeast });
  let firstBad = latest;
  let read = 1;
  for (const build of job.builds.slice(job.builds.indexOf(latest) + 1)) {
    if (build.result === 'SUCCESS' || build.result === 'UNSTABLE') return at(firstBad, build, false);
    if (read >= maxConsole) return at(firstBad, null, true);
    read++;
    const { signature: older } = await diagnose(`${job.url}/${build.number}`);
    // A different cause: the current break starts at the build after this one.
    if (older !== signature) return at(firstBad, build, false);
    firstBad = build;
  }
  return at(firstBad, null, true);
}

// ---- Incident assembly -----------------------------------------------------------------------

const incidentId = (target, signature) => `${target.repo.replace(/^xwiki-/, '')}/${target.branch}/${signature}`;

async function incidentsOf(target, args, flickerFor) {
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
    const diagnosis = await diagnose(`${job.url}/${latest.number}`);
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
      incidents.push({
        ...base(target, 1, 'flicker', id),
        state: verdict,
        tests: [id],
        evidence: [row.detail || '(no error detail)'],
        failedIn: `${failedBuilds}/${seenBuilds} builds, ${row.failedEnvs.size}/${row.ranEnvs.size} envs`,
        // The same ratio as a number, for the one decision that has to compare two flickers: which
        // of them a repeat run can actually catch failing (the stabilisation pick below).
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
      });
    } else {
      breakages.push({ id, row, window, verdict, pseudo: isPseudoTest(id) });
    }
  }

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
  ageIsLowerBound: window.atLeast
});

// ---- Blame + dedupe pass ---------------------------------------------------------------------

/**
 * Attribution and the "did we already say this?" check, for the incidents that earned the budget.
 *
 * Beyond the horizon nothing is attributed: feedback is only feedback while it is actionable, and
 * a fortnight-old breakage is archaeology the team already knows about. It also bounds the blast
 * radius on day one, when the branch has been red for weeks.
 */
async function investigate(incident, job, args) {
  if (incident.blame) return;
  if (incident.kind === 'timeout') {
    incident.blame = { tier: 'none', reason: 'a stage that ran out of time has no single culprit', suspects: [] };
    return;
  }
  if (incident.beyondHorizon) {
    incident.blame = { tier: 'none', reason: `older than the ${args.horizon}-day horizon`, suspects: [] };
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
  // A quality gate fails on aggregate coverage and issue counts over the whole project, not on a
  // change — so file overlap has nothing to overlap and the five commits in the window are five
  // people named under a failure none of them can be shown to have caused. There *is* an author —
  // SonarCloud carries the file, the line and the SCM author of every new-code issue under the
  // failing condition — but it is found there and not here, which is what SKILL.md §3 sends the
  // report to do.
  if (/sonar-gate:failed$/.test(incident.signature || '')) {
    incident.blame = {
      tier: 'none', suspects: [],
      reason: 'a quality gate fails on aggregate metrics, not on one change — `sonar.culprits` '
        + 'names the authors of the code under the failing condition instead'
    };
    return;
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

// ---- Budget ----------------------------------------------------------------------------------
// A ceiling, not a target: everything below the line is still reported, just without root-cause
// analysis. Ordered by what blocks the most people first, and — for the top entry — by what is
// also cheapest to attribute, since a build break names the file it broke.

function severity(incident) {
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
  if (incident.class === 1 && incident.kind === 'flicker' && !incident.jira) return 4;
  if (incident.class === 3) return 5;
  return 5.5;
}

// ---- The paste ---------------------------------------------------------------------------------
// Rendered here, not by the model, for one reason: the paste is read every morning, and a document
// whose shape is re-invented each day is read as a new document each day.
//
// The shape is a table per branch — *what fails*, *why*, *what happens next and who does it* — over
// a collapsed block of evidence per row. That order is the document's argument: a reader who owns
// none of this is done after the tables, and a reader who owns one row opens one block. Nothing the
// sweep knows has been dropped; what changed is that the evidence no longer arrives before the
// answer, and that the rules the sweep obeys are no longer restated to the people who wrote them —
// they are in SKILL.md, which is where they belong.
//
// Three cells cannot be rendered, because they are the conclusion and not a field: a `deep`
// incident's *why* and *next* are one `<!-- WHY: id -->` / `<!-- NEXT: id -->` marker each, and its
// root cause is the `<!-- ANALYSIS: id -->` line inside its block. SKILL.md §6 fills all three.

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const agedAs = incident => (incident.ageDays == null
  ? 'age unknown'
  : `${incident.ageIsLowerBound ? '≥' : ''}${incident.ageDays}d`);

/**
 * When the failure started — or, honestly, that it is not known.
 *
 * `firstBadBuild` with no `lastGoodBuild` means the sweep ran out of history (or of log budget)
 * before it found a green build, so that number is how far it looked and not when the break began.
 * Printing it as "since #N" is how the same unchanged incident comes out dated differently every
 * morning, and a digest whose dates move is one nobody checks.
 */
function windowOf(incident) {
  if (incident.firstBadBuild == null) return null;
  return incident.lastGoodBuild == null
    ? `failing in every build examined, back to #${incident.firstBadBuild} — start not established`
    : `since #${incident.firstBadBuild}, last good #${incident.lastGoodBuild}`;
}

const testName = id => {
  const [className, method] = String(id).split('#');
  const simple = className.split(/[.$]/).pop().replace(/^Nested/, '');
  return method ? `${simple}#${method}` : simple;
};
const shortName = incident => testName(incident.id.split('/').slice(2).join('/'));
const analysis = incident => (incident.deep ? [``, `<!-- ANALYSIS: ${incident.id} -->`] : []);
/** How an answer is named in prose — a sha, a PR by its number, or the person who said it. */
const fixName = fix => (fix.kind === 'fix-in-flight' ? `PR #${fix.number}`
  : fix.fromChat ? `${fix.author || 'somebody'}` : fix.sha);
const fixRef = fix => (fix.kind === 'fix-in-flight' ? `PR #${fix.number}`
  : fix.fromChat ? `[what was said](${fix.url})` : `\`${fix.sha}\``);
/**
 * The headline each kind of answer earns, and what closes its paragraph.
 *
 * The wording is the whole difference between the two: a commit that touches the failing file has
 * landed and will be judged by the next build, whereas a PR naming the test is somebody's intent —
 * it may be the fix, it may be a rewrite that touches it, and it may never merge. Both buy the
 * same silence; only one of them may be reported as a fix.
 */
const FIX_HEAD = {
  'fix-unbuilt': {
    whole: 'Possibly fixed already', part: 'Part of this may be fixed already', link: 'by',
    quiet: 'Not analysed, nobody pinged — the next build settles it.'
  },
  'fix-in-flight': {
    whole: 'A fix may be in flight', part: 'Part of this may be in flight', link: '—',
    quiet: 'Not analysed, nobody pinged — the PR is where this gets settled.'
  },
  'stale-snapshot': {
    whole: 'Ran against a stale snapshot', part: 'Part of this ran against a stale snapshot',
    link: '—',
    quiet: 'Not analysed, nobody pinged — the next Environment Tests run has the production code.'
  },
  announced: {
    whole: 'Announced in the room before it broke', part: 'Part of this was announced in the room',
    link: '—',
    quiet: 'Not analysed, nobody pinged — the room was told this was coming, so the commit this '
      + 'would otherwise be pinned on broke nothing that was working.'
  },
  'being-handled': {
    whole: 'Somebody has said they are on it', part: 'Part of this is claimed',
    link: '—',
    quiet: 'Not analysed, nobody pinged — it is claimed, and the claim is at most two days old.'
  },
  'fixed-elsewhere': {
    whole: 'Already fixed on another branch', part: 'Part of this is fixed on another branch',
    link: 'by',
    quiet: 'Not analysed, nobody pinged — this is a backport candidate: hand the commit to'
      + ' `xwiki-backport`, and verify it first, since a signature also goes green when the test is'
      + ' deleted.'
  }
};
/**
 * What the room said about this incident, minus whatever is already quoted above it as the answer.
 *
 * This is the half of the room read that suppresses nothing: somebody has found the cause, filed
 * the issue or claimed the test, and none of that is visible on any dashboard. Cited, never
 * summarised — the permalink goes back to the sentence, in its own context, where the person who
 * wrote it can see how it was read.
 */
const said = incident => (incident.chat || [])
  .filter(message => message.permalink !== incident.fixState?.url);
const chatBlock = incident => (said(incident).length
  ? ['', '**Said in the room** — the analysis may already be done:',
    ...said(incident).map(message =>
      `- **${message.sender}**, ${message.at.slice(0, 16).replace('T', ' ')}: "${message.said}" ` +
      `[link](${message.permalink})`)]
  : []);

/**
 * What the quality gate failed on, and whose code is under it.
 *
 * Printed wherever the incident is — deep or not — because for a gate failure this *is* the
 * evidence: the stage log's one line says only that the gate failed, and everything a reader needs
 * in order to act is here. The names are the authors of the code under the failing condition, which
 * is a weaker claim than "broke the build" and is worded as one.
 */
function sonarBlock(incident) {
  const sonar = incident.sonar;
  if (!sonar) return [];
  const out = ['', `**Quality gate — ${sonar.conditions.map(condition =>
    `${condition.name} is ${condition.actual}, the gate wants ${condition.threshold}`).join('; ')}**` +
    ` (new code: ${sonar.newCodePeriod}${sonar.newCodeSince ? `, since ${sonar.newCodeSince}` : ''}).`];
  if (sonar.total > sonar.issues.length) {
    out.push(`${sonar.total} issues fail it; the newest ${sonar.issues.length} are what turned it red:`);
  }
  for (const issue of sonar.issues) {
    out.push(`- \`${issue.file.split('/').pop()}:${issue.line ?? '?'}\` — ${issue.rule}` +
      `${issue.severity ? ` (${issue.severity})` : ''}, raised ${issue.raisedOn} — ${issue.message}` +
      `${issue.author ? `\n    author: ${issue.author}` : ''}` +
      `${issue.commit ? `${issue.author ? ' ·' : '\n   '} introduced by \`${issue.commit.short}\`` +
        ` (${issue.commit.author}, ${issue.commit.date}) — ${issue.commit.title}`
        : `${issue.author ? ' ·' : '\n   '} no commit touched this file when it was raised — an existing` +
          ' line, newly reported'}`);
  }
  if (sonar.unequivocal && sonar.target) {
    out.push(`_One person put all of this here — ${sonar.target.kind === 'pr'
      ? `comment on **PR #${sonar.target.number}** (${sonar.target.url})`
      : `comment on **\`${sonar.target.short}\`** (${sonar.target.url})`}, per §4._`);
  } else if (sonar.culprits?.length) {
    out.push(`_Whose code: ${sonar.culprits.map(entry => `**${entry.who}** (${plural(entry.issues, 'issue')}` +
      `${entry.commits.length ? `, ${entry.commits.join(', ')}` : ''})`).join(', ')}._` +
      `${sonar.equivocalBecause ? ` _Reported and not pinged: ${sonar.equivocalBecause}._` : ''}`);
  } else if (sonar.equivocalBecause) {
    out.push(`_Nobody is named: ${sonar.equivocalBecause}._`);
  }
  out.push(`_The gate: ${sonar.url}_`);
  if (sonar.issuesUnavailable) out.push(`_Could not list the issues: ${sonar.issuesUnavailable}._`);
  return out;
}

/**
 * What 28 days of executions say about this test, as against what tonight's job says.
 *
 * Printed above the blame on purpose: it is the block that decides whether there is a culprit to
 * look for at all. A test that has been failing 2% of the time since August was not broken by a
 * commit in tonight's window, however well that commit's files overlap — and the configuration
 * enrichment ("only on Chrome") is a cause, where a red square is only a symptom.
 *
 * The analyser's own sentences are quoted, not paraphrased: they carry p-values, and rewording a
 * p-value is how a hedge becomes a claim.
 */
function develocityBlock(incident) {
  const facts = incident.develocity;
  if (!facts) return [];
  const started = facts.firstSeen
    ? `first failed ${facts.firstSeen} (${facts.firstSeenDays}d ago), last ${facts.lastSeen}`
    : 'start not established';
  const out = ['',
    `**Develocity — ${facts.windowDays} days, every branch** (\`${testName(facts.test)}\`` +
    `${incident.testCount > 1 ? ', the test naming this incident' : ''}): ` +
    `${facts.failures} failures in ${facts.runs} executions (${facts.failRate}), ${started}.`,
    // The one line that reconciles the two ages, because they look like a contradiction otherwise.
    `_The age above is the current streak in the builds Jenkins retains; this is when the failure ` +
    `started._`];
  // Only where it disambiguates: with one distinct failure the findings below say so in a sentence,
  // and a line repeating it in numbers is the kind of padding that makes a paste stop being read.
  if (facts.group && facts.distinct > 1) {
    out.push(`- This incident is ${facts.group.label} \`${facts.group.exception}\` — ` +
      `${facts.group.count} of ${facts.failures} failures (${facts.group.share}), ` +
      `${facts.distinct} distinct failures in all`);
  }
  for (const finding of facts.findings) out.push(`- ${finding}`);
  // The per-configuration *rates*, which the findings do not carry: "3/26 on Chrome+PostgreSQL" is
  // what a repeat run has to reproduce, and S8's oracle needs the configuration to run it on.
  if (facts.configs.length) out.push(`- Concentrated in: ${facts.configs.join(' | ')}`);
  if (facts.scans.length) out.push(`- Build scans: ${facts.scans.join(' · ')}`);
  if (facts.artifacts) {
    out.push(`- Archived by Jenkins (${facts.artifacts.config}): ` +
      [facts.artifacts.screenshot && `[screenshot](${facts.artifacts.screenshot})`,
        facts.artifacts.video && `[video](${facts.artifacts.video})`].filter(Boolean).join(' · '));
  }
  // The analyser's full report is *not* named here. It is a path in a temp directory on the machine
  // that ran the sweep — live for the pass that writes the analysis, which reads it from the work
  // order's `develocity.report`, and gone by the time anybody opens the paste.
  return out;
}

function evidenceBlock(incident) {
  if (!incident.evidence?.length) return [];
  // ` | ` between them, never a comma: one environment is itself a comma-separated row ("MySQL
  // latest, Tomcat 11-jdk25, Filesystem, Chrome"), so joining two with commas makes eight facets
  // of one imaginary environment.
  return ['', '```', ...incident.evidence, '```', ...(incident.envs?.length
    ? [`Failing environments: ${incident.envs.join(' | ')}`] : [])];
}

/**
 * The one paragraph an incident somebody has already answered gets, in place of everything else.
 *
 * Hedged, always, because the claim rests on a name overlap and not on a green build: what settles
 * it is the next build, or the merge, and this paragraph exists only to stop the routine arguing
 * with people who have already moved on.
 */
function fixBlock(incident) {
  const fix = incident.fixState;
  if (!fix) return [];
  const head = `${fixRef(fix)} **${fix.author || '(unknown)'}** — ${fix.title}`;
  const where = fix.where[0].toUpperCase() + fix.where.slice(1);
  if (fix.partial) {
    const rest = fix.of - fix.covers.length;
    return ['', `**${FIX_HEAD[fix.kind].part}** — ${head}`,
      `${where}; ${fix.reason}. It covers ${fix.covers.join(', ')} — the other ` +
      `${plural(rest, 'failing test')} ${rest === 1 ? 'is' : 'are'} left unanswered, so this incident stands.`];
  }
  // Where the incident spans several tests, the commit or PR named above answers for one of them
  // and the sentence has to say what answers for the rest — otherwise the line reads as a fix for a
  // test it does not mention.
  const whole = fix.of > 1
    ? ` All ${fix.of} failing tests (${fix.covers.join(', ')}) are answered the same way.`
    : '';
  return ['', `**${FIX_HEAD[fix.kind].whole}** — ${head}`,
    `${where}; ${fix.reason}.${whole} ${FIX_HEAD[fix.kind].quiet}`];
}

function blameBlock(incident) {
  // Before the `blame` guard, not after: a settled incident is never deep, and the work order
  // carries no blame for an incident below the line — so testing `blame` first would drop the one
  // line that says why nothing was written. A *partial* fix is printed above the blame it does
  // not cancel.
  if (settled(incident)) return fixBlock(incident);
  const out = fixBlock(incident);
  const blame = incident.blame;
  if (!blame) return out;
  if (blame.culprit) {
    out.push('', `Blame **${blame.tier}** — ${blame.reason}.`,
      `Culprit: \`${blame.culprit.short}\` **${blame.culprit.author || '(unknown)'}** — ` +
      `${blame.culprit.title} [${plural(blame.culprit.filesChanged ?? 0, 'file')}]`);
  } else if (blame.suspects?.length) {
    out.push('', `Blame **${blame.tier}** — ${blame.reason}.`);
  }
  // With neither a culprit nor a suspect there is nothing here to show: "nobody is pinged, because
  // a gate has no single author" is the row's own *next* cell, and printing the same sentence again
  // under the evidence is how a three-incident morning came to read as a wall of text.
  for (const suspect of blame.suspects || []) out.push(`- ${suspect}`);
  if (incident.silent) out.push(`_Already commented in this state (${incident.notified?.state}) — saying nothing._`);
  return out;
}

/** What two incidents on two branches share when they are one break: the repo, and the signature. */
const causeKey = incident => `${incident.repo}\u0000${incident.id.split('/').slice(2).join('/')}`;

/** Whether this incident is the red quality gate, which is a build break with its own vocabulary. */
const isGate = incident => /sonar-gate:failed$/.test(incident.signature || '');

/**
 * Release-blocking, as §5 means it — recomputed here from the digested incident rather than shared
 * with the run's own `blocksRelease`, which reads fields (`alerting`) the work order does not carry.
 */
const blocking = incident => incident.branchClass !== 'transient' && incident.primary !== false
  && !settled(incident) && (incident.class === 2
    || (incident.class === 1 && incident.state === 'systematic' && !incident.beyondHorizon));

/** What a reader calls the thing that is red, as plain text — the table and the summary style it. */
function subjectOf(incident) {
  if (isGate(incident)) return 'Sonar quality gate';
  if (incident.class === 1) return shortName(incident);
  if (incident.class === 3) return incident.state || 'infrastructure';
  return incident.signature ? incident.signature.split('/').pop() : incident.kind;
}

/** What kind of red it is, in two or three words. */
function kindOf(incident) {
  if (isGate(incident)) return 'quality gate';
  if (incident.class === 2) return 'build break';
  if (incident.class === 3) return 'infrastructure';
  if (incident.class === 1) {
    const what = incident.kind === 'test-breakage' ? 'breakage' : 'flicker';
    return incident.testCount > 1 ? `${what}, ${plural(incident.testCount, 'test')}` : what;
  }
  return incident.kind;
}

const STATE_WORDS = {
  systematic: 'fails every run', 'single env': 'one environment, every build',
  'first seen': 'seen once', intermittent: 'intermittent'
};

/**
 * Column two when the renderer can answer it: the mechanical *why*.
 *
 * A gate is the one failure whose real explanation is already a field — the condition it failed and
 * the value it wanted — so it is written here and no analysis slot is spent restating two nouns.
 * Everything else below the deep line gets the numbers that distinguish it from its neighbours (how
 * often, over what, in how many environments), which is as far as a renderer can honestly go.
 */
function whyOf(incident) {
  if (incident.sonar?.conditions?.length) {
    return incident.sonar.conditions
      .map(condition => `${condition.name} is ${condition.actual}, the gate wants ${condition.threshold}`)
      .join('; ');
  }
  if (incident.class === 3) return 'the agent or the environment, not the code';
  const bits = [];
  if (incident.class === 1) {
    bits.push(STATE_WORDS[incident.state] || incident.state);
    if (incident.failedIn) bits.push(incident.failedIn);
    if (incident.develocity) {
      bits.push(`${incident.develocity.failures}/${incident.develocity.runs} over ` +
        `${incident.develocity.windowDays}d everywhere it runs`);
    }
  } else if (incident.evidence?.length) {
    bits.push(incident.evidence[0].replace(/\s+/g, ' ').slice(0, 110));
  } else if (incident.state) {
    bits.push(incident.state);
  }
  return bits.filter(Boolean).join(' · ');
}

/** Why nobody is asked to do anything — always a reason, never an empty cell. */
function noOneOwes(incident, horizonDays) {
  if (incident.beyondHorizon) return `older than the ${horizonDays}-day horizon — counted, not written about`;
  if (incident.jira) return 'already tracked — the issue is where this gets settled';
  if (incident.jiraClosed) {
    return `${incident.jiraClosed.key} already fixed this test`
      + `${incident.jiraClosed.fixVersions?.length ? ` in ${incident.jiraClosed.fixVersions.join(', ')}` : ''}`
      + ' — compare that with this branch before filing anything';
  }
  if (incident.kind === 'flicker' && !incident.proven) {
    return 'not proven yet — an issue is earned by two builds on two days';
  }
  if (incident.class === 3) return 'nothing in the code to change; watch for the same agent tomorrow';
  return 'below the analysis budget — reported, not analysed';
}

/**
 * Column three: what happens next, and who does it.
 *
 * Every line starts with its actor — `bot`, a person, `nobody`, `done` — because that is the word
 * a reader scans for, and a column that sometimes leads with the actor and sometimes with the verb
 * is a column that has to be read rather than scanned. The run's own moves are mechanical and
 * written here; what a *person* should do is the conclusion of the analysis, so a deep incident
 * leaves a marker for the pass that writes its root cause (SKILL.md §6).
 */
function nextOf(incident, { horizonDays, filing, stabilising, cause }) {
  const lines = [];
  const fix = incident.fixState;
  if (settled(incident)) {
    // The hedge is the wording `FIX_HEAD` already carries, and it is kept exactly: no value here
    // asserts a fix — a commit will be judged by the next build and a PR may never merge.
    lines.push(`nobody → ${FIX_HEAD[fix.kind].whole.toLowerCase()}: ${fixRef(fix)} ` +
      `(${fix.author || 'unknown'})` +
      `${fix.kind === 'fixed-elsewhere' ? ' — a backport candidate, verify first' : ''}`);
  } else if (incident.primary === false) {
    lines.push(`see ${cause ? `#${cause.number}` : 'above'} → one cause, analysed on ` +
      `${cause?.branch || incident.alsoOn?.[0] || 'another branch'}`);
  } else if (!incident.beyondHorizon) {
    if (incident.silent) {
      lines.push('done → already commented, in this same state');
    } else if (incident.sonar?.unequivocal && incident.sonar.target) {
      lines.push(`bot → comment on ${incident.sonar.target.kind === 'pr'
        ? `PR #${incident.sonar.target.number}` : `\`${incident.sonar.target.short}\``}`);
    } else if (incident.blame?.culprit) {
      lines.push(`bot → comment on \`${incident.blame.culprit.short}\` ` +
        `(${incident.blame.culprit.author || 'unknown'})`);
    }
    if (filing) lines.push(`bot → file **one** issue for \`${filing.className}\` (${filing.scope})`);
    if (stabilising) lines.push('bot → measure the rate, fix, measure again, draft PR');
    if (incident.jira && incident.state === 'systematic') {
      lines.push(`someone → re-triage ${incident.jira}: filed as a flicker, failing every run`);
    }
  }
  if (incident.deep && !settled(incident) && !incident.beyondHorizon) {
    lines.push(`<!-- NEXT: ${incident.id} -->`);
  } else if (!lines.length) {
    lines.push(`nobody → ${noOneOwes(incident, horizonDays)}`);
  }
  return lines.join('<br>');
}

/**
 * A table cell: a newline ends the row and a bare pipe starts a new column, so neither reaches one.
 * The pipe is escaped rather than replaced — a log line is evidence, and `\|` renders as the pipe
 * that was actually there, inside a code span as well as outside one.
 */
const cell = text => String(text ?? '')
  .replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>').trim() || '—';

/**
 * What the reader opens when the row is theirs: the evidence, the history, the attribution and the
 * root cause, behind one disclosure triangle.
 *
 * Collapsed, because the tables above are the document and this is the appendix to one row of them
 * — and because PrivateBin renders the markdown inside `<details>` exactly as it does outside it,
 * so nothing is lost by folding it away.
 */
function evidenceFor(incident) {
  const head = [windowOf(incident), incident.stage ? `stage _${incident.stage}_` : null].filter(Boolean);
  const body = incident.deep
    ? [...evidenceBlock(incident), ...sonarBlock(incident), ...develocityBlock(incident),
      ...blameBlock(incident), ...chatBlock(incident), ...analysis(incident)]
    : [...fixBlock(incident), ...sonarBlock(incident), ...chatBlock(incident)];
  const out = [...(head.length ? ['', head.join(' · ')] : []), ...body];
  return out.some(line => line.trim()) ? out : null;
}

/**
 * The order the rows come in, which is the order they should be dealt with: what blocks a release,
 * then what is broken, then what is flaky, then what is nobody's to fix. A row whose answer is
 * already known — settled, or the same cause as a row above — goes last: it is there so that a red
 * square on the dashboard has a line here, not because anyone has to act on it.
 */
function rowRank(incident, primaries) {
  // A peer sorts where the incident it points at sorts, half a rank behind it — a pointer to a red
  // gate is still the first thing on that branch, and a pointer is never the thing you read first.
  if (incident.primary === false) {
    const cause = primaries?.get(causeKey(incident));
    return cause ? rowRank(cause) + 0.5 : 9;
  }
  if (settled(incident)) return 8;
  if (isGate(incident)) return 0;
  if (incident.class === 2) return 1;
  if (incident.class === 1 && incident.kind === 'test-breakage') return incident.beyondHorizon ? 6 : 2;
  if (incident.flickerGroup) return 3;
  if (incident.class === 1 && incident.kind === 'flicker' && !incident.jira) return 4;
  if (incident.jira) return 5;
  if (incident.class === 3) return 7;
  return 6.5;
}

function renderDetail(report, { live }) {
  const { summary, incidents } = report;
  const date = report.generatedAt.slice(0, 10);
  const redRepos = new Set(report.jobs.filter(job => job.result && job.result !== 'SUCCESS').map(job => job.repo));
  const green = [...new Set(report.jobs.map(job => job.repo))].filter(repo => !redRepos.has(repo));
  const out = [`# CI sweep — ${date}${live ? '' : ' (not a live run — no digest posted, no issue filed)'}`];
  if (!incidents.length) {
    return [...out, '', `Nothing red across ${plural(summary.jobs, 'job')}. Nothing written.`].join('\n');
  }

  // One cause, one row. The peers of an `also-red` group keep a row in *their own* branch's table —
  // a pointer, not a copy — because the person who watches that branch reads that table and has to
  // find it there; the analysis and the comment still happen once, under the branch that carries
  // the cause. A flicker group is the other collapse: one row for the test class, in the branch of
  // the incident that heads it, because what the run files is one issue for the class.
  const groups = new Map();
  for (const incident of incidents) {
    if (!incident.flickerGroup) continue;
    groups.set(incident.flickerGroup, [...(groups.get(incident.flickerGroup) || []), incident]);
  }
  const filings = new Map();
  for (const group of groups.values()) {
    const branches = [...new Set(group.flatMap(incident => [incident.branch, ...(incident.alsoOn || [])]))];
    const methods = [...new Set(group.map(shortName))].sort();
    filings.set(group[0].id, {
      className: testName(group[0].id.split('/').slice(2).join('/')).split('#')[0],
      scope: `${plural(methods.length, 'method')}, ${branches.join(' + ')}`,
      methods, branches, group
    });
  }
  const rows = incidents.filter(incident => !incident.flickerGroup || filings.has(incident.id));

  // Keyed by the signature the id carries rather than by `signature`, which the work order omits
  // for a class-1 incident: what a test failure is, is its test, and the id already holds it.
  const primaries = new Map();
  for (const incident of rows) {
    if (incident.primary === true) primaries.set(causeKey(incident), incident);
  }
  const sections = new Map();
  for (const incident of rows) {
    const key = `${incident.repo}\u0000${incident.branch}`;
    sections.set(key, [...(sections.get(key) || []), incident]);
  }
  const ordered = [...sections.entries()]
    .map(([key, list]) => ({
      repo: key.split('\u0000')[0], branch: key.split('\u0000')[1],
      list: list.sort((a, b) => rowRank(a, primaries) - rowRank(b, primaries)
        || (b.ageDays ?? -1) - (a.ageDays ?? -1))
    }))
    // The branch a reader must look at first is the one with the worst row on it, not the one that
    // sorts first by name — a red gate on a stable branch outranks a flicker on master.
    .sort((a, b) => rowRank(a.list[0], primaries) - rowRank(b.list[0], primaries)
      || branchRank(a.branch) - branchRank(b.branch) || a.repo.localeCompare(b.repo));

  // Numbered across the whole document, in reading order, so that a row and the block that belongs
  // to it are tied together by something short enough to say out loud in the room.
  const numbers = new Map();
  for (const section of ordered) for (const incident of section.list) numbers.set(incident.id, numbers.size + 1);
  const causeOf = incident => {
    const cause = incident.primary === false ? primaries.get(causeKey(incident)) : null;
    return cause ? { number: numbers.get(cause.id), branch: cause.branch } : null;
  };

  const blockers = rows.filter(blocking);
  out.push('', blockers.length
    ? `**${[...new Set(blockers.map(incident => incident.branch))].join(', ')} ` +
      `${blockers.length === 1 ? 'blocks' : 'block'} a release** — ` +
      `${blockers.map(incident => `${subjectOf(incident)} (#${numbers.get(incident.id)})`).join(', ')}.`
    : '**Nothing here blocks a release.**');
  out.push('', `Swept **${plural(summary.jobs, 'job')}**, **${summary.red} red** → ` +
    `**${plural(summary.incidents, 'incident')}**` +
    `${green.length ? `. ${green.join(' and ')} ${green.length === 1 ? 'is' : 'are'} green on every branch` : ''}.`);
  if (report.githubTokenWarning) out.push('', `⚠️ ${report.githubTokenWarning}`);

  for (const section of ordered) {
    out.push('', `## ${section.repo} · ${section.branch}`, '',
      '| What fails | Why | Next — who |', '|---|---|---|');
    for (const incident of section.list) {
      const cause = causeOf(incident);
      const meta = [kindOf(incident), agedAs(incident),
        incident.jira ? `tracked as ${incident.jira}` : null,
        incident.jiraClosed ? `already fixed by ${incident.jiraClosed.key}`
          + `${incident.jiraClosed.fixVersions?.length ? ` (${incident.jiraClosed.fixVersions.join(', ')})` : ''}` : null,
        incident.alsoOn?.length && incident.primary !== false ? `also red on ${incident.alsoOn.join(', ')}` : null,
        incident.buildUrl ? `[build](${incident.buildUrl})` : null].filter(Boolean).join(' · ');
      const name = isGate(incident) ? `**${subjectOf(incident)}**` : `\`${subjectOf(incident)}\``;
      const filing = filings.get(incident.id);
      // A gate explains itself out of fields the renderer holds — the condition it failed and the
      // value the gate wanted — so it keeps its mechanical answer and spends no analysis slot
      // restating two nouns. For everything else that won a slot, *why* is the conclusion of that
      // analysis: the numbers a renderer can reach say how often a test fails, never why it does.
      const why = cause ? `the same failure as #${cause.number} on ${cause.branch}`
        : incident.deep && !incident.sonar?.conditions?.length ? `<!-- WHY: ${incident.id} -->`
          : whyOf(incident);
      out.push(`| **${numbers.get(incident.id)}.** ${cell(name)}<br>_${cell(meta)}_ ` +
        `| ${cell(why)} ` +
        `| ${cell(nextOf(incident, { horizonDays: report.horizonDays, filing, cause,
          stabilising: incident.stabilise }))} |`);
    }
    for (const incident of section.list) {
      const body = evidenceFor(incident);
      const filing = filings.get(incident.id);
      const lists = filing && filing.methods.length > 1;
      if (!body && !lists) continue;
      out.push('', '<details>', `<summary><b>${numbers.get(incident.id)}</b> · ` +
        `${isGate(incident) ? `<b>${subjectOf(incident)}</b>` : `<code>${subjectOf(incident)}</code>`}` +
        ' — the evidence, and the root cause</summary>');
      // Every method of a flicker group, because the issue the run files lists them and somebody
      // has to be able to check that list against what is actually red.
      if (lists) {
        out.push('', `One issue for \`${filing.className}\` — ${filing.scope}:`,
          ...filing.methods.map(method => `- \`${method}\``));
      }
      out.push(...(body || []), '', '</details>');
    }
  }

  const stabilise = summary.stabilise;
  const notes = [];
  // Worth its line every morning, including the morning it is "none": a reader who does not see it
  // wonders whether the pass ran at all, and "a build break is open, so no flake fix today" is the
  // ordering being obeyed rather than a gap.
  if (stabilise && !stabilise.id) {
    const named = (stabilise.blockers || [])
      .map(id => (numbers.has(id) ? `#${numbers.get(id)}` : id));
    notes.push(`**No stabilisation fix this run** — ${stabilise.skipped}` +
      `${named.length ? ` (${named.join(', ')})` : ''}.`);
  }
  const deep = incidents.filter(incident => incident.deep);
  const noOwner = deep.filter(incident => ['ambiguous', 'none', 'unknown'].includes(incident.blame?.tier));
  notes.push(`**Nobody was pinged for ${noOwner.length} of the ${deep.length} analysed** — no attributable` +
    ` author. **${summary.alreadyCommented}** already carried a comment in the same state,` +
    ` **${summary.beyondHorizon}** are older than the ${report.horizonDays}-day horizon, and` +
    ` **${Math.max(0, summary.incidents - deep.length - incidents.filter(settled).length -
      incidents.filter(incident => incident.primary === false).length)}** were below the deep budget` +
    ` of ${report.budget} — reported without analysis, by design.`);
  out.push('', '---', '', ...notes.map(note => `_${note}_`));
  return out.join('\n');
}

// ---- The delta ---------------------------------------------------------------------------------
// A daily state snapshot is what the CI dashboard already is, and a reader who can get the same
// thing faster by looking at it stops reading the digest. What a dashboard cannot show is the
// *transitions*: what broke since yesterday, what moved, and — the one it can never show — what
// went green. So each run is compared against the state the last digest carried, and a morning that
// moved nothing is not posted at all.
//
// The comparison is mechanical and belongs here rather than in the model's reading of yesterday's
// prose: an id either was in yesterday's state or was not. The prose is then written about the
// handful of lines this produces.

/**
 * What is compared, as one short string per incident — the whole state of a red morning has to fit
 * in a chat message (see matrix.mjs). Deliberately *not* the age: an incident whose only change is
 * that it is a day older has not changed, and re-announcing it daily is the noise this removes.
 */
const stateLine = incident => [
  incident.kind, incident.state ?? '', incident.fixState?.kind ?? '',
  incident.beyondHorizon ? 'long-standing' : ''
].join('/');

const parseLine = line => {
  const [kind = '', state = '', answer = '', horizon = ''] = String(line ?? '').split('/');
  return { kind, state, answer, beyondHorizon: horizon === 'long-standing' };
};

/**
 * Today's incidents against the state the last digest carried.
 *
 * Beyond the horizon nothing is written and nothing is analysed, so those incidents are counted and
 * never classified: a two-month-old flicker that fails today, passes tomorrow and fails again on
 * Thursday would otherwise produce a `FIXED` line and a `NEW` line every other morning — the
 * churniest possible source of exactly the noise this exists to stop. Each incident is judged by
 * the day it exists on: one that crossed the horizon today is counted, one that was long-standing
 * yesterday and is back under the horizon today has been green in between and broken again, which
 * is news.
 *
 * @param {object} report a work order
 * @param {object|null} previous `{available, at, state}` as `matrix.mjs --last-state` prints it, or
 *   a bare state map. `available: false` — the room could not be read — is not the same as an empty
 *   state, and the difference is the whole reason this fails open: an unknown yesterday means today
 *   is reported in full, saying so, because a routine that posts nothing because a read failed is
 *   indistinguishable from a green morning.
 */
function deltaOf(report, previous) {
  // An envelope announces itself by carrying either of its own fields; anything else is the bare
  // state map. Told apart explicitly, because the failure of guessing is silent and absurd: the
  // envelope of an unreadable room was read as a state of two incidents named `available` and
  // `reason`, and both were then reported as fixed.
  const envelope = previous != null && ('available' in previous || 'state' in previous);
  const available = !envelope || previous.available !== false;
  const before = new Map(Object.entries((envelope ? previous.state : previous) || {})
    .map(([id, line]) => [id, { line: String(line ?? ''), ...parseLine(line) }]));
  const state = {};
  const appeared = [];
  const changed = [];
  const fixed = [];
  let same = 0;
  let longStanding = 0;
  for (const incident of report.incidents || []) {
    state[incident.id] = stateLine(incident);
    const now = parseLine(state[incident.id]);
    if (now.beyondHorizon) { longStanding++; continue; }
    const was = before.get(incident.id);
    if (!was) {
      appeared.push({ id: incident.id, kind: now.kind, state: now.state, answer: now.answer || null });
      continue;
    }
    const moves = [['kind', was.kind, now.kind], ['state', was.state, now.state],
      ['answer', was.answer || 'none', now.answer || 'none']]
      .filter(([, from, to]) => from !== to)
      .map(([what, from, to]) => `${what} ${from} → ${to}`);
    if (moves.length) changed.push({ id: incident.id, from: was.line, to: state[incident.id], moved: moves });
    else same++;
  }
  for (const [id, was] of before) {
    if (was.beyondHorizon || state[id]) continue;
    fixed.push({ id, was: `${was.kind}/${was.state}` });
  }
  // An unknown yesterday classifies nothing. Calling today's incidents `NEW` would be a claim about
  // a comparison that never happened — a week-old flicker announced as this morning's breakage is
  // worse than the snapshot the digest falls back to, which at least says what it is.
  if (!available) {
    return {
      previous: { available: false, at: null, known: 0, reason: previous?.reason ?? null },
      silent: false,
      new: [], changed: [], fixed: [], same: 0,
      unknown: Object.keys(state).length,
      longStanding,
      state
    };
  }
  return {
    previous: { available, at: previous?.at ?? null, known: before.size },
    // Nothing to say is the correct outcome, and the one the whole change exists to produce. It is
    // never reached on an unknown yesterday, whatever today looks like.
    silent: available && !appeared.length && !changed.length && !fixed.length,
    new: appeared,
    changed,
    fixed,
    same,
    longStanding,
    state
  };
}

// ---- Run -------------------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

// Rendering reads a work order and sweeps nothing, so the paste can be re-rendered — after a fix to
// the wording, or on another machine — without a second pass over Jenkins.
if (args.renderDetail) {
  const source = readFileSync(args.renderDetail === '-' ? 0 : args.renderDetail, 'utf8');
  console.log(renderDetail(JSON.parse(source), args));
  process.exit(0);
}

// The delta reads two files and no server, so yesterday's comparison can be redone — after a fix
// to the classification, or on another machine — without a second pass over Jenkins either.
if (args.delta) {
  const report = JSON.parse(readFileSync(args.delta === '-' ? 0 : args.delta, 'utf8'));
  const previous = args.previous ? JSON.parse(readFileSync(args.previous, 'utf8')) : { available: false };
  console.log(JSON.stringify(deltaOf(report, previous), null, 2));
  process.exit(0);
}

const flickerFor = await knownFlickers();
// The *closed* flicker issues, looked up the same way. A hit is never a reason to stay quiet — it is
// the run's most actionable finding, because somebody has already written the fix. Which of the two
// readings applies is settled by comparing the issue's `fixVersions` with the branch that is red
// (SKILL.md §3), and that comparison is the report's to make, not this tool's: encoding it here
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
  for (const incident of await incidentsOf(target, args, flickerFor)) {
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
const deep = incidents.filter(incident => incident.alerting && !incident.beyondHorizon
  && !settled(incident) && incident.primary !== false).slice(0, args.budget);
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
// be claimed". `dv-test-history` derives that (SKILL.md §3); this puts it in the work order, so the
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
  // One name per person, with what each of them is on the hook for. `author` is Sonar's SCM email
  // and `commit.author` is the GitHub account that last touched the file — the same person by two
  // routes when they agree, and two candidates worth printing when they do not.
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
  incident.sonar.unequivocal = authors.size === 1 && lineAuthors.size <= 1;
  if (!incident.sonar.unequivocal) {
    incident.sonar.equivocalBecause = authors.size === 0
      ? 'no commit touched these files in the two days before the analysis — a rule applied to existing code'
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
  incident.notified = target.kind === 'pr'
    ? await priorPrComment(incident.repo, target.number, incident.id)
    : await priorComment(incident.repo, culprit.sha, incident.id);
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
const stabilisable = incident => incident.class === 1 && incident.kind === 'flicker' && incident.proven
  && incident.jira && !incident.fixState && incident.alerting && !incident.beyondHorizon
  && incident.primary !== false && incident.state !== 'systematic';

const blockers = incidents.filter(blocksRelease);
// Highest failure rate first: the oracle can only measure what it can catch failing, and a fix for
// a test that fails 1 in 40 cannot be shown to work in an affordable number of repetitions.
const stabiliseCandidates = incidents.filter(stabilisable)
  .sort((a, b) => (b.failRatio || 0) - (a.failRatio || 0));
let stabilise = { skipped: 'no proven, filed, unanswered flicker inside the horizon' };
if (blockers.length) {
  stabilise = {
    skipped: `${plural(blockers.length, 'release-blocking incident')} open, and what blocks a `
      + `release comes first — a flicker costs a re-run and blocks nobody`,
    blockers: blockers.slice(0, 5).map(incident => incident.id)
  };
} else if (stabiliseCandidates.length) {
  const [pick] = stabiliseCandidates;
  pick.stabilise = true;
  // The configuration the repeat run must use, and the before/after rate's own baseline, come from
  // Develocity — so the candidate gets the history whether or not it won a deep slot. One extra
  // invocation, once per run, and only on the mornings nothing more urgent is open.
  if (!pick.develocity && !develocityOff && pick.tests?.length) {
    const facts = develocityFacts(pick.tests[0], { match: pick.evidence?.[0] });
    if (facts.unavailable) develocityOff = facts.unavailable;
    else pick.develocity = facts;
  }
  stabilise = {
    id: pick.id, jira: pick.jira.key, failedIn: pick.failedIn,
    configuration: pick.develocity?.configs?.[0] || pick.envs?.[0] || null,
    others: stabiliseCandidates.length - 1
  };
}

for (const incident of incidents) {
  incident.deep ??= false;
  incident.blame ??= { tier: 'none', reason: 'below the per-run budget: reported, not investigated', suspects: [] };
  delete incident.window?.firstBad;
  delete incident.window?.lastGood;
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
    jiraClosed: incident.jiraClosed || undefined,
    // The run's single stabilisation candidate (§5). It is rarely `deep` — a filed flicker is
    // deliberately low in the analysis budget — so it is flagged here and given the full shape
    // below, because the skill has to read its history and its evidence to fix it.
    stabilise: incident.stabilise || undefined,
    // Carried whether or not the incident is deep, because it is the reason it is *not*: an
    // incident that looks fixed is one line, and this is the line.
    fixState: incident.fixState || undefined,
    // Carried on every incident, deep or not, suppressed or not: it is the one field here that the
    // CI dashboard cannot hold, and the digest cites it (SKILL.md §6). Untrusted text — what a
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
    stabilise
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
    const age = incident.ageDays == null ? 'age?' : `${incident.ageIsLowerBound ? '≥' : ''}${incident.ageDays}d`;
    const who = incident.blame?.culprit
      ? `${incident.blame.tier} → ${incident.blame.culprit.short} (${incident.blame.culprit.author})`
      : incident.blame?.tier || '—';
    console.log(`${incident.deep ? '*' : ' '} [${incident.kind}] ${incident.id} — ${age}, ${who}` +
      `${incident.silent ? ' (already commented)' : ''}${incident.beyondHorizon ? ' (beyond horizon)' : ''}` +
      `${incident.fixState ? ` (${settled(incident) ? 'possibly answered' : 'partly answered'} by ` +
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
