// opencode plugin: XWiki knowledge-base pointers.
//
// Ports the Claude Code pointer hooks (xwiki/scripts/kb-hooks.mjs) to opencode, with the same scoping
// (git remote), threshold, caps and per-session dedupe — the shared runHook() does all of it:
//   - prompt pointers: opencode 1.x `chat.message` appends them to the user's message as a synthetic
//     text part. opencode 2.x has no documented hook on a submitted prompt, so there it is absent.
//   - edit pointers: after an edit/write, appended to the tool result (opencode has no way to add
//     context *before* a tool runs without refusing it, and these are advice, never a refusal).
//   - a skill the session loads (the `skill` tool) is recorded, so no pointer names it again.
//
// Install it by symlinking (or copying) this file into one of opencode's plugin directories:
//   ~/.config/opencode/plugins/   (global)   or   <repo>/.opencode/plugins/   (per project)
// See README.md.
//
// The shared logic is imported by absolute path from the checkout (via XWIKI_LLM_HOME) so this plugin
// does not depend on its own — possibly symlinked — location. It no-ops silently when XWIKI_LLM_HOME
// is unset or the shared script cannot be loaded, and never lets an error reach the prompt or the edit.

import { pathToFileURL } from "node:url";

// Returns (kind, payload) => text ("" for nothing), or undefined when the shared script cannot load.
const loadHook = async () => {
  const home = process.env.XWIKI_LLM_HOME;
  if (!home) return undefined;
  try {
    const { runHook } = await import(pathToFileURL(`${home}/xwiki/scripts/kb-hooks.mjs`).href);
    return (kind, payload) => {
      try {
        return runHook(kind, payload);
      } catch {
        return "";
      }
    };
  } catch {
    return undefined;
  }
};

const isFileWrite = (tool) => tool === "write" || tool === "edit";

const skillPayload = (sessionID, cwd, args) => ({ session_id: sessionID, cwd, tool_input: { name: args?.name } });

// The Claude Code Edit/Write tool input the shared hook reads, built from opencode's edit/write args
// (edit: filePath, oldString, newString; write: filePath, content). Without `hook_event_name` the
// hook does not read the file a write replaced: it runs after the write, so the file is the new
// content already.
const editPayload = (sessionID, cwd, args) => ({
  session_id: sessionID,
  cwd,
  tool_input: { file_path: args?.filePath, old_string: args?.oldString, new_string: args?.newString,
    content: args?.content },
});

// opencode 1.x plugin API.
const server = async ({ directory }) => {
  const hook = await loadHook();
  if (!hook) return {};
  return {
    "chat.message": async (input, output) => {
      const prompt = (output.parts || []).filter((p) => p.type === "text" && !p.synthetic)
        .map((p) => p.text).join("\n");
      const text = prompt && hook("prompt", { session_id: input.sessionID, cwd: directory, prompt });
      if (!text) return;
      output.parts.push({
        id: `prt_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`,
        sessionID: input.sessionID,
        messageID: output.message?.id ?? input.messageID,
        type: "text",
        text,
        synthetic: true,
      });
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool === "skill") hook("skill", skillPayload(input.sessionID, directory, input.args ?? output?.args));
      if (!isFileWrite(input.tool) || typeof output?.output !== "string") return;
      const text = hook("edit", editPayload(input.sessionID, directory, input.args ?? output?.args));
      if (text) output.output += `\n\n${text}`;
    },
  };
};

// opencode 2.x plugin API: edit pointers and skill loads only (see the header).
const setup = async (ctx) => {
  const hook = await loadHook();
  if (!hook) return;
  await ctx.tool.hook("execute.after", (event) => {
    if (event.status !== "completed") return;
    if (event.tool === "skill") {
      hook("skill", skillPayload(event.sessionID, event.input?.workdir ?? ctx.location?.directory, event.input));
    }
    if (!isFileWrite(event.tool)) return;
    const text = hook("edit", editPayload(event.sessionID, event.input?.workdir ?? ctx.location?.directory,
      event.input));
    if (!text) return;
    const result = event.result;
    if (typeof result.output === "string") result.output += `\n\n${text}`;
    if (Array.isArray(result.content)) result.content.push({ type: "text", text });
  });
};

export default { id: "xwiki-kb-pointers", server, setup };
