# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **not** the XWiki application source. It is a [Claude Code plugin
marketplace](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces) that distributes a
single plugin (`xwiki`) of shared LLM configuration — conventions, MCP servers, and skills — to
every developer working in `xwiki/*` and `xwiki-contrib/*` repos. When you edit here, you are
authoring config that ships to other developers' machines, not writing XWiki feature code.

The contents are deliberately **minimal and generic**: no personal paths, machine state, secrets, or
required directory layout. Keep new content that way.

## Validate

```
claude plugin validate ./xwiki   # manifest schema
node scripts/validate.mjs        # repo consistency (skills, version untouched + in sync, OKF map, always-on budget)
```

Run both after any change to the plugin. `scripts/validate.mjs` also runs in CI (GitHub Actions) on
every push and pull request. There is no build step, no test runner, and no lint — JSON manifests and
Markdown/`.mjs` files are the entire artifact.

## Release

```
node scripts/release.mjs --dry-run   # what would be released, and why that segment
```

`scripts/release.mjs` is the **only** thing that writes a version field. It runs on `master`
(automatically, from `.github/workflows/release.yml`, on every push that touches `xwiki/`), sets all
five fields, commits `[Misc] Release X.Y.Z` and tags `vX.Y.Z` — the tag being how the next run knows
what has already shipped. It exits having done nothing when no file under `xwiki/` changed, so
running it is always safe.

The segment is derived, not asked for: **minor** when the capability *inventory* changes between the
last tag and `HEAD` — a skill, an MCP server in `xwiki/.mcp.json`, a hook, or a file under
`xwiki/opencode/plugins/` added or removed — and **patch** for everything else under `xwiki/`. A
**major** is never derived. To override, either put a `Release-Bump: minor` (or `major`) trailer in a commit message —
the escape hatch for a change whose significance the file list cannot show — or run the workflow by
hand (`workflow_dispatch`) with an explicit segment.

## Architecture

Two-level structure required by the marketplace format:

- **`.claude-plugin/marketplace.json`** (repo root) — the marketplace manifest. Lists the plugins
  and points each `source` at its directory.
- **`xwiki/`** — the single plugin. Its own `.claude-plugin/plugin.json` is the plugin manifest.

The same `xwiki/` assets are shared by three hosts, each with its own root manifest: Claude Code
(`.claude-plugin/`), Kimi Code (`kimi.plugin.json`), and opencode (`opencode.jsonc`). When editing a
capability, update all three manifests together (a skill needs no manifest change — it is
auto-discovered — but MCP servers, instructions and hooks are declared per host).

Inside `xwiki/`:

- **`instructions/xwiki-org.md`** — the "org-wide CLAUDE.md" (build commands, commit format, code
  conventions, versioning rules) shared by all XWiki repos. It is **not** auto-loaded by Claude
  Code; it is injected at runtime (see hook below).
- **`scripts/inject-org-instructions.mjs`** + **`hooks/hooks.json`** — a `SessionStart` hook that
  injects `xwiki-org.md` as `additionalContext`, **scoped by git remote**: it runs `git remote
  get-url origin` and only injects when the remote's org is `xwiki`, `xwiki-contrib`, or one the
  developer named in `XWIKI_LLM_ORGS` (comma/whitespace-separated, regex-escaped, matched
  case-insensitively). Personal repos and non-git dirs get nothing. Written in Node (which Claude
  Code ships) so it is cross-platform with no bash/`jq` dependency. If you change the scoping rule,
  it is the `orgs` array and the regex built from it in this script.
- **`.mcp.json`** — MCP servers: `discourse` (forum.xwiki.org), `develocity`
  (community.develocity.cloud — XWiki's build scans) and `sonarqube` (SonarCloud via Docker). All
  three read their credentials from the environment via `${VAR}` expansion — never hardcode
  these. `SONARQUBE_PROJECT_KEY` and the `DISCOURSE_*` variables use the `${VAR:-}` default form on
  purpose: Claude Code refuses to load a server whose `${VAR}` is unset, and both are optional
  (many repos have no SonarCloud project; forum credentials are opt-in).
- **`scripts/start-discourse-mcp.mjs`** — launcher for the `discourse` server, used by all three
  hosts. Anonymous and read-only by default; when a forum credential is in the environment
  (`DISCOURSE_API_KEY` + `DISCOURSE_API_USERNAME`, or the `DISCOURSE_USER_API_KEY` +
  `DISCOURSE_USER_API_CLIENT_ID` pair) it authenticates and enables writes, so Claude can post on
  the forum. A wrapper is required because that choice is conditional on the credential being set,
  which a static MCP manifest cannot express; the credential goes into a temporary 0600 profile
  file rather than on the command line, keeping it out of the process list.
- **`scripts/start-sonarqube-mcp.mjs`** — launcher for the `sonarqube` server, used by Kimi Code and
  opencode (see `kimi.plugin.json` and `opencode.jsonc`). Neither expands a shell-style `${PWD}`
  inside an MCP command, so the script resolves the workspace mount from the session's working
  directory at runtime; Claude Code runs the `docker` command directly from `.mcp.json`.
- **`skills/*/SKILL.md`** — one skill per directory; the `name`/`description` frontmatter is what
  Claude matches against. Every skill's `name` (and its directory) is prefixed `xwiki-`. The skills
  cross-reference each other (e.g. `xwiki-convert-tests` vs `xwiki-convert-tests-docker`,
  `xwiki-test-guidelines` building on the others), so when editing one, check the others' "use X
  instead" pointers stay accurate.
- **`opencode/plugins/*.js`** — opencode plugins (host-specific wrappers). Currently
  `xwiki-line-endings.js`, which ports the line-ending guard to opencode's `tool.execute.after` hook
  and reuses `scripts/check-line-endings.mjs` (that script exports a shared `checkLineEndings()`
  function; run directly it is still the Claude/Kimi CLI hook). opencode resolves the shared assets
  through the `XWIKI_LLM_HOME` env var (which points at the checkout), since it has no plugin
  marketplace — see `opencode.jsonc` and README.md.

## Conventions when editing this repo

- **Never change the plugin version in a pull request** — not in `marketplace.json`
  (`metadata.version` or the plugin entry's `version`), `xwiki/.claude-plugin/plugin.json`,
  `kimi.plugin.json`, or the `// version:` comment in `opencode.jsonc`. Five files carry one number,
  so two branches that each bump it conflict on all five lines over something that was never either
  change; that conflict is why the bump moved out of the PR. `node scripts/validate.mjs` fails a
  branch whose version differs from the base branch's, and still fails when the five disagree with
  each other. The release — including which segment moves — is cut on `master` afterwards; see
  **Release** above.
- **`xwiki/instructions/xwiki-org.md` is injected into every session** in every `xwiki/*` repo, so
  it has a byte budget the validator enforces. Its OKF map lists topic *names*; a topic is described
  in `xwiki/okf/index.md`. Put a rule there only when it must be obeyed without opening any OKF file.
- A skill's `description` must clearly state *when* to use it (and when to use a sibling skill
  instead) — that text is the only thing Claude sees when deciding to invoke it.
- Mirror substantive changes to the plugin's capabilities in `README.md`, which documents the
  install flow, the provided skills/MCP servers, and the required env vars for human readers.
- The XWiki-development facts (Maven profiles, JIRA keys, test frameworks, `@since` versioning) live
  in `instructions/xwiki-org.md` and the `skills/`, not here. Edit those files to change guidance
  given to developers in XWiki repos.