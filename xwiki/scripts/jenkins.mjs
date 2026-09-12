// Shared client for XWiki's Jenkins (ci.xwiki.org), used by the plugin's skills. Job addressing,
// build listing, test reports and revision resolution live here rather than inside one skill's
// tools/, so that each trap below is written down once and fixed once for every consumer.
//
// Read access is anonymous — no token. The full reference, including the endpoints worth knowing
// and how to read a build, is in okf/servers/jenkins.md.
//
// Consumers:
//   - skills/xwiki-release-test-triage/tools/triage.mjs

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
