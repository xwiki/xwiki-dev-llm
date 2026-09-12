#!/usr/bin/env node
/*
 * Posts a paste to a PrivateBin instance (https://bin.xwikisas.com by default) and prints the URL.
 *
 * PrivateBin encrypts client-side: the server never sees the plaintext and never holds the key,
 * which lives only in the URL fragment (after the `#`, so it is not even sent in the request).
 * Posting from a script therefore means implementing the format rather than calling an API —
 * v2 is: JSON-wrap → raw-deflate → AES-256-GCM under a PBKDF2 key → base58 that key into the
 * fragment. Node's own `crypto` and `zlib` cover all of it; there are no dependencies.
 *
 * There is no "never" expiry on that instance — the longest is 1 week, which is the default here:
 * a Friday digest must still resolve on Monday.
 *
 * Nothing leaves the machine without an explicit `--write`, which is the rule every writer tool of
 * this skill follows, so that the safety property is one sentence with no exception to remember:
 * *no tool here writes anywhere unless told to*. A paste notifies nobody and carries no identity,
 * so it is the one write a local, developer-run sweep may make — but it is still a publication, and
 * the developer says yes to it.
 *
 * Usage:
 *   node privatebin.mjs --file <path> --write [--expire 1week] [--format markdown] [--url <instance>]
 *   node privatebin.mjs --file <path>      # rehearsal: says what it would paste, posts nothing
 *   node privatebin.mjs --self-test        # encrypt + decrypt locally, post nothing
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const DEFAULT_URL = process.env.XWIKI_CI_PASTE_URL || 'https://bin.xwikisas.com/';
// The instance offers 5min/10min/1hour/4hours/1day/1week/2weeks — but not "never".
const EXPIRIES = ['5min', '10min', '1hour', '4hours', '1day', '1week', '2weeks'];

// PrivateBin's own defaults; they are authenticated as part of `adata`, so they must be sent
// exactly as they were used, and changing one here changes what the browser must do to decrypt.
const ITERATIONS = 100000;
const KEY_BITS = 256;
const TAG_BITS = 128;
const IV_BYTES = 16;
const SALT_BYTES = 8;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** base58 (Bitcoin alphabet), which is how PrivateBin writes the key into the URL fragment. */
export function base58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  // Every leading zero byte is significant and encodes as the alphabet's first character.
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = BASE58[0] + out;
  }
  return out || BASE58[0];
}

export function unbase58(text) {
  let value = 0n;
  for (const char of text) {
    const index = BASE58.indexOf(char);
    if (index < 0) throw new Error(`Not base58: [${char}]`);
    value = value * 58n + BigInt(index);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== BASE58[0]) break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

/**
 * Builds the encrypted paste body.
 *
 * `adata` is *authenticated* additional data: it travels in clear (the server needs the expiry and
 * the cipher parameters) but the GCM tag covers it, so a server that rewrites the compression or
 * the formatter cannot make a browser decrypt to something else.
 */
export function encrypt(text, { format = 'markdown', key = randomBytes(32) } = {}) {
  const iv = randomBytes(IV_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const derived = pbkdf2Sync(key, salt, ITERATIONS, KEY_BITS / 8, 'sha256');
  const adata = [
    [iv.toString('base64'), salt.toString('base64'), ITERATIONS, KEY_BITS, TAG_BITS, 'aes', 'gcm', 'zlib'],
    format,
    0, // open discussion
    0  // burn after reading
  ];
  const cipher = createCipheriv('aes-256-gcm', derived, iv, { authTagLength: TAG_BITS / 8 });
  // The AAD is the JSON text of adata exactly as it will be sent — no spaces, same key order.
  cipher.setAAD(Buffer.from(JSON.stringify(adata), 'utf8'));
  // PrivateBin compresses the JSON *envelope*, not the bare text, and uses raw deflate (no zlib
  // header), which is what the browser's `pako.inflateRaw` expects on the way back.
  const payload = deflateRawSync(Buffer.from(JSON.stringify({ paste: text }), 'utf8'));
  const ct = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  return { body: { v: 2, adata, ct: ct.toString('base64') }, key };
}

/** The inverse, used by --self-test: the format is only right if it round-trips. */
export function decrypt(body, key) {
  const [cipherParams, format] = body.adata;
  const [iv, salt, iterations, keyBits, tagBits] = cipherParams;
  const derived = pbkdf2Sync(key, Buffer.from(salt, 'base64'), iterations, keyBits / 8, 'sha256');
  const ct = Buffer.from(body.ct, 'base64');
  const tagBytes = tagBits / 8;
  const decipher = createDecipheriv('aes-256-gcm', derived, Buffer.from(iv, 'base64'), {
    authTagLength: tagBytes
  });
  decipher.setAAD(Buffer.from(JSON.stringify(body.adata), 'utf8'));
  decipher.setAuthTag(ct.subarray(ct.length - tagBytes));
  const plain = Buffer.concat([decipher.update(ct.subarray(0, ct.length - tagBytes)), decipher.final()]);
  return { text: JSON.parse(inflateRawSync(plain).toString('utf8')).paste, format };
}

/** @returns {Promise<string>} the full paste URL, key fragment included — it is the only copy. */
export async function paste(text, { url = DEFAULT_URL, expire = '1week', format = 'markdown' } = {}) {
  if (!EXPIRIES.includes(expire)) {
    throw new Error(`Unsupported expiry [${expire}] — PrivateBin offers ${EXPIRIES.join(', ')} `
      + '(there is no "never")');
  }
  const { body, key } = encrypt(text, { format });
  const res = await fetch(url, {
    method: 'POST',
    // Without this header PrivateBin serves the HTML page instead of answering as an API.
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'JSONHttpRequest' },
    body: JSON.stringify({ ...body, meta: { expire } })
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const answer = await res.json();
  if (answer.status !== 0) throw new Error(`${url}: ${answer.message || `status ${answer.status}`}`);
  const base = url.replace(/\/+$/, '');
  return `${base}/?${answer.id}#${base58(key)}`;
}

// ---- CLI -------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const options = { expire: '1week', format: 'markdown', url: DEFAULT_URL };
  let file = null;
  let selfTest = false;
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') file = argv[++i];
    else if (argv[i] === '--expire') options.expire = argv[++i];
    else if (argv[i] === '--format') options.format = argv[++i];
    else if (argv[i] === '--url') options.url = argv[++i];
    else if (argv[i] === '--self-test') selfTest = true;
    else if (argv[i] === '--write') write = true;
    else if (argv[i] === '--dry-run') write = false;
    else { console.error(`Unknown argument [${argv[i]}]`); process.exit(2); }
  }

  if (selfTest) {
    const sample = '# Digest\n\n* platform/master — checkstyle break\n\nUnicode: é → ✓\n'.repeat(50);
    const { body, key } = encrypt(sample);
    const round = decrypt(body, key);
    const keyRoundTrips = unbase58(base58(key)).equals(key);
    const ok = round.text === sample && keyRoundTrips && body.v === 2;
    console.log(`self-test: ${ok ? 'OK' : 'FAILED'} — ciphertext ${body.ct.length} b64 chars for ` +
      `${sample.length} chars of Markdown, key round-trips: ${keyRoundTrips}`);
    process.exit(ok ? 0 : 1);
  }

  const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  if (!text.trim()) { console.error('Nothing to paste'); process.exit(2); }
  if (!write) {
    console.log(`--- would paste ${text.length} characters of ${options.format} to ${options.url}, `
      + `expiring in ${options.expire} (pass --write to post) ---`);
    process.exit(0);
  }
  console.log(await paste(text, options));
}
