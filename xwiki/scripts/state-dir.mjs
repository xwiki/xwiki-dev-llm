// Where this plugin keeps per-machine state that lives outside any repo: the work directory
// (plans, handoffs, drafts, extracted source) and the Docker IT slot files. Both are computed here
// rather than in each script, so the plugin owns exactly one root on a developer's machine and the
// platform rules are written down once.

import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The plugin's state root, following each platform's convention for state a tool keeps for itself
 * (as opposed to documents the developer manages): `XDG_STATE_HOME` on Linux/macOS and
 * `LOCALAPPDATA` on Windows. Both fall back to that ecosystem's own default location, which is what
 * actually applies most of the time — neither variable is set by default on macOS or on Windows
 * outside a user session.
 */
export function stateRoot() {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "xwiki-llm");
  }
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "xwiki-llm");
}

/** Root of the work directories, one subdirectory per repo. `XWIKI_LLM_WORK` overrides it. */
export function workRoot() {
  return process.env.XWIKI_LLM_WORK || join(stateRoot(), "work");
}

/** Directory holding the Docker IT slot files. `XWIKI_LLM_IT_SLOT_DIR` overrides it. */
export function itSlotDir() {
  return process.env.XWIKI_LLM_IT_SLOT_DIR || join(stateRoot(), "it-slots");
}

/**
 * The work root used before the plugin followed the platform state directory. Exported only so the
 * SessionStart hook can spot state left behind there and ask the developer to move it; nothing
 * reads or writes it.
 */
export const LEGACY_WORK_ROOT = join(homedir(), ".xwiki-llm", "work");

// Also runnable, printing the work root: opencode reads instructions/xwiki-org.md verbatim and has
// no SessionStart hook to append the resolved path, so that file points at this command instead of
// repeating the platform rules.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${workRoot()}\n`);
}
