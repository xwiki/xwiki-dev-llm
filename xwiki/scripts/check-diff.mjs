#!/usr/bin/env node
// Commit-time diff check for the xwiki plugin, shared across hosts.
//
// Before a `git commit` runs, read what it will commit and refuse it for a violation that a diff
// shows exactly, naming the rule's home in the KB:
//   - an `@since` / `@Deprecated(since = …)` added in Java whose version is malformed, or that does
//     not name the next release of the root pom's version (kb/conventions/versioning.md);
//   - a javadoc `@deprecated` tag carrying a version (same file);
//   - a public class or member added to a public type outside an `internal` package without
//     `@Unstable` (kb/conventions/backward-compatibility.md);
//   - a `.properties` file the commit turns into UTF-8 (kb/conventions/code-style.md, File encoding);
//   - a new file, in a format with comments, without a license header, in a Maven project (code-style.md,
//     Formatting).
// It also gates on skills (skill-gate.mjs): a commit touching files whose rules live in a skill — tests,
// -legacy code, translations, XAR pages — is refused once per skill the session has not loaded.
// The version and `@Unstable` rules are XWiki Standard's (repos of the `xwiki` org); the other two hold
// in every repo in scope. Lines the same commit removes elsewhere count as moved, not added (a class moved
// to a -legacy module keeps its old `@since`), and so does an `@since` line added to an existing block
// (a backport). A version naming the release line just before the next one comes back as advice, not a
// refusal: it was right when written, before the version bump a rebased or late-merged change crossed.
// Heuristics never refuse either (tests changed with the coverage threshold untouched, a page or script
// changed with no test, `[Misc]` on a production change).
//
// Escape hatches, for a finding that is wrong: a `Diff-Check: skip` trailer in the commit message
// (kept in history, so a reviewer sees it), or XWIKI_LLM_COMMIT_GATES=off in the environment.
//
// Why a hook: the rules are in the KB and the skills, and sessions still commit against them — they
// copy the code around, or never reach the rule. A refusal forces the fix while it is still a local
// amend.
//
// Two consumers share checkCommit(): Claude Code / Kimi Code run this file as a PreToolUse hook (CLI at
// the bottom: exit 2 refuses; advice goes out as additionalContext, which Kimi's tool hooks cannot
// carry, so there it is dropped); opencode imports it from xwiki/opencode/plugins/xwiki-commit-gates.js.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractMessages } from "./check-commit-text.mjs";
import { invokedDirectly } from "./invoked-directly.mjs";
import { isScopedRemote, originRemote } from "./repo-scope.mjs";
import { commitDirs, isGitCommit, takesUnstaged } from "./shell-commands.mjs";
import { skillGate } from "./skill-gate.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_FILES = 400;
const SKIP_TRAILER = /^Diff-Check:\s*skip\b/im;

// ---- reading the commit -------------------------------------------------------------------------

/**
 * A `-U0` unified diff as `[{ path, isNew, added: [{ no, text }], removed: [text] }]` (`no` is the line
 * number in the new file). Deleted and binary files are left out.
 */
export function parseDiff(diff) {
  const files = [];
  let cur = null;
  let no = 0;
  for (const line of String(diff).split("\n")) {
    const head = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (head) {
      files.push(cur = { path: head[1], isNew: false, deleted: false, added: [], removed: [] });
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("new file mode")) cur.isNew = true;
    else if (line.startsWith("deleted file mode")) cur.deleted = true;
    else if (line.startsWith("@@")) no = Number((/\+(\d+)/.exec(line) || [])[1] || 0);
    else if (line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) cur.added.push({ no: no++, text: line.slice(1) });
    else if (line.startsWith("-")) cur.removed.push(line.slice(1));
  }
  return files.filter((f) => !f.deleted);
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20,
  stdio: ["ignore", "pipe", "ignore"] });

/**
 * What a `git commit` command will commit, read in `cwd` before it runs: `{ root, files, read(path) }`,
 * `read` giving a file's committed content. The index against HEAD; the work tree too when the command
 * takes unstaged changes (`-a`, or a `git add` before it, which also brings untracked files); against
 * HEAD's parent for `--amend`. Null outside a repo.
 */
export function readCommit(cwd, command = "") {
  let root;
  try {
    root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
  const has = (rev) => { try { git(root, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]); return true; } catch { return false; } };
  const amend = /\s--amend\b/.test(command);
  const base = amend ? (has("HEAD~1") ? "HEAD~1" : EMPTY_TREE) : (has("HEAD") ? "HEAD" : EMPTY_TREE);
  const unstaged = takesUnstaged(command);
  const diff = git(root, ["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames",
    ...(unstaged ? [base] : ["--cached", base])]);
  const files = parseDiff(diff);
  if (unstaged && /(?:^|[\s;&|(])git\s+add\b/.test(command)) {
    for (const p of git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) {
      try {
        const text = readFileSync(join(root, p), "utf8");
        if (text.includes("\0")) continue;
        files.push({ path: p, isNew: true, added: text.split("\n").map((t, i) => ({ no: i + 1, text: t })), removed: [] });
      } catch { /* unreadable: skipped */ }
    }
  }
  const read = (p) => {
    try {
      return unstaged ? readFileSync(join(root, p), "utf8") : git(root, ["show", `:${p}`]);
    } catch {
      return null;
    }
  };
  const readBase = (p) => {
    if (base === EMPTY_TREE) return null;
    try { return git(root, ["show", `${base}:${p}`]); } catch { return null; }
  };
  return { root, files: files.slice(0, MAX_FILES), read, readBase };
}

/** The project version of a root pom (outside `<parent>`), or null. */
export function pomVersion(pom) {
  if (!pom) return null;
  const own = String(pom).replace(/<!--[\s\S]*?-->/g, "").replace(/<parent>[\s\S]*?<\/parent>/, "")
    .replace(/<(dependencies|dependencyManagement|build|profiles|properties)>[\s\S]*$/, "");
  return (/<version>\s*([^<\s]+)\s*<\/version>/.exec(own) || [])[1] ?? null;
}

/** The next release of a dev version (versioning.md): `X.Y.0-SNAPSHOT` → `X.Y.0RC1`, `X.Y.Z-SNAPSHOT` → `X.Y.Z`. */
export function nextRelease(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)-SNAPSHOT$/.exec(version || "");
  if (!m) return null;
  return m[3] === "0" ? `${m[1]}.${m[2]}.0RC1` : `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * The releases the line before `next` would have named: `18.10.0RC1` → `18.9.0RC1`, `18.4.3` → `18.4.2`
 * (and `18.4.1` → `18.4.0`, `18.4.0RC1`). A version bump between writing and committing leaves those.
 */
export function previousReleases(next) {
  const m = /^(\d+)\.(\d+)\.(\d+)(RC1)?$/.exec(next || "");
  if (!m) return [];
  const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4]) return [y > 0 ? `${x}.${y - 1}.0RC1` : `${x - 1}.10.0RC1`];
  return z > 1 ? [`${x}.${y}.${z - 1}`] : [`${x}.${y}.0`, `${x}.${y}.0RC1`];
}

/** The GitHub org of an `origin` URL, lower-cased, or null. */
export const remoteOrg = (remote) => ((/github\.com[:/]([^/]+)\//i.exec(String(remote || "")) || [])[1] || "").toLowerCase() || null;

// ---- the rules ----------------------------------------------------------------------------------

const KB = "kb/conventions";
const HOME = {
  version: `${KB}/versioning.md`,
  unstable: `${KB}/backward-compatibility.md#\`@Unstable\` annotation`,
  encoding: `${KB}/code-style.md#File encoding`,
  license: `${KB}/code-style.md#Formatting`,
  misc: `${KB}/commit-messages.md`,
};

const MAIN_JAVA = /(^|\/)src\/main\/(java|aspect)\/.*\.(java|aj)$/;
const INTERNAL = /\/internal\//;
const LEGACY = /(^|\/)[^/]*-legacy[^/]*\//;
// Test modules (page objects, test frameworks) ship no API, so they need no `@Unstable`.
const TEST_MODULE = /(^|\/)[^/]*-test(-[^/]*)?\//;
// Versions from 16.0 on have three numeric segments; older ones (still in moved or backported code) two.
const VERSION = /^(\d+)\.\d+(\.\d+)?(RC\d+|-rc-\d+|M\d+)?$/;
const versionOk = (v) => { const m = VERSION.exec(v); return Boolean(m) && (Number(m[1]) < 16 || m[2] !== undefined); };
const DEPRECATED_SINCE = /@Deprecated\s*\(\s*since\s*=\s*"([^"]*)"/;
const VERSION_IN_TEXT = /\bsince\s+v?\d|(?<![\w.#])\d+\.\d+(?:\.\d+)?(?:RC\d+|M\d+|-rc-\d+)?(?![\w.])/i;
// File types with a comment syntax whose sources carry the LGPL header (code-style.md lists the syntaxes).
const HEADER_TYPES = /\.(java|aj|groovy|js|mjs|ts|vue|css|less|scss|xml|vm|properties|sh|ya?ml|bat)$|(^|\/)\.editorconfig$/;

const where = (f, no) => `${f.path}${no ? `:${no}` : ""}`;

/**
 * Whether `values` (one `@since` block, or one `since` list) date new code right: they name the next
 * release, or — on master — a final release of the previous minor version, which the code reaches
 * through a fix shipped there (`@since 17.5.0` on a 17.6.0-SNAPSHOT master).
 */
function namesNext(values, next) {
  if (values.includes(next)) return true;
  const m = /^(\d+)\.(\d+)\.0RC1$/.exec(next);
  if (!m) return false;
  const previous = Number(m[2]) > 0 ? `${m[1]}.${Number(m[2]) - 1}` : `${Number(m[1]) - 1}.10`;
  return values.some((v) => new RegExp(`^${previous.replace(".", "\\.")}\\.\\d+$`).test(v));
}

/** Whether `values` name the release line just before `next` (see previousReleases). */
const namesPrevious = (values, next) => previousReleases(next).some((v) => values.includes(v));

function versionFindings(files, { next: nextVersion, moved, read }) {
  const out = [];
  for (const f of files.filter((x) => MAIN_JAVA.test(x.path))) {
    // A -legacy module re-adds old API with its old versions: there only the format is checked.
    const next = LEGACY.test(f.path) ? null : nextVersion;
    const addedNos = new Set(f.added.map((a) => a.no));
    let lines = null;
    // Whether the javadoc above line `no` already had a `@deprecated` tag: an existing deprecation.
    const deprecatedBefore = (no) => {
      lines ??= (read(f.path) || "").split("\n");
      for (let i = no - 2; i >= 0; i--) {
        const t = lines[i].trim();
        if (!t || (!/^(\/\*|\*|\/\/)/.test(t) && /[;{}]$/.test(t))) return false;
        if (/@deprecated\b/.test(t) && !addedNos.has(i + 1)) return true;
      }
      return false;
    };
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const values = group.map((g) => g.value);
      const bad = values.filter((v) => !versionOk(v));
      if (bad.length) {
        out.push({ rule: "version", at: where(f, group[0].no), text: `\`@since ${bad[0]}\` is not a valid version: three `
          + `numeric segments, e.g. \`18.5.0RC1\`, \`18.4.3\`` });
      } else if (next && !namesNext(values, next)) {
        out.push({ rule: "version", at: where(f, group[0].no), warn: namesPrevious(values, next),
          text: `\`@since ${values.join("`, `@since ")}\` does not name the next release, \`${next}\`` });
      }
      group = [];
    };
    for (const a of f.added) {
      const t = a.text.trim();
      const since = /^\*\s*@since\s+(\S+)/.exec(t);
      if (since && !moved.has(t)) {
        if (group.length && group[group.length - 1].no !== a.no - 1) flush();
        group.push({ no: a.no, value: since[1] });
        continue;
      }
      flush();
      const dep = DEPRECATED_SINCE.exec(t);
      if (dep && !moved.has(t)) {
        const values = dep[1].split(",").map((v) => v.trim());
        const bad = values.filter((v) => !versionOk(v));
        // Adding `since` to an existing deprecation keeps its old version.
        const existing = f.removed.some((r) => /@[Dd]eprecated\b/.test(r)) || deprecatedBefore(a.no);
        if (bad.length) {
          out.push({ rule: "version", at: where(f, a.no), text: `\`@Deprecated(since = "${dep[1]}")\` holds an invalid `
            + "version: three numeric segments, several branches comma-separated with no spaces" });
        } else if (next && !existing && !namesNext(values, next)) {
          out.push({ rule: "version", at: where(f, a.no), warn: namesPrevious(values, next),
            text: `\`@Deprecated(since = "${dep[1]}")\` does not name the next release, \`${next}\`` });
        }
      }
      const jd = /^\*\s*@deprecated\b(.*)$/.exec(t);
      if (jd && !moved.has(t) && VERSION_IN_TEXT.test(jd[1])) {
        out.push({ rule: "version", at: where(f, a.no), text: "the javadoc `@deprecated` tag repeats the version: it carries "
          + "the reason and the replacement only, the version goes in `@Deprecated(since = …)`" });
      }
    }
    flush();
  }
  return out;
}

/** Drops the `@since` findings whose group sits next to a pre-existing `@since` line (a backport). */
function dropBackportExtensions(findings, files, read) {
  return findings.filter((x) => {
    if (x.rule !== "version" || !/does not name/.test(x.text) || !/^`@since/.test(x.text)) return true;
    const [path, no] = [x.at.replace(/:\d+$/, ""), Number(/:(\d+)$/.exec(x.at)?.[1])];
    const f = files.find((y) => y.path === path);
    const content = read(path);
    if (!f || !content) return true;
    const lines = content.split("\n");
    const added = new Set(f.added.map((a) => a.no));
    for (const dir of [-1, 1]) {
      let i = no + dir;
      while (added.has(i)) i += dir;
      if (/^\s*\*\s*@since\s/.test(lines[i - 1] || "")) return false;
    }
    return true;
  });
}

// A member declared at the type's top level (4-space indent), in a class or an interface.
const CLASS_MEMBER = /^ {4}public\s+(?:(?:static|final|synchronized|abstract|default|native|strictfp)\s+|<[^>]*>\s+)*(?:([\w.]+(?:<.*>)?(?:\[\])*)\s+)?(\w+)\s*\(/;
const IFACE_MEMBER = /^ {4}(?:public\s+)?(?:(?:default|static|abstract)\s+|<[^>]*>\s+)*([\w.]+(?:<.*>)?(?:\[\])*)\s+(\w+)\s*\(/;
const TYPE_DECL = /^public\s+(?:(?:abstract|final|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record|@interface)\s+(\w+)/;
const KEYWORDS = new Set("return throw new else if for while switch case do try catch synchronized".split(" "));

/**
 * The javadoc and annotation lines right above line `no` (1-based) of `lines`: up to a blank line or a
 * line of code (one ending a statement or a block).
 */
function preamble(lines, no) {
  const out = [];
  for (let i = no - 2; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t || (!/^(\/\*|\*|\/\/)/.test(t) && /[;{}]$/.test(t))) break;
    out.push(t);
  }
  return out.join("\n");
}

/** `name(types)` of a declaration line, generics and parameter names dropped: `compareTo(ResourceReferenceHandler)`. */
function signatureKey(line, name) {
  const at = line.indexOf(`${name}(`) >= 0 ? line.indexOf(`${name}(`) : line.search(new RegExp(`\\b${name}\\s*\\(`));
  let params = line.slice(line.indexOf("(", at) + 1);
  params = params.slice(0, params.lastIndexOf(")") >= 0 ? params.lastIndexOf(")") : params.length);
  while (/<[^<>]*>/.test(params)) params = params.replace(/<[^<>]*>/g, "");
  const types = params.split(",").map((p) => p.trim().replace(/@\w+(\([^)]*\))?\s*/g, "").replace(/\bfinal\s+/, "")
    .split(/\s+/).slice(0, -1).join("")).filter(Boolean);
  return `${name}(${types.join(",")})`;
}

function unstableFindings(files, { read, moved }) {
  const out = [];
  for (const f of files) {
    if (!/(^|\/)src\/main\/java\/.*\.java$/.test(f.path) || INTERNAL.test(f.path) || LEGACY.test(f.path) || TEST_MODULE.test(f.path)
      || /package-info\.java$/.test(f.path)) continue;
    const content = read(f.path);
    if (!content) continue;
    const lines = content.split("\n");
    const typeAt = lines.findIndex((l) => TYPE_DECL.test(l));
    if (typeAt < 0) continue; // not a public top-level type
    const [, kind, type] = TYPE_DECL.exec(lines[typeAt]);
    if (/@Unstable\b/.test(preamble(lines, typeAt + 1))) continue;
    const removedKeys = new Set(f.removed.map((r) => /(\w+)\s*\(/.exec(r)).filter(Boolean).map((r) => signatureKey(r.input, r[1])));
    for (const a of f.added) {
      if (moved.has(a.text.trim())) continue;
      let name;
      if (a.no === typeAt + 1) {
        if (!f.isNew) continue;
        name = type;
      } else {
        const m = (kind === "interface" ? IFACE_MEMBER : CLASS_MEMBER).exec(a.text);
        if (!m || KEYWORDS.has(m[1]) || KEYWORDS.has(m[2])) continue;
        if (kind !== "interface" && !m[1] && m[2] !== type) continue; // a constructor has no return type
        // An explicit no-argument constructor only spells out the default one.
        if (!m[1] && /\(\s*\)/.test(a.text)) continue;
        name = `${type}#${m[2]}`;
        // A declaration this file removes with the same name and erased parameter types (a generics or
        // return-type change), an override or a deprecated member is not new API; an overload is.
        if (removedKeys.has(signatureKey(a.text, m[2]))) continue;
      }
      const pre = preamble(lines, a.no);
      if (/@(Unstable|Override|Deprecated)\b/.test(pre)) continue;
      out.push({ rule: "unstable", at: where(f, a.no), text: `new public API \`${name}\` has no \`@Unstable\` (with its `
        + "`@since`); if it is not meant as API, it belongs in an `internal` package" });
    }
  }
  return out;
}

const isUtf8NonAscii = (text) => text !== null && /[^\x00-\x7f]/.test(text);

function encodingFindings(files, { read, readBase }) {
  const out = [];
  for (const f of files.filter((x) => /\.properties$/.test(x.path))) {
    // Read as UTF-8, an ISO-8859-1 byte above 0x7F decodes to U+FFFD; a real non-ASCII character
    // means the file is UTF-8 encoded, which the build refuses.
    const now = read(f.path);
    if (!isUtf8NonAscii(now) || /�/.test(now)) continue;
    const before = f.isNew ? null : readBase(f.path);
    if (before && isUtf8NonAscii(before) && !/�/.test(before)) continue; // already UTF-8 before this commit
    const line = f.added.find((a) => /[^\x00-\x7f]/.test(a.text));
    out.push({ rule: "encoding", at: where(f, line?.no), text: "`.properties` files are ISO-8859-1: write each non-ASCII "
      + "character as `\\uXXXX` (e.g. `\\u00e9`, and `\\u00A0` for a non-breaking space)" });
  }
  return out;
}

function licenseFindings(files, { read }) {
  const out = [];
  for (const f of files) {
    if (!f.isNew || !HEADER_TYPES.test(f.path) || /(^|\/)src\/test\/resources\//.test(f.path)
      || /(^|\/)(node_modules|target)\//.test(f.path) || /\.min\.(js|css)$/.test(f.path)) continue;
    const content = read(f.path);
    if (content === null || !content.trim()) continue;
    if (/licen[sc]e|copyright/i.test(content.split("\n").slice(0, 40).join("\n"))) continue;
    out.push({ rule: "license", at: f.path, text: "new file without the LGPL license header (`mvn license:format -B -ntp` "
      + "adds it to the files it checks; add it by hand to the others, in the file type's comment syntax)" });
  }
  return out;
}

// ---- advice (never refuses) ---------------------------------------------------------------------

const TEST = /(^|\/)src\/test\//;
const PAGE_OR_SCRIPT = /(^|\/)src\/main\/(resources\/.*\.xml|.*\.vm|.*\.js)$/;

function advice(files, { summary, read }) {
  const out = [];
  const tests = files.filter((f) => TEST.test(f.path) && /\.java$/.test(f.path));
  if (tests.length) {
    const modules = new Set(tests.map((f) => f.path.replace(/(^|\/)src\/test\/.*$/, "$1")));
    for (const m of modules) {
      const pom = `${m}pom.xml`;
      const text = read(pom);
      const touched = files.some((f) => f.path === pom && f.added.some((a) => /xwiki\.jacoco\.instructionRatio/.test(a.text)));
      if (text && /xwiki\.jacoco\.instructionRatio/.test(text) && !touched) {
        out.push(`Tests changed in ${m || "the root module"} but its \`xwiki.jacoco.instructionRatio\` did not: if coverage `
          + "grew, raise it (skill xwiki-increase-test-coverage).");
      }
    }
  }
  const pages = files.filter((f) => PAGE_OR_SCRIPT.test(f.path) && !/\.min\.js$/.test(f.path));
  if (pages.length && !files.some((f) => TEST.test(f.path))) {
    out.push(`${pages[0].path}${pages.length > 1 ? ` and ${pages.length - 1} more` : ""} changed with no test in the commit: `
      + "a page or script change is normally covered by a page test or a functional test (skill xwiki-test-guidelines).");
  }
  const production = files.filter((f) => /(^|\/)src\/main\//.test(f.path));
  if (/^\[Misc\]/.test(summary || "") && production.length) {
    out.push(`\`[Misc]\` on a commit changing ${production[0].path}${production.length > 1 ? ` and ${production.length - 1} more` : ""}: `
      + `a change users can see needs its JIRA issue (${HOME.misc}).`);
  }
  return out;
}

// ---- entry points -------------------------------------------------------------------------------

/**
 * The checks over a read commit (see readCommit): `{ findings, advice }`. `org` is the repo's GitHub
 * org (the version and `@Unstable` rules are the `xwiki` org's), `summary` the commit's first line.
 */
export function checkDiff(commit, { org = null, summary = "" } = {}) {
  const { files, read, readBase = () => null } = commit;
  const moved = new Set(files.flatMap((f) => f.removed.map((r) => r.trim())).filter((t) => t.length > 3));
  const findings = [];
  const tips = [];
  if (org === "xwiki") {
    const next = nextRelease(pomVersion(read("pom.xml")));
    for (const f of dropBackportExtensions(versionFindings(files, { next, moved, read }), files, read)) {
      if (!f.warn) findings.push(f);
      else tips.push(`${f.at}: ${f.text}, only the one before it: `
        + `right if written before the version bump, but if this change ships in \`${next}\`, update it (${HOME.version}).`);
    }
    findings.push(...unstableFindings(files, { read, moved }));
  }
  findings.push(...encodingFindings(files, { read, readBase }));
  // The header is a Maven project's rule (license-maven-plugin): a repo without a root pom has none.
  if (read("pom.xml") !== null) findings.push(...licenseFindings(files, { read }));
  return { findings, advice: [...tips, ...advice(files, { summary, read })] };
}

/** The refusal text for `findings`, grouped by rule with the rule's home. */
export function formatFindings(findings) {
  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) || []), f]);
  let out = "XWiki diff check — this commit breaks XWiki rules; fix the diff and commit again:\n";
  for (const [rule, list] of byRule) {
    out += `\n${HOME[rule]}:\n`;
    for (const f of list.slice(0, 8)) out += `- ${f.at}: ${f.text}\n`;
    if (list.length > 8) out += `- … and ${list.length - 8} more\n`;
  }
  out += "\nOnly if a finding is wrong, add the trailer `Diff-Check: skip` to the commit message, saying why in the body.\n";
  return out;
}

/**
 * The whole hook for one Bash command in `cwd`: `{ deny, context }` texts ("" for none). Each commit is
 * read in the repo it runs in — `cd ../other && git commit` or `git -C ../other commit` — and checked
 * only when that repo is in scope. The skill gate runs only with a `sessionId` (to know what the
 * session loaded) and not under Kimi Code, which records no skill load.
 */
export function checkCommit(command, { cwd = process.cwd(), env = process.env, sessionId = null, stateDir } = {}) {
  const none = { deny: "", context: "" };
  if (!isGitCommit(command) || /^off$/i.test(env.XWIKI_LLM_COMMIT_GATES || "")) return none;
  const messages = extractMessages(command, cwd).filter((m) => m.summary !== "");
  const skip = messages.some((m) => SKIP_TRAILER.test(`${m.summary}\n${m.body}`));
  const dirs = commitDirs(command, cwd);
  const results = (dirs.length ? dirs : [cwd]).map((dir) => {
    const remote = originRemote(dir);
    if (remote === null || !isScopedRemote(remote, env)) return none;
    const commit = readCommit(dir, command);
    if (!commit || !commit.files.length) return none;
    const { findings, advice: tips } = skip ? { findings: [], advice: [] }
      : checkDiff(commit, { org: remoteOrg(remote), summary: messages[0]?.summary });
    const kimi = env.KIMI_PLUGIN_ROOT && !env.CLAUDE_PLUGIN_ROOT;
    const skills = kimi ? "" : skillGate(sessionId, commit.files, commit.read, stateDir ? { stateDir } : {});
    return {
      deny: [findings.length ? formatFindings(findings) : "", skills].filter(Boolean).join("\n"),
      context: tips.length ? `XWiki diff check — advice, not a refusal:\n- ${tips.join("\n- ")}` : "",
    };
  });
  const join2 = (key) => results.map((r) => r[key]).filter(Boolean).join("\n");
  return { deny: join2("deny"), context: join2("context") };
}

// ---- CLI (Claude Code / Kimi Code PreToolUse hook) ----------------------------------------------
if (invokedDirectly(import.meta.url)) {
  let result = { deny: "", context: "" };
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    result = checkCommit(payload?.tool_input?.command, { cwd: payload?.cwd || process.cwd(), sessionId: payload?.session_id });
  } catch {
    // A check that cannot run never blocks the commit.
  }
  if (result.deny) {
    process.stderr.write(result.deny);
    process.exit(2);
  }
  // Kimi Code's tool hooks cannot add context: the advice is Claude Code's only.
  if (result.context && !(process.env.KIMI_PLUGIN_ROOT && !process.env.CLAUDE_PLUGIN_ROOT)) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: result.context } }));
  }
  process.exitCode = 0;
}
