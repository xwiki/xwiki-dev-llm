---
title: XWiki development server ecosystem
stability: durable
summary: The servers making up the xwiki.org dev ecosystem, what each is for, and how an LLM
  accesses or verifies each one (MCP, REST, or live WebFetch).
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HServers
---

# XWiki development server ecosystem

These are the servers the XWiki dev community uses to develop XWiki and xwiki-contrib projects.
The **server set and URLs are durable**; anything that changes per release or per person
(current versions, current managers, open issues, build status) is **volatile** — never cache a
value, follow the "how to access" recipe to get the live answer.

The canonical, always-current list (with the architecture diagram of how the servers interact)
is on the dev wiki — fetch it when in doubt:
https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HServers

## Server map

| Server | Purpose | How an LLM accesses / verifies it |
|--------|---------|-----------------------------------|
| [github.com/xwiki](https://github.com/xwiki) | All `xwiki` and `xwiki-contrib` source repos. | `gh` CLI / git. PRs are the contribution unit (see the `xwiki-pull-request` skill). |
| [jira.xwiki.org](https://jira.xwiki.org) | Issue tracker (NOT GitHub Issues). Per-repo keys: `XWIKI`, `XCOMMONS`, `XRENDERING`, plus a key per contrib extension. | No MCP. WebFetch an issue URL, or browse. Reference issues by key (`XWIKI-12345`). |
| [ci.xwiki.org](https://ci.xwiki.org) | Jenkins CI — builds every repo on source change. | No MCP. WebFetch a job/build URL for status (volatile). |
| [ge.xwiki.org](https://ge.xwiki.org) | Develocity — stores CI build scans and provides build caching for CI and local builds. | No MCP. Build scans at `https://ge.xwiki.org/scans`. |
| [sonar.xwiki.org](https://sonar.xwiki.org) → [sonarcloud.io (org `xwiki`)](https://sonarcloud.io/organizations/xwiki/projects/) | Code-quality analysis + quality gate (fails CI on gate failure). `sonar.xwiki.org` redirects to the SonarCloud `xwiki` organization, where analysis now runs. | **MCP: `sonarqube`** (this plugin) — needs `SONARQUBE_TOKEN` + per-repo `SONARQUBE_PROJECT_KEY`. See the `xwiki-fix-sonarqube-issue` skill. |
| [nexus.xwiki.org](https://nexus.xwiki.org) | Maven artifacts: CI snapshots + official releases. Used by the Extension Manager. | No MCP. Snapshot/release jar names also resolvable under `~/.m2`. Good source to *verify* the current dev version. |
| [forum.xwiki.org](https://forum.xwiki.org) | Community + dev discussion (replaced most mailing-list usage). | **MCP: `discourse`** (this plugin, no auth) — search/read topics and posts. |
| [lists.xwiki.org](https://lists.xwiki.org) | Mailing lists kept for server notifications and committer-private / infra / security discussions. | No MCP. Web archive. |
| [extensions.xwiki.org](https://extensions.xwiki.org) | Catalog + docs of all free extensions; the source used by in-product Extension Manager. Extension/Application types have a per-version page at `Extension/<Space>/Versions/<version>/WebHome`; **Project** types do not. | No MCP. WebFetch an extension page (e.g. to find an extension id/version). |
| [xwiki.org](https://xwiki.org) | The product/documentation web site. New docs live under `/documentation` (see the `xwiki-documentation` skill). | No MCP. WebFetch pages. |
| [dev.xwiki.org](https://dev.xwiki.org/xwiki/bin/view/Community/) | The dev guide / development practices wiki — source of truth for conventions and process. | No MCP. WebFetch; index with context-mode for repeated lookups. |
| [l10n.xwiki.org](https://l10n.xwiki.org) | Weblate — contribute translations. | No MCP. See the `xwiki-translations` skill for the dev side of i18n. |
| [design.xwiki.org](https://design.xwiki.org) | Design proposals. | No MCP. WebFetch. |
| [elk.xwiki.org](https://elk.xwiki.org) | Anonymous usage stats / market-share metrics. | Rarely relevant to coding. |
| `#xwiki:matrix.xwiki.org` | Real-time chat (Matrix). | Not programmatically accessed by the LLM. |

## What has MCP today vs. WebFetch-only

- **MCP available (fast, structured):** `discourse` (forum), `sonarqube` (SonarCloud). These ship
  in this plugin's `.mcp.json`.
- **Everything else is WebFetch / REST / `gh` / git.** For repeated reads of the same dev-wiki or
  extensions page within a session, index it once with context-mode (if installed) and search,
  rather than re-fetching.

## Verifying volatile facts

- **Current dev version** → read the repo's root `pom.xml` `<version>`, or check SNAPSHOT jar names
  under `~/.m2` / nexus. Do not trust any cached number (see [[versioning]]).
- **Build / quality status** → WebFetch the relevant ci.xwiki.org job or query the `sonarqube` MCP.
- **Current role holders (infra/perf managers), release plans** → fetch the dev wiki; these change.
