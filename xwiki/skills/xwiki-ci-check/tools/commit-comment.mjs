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
 * And it comments only where the sweep said a comment may go: `--work-order` is the file
 * `ci-check.mjs` wrote, and the incident must carry `commentable` naming this very commit or PR —
 * SKILL.md §4's skip list, computed there. Anything else is `not posted`, in a rehearsal too.
 *
 * At most one comment per commit per run: when two incidents blame one commit, the sweep gives
 * `commentable` to one of them, with the others in its `covers`, and the others `commentedWith`. The
 * comment then carries one marker per incident it answers, so tomorrow's run finds each of them
 * already said, and a comment for a covered incident is refused.
 *
 * Usage:
 *   node commit-comment.mjs --work-order work-order.json --incident <id> --sha <sha> --file body.md [--write]
 *   node commit-comment.mjs --work-order work-order.json --incident <id> --pr 5928 --file body.md
 *
 *   node commit-comment.mjs … --sha <suspect> --proof reproduced|in-diff|diff-link --why "<one sentence>"
 *
 * `--repo` and `--state` default to the incident's; given, they must match it.
 *
 * `--proof` is for an incident carrying `provable` rather than `commentable`: the tool could not
 * pick a culprit, and the run proved one among its suspects. The sha must be one of them, and the
 * comment carries the proof's kind and `--why` under the body. On a `commentable` commit it raises
 * what the comment may say: the tool's `likely` pick, once reproduced, may state the cause.
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

const MARKER_RE = /<!--\s*xwiki-ci-check:\s*(\S+)\s+state=(\S+)\s*-->/g;

/**
 * What a proof may claim. `reproduced` and `in-diff` are observations a reader can repeat, so the
 * comment may state the cause, as for a `certain` tier; `diff-link` is a reading of the diff, so it
 * may only ask, as for `likely` (references/commit-comment.md).
 */
export const PROOFS = { reproduced: 'certain', 'in-diff': 'certain', 'diff-link': 'likely' };
const PROOF_LABELS = {
  reproduced: 'reproduced: fails with this commit, passes without it',
  'in-diff': 'the failure is on lines this commit changed',
  'diff-link': 'read from the diff, not reproduced'
};

/** Why a proof is not one, or null. */
function unproven(proof, why) {
  if (!PROOFS[proof]) return `a culprit the tool did not pick needs --proof ${Object.keys(PROOFS).join('|')}`;
  if (!why || why.trim().length < 20) return '--why must say, in one sentence, what links the commit to the failure';
  return null;
}

/**
 * The target of a comment on a culprit the model proved among the tool's suspects, an explanation
 * of why there is none, or null when the incident is not `provable` at all.
 */
function provenTarget(found, { sha, pr, proof, why }) {
  if (!found.provable) return null;
  if (pr) return 'a proven culprit is a commit: pass --sha';
  const weak = unproven(proof, why);
  if (weak) return weak;
  const suspect = found.provable.suspects.find(entry => sha && sha.length >= 7 && entry.sha.startsWith(sha));
  if (!suspect) {
    return `${sha} is not one of the incident's suspects — a proof picks among them, never outside the window`;
  }
  // `covers`: a build break borrowing the window of the test that first failed in the same build
  // answers that test too, in this one comment.
  return { repo: found.provable.repo, state: found.provable.state, sha: suspect.sha, tier: PROOFS[proof], proof, why,
    covers: found.provable.covers };
}

/**
 * The tool's own pick, raised by a proof. On 2026-10-18 the run reproduced master's lint break on
 * the rule b565ea607d enabled, and still had to *ask* its author, because `likely` was the tool's
 * tier and only `provable` took a proof. A gate's comment stays `likely` whatever is proven: it
 * names whose code is under a condition, not who broke a build.
 */
function raisedTarget(found, { proof, why }) {
  const target = found.commentable;
  // The incident the stabilisation slot proved: its culprit was asked already, so a second comment
  // is the proof or nothing.
  if (target.followUp && proof !== target.followUp) {
    return `this commit was already asked: the follow-up goes only with --proof ${target.followUp}`;
  }
  if (!proof) return target;
  if (target.pr || found.sonar) return 'a quality-gate comment is worded likely, never more: drop --proof';
  const weak = unproven(proof, why);
  if (weak) return weak;
  return { ...target, tier: target.tier === 'certain' ? 'certain' : PROOFS[proof], proof, why };
}

/**
 * Where the comment goes: the tool's pick, raised or not, or the suspect a proof singled out — which
 * replaces a `likely` pick only when the work order says it may (`provable.instead`) and only on a
 * proof a reader can repeat. A reading of the diff does not overrule the tool's own reading.
 */
function targetOf(found, options) {
  const { sha, proof } = options;
  const other = found.commentable && sha && !found.commentable.sha?.startsWith(sha);
  if (other && found.provable?.instead) {
    if (PROOFS[proof] !== 'certain') {
      return `replacing the work order's pick ${found.commentable.sha} needs --proof reproduced|in-diff`;
    }
    return provenTarget(found, options);
  }
  return found.commentable ? raisedTarget(found, options) : provenTarget(found, options);
}

/**
 * Why the work order does not allow this comment, or null when it does.
 *
 * @param {object} report the work order `ci-check.mjs` printed
 * @param {{incident: string, repo?: string, state?: string, sha?: string, pr?: string}} options
 */
export function refusal(report, { incident, repo, state, sha, pr, proof, why }) {
  const found = (report?.incidents || []).find(entry => entry.id === incident);
  if (!found) return `incident ${incident} is not in the work order`;
  if (found.commentedWith) {
    return `one comment per commit per run (SKILL.md §4): this incident goes in the comment of ${found.commentedWith}`
      + ' — write both into that one body';
  }
  const target = targetOf(found, { sha, pr, proof, why });
  if (typeof target === 'string') return target;
  if (!target) return 'the work order does not make this incident commentable (SKILL.md §4)';
  if (repo && repo !== target.repo) return `the incident is in ${target.repo}, not ${repo}`;
  if (state && state !== target.state) return `the incident's state is ${target.state}, not ${state}`;
  if (target.pr ? String(target.pr) !== String(pr) : pr || !(target.sha && sha && target.sha.startsWith(sha) && sha.length >= 7)) {
    return `the work order's target is ${target.pr ? `PR #${target.pr}` : target.sha}, not ${pr ? `PR #${pr}` : sha}`;
  }
  return null;
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
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * @returns {Promise<{posted: boolean, url: string|null, reason: string}>} `posted: false` with a
 *   reason is a normal outcome, not an error: staying silent is the point of the marker.
 */
export async function comment(repo, sha, incident, state, body,
  { write = false, pr = null, covers = [], proven = null } = {}) {
  // One target, two URLs. A PR's comments are issue comments; a commit's are its own — everything
  // else about this function, the marker included, is identical, because "have we said this
  // already" must not depend on where we said it.
  const where = pr ? `/repos/xwiki/${repo}/issues/${pr}/comments` : `/repos/xwiki/${repo}/commits/${sha}/comments`;
  const human = pr ? `https://github.com/xwiki/${repo}/pull/${pr}` : `https://github.com/xwiki/${repo}/commit/${sha}`;
  const existing = await github(where);
  for (const previous of existing) {
    for (const found of (previous.body || '').matchAll(MARKER_RE)) {
      // Said once already, and nothing has changed: silence. A *different* state is news — a flicker
      // that has become a systematic breakage is worth saying again.
      if (found[1] === incident && found[2] === state) {
        return { posted: false, url: previous.html_url, reason: `already commented on ${previous.created_at}` };
      }
    }
  }
  const markers = [marker(incident, state), ...covers.map(other => marker(other.id, other.state))].join('\n');
  // A culprit the tool did not pick is named on the strength of a proof, so the proof is printed
  // where the person it names reads it — by the tool, not left to the wording of the day.
  const proof = proven ? `\n\n**Why this commit** (${PROOF_LABELS[proven.proof]}): ${proven.why.trim()}` : '';
  const full = `${body.trimEnd()}${proof}\n\n${FOOTER}\n\n${markers}\n`;
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

// stdout is asynchronous on a pipe (macOS): process.exit() right after a write cuts off whatever the
// reader has not drained yet, so exit from the callback of a write queued behind it instead.
const exitAfterOutput = code => new Promise(() => process.stdout.write('', () => process.exit(code)));

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  // Default-safe: writing is opt-in. `--dry-run` stays accepted, so that saying "do not post" out
  // loud remains possible and older invocations keep working; it is simply what happens anyway.
  const options = { write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--work-order') options.workOrder = argv[++i];
    else if (argv[i] === '--repo') options.repo = argv[++i];
    else if (argv[i] === '--sha') options.sha = argv[++i];
    else if (argv[i] === '--pr') options.pr = argv[++i];
    else if (argv[i] === '--incident') options.incident = argv[++i];
    else if (argv[i] === '--state') options.state = argv[++i];
    else if (argv[i] === '--file') options.file = argv[++i];
    else if (argv[i] === '--proof') options.proof = argv[++i];
    else if (argv[i] === '--why') options.why = argv[++i];
    else if (argv[i] === '--write') options.write = true;
    else if (argv[i] === '--dry-run') options.write = false;
    else { console.error(`Unknown argument [${argv[i]}]`); process.exit(2); }
  }
  for (const required of ['workOrder', 'incident']) {
    if (!options[required]) { console.error(`--${required.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} is required`); process.exit(2); }
  }
  if (!options.sha && !options.pr) { console.error('one of --sha or --pr is required'); process.exit(2); }
  const report = JSON.parse(readFileSync(options.workOrder, 'utf8'));
  if (report.rehearsal && options.write) {
    console.error(`${options.workOrder} is a ${report.rehearsal} rehearsal (ci-check.mjs --rehearse-stabilise):`
      + ' nothing is posted from it — drop --write');
    process.exit(2);
  }
  const refused = refusal(report, options);
  // A normal outcome, like "already commented": the skip list said no, and saying so is the output.
  if (refused) {
    console.log(`not posted: ${refused}`);
    await exitAfterOutput(0);
  }
  const found = report.incidents.find(entry => entry.id === options.incident);
  const target = targetOf(found, options);
  options.repo ??= target.repo;
  options.state ??= target.state;
  options.covers = target.covers || [];
  options.proven = target.proof ? target : null;
  if (!token && options.write) {
    console.error('GH_TOKEN_BOT is not set. This tool posts as the CI bot and will not fall back to a '
      + 'personal token — set the bot token, or drop --write.');
    process.exit(2);
  }
  const body = options.file ? readFileSync(options.file, 'utf8') : readFileSync(0, 'utf8');
  const result = await comment(options.repo, options.sha, options.incident, options.state, body, options);
  console.log(`${result.posted ? 'posted' : 'not posted'}: ${result.reason}${result.url ? ` — ${result.url}` : ''}`);
}
