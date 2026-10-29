// opencode plugin: XWiki commit/PR text guard.
//
// Ports the Claude Code / Kimi Code PreToolUse hook (xwiki/scripts/check-commit-text.mjs) to
// opencode: before a `git commit` or `gh pr create`/`gh pr edit` runs, refuse a message whose body
// contains a bare `@token` or `#123`, which GitHub would autolink into a mention of an unrelated
// account or a reference to the wrong issue tracker. It throws so the model rewrites the message
// with backticks — a pushed commit message can no longer be corrected. The `#123` check only applies
// to a repo whose issues live in JIRA (see usesJiraIssues() in the shared script).
//
// Install it by symlinking (or copying) this file into one of opencode's plugin directories:
//   ~/.config/opencode/plugins/   (global)   or   <repo>/.opencode/plugins/   (per project)
// See README.md.
//
// The shared check logic is imported by absolute path from the checkout (via XWIKI_LLM_HOME) so this
// plugin does not depend on its own — possibly symlinked — location. The plugin no-ops silently when
// XWIKI_LLM_HOME is unset or the shared script cannot be loaded.

import { pathToFileURL } from "node:url";

// Returns the shared check as (command, cwd) => message | undefined, or undefined when it cannot load.
const loadCheck = async () => {
  const home = process.env.XWIKI_LLM_HOME;
  if (!home) return undefined;
  try {
    const { checkCommitText, formatCommitTextMessage } = await import(
      pathToFileURL(`${home}/xwiki/scripts/check-commit-text.mjs`).href
    );
    return (command, cwd) => {
      const result = checkCommitText(command, { cwd });
      return result ? formatCommitTextMessage(result) : undefined;
    };
  } catch {
    return undefined; // shared script not found — nothing to enforce
  }
};

// opencode 1.x plugin API.
const server = async ({ directory }) => {
  const check = await loadCheck();
  if (!check) return {};
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;
      const message = check(output?.args?.command, directory);
      if (message) throw new Error(message);
    },
  };
};

// opencode 2.x plugin API: throwing from `execute.before` refuses the tool call.
const setup = async (ctx) => {
  const check = await loadCheck();
  if (!check) return;
  await ctx.tool.hook("execute.before", (event) => {
    if (event.tool !== "bash") return;
    const message = check(event.input?.command, event.input?.workdir ?? ctx.location?.directory);
    if (message) throw new Error(message);
  });
};

export default { id: "xwiki-commit-text", server, setup };
