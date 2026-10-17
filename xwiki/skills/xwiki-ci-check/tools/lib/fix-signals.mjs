/*
 * What may already answer an incident: an unbuilt fix, an open PR, a stale snapshot, a fix on
 * another branch. Part of ci-check.mjs.
 */

import { buildRevision, stagesOf } from '../../../../scripts/jenkins.mjs';
import { blameKeys, names, touches } from './blame.mjs';
import { commitsBetween, github, token } from './github.mjs';
import { basename, diagnose } from './logs.mjs';
import { branchRank } from './policy.mjs';
import { jobHistory, outcomesOf } from './sweep.mjs';
import { DAY, dayOf, plural, testName } from './util.mjs';

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
export function forwardKeys(incident) {
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
export async function forwardFix(incident, job, args) {
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

/**
 * Test-suite class names shared by many modules, which therefore identify none of them: `AllIT` tied
 * a repository-module failure to a PR touching only `NotificationsIT` (2026-10-09).
 */
const GENERIC_CLASS = /^All\w*(IT|Test)s?$/;

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
    .filter(key => key.endsWith('.java')).map(key => key.replace(/\.java$/, ''))
    .filter(name => !GENERIC_CLASS.test(name)));
  return { groups, jira: incident.jira?.key || null };
}

/**
 * The open PR that looks like a fix for this incident, if there is one.
 *
 * Runs only where `forwardFix` found nothing at all: a commit that has landed on the branch is
 * better evidence than a proposal, and a *partial* forward fix is already the answer for the part
 * it covers. Fails open for the same reason it does there.
 */
export async function inFlightFix(incident, args) {
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
    // A name match is not a fix ("Add automated test for Export PDF" names `PDFExportIT`), so an open
    // PR never silences on its own: the model confirms or discards it (references/fix-signals.md).
    candidate: true,
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
/** …which its own test modules are not: those it builds. */
const TEST_MODULE = /-test(?:-[a-z]+)?\//;
/**
 * …except the page objects, which it does not: LikeIT and PanelsAdministrationIT failed its
 * `testCompile` with `cannot find symbol` on page-object methods the very commit that added the
 * test had added — the page objects came from the snapshot.
 */
const PAGE_OBJECTS = /-pageobjects\/src\/main\//;
const productionIn = commit => commit.files.filter(path => PRODUCTION_FILE.test(path)
  && (!TEST_MODULE.test(path) || PAGE_OBJECTS.test(path)));

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
 *
 * But a `FAILURE` whose *Build for Main* stage failed stopped before deploying: on 2026-10-17 a
 * lint break failed it in #9032 and #9033, the jars stayed at #9031, and taking #9032's revision
 * made the snapshot look current — so four `ObjectsResourceIT` tests, whose commit carried both the
 * test and the REST change, were blamed on that commit instead of read as the trap.
 */
async function deployedRevision(main, startedAt, repo) {
  for (const prior of main.builds.filter(build => build.timestamp <= startedAt).slice(0, 5)) {
    if (prior.result === 'FAILURE') {
      const stage = (await stagesOf(`${main.url}/${prior.number}`)).find(entry => entry.name === 'Build for Main');
      if (stage && stage.status !== 'SUCCESS') continue;
    }
    return { number: prior.number, sha: await buildRevision(`${main.url}/${prior.number}`, repo) };
  }
  return null;
}

/** `14 minutes`, `3 hours` — how long before the build the commit landed. */
export function shortly(before, after) {
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
export async function staleSnapshot(incident, jobs, args) {
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
  // Whether the jars have caught up is what `deployedRevision` answers: a commit after it is absent
  // from this build's jars however many runs the failure has lasted — and while the main job cannot
  // deploy, every run is stale.
  if (!latest || !main) return null;
  try {
    const built = await buildRevision(`${env.url}/${latest.number}`, incident.repo);
    const deployed = await deployedRevision(main, latest.timestamp, incident.repo);
    if (!built || !deployed?.sha || built === deployed.sha) return null;
    // The default 20, not fewer: a main job stuck before its deploy widens the gap, and on 2026-10-17
    // the commit doing both halves was the 11th newest of 14.
    const commits = await commitsBetween(incident.repo, deployed.sha, built);
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
export async function fixedElsewhere(incident, targets, args) {
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
