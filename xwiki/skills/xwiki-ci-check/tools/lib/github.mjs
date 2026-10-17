/*
 * GitHub, read-only: commits, their files, and the markers earlier comments left. Part of
 * ci-check.mjs.
 */

import { buildRevision } from '../../../../scripts/jenkins.mjs';

// ---- GitHub (read-only) ----------------------------------------------------------------------

const GITHUB = 'https://api.github.com';
// Reads may use whatever token is around — a developer running this by hand has their own, and the
// GitHub read API does not care whose it is. Writing is the opposite: `commit-comment.mjs` accepts
// the bot's token and nothing else, so no fallback here can ever put a human's name on a comment.
const tokens = [process.env.GH_TOKEN_BOT, process.env.GITHUB_TOKEN, process.env.GH_TOKEN].filter(Boolean);
export let token = tokens[0];
export let tokenFallback = null;

/**
 * One GitHub read.
 *
 * The bot's token can be refused wholesale rather than per-request — the `xwiki` org rejects a
 * fine-grained token whose lifetime exceeds 366 days, answering 403 to *every* call including a
 * plain public-repo read. That is a misconfiguration to fix, not a reason for the morning sweep to
 * report "no blame available" for days, so a read falls through to the next token available and
 * says so in the report. Writes have no such path.
 */
export async function github(path) {
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
export const BOT_LOGIN = /\[bot\]$|^xwikiorg-llm-bot$/i;

export async function commitsBetween(repo, baseSha, headSha, { maxCommits = 20 } = {}) {
  const data = await github(`/repos/xwiki/${repo}/compare/${baseSha}...${headSha}`);
  if (!data?.commits) return [];
  const commits = data.commits.filter(c => (c.parents || []).length < 2).slice(-maxCommits);
  return Promise.all(commits.map(async commit => {
    const detail = await detailOf(repo, commit.sha);
    return {
      sha: commit.sha,
      short: commit.sha.slice(0, 10),
      // `author` is the GitHub account; `commit.author` is the git identity, which for a merged PR
      // is often GitHub's `noreply` robot. Prefer the account, and never ping a `noreply`. Nor a bot:
      // a merged fix PR of this very routine is authored by `xwikiorg-llm-bot`, and was once the only
      // suspect of the break it had uncovered (2026-10-17).
      author: BOT_LOGIN.test(commit.author?.login || '') ? null : commit.author?.login || null,
      gitAuthor: commit.commit?.author?.name || null,
      title: (commit.commit?.message || '').split('\n')[0].slice(0, 120),
      url: commit.html_url,
      date: commit.commit?.author?.date || null,
      files: (detail?.files || []).map(f => f.filename).slice(0, 200)
    };
  }));
}

/** Whether this incident was already commented on, and in what state. */
export async function priorComment(repo, sha, incidentId) {
  return markerIn(await github(`/repos/xwiki/${repo}/commits/${sha}/comments`), incidentId);
}

/** The same question about a pull request, which is where a gate comment goes when there is one. */
export async function priorPrComment(repo, number, incidentId) {
  return markerIn(await github(`/repos/xwiki/${repo}/issues/${number}/comments`), incidentId);
}

function markerIn(comments, incidentId) {
  for (const comment of comments || []) {
    // One comment may carry several markers: one per incident it answered (§4, one per commit).
    for (const marker of (comment.body || '').matchAll(/<!--\s*xwiki-ci-check:\s*(\S+)\s+state=(\S+)\s*-->/g)) {
      if (marker[1] === incidentId) return { state: marker[2], url: comment.html_url, at: comment.created_at };
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
export async function unbuiltCommits(target, jobs, args) {
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
