// Shared client for XWiki's Jenkins (ci.xwiki.org), used by the plugin's skills. Job addressing,
// build listing, test reports and revision resolution live here rather than inside one skill's
// tools/, so that each trap below is written down once and fixed once for every consumer.
//
// Read access is anonymous — no token. The full reference, including the endpoints worth knowing
// and how to read a build, is in okf/servers/jenkins.md.
//
// Consumers:
//   - skills/xwiki-release-test-triage/tools/triage.mjs
//   - skills/xwiki-ci-check/tools/ci-check.mjs

export const CI = "https://ci.xwiki.org";

/** The folder holding the main build of each repo, and the one holding platform's env matrix. */
export const MAIN_FOLDER = "XWiki";
export const ENV_TESTS_FOLDER = "XWiki Environment Tests";

// Cloudflare fronts ci.xwiki.org and answers browser user-agents with its challenge page, for
// /api/ as much as for the UI. Ask as plain curl; credentials do not help, it is not an auth error.
export const HEADERS = { "User-Agent": "curl/8.7.1", Accept: "application/json" };

export const enc = value => encodeURIComponent(value);

/** Jenkins `tree=` expressions contain brackets a shell would eat, so encode them for every call. */
export const tree = expression => expression.replace(/\[/g, "%5B").replace(/\]/g, "%5D");

export async function getJSON(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/** Multibranch pipelines nest one `job/` segment per level; folder names may contain spaces. */
export const jobUrl = (folder, repo, branch) => `${CI}/job/${enc(folder)}/job/${enc(repo)}/job/${enc(branch)}`;

/**
 * The jobs that gate a release on one branch: the main build of each repo, plus — when platform is
 * among them — its environment matrix, which runs the same tests against other databases.
 *
 * @returns {{label: string, repo: string, url: string}[]} `repo` is the repo actually built, which
 *   for the matrix job is still xwiki-platform; `label` distinguishes the two in a report.
 */
export function releaseTrainJobs(repos, branch) {
  const list = repos.map(repo => ({ label: repo, repo, url: jobUrl(MAIN_FOLDER, repo, branch) }));
  if (repos.includes("xwiki-platform")) {
    list.push({
      label: "env-tests",
      repo: "xwiki-platform",
      url: jobUrl(ENV_TESTS_FOLDER, "xwiki-platform", branch)
    });
  }
  return list;
}

/**
 * The branches a multibranch pipeline currently has jobs for, as Jenkins knows them — the source of
 * truth, since a branch cut yesterday has a job and a hardcoded list does not.
 *
 * @returns {string[]} branch names, or [] when the folder/repo does not exist.
 */
export async function branchesOf(folder, repo) {
  const data = await getJSON(`${CI}/job/${enc(folder)}/job/${enc(repo)}/api/json?tree=${tree("jobs[name]")}`);
  return (data?.jobs || []).map(job => job.name);
}

/**
 * The last `count` builds of a job, newest first, whatever they produced.
 *
 * Unlike `testedBuilds()` this keeps the builds that ran no test at all, which is the point when
 * reading a red job: a `FAILURE` build breaks *before* the tests and reports no JUnit summary, so
 * filtering on one hides exactly the builds that need explaining.
 */
export async function buildSummaries(url, count) {
  const fields = tree(`builds[number,result,timestamp,building,actions[failCount,totalCount]]{0,${count}}`);
  const data = await getJSON(`${url}/api/json?tree=${fields}`);
  return (data?.builds || []).map(build => {
    const junit = (build.actions || []).find(action => action && action.totalCount != null);
    return {
      number: build.number, result: build.result, timestamp: build.timestamp, building: !!build.building,
      failCount: junit?.failCount ?? null, totalCount: junit?.totalCount ?? null
    };
  });
}

/**
 * The stages of a pipeline build, from the Pipeline Stage View API.
 *
 * This is the way into a red build, and `consoleText` is not: a platform build's console log is
 * **~80 MB**, while this answers in a few KB and names which stage failed. Jenkins serves no
 * `Content-Length` for that log and honours no `Range` on it, so there is no cheap way to read
 * just its tail — which is what makes the stage API the only affordable route to a diagnosis.
 *
 * @returns {object[]} `{name, status, id, _links}`, empty for a job that is not a pipeline.
 */
export async function stagesOf(buildUrl) {
  const data = await getJSON(`${buildUrl}/wfapi/describe`);
  return data?.stages || [];
}

/**
 * The steps of one stage that did not succeed, each carrying its own error message and its own
 * (small) log — which is what makes reading the failure affordable.
 *
 * @returns {object[]} `{id, name, status, error, _links}` as Jenkins lists them.
 */
export async function failedNodesOf(stage) {
  const href = stage?._links?.self?.href;
  if (!href) return [];
  const data = await getJSON(`${CI}${href}`);
  return (data?.stageFlowNodes || [])
    .filter(node => node.status !== "SUCCESS" && node.status !== "NOT_EXECUTED");
}

/** Where a step's own log lives, if Jenkins recorded one for it. */
export const logUrlOf = node => (node?._links?.log?.href ? `${CI}${node._links.log.href}` : null);

/**
 * Jenkins serves a step's log as HTML in both of its log forms — entities escaped, URLs wrapped in
 * anchors — so a pattern holding `<`, `>` or `&` matches nothing until this has run.
 */
const htmlToLines = html => html
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
  // Last, so that a literal `&lt;` in the log does not get expanded twice into a bogus tag.
  .replace(/&amp;/g, "&")
  .split("\n")
  .map(line => line.trimEnd());

/**
 * The lines of one failed step's log, and where the rest of it lives.
 *
 * `wfapi/log` does not answer with the log: it answers with a JSON *envelope* —
 * `{nodeId, length, hasMore, text, consoleUrl}` — whose `text` field holds it with the newlines
 * escaped. So the raw body is a **single line**, and reading it as text finds nothing however right
 * the patterns are. It is also only the last ~10 KiB, `start` being ignored (measured: `start=0`,
 * `1` and `100000` all return the same window). That tail boundary matters for Maven: the headline
 * `[ERROR] Failed to execute goal … on project <module>` falls above it, while the reactor resume
 * line `[ERROR]   mvn <args> -rf :<module>` stays inside it — so the failing module is always
 * recoverable from the tail, and the failing goal is not.
 *
 * @returns {Promise<{lines: string[], hasMore: boolean, consoleUrl: string|null}>}
 */
export async function stepLog(node) {
  const empty = { lines: [], hasMore: false, consoleUrl: null };
  const url = logUrlOf(node);
  if (!url) return empty;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return empty;
  let body;
  try {
    body = await res.json();
  } catch {
    return empty;
  }
  return {
    lines: htmlToLines(body.text || ""),
    hasMore: Boolean(body.hasMore),
    consoleUrl: body.consoleUrl ? `${CI}${body.consoleUrl}` : null
  };
}

/**
 * The whole of one step's log, from the console page `stepLog` reports — the only way past the
 * 10 KiB tail, since that endpoint cannot be paged.
 *
 * It is a full HTML page, so it costs more than the tail and still nothing like a build's ~80 MB
 * console: measured at 173 KB for a 41-minute Maven step. Read it only when the tail classified
 * nothing, never by default.
 */
export async function stepConsole(consoleUrl, { maxBytes = 4e6 } = {}) {
  if (!consoleUrl) return [];
  const res = await fetch(consoleUrl, { headers: { ...HEADERS, Accept: "text/html" } });
  if (!res.ok) return [];
  return htmlToLines((await res.text()).slice(0, maxBytes));
}

/**
 * The lines of a log matching one of `patterns`, and nothing else.
 *
 * Streamed and matched line by line: only the matches are ever held, never more than `max` of
 * them, and never more than `maxBytes` is read. Keep the patterns narrow — matched against
 * Testcontainers' image dumps, a broad one turns this into megabytes of noise.
 *
 * @param url {string} a step log (`logUrlOf`) or, as a fallback, a build's `consoleText`
 * @param patterns {RegExp[]} tested against each line
 * @returns {string[]} the matching lines, truncated, in the order they appear
 */
export async function grepLog(url, patterns, { max = 40, lineLength = 300, maxBytes = 8e6 } = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, Accept: "text/plain" } });
  if (!res.ok || !res.body) return [];
  const matches = [];
  const decoder = new TextDecoder();
  let pending = "";
  let read = 0;
  for await (const chunk of res.body) {
    read += chunk.length;
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    // The last element is an unterminated line: hold it until the chunk that completes it.
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (matches.length >= max) return matches;
      if (patterns.some(pattern => pattern.test(line))) matches.push(line.trim().slice(0, lineLength));
    }
    // A cap, not a budget: the caller is expected to point this at a step's log, not at the 80 MB
    // console, and reading past it would mean the patterns are wrong rather than the log long.
    if (read >= maxBytes) return matches;
  }
  if (pending && matches.length < max && patterns.some(pattern => pattern.test(pending))) {
    matches.push(pending.trim().slice(0, lineLength));
  }
  return matches;
}

/** The last `count` builds that produced test results, newest first: ABORTED builds report none. */
export async function testedBuilds(url, count) {
  const data = await getJSON(`${url}/api/json?tree=${tree("builds[number,result,actions[failCount,totalCount]]")}`);
  const builds = [];
  for (const build of data?.builds || []) {
    // The JUnit summary is not a top-level field: it is the actions[] entry that carries the
    // counts, so filter for the one that has them rather than indexing by position.
    const junit = (build.actions || []).find(action => action && action.totalCount != null);
    if (junit) builds.push({ number: build.number, result: build.result, ...junit });
    if (builds.length === count) break;
  }
  return builds;
}

/** Which tests ran, and which of them failed, in one build. Cheaper than the full report. */
export async function outcomes(buildUrl) {
  const data = await getJSON(`${buildUrl}/testReport/api/json?tree=${tree("suites[cases[className,name,status]]")}`);
  const ran = new Set();
  const failed = new Set();
  for (const suite of data?.suites || []) {
    for (const testCase of suite.cases || []) {
      const id = idOf(testCase.className, testCase.name);
      if (testCase.status !== "SKIPPED") ran.add(id);
      if (testCase.status === "FAILED" || testCase.status === "REGRESSION") failed.add(id);
    }
  }
  return { ran, failed };
}

/**
 * The environment of a suite, e.g. "MariaDB latest, Jetty 12-jdk25, S3, Firefox". It appears
 * nowhere else in the report, so it has to be taken from the suite's enclosing block names.
 */
export function environmentOf(suite) {
  const blocks = suite.enclosingBlockNames || [];
  const name = blocks[blocks.length - 1] || "";
  const env = name.split(" - Docker tests")[0].trim();
  return env && env !== name ? env : "default";
}

/**
 * Jenkins names a case "method(Arg, Arg)", and "[2]" for one invocation of a parameterized test.
 * The bare "class#method" is what the JIRA field holds and what makes the invocations one row.
 */
export const idOf = (className, name) => `${className}#${name.replace(/\([^)]*\)/g, "").replace(/\[\d+\]$/, "")}`;

/** A whole-class setup failure or a forbidden-log assertion, not a test method. */
export const isPseudoTest = id => /#(initializationError|executionError)$/.test(id);

/** Every test of one build, with the environments it ran, failed and was skipped in. */
export async function testResults(buildUrl) {
  const fields = tree("suites[enclosingBlockNames,cases[className,name,status,errorDetails]]");
  const data = await getJSON(`${buildUrl}/testReport/api/json?tree=${fields}`);
  const byTest = new Map();
  for (const suite of data?.suites || []) {
    const env = environmentOf(suite);
    for (const testCase of suite.cases || []) {
      const id = idOf(testCase.className, testCase.name);
      if (!byTest.has(id)) byTest.set(id, { id, failed: new Set(), ran: new Set(), skipped: new Set(), detail: "" });
      const test = byTest.get(id);
      if (testCase.status === "SKIPPED") test.skipped.add(env);
      else test.ran.add(env);
      if (testCase.status === "FAILED" || testCase.status === "REGRESSION") {
        test.failed.add(env);
        if (!test.detail) test.detail = (testCase.errorDetails || "").split("\n")[0].slice(0, 200);
      }
    }
  }
  return byTest;
}

/** The shared pipeline library every job checks out alongside the project it builds. */
const PIPELINE_REPO = "xwiki-jenkins-pipeline";

const repoOfRemote = url => (url.split("/").pop() || "").replace(/\.git$/, "");

/**
 * The commit of `repo` that a build actually ran.
 *
 * Every build carries **two** revision actions, because every job checks out the shared
 * xwiki-jenkins-pipeline library as well as the project. Match on the remote URL: the library's
 * branch is `master` too, so matching on the branch name returns the library's revision — the same
 * constant SHA for every build of every repo — whenever the branch being read is itself `master`.
 *
 * @returns {string|null} the SHA1, or null when the build records no revision for that repo.
 */
export async function buildRevision(buildUrl, repo) {
  const data = await getJSON(`${buildUrl}/api/json?tree=${tree("actions[remoteUrls,lastBuiltRevision[SHA1]]")}`);
  const actions = (data?.actions || []).filter(action => action?.lastBuiltRevision);
  const match = actions.find(action => (action.remoteUrls || []).some(url => repoOfRemote(url) === repo))
    // A repo whose remote is not named after it is still not the pipeline library.
    || actions.find(action => (action.remoteUrls || []).length
      && action.remoteUrls.every(url => repoOfRemote(url) !== PIPELINE_REPO));
  return match ? match.lastBuiltRevision.SHA1 : null;
}
