// A plugin directory reached through a symlink (e.g. a profile whose plugins/ links to
// ~/.claude/plugins) must still run its hook scripts: Node gives import.meta.url with the link
// resolved but argv[1] as typed, and a script comparing the two directly decided it was imported
// and exited without output, silently disabling the KB pointer hooks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "xwiki");

function withLinkedPlugin(fn) {
  const dir = mkdtempSync(join(tmpdir(), "xwiki-link-"));
  try {
    const link = join(dir, "plugin");
    symlinkSync(plugin, link, "dir");
    const repo = join(dir, "repo");
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/xwiki/xwiki-platform.git"]);
    return fn(link, repo, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("state-dir.mjs prints the work root when run through a symlinked plugin", () => {
  withLinkedPlugin((link) => {
    const out = execFileSync("node", [join(link, "scripts", "state-dir.mjs")], { encoding: "utf8" });
    assert.ok(out.trim().length > 0);
  });
});

test("kb-hooks.mjs prompt injects pointers when run through a symlinked plugin", () => {
  withLinkedPlugin((link, repo, dir) => {
    const out = execFileSync("node", [join(link, "scripts", "kb-hooks.mjs"), "prompt"], {
      input: JSON.stringify({ session_id: "link-test", cwd: repo,
        prompt: "where do I put a new data migration in xwiki-platform" }),
      cwd: repo,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: link, CLAUDE_PROJECT_DIR: repo, XDG_STATE_HOME: dir },
      encoding: "utf8",
    });
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /XWiki KB pointers/);
  });
});
