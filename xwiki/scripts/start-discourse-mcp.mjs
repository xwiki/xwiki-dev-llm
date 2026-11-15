#!/usr/bin/env node
// Start the Discourse MCP server tethered to forum.xwiki.org.
//
// With no credentials in the environment the server runs anonymously and read-only (search and read
// topics/posts) — that is the default for everyone. When a forum credential is present, the same
// server is started authenticated and with writes enabled, so creating topics and posting replies
// becomes possible. Two credential kinds are supported (see https://www.npmjs.com/package/@discourse/mcp):
//
//   - Admin API key: DISCOURSE_API_KEY + DISCOURSE_API_USERNAME (requires forum admin rights)
//   - User API key:  DISCOURSE_USER_API_KEY + DISCOURSE_USER_API_CLIENT_ID (any forum account)
//
// The credential is handed to the server in a temporary profile file (created 0600 in a 0700
// directory and removed when the server stops) instead of on the command line, so it never shows up
// in the machine's process list.
//
// A wrapper is needed because whether to authenticate and enable writes is not expressible in the
// static MCP manifests: the write flags must be added only when a credential is actually set.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workRoot } from "./state-dir.mjs";

const site = "https://forum.xwiki.org";

// Treat blank as unset: the hosts pass the variables through with an empty default when the
// developer has not set them.
const env = (name) => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};

const apiKey = env("DISCOURSE_API_KEY");
const apiUsername = env("DISCOURSE_API_USERNAME");
const userApiKey = env("DISCOURSE_USER_API_KEY");
const userApiClientId = env("DISCOURSE_USER_API_CLIENT_ID");

let authPair;
if (userApiKey && userApiClientId) {
  authPair = { site, user_api_key: userApiKey, user_api_client_id: userApiClientId };
} else if (apiKey && apiUsername) {
  authPair = { site, api_key: apiKey, api_username: apiUsername };
} else if (apiKey || userApiKey) {
  // Half-configured: name the missing variable rather than silently ignoring the credential.
  const missing = apiKey ? "DISCOURSE_API_USERNAME" : "DISCOURSE_USER_API_CLIENT_ID";
  console.error(`xwiki: ${missing} is not set — starting the Discourse MCP server read-only.`);
}

// A credential the forum rejects is worse than none: the server authenticates its own start-up call
// to /about.json, so a stale key makes it fail to tether to the site and register no tools at all —
// every forum tool silently disappears. Check the credential first and drop it if it is refused, so
// that a stale key costs the write tools instead of all of them. Only an outright rejection counts:
// on a network error or a server-side failure the credential is kept and the server decides.
const isRejected = async (headers) => {
  try {
    const response = await fetch(`${site}/about.json`, { headers, signal: AbortSignal.timeout(10000) });
    return response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
};

if (authPair) {
  const headers = authPair.user_api_key
    ? { "User-Api-Key": authPair.user_api_key }
    : { "Api-Key": authPair.api_key, "Api-Username": authPair.api_username };
  if (await isRejected(headers)) {
    console.error(
      `xwiki: ${site} refused the forum credential (check the DISCOURSE_* variables) — ` +
        "starting the Discourse MCP server read-only.",
    );
    authPair = undefined;
  }
}

const args = ["-y", "@discourse/mcp@latest", "--site", site];
let profileDir;
if (authPair) {
  // Write tools are registered only when writes are allowed AND read-only is off, and they also
  // require an auth_pairs entry matching the selected site.
  profileDir = mkdtempSync(join(tmpdir(), "xwiki-discourse-mcp-"));
  const profilePath = join(profileDir, "profile.json");
  // discourse_upload_file reads a local file only from an allowed directory. Allowing the work
  // directory, where post images are kept, lets a post embed them instead of leaving them to paste.
  const profile = {
    site,
    auth_pairs: [authPair],
    read_only: false,
    allow_writes: true,
    allowed_upload_paths: [workRoot()],
  };
  writeFileSync(profilePath, JSON.stringify(profile), { mode: 0o600 });
  args.push("--profile", profilePath);
}

const removeProfile = () => {
  if (profileDir) {
    rmSync(profileDir, { recursive: true, force: true });
    profileDir = undefined;
  }
};
process.on("exit", removeProfile);

// npx is a shell script on POSIX and a .cmd on Windows, which spawn() cannot resolve on its own.
const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  // Let the child shut down first so its exit handler below does the cleanup.
  process.on(signal, () => child.kill(signal));
}

child.on("error", (err) => {
  removeProfile();
  console.error(`Failed to start the Discourse MCP server: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  removeProfile();
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
