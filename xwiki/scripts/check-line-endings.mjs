#!/usr/bin/env node
// Line-ending guard for the xwiki plugin, shared across hosts.
//
// After a Write/Edit, verify the file's line endings match what the repo's .gitattributes declares
// via an explicit `eol` attribute. On a mismatch it reports a clear message so the model rewrites
// the file correctly. This enforces line endings deterministically and at near-zero token cost (it
// only speaks up on a real violation) instead of relying on a skill being consulted on every write.
// Written in Node (ships with Claude Code and Kimi Code, and runs under opencode's Bun) so it works
// on Windows, macOS and Linux.
//
// Two consumers share the checkLineEndings() function below:
//   - Claude Code / Kimi Code: this file run directly as a PostToolUse hook (CLI section at bottom).
//   - opencode: imported by xwiki/opencode/plugins/xwiki-line-endings.js from a tool.execute.after hook.
//
// Kimi Code note: Kimi runs PostToolUse hooks fire-and-forget and discards their result, and its
// Write/Edit tools name the file `path`, not `file_path`: under Kimi this hook has no effect. opencode
// surfaces the message by throwing from the tool hook.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { invokedDirectly } from "./invoked-directly.mjs";

// Inspect filePath and return { eol, problem } when it violates the repo's declared line-ending
// policy, or null when there is nothing to enforce (not a git repo, binary file, no eol declared,
// no mismatch). Pure enough to reuse from any host hook.
export function checkLineEndings(filePath) {
  if (!filePath) return null;

  // Resolve the attributes git would apply to this path. Run from the file's directory so git
  // discovers the right repository (and nested .gitattributes) regardless of the process cwd.
  let attrOutput;
  try {
    attrOutput = execFileSync(
      "git",
      ["-C", dirname(filePath), "check-attr", "text", "eol", "--", filePath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    return null; // not a git repo, or git unavailable — nothing to enforce
  }

  // check-attr prints one "path: <name>: <value>" line per attribute. Anchor on the end so paths
  // that themselves contain colons don't confuse the parse.
  const attrValue = (name) => {
    for (const line of attrOutput.split("\n")) {
      const m = line.match(new RegExp(`:\\s${name}:\\s(\\S+)\\s*$`));
      if (m) return m[1];
    }
    return "unspecified";
  };

  // Binary files: never inspect or touch line endings.
  if (attrValue("text") === "unset") return null;

  // Only act on an explicitly declared line ending. When eol is unspecified we stay silent — the
  // repo hasn't asked for anything, and guessing would mis-fire on Windows working trees governed
  // by core.autocrlf.
  const eol = attrValue("eol");
  if (eol !== "lf" && eol !== "crlf") return null;

  // Inspect the bytes actually written.
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    return null;
  }

  let problem = null;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const isCRLF = i > 0 && buf[i - 1] === 0x0d;
      if (eol === "lf" && isCRLF) {
        problem = "requires LF (\\n) line endings for this path, but the file contains CRLF (\\r\\n)";
        break;
      }
      if (eol === "crlf" && !isCRLF) {
        problem = "requires CRLF (\\r\\n) line endings for this path, but the file contains a lone LF (\\n)";
        break;
      }
    }
  }

  return problem ? { eol, problem } : null;
}

// Format the guidance message shown to the model on a violation. Shared so every host reports the
// same wording.
export function formatLineEndingMessage(filePath, { eol, problem }) {
  return (
    `Line-ending mismatch in ${filePath}\n` +
    `The repository's .gitattributes ${problem}.\n` +
    `Rewrite the file with ${eol.toUpperCase()} line endings so it does not produce a spurious whole-file diff.\n` +
    `Verify with: git add -N "${filePath}" && git ls-files --eol -- "${filePath}"\n`
  );
}

// ---- CLI entrypoint (Claude Code / Kimi Code PostToolUse hook) --------------------------------
// Only runs when this file is executed directly, not when imported (e.g. by the opencode plugin).
function runAsHook() {
  // Read the hook payload from stdin.
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }

  const result = checkLineEndings(payload?.tool_input?.file_path);
  if (!result) process.exit(0);

  process.stderr.write(formatLineEndingMessage(payload.tool_input.file_path, result));
  process.exit(2);
}

if (invokedDirectly(import.meta.url)) {
  runAsHook();
}
