#!/usr/bin/env node
// Knowledge-base pointer hooks: they inject *pointers* into the KB (`[tag] file#Section — Title: first
// line`) and to the plugin's skills (a leading "load with your Skill tool: xwiki-legacy" line, then
// `[skill] xwiki-legacy — first sentence`), never bodies, so the model reads only the section, or
// loads only the skill, it needs. Skills are searched by their name and
// description and matched by `_meta/skills.json` (see kb-search.mjs); up to SKILL_K of them come on top
// of a hook's KB pointers. The hooks:
//
//   node kb-hooks.mjs prompt   UserPromptSubmit — searches the KB with the prompt; ≤5 pointers, and
//                              only those whose BM25 score clears MIN_SCORE.
//   node kb-hooks.mjs edit     PreToolUse on Edit/Write — matches the target path against the topics'
//                              `applies-to:` globs and the text the edit adds against their
//                              `applies-when:` regexes; ≤3 pointers. Advice only: it never blocks.
//   node kb-hooks.mjs commit   PreToolUse on a Bash `git commit` — asks for a self-review of the commit's
//                              diff against what the session was pointed at (rules are skipped at commit
//                              time, or overridden by copying the code around), listing those ids and up
//                              to 5 more pointers matching the commit's files the way the edit hook does.
//                              Nothing when neither exists. Advice only: it never blocks.
//   node kb-hooks.mjs bash     PostToolUse on Bash — the edit hook for files a shell command changed
//                              (`sed -i`, a heredoc, a script): the lines the work tree adds since the
//                              session's previous check (a snapshot of per-line hashes next to its
//                              dedupe state; a commit in between is seen through), matched per file like
//                              an edit; ≤3 pointers. Skips a clearly read-only command without running
//                              git. Advice only: it never blocks.
//   node kb-hooks.mjs skill    PreToolUse on Skill — records the loaded skill, so it is not pointed at.
//                              A skill named in a prompt (`/xwiki-legacy`) counts as loaded too.
//
// `applies-when:` narrows a topic to edits that add matching text: a block list (`  - '<regex>'`,
// single-quoted, no YAML escaping — an inline `[a, b]` list would split a regex on its commas) of
// JavaScript regexes, compiled with the `m` flag only, so case-sensitive (spell out `[Ll]ogger`) and
// `^`/`$` anchor at lines. One matching regex is enough. Such a topic matches only when its globs
// match the path (no `applies-to:` = any path) and a regex matches the added text, and ranks above
// every path-only match. The added text is Edit's `new_string` minus the lines already in its
// `old_string` (unchanged context), each MultiEdit edit's likewise, and Write's `content` minus the
// lines of the file it overwrites. A regex that does not compile is ignored.
//
// They all run only in repos repo-scope.mjs accepts, give a session each pointer once (state under
// state-dir.mjs's kbHookStateDir(), keyed by session id), and never fail the prompt or the edit:
// any error exits 0 with nothing written. Claude Code reads `additionalContext`; Kimi Code reads a
// UserPromptSubmit hook's plain stdout (its tool hooks cannot add context, so the edit, shell-edit and
// commit hooks are Claude's).
// opencode reaches the same functions through xwiki/opencode/plugins/xwiki-kb-pointers.js.
//
// Every constant is set a priori (tests/kb-hooks/ records the probes behind MIN_SCORE), never tuned
// on the benchmark's questions.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { defaultRoot, defaultSkillsRoot, loadIndex, promptToQuery, search, sectionHit, tagOf, tokenize }
  from "./kb-search.mjs";
import { isScopedRepo } from "./repo-scope.mjs";
import { simpleCommands } from "./shell-commands.mjs";
import { kbHookStateDir } from "./state-dir.mjs";

export const PROMPT_K = 5;
export const EDIT_K = 3;
// Pointers matching a commit's files, on top of the session's: a commit spans several edits.
export const COMMIT_K = PROMPT_K;
// Skill pointers a hook may add on top of its KB ones: a skill is a task's whole procedure, so it is
// not made to compete with the sections for the same few slots.
export const SKILL_K = 2;
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
const isSkill = (hit) => hit.tag === "[skill]";

/** Up to SKILL_K skills, then up to `k` KB pointers, each in rank order. */
const capKinds = (hits, k) => [...hits.filter(isSkill).slice(0, SKILL_K), ...hits.filter((h) => !isSkill(h)).slice(0, k)];

/** Prompt hook: the KB sections worth pointing at for a prompt, minus those already given. */
export function promptPointers(index, prompt, { seen = new Set(), k = PROMPT_K, minScore = MIN_SCORE } = {}) {
  const query = promptToQuery(prompt);
  if (new Set(tokenize(query)).size < MIN_PROMPT_TERMS) return [];
  return capKinds(search(index, query, { k: (k + SKILL_K) * 3, skills: true })
    .filter((h) => h.score >= minScore && usable(h) && !seen.has(h.id)), k);
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

/** The lines of `text` whose trimmed form is not among `before`'s, joined back: what an edit adds. */
function linesNotIn(text, before) {
  const old = new Set(String(before ?? "").split("\n").map((l) => l.trim()));
  return String(text).split("\n").filter((l) => l.trim() && !old.has(l.trim())).join("\n");
}

/**
 * The text a Claude Code Edit / MultiEdit / Write tool input adds, or null when the input carries
 * none. `previous` is the content a Write overwrites (null for a new file or when unknown).
 */
export function addedText(input, previous = null) {
  if (!input) return null;
  if (Array.isArray(input.edits)) {
    return input.edits.filter((e) => typeof e?.new_string === "string")
      .map((e) => linesNotIn(e.new_string, e.old_string)).join("\n");
  }
  if (typeof input.new_string === "string") return linesNotIn(input.new_string, input.old_string);
  if (typeof input.content === "string") return linesNotIn(input.content, previous);
  return null;
}

const regexCache = new Map();
/** A topic's `applies-when:` regex, compiled once; null when it does not compile. */
function whenRegExp(source) {
  if (!regexCache.has(source)) {
    let re = null;
    try {
      re = new RegExp(source, "m");
    } catch { /* an invalid regex is ignored, never an error */ }
    regexCache.set(source, re);
  }
  return regexCache.get(source);
}

/**
 * Edit hook: the KB files that apply to the edit — `applies-to:` globs matching the edited path and,
 * for a topic with `applies-when:`, a regex matching `added` (the added text; null when unknown,
 * which leaves such topics out). Content matches first, then the most specific glob, ties broken
 * by the BM25 score of the file's best section against the path's words.
 */
export function editPointers(index, filePath, { projectDir, seen = new Set(), k = EDIT_K, added = null } = {}) {
  const path = matchPath(filePath, projectDir);
  const seenFiles = new Set([...seen].map((id) => id.replace(/#.*$/, "")));
  const candidates = [];
  for (const [file, meta] of Object.entries(index.files)) {
    const when = meta.appliesWhen ?? [];
    if ((!meta.appliesTo.length && !when.length) || seenFiles.has(file)) continue;
    const specificity = meta.appliesTo.length
      ? Math.max(-1, ...meta.appliesTo.filter((g) => globToRegExp(g).test(path)).map(globSpecificity))
      : 0;
    if (specificity < 0) continue;
    let matched = "";
    if (when.length) {
      if (!added) continue;
      matched = added.split("\n").filter((l) => when.some((src) => whenRegExp(src)?.test(l))).join("\n");
      if (!matched && !when.some((src) => whenRegExp(src)?.test(added))) continue;
    }
    candidates.push({ file, content: when.length ? 1 : 0, specificity, matched });
  }
  if (!candidates.length) return [];

  const words = tokenize(path.replace(/\.[^./]+$/, "")).filter((t) => !GENERIC_PATH_TERMS.has(t));
  const best = new Map();
  if (words.length) {
    for (const h of search(index, words.join(" "), { k: index.sections.length, skills: true })) {
      if (!best.has(h.file)) best.set(h.file, h);
    }
  }
  const scoreOf = (file) => best.get(file)?.score ?? 0;
  candidates.sort((a, b) => b.content - a.content || b.specificity - a.specificity
    || scoreOf(b.file) - scoreOf(a.file)
    || a.file.localeCompare(b.file));

  // A content match points at the section whose heading names a term of the lines that matched
  // (`@Unstable` → "`@Unstable` annotation"), else at the topic's first section: the path's words
  // say nothing about why such a topic matched, and code scores against prose by accident.
  const sectionFor = (file, matched) => {
    if (!matched) return best.get(file) ?? firstSectionHit(index, file);
    const terms = new Set(tokenize(matched));
    const named = index.sections.find((s) => s.file === file && tokenize(s.section).some((t) => terms.has(t)));
    return named ? sectionHit(index, named) : firstSectionHit(index, file);
  };
  const hits = [];
  for (const { file, matched } of candidates) {
    const meta = index.files[file];
    const hit = sectionFor(file, matched);
    if (hit && usable({ tag: tagOf(meta, file) })) hits.push({ ...hit, content: Boolean(matched) });
  }
  return capKinds(hits, k);
}

function firstSectionHit(index, file) {
  const sec = index.sections.find((s) => s.file === file);
  return sec ? sectionHit(index, sec) : null;
}

/**
 * The injected text, cut to MAX_CHARS: the skills first, as an instruction of their own (a line
 * naming them, then one line each), then the KB block — one header line (what the pointers are and
 * how to use them) and one line per pointer. A skill listed among the KB candidates read as one more
 * candidate, already summed up by its line, and was seldom loaded. Returns `{ text, ids }`, `ids`
 * being the pointers that made it in.
 */
export function formatPointers(hits, kbRoot, { subject } = {}) {
  const lines = (list) => list.map((h) => ({ id: h.id, line: `\n${pointerLine(h)}` }));
  const skills = lines(hits.filter(isSkill));
  const kb = lines(hits.filter((h) => !isSkill(h)));
  const ids = [];
  let text = "";
  const add = (head, entries) => {
    let block = head;
    for (const { id, line } of entries) {
      if (text.length + block.length + line.length > MAX_CHARS) break;
      block += line;
      ids.push(id);
    }
    if (block !== head) text += (text ? "\n" : "") + block;
  };
  if (skills.length) {
    const names = hits.filter(isSkill).map((h) => h.title);
    add(`Before going further, load with your Skill tool: ${names.join(", ")} — `
      + `${names.length > 1 ? "their" : "its"} steps are not in these pointers, only what ${names.length > 1 ? "each is" : "it is"} for.`,
    skills);
  }
  add(`XWiki KB pointers${subject ? ` for ${subject}` : ""} — candidates, not answers. If one `
    + `looks relevant, Read only its named \`## Section\` of the file under ${kbRoot}/; `
    + "`[proposed: under discussion]` entries are not rules.", kb);
  return { text, ids };
}

/** One pointer line: `[tag] file#Section — Title: first line`, or `[skill] <name> — first sentence`. */
function pointerLine(h) {
  const first = h.first.length > FIRST_LINE_MAX ? `${h.first.slice(0, FIRST_LINE_MAX - 1)}…` : h.first;
  if (isSkill(h)) return `[skill] ${h.title}${first ? ` — ${first}` : ""}`;
  const title = h.title === h.section ? "" : ` — ${h.title}`;
  return `${h.tag} ${h.id}${title}${first ? `: ${first}` : ""}`;
}

/** The ids of the indexed skills a text names (`/xwiki-legacy`, `xwiki:xwiki-legacy`, `xwiki-legacy`). */
export function namedSkills(index, text) {
  const ids = (String(text).match(/xwiki-[a-z][\w-]*/g) || []).map((n) => `skill:${n}`);
  return [...new Set(ids)].filter((id) => index.files[id]?.kind === "skill");
}

// ---------------------------------------------------------------------------------------------
// Commit self-review

const GIT_COMMIT = /(?:^|[\s;&|(`"'])git(?:\s+-[cC]\s+\S+|\s+--?[\w.-]+(?:=\S+)?)*\s+commit(?=$|[\s;&|)`"'])/;
/** Whether a shell command runs `git commit` (also `git -C dir commit`, after `&&`, inside `bash -c "…"`). */
export const isGitCommit = (command) => typeof command === "string" && GIT_COMMIT.test(command);

/** Whether the commit also takes changes not staged yet: `-a`/`--all`, or a `git add` in the same command. */
export const takesUnstaged = (command) => /(?:^|[\s;&|(])git\s+add\b/.test(command)
  || /\scommit\b.*?\s(?:-[a-zA-Z]*a[a-zA-Z]*|--all)(?=\s|$)/.test(command);

/** The lines each file of a unified diff adds: `Map(path → text)`, empty text for a deletion. */
export function diffAdditions(diff) {
  const files = new Map();
  let cur = null;
  for (const line of String(diff).split("\n")) {
    const m = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (m) files.set(cur = m[1], []);
    else if (cur !== null && line.startsWith("+") && !line.startsWith("+++")) files.get(cur).push(line.slice(1));
  }
  return new Map([...files].map(([p, lines]) => [p, lines.join("\n")]));
}

/**
 * What a commit adds, read from git in `cwd`: before it runs, the index (the work tree too when it
 * takes unstaged changes); after it (opencode), HEAD. Empty when git cannot tell.
 */
export function commitAdditions(cwd, { after = false, unstaged = false } = {}) {
  const args = after ? ["show", "--format=", "-U0", "--no-color", "--no-ext-diff", "HEAD"]
    : ["diff", "-U0", "--no-color", "--no-ext-diff", unstaged ? "HEAD" : "--cached"];
  try {
    return diffAdditions(execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20,
      stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return new Map();
  }
}

/** The edit hook's pointers over a commit's files, minus the session's: content matches first. */
export function commitPointers(index, files, { projectDir, seen = new Set(), k = COMMIT_K } = {}) {
  const hits = [];
  const taken = new Set();
  for (const [file, added] of [...files].slice(0, 200)) {
    for (const h of editPointers(index, file, { projectDir, seen, added: added || null, k })) {
      if (!taken.has(h.file)) hits.push(h);
      taken.add(h.file);
    }
  }
  return capKinds(hits.sort((a, b) => Number(b.content) - Number(a.content)), k);
}

/**
 * The self-review text: the instruction, a line naming any matching skill to load, the session's pointer ids (the latest kept when they do not
 * all fit), then the pointers matching the commit, cut to MAX_CHARS. Returns `{ text, ids }` like
 * formatPointers, `ids` being the matching pointers that made it in.
 */
export function formatCommitReview(given, hits, kbRoot) {
  const header = "XWiki commit self-review — check this commit's diff (`git show HEAD` once it ran) against the "
    + "XWiki rules this session was given, not against the code around the change, and fix and amend any "
    + `violation before pushing. KB ids are files under ${kbRoot}/; re-read a section only when unsure.`;
  const label = "\nAlso matching the commit's files:";
  const reserve = given.length ? 200 : 0;
  // A matching skill leads, as an instruction of its own (see formatPointers).
  const skillNames = hits.filter(isSkill).map((h) => h.title);
  let lead = skillNames.length ? `\nBefore reviewing, load with your Skill tool: ${skillNames.join(", ")} — the rules `
    + `to check against are in ${skillNames.length > 1 ? "them" : "it"}, not in this text.` : "";
  let lines = "";
  const ids = [];
  for (const h of [...hits.filter(isSkill), ...hits.filter((x) => !isSkill(x))]) {
    const line = `\n${pointerLine(h)}`;
    if (header.length + lead.length + label.length + lines.length + line.length > MAX_CHARS - reserve) break;
    lines += line;
    ids.push(h.id);
  }
  if (!ids.some((id) => id.startsWith("skill:"))) lead = "";
  const names = given.map((id) => (id.startsWith("skill:") ? `skill ${id.slice(6)}` : id));
  const prefix = "\nGiven this session: ";
  let room = MAX_CHARS - header.length - lead.length - (ids.length ? label.length + lines.length : 0) - prefix.length - 3;
  const kept = [];
  for (let i = names.length - 1; i >= 0 && names[i].length + 2 <= room; i--) {
    kept.unshift(names[i]);
    room -= names[i].length + 2;
  }
  if (!kept.length && !ids.length) return { text: "", ids: [] };
  let text = header + lead;
  if (kept.length) text += `${prefix}${kept.length < names.length ? "…; " : ""}${kept.join("; ")}`;
  if (ids.length) text += `${label}${lines}`;
  return { text, ids };
}

// ---------------------------------------------------------------------------------------------
// Files changed through the shell

// Programs that write no file unless their output is redirected into one; sed, awk, perl and find
// only without their in-place or exec options, git only with READ_ONLY_GIT's subcommands.
const READ_ONLY = new Set(("cat head tail less more wc grep egrep fgrep rg ag ls tree find fd stat file du df "
  + "pwd cd pushd popd echo printf true false test [ which type command basename dirname realpath readlink sort "
  + "uniq cut tr diff cmp comm column nl jq xmllint date env sleep awk sed perl git").split(" "));
const READ_ONLY_GIT = new Set(("status log diff show grep blame rev-parse ls-files ls-tree cat-file describe "
  + "shortlog reflog branch tag remote config merge-base rev-list").split(" "));
// git subcommands that change only files git tracks, as sed -i, perl -i, awk inplace and find -delete do.
const TRACKED_GIT = new Set("add commit rm mv restore reset".split(" "));
const SHELL_TIMEOUT_MS = 4000;
// More changed files than this, or a larger diff, is a branch switch or a rebase, not an edit: it is
// pointed at by nothing.
const MAX_SHELL_FILES = 200;
const MAX_SHELL_DIFF_BYTES = 8 << 20;
const MAX_UNTRACKED_BYTES = 256 << 10;

/**
 * What a Bash command can change: "none" (every simple command a read-only program, no output
 * redirected into a file: the shell-edit hook skips it without running git), "tracked" (only files
 * git already tracks: the walk for new files, the slow half of a check on a large repo, is skipped),
 * or "any". A command it cannot parse is "any".
 */
export function shellWrites(command) {
  const parsed = typeof command === "string" && simpleCommands(command);
  if (!parsed) return "any";
  const kinds = parsed.commands.map(({ tokens }) => {
    const redirected = tokens.some((t, i) => {
      const m = t.flag && /^(?:\d*|&)>>?(.*)$/.exec(t.value);
      const target = m && (m[1] || tokens[i + 1]?.value || "");
      return m && !target.startsWith("&") && !/^\/dev\/(?:null|stdout|stderr|tty)$/.test(target);
    });
    let i = 0;
    while (i < tokens.length - 1 && /^\w+=/.test(tokens[i].value)) i++; // `LC_ALL=C sort`
    const program = tokens[i]?.value.replace(/^.*\//, "");
    const args = tokens.slice(i + 1).map((t) => t.value);
    if (redirected || !READ_ONLY.has(program)) return "any";
    if (program === "git") {
      const sub = args.find((v, k) => !v.startsWith("-") && !/^-[Cc]$/.test(args[k - 1] ?? ""));
      return READ_ONLY_GIT.has(sub) ? "none" : TRACKED_GIT.has(sub) ? "tracked" : "any";
    }
    if (program === "find" && args.some((v) => /^-(?:exec|execdir|ok|okdir|fprint\w*|fls)$/.test(v))) return "any";
    const inPlace = ((program === "sed" || program === "perl") && args.some((v) => /^-[a-zA-Z]*i|^--in-place/.test(v)))
      || (program === "awk" && args.includes("inplace")) || (program === "find" && args.includes("-delete"));
    if (inPlace) return "tracked";
    return program === "perl" ? "any" : "none";
  });
  return kinds.includes("any") ? "any" : kinds.includes("tracked") ? "tracked" : "none";
}

export const writesNothing = (command) => shellWrites(command) === "none";

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_SHELL_DIFF_BYTES,
  timeout: SHELL_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });

/** A short hash of one trimmed line (FNV-1a), what a snapshot keeps instead of the line. */
function lineHash(line) {
  let h = 2166136261;
  for (let i = 0; i < line.length; i++) h = Math.imul(h ^ line.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * What the work tree of `root` adds over commit `base`: `Map(path → text)`, deleted files left out,
 * untracked files whole when `untracked`. null for a mass change (more than MAX_SHELL_FILES files,
 * or a diff git cannot hand over within the buffer and time limits).
 */
function workTreeAdditions(root, base, untracked) {
  let files;
  let added = [];
  try {
    files = diffAdditions(git(root, ["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--diff-filter=d", base]));
    if (untracked) added = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  } catch {
    return null;
  }
  if (files.size + added.length > MAX_SHELL_FILES) return null;
  for (const p of added) {
    try {
      const file = join(root, p);
      if (statSync(file).size > MAX_UNTRACKED_BYTES) continue;
      const text = readFileSync(file, "utf8");
      if (!text.includes("\0")) files.set(p, text);
    } catch { /* gone already */ }
  }
  return files;
}

/**
 * The lines the shell added since a session's previous check: `{ changes: Map(absolute path → added
 * text), snapshot }`, the snapshot to keep for the next check (the repo, HEAD, and per file the
 * hashes of the lines its work tree adds). A commit since the previous check is seen through: the
 * work tree is then compared with the previous HEAD. Without a snapshot every uncommitted line
 * counts. Without `untracked` new files are not looked for, and the snapshot keeps their entries.
 * null when `cwd` is not in a git repo with a commit.
 */
export function shellChanges(cwd, snapshot, { untracked = true } = {}) {
  let root;
  let head;
  try {
    [root, head] = git(cwd, ["rev-parse", "--show-toplevel", "HEAD"]).trim().split("\n");
  } catch {
    return null;
  }
  const previous = snapshot?.root === root ? snapshot : null;
  const base = previous?.head ?? head;
  const now = workTreeAdditions(root, base, untracked);
  const files = base === head ? now : workTreeAdditions(root, head, untracked);
  const kept = untracked || !files ? {} : previous?.files ?? {};
  const next = { root, head, files: { ...kept, ...Object.fromEntries([...files ?? []].map(([p, text]) =>
    [p, [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean).map(lineHash))]])) } };
  const changes = new Map();
  if (!now) return { changes, snapshot: next };
  for (const [p, text] of now) {
    const old = new Set(previous?.files[p] ?? []);
    const added = text.split("\n").filter((l) => l.trim() && !old.has(lineHash(l.trim()))).join("\n");
    if (added) changes.set(join(root, p), added);
  }
  return { changes, snapshot: next };
}

const snapshotFile = (dir, sessionId) => stateFile(dir, `${sessionId}.shell`);

// ---------------------------------------------------------------------------------------------
// Hook entry points

/**
 * Runs a hook on its stdin payload. Returns the text to inject, or "" for nothing. Options exist for
 * the tests: `root` (KB), `skillsRoot` (the skills; by default the plugin's with the shipped KB, none
 * with another), `cacheDir` (index cache, `null` disables), `stateDir`, `env`.
 */
export function runHook(kind, payload, { root = defaultRoot(), skillsRoot, cacheDir, stateDir = kbHookStateDir(),
  env = process.env } = {}) {
  const projectDir = payload.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  if (kind === "commit" && !isGitCommit(payload.tool_input?.command)) return "";
  // The shell-edit hook needs a session for its snapshot, and nothing to do after a read-only command.
  if (kind === "bash" && (!payload.session_id || writesNothing(payload.tool_input?.command))) return "";
  if (!isScopedRepo(projectDir, env)) return "";
  const skills = skillsRoot === undefined ? (root === defaultRoot() ? defaultSkillsRoot() : null) : skillsRoot;
  const index = loadIndex(root, { ...(cacheDir === undefined ? {} : { cacheDir }), skillsRoot: skills });
  const seen = loadSeen(payload.session_id, stateDir);
  const save = () => {
    try {
      saveSeen(payload.session_id, seen, stateDir);
    } catch { /* an unwritable state dir costs the dedupe, not the pointers */ }
  };
  let hits;
  let subject;
  if (kind === "skill") {
    const ids = namedSkills(index, `xwiki-${String(payload.tool_input?.skill ?? payload.tool_input?.name ?? "")
      .replace(/^(?:.*:)?xwiki-/, "")}`);
    if (ids.some((id) => !seen.has(id))) {
      for (const id of ids) seen.add(id);
      save();
    }
    return "";
  } else if (kind === "commit") {
    // Before the commit (Claude Code's PreToolUse) its changes are staged; after it (opencode), in HEAD.
    const command = payload.tool_input.command;
    const files = commitAdditions(projectDir,
      { after: payload.hook_event_name !== "PreToolUse", unstaged: takesUnstaged(command) });
    const given = [...seen].filter((id) => !id.startsWith("skill:") || index.files[id]);
    const review = formatCommitReview(given, commitPointers(index, files, { projectDir, seen }),
      root.split(sep).join("/"));
    for (const id of review.ids) seen.add(id);
    if (review.ids.length) save();
    return review.text;
  } else if (kind === "prompt") {
    if (typeof payload.prompt !== "string") return "";
    const loaded = namedSkills(index, payload.prompt);
    for (const id of loaded) seen.add(id);
    hits = promptPointers(index, payload.prompt, { seen });
    if (!hits.length && loaded.length) save();
  } else if (kind === "edit") {
    const input = payload.tool_input || {};
    if (!input.file_path) return "";
    subject = matchPath(input.file_path, projectDir);
    // Before a Write runs (Claude Code's PreToolUse), the file on disk is what it overwrites; after
    // it (opencode), it is the new content itself, so it is read only for the former.
    let previous = null;
    if (typeof input.content === "string" && payload.hook_event_name === "PreToolUse") {
      try {
        previous = readFileSync(isAbsolute(input.file_path) ? input.file_path : join(projectDir, input.file_path),
          "utf8");
      } catch { /* a new file: all of its content is added */ }
    }
    hits = editPointers(index, input.file_path, { projectDir, seen, added: addedText(input, previous) });
  } else if (kind === "bash") {
    const file = snapshotFile(stateDir, payload.session_id);
    let snapshot = null;
    try {
      snapshot = JSON.parse(readFileSync(file, "utf8"));
    } catch { /* the session's first check */ }
    const shell = shellChanges(projectDir, snapshot,
      { untracked: shellWrites(payload.tool_input?.command) === "any" });
    if (!shell) return "";
    try {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(file, JSON.stringify(shell.snapshot));
    } catch { /* without a snapshot the next check counts these lines again; the dedupe still holds */ }
    // git names the repo by its real path; the cwd may reach it through a symlink.
    const realDir = realpathSync(projectDir);
    const paths = [...shell.changes.keys()].map((p) => matchPath(p, realDir));
    if (!paths.length) return "";
    subject = paths.length > 2 ? `${paths.slice(0, 2).join(", ")} and ${paths.length - 2} more` : paths.join(", ");
    hits = commitPointers(index, shell.changes, { projectDir: realDir, seen, k: EDIT_K });
  } else {
    return "";
  }
  const { text, ids } = formatPointers(hits, root.split(sep).join("/"), { subject });
  if (!ids.length) return "";
  for (const id of ids) seen.add(id);
  save();
  return text;
}

/** What the hook writes to stdout for the host: Claude Code's JSON, or Kimi Code's plain text. */
export function hookOutput(kind, text, env = process.env) {
  if (!text) return "";
  if (env.KIMI_PLUGIN_ROOT && !env.CLAUDE_PLUGIN_ROOT) return text;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: kind === "prompt" ? "UserPromptSubmit" : kind === "bash" ? "PostToolUse" : "PreToolUse",
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
