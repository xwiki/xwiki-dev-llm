#!/usr/bin/env node
// End-of-session diff critic trigger for the xwiki plugin, shared by Claude Code and Kimi Code.
//
// When a session that changed its repo is about to stop, block the stop once and ask the model to run
// the `xwiki-diff-critic` agent (xwiki/agents/) on everything it changed, naming the skills and KB
// sections that apply to the changed files, then to fix what the critic ties to a written rule.
//
// Why: sessions follow the code around a change over the rule (existing code is often older than the
// rule), and many rules — test structure, waits, which assertion, flicker vs product bug, API and
// deprecation choices — no script can check. Self-review by the same, anchored session is weak; a
// fresh context holding only the diff and the rules is not anchored on the surrounding code.
//
// Modes (argv[2]), each reading the hook payload on stdin:
//   start — SessionStart: records the repo's state (HEAD + work tree) as the session's baseline.
//   agent — PreToolUse on the agent tool: records that the critic ran (so a session that ran it
//           unprompted is not asked again).
//   stop  — Stop: blocks once when the repo differs from the baseline and no critic ran.
// At most one block per session (recorded before it is returned; an unwritable state means no block),
// never while `stop_hook_active`, never outside the repos in scope, never without a baseline.
// Opt out with XWIKI_LLM_DIFF_CRITIC=off.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { gateSkills, parseDiff, skillsFor } from "./check-diff.mjs";
import { commitPointers, loadSeen } from "./kb-hooks.mjs";
import { defaultRoot, defaultSkillsRoot, loadIndex } from "./kb-search.mjs";
import { isScopedRepo } from "./repo-scope.mjs";
import { kbHookStateDir } from "./state-dir.mjs";

export const CRITIC = "xwiki-diff-critic";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_UNTRACKED = 500;
const MAX_KB = 8;

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20,
  stdio: ["ignore", "pipe", "ignore"] });

const stateFile = (dir, sessionId) =>
  join(dir, `${String(sessionId).replace(/[^\w-]/g, "_").slice(0, 100)}.critic.json`);

function loadState(sessionId, dir) {
  try {
    return JSON.parse(readFileSync(stateFile(dir, sessionId), "utf8"));
  } catch {
    return null;
  }
}

function saveState(sessionId, state, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(dir, sessionId), JSON.stringify(state));
}

/** The repo state a change shows in: `{ root, head, tree, untracked }`, or null outside a repo. */
export function snapshot(cwd) {
  let root;
  try {
    root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
  let head = null;
  try { head = git(root, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]).trim(); } catch { /* unborn */ }
  const status = git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const diff = head ? git(root, ["diff", "--no-color", "--no-ext-diff", "HEAD"]) : "";
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  const hash = createHash("sha1").update(status).update("\0").update(diff);
  for (const p of untracked.slice(0, MAX_UNTRACKED)) {
    try { hash.update(readFileSync(join(root, p))); } catch { /* unreadable: its name still counts */ }
  }
  return { root, head, tree: hash.digest("hex"), untracked: untracked.slice(0, MAX_UNTRACKED) };
}

/**
 * What the session changed since `base`: check-diff's `[{ path, added, … }]` (tracked changes plus the
 * files untracked now that were not at the start), and a reader of the work tree.
 */
function changes(root, base, untrackedAtStart) {
  const files = parseDiff(git(root, ["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", base || EMPTY_TREE]));
  const before = new Set(untrackedAtStart || []);
  for (const p of git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) {
    if (before.has(p)) continue;
    try {
      const text = readFileSync(join(root, p), "utf8");
      if (!text.includes("\0")) files.push({ path: p, isNew: true, added: text.split("\n").map((t, i) => ({ no: i + 1, text: t })), removed: [] });
    } catch { /* unreadable: skipped */ }
  }
  const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } };
  return { files, read };
}

/**
 * The skills and KB sections that apply to the changed files: the skill gate's skills, the skills and
 * sections the KB edit pointers match (applies-to / applies-when), and the sections the session was
 * already pointed at. `{ skills: [name], kb: [id] }`.
 */
export function rulesFor(root, files, read, { sessionId, stateDir, kbRoot = defaultRoot(), skillsRoot } = {}) {
  const skills = new Set(skillsFor(files, read, gateSkills(kbRoot)).keys());
  const kb = [];
  try {
    const skillDir = skillsRoot === undefined ? (kbRoot === defaultRoot() ? defaultSkillsRoot() : null) : skillsRoot;
    const index = loadIndex(kbRoot, { skillsRoot: skillDir });
    const added = new Map(files.map((f) => [join(root, f.path), f.added.map((a) => a.text).join("\n")]));
    for (const h of commitPointers(index, added, { projectDir: root, k: MAX_KB })) {
      if (h.tag === "[skill]") skills.add(h.title);
      else kb.push(h.id);
    }
    for (const id of loadSeen(sessionId, stateDir)) {
      if (!id.startsWith("skill:") && !kb.includes(id)) kb.push(id);
    }
  } catch { /* without the index the critic still gets the gate's skills */ }
  return { skills: [...skills], kb: kb.slice(0, MAX_KB) };
}

/** The Stop hook's reason: what to run, with the prompt to give the critic. */
export function formatRequest({ root, base, files, skills, kb, kbRoot }) {
  const paths = files.map((f) => f.path);
  const shown = paths.length > 6 ? `${paths.slice(0, 6).join(", ")} and ${paths.length - 6} more` : paths.join(", ");
  return `XWiki diff critic — this session changed ${shown}. Before finishing, run the \`${CRITIC}\` agent once `
    + `(Claude Code: subagent_type \`xwiki:${CRITIC}\`), in the foreground — not in the background: you need its `
    + "answer before you finish — with this prompt:\n\n"
    + `Repo: ${root}\nBase: ${base || EMPTY_TREE} (review \`git diff ${base || EMPTY_TREE}\` plus untracked files)\n`
    + `Skills to load: ${skills.length ? skills.join(", ") : "none mapped — search the KB for the changed files' rules"}\n`
    + `KB sections (under ${kbRoot}/): ${kb.length ? kb.join("; ") : "none mapped"}\n\n`
    + "Then check each finding against the rule it cites: fix those that hold, in the commit they belong to "
    + "(amend it, or commit the fix, as you would have), and say which you rejected and why. Change nothing "
    + "the critic does not tie to a written rule, and when a fix needs what you cannot do here (a build, a "
    + "measurement), write no placeholder value: say what remains. This is asked once per session.";
}

/** The `start` hook: records the session's baseline (the first one wins: resume and compact keep it). */
export function start(payload, { stateDir = kbHookStateDir(), env = process.env } = {}) {
  const sessionId = payload?.session_id;
  const cwd = payload?.cwd || process.cwd();
  if (!sessionId || /^off$/i.test(env.XWIKI_LLM_DIFF_CRITIC || "") || !isScopedRepo(cwd, env)) return;
  if (loadState(sessionId, stateDir)) return;
  const snap = snapshot(cwd);
  if (snap) saveState(sessionId, { ...snap, critic: false }, stateDir);
}

/** The `agent` hook: records a critic run. */
export function agent(payload, { stateDir = kbHookStateDir() } = {}) {
  const input = payload?.tool_input || {};
  const name = String(input.subagent_type ?? input.subagentType ?? input.agent ?? "");
  if (!payload?.session_id || !name.includes(CRITIC)) return;
  const state = loadState(payload.session_id, stateDir);
  if (state && !state.critic) saveState(payload.session_id, { ...state, critic: true }, stateDir);
}

/** The `stop` hook: the reason to block the stop with, or "" to let the session stop. */
export function stop(payload, { stateDir = kbHookStateDir(), env = process.env, kbRoot = defaultRoot(), skillsRoot } = {}) {
  const sessionId = payload?.session_id;
  if (!sessionId || payload.stop_hook_active || payload.stopHookActive) return "";
  if (/^off$/i.test(env.XWIKI_LLM_DIFF_CRITIC || "")) return "";
  const state = loadState(sessionId, stateDir);
  if (!state || state.critic) return "";
  const cwd = payload.cwd || state.root;
  if (!isScopedRepo(cwd, env)) return "";
  const now = snapshot(cwd);
  if (!now || now.root !== state.root || (now.head === state.head && now.tree === state.tree)) return "";
  const { files, read } = changes(now.root, state.head, state.untracked);
  if (!files.length) return "";
  try {
    saveState(sessionId, { ...state, critic: true }, stateDir);
  } catch {
    return ""; // unrecorded, the next stop would ask again: do not ask at all
  }
  const { skills, kb } = rulesFor(now.root, files, read, { sessionId, stateDir, kbRoot, skillsRoot });
  return formatRequest({ root: now.root, base: state.head, files, skills, kb, kbRoot: kbRoot.split(sep).join("/") });
}

// ---- CLI ----------------------------------------------------------------------------------------
const invokedDirectly = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  let reason = "";
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const mode = process.argv[2];
    if (mode === "start") start(payload);
    else if (mode === "agent") agent(payload);
    else if (mode === "stop") reason = stop(payload);
  } catch {
    // A trigger that cannot run never keeps a session from stopping.
  }
  if (reason) {
    // Kimi Code reads a Stop block from exit 2 + stderr; Claude Code from its JSON decision.
    if (process.env.KIMI_PLUGIN_ROOT && !process.env.CLAUDE_PLUGIN_ROOT) {
      process.stderr.write(reason);
      process.exitCode = 2;
    } else {
      process.stdout.write(JSON.stringify({ decision: "block", reason }));
      process.exitCode = 0;
    }
  } else {
    process.exitCode = 0;
  }
}
