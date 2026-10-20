// opencode plugin: XWiki commit/PR text guard.
//
// Ports the Claude Code / Kimi Code PreToolUse hook (xwiki/scripts/check-commit-text.mjs) to
// opencode: before a `git commit` or `gh pr create`/`gh pr edit` runs, refuse a message whose body
// contains a bare `@token` or `#123`, which GitHub would autolink into a mention of an unrelated
// account or a reference to the wrong issue tracker. It throws so the model rewrites the message
// with backticks — a pushed commit message can no longer be corrected.
//
// Install it by symlinking (or copying) this file into one of opencode's plugin directories:
//   ~/.config/opencode/plugins/   (global)   or   <repo>/.opencode/plugins/   (per project)
// See README.md.
//
// The shared check logic is imported by absolute path from the checkout (via XWIKI_LLM_HOME) so this
// plugin does not depend on its own — possibly symlinked — location. The plugin no-ops silently when
// XWIKI_LLM_HOME is unset or the shared script cannot be loaded.

import { pathToFileURL } from "node:url";

export const XWikiCommitText = async () => {
  const home = process.env.XWIKI_LLM_HOME;
  if (!home) return {};

  let checkCommitText;
  let formatCommitTextMessage;
  try {
    ({ checkCommitText, formatCommitTextMessage } = await import(
      pathToFileURL(`${home}/xwiki/scripts/check-commit-text.mjs`).href
    ));
  } catch {
    return {}; // shared script not found — nothing to enforce
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;
      const result = checkCommitText(output?.args?.command);
      if (!result) return;
      throw new Error(formatCommitTextMessage(result));
    },
  };
};
