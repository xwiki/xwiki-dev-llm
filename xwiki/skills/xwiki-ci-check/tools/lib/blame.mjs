/*
 * Blame: which commit of a regression window the failure points at, and how sure that is. Part of
 * ci-check.mjs.
 */

import { ESLINT_PROBLEM_RE, basename } from './logs.mjs';

// ---- Blame -----------------------------------------------------------------------------------
// Tier decides the wording, and the wording is the whole credibility of the system: a machine that
// asserts wrongly is switched off, one that asks is forgiven. `certain` may state, `likely` must
// only ask, `ambiguous` must not ping at all.

export const touches = (commit, needle) =>
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
export function blameKeys(incident) {
  // A lint error also names its rule, and a commit that enables a rule says so in its subject —
  // while the file it fails on may not have changed in months (`l10n.ts`, 2026-10-17).
  const rules = (incident.evidence || []).map(line => line.match(ESLINT_PROBLEM_RE) && line.trim().split(/\s+/).pop())
    .filter(rule => rule && rule.includes('/') && !rule.startsWith('prettier/'));
  if (incident.file) return { paths: [basename(incident.file)], words: [...new Set(rules)] };
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

export const names = (commit, word) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(commit.title || '');

export function attribute(incident, commits) {
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
  // Deliberately no "every commit in the window is by the same author" rule: who pushed that day is
  // not evidence (it pinged an unrelated Solr fix on 2026-10-09). The model judges the rest (§4).
  const relevant = new Set([...byPath, ...byWord]);
  return {
    tier: 'ambiguous', suspects: commits,
    reason: `${commits.length} commits by ${authors.size} author(s), ${relevant.size} of them relevant`
  };
}

/**
 * The incident whose regression window a build break with none of its own may borrow, or null.
 *
 * A break whose job history holds no green build gets no suspects, so neither `commentable` nor
 * `provable` — while a test of the same job that first failed in the *same* build has a last good
 * build and a window. On 2026-10-21 master's `xwiki-platform-rendering-macro-context` break was
 * reproduced at 2b79fb7b and passed at its parent, its `IntegrationTests` row read "since #9045,
 * last good #9044", and no comment went out because "the work order gave no suspects". The peer must
 * be the one that carries the comment (`commentable` or `provable`): the break then rides on it.
 *
 * @param {object} incident a deep build break
 * @param {object[]} all every incident of the run
 * @param {function(object): string} jobOf the job an incident was seen on — build numbers are per job
 */
export function sameBuildPeer(incident, all, jobOf) {
  if (!incident.deep || incident.class !== 2 || incident.commentable || incident.provable
    || incident.commentedWith || incident.primary === false || incident.silent || incident.beyondHorizon
    || incident.lastGoodBuild != null || incident.firstBadBuild == null
    || /sonar-gate:failed$/.test(incident.signature || '')) return null;
  return all.find(peer => peer !== incident && peer.class === 1 && peer.repo === incident.repo
    && peer.branch === incident.branch && jobOf(peer) === jobOf(incident)
    && peer.firstBadBuild === incident.firstBadBuild && peer.lastGoodBuild != null
    && peer.primary !== false && (peer.commentable || peer.provable)) || null;
}
