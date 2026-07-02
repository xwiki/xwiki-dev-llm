#!/usr/bin/env node
// PostToolUse hook for the xwiki plugin.
// After a Write/Edit, verify the file's line endings match what the repo's .gitattributes
// declares via an explicit `eol` attribute. On a mismatch, fail with exit code 2 and a clear
// message so Claude rewrites the file correctly. This enforces line endings deterministically
// and at near-zero token cost (it only speaks up on a real violation) instead of relying on a
// skill being consulted on every single write.
// Written in Node (which Claude Code requires) so it works on Windows, macOS and Linux.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

// Read the hook payload from stdin.
let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

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
  process.exit(0); // not a git repo, or git unavailable — nothing to enforce
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
if (attrValue("text") === "unset") process.exit(0);

// Only act on an explicitly declared line ending. When eol is unspecified we stay silent — the
// repo hasn't asked for anything, and guessing would mis-fire on Windows working trees governed
// by core.autocrlf.
const eol = attrValue("eol");
if (eol !== "lf" && eol !== "crlf") process.exit(0);

// Inspect the bytes actually written.
let buf;
try {
  buf = readFileSync(filePath);
} catch {
  process.exit(0);
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

if (!problem) process.exit(0);

process.stderr.write(
  `Line-ending mismatch in ${filePath}\n` +
    `The repository's .gitattributes ${problem}.\n` +
    `Rewrite the file with ${eol.toUpperCase()} line endings so it does not produce a spurious whole-file diff.\n` +
    `Verify with: git add -N "${filePath}" && git ls-files --eol -- "${filePath}"\n`
);
process.exit(2);
