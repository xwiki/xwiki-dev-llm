#!/usr/bin/env node
// Upstream drift finder for the KB (step 8 of scripts/consolidation-routine.md). A KB file summarizes
// the dev.xwiki.org pages in its `sources:` frontmatter; scripts/kb-source-pins.json records, per
// page, the wiki version the KB currently reflects. This lists the pages edited since their pin, so
// the routine reads only those diffs. It narrows, it does not decide what the KB should absorb.
//
// Usage: node scripts/kb-sources.mjs [--json]      changed, moved, unpinned and unreachable pages, unused pins
//        node scripts/kb-sources.mjs --diff <url>[@<version>]
//                                                  the page's wiki-syntax diff, from the given version (any
//                                                  page, pinned or not) or else its pin, to the current one
//        node scripts/kb-sources.mjs --new [YYYY-MM-DD]
//                                                  the documentation pages created since that date (default:
//                                                  8 weeks ago) that no KB file, eval/backlog.json fact or
//                                                  seen record cites yet, oldest first
//        node scripts/kb-sources.mjs --seen url@version…
//                                                  record --new pages read and found to hold nothing for the KB
//        node scripts/kb-sources.mjs --pin [url[@version]…]
//                                                  pin the listed pages (default: every cited one) to the
//                                                  given or current version; drop pins no KB file cites.
//                                                  Name each page with the version its KB text was written
//                                                  from: a bare --pin hides every edit made since then.
// Exits 2 when the wiki cannot be read at all, 1 on a local error (bad argument, unreadable JSON).
// Node built-ins and git only; anonymous REST reads.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VIEW = "https://dev.xwiki.org/xwiki/bin/view/";
const REST = "https://dev.xwiki.org/xwiki/rest/wikis/dev/";
export const PINS_FILE = "scripts/kb-source-pins.json";
export const BACKLOG_FILE = "eval/backlog.json";
const SEEN_FILE = "scripts/kb-source-seen.json";
// The spaces holding the development documentation; the rest of the wiki is application code, release
// plans and scheduler pages.
const DOC_SPACES = ["Community", "Onboarding"];
const NEW_WINDOW_DAYS = 56;
const NEW_MAX_DAYS = 182;
const DEV_URL = /https?:\/\/dev\.xwiki\.org\/xwiki\/bin\/view\/[^\s"'<>()[\]]*/;

// The page a source URL names, as a canonical view URL (no anchor, query or trailing slash), or null
// when the URL is not a dev.xwiki.org page. Several KB files cite one page through different anchors.
export const pageKey = (url) => {
  const m = String(url).trim().match(/^https?:\/\/dev\.xwiki\.org\/xwiki\/bin\/view\/([^#?\s]*)/);
  if (!m) return null;
  try {
    const segments = m[1].split("/").filter(Boolean).map((s) => decodeURIComponent(s.replace(/\+/g, " ")));
    return segments.length ? VIEW + segments.map(encodeURIComponent).join("/") : null;
  } catch {
    return null; // a malformed %-escape names no page
  }
};

// The dev.xwiki.org pages cited in a markdown file's `sources:` frontmatter list, wherever the URL
// sits in the item (bare, quoted, a markdown link, followed by a note).
export const devSources = (markdown) => {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const out = [];
  let inSources = false;
  for (const line of fm[1].split(/\r?\n/)) {
    if (/^sources:/.test(line)) inSources = true;
    else if (inSources && /^\s+-\s+/.test(line)) {
      const key = pageKey(line.match(DEV_URL)?.[0] ?? "");
      if (key && !out.includes(key)) out.push(key);
    } else if (!/^\s/.test(line)) inSources = false;
  }
  return out;
};

// The REST page paths a view URL may resolve to: the nested page (A/B/C → A.B.C.WebHome), then the
// terminal one (A.B.C). Nested comes first because a terminal page left beside a nested one is
// usually the redirect stub of a move.
export const restPaths = (key) => {
  const segs = key.slice(VIEW.length).split("/").map(decodeURIComponent);
  const spaces = (list) => list.map((s) => `spaces/${encodeURIComponent(s)}/`).join("");
  const paths = [`${spaces(segs)}pages/WebHome`];
  if (segs.length > 1) paths.push(`${spaces(segs.slice(0, -1))}pages/${encodeURIComponent(segs.at(-1))}`);
  return paths;
};

// XWiki versions are "major.minor"; compare numerically, never as strings ("9.1" < "10.1").
export const versionCmp = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
  return x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0);
};

// The wiki's own side-by-side view of the change. A nested page's view URL ends with a slash, a
// terminal page's must not (the slash would name a nested page that does not exist).
export const changesUrl = (key, path, from, to) =>
  `${key}${path.endsWith("pages/WebHome") ? "/" : ""}?viewer=changes&rev1=${from}&rev2=${to}`;

// What the routine acts on, from the cited pages (key → citing files), the pins (key → version) and
// each page's current state (key → { version, path } or { error }). A version below its pin means
// the page was replaced — moved away, leaving a redirect stub, or deleted and recreated.
export const classify = (cited, pins, current) => {
  const result = { changed: [], moved: [], unpinned: [], unreachable: [], unusedPins: [] };
  for (const [key, files] of cited) {
    const page = current.get(key);
    const pin = pins[key];
    if (page.error) result.unreachable.push({ key, files, reason: page.error });
    else if (pin === undefined) result.unpinned.push({ key, files, to: page.version });
    else if (versionCmp(page.version, pin) < 0) result.moved.push({ key, files, from: pin, to: page.version });
    else if (versionCmp(page.version, pin) > 0) {
      result.changed.push({ key, files, from: pin, to: page.version, changes: changesUrl(key, page.path, pin, page.version) });
    }
  }
  result.unusedPins = Object.keys(pins).filter((k) => !cited.has(k)).sort();
  return result;
};

// The page a REST `pageId` names ("dev:Community.Some\\.Page.WebHome"), as pageKey's canonical view URL:
// references split on unescaped dots, and a nested page is named without its WebHome.
export const pageIdKey = (pageId) => {
  const ref = String(pageId).replace(/^[^:]*:/, "");
  const segments = [];
  let current = "";
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] === "\\" && i + 1 < ref.length) current += ref[++i];
    else if (ref[i] === ".") (segments.push(current), (current = ""));
    else current += ref[i];
  }
  segments.push(current);
  if (segments.length > 1 && segments.at(-1) === "WebHome") segments.pop();
  return pageKey(VIEW + segments.map(encodeURIComponent).join("/"));
};

// The documentation pages created at or after `since` (ms) that `known` (a Set of keys: cited, pinned,
// in the backlog or seen) does not hold, from the wiki's modifications listing, oldest first. Created
// means a 1.1 version in the window: a moved page keeps its history, so a move never shows here.
export const newPages = (summaries, since, known) => {
  const found = new Map();
  for (const m of summaries) {
    if (m.version !== "1.1" || m.modified < since || m.language) continue;
    const key = pageIdKey(m.pageId);
    if (!key || known.has(key) || !DOC_SPACES.some((d) => key.startsWith(`${VIEW}${d}/`))) continue;
    found.set(key, { key, modified: m.modified, date: new Date(m.modified).toISOString().slice(0, 10),
      author: String(m.modifier ?? "").replace(/^.*\./, "") });
  }
  return [...found.values()].sort((a, b) => a.modified - b.modified || a.key.localeCompare(b.key))
    .map(({ modified, ...p }) => p);
};

// The pages a backlog fact cites. A URL there may hold literal spaces ("…/Target size exceptions"),
// which pageKey reads as the end of the URL.
export const backlogKeys = (entries) =>
  entries.flatMap((f) => (f.sources ?? []).map((s) => pageKey(String(s.url ?? "").trim().replace(/ /g, "+"))))
    .filter(Boolean);

// What makes eval/backlog.json unusable by the batch routine, as messages: a missing field, a duplicate
// id, an unknown status, a settled fact without the note saying where it went or why.
export const backlogErrors = (entries) => {
  if (!Array.isArray(entries)) return ["not a JSON array"];
  const errors = [];
  const ids = new Set();
  entries.forEach((e, i) => {
    const at = `entry ${i} (${e?.id ?? "no id"})`;
    if (typeof e?.id !== "string" || !e.id) errors.push(`${at}: no id`);
    else if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    else ids.add(e.id);
    for (const f of ["fact", "kb_target"]) {
      if (typeof e?.[f] !== "string" || !e[f]) errors.push(`${at}: no ${f}`);
    }
    const badSource = (s) => !pageKey(String(s?.url ?? "").replace(/ /g, "+")) || !s.version;
    if (!Array.isArray(e?.sources) || !e.sources.length || e.sources.some(badSource)) {
      errors.push(`${at}: sources need a dev.xwiki.org url and the version read`);
    }
    const needs = { candidate: "probe", done: "note", dropped: "note" }[e?.status];
    if (!needs) errors.push(`${at}: status is not candidate, done or dropped`);
    else if (!e[needs]) errors.push(`${at}: a ${e.status} fact needs a ${needs}`);
  });
  return errors;
};

// The edits after `from`, newest first, from a REST history listing.
export const editsSince = (summaries, from) =>
  summaries
    .filter((e) => versionCmp(e.version, from) > 0)
    .sort((a, b) => versionCmp(b.version, a.version))
    .map((e) => ({
      version: e.version,
      date: new Date(e.modified).toISOString().slice(0, 10),
      author: String(e.modifier ?? "").replace(/^.*\./, ""),
      comment: e.comment ?? "",
    }));

// The cited pages no pin covers, as { file, key }, from [{ file, markdown }]. validate.mjs fails on
// them: only the author knows which version a new source was written from, so it is pinned in the
// same change — the routine pinning it later could only guess the version it found then.
export const unpinnedSources = (files, pins) =>
  files.flatMap(({ file, markdown }) =>
    devSources(markdown).filter((key) => pins[key] === undefined).map((key) => ({ file, key })));

// "url@1.2" → [key, "1.2"]; "url" → [key, undefined].
export const pinArg = (arg) => {
  const m = String(arg).match(/^(.*?)@(\d+\.\d+)$/);
  return m ? [pageKey(m[1]), m[2]] : [pageKey(arg), undefined];
};

// The page and the version a --diff starts from: the one the argument names, else the page's pin.
export const diffFrom = (arg, pins) => {
  const [key, version] = pinArg(arg);
  if (!key) throw new Error(`${arg}: not a dev.xwiki.org page`);
  const from = version ?? pins[key];
  if (!from) throw new Error(`${arg}: not pinned; name the version to diff from: <url>@<version>`);
  return { key, from };
};

// ---- I/O -------------------------------------------------------------------------------------------

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// The JSON at a REST path, null on a 404; a 5xx is retried once, any other failure throws. The wiki's
// Cloudflare answers 403 to Node's default User-Agent and accepts curl's.
const getJson = async (path, retry = true) => {
  const res = await fetch(REST + path, { headers: { Accept: "application/json", "User-Agent": "curl/8.7.1" } });
  if (res.status === 404) return null;
  if (res.status >= 500 && retry) return getJson(path, false);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// The page's REST path and current version, or { error } saying why it cannot be read.
const resolve = async (key) => {
  try {
    for (const path of restPaths(key)) {
      const page = await getJson(path);
      if (page?.version) return { path, version: page.version };
    }
    return { error: "no such page" };
  } catch (e) {
    return { error: e.message, failed: true };
  }
};

const resolveAll = async (keys) => {
  const current = new Map(await Promise.all(keys.map(async (k) => [k, await resolve(k)])));
  if (keys.length && [...current.values()].every((p) => p.failed)) {
    throw new Error(`dev.xwiki.org cannot be read: ${current.values().next().value.error}`);
  }
  return current;
};

const citedPages = () => {
  const files = execFileSync("git", ["ls-files", "--", "xwiki/kb/*.md"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n").filter(Boolean);
  const cited = new Map();
  for (const f of files) {
    for (const key of devSources(readFileSync(join(repoRoot, f), "utf8"))) {
      cited.set(key, [...(cited.get(key) ?? []), f]);
    }
  }
  return new Map([...cited].sort(([a], [b]) => a.localeCompare(b)));
};

const readPins = () => JSON.parse(readFileSync(join(repoRoot, PINS_FILE), "utf8"));
const writePins = (pins) => {
  const sorted = Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(repoRoot, PINS_FILE), JSON.stringify(sorted, null, 2) + "\n");
};

const report = async (json) => {
  const cited = citedPages();
  const current = await resolveAll([...cited.keys()]);
  const r = classify(cited, readPins(), current);
  for (const c of r.changed) {
    c.edits = editsSince((await getJson(`${current.get(c.key).path}/history?number=500`))?.historySummaries ?? [], c.from);
  }
  if (json) return console.log(JSON.stringify(r, null, 2));
  const files = (fs) => fs.map((f) => f.replace(/^xwiki\/kb\//, "")).join(", ");
  console.log(`${cited.size} dev.xwiki.org pages cited in the KB`);
  for (const c of r.changed) {
    console.log(`\nchanged      ${c.key}  ${c.from} -> ${c.to}  (${files(c.files)})\n             ${c.changes}`);
    for (const e of c.edits) console.log(`             ${e.version}  ${e.date}  ${e.author}  ${e.comment}`);
  }
  for (const m of r.moved) console.log(`moved        ${m.key}  ${m.from} -> ${m.to}  (${files(m.files)})`);
  for (const u of r.unpinned) console.log(`unpinned     ${u.key}  ${u.to}  (${files(u.files)})`);
  for (const u of r.unreachable) console.log(`unreachable  ${u.key}  ${u.reason}  (${files(u.files)})`);
  for (const k of r.unusedPins) console.log(`unused pin   ${k}`);
  if (Object.values(r).every((list) => !list.length)) console.log("nothing to sync");
};

// A local failure: exit 1, which the routine must not read as "the wiki cannot be read" (exit 2).
const local = (message) => Object.assign(new Error(message), { local: true });

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
  } catch (e) {
    throw local(`${file}: ${e.message}`);
  }
};
const readSeen = () => (existsSync(join(repoRoot, SEEN_FILE)) ? readJson(SEEN_FILE) : {});

const listNew = async (date) => {
  const day = 24 * 3600 * 1000;
  const since = date ? Date.parse(`${date}T00:00:00Z`) : Math.floor(Date.now() / day - NEW_WINDOW_DAYS) * day;
  if ((date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || Number.isNaN(since)) {
    throw local("--new takes a YYYY-MM-DD date");
  }
  if (since < Date.now() - NEW_MAX_DAYS * day) throw local(`--new looks back at most ${NEW_MAX_DAYS} days`);
  const known = new Set([...citedPages().keys(), ...Object.keys(readPins()),
    ...backlogKeys(readJson(BACKLOG_FILE)), ...Object.keys(readSeen())]);
  const summaries = [];
  for (let start = 0; ; start += 100) {
    const page = (await getJson(`modifications?start=${start}&number=100`))?.historySummaries ?? [];
    summaries.push(...page);
    if (page.length < 100 || page.at(-1).modified < since) break;
  }
  const found = newPages(summaries, since, known);
  for (const p of found) console.log(`new          ${p.key}  ${p.date}  ${p.author}`);
  const from = new Date(since).toISOString().slice(0, 10);
  if (!found.length) console.log(`no new documentation page since ${from}`);
};

const seen = (args) => {
  const records = readSeen();
  for (const arg of args) {
    const [key, version] = pinArg(arg);
    if (!key || !version) throw local(`${arg}: name the page and the version read: <url>@<version>`);
    records[key] = version;
  }
  const sorted = Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(repoRoot, SEEN_FILE), JSON.stringify(sorted, null, 2) + "\n");
};

const diff = async (arg) => {
  const { key, from: pin } = diffFrom(arg, readPins());
  const page = await resolve(key);
  if (page.error) throw new Error(`${key}: ${page.error}`);
  const content = async (v) => {
    const rev = await getJson(`${page.path}/history/${v}`);
    if (!rev) throw new Error(`${key}: version ${v} is gone from the wiki's history; read the page whole`);
    return (rev.content ?? "").replace(/\r\n/g, "\n");
  };
  const dir = mkdtempSync(join(tmpdir(), "kb-sources-"));
  try {
    const [a, b] = [`from-${pin}`, `current-${page.version}`];
    writeFileSync(join(dir, a), await content(pin));
    writeFileSync(join(dir, b), await content(page.version));
    try {
      execFileSync("git", ["diff", "--no-index", "--no-color", "--no-prefix", "-U3", a, b], { cwd: dir, encoding: "utf8" });
      console.log("no difference");
    } catch (e) {
      if (e.status !== 1) throw e;
      console.log(e.stdout);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const pin = async (args) => {
  const cited = citedPages();
  const wanted = args.length ? args.map((a) => [a, ...pinArg(a)]) : [...cited.keys()].map((k) => [k, k, undefined]);
  const uncited = wanted.filter(([, key]) => !cited.has(key)).map(([arg]) => arg);
  if (uncited.length) throw new Error(`no KB file cites ${uncited.join(", ")}`);
  const pins = readPins();
  const latest = await resolveAll(wanted.filter(([, , v]) => !v).map(([, key]) => key));
  for (const [, key, version] of wanted) {
    const page = latest.get(key);
    if (!version && page.error) throw new Error(`${key}: ${page.error}`);
    pins[key] = version ?? page.version;
  }
  for (const k of Object.keys(pins)) if (!cited.has(k)) delete pins[k];
  writePins(pins);
};

const isMain =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const run = args[0] === "--diff" ? diff(args[1])
    : args[0] === "--pin" ? pin(args.slice(1))
    : args[0] === "--new" ? listNew(args[1])
    : args[0] === "--seen" ? Promise.resolve().then(() => seen(args.slice(1)))
    : report(args.includes("--json"));
  run.catch((e) => {
    console.error(e.message);
    process.exit(e.local ? 1 : 2);
  });
}
