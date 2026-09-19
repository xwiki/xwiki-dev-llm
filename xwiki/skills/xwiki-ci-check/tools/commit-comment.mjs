#!/usr/bin/env node
/*
 * Posts one comment on the culprit commit on GitHub, as the CI bot, carrying the marker that stops
 * the next run repeating it.
 *
 * This exists rather than a freehand `gh api` call because the marker is a contract with
 * ci-check.mjs: that script decides "already said" by parsing markers left by this one, so a
 * hand-written comment whose marker is a character off is not a duplicate that gets noticed — it
 * is a duplicate posted every single morning, and nothing in the output says so. Both ends of the
 * contract therefore live in the repo, and only here.
 *
 * It also re-checks for an existing comment immediately before posting, closing the window between
 * the sweep and the write (a second run of the routine, or a developer running it by hand).
 *
 * Nothing is posted without an explicit `--write`. The default is a rehearsal that prints the
 * comment it would have left, because this tool is run on machines where the bot token is always
 * exported — a developer's own laptop during a local sweep — and there one forgotten flag is a real
 * comment on a colleague's commit. A mistaken invocation must be a no-op, not a message.
 *
 * Usage:
 *   node commit-comment.mjs --repo xwiki-platform --sha <sha> --incident <id> --state systematic \
 *     --file body.md [--write]
 *   node commit-comment.mjs --repo xwiki-platform --pr 5928 --incident <id> --state … --file body.md
 *
 * `--pr` posts the same comment, with the same marker and the same idempotency, on a pull request
 * instead of a commit. It exists for the quality gate: the issues that fail it were introduced in a
 * squashed PR, and that is where the change was reviewed and where its author and its reviewer are
 * both already subscribed.
 *
 * Environment: GH_TOKEN_BOT — the bot account's token, and deliberately nothing else.
 */

import { readFileSync } from 'node:fs';

// Only the bot's token, with no fallback to GITHUB_TOKEN or GH_TOKEN. Those hold a developer's own
// credentials on a developer's machine, and a fallback would mean that running this locally posts
// "your commit broke master" to a colleague under your name — the one outcome the bot identity
// exists to prevent. Absent the bot token this refuses to post rather than posting as someone else.
const token = process.env.GH_TOKEN_BOT;

/** The invisible marker. Its two fields are the incident's identity and what was said about it. */
export const marker = (incident, state) => `<!-- xwiki-ci-check: ${incident} state=${state} -->`;

// Added here rather than left to the wording of each comment, so that it cannot be forgotten on the
// one comment that lands on a wrong commit. Someone reading "your commit broke the build" is owed
// two things immediately: that a machine said it, and that ignoring it costs them nothing.
const FOOTER = '_Posted by the automated `xwiki-ci-check` sweep. If the attribution is wrong, say so' +
  ' here and ignore it — this failure will not be commented on again._';

const MARKER_RE = /<!--\s*xwiki-ci-check:\s*(\S+)\s+state=(\S+)\s*-->/;

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
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * @returns {Promise<{posted: boolean, url: string|null, reason: string}>} `posted: false` with a
 *   reason is a normal outcome, not an error: staying silent is the point of the marker.
 */
export async function comment(repo, sha, incident, state, body, { write = false, pr = null } = {}) {
  // One target, two URLs. A PR's comments are issue comments; a commit's are its own — everything
  // else about this function, the marker included, is identical, because "have we said this
  // already" must not depend on where we said it.
  const where = pr ? `/repos/xwiki/${repo}/issues/${pr}/comments` : `/repos/xwiki/${repo}/commits/${sha}/comments`;
  const human = pr ? `https://github.com/xwiki/${repo}/pull/${pr}` : `https://github.com/xwiki/${repo}/commit/${sha}`;
  const existing = await github(where);
  for (const previous of existing) {
    const found = (previous.body || '').match(MARKER_RE);
    if (found?.[1] !== incident) continue;
    // Said once already, and nothing has changed: silence. A *different* state is news — a flicker
    // that has become a systematic breakage is worth saying again.
    if (found[2] === state) {
      return { posted: false, url: previous.html_url, reason: `already commented on ${previous.created_at}` };
    }
  }
  const full = `${body.trimEnd()}\n\n${FOOTER}\n\n${marker(incident, state)}\n`;
  if (!write) {
    console.log(`--- would comment on ${human} ---\n${full}`);
    return { posted: false, url: null, reason: 'rehearsal — pass --write to post' };
  }
  const created = await github(where, {
    method: 'POST',
    body: JSON.stringify({ body: full })
  });
  return { posted: true, url: created.html_url, reason: 'posted' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  // Default-safe: writing is opt-in. `--dry-run` stays accepted, so that saying "do not post" out
  // loud remains possible and older invocations keep working; it is simply what happens anyway.
  const options = { write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') options.repo = argv[++i];
    else if (argv[i] === '--sha') options.sha = argv[++i];
    else if (argv[i] === '--pr') options.pr = argv[++i];
    else if (argv[i] === '--incident') options.incident = argv[++i];
    else if (argv[i] === '--state') options.state = argv[++i];
    else if (argv[i] === '--file') options.file = argv[++i];
    else if (argv[i] === '--write') options.write = true;
    else if (argv[i] === '--dry-run') options.write = false;
    else { console.error(`Unknown argument [${argv[i]}]`); process.exit(2); }
  }
  for (const required of ['repo', 'incident', 'state']) {
    if (!options[required]) { console.error(`--${required} is required`); process.exit(2); }
  }
  if (!options.sha && !options.pr) { console.error('one of --sha or --pr is required'); process.exit(2); }
  if (!token && options.write) {
    console.error('GH_TOKEN_BOT is not set. This tool posts as the CI bot and will not fall back to a '
      + 'personal token — set the bot token, or drop --write.');
    process.exit(2);
  }
  const body = options.file ? readFileSync(options.file, 'utf8') : readFileSync(0, 'utf8');
  const result = await comment(options.repo, options.sha, options.incident, options.state, body, options);
  console.log(`${result.posted ? 'posted' : 'not posted'}: ${result.reason}${result.url ? ` — ${result.url}` : ''}`);
}
