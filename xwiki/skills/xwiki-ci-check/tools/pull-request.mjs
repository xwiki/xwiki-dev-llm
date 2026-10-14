#!/usr/bin/env node
/*
 * Opens a fix pull request as the CI bot, labels it `llm-agent`, assigns it and locks its
 * conversation to collaborators — the one way a routine opens a PR (SKILL.md §5 says why: `gh` and
 * the GitHub MCP server act as the routine's owner).
 *
 * The branch is pushed beforehand by the Claude GitHub App. Locking needs the bot's `write` role;
 * a PR that could not be locked is reported and the process exits 3, because the routine's auto-fix
 * must not act on an unlocked PR (SKILL.md §5).
 *
 * An open PR for the same head is reused and every later step is idempotent, so a re-run completes
 * a half-done PR instead of opening a second one.
 *
 * Nothing is written without an explicit `--write`: the default prints the PR it would have opened.
 *
 * It also holds §5's brakes on how many PRs one run opens: at most 2 `--kind fix` — a quality-gate
 * fix included, since the brake is the reviewers' load — and 1 `--kind stabilise`, a draft that is
 * unassigned. The run is the work order's `generatedAt`, which each PR carries in a marker in its
 * body; a PR past the cap is refused with exit 4 (a reused PR is not a new one, and is never refused).
 *
 * Usage:
 *   node pull-request.mjs --work-order work-order.json --kind fix|stabilise --repo xwiki-platform \
 *     --head claude/<slug> --base master --title "[Misc] …" --file body.md [--assignee <login>] [--draft] [--write]
 *
 * `--assignee` is the culprit author for a fix PR, and refused for a flicker-stabilisation draft,
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

/** PRs one run may open, per kind (SKILL.md §5). */
export const LIMITS = { fix: 2, stabilise: 1 };
const REPOS = ['xwiki-commons', 'xwiki-rendering', 'xwiki-platform'];
const runMarker = (kind, run) => `<!-- xwiki-ci-check: pr kind=${kind} run=${run} -->`;

/** How many PRs of this kind this run has already opened, from the marker in their bodies. */
async function openedThisRun(kind, run, repo) {
  let count = 0;
  for (const name of new Set([...REPOS, repo])) {
    const pulls = await github(`/repos/xwiki/${name}/pulls?state=all&sort=created&direction=desc&per_page=50`);
    count += pulls.filter(pull => (pull.body || '').includes(runMarker(kind, run))).length;
  }
  return count;
}

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
export async function openPullRequest({ repo, head, base, title, body: text, assignee = null, draft = false,
  write = false, kind, run }) {
  const steps = [];
  const body = `${text.trimEnd()}\n\n${runMarker(kind, run)}\n`;
  if (!write) {
    steps.push(`check this run has opened fewer than ${LIMITS[kind]} ${kind} PR(s)`);
    console.log(`--- would open on xwiki/${repo}: ${head} → ${base}${draft ? ' (draft)' : ''} ---\n${title}\n\n${body}`);
    steps.push(`label ${LABEL}`, assignee ? `assign ${assignee}` : 'leave unassigned', 'lock to collaborators');
    return { url: null, steps: steps.map(step => `would ${step}`) };
  }
  const open = await github(`/repos/xwiki/${repo}/pulls?state=open&head=xwiki:${encodeURIComponent(head)}`);
  let pr = open[0];
  if (pr) {
    steps.push(`reused open PR #${pr.number}`);
  } else {
    const opened = await openedThisRun(kind, run, repo);
    if (opened >= LIMITS[kind]) {
      return { url: null, steps, refused: `this run has already opened ${opened} ${kind} PR(s), the most §5 allows`
        + ` (${LIMITS[kind]}) — open none, and put the pushed branch ${head} in the paste` };
    }
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
  // Reported rather than thrown: the PR is open, labelled and assigned either way, and the caller
  // decides from `locked` whether it may watch it.
  let locked = false;
  try {
    await github(`/repos/xwiki/${repo}/issues/${pr.number}/lock`, { method: 'PUT', body: JSON.stringify({}) });
    locked = true;
    steps.push('locked to collaborators');
  } catch (error) {
    steps.push(`NOT locked — ${error.message}`);
  }
  return { url: pr.html_url, number: pr.number, steps, locked };
}

// stdout is asynchronous on a pipe (macOS): process.exit() right after a write cuts off whatever the
// reader has not drained yet, so exit from the callback of a write queued behind it instead.
const exitAfterOutput = code => new Promise(() => process.stdout.write('', () => process.exit(code)));

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const options = { write: false, draft: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') options.repo = argv[++i];
    else if (argv[i] === '--work-order') options.workOrder = argv[++i];
    else if (argv[i] === '--kind') options.kind = argv[++i];
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
  for (const required of ['workOrder', 'kind', 'repo', 'head', 'base', 'title', 'file']) {
    if (!options[required]) { console.error(`--${required.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} is required`); process.exit(2); }
  }
  if (!(options.kind in LIMITS)) { console.error(`--kind is one of ${Object.keys(LIMITS).join(', ')}`); process.exit(2); }
  if (options.kind === 'stabilise') {
    // §5: a flicker usually has no culprit, and a wrong auto-assignment discredits the whole system.
    if (options.assignee) { console.error('a stabilisation PR is unassigned (SKILL.md §5): drop --assignee'); process.exit(2); }
    options.draft = true;
  }
  const workOrder = JSON.parse(readFileSync(options.workOrder, 'utf8'));
  if (workOrder.rehearsal && options.write) {
    console.error(`${options.workOrder} is a ${workOrder.rehearsal} rehearsal (ci-check.mjs --rehearse-stabilise):`
      + ' nothing is opened from it — drop --write');
    process.exit(2);
  }
  options.run = workOrder.generatedAt;
  if (!options.run) { console.error(`${options.workOrder} has no generatedAt: pass the work order ci-check.mjs wrote`); process.exit(2); }
  if (!token && options.write) {
    console.error('GH_TOKEN_BOT is not set. This tool opens the PR as the CI bot and will not fall back to '
      + 'a personal token — set the bot token, or drop --write.');
    process.exit(2);
  }
  const result = await openPullRequest({ ...options, body: readFileSync(options.file, 'utf8') });
  if (result.refused) {
    console.error(`not opened: ${result.refused}`);
    process.exit(4);
  }
  console.log(`${result.url ?? 'not opened (rehearsal — pass --write to open)'}\n${result.steps.map(s => `  - ${s}`).join('\n')}`);
  if (result.url && !result.locked) {
    // Printed here, where the failure is, rather than left to a rule the session may have skimmed:
    // auto-fix may already have subscribed the session, and every comment on an unlocked PR then
    // reaches a model that can push.
    console.error(`unlocked PR #${result.number} (${result.url}) — hands off it:\n`
      + `  1. unsubscribe this session from it: unsubscribe_pr_activity, PR #${result.number};\n`
      + `  2. put "unlocked PR #${result.number}" first in the report;\n`
      + '  3. never lock it, comment on it or retry it with the session\'s own GitHub access (gh, the GitHub MCP server).');
    await exitAfterOutput(3);
  }
}
