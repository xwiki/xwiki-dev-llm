#!/usr/bin/env node
/*
 * Posts the daily digest to a Matrix room, as the CI bot.
 *
 * The digest is a *state snapshot*, not an event stream: it says what CI looks like this morning,
 * so repeating yesterday's lines is correct behaviour, which is why each line must carry its age.
 * Keep it short — the detail belongs in the paste it links to.
 *
 * Identity matters more than mechanism here: this must run as a dedicated bot, never as a
 * developer's own account. An automated "your commit broke master" arriving under a colleague's
 * name reads as a personal reprimand, and a wrong attribution is then wrong in their name.
 *
 * Nothing is sent without an explicit `--write`: the default prints the digest it would have
 * posted. The room is read by the whole development team, so a mistaken invocation must cost
 * nothing — and this tool runs on machines where the bot's Matrix password is always exported.
 *
 * Usage:
 *   node matrix.mjs --file <digest.md> --write
 *   echo "..." | node matrix.mjs        # rehearsal: prints, sends nothing
 *   node matrix.mjs --whoami            # which account the credentials in the environment are
 *
 * Environment: MATRIX_USER_BOT + MATRIX_PASSWORD_BOT, or MATRIX_TOKEN_BOT; MATRIX_HOMESERVER and
 * MATRIX_ROOM are both defaulted below.
 *
 * **Prefer the password.** matrix.org has moved to an authentication service that issues
 * short-lived access tokens (the `mat_` ones), refreshed continuously inside a client — so a token
 * copied out of Element into a profile or a secret store is dead within minutes, and a routine that
 * runs at 06:00 finds it expired every single morning. Logging in per run needs no stored token and
 * no refresh-token rotation to persist, which is what a sandbox that is new every day can actually
 * do. A `MATRIX_TOKEN_BOT` is still honoured — homeservers that issue non-expiring tokens exist —
 * and when it is rejected the password takes over, which is the normal path, not an error.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// The homeserver is where the bot's *account* lives; the room lives on matrix.xwiki.com whatever
// that is, which is why the default alias is fully qualified. A bare `#xwiki` would be completed
// with the homeserver's own hostname and build `#xwiki:matrix.org`, a room that does not exist.
const DEFAULT_HOMESERVER = 'https://matrix.org';
const DEFAULT_ROOM = '#xwiki:matrix.xwiki.com';
// A fixed device, so a routine running every morning reuses one session instead of leaving a year's
// worth of logins on the account.
const DEVICE_ID = 'XWIKICICHECK';

const homeserver = (process.env.MATRIX_HOMESERVER || DEFAULT_HOMESERVER).replace(/\/+$/, '');
const accessToken = process.env.MATRIX_TOKEN_BOT;
const room = process.env.MATRIX_ROOM || DEFAULT_ROOM;

const escapeHtml = text =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Just enough Markdown for a digest — links, bold, code — rendered to the HTML subset Matrix
 * clients accept. Anything richer belongs in the paste, not in a chat room.
 */
export function toHtml(markdown) {
  return escapeHtml(markdown)
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // A bare URL is the usual shape of the "detail here" line, so make it clickable too.
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>')
    .replace(/\n/g, '<br/>');
}

/**
 * Exchanges the bot's password for an access token, through the r0 login API that both Synapse and
 * matrix.org's authentication service still answer.
 *
 * @returns {Promise<{token: string, userId: string}>}
 */
export async function login(server, user, password) {
  const res = await fetch(`${server}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user },
      password,
      device_id: DEVICE_ID,
      initial_device_display_name: 'xwiki-ci-check'
    })
  });
  if (!res.ok) {
    throw new Error(`Matrix login failed for [${user}] on ${server}: HTTP ${res.status} `
      + `${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  return { token: body.access_token, userId: body.user_id };
}

/** The account a token belongs to, or null when the server does not accept it. */
export async function whoami(server, token) {
  const res = await fetch(`${server}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok ? (await res.json()).user_id : null;
}

/**
 * The credential this run will post with: the token in the environment when the server still
 * accepts it, the password otherwise.
 *
 * The check costs one request and buys the difference between "the digest was not posted" and a
 * stack trace at 06:00 — on matrix.org a stored token is expected to be dead, so falling back is
 * the normal path.
 */
export async function credential(server = homeserver) {
  const user = process.env.MATRIX_USER_BOT;
  const password = process.env.MATRIX_PASSWORD_BOT;
  if (accessToken) {
    const userId = await whoami(server, accessToken);
    if (userId) return { token: accessToken, userId, how: 'MATRIX_TOKEN_BOT' };
    if (!user || !password) {
      throw new Error(`MATRIX_TOKEN_BOT is not accepted by ${server} and there is no `
        + 'MATRIX_USER_BOT / MATRIX_PASSWORD_BOT to fall back on. A matrix.org `mat_` token is '
        + 'short-lived by design: set the password instead.');
    }
  }
  if (!user || !password) throw new Error('Set MATRIX_USER_BOT and MATRIX_PASSWORD_BOT (or MATRIX_TOKEN_BOT)');
  const { token, userId } = await login(server, user, password);
  return { token, userId, how: 'password login' };
}

/**
 * Turns a human room **alias** into the internal room id the send API needs.
 *
 * `#xwiki` is an alias, not an id: the API addresses rooms as `!opaque:server` and answers 404 for
 * anything else. An alias with no `:server` part is completed with the homeserver's, which is what
 * anyone typing the room's name actually means.
 */
export async function resolveRoom(alias, server, token) {
  if (!alias.startsWith('#')) return alias;
  const full = alias.includes(':') ? alias : `${alias}:${new URL(server).hostname}`;
  const res = await fetch(`${server}/_matrix/client/v3/directory/room/${encodeURIComponent(full)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Cannot resolve the room alias [${full}]: HTTP ${res.status} `
      + `${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()).room_id;
}

/**
 * Joins the room, which is a no-op for an account that is already in it.
 *
 * Done on demand, after a send is refused, rather than before every send: a bot that is in the room
 * — the normal case — should not pay a request a day to prove it, and a bot that has been invited
 * and never accepted should not need a human to notice.
 */
async function join(server, token, roomId) {
  const res = await fetch(`${server}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!res.ok) {
    throw new Error(`Cannot join [${roomId}]: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
      + ' — an invite-only room needs someone already in it to invite the bot');
  }
}

/** @returns {Promise<string>} the event id of the posted message. */
export async function send(text, { server = homeserver, token = null, roomId = room } = {}) {
  for (const [name, value] of [['MATRIX_HOMESERVER', server], ['MATRIX_ROOM', roomId]]) {
    if (!value) throw new Error(`${name} is not set — the digest cannot be posted`);
  }
  token ??= (await credential(server)).token;
  roomId = await resolveRoom(roomId, server, token);
  const body = JSON.stringify({
    msgtype: 'm.text',
    body: text,
    format: 'org.matrix.custom.html',
    formatted_body: toHtml(text)
  });
  // A transaction id makes the send idempotent per attempt, so the retry below cannot double-post.
  const put = () => fetch(
    `${server}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }
  );
  let res = await put();
  if (res.status === 403) {
    await join(server, token, roomId);
    res = await put();
  }
  if (!res.ok) throw new Error(`Matrix send failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).event_id;
}

// ---- CLI -------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  let file = null;
  // Default-safe: sending is opt-in. `--dry-run` remains accepted for saying so explicitly.
  let write = false;
  let identify = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') file = argv[++i];
    else if (argv[i] === '--write') write = true;
    else if (argv[i] === '--dry-run') write = false;
    else if (argv[i] === '--whoami') identify = true;
    else { console.error(`Unknown argument [${argv[i]}]`); process.exit(2); }
  }
  // A credential problem is the expected failure of this tool, so it reports it as a sentence. A
  // stack trace in a 06:00 routine log says "the tool is broken" about a token that merely expired.
  const fail = error => { console.error(`matrix.mjs: ${error.message}`); process.exit(1); };
  if (identify) {
    await credential()
      .then(({ userId, how }) => console.log(`${userId} on ${homeserver} (${how}), posting to ${room}`))
      .catch(fail);
    process.exit(0);
  }
  const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  if (!text.trim()) { console.error('Nothing to post'); process.exit(2); }
  if (write) {
    await send(text).then(eventId => console.log(eventId)).catch(fail);
  } else {
    console.log(`--- would post to ${room} on ${homeserver} (pass --write to send) ---\n${text}`);
  }
}
