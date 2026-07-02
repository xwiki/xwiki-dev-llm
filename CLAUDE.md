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
node scripts/validate.mjs        # repo consistency (skill inventory, version sync, OKF map)
```

Run both after any change to the plugin. `scripts/validate.mjs` also runs in CI (GitHub Actions) on
every push and pull request. There is no build step, no test runner, and no lint — JSON manifests and
Markdown/`.mjs` files are the entire artifact.

## Architecture

Two-level structure required by the marketplace format:

- **`.claude-plugin/marketplace.json`** (repo root) — the marketplace manifest. Lists the plugins
  and points each `source` at its directory.
- **`xwiki/`** — the single plugin. Its own `.claude-plugin/plugin.json` is the plugin manifest.

Inside `xwiki/`:

- **`instructions/xwiki-org.md`** — the "org-wide CLAUDE.md" (build commands, commit format, code
  conventions, versioning rules) shared by all XWiki repos. It is **not** auto-loaded by Claude
  Code; it is injected at runtime (see hook below).
- **`scripts/inject-org-instructions.mjs`** + **`hooks/hooks.json`** — a `SessionStart` hook that
  injects `xwiki-org.md` as `additionalContext`, **scoped by git remote**: it runs `git remote
  get-url origin` and only injects when the remote matches `github.com[:/](xwiki|xwiki-contrib)/`.
  Personal repos and non-git dirs get nothing. Written in Node (which Claude Code ships) so it is
  cross-platform with no bash/`jq` dependency. If you change the scoping rule, it is the single
  regex in this script.
- **`.mcp.json`** — MCP servers: `discourse` (forum.xwiki.org, no auth) and `sonarqube`
  (SonarCloud via Docker). The sonarqube server reads `SONARQUBE_TOKEN` and the per-repo
  `SONARQUBE_PROJECT_KEY` from the environment via `${VAR}` expansion — never hardcode these.
- **`skills/*/SKILL.md`** — one skill per directory; the `name`/`description` frontmatter is what
  Claude matches against. Every skill's `name` (and its directory) is prefixed `xwiki-`. The skills
  cross-reference each other (e.g. `xwiki-convert-tests` vs `xwiki-convert-tests-docker`,
  `xwiki-test-guidelines` building on the others), so when editing one, check the others' "use X
  instead" pointers stay accurate.

## Conventions when editing this repo

- **Bump the plugin version on every change that ships** — any edit under `xwiki/` (a skill, an OKF
  entry, `instructions/xwiki-org.md`, `.mcp.json`, hooks). Claude Code only pulls a plugin update
  when its version *increases*, so an un-bumped change never reaches installed machines. Which
  segment: **patch** for content edits (OKF/skill/instruction/README wording); **minor** when
  capabilities change (adding/removing a skill or MCP server). Keep the three numbers in sync:
  `marketplace.json` (`metadata.version` and the plugin entry's `version`) and
  `xwiki/.claude-plugin/plugin.json` — `node scripts/validate.mjs` fails if they diverge.
- A skill's `description` must clearly state *when* to use it (and when to use a sibling skill
  instead) — that text is the only thing Claude sees when deciding to invoke it.
- Mirror substantive changes to the plugin's capabilities in `README.md`, which documents the
  install flow, the provided skills/MCP servers, and the required env vars for human readers.
- The XWiki-development facts (Maven profiles, JIRA keys, test frameworks, `@since` versioning) live
  in `instructions/xwiki-org.md` and the `skills/`, not here. Edit those files to change guidance
  given to developers in XWiki repos.