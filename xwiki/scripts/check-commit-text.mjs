#!/usr/bin/env node
// Commit/PR text guard for the xwiki plugin, shared across hosts.
//
// Before a `git commit` or `gh pr create`/`gh pr edit` runs, refuse a message whose BODY contains a
// bare `@token` or `#123`, which GitHub autolinks into a mention of an unrelated account or a
// reference to the wrong issue tracker. The rule, the account list and the exceptions are in
// okf/conventions/commit-messages.md — not restated here.
//
// Why a hook and not a documented convention: a pushed commit message can only be corrected by
// rewriting history on a shared branch, which is worse than the mention. A rule has to be recalled
// at the right moment; this cannot be forgotten, and it stays silent until violated. Same reasoning
// as check-line-endings.mjs.
//
// Why the SUMMARY line is skipped: the convention is that it is the JIRA issue title verbatim, so it
// cannot take backticks. A bare token there is fixed by renaming the issue.
//
// hooks.json gates each handler with `if` (`Bash(git commit*)`, `Bash(gh pr*)`, plus `Bash(bash *)`,
// `Bash(sh *)`, `Bash(zsh *)`), so Node's ~35 ms startup — the entire cost of this check, which
// itself runs in microseconds — is paid only by a command that could be writing a message. The three
// shell patterns exist for the wrappers handled by checkWrappers(): Claude Code resolves
// `bash -c "git commit …"` to the command `bash` and does not look inside the `-c` string, so
// without them a wrapped commit never reaches this script and the recursion would be dead code. The
// filter is best-effort and errs toward running the hook, which is the safe direction.
//
// Written in Node (which ships with Claude Code and Kimi Code, and runs under opencode's Bun) so it
// works on Windows, macOS and Linux with no shell dependency. Two consumers share checkCommitText():
//   - Claude Code / Kimi Code: this file run directly as a PreToolUse hook (CLI section at bottom).
//   - opencode: imported by xwiki/opencode/plugins/xwiki-commit-text.js (tool.execute.before).
// Kimi's hooks cannot block execution, so there the model must act on the message itself.
//
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A code span suppresses the autolink, so blank one out before looking for violations. Markdown
// code spans do not span a blank line; stopping at one keeps a single stray backtick from masking
// the whole rest of the message.
function blankCodeSpans(text) {
  return text.replace(/`[^`\n]*(?:\n(?!\s*\n)[^`\n]*)*`/g, (m) => " ".repeat(m.length));
}

// Pull heredoc bodies out of a shell command, returning them alongside the command with each
// heredoc removed. Covers `<<EOF`, `<<'EOF'`, `<<"EOF"` and the `<<-` indented form — how a
// multi-line commit message reaches `git commit -F -` or `gh pr create --body-file -`.
function extractHeredocs(command) {
  const bodies = [];
  const stripped = command.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n([\s\S]*?)\r?\n[ \t]*\2(?=\s|$)/g,
    (_m, _q, _tag, body) => {
      bodies.push(body);
      return " ";
    }
  );
  return { bodies, stripped };
}

// Split a shell command into tokens, tracking whether each was quoted so `-m` can be told from a
// value that merely looks like a flag. Good enough for the shapes an agent actually writes; on
// anything it cannot parse the caller stays silent rather than guessing.
function tokenize(command) {
  const tokens = [];
  let cur = "";
  let started = false;
  let quoted = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" || c === '"') {
      const end = command.indexOf(c, i + 1);
      if (end === -1) return null; // unbalanced — do not guess
      cur += command.slice(i + 1, end);
      started = true;
      quoted = true;
      i = end;
    } else if (c === "\\" && i + 1 < command.length) {
      cur += command[i + 1];
      started = true;
      i++;
    } else if (/\s/.test(c)) {
      if (started) tokens.push({ value: cur, quoted });
      cur = "";
      started = false;
      quoted = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) tokens.push({ value: cur, quoted });
  return tokens;
}

// Collect the message text a command would write, split into the exempt summary and the body that
// gets checked. Returns null when the command writes no message we recognise.
function extractMessage(command) {
  const { bodies, stripped } = extractHeredocs(command);
  const tokens = tokenize(stripped);
  if (!tokens) return null;

  const words = tokens.map((t) => (t.quoted ? null : t.value));
  const isGitCommit = words.some((w, i) => w === "git" && words.slice(i + 1).includes("commit"));
  const isGhPr =
    words.some((w, i) => w === "gh" && words[i + 1] === "pr" && ["create", "edit"].includes(words[i + 2]));
  if (!isGitCommit && !isGhPr) return null;

  // `git commit` without any message source opens an editor — nothing to inspect here.
  const messages = [];
  for (let i = 0; i < tokens.length; i++) {
    const { value, quoted } = tokens[i];
    if (quoted) continue;
    if (isGitCommit && (value === "-m" || value === "--message") && tokens[i + 1]) {
      messages.push(tokens[++i].value);
    } else if (isGitCommit && value.startsWith("--message=")) {
      messages.push(value.slice("--message=".length));
    } else if (isGhPr && (value === "--body" || value === "-b") && tokens[i + 1]) {
      messages.push(tokens[++i].value);
    } else if (isGhPr && value.startsWith("--body=")) {
      messages.push(value.slice("--body=".length));
    }
  }

  if (isGhPr) {
    // Every part of a PR body is body — a PR title is passed separately via --title and is not
    // autolinked for mentions the way a body is.
    const text = [...messages, ...bodies].join("\n");
    return text.trim() ? { summary: "", body: text } : null;
  }

  // git commit: the first -m (or the heredoc's first line) is the summary, which is exempt.
  if (messages.length) {
    const [first, ...rest] = messages;
    const firstLines = first.split("\n");
    return { summary: firstLines[0], body: [...firstLines.slice(1), ...rest, ...bodies].join("\n") };
  }
  if (bodies.length) {
    const lines = bodies.join("\n").split("\n");
    return { summary: lines[0], body: lines.slice(1).join("\n") };
  }
  return null;
}

// A commit can be wrapped in a shell invocation — `bash -c "git commit …"` — which hides it from
// both the `if` filter and the parser above, since the outer command is `bash`. Match the inner
// script so it can be parsed in its own right. The alternative considered was scanning the whole
// raw command string whenever nothing parsed; it was rejected because it blocks commands over text
// that was never a message (a token in a `grep` pattern), its advice to add backticks is wrong for
// a shell command where backticks are command substitution, and it cannot keep the summary-line
// exemption — 39 of 900 real commit subjects sampled across the xwiki repos carry a bare `@` token
// (mostly Renovate's `@types/node`), and every one would be blocked with no legal way to comply.
// The two alternatives inside the body are disjoint on their first character (`\` versus anything
// else), so the lazy quantifier cannot backtrack catastrophically on a long or hostile command.
// Matching `\"` as a unit is what lets a doubly-wrapped script be extracted whole.
const SHELL_WRAPPER = /\b(?:ba|z|k|d)?sh\s+-[A-Za-z]*c\s+(['"])((?:[^\\]|\\[\s\S])*?)\1/g;
const MAX_WRAPPER_DEPTH = 3;

// Inspect a Bash command and return the autolink violations in the message it would write, or null
// when there is nothing to enforce. Recurses into shell wrappers, bounded by MAX_WRAPPER_DEPTH so a
// deeply (or maliciously) nested command cannot turn this into a long-running check.
export function checkCommitText(command, depth = 0) {
  if (!command || typeof command !== "string") return null;
  const message = extractMessage(command);
  if (!message) return checkWrappers(command, depth);

  const scanned = blankCodeSpans(message.body);
  const findings = [];
  const seen = new Set();
  // A word character before the `@` means it is part of a larger token — an email address such as
  // the Co-Authored-By trailer, or `HEAD@{1}` — which GitHub does not turn into a mention.
  for (const m of scanned.matchAll(/(?:^|[^\w`])@([A-Za-z][\w-]*)/g)) {
    if (seen.has(`@${m[1]}`)) continue;
    seen.add(`@${m[1]}`);
    findings.push({ token: `@${m[1]}`, kind: "mention" });
  }
  for (const m of scanned.matchAll(/(?:^|[^\w`])#(\d+)/g)) {
    if (seen.has(`#${m[1]}`)) continue;
    seen.add(`#${m[1]}`);
    findings.push({ token: `#${m[1]}`, kind: "reference" });
  }
  // A clean message at this level does not settle it: the command may also carry a wrapped one.
  return findings.length ? { findings, summary: message.summary } : checkWrappers(command, depth);
}

// Parse each `sh -c "<script>"` found in a command as a command in its own right, returning the
// first violation. Every level goes through the same structured parse, so the subject/body split
// and the code-span blanking apply to a wrapped message exactly as to a plain one.
function checkWrappers(command, depth) {
  if (depth >= MAX_WRAPPER_DEPTH) return null;
  SHELL_WRAPPER.lastIndex = 0; // the regex is module-level and /g — reset before each use
  for (const m of command.matchAll(SHELL_WRAPPER)) {
    // Inside a double-quoted shell string a backslash escapes the quote; inside a single-quoted one
    // it is literal. Undo only the former, so the inner script is the text the shell would run.
    const inner = m[1] === '"' ? m[2].replace(/\\(["\\$`])/g, "$1") : m[2];
    const found = checkCommitText(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

// Format the guidance shown to the model on a violation. Shared so every host reports the same
// wording.
export function formatCommitTextMessage({ findings }) {
  const mentions = findings.filter((f) => f.kind === "mention").map((f) => f.token);
  const refs = findings.filter((f) => f.kind === "reference").map((f) => f.token);
  let out = "Unescaped GitHub autolink in commit/PR text\n";
  if (mentions.length) {
    out +=
      `${mentions.join(", ")} would be rendered by GitHub as a mention of that account and notify ` +
      `an unrelated third party.\n`;
  }
  if (refs.length) {
    out +=
      `${refs.join(", ")} would be resolved by GitHub as an issue/PR reference in this repo, but ` +
      `XWiki's issues live in JIRA.\n`;
  }
  out +=
    "Wrap each of them in backticks and run the command again. A pushed commit message cannot be " +
    "corrected without rewriting a shared branch, which is why this is blocked rather than warned " +
    "about.\n" +
    "The summary line is exempt (it is the JIRA issue title verbatim) and was not checked.\n";
  return out;
}

// ---- CLI entrypoint (Claude Code / Kimi Code PreToolUse hook) ---------------------------------
// Only runs when this file is executed directly, not when imported (e.g. by the opencode plugin).
function runAsHook() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }

  const result = checkCommitText(payload?.tool_input?.command);
  if (!result) process.exit(0);

  process.stderr.write(formatCommitTextMessage(result));
  process.exit(2);
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runAsHook();
}
