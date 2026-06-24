# xwiki-dev-llm

Shared LLM configuration for XWiki developers, distributed as a
[Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces).

The goal is consistency across developers, sharing the work of others, and simple onboarding —
generic enough to work for **every** XWiki developer (no required directory layout, no symlinks, no
committed secrets). It was designed in the forum thread
[Organizing our LLM configs for all our repos](https://forum.xwiki.org/t/organizing-our-llm-configs-for-all-our-repos/18551).

The marketplace manifest lives at the repo root (`.claude-plugin/marketplace.json`); the single
plugin lives under [`xwiki/`](xwiki).

## Install

```
/plugin marketplace add https://github.com/xwiki/xwiki-dev-llm
/plugin install xwiki@xwiki-dev-llm
```

For local development against a checkout:

```
/plugin marketplace add /path/to/xwiki-dev-llm
/plugin install xwiki@xwiki-dev-llm
```

## What the `xwiki` plugin provides

- **Org-wide conventions** (`xwiki/instructions/xwiki-org.md`) — the shared "CLAUDE.md for all
  repos". Injected into every session by a `SessionStart` hook (`xwiki/scripts/inject-org-instructions.mjs`),
  **scoped by git remote** so it only applies inside `xwiki/*` and `xwiki-contrib/*` repos (never in
  personal projects). The hook is written in Node (which ships with Claude Code), so it works on
  Windows, macOS and Linux without a bash or `jq` dependency.
- **MCP servers** (`xwiki/.mcp.json`):
  - `discourse` — forum.xwiki.org search/read (no auth).
  - `sonarqube` — SonarCloud code-quality analysis (Docker). Reads `SONARQUBE_TOKEN` and the
    repo-specific `SONARQUBE_PROJECT_KEY` from the environment; no secrets are committed.
- **Skills** (`xwiki/skills/`):
  - `xwiki-build` — canonical Maven build/test commands.
  - `xwiki-pull-request` — conventions for creating a PR (template, commit format, squash/backport).
  - `standard-for-tests` — testing best practices and the XWiki test frameworks.
  - `convert-tests` — convert unit tests to JUnit5/Mockito.
  - `convert-tests-docker` — convert functional IT tests to the Docker `@UITest` framework.
  - `extension` — deploy a XAR/JAR extension to a running XWiki instance.
  - `xwiki-translations` — externalize and render i18n strings safely.
  - `xwiki-documentation` — write and review xwiki.org documentation per the XWiki Documentation Guide (Diataxis).
  - `contrib-release-blog-post` — create the "<Extension> Extension <version> Released" announcement on the xwiki.org Blog for an xwiki-contrib extension.

## Required environment variables

| Variable                | Used by   | Notes                                              |
|-------------------------|-----------|----------------------------------------------------|
| `SONARQUBE_TOKEN`       | sonarqube | Your personal SonarCloud token (same for all repos). |
| `SONARQUBE_PROJECT_KEY` | sonarqube | The SonarCloud project key — **differs per repo**.   |

### Setting `SONARQUBE_PROJECT_KEY` per repo

The project key is specific to each repository, so set it per checkout. The recommended way is
[direnv](https://direnv.net): drop an `.envrc` in each repo (it loads automatically when you `cd`
in, and unloads when you leave). Add `.envrc` to your **global** gitignore so it's never committed:

```bash
# ~/dev/xwiki/xwiki-platform/.envrc
export SONARQUBE_TOKEN="<your-sonarcloud-token>"   # or set once in your shell profile
export SONARQUBE_PROJECT_KEY="org.xwiki.platform:xwiki-platform"
```

```bash
# ~/dev/xwiki/xwiki-commons/.envrc
export SONARQUBE_PROJECT_KEY="org.xwiki.commons:xwiki-commons"
```

Then run `direnv allow` in each repo once. Without direnv, just `export` the vars in your shell
before launching Claude Code from that repo.

Find a repo's exact key on its SonarCloud project page (**Project Information → Project Key**) at
https://sonarcloud.io/organizations/xwiki/projects.

## Validate

```
claude plugin validate ./xwiki
```

## Contributing

Keep committed content **minimal and generic** — no personal paths, machine state, or secrets — and
review the conventions and skills periodically. Issues and changes are discussed on the
[XWiki forum](https://forum.xwiki.org/) and tracked in [JIRA](https://jira.xwiki.org/).
