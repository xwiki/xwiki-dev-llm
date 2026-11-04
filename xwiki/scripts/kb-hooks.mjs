#!/usr/bin/env node
// Knowledge-base pointer hooks: they inject *pointers* into the KB (`[tag] file#Section — Title: first
// line`), never section bodies, so the model reads only the section it needs. Two of them:
//
//   node kb-hooks.mjs prompt   UserPromptSubmit — searches the KB with the prompt; ≤5 pointers, and
//                              only those whose BM25 score clears MIN_SCORE.
//   node kb-hooks.mjs edit     PreToolUse on Edit/Write — matches the target path against the topics'
//                              `applies-to:` globs; ≤3 pointers. Advice only: it never blocks.
//
// Both run only in repos repo-scope.mjs accepts, give a session each pointer once (state under
// state-dir.mjs's kbHookStateDir(), keyed by session id), and never fail the prompt or the edit:
// any error exits 0 with nothing written. Claude Code reads `additionalContext`; Kimi Code reads a
// UserPromptSubmit hook's plain stdout (its PreToolUse can only block, so the edit hook is Claude's).
// opencode reaches the same functions through xwiki/opencode/plugins/xwiki-kb-pointers.js.
//
// Every constant is set a priori (tests/kb-hooks/ records the probes behind MIN_SCORE), never tuned
// on the benchmark's questions.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { defaultRoot, loadIndex, promptToQuery, search, tagOf, tokenize } from "./kb-search.mjs";
import { isScopedRepo } from "./repo-scope.mjs";
import { kbHookStateDir } from "./state-dir.mjs";

export const PROMPT_K = 5;
export const EDIT_K = 3;
// Minimum BM25 score of a prompt-hook pointer. Probes (tests/kb-hooks/): chat that is not about XWiki
// tops out below 7 ("what's the weather" 0, "make this function faster" 6.8); a question the KB does
// answer gets its right section at 8.1 and above ("where do I put a data migration" 8.1, "which JIRA
// component should the issue have" 8.2). Generic coding chat ("explain how a hash map works", 10.4)
// still clears it — that costs at most one ~300-token block, while a higher bar drops real answers.
export const MIN_SCORE = 8;
// A prompt with fewer distinct content terms is an acknowledgement ("ok continue", "yes do it").
export const MIN_PROMPT_TERMS = 3;
// ~300 tokens: the whole block, header included, is cut to this many characters.
export const MAX_CHARS = 1300;
const FIRST_LINE_MAX = 110;
const STATE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
// Path words that say nothing about a file's topic.
const GENERIC_PATH_TERMS = new Set(
  "src main test java resource resources org com xwiki webapp internal default impl api platform core".split(" "));

// ---------------------------------------------------------------------------------------------
// Session dedupe

const stateFile = (dir, sessionId) =>
  join(dir, `${String(sessionId).replace(/[^\w-]/g, "_").slice(0, 100)}.json`);

/** The pointer ids a session was already given (empty without a session id or state). */
export function loadSeen(sessionId, dir = kbHookStateDir()) {
  if (!sessionId) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(stateFile(dir, sessionId), "utf8")));
  } catch {
    return new Set();
  }
}

/**
 * Records a session's pointer ids. Creating a session's file is also when files untouched for a
 * week are pruned, so the directory stays small without a sweep of its own.
 */
export function saveSeen(sessionId, seen, dir = kbHookStateDir(), now = Date.now()) {
  if (!sessionId) return;
  const file = stateFile(dir, sessionId);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      try {
        if (now - statSync(p).mtimeMs > STATE_MAX_AGE_MS) unlinkSync(p);
      } catch { /* raced with another session: harmless */ }
    }
  }
  writeFileSync(file, JSON.stringify([...seen]));
}

// ---------------------------------------------------------------------------------------------
// Pointers

/** A pointer is skipped for a superseded/deprecated entry, which carries no authority. */
const usable = (hit) => hit.tag !== "[superseded]";

/** Prompt hook: the KB sections worth pointing at for a prompt, minus those already given. */
export function promptPointers(index, prompt, { seen = new Set(), k = PROMPT_K, minScore = MIN_SCORE } = {}) {
  const query = promptToQuery(prompt);
  if (new Set(tokenize(query)).size < MIN_PROMPT_TERMS) return [];
  return search(index, query, { k: k * 3 })
    .filter((h) => h.score >= minScore && usable(h) && !seen.has(h.id))
    .slice(0, k);
}

/** A glob (`**`, `*`, `?`) as an anchored RegExp over `/`-separated paths. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * How specific a glob is: the literal characters of its file-name part first, then those of its
 * directory part — a name pattern (`*ScriptService.java`) says more about a file's topic than a
 * directory one (`src/main/java/**`). `**\/src/main/java/**\/*.java` → 5 × 1000 + 14.
 */
export function globSpecificity(glob) {
  const literal = (s) => s.replace(/\*\*\/|\*|\?/g, "").length;
  const slash = glob.lastIndexOf("/");
  return literal(glob.slice(slash + 1)) * 1000 + literal(glob.slice(0, slash + 1));
}

/** The path an edit hook matches globs against: relative to the project when inside it, `/`-separated. */
export function matchPath(filePath, projectDir) {
  let p = String(filePath);
  if (projectDir && isAbsolute(p)) {
    const rel = relative(projectDir, p);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) p = rel;
  }
  return p.split(sep).join("/");
}

/**
 * Edit hook: the KB files whose `applies-to:` globs match the edited path, most specific glob first,
 * ties broken by the BM25 score of the file's best section against the path's words. The generated
 * `applies-to:` values are broad — every `sonarqube/` family claims `**\/*.java` — so a `sonarqube/`
 * file is only pointed at when the path or the edit text mentions Sonar (`NOSONAR`, a rule fix…).
 */
export function editPointers(index, filePath, { projectDir, editText = "", seen = new Set(), k = EDIT_K } = {}) {
  const path = matchPath(filePath, projectDir);
  const sonar = /sonar/i.test(`${path}\n${editText}`);
  const seenFiles = new Set([...seen].map((id) => id.replace(/#.*$/, "")));
  const candidates = [];
  for (const [file, meta] of Object.entries(index.files)) {
    if (!meta.appliesTo.length || seenFiles.has(file)) continue;
    if (file.startsWith("sonarqube/") && !sonar) continue;
    const specificity = Math.max(
      -1, ...meta.appliesTo.filter((g) => globToRegExp(g).test(path)).map(globSpecificity));
    if (specificity >= 0) candidates.push({ file, specificity });
  }
  if (!candidates.length) return [];

  const words = tokenize(path.replace(/\.[^./]+$/, "")).filter((t) => !GENERIC_PATH_TERMS.has(t));
  const best = new Map();
  if (words.length) {
    for (const h of search(index, words.join(" "), { k: index.sections.length })) {
      if (!best.has(h.file)) best.set(h.file, h);
    }
  }
  const scoreOf = (file) => best.get(file)?.score ?? 0;
  candidates.sort((a, b) => b.specificity - a.specificity || scoreOf(b.file) - scoreOf(a.file)
    || a.file.localeCompare(b.file));

  const hits = [];
  for (const { file } of candidates) {
    if (hits.length >= k) break;
    const meta = index.files[file];
    const hit = best.get(file) ?? firstSectionHit(index, file);
    if (hit && usable({ tag: tagOf(meta, file) })) hits.push(hit);
  }
  return hits;
}

function firstSectionHit(index, file) {
  const sec = index.sections.find((s) => s.file === file);
  if (!sec) return null;
  const meta = index.files[file];
  return { id: `${file}#${sec.section}`, file, section: sec.section, title: meta.title, first: sec.first,
    score: 0, tag: tagOf(meta, file) };
}

/**
 * The injected text: one header line (what the pointers are and how to use them), then one line per
 * pointer, cut to MAX_CHARS. Returns `{ text, ids }`, `ids` being the pointers that made it in.
 */
export function formatPointers(hits, kbRoot, { subject } = {}) {
  const header = `XWiki KB pointers${subject ? ` for ${subject}` : ""} — candidates, not answers. If one `
    + `looks relevant, Read only its named \`## Section\` of the file under ${kbRoot}/; `
    + "`[proposed: under discussion]` entries are not rules.";
  let text = header;
  const ids = [];
  for (const h of hits) {
    const first = h.first.length > FIRST_LINE_MAX ? `${h.first.slice(0, FIRST_LINE_MAX - 1)}…` : h.first;
    const title = h.title === h.section ? "" : ` — ${h.title}`;
    const line = `\n${h.tag} ${h.id}${title}${first ? `: ${first}` : ""}`;
    if (text.length + line.length > MAX_CHARS) break;
    text += line;
    ids.push(h.id);
  }
  return { text: ids.length ? text : "", ids };
}

// ---------------------------------------------------------------------------------------------
// Hook entry points

/**
 * Runs a hook on its stdin payload. Returns the text to inject, or "" for nothing. Options exist for
 * the tests: `root` (KB), `cacheDir` (index cache, `null` disables), `stateDir`, `env`.
 */
export function runHook(kind, payload, { root = defaultRoot(), cacheDir, stateDir = kbHookStateDir(),
  env = process.env } = {}) {
  const projectDir = payload.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!isScopedRepo(projectDir, env)) return "";
  const index = loadIndex(root, cacheDir === undefined ? {} : { cacheDir });
  const seen = loadSeen(payload.session_id, stateDir);
  let hits;
  let subject;
  if (kind === "prompt") {
    if (typeof payload.prompt !== "string") return "";
    hits = promptPointers(index, payload.prompt, { seen });
  } else if (kind === "edit") {
    const input = payload.tool_input || {};
    if (!input.file_path) return "";
    const editText = [input.new_string, input.content, ...(input.edits || []).map((e) => e.new_string)]
      .filter((s) => typeof s === "string").join("\n");
    subject = matchPath(input.file_path, projectDir);
    hits = editPointers(index, input.file_path, { projectDir, editText, seen });
  } else {
    return "";
  }
  const { text, ids } = formatPointers(hits, root.split(sep).join("/"), { subject });
  if (!ids.length) return "";
  for (const id of ids) seen.add(id);
  try {
    saveSeen(payload.session_id, seen, stateDir);
  } catch { /* an unwritable state dir costs the dedupe, not the pointers */ }
  return text;
}

/** What the hook writes to stdout for the host: Claude Code's JSON, or Kimi Code's plain text. */
export function hookOutput(kind, text, env = process.env) {
  if (!text) return "";
  if (env.KIMI_PLUGIN_ROOT && !env.CLAUDE_PLUGIN_ROOT) return text;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: kind === "prompt" ? "UserPromptSubmit" : "PreToolUse",
      additionalContext: text,
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const kind = process.argv[2];
    const out = hookOutput(kind, runHook(kind, JSON.parse(readFileSync(0, "utf8"))));
    if (out) process.stdout.write(out);
  } catch {
    // Never fail the prompt or the edit: a pointer is only ever a bonus.
  }
  // exitCode, not exit(): a piped stdout is asynchronous on macOS and exit() would truncate it.
  process.exitCode = 0;
}
