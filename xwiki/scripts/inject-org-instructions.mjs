#!/usr/bin/env node
// SessionStart hook for the xwiki plugin.
// Injects org-wide XWiki conventions as additionalContext, but ONLY when the current repo
// belongs to the `xwiki` or `xwiki-contrib` GitHub org, or to an org the developer named in
// XWIKI_LLM_ORGS. Personal repos get nothing.
// Written in Node (ships with Claude Code and Kimi Code) so it works on Windows, macOS and Linux.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";

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

// Resolve the repo's origin remote. If this isn't a git repo, inject nothing.
let remote = "";
try {
  remote = execFileSync("git", ["-C", projectDir, "remote", "get-url", "origin"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
} catch {
  process.exit(0);
}

// Scope: the two upstream orgs, plus any the developer adds in XWIKI_LLM_ORGS (comma- or
// whitespace-separated) — for a company or fork that follows the same conventions in its own
// GitHub org. Names are taken literally (regex-escaped) and matched case-insensitively, since
// GitHub org names are; the match handles both SSH and HTTPS remotes.
const orgs = [
  "xwiki",
  "xwiki-contrib",
  ...(process.env.XWIKI_LLM_ORGS || "").split(/[,\s]+/).filter(Boolean)
];
const orgPattern = orgs.map(org => org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
if (!new RegExp(`github\\.com[:/](?:${orgPattern})/`, "i").test(remote)) {
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
// the repo, the system temp dir and the home directory. The rule itself is in xwiki-org.md; what is
// appended here is only the resolved absolute path, which the model cannot compute on its own
// (`~` and the repo name). Nothing is created: a session that writes no work file leaves no trace,
// and `mkdir -p` at first use also repairs a directory the developer has since deleted.
const workRoot = process.env.XWIKI_LLM_WORK || join(homedir(), ".xwiki-llm", "work");
const repoWorkDir = join(workRoot, basename(projectDir));

text += `
**This machine's work directory:** \`${repoWorkDir}\` — the repo-scoped root for the work files
described under "Work files" above. \`mkdir -p\` the task subdirectory when one is first needed.
`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text
    }
  })
);
