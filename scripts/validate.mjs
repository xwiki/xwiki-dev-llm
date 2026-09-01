#!/usr/bin/env node
// Repo consistency validator for xwiki-dev-llm. Enforces the invariants that are otherwise kept in
// sync by hand, so they can never drift silently:
//   1. Every skill directory under xwiki/skills/ is listed in README.md, and (except the OKF
//      governor xwiki-knowledge) in xwiki/okf/index.md.
//   2. Each SKILL.md frontmatter `name:` equals its directory name.
//   3. The plugin version fields are identical across all hosts (Claude marketplace + plugin, Kimi
//      plugin, opencode config comment).
//   4. Every OKF topic file is referenced in xwiki/okf/index.md AND in the injected mirror
//      xwiki/instructions/xwiki-org.md.
//   5. The injected mirror stays within its size budget. Invariant 4 can only ever demand *more*
//      text in a file that is loaded into every session; without a ceiling the map grows by
//      accretion, because each extension appends and none ever cuts.
//   6. A branch does NOT change any version field. The bump is not a pull request's job: five
//      manifest fields carry the version, so every concurrent PR used to conflict with every other
//      one on the same five lines over something that was never the change itself. Instead
//      scripts/release.mjs sets them on master after the merge (automatically, via
//      .github/workflows/release.yml), which is what makes installed plugins pull the update.
//   7. Every `okf/...md` path a skill cites actually exists. Skills delegate their rules to the OKF
//      rather than restating them, so a renamed or deleted topic would otherwise leave a skill
//      pointing at nothing — and a reviewer that cannot read its rule source fails silently.
// Node built-ins only. Run from anywhere: `node scripts/validate.mjs`.
// Exit 0 = all invariants hold; exit 1 = violations (each printed on its own line).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const errors = [];

// ---- Invariants 1 & 2: skills ----------------------------------------------------------------
const skills = readdirSync(join(repoRoot, "xwiki/skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const readme = read("README.md");
const okfIndex = read("xwiki/okf/index.md");

for (const skill of skills) {
  const skillMd = read(`xwiki/skills/${skill}/SKILL.md`);
  const m = skillMd.match(/^name:\s*(\S+)\s*$/m);
  if (!m) {
    errors.push(`xwiki/skills/${skill}/SKILL.md: missing frontmatter 'name:'`);
  } else if (m[1] !== skill) {
    errors.push(`xwiki/skills/${skill}/SKILL.md: frontmatter name '${m[1]}' != directory '${skill}'`);
  }
  // Backtick-delimited so xwiki-convert-tests does not spuriously match xwiki-convert-tests-docker.
  if (!readme.includes(`\`${skill}\``)) {
    errors.push(`README.md: skill '${skill}' is not listed in the Skills section`);
  }
  if (skill !== "xwiki-knowledge" && !okfIndex.includes(`\`${skill}\``)) {
    errors.push(`xwiki/okf/index.md: skill '${skill}' is not listed in "Related skills"`);
  }
}

// ---- Invariant 3: version sync ---------------------------------------------------------------
// Parameterised by a reader so invariant 6 can extract the same five fields from a different commit.
// A field that cannot be read comes back undefined rather than throwing, which both invariants
// report as a mismatch.
const extractVersions = (reader) => {
  const json = (p) => {
    try {
      return JSON.parse(reader(p));
    } catch {
      return {};
    }
  };
  const marketplace = json(".claude-plugin/marketplace.json");
  // opencode.jsonc is JSONC (comments), and opencode's config schema has no version field, so the
  // version is carried in a `// version: X.Y.Z` comment instead.
  let opencode;
  try {
    opencode = reader("opencode.jsonc").match(/^\s*\/\/\s*version:\s*(\d+\.\d+\.\d+)/m)?.[1];
  } catch {
    opencode = undefined;
  }
  return {
    "marketplace.metadata.version": marketplace.metadata?.version,
    "marketplace.plugins[xwiki].version": marketplace.plugins?.find((p) => p.name === "xwiki")?.version,
    "xwiki/.claude-plugin/plugin.json version": json("xwiki/.claude-plugin/plugin.json").version,
    "kimi.plugin.json version": json("kimi.plugin.json").version,
    "opencode.jsonc version comment": opencode,
  };
};
const versions = extractVersions(read);
if (new Set(Object.values(versions)).size !== 1) {
  errors.push(`Plugin version mismatch across manifests: ${JSON.stringify(versions)}`);
}

// ---- Invariant 4: OKF topic map completeness -------------------------------------------------
const orgMd = read("xwiki/instructions/xwiki-org.md");
const okfRoot = join(repoRoot, "xwiki/okf");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
for (const abs of walk(okfRoot)) {
  if (!abs.endsWith(".md")) continue;
  if (abs === join(okfRoot, "index.md")) continue;        // the map itself
  const base = basename(abs, ".md");
  if (base === "_template") continue;                     // ADR template, not a topic
  if (/[\\/]decisions[\\/]/.test(abs)) continue;          // ADRs are listed individually only in index.md
  if (!okfIndex.includes(base)) {
    errors.push(`xwiki/okf/index.md: OKF topic '${base}' is not referenced in the map`);
  }
  if (!orgMd.includes(base)) {
    errors.push(`xwiki/instructions/xwiki-org.md: OKF topic '${base}' is not referenced in the mirror map`);
  }
}

// ---- Invariant 5: the always-on file stays small ---------------------------------------------
// xwiki-org.md is injected at the start of every session in every xwiki/* repo, so each line is
// paid for by every task, including the ones that never needed it. The map is routing only —
// topic names; okf/index.md is where a topic gets described. Raise a budget only with a reason.
const ORG_MAX_BYTES = 8000;
const ORG_MAP_MAX_BYTES = 1800;
if (Buffer.byteLength(orgMd) > ORG_MAX_BYTES) {
  errors.push(
    `xwiki/instructions/xwiki-org.md: ${Buffer.byteLength(orgMd)} bytes exceeds the ${ORG_MAX_BYTES}-byte budget ` +
      `for the always-on file — move the detail into an okf/ topic (described in okf/index.md) or a skill`
  );
}
const mapStart = orgMd.indexOf("OKF map");
const mapEnd = orgMd.indexOf("**Capturing learnings:**");
if (mapStart === -1 || mapEnd === -1 || mapEnd < mapStart) {
  errors.push(
    `xwiki/instructions/xwiki-org.md: cannot locate the OKF map block ` +
      `(expected "OKF map" … "**Capturing learnings:**")`
  );
} else {
  const mapBytes = Buffer.byteLength(orgMd.slice(mapStart, mapEnd));
  if (mapBytes > ORG_MAP_MAX_BYTES) {
    errors.push(
      `xwiki/instructions/xwiki-org.md: the OKF map block is ${mapBytes} bytes, over the ${ORG_MAP_MAX_BYTES}-byte ` +
        `budget — the mirror lists topic *names*; describe the topic in xwiki/okf/index.md instead`
    );
  }
}

// ---- Invariant 6: a branch leaves the version alone ------------------------------------------
// The version is released, not authored: scripts/release.mjs writes all five fields on master once
// per release, so a pull request that also writes them conflicts with every other open PR for no
// reason. Compared base -> working tree, so a stray bump is caught before it is even committed.
// Skipped, not failed, when the base ref is not fetched (a shallow clone, or a checkout with no
// remote) so the other invariants still run.
const git = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
// On a PR the base is whatever it targets; otherwise assume the default branch.
const baseBranch = process.env.GITHUB_BASE_REF || "master";
const baseRef = `origin/${baseBranch}`;
const baseSha = git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
const onBaseBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]) === baseBranch;
if (!baseSha) {
  console.log(`validate.mjs: note - ${baseRef} is not available, skipping the version-untouched check`);
} else if (onBaseBranch) {
  // On the release branch itself the version is *supposed* to move - that is release.mjs at work.
  console.log(`validate.mjs: note - on ${baseBranch}, where release.mjs owns the version; check skipped`);
} else {
  // No `baseSha !== HEAD` guard: the comparison is base -> *working tree*, so a version edited but
  // not yet committed must be caught too, on a branch that has no commits of its own yet.
  const baseVersions = extractVersions((p) => {
    const content = git(["show", `${baseSha}:${p}`]);
    if (content === null) throw new Error(`${p} is absent at ${baseSha}`);
    return content;
  });
  const moved = Object.keys(versions).filter((k) => versions[k] !== baseVersions[k]);
  if (moved.length) {
    errors.push(
      `This branch changes the plugin version (${moved.join(", ")}: ` +
        `${baseVersions[moved[0]]} -> ${versions[moved[0]]}), but a pull request must not - it makes every ` +
        `concurrent PR conflict. Revert the version fields to ${baseRef}'s value; the release is cut on ` +
        `${baseBranch} by scripts/release.mjs. To force a minor/major for a change whose significance the ` +
        `file list cannot show, put a 'Release-Bump: minor' (or major) trailer in a commit message instead`
    );
  }
}

// ---- Invariant 7: OKF paths cited by skills resolve ------------------------------------------
// Matches `okf/<dir>/<topic>.md` wherever it appears in a SKILL.md, in backticks or bare.
const okfRefPattern = /okf\/[a-z0-9-]+\/[a-z0-9-]+\.md/g;
for (const skill of skills) {
  const skillMd = read(`xwiki/skills/${skill}/SKILL.md`);
  for (const ref of new Set(skillMd.match(okfRefPattern) ?? [])) {
    if (!existsSync(join(repoRoot, "xwiki", ref))) {
      errors.push(`xwiki/skills/${skill}/SKILL.md: cites '${ref}', which does not exist`);
    }
  }
}

// ---- Report ----------------------------------------------------------------------------------
if (errors.length) {
  console.error(`validate.mjs: ${errors.length} consistency violation(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`validate.mjs: OK (${skills.length} skills, Claude + Kimi + opencode versions in sync at ` +
    `${versions["marketplace.metadata.version"]}, OKF map complete).`);
