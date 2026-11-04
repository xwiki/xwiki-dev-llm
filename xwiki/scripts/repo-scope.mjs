// Which repos this plugin's always-on context applies to: those whose `origin` remote is in the
// `xwiki` or `xwiki-contrib` GitHub org, or in an org the developer named in XWIKI_LLM_ORGS.
// Personal repos and non-git directories are out of scope. Shared by the SessionStart hook, the
// knowledge-base pointer hooks and their opencode wrapper, so the rule is written down once.

import { execFileSync } from "node:child_process";

/**
 * The orgs in scope: the two upstream orgs, plus any the developer adds in XWIKI_LLM_ORGS (comma- or
 * whitespace-separated) — for a company or fork that follows the same conventions in its own org.
 */
export function scopedOrgs(env = process.env) {
  return ["xwiki", "xwiki-contrib", ...(env.XWIKI_LLM_ORGS || "").split(/[,\s]+/).filter(Boolean)];
}

/**
 * Whether a remote URL belongs to an org in scope. Names are taken literally (regex-escaped) and
 * matched case-insensitively, since GitHub org names are; SSH and HTTPS remotes both match.
 */
export function isScopedRemote(remote, env = process.env) {
  const pattern = scopedOrgs(env).map((org) => org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`github\\.com[:/](?:${pattern})/`, "i").test(String(remote || ""));
}

/** The `origin` remote URL of the repo containing `dir`, or null when there is none. */
export function originRemote(dir) {
  try {
    return execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Whether `dir` is inside a repo in scope. */
export function isScopedRepo(dir, env = process.env) {
  const remote = originRemote(dir);
  return remote !== null && isScopedRemote(remote, env);
}
