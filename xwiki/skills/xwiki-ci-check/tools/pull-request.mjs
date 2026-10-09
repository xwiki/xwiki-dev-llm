#!/usr/bin/env node
/*
 * Opens a fix pull request as the CI bot, labels it `llm-agent`, assigns it and locks its
 * conversation to collaborators — the one way a routine opens a PR.
 *
 * This exists rather than `gh pr create` or the GitHub MCP server because both of those act as
 * whoever the session is authenticated as, and in a cloud routine that is the developer who owns
 * the routine: a PR opened that way reads as a colleague's proposed work, not the machine's. Reading
 * GH_TOKEN_BOT and nothing else is what keeps the author the bot, exactly as for commit-comment.mjs.
 *
 * The branch itself is pushed beforehand by whatever can push (the Claude GitHub App in a routine):
 * the bot has `triage` on `xwiki/*`, which is enough to open a PR from an upstream branch, label,
 * assign and lock it, and not enough to push — which is correct.
 *
 * Every step after the creation is idempotent, and an open PR for the same head is reused rather
 * than duplicated, so re-running after a partial failure (say the lock was refused) completes the
 * PR instead of opening a second one.
 *
 * Nothing is written without an explicit `--write`: the default prints the PR it would have opened.
 *
 * Usage:
 *   node pull-request.mjs --repo xwiki-platform --head claude/<slug> --base master \
 *     --title "[Misc] …" --file body.md [--assignee <login>] [--draft] [--write]
 *
 * `--assignee` is the culprit author for a fix PR, and absent for a flicker-stabilisation draft,
 * which is unassigned (§5).
 *
 * Environment: GH_TOKEN_BOT — the bot account's token, and deliberately nothing else.
 */

import { readFileSync } from 'node:fs';

// Same rule as commit-comment.mjs: no fallback to GITHUB_TOKEN / GH_TOKEN, which hold a developer's
// own credentials. Without the bot token this refuses rather than opening the PR as someone else.
const token = process.env.GH_TOKEN_BOT;

// The label every machine-generated PR carries, so that reviewers, filters and the other routines
// (xwiki-fix-sonarqube-issue checks it for work in flight) can tell it from a human's.
export const LABEL = 'llm-agent';

async function github(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'xwiki-ci-check',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/**
 * @returns {Promise<{url: string|null, steps: string[]}>} `steps` says what was done (or, in a
 *   rehearsal, what would have been), one entry per write.
 */
export async function openPullRequest({ repo, head, base, title, body, assignee = null, draft = false,
  write = false }) {
  const steps = [];
  if (!write) {
    console.log(`--- would open on xwiki/${repo}: ${head} → ${base}${draft ? ' (draft)' : ''} ---\n${title}\n\n${body}`);
    steps.push(`label ${LABEL}`, assignee ? `assign ${assignee}` : 'leave unassigned', 'lock to collaborators');
    return { url: null, steps: steps.map(step => `would ${step}`) };
  }
  const open = await github(`/repos/xwiki/${repo}/pulls?state=open&head=xwiki:${encodeURIComponent(head)}`);
  let pr = open[0];
  if (pr) {
    steps.push(`reused open PR #${pr.number}`);
  } else {
    pr = await github(`/repos/xwiki/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title, head, base, body, draft, maintainer_can_modify: true })
    });
    steps.push(`opened #${pr.number}`);
  }
  await github(`/repos/xwiki/${repo}/issues/${pr.number}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels: [LABEL] })
  });
  steps.push(`labelled ${LABEL}`);
  if (assignee) {
    await github(`/repos/xwiki/${repo}/issues/${pr.number}/assignees`, {
      method: 'POST',
      body: JSON.stringify({ assignees: [assignee] })
    });
    steps.push(`assigned ${assignee}`);
  }
  // Locked so that only collaborators can comment: the PR is public, unattended and written by a
  // machine, which is what a drive-by prompt injection in a comment would aim at. GitHub wants admin
  // rights on the repo for this, more than the `triage` the bot has, so a refusal is reported rather
  // than thrown: the PR is open, labelled and assigned, and is still worth more than no PR. Nothing
  // needs the lock until "autofix PRs" is enabled — until then no model reads the PR's comments.
  try {
    await github(`/repos/xwiki/${repo}/issues/${pr.number}/lock`, { method: 'PUT', body: JSON.stringify({}) });
    steps.push('locked to collaborators');
  } catch (error) {
    steps.push(`NOT locked — ${error.message}`);
  }
  return { url: pr.html_url, steps };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const options = { write: false, draft: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') options.repo = argv[++i];
    else if (argv[i] === '--head') options.head = argv[++i];
    else if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--title') options.title = argv[++i];
    else if (argv[i] === '--file') options.file = argv[++i];
    else if (argv[i] === '--assignee') options.assignee = argv[++i];
    else if (argv[i] === '--draft') options.draft = true;
    else if (argv[i] === '--write') options.write = true;
    else if (argv[i] === '--dry-run') options.write = false;
    else { console.error(`Unknown argument [${argv[i]}]`); process.exit(2); }
  }
  for (const required of ['repo', 'head', 'base', 'title', 'file']) {
    if (!options[required]) { console.error(`--${required} is required`); process.exit(2); }
  }
  if (!token && options.write) {
    console.error('GH_TOKEN_BOT is not set. This tool opens the PR as the CI bot and will not fall back to '
      + 'a personal token — set the bot token, or drop --write.');
    process.exit(2);
  }
  const result = await openPullRequest({ ...options, body: readFileSync(options.file, 'utf8') });
  console.log(`${result.url ?? 'not opened (rehearsal — pass --write to open)'}\n${result.steps.map(s => `  - ${s}`).join('\n')}`);
}
