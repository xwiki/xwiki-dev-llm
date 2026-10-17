/*
 * What a red build says about itself: the failing stage's log, classified into a break and its
 * evidence. Part of ci-check.mjs.
 */

import { failedNodesOf, stagesOf, stepConsole, stepLog } from '../../../../scripts/jenkins.mjs';

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

export const ESLINT_PROBLEM_RE = /\[INFO\]\s+\d+:\d+\s+error\s{2,}\S.*\s{2,}\S+\s*$/;
const ESLINT_FILE_RE = /\[INFO\]\s+(\S+\.(?:vue|[cm]?[jt]sx?))\s*$/;

/** The file an ESLint problem line belongs to: the path line above its run of problem lines. */
export function eslintFile(lines, index) {
  let above = index - 1;
  while (above >= 0 && ESLINT_PROBLEM_RE.test(lines[above])) above--;
  return lines[above]?.match(ESLINT_FILE_RE)?.[1] ?? null;
}

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
    // A type error in a node module, in either of TypeScript's formats: `file.ts(12,5): error TS…`
    // and, pretty-printed, `file.ts:12:5 - error TS…`. Like ESLint's, it reaches the Maven log at
    // `[INFO]` and would otherwise be signed by the reactor's resume line.
    tool: 'tsc',
    re: /(\S+\.(?:[cm]?tsx?|vue))(?:\((\d+),\d+\)|:(\d+):\d+)\s*[:-]\s*error\s+TS\d+/,
    locate: m => `tsc:${basename(m[1])}:${m[2] || m[3]}`,
    file: m => m[1]
  },
  {
    // A lint failure of a node module (`pnpm run lint`), as ESLint's default formatter prints it:
    // the file on a line of its own, then one `line:col  error  message  rule` line per problem —
    // all at `[INFO]`, since it is the frontend plugin's output. Without it the break fell through
    // to `maven-reactor`, whose module (`xwiki-platform-node`) every front-end commit touches, so
    // a break naming its file and its line came back `ambiguous` and nobody was pinged.
    tool: 'eslint',
    re: ESLINT_PROBLEM_RE,
    locate: (m, lines, index) => `eslint:${basename(eslintFile(lines, index) || 'unknown')}`,
    file: (m, lines, index) => eslintFile(lines, index)
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

export const basename = path => path.split(/[\\/]/).pop();

// The same blips as INFRA_PATTERNS, but as they appear in a *test's* error detail rather than in a
// log: when the environment a docker test needs never comes up, every test of every module in that
// run reports a setup failure. That is one infra event, not forty broken modules — and forty
// broken modules is what it looks like until this is matched.
const INFRA_TEST_PATTERNS = [
  { id: 'agent-environment', re: /Error setting up the XWiki testing environment on agent/ },
  { id: 'docker-rate-limit', re: /toomanyrequests|pull rate limit/ },
  { id: 'container-start', re: /Could not start container|Timed out waiting for container|ContainerLaunchException/ }
];

export const infraInDetail = details => {
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
export async function diagnose(buildUrl) {
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

export const keep = lines => {
  const wanted = new Set();
  lines.forEach((line, index) => {
    if (!LOG_PATTERNS.some(pattern => pattern.test(line))) return;
    wanted.add(index);
    // The file an ESLint problem is about is the line above it, which no pattern can match alone:
    // a bare `[INFO] <path>.js` is printed by plenty of plugins that are not reporting anything.
    if (ESLINT_PROBLEM_RE.test(line) && ESLINT_FILE_RE.test(lines[index - 1] || '')) wanted.add(index - 1);
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
export function classify(lines, nodeError, at, stage, { weak = false } = {}) {
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
          kind: 'build-break', signature: at(matcher.locate(match, candidates, index)),
          file: matcher.file(match, candidates, index), stage,
          // An ESLint problem is quoted with the file line above it, which says what it is about.
          evidence: evidenceFrom(candidates, matcher.tool === 'eslint' && index > 0 ? index - 1 : index, matcher)
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
export function evidenceFrom(lines, start, matcher) {
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
