#!/usr/bin/env node
// Commit/PR text guard for the xwiki plugin, shared across hosts.
//
// Before a `git commit` or `gh pr create`/`gh pr edit` runs, refuse a message whose BODY contains a
// bare `@token` or `#123`, which GitHub autolinks into a mention of an unrelated account or a
// reference to the wrong issue tracker. The rule, the account list and the exceptions are in
// okf/conventions/commit-messages.md — not restated here. A `#123` is only wrong in a repo whose
// issues live in JIRA; a repo tracked in GitHub Issues (XWiki SAS's, some contrib ones) means it, so
// usesJiraIssues() decides from the repo's own files whether to check it.
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
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HEREDOC, simpleCommands } from "./shell-commands.mjs";

// A code span suppresses the autolink, so blank one out before looking for violations. Markdown
// code spans do not span a blank line; stopping at one keeps a single stray backtick from masking
// the whole rest of the message.
function blankCodeSpans(text) {
  return text.replace(/`[^`\n]*(?:\n(?!\s*\n)[^`\n]*)*`/g, (m) => " ".repeat(m.length));
}

// The subcommand of a `git`/`gh` invocation and the tokens after it, or null: `git -C dir commit -m …`
// → `{ name: "commit", args }`. `git`'s options that take a separate value are skipped with it.
function subcommand(tokens, program) {
  const start = tokens.findIndex((t) => t.flag && t.value === program);
  if (start === -1) return null;
  for (let i = start + 1; i < tokens.length; i++) {
    const { value, flag } = tokens[i];
    if (flag && /^(?:-C|-c|--git-dir|--work-tree|--namespace|-R|--repo)$/.test(value)) i++;
    else if (!(flag && value.startsWith("-"))) return { name: value, args: tokens.slice(i + 1) };
  }
  return null;
}

// The options among `args` that carry message text: `[kind, value]` pairs, kind "text" (`-m`, `--body`)
// or "file" (`-F`, `--file`, `--body-file`). `short` maps a short option letter to its kind, `long` a
// long option's name; short options may be clustered (`-am`) or take their value attached (`-mmsg`).
function messageOptions(args, short, long) {
  const found = [];
  for (let i = 0; i < args.length; i++) {
    const { value, flag } = args[i];
    if (!flag) continue;
    const long_ = /^--([\w-]+)(?:=([\s\S]*))?$/.exec(value);
    if (long_) {
      const kind = long[long_[1]];
      if (kind && long_[2] !== undefined) found.push([kind, long_[2]]);
      else if (kind && args[i + 1]) found.push([kind, args[++i].value]);
    } else if (/^-[a-zA-Z]/.test(value)) {
      // In a cluster, the first option taking a value takes the rest of the token, or the next one.
      const k = [...value.slice(1)].findIndex((ch) => short[ch]);
      if (k === -1) continue;
      const rest = value.slice(k + 2);
      if (rest) found.push([short[value[k + 1]], rest]);
      else if (args[i + 1]) found.push([short[value[k + 1]], args[++i].value]);
    }
  }
  return found;
}

// The text a command line writes as a commit message or PR body: one `{ summary, body }` per
// `git commit` (the summary being its first line, exempt) and per `gh pr create`/`edit` (no summary:
// a PR's title is passed separately and is not checked). Only the message is read — the -m/--message
// values, the -F/--file content (a heredoc or the stdin fed to that command, a file the same command
// line writes from a heredoc, or else the file on disk), and gh's --body/--body-file likewise — never
// the rest of a compound command, whose heredocs and arguments may well hold `@Annotations`.
export function extractMessages(command, cwd = process.cwd()) {
  const parsed = simpleCommands(command);
  if (!parsed) return [];
  const { commands, bodies } = parsed;
  const heredocsOf = (cmd) => cmd.tokens.filter((t) => t.flag && HEREDOC.test(t.value))
    .map((t) => bodies[Number(HEREDOC.exec(t.value)[1])]);
  // A `$(cat <<EOF … EOF)` inside a -m value is replaced by the body it outputs.
  const expand = (value) => value.replace(/\$\([^()]*?\u0001(\d+)\u0001[^()]*\)|\u0001(\d+)\u0001/g,
    (_m, a, b) => bodies[Number(a ?? b)]);
  let dir = cwd;
  const dirs = commands.map(({ tokens }) => {
    const here = dir;
    if (tokens[0]?.value === "cd" && tokens[1]) dir = resolvePath(dir, tokens[1].value);
    return here;
  });
  const fileText = (path, at) => {
    const cmd = commands[at];
    if (path === "-" || path === "/dev/stdin") {
      const own = heredocsOf(cmd);
      if (own.length) return own.join("\n");
      const prev = cmd.piped && commands[at - 1];
      if (!prev) return "";
      if (prev.tokens[0]?.value === "echo") return prev.tokens.slice(1).filter((t) => !/^-[neE]+$/.test(t.value)).map((t) => t.value).join(" ");
      if (prev.tokens[0]?.value === "printf") return (prev.tokens[1]?.value ?? "").replace(/\\n/g, "\n");
      return heredocsOf(prev).join("\n");
    }
    // A file the same command line wrote from a heredoc (`cat > msg <<EOF`) does not exist yet.
    for (let i = at - 1; i >= 0; i--) {
      const t = commands[i].tokens;
      const writes = t.some((x, k) => (x.flag && /^>>?$/.test(x.value) && t[k + 1]?.value === path)
        || (x.flag && (x.value === `>${path}` || x.value === `>>${path}`)) || (t[0].value === "tee" && x.value === path));
      if (writes && heredocsOf(commands[i]).length) return heredocsOf(commands[i]).join("\n");
    }
    try {
      const file = resolvePath(dirs[at], path);
      return statSync(file).size <= 1 << 20 ? readFileSync(file, "utf8") : "";
    } catch {
      return "";
    }
  };
  const messages = [];
  commands.forEach((cmd, at) => {
    const git = subcommand(cmd.tokens, "git");
    const gh = subcommand(cmd.tokens, "gh");
    const commit = git?.name === "commit";
    let parts;
    if (commit) {
      parts = messageOptions(git.args, { m: "text", F: "file" }, { message: "text", file: "file" });
    } else if (gh?.name === "pr" && ["create", "edit"].includes(gh.args[0]?.value)) {
      parts = messageOptions(gh.args.slice(1), { b: "text", F: "file" }, { body: "text", "body-file": "file" });
    } else {
      return;
    }
    const text = parts.map(([kind, value]) => (kind === "text" ? expand(value) : fileText(value, at))).join("\n");
    if (!text.trim()) return;
    if (commit) {
      const [summary, ...body] = text.split("\n");
      messages.push({ summary, body: body.join("\n") });
    } else {
      messages.push({ summary: "", body: text });
    }
  });
  return messages;
}

// `path` resolved against `dir`, with a leading `~` expanded.
function resolvePath(dir, path) {
  return resolve(dir, path.replace(/^~(?=\/|$)/, homedir()));
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

// The directory holding `.git` (a directory, or a file in a worktree) above `dir`, or null.
function findRepoRoot(dir) {
  for (let current = dir; current; ) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

// Whether the issues of the repo containing `dir` live in JIRA, read locally so the check costs no
// network call. The root pom.xml says it: an <issueManagement> naming JIRA (xwiki-commons,
// -rendering, -platform) or the contrib parent's `xwiki.issueManagement.jira.id` property; any other
// pom.xml means another tracker. Without a pom.xml, the origin remote decides: the xwiki and
// xwiki-contrib orgs track their issues in JIRA. When none of this can be read, answer true, the
// safe direction: a blocked command can be rewritten, a pushed message cannot.
export function usesJiraIssues(dir) {
  const root = dir && findRepoRoot(dir);
  if (!root) return true;
  let pom = null;
  try {
    pom = readFileSync(join(root, "pom.xml"), "utf8");
  } catch {
    // no pom.xml — fall back to the remote
  }
  if (pom !== null) {
    const issueManagement = pom.match(/<issueManagement>([\s\S]*?)<\/issueManagement>/);
    return /<xwiki\.issueManagement\.jira\.id>/.test(pom) || /jira/i.test(issueManagement?.[1] ?? "");
  }
  try {
    const remote = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /github\.com[:/](?:xwiki|xwiki-contrib)\//i.test(remote);
  } catch {
    return true;
  }
}

// Inspect a Bash command and return the autolink violations in the message it would write, or null
// when there is nothing to enforce. `cwd` is the directory the command runs in, which locates the
// repo for usesJiraIssues(); it is only read when the message holds a `#123`. Recurses into shell
// wrappers, bounded by MAX_WRAPPER_DEPTH so a deeply (or maliciously) nested command cannot turn
// this into a long-running check.
export function checkCommitText(command, { cwd = process.cwd() } = {}, depth = 0) {
  if (!command || typeof command !== "string") return null;
  for (const message of extractMessages(command, cwd)) {
    const found = messageViolations(message, cwd);
    if (found) return found;
  }
  // A clean message at this level does not settle it: the command may also carry a wrapped one.
  return checkWrappers(command, cwd, depth);
}

// The autolink violations in one `{ summary, body }` message, or null.
function messageViolations(message, cwd) {
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
  const references = [...scanned.matchAll(/(?:^|[^\w`])#(\d+)/g)];
  for (const m of references.length && usesJiraIssues(cwd) ? references : []) {
    if (seen.has(`#${m[1]}`)) continue;
    seen.add(`#${m[1]}`);
    findings.push({ token: `#${m[1]}`, kind: "reference" });
  }
  return findings.length ? { findings, summary: message.summary } : null;
}

// Parse each `sh -c "<script>"` found in a command as a command in its own right, returning the
// first violation. Every level goes through the same structured parse, so the subject/body split
// and the code-span blanking apply to a wrapped message exactly as to a plain one.
function checkWrappers(command, cwd, depth) {
  if (depth >= MAX_WRAPPER_DEPTH) return null;
  SHELL_WRAPPER.lastIndex = 0; // the regex is module-level and /g — reset before each use
  for (const m of command.matchAll(SHELL_WRAPPER)) {
    // Inside a double-quoted shell string a backslash escapes the quote; inside a single-quoted one
    // it is literal. Undo only the former, so the inner script is the text the shell would run.
    const inner = m[1] === '"' ? m[2].replace(/\\(["\\$`])/g, "$1") : m[2];
    const found = checkCommitText(inner, { cwd }, depth + 1);
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
      `this repo's issues live in JIRA. To link a PR, write \`owner/repo#N\` or its URL instead.\n`;
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

  // Claude Code and Kimi Code both pass the session's working directory in the payload's `cwd`.
  const result = checkCommitText(payload?.tool_input?.command, { cwd: payload?.cwd || process.cwd() });
  if (!result) process.exit(0);

  process.stderr.write(formatCommitTextMessage(result));
  process.exit(2);
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runAsHook();
}
