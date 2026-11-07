// opencode plugin: XWiki commit gates.
//
// Ports the Claude Code / Kimi Code PreToolUse commit hook (xwiki/scripts/check-diff.mjs) to opencode:
// before a bash `git commit` runs, it throws — refusing the call — when the commit breaks a rule a diff
// shows exactly, or that touches files whose skill the session has not loaded (once per skill; it
// records the session's `skill` tool calls for that, through skill-gate.mjs) — see the shared scripts'
// headers for the rules and the escape hatches. Its advice
// (heuristics that never refuse) is appended to the commit's tool result, since opencode cannot add
// context before a tool runs without refusing it.
//
// Install it by symlinking (or copying) this file into one of opencode's plugin directories:
//   ~/.config/opencode/plugins/   (global)   or   <repo>/.opencode/plugins/   (per project)
// See README.md.
//
// The shared logic is imported by absolute path from the checkout (via XWIKI_LLM_HOME). The plugin
// no-ops silently when XWIKI_LLM_HOME is unset or the shared script cannot be loaded, and a check that
// fails to run never refuses a commit.

import { pathToFileURL } from "node:url";

// Returns { check(command, cwd, sessionID) => { deny, context }, record(sessionID, args) }, or undefined
// when the shared scripts cannot load.
const loadCheck = async () => {
  const home = process.env.XWIKI_LLM_HOME;
  if (!home) return undefined;
  try {
    const { checkCommit } = await import(pathToFileURL(`${home}/xwiki/scripts/check-diff.mjs`).href);
    const { loadedBy, recordLoaded } = await import(pathToFileURL(`${home}/xwiki/scripts/skill-gate.mjs`).href);
    return {
      check: (command, cwd, sessionID) => {
        try {
          return checkCommit(command, { cwd, sessionId: sessionID });
        } catch {
          return { deny: "", context: "" };
        }
      },
      record: (sessionID, args) => recordLoaded(sessionID, loadedBy({ tool_input: { name: args?.name } })),
    };
  } catch {
    return undefined;
  }
};

// Advice waiting for its commit to finish, by tool call id.
const pending = new Map();

// opencode 1.x plugin API.
const server = async ({ directory }) => {
  const gates = await loadCheck();
  if (!gates) return {};
  const { check, record } = gates;
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "skill") record(input.sessionID, output?.args);
      if (input.tool !== "bash") return;
      const { deny, context } = check(output?.args?.command, output?.args?.workdir ?? directory, input.sessionID);
      if (deny) throw new Error(deny);
      if (context) pending.set(input.callID, context);
    },
    "tool.execute.after": async (input, output) => {
      const context = pending.get(input.callID);
      pending.delete(input.callID);
      if (context && typeof output?.output === "string") output.output += `\n\n${context}`;
    },
  };
};

// opencode 2.x plugin API: throwing from `execute.before` refuses the tool call.
const setup = async (ctx) => {
  const gates = await loadCheck();
  if (!gates) return;
  const { check, record } = gates;
  await ctx.tool.hook("execute.before", (event) => {
    if (event.tool === "skill") record(event.sessionID, event.input);
    if (event.tool !== "bash") return;
    const { deny, context } = check(event.input?.command, event.input?.workdir ?? ctx.location?.directory, event.sessionID);
    if (deny) throw new Error(deny);
    if (context) pending.set(event.callID, context);
  });
  await ctx.tool.hook("execute.after", (event) => {
    const context = pending.get(event.callID);
    pending.delete(event.callID);
    if (!context || event.status !== "completed") return;
    const result = event.result;
    if (typeof result.output === "string") result.output += `\n\n${context}`;
    if (Array.isArray(result.content)) result.content.push({ type: "text", text: context });
  });
};

export default { id: "xwiki-commit-gates", server, setup };
