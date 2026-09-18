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
 * The room is also the **ledger**. A digest that repeats what it said yesterday is what the CI
 * dashboard already is, so each one is compared against the last, and a morning that moved nothing
 * is not posted at all. The comparison needs yesterday's incident ids, which the digest's prose
 * cannot carry — twenty of them are 1.5 KB — so the message carries them in a marker appended to
 * its `formatted_body`, base64 so that nothing in a test name can end the HTML comment early.
 * Clients render a whitelist of tags and drop comments; bridges relay the plain `body`, which stays
 * exactly what was written. Nothing else is needed: the state rides on the message it describes, so
 * the two cannot drift apart, and a morning that posts nothing changes neither.
 *
 * Usage:
 *   node matrix.mjs --file <digest.md> --state <delta.json> --write
 *   echo "..." | node matrix.mjs        # rehearsal: prints, sends nothing
 *   node matrix.mjs --whoami            # which account the credentials in the environment are
 *   node matrix.mjs --last-digest       # the bot's most recent message in the room (read-only)
 *   node matrix.mjs --last-state        # the state that message carries, for --previous
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

// ---- The state the digest carries forward ----------------------------------------------------

const MARKER = /<!--\s*ci-state:([A-Za-z0-9+/=]*)\s*-->/;

/** The HTML body of a digest, with the state it carries appended where no client will show it. */
export function withState(html, state) {
  if (state == null) return html;
  return `${html}\n<!-- ci-state:${Buffer.from(JSON.stringify(state), 'utf8').toString('base64')} -->`;
}

/**
 * The state a digest carries, or null when it carries none — which is what every message posted
 * before this existed, and every human message, looks like.
 *
 * Never throws: a marker that does not decode is a marker from a version that wrote it differently,
 * and the caller's answer to both is the same one it has for an unreadable room.
 */
export function stateOf(html) {
  const marker = MARKER.exec(html || '');
  if (!marker) return null;
  try {
    return JSON.parse(Buffer.from(marker[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * The bot's own most recent message in the room, with whatever state it carries.
 *
 * Filtered on the sender server-side, so the humans talking in the room cost nothing to skip. A
 * filtered read returns the matches of one scrollback chunk, not of the whole room, so an empty
 * page with a continuation token is followed — a quiet week of the bot is otherwise indistinguishable
 * from a bot that has never posted.
 *
 * @returns {Promise<{eventId: string, at: string, body: string, state: object|null}|null>} null
 *   when the bot has posted nothing within reach.
 */
export async function lastDigest({ server = homeserver, roomId = room, pages = 5, token = null } = {}) {
  // A login with a fixed device id replaces the token the device already had, so a caller that
  // holds one passes it: logging in a second time inside the same script kills the first.
  let userId = token && await whoami(server, token);
  if (!userId) ({ token, userId } = await credential(server));
  const id = await resolveRoom(roomId, server, token);
  const filter = JSON.stringify({ senders: [userId], types: ['m.room.message'] });
  let from = null;
  for (let page = 0; page < pages; page++) {
    const url = new URL(`${server}/_matrix/client/v3/rooms/${encodeURIComponent(id)}/messages`);
    url.searchParams.set('dir', 'b');
    url.searchParams.set('limit', '20');
    url.searchParams.set('filter', filter);
    if (from) url.searchParams.set('from', from);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Cannot read [${roomId}]: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const body = await res.json();
    const event = (body.chunk || []).find(entry => entry.sender === userId && entry.type === 'm.room.message');
    if (event) {
      return {
        eventId: event.event_id,
        at: new Date(event.origin_server_ts).toISOString(),
        body: event.content?.body || '',
        state: stateOf(event.content?.formatted_body)
      };
    }
    if (!body.end || body.end === from) break;
    from = body.end;
  }
  return null;
}

/**
 * @param {object|null} state carried forward for the next run's comparison; see `withState`.
 * @returns {Promise<string>} the event id of the posted message.
 */
export async function send(text, { server = homeserver, token = null, roomId = room, state = null } = {}) {
  for (const [name, value] of [['MATRIX_HOMESERVER', server], ['MATRIX_ROOM', roomId]]) {
    if (!value) throw new Error(`${name} is not set — the digest cannot be posted`);
  }
  token ??= (await credential(server)).token;
  roomId = await resolveRoom(roomId, server, token);
  const body = JSON.stringify({
    msgtype: 'm.text',
    body: text,
    format: 'org.matrix.custom.html',
    formatted_body: withState(toHtml(text), state)
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
  let stateFile = null;
  // Default-safe: sending is opt-in. `--dry-run` remains accepted for saying so explicitly.
  let write = false;
  let identify = false;
  let read = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') file = argv[++i];
    else if (argv[i] === '--state') stateFile = argv[++i];
    else if (argv[i] === '--write') write = true;
    else if (argv[i] === '--dry-run') write = false;
    else if (argv[i] === '--whoami') identify = true;
    else if (argv[i] === '--last-digest') read = 'digest';
    else if (argv[i] === '--last-state') read = 'state';
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
  if (read) {
    // Both reads exit 0 whatever happens, because both are consumed by a routine that must still
    // produce a digest when the room cannot be read. `available` is the whole difference between
    // "nothing has changed" and "nothing is known", and only the caller can tell them apart.
    const last = await lastDigest().catch(error => error);
    if (read === 'digest') {
      if (last instanceof Error) console.error(`matrix.mjs: ${last.message}`);
      else console.log(last ? last.body : '');
    } else if (last instanceof Error) {
      console.log(JSON.stringify({ available: false, reason: last.message }, null, 2));
    } else {
      console.log(JSON.stringify(
        { available: true, at: last?.at || null, state: last?.state || {} }, null, 2));
    }
    process.exit(0);
  }
  const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  if (!text.trim()) { console.error('Nothing to post'); process.exit(2); }
  // The delta report can be handed over as it is: what the next run needs from it is its `state`.
  const carried = stateFile ? (JSON.parse(readFileSync(stateFile, 'utf8')) ?? {}) : null;
  const state = carried && (carried.state ?? carried);
  if (write) {
    await send(text, { state }).then(eventId => console.log(eventId)).catch(fail);
  } else {
    console.log(`--- would post to ${room} on ${homeserver} (pass --write to send) ---\n${text}`
      + (state ? `\n--- carrying the state of ${Object.keys(state).length} incident(s) ---` : ''));
  }
}
