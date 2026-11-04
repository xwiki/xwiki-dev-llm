#!/usr/bin/env node
// SessionStart hook for the xwiki plugin.
// Injects org-wide XWiki conventions as additionalContext, but ONLY when the current repo
// belongs to the `xwiki` or `xwiki-contrib` GitHub org, or to an org the developer named in
// XWIKI_LLM_ORGS. Personal repos get nothing.
// Written in Node (ships with Claude Code and Kimi Code) so it works on Windows, macOS and Linux.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { isScopedRepo } from "./repo-scope.mjs";
import { LEGACY_WORK_ROOT, workRoot } from "./state-dir.mjs";

/** Whether `dir` exists and holds anything. A missing or unreadable directory counts as empty. */
function hasEntries(dir) {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

// Kimi passes the project directory in the hook payload's `cwd`; Claude sets CLAUDE_PROJECT_DIR.
// Fallback to the current working directory when neither is available.
let projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // ignore — not running as a piped hook
}
if (payload.cwd) {
  projectDir = payload.cwd;
}

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.KIMI_PLUGIN_ROOT;

// Scope: the repo's origin remote must be in an org repo-scope.mjs accepts; a personal repo or a
// non-git directory gets nothing.
if (!isScopedRepo(projectDir)) {
  process.exit(0);
}

// The plugin root differs by host: Claude points at the `xwiki/` subdirectory, Kimi points at the
// repository root. Try both layouts so the same script works for both runtimes.
let text;
for (const relativePath of ["instructions/xwiki-org.md", "xwiki/instructions/xwiki-org.md"]) {
  try {
    text = readFileSync(`${pluginRoot}/${relativePath}`, "utf8");
    break;
  } catch {
    // try next candidate
  }
}
if (!text) {
  process.exit(0);
}

// Work directory: where every file a task needs but the repo must not hold (plans, handoffs,
// extracted source, drafts) lives, so those files are all in one place instead of scattered over
// the repo, the system temp dir and the home directory. The rule itself is in xwiki-org.md and the
// root is resolved in state-dir.mjs; what is appended here is only the resolved absolute path,
// which the model cannot compute on its own (env vars, `~` and the repo name). Nothing is created:
// a session that writes no work file leaves no trace, and `mkdir -p` at first use also repairs a
// directory the developer has since deleted.
const root = workRoot();
const repoWorkDir = join(root, basename(projectDir));

text += `
**This machine's work directory:** \`${repoWorkDir}\` — the repo-scoped root for the work files
described under "Work files" above. \`mkdir -p\` the task subdirectory when one is first needed.
`;

// The work root used to be ~/.xwiki-llm/work on every OS. Moving what a developer left there is
// their call, not ours — but going quiet about it would strand the state, so say so for as long as
// anything is still in it.
if (root !== LEGACY_WORK_ROOT && hasEntries(LEGACY_WORK_ROOT)) {
  text += `
**Work files left in the old location:** \`${LEGACY_WORK_ROOT}\` still holds files — it was the
default before this plugin followed the platform's state directory, and nothing reads it any more.
Early in the session, ask the developer to move its contents to \`${root}\` and delete it (or to set
\`XWIKI_LLM_WORK\` to the old path if they would rather keep it). Do not move or delete it yourself.
`;
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text
    }
  })
);
