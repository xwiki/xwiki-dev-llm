// opencode plugin: XWiki line-ending guard.
//
// Ports the Claude Code / Kimi Code PostToolUse hook (xwiki/scripts/check-line-endings.mjs) to
// opencode: after a write/edit, verify the file's line endings match the repo's .gitattributes
// `eol`. On a mismatch it throws so the model rewrites the file with the right endings, avoiding a
// spurious whole-file diff.
//
// Install it by symlinking (or copying) this file into one of opencode's plugin directories:
//   ~/.config/opencode/plugins/   (global)   or   <repo>/.opencode/plugins/   (per project)
// See README.md.
//
// The shared check logic is imported by absolute path from the checkout (via XWIKI_LLM_HOME) so this
// plugin does not depend on its own — possibly symlinked — location. The plugin no-ops silently when
// XWIKI_LLM_HOME is unset or the shared script cannot be loaded.

import { pathToFileURL } from "node:url";

// Returns the shared check as (filePath) => message | undefined, or undefined when it cannot load.
const loadCheck = async () => {
  const home = process.env.XWIKI_LLM_HOME;
  if (!home) return undefined;
  try {
    const { checkLineEndings, formatLineEndingMessage } = await import(
      pathToFileURL(`${home}/xwiki/scripts/check-line-endings.mjs`).href
    );
    return (filePath) => {
      const result = checkLineEndings(filePath);
      return result ? formatLineEndingMessage(filePath, result) : undefined;
    };
  } catch {
    return undefined; // shared script not found — nothing to enforce
  }
};

const isFileWrite = (tool) => tool === "write" || tool === "edit";

// opencode 1.x plugin API.
const server = async () => {
  const check = await loadCheck();
  if (!check) return {};
  return {
    "tool.execute.after": async (input, output) => {
      if (!isFileWrite(input.tool)) return;
      const message = check(output?.args?.filePath);
      if (message) throw new Error(message);
    },
  };
};

// opencode 2.x plugin API. An `execute.after` hook cannot fail the call there, so the message is
// appended to the tool result instead, where the model reads it and rewrites the file.
const setup = async (ctx) => {
  const check = await loadCheck();
  if (!check) return;
  await ctx.tool.hook("execute.after", (event) => {
    if (event.status !== "completed" || !isFileWrite(event.tool)) return;
    const message = check(event.input?.filePath);
    if (!message) return;
    const result = event.result;
    if (typeof result.output === "string") result.output += `\n\n${message}`;
    if (Array.isArray(result.content)) result.content.push({ type: "text", text: message });
  });
};

export default { id: "xwiki-line-endings", server, setup };
