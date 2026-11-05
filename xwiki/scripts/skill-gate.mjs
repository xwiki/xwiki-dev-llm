#!/usr/bin/env node
// Commit skill gate for the xwiki plugin, shared across hosts.
//
// Some files carry rules that live in a skill, not in the code around them: tests
// (xwiki-test-guidelines, xwiki-increase-test-coverage), -legacy code, translations, XAR pages. A
// session that never loaded the skill commits against those rules. check-diff.mjs therefore refuses
// the first commit touching such files while the skill is not loaded, naming it; the session loads it,
// checks the diff and commits again. Each skill refuses one commit per session at most, so the gate
// cannot loop, and a session that already loaded the skill is never stopped.
//
// skill-gates.json maps each gated skill to the files that call for it: `paths` (globs), optionally
// `added` (regexes, one of which the lines the commit adds to the file must match) and
// `file-contains` (a regex the committed file must match: a XAR page holds an `<xwikidoc>`).
//
// This file is also the hook recording the loads (CLI at the bottom), per session, under
// state-dir.mjs's skillGateDir(): Claude Code's PostToolUse on the Skill tool, and its
// UserPromptSubmit for a skill the developer invokes as `/xwiki-…`, which runs no Skill tool. opencode
// records them from xwiki-commit-gates.js. Kimi Code records none, so check-diff.mjs skips the gate
// there.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { skillGateDir } from "./state-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPPING = join(HERE, "skill-gates.json");

/** A glob (`**`, `*`, `?`) as an anchored regex over a `/`-separated repo-relative path. */
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

const stateFile = (dir, sessionId) => join(dir, `${String(sessionId).replace(/[^\w-]/g, "_").slice(0, 100)}.json`);

/** What a session loaded and was already refused a commit for: `{ loaded, denied }` sets of skill names. */
export function loadGate(sessionId, dir = skillGateDir()) {
  try {
    const g = JSON.parse(readFileSync(stateFile(dir, sessionId), "utf8"));
    return { loaded: new Set(g.loaded), denied: new Set(g.denied) };
  } catch {
    return { loaded: new Set(), denied: new Set() };
  }
}

export function saveGate(sessionId, gate, dir = skillGateDir()) {
  if (!sessionId) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(dir, sessionId), JSON.stringify({ loaded: [...gate.loaded], denied: [...gate.denied] }));
}

/** The skill names a Skill-tool argument or a prompt names: `xwiki:xwiki-build` and `xwiki-build` → `xwiki-build`. */
const skillNames = (text) => [...new Set(String(text || "").match(/xwiki-[a-z][\w-]*/g) || [])];

/** Records skills as loaded by the session; an unwritable state dir only costs the gate. */
export function recordLoaded(sessionId, names, dir = skillGateDir()) {
  if (!sessionId || !names.length) return;
  try {
    const gate = loadGate(sessionId, dir);
    for (const n of names) gate.loaded.add(n);
    saveGate(sessionId, gate, dir);
  } catch { /* see above */ }
}

/** The skills a hook payload loads: the Skill tool's argument, or a prompt's leading `/xwiki-…` commands. */
export function loadedBy(payload) {
  if (typeof payload?.prompt === "string") {
    return skillNames((payload.prompt.match(/(?:^|\s)\/(?:xwiki:)?xwiki-[a-z][\w-]*/g) || []).join(" "));
  }
  return skillNames(payload?.tool_input?.skill ?? payload?.tool_input?.name);
}

/** The gated skills of skill-gates.json: `[{ skill, globs, added, contains }]`. */
export function gateSkills(file = MAPPING) {
  let mapping;
  try {
    mapping = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const re = (src) => { try { return new RegExp(src, "m"); } catch { return null; } };
  return Object.entries(mapping).map(([skill, m]) => ({
    skill,
    globs: (m.paths || []).map(globToRegExp),
    added: (m.added || []).map(re).filter(Boolean),
    contains: m["file-contains"] ? re(m["file-contains"]) : null,
  }));
}

/** The gated skills a commit's files call for: `Map(skill → first matching path)`. */
export function skillsFor(files, read, gates) {
  const out = new Map();
  for (const g of gates) {
    const f = files.find((x) => g.globs.some((r) => r.test(x.path))
      && (!g.added.length || g.added.some((r) => r.test(x.added.map((a) => a.text).join("\n"))))
      && (!g.contains || g.contains.test(read(x.path) || "")));
    if (f) out.set(g.skill, f.path);
  }
  return out;
}

/**
 * The gate's refusal for a session: the skills the commit calls for that the session neither loaded
 * nor was already refused a commit for. Records them as refused. "" when there are none.
 */
export function skillGate(sessionId, files, read, { stateDir = skillGateDir(), gates = gateSkills() } = {}) {
  if (!sessionId) return "";
  const gate = loadGate(sessionId, stateDir);
  const missing = [...skillsFor(files, read, gates)].filter(([s]) => !gate.loaded.has(s) && !gate.denied.has(s));
  if (!missing.length) return "";
  for (const [s] of missing) gate.denied.add(s);
  try {
    saveGate(sessionId, gate, stateDir);
  } catch {
    return ""; // without the record the next commit would be refused again: do not refuse at all
  }
  const names = missing.map(([s]) => s);
  const them = names.length > 1 ? "them" : "it";
  return `XWiki skill gate — this commit touches ${missing.map(([s, p]) => `${p} (${s})`).join(", ")}; the rules for it are `
    + `in skill${names.length > 1 ? "s" : ""} ${names.join(", ")}, which this session has not loaded. Load ${them} with `
    + `your Skill tool, check the diff against ${them}, fix what breaks a rule, then commit again: this gate refuses `
    + "one commit per skill, the next one goes through.\n";
}

// ---- CLI (Claude Code PostToolUse on Skill, UserPromptSubmit): record the loads, never block --------
const invokedDirectly = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    recordLoaded(payload?.session_id, loadedBy(payload));
  } catch { /* nothing recorded */ }
  process.exitCode = 0;
}
