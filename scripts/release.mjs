#!/usr/bin/env node
// Release the plugin: set the version in every host manifest, commit and tag.
//
// The version lives in five places (three hosts, five fields) and Claude Code pulls an update only
// when it *increases*, so every shipping change needs a bump. Doing that bump inside the pull request
// made every concurrent PR conflict with every other one on the same five lines, and the conflict was
// never about the change itself. So the bump is not a PR's job: pull requests never touch a version
// field (scripts/validate.mjs enforces that), and this script performs the bump on master afterwards,
// once, for whatever has accumulated since the last release.
//
// Which segment moves is derived rather than asked for, because the rule in CLAUDE.md is already
// mechanical: patch for content edits, minor when the *inventory* of capabilities changes (a skill,
// MCP server, hook or opencode plugin added or removed). A change whose significance the file list
// cannot show says so in its commit message with a `Release-Bump: minor|major` trailer, which — unlike
// a version field — two branches can never conflict on. A major is never inferred.
//
// Usage (from anywhere in the checkout):
//   node scripts/release.mjs                 # derive the segment, write, commit and tag
//   node scripts/release.mjs --minor         # force the segment (--patch / --minor / --major)
//   node scripts/release.mjs --dry-run       # print the decision, touch nothing
//   node scripts/release.mjs --push          # also push the commit and the tag
//
// Exits 0 having done nothing when no shipping file changed since the last release, so it is safe to
// run unattended on every push to master (see .github/workflows/release.yml).
// Node built-ins only.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

const git = (args, { allowFailure = false } = {}) => {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(" ")} failed: ${e.stderr || e.message}`);
  }
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const forced = ["major", "minor", "patch"].find(flag);
const dryRun = flag("dry-run");
const push = flag("push");
const unknown = argv.filter((a) => !["--major", "--minor", "--patch", "--dry-run", "--push"].includes(a));
if (unknown.length) {
  console.error(`release.mjs: unknown argument(s): ${unknown.join(" ")}`);
  process.exit(2);
}

// ---- Where the version is written ------------------------------------------------------------
// Surgical text substitution rather than JSON.stringify, so each manifest keeps its own formatting
// (and opencode.jsonc keeps its comments). `count` is asserted: a manifest that gained or lost a
// version field must fail loudly instead of being silently left behind at the old version.
const targets = [
  { path: ".claude-plugin/marketplace.json", pattern: (v) => `"version": "${v}"`, count: 2 },
  { path: "xwiki/.claude-plugin/plugin.json", pattern: (v) => `"version": "${v}"`, count: 1 },
  { path: "kimi.plugin.json", pattern: (v) => `"version": "${v}"`, count: 1 },
  { path: "opencode.jsonc", pattern: (v) => `// version: ${v}`, count: 1 },
];

const currentVersion = JSON.parse(read(".claude-plugin/marketplace.json")).metadata?.version;
if (!/^\d+\.\d+\.\d+$/.test(currentVersion ?? "")) {
  console.error("release.mjs: cannot read a X.Y.Z version from .claude-plugin/marketplace.json " +
    `(got ${currentVersion})`);
  process.exit(1);
}

// ---- What has shipped already -----------------------------------------------------------------
// The release tag is the marker. Before the first tagged release there is none, so fall back to the
// commit that introduced the current version string — which is exactly the previous release commit.
const tag = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"], { allowFailure: true });
let base = tag;
let baseLabel = tag && `tag ${tag}`;
if (!base) {
  const marketplace = ".claude-plugin/marketplace.json";
  base = git(["log", "-1", "--format=%H", "-S", `"version": "${currentVersion}"`, "--", marketplace],
    { allowFailure: true });
  baseLabel = base && `commit ${base.slice(0, 8)} (introduced ${currentVersion}; no release tag yet)`;
}
if (!base) {
  console.error("release.mjs: cannot determine the last release point (no vX.Y.Z tag, and no commit set the current " +
    "version) - pass an explicit segment and tag this release by hand once to seed the marker");
  process.exit(1);
}

const changed = (git(["diff", "--name-only", base, "HEAD"]) || "").split("\n").filter(Boolean);
const shipping = changed.filter((f) => f.startsWith("xwiki/"));
if (!shipping.length) {
  console.log(`release.mjs: nothing to release - no file under xwiki/ changed since ${baseLabel}.`);
  process.exit(0);
}

// ---- Which segment moves ----------------------------------------------------------------------
// A capability inventory, compared between the last release and HEAD. Only membership matters: a
// skill whose text was edited is a patch, a skill that appeared or disappeared is a minor.
const showAt = (rev, path) => git(["show", `${rev}:${path}`], { allowFailure: true });
const inventory = (rev) => {
  const skills = (git(["ls-tree", "-r", "--name-only", rev, "--", "xwiki/skills/"]) || "")
    .split("\n")
    .filter((f) => f.endsWith("/SKILL.md"))
    .map((f) => f.split("/")[2]);
  const keys = (json, pick) => {
    try {
      return Object.keys(pick(JSON.parse(json)) ?? {});
    } catch {
      return [];
    }
  };
  const mcp = showAt(rev, "xwiki/.mcp.json");
  const hooks = showAt(rev, "xwiki/hooks/hooks.json");
  const plugins = (git(["ls-tree", "-r", "--name-only", rev, "--", "xwiki/opencode/plugins/"]) || "")
    .split("\n")
    .filter(Boolean);
  return {
    skill: skills,
    "MCP server": mcp ? keys(mcp, (o) => o.mcpServers) : [],
    hook: hooks ? keys(hooks, (o) => o.hooks) : [],
    "opencode plugin": plugins,
  };
};

const before = inventory(base);
const after = inventory("HEAD");
const inventoryChanges = [];
for (const kind of Object.keys(after)) {
  const [was, now] = [new Set(before[kind]), new Set(after[kind])];
  for (const name of now) if (!was.has(name)) inventoryChanges.push(`${kind} added: ${name}`);
  for (const name of was) if (!now.has(name)) inventoryChanges.push(`${kind} removed: ${name}`);
}

// The escape hatch: a trailer in any commit message in the range. Commit messages are immutable
// history, so two branches declaring a bump never collide the way two edited manifests do.
const log = git(["log", "--format=%B%x00", `${base}..HEAD`]) || "";
const declared = [...log.matchAll(/^\s*Release-Bump:\s*(major|minor|patch)\s*$/gim)].map((m) => m[1].toLowerCase());

const rank = { patch: 0, minor: 1, major: 2 };
const derived = inventoryChanges.length ? "minor" : "patch";
const candidates = [derived, ...declared];
const segment = forced ?? candidates.reduce((a, b) => (rank[b] > rank[a] ? b : a));

const reasons = [];
if (forced) reasons.push(`forced by --${forced}`);
if (inventoryChanges.length) reasons.push(...inventoryChanges);
else reasons.push("content edits only (no capability added or removed)");
for (const d of declared) reasons.push(`declared by a Release-Bump: ${d} commit trailer`);

const [major, minor, patch] = currentVersion.split(".").map(Number);
const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[segment];

console.log(`last release : ${baseLabel}`);
console.log(`changed since: ${shipping.length} file(s) under xwiki/ (${changed.length} in total)`);
console.log(`segment      : ${segment}`);
for (const r of reasons) console.log(`               - ${r}`);
console.log(`new version  : ${currentVersion} -> ${next}`);

if (dryRun) {
  console.log("release.mjs: --dry-run, nothing written.");
  process.exit(0);
}

// ---- Write, commit, tag -----------------------------------------------------------------------
for (const { path, pattern, count } of targets) {
  const text = read(path);
  const from = pattern(currentVersion);
  const found = text.split(from).length - 1;
  if (found !== count) {
    console.error(`release.mjs: ${path}: expected ${count} occurrence(s) of '${from}', found ${found} - aborting ` +
      "without writing anything (fix the manifest, or the version fields would drift apart)");
    process.exit(1);
  }
  writeFileSync(join(repoRoot, path), text.split(from).join(pattern(next)));
  console.log(`wrote ${path}`);
}

const message = [`[Misc] Release ${next}`, "", ...reasons.map((r) => `* ${r}`)].join("\n");
git(["add", "--", ...targets.map((t) => t.path)]);
git(["commit", "-m", message]);
git(["tag", "-a", `v${next}`, "-m", `Release ${next}`]);
console.log(`committed and tagged v${next}`);

if (push) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  git(["push", "origin", `HEAD:${branch}`]);
  git(["push", "origin", `v${next}`]);
  console.log(`pushed ${branch} and v${next} to origin`);
} else {
  console.log(`run 'git push origin HEAD && git push origin v${next}' to publish it`);
}
