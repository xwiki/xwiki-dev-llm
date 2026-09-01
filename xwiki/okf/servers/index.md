---
title: XWiki development server ecosystem
stability: durable
summary: The servers making up the xwiki.org dev ecosystem, what each is for, and how an LLM
  accesses or verifies each one (MCP, REST, or live WebFetch).
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HServers
  - https://www.xwiki.org/xwiki/bin/view/Documentation/UserGuide/Features/XWikiRESTfulAPI#HAuthentication
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
| [jira.xwiki.org](https://jira.xwiki.org) | Issue tracker (NOT GitHub Issues). Per-repo keys: `XWIKI`, `XCOMMONS`, `XRENDERING`, plus a key per contrib extension. | No MCP. `jira-cli` (recommended) or REST API (`Authorization: Bearer $JIRA_API_TOKEN`); details + issue-field conventions in [[jira]], procedure in the `xwiki-jira` skill. Reference issues by key (`XWIKI-12345`). |
| [ci.xwiki.org](https://ci.xwiki.org) | Jenkins CI — builds every repo on source change. | No MCP, but a full **REST API** (anonymous read): append `/api/json?tree=…` to any job/build URL — do **not** scrape the UI. Status is volatile. Recipes + the Cloudflare User-Agent trap in [[jenkins]]. |
| [community.develocity.cloud](https://community.develocity.cloud) | Develocity — stores CI build scans and provides build caching for CI and local builds. Gradle's free instance for open-source projects, shared with other projects, so XWiki's data is scoped by the project ID `xwiki` (set in `.mvn/develocity.xml`). | **MCP: `develocity`** (this plugin) — build failures with stack traces, test outcomes and flaky-test history, build timings, cache effectiveness, build-to-build diffs. Remote (streamable HTTP) at `https://community.develocity.cloud/mcp`; needs `DEVELOCITY_MCP_ACCESS_KEY`, which is validated on *every* request including tool listing, so a missing key means the server is absent, not read-only. Build scans are also browsable at `https://community.develocity.cloud/scans`. |
| [sonar.xwiki.org](https://sonar.xwiki.org) → [sonarcloud.io (org `xwiki`)](https://sonarcloud.io/organizations/xwiki/projects/) | Code-quality analysis + quality gate (fails CI on gate failure). `sonar.xwiki.org` redirects to the SonarCloud `xwiki` organization, where analysis now runs. | **MCP: `sonarqube`** (this plugin) — needs `SONARQUBE_TOKEN` + per-repo `SONARQUBE_PROJECT_KEY`. See the `xwiki-fix-sonarqube-issue` skill. The MCP has no quality-gate tool: read `api/qualitygates/project_status` over REST, which — like the other read endpoints — answers **without a token** for the public `xwiki` org. |
| [nexus.xwiki.org](https://nexus.xwiki.org) | Maven artifacts: CI snapshots + official releases. Used by the Extension Manager. | No MCP. Snapshot/release jar names also resolvable under `~/.m2`. Good source to *verify* the current dev version. |
| [forum.xwiki.org](https://forum.xwiki.org) | Community + dev discussion (replaced most mailing-list usage). | **MCP: `discourse`** (this plugin) — search/read topics and posts with no credential. Posting (reply, new topic) needs `DISCOURSE_API_KEY` + `DISCOURSE_API_USERNAME` (or the `DISCOURSE_USER_API_KEY` pair) in the environment: without them the write tools are not registered at all, so a missing post tool means "no credential set", not "posting unavailable". Confirm the exact text with the developer before posting — it goes out under their forum account. |
| [lists.xwiki.org](https://lists.xwiki.org) | Mailing lists kept for server notifications and committer-private / infra / security discussions. | No MCP. Web archive. |
| [extensions.xwiki.org](https://extensions.xwiki.org) | Catalog + docs of all free extensions; the source used by in-product Extension Manager. Extension/Application types have a per-version page at `Extension/<Space>/Versions/<version>/WebHome`; **Project** types do not. | No MCP. WebFetch an extension page (e.g. to find an extension id/version). |
| [xwiki.org](https://xwiki.org) | The product/documentation web site (itself a running XWiki instance). New docs live under `/documentation` (see the `xwiki-doc-writing` and `xwiki-doc-convert` skills). | No MCP. WebFetch to read a rendered page. To read/write page content or xobjects programmatically, use its REST API via the `xwiki-rest-api` skill. |
| [dev.xwiki.org](https://dev.xwiki.org/xwiki/bin/view/Community/) | The dev guide / development practices wiki — source of truth for conventions and process. | No MCP. WebFetch; index with context-mode for repeated lookups. |
| [l10n.xwiki.org](https://l10n.xwiki.org) | Weblate — contribute translations. | No MCP. See the `xwiki-translations` skill for the dev side of i18n. |
| [design.xwiki.org](https://design.xwiki.org) | Design proposals. | No MCP. WebFetch. |
| [elk.xwiki.org](https://elk.xwiki.org) | Anonymous usage stats / market-share metrics. | Rarely relevant to coding. |
| `#xwiki:matrix.xwiki.org` | Real-time chat (Matrix). | Not programmatically accessed by the LLM. |

## What has MCP today vs. WebFetch-only

- **MCP available (fast, structured):** `discourse` (forum — read always, write when a forum
  credential is set), `sonarqube` (SonarCloud). These ship in this plugin's `.mcp.json`.
- **Everything else is WebFetch / REST / `gh` / git.** For repeated reads of the same dev-wiki or
  extensions page within a session, index it once with context-mode (if installed) and search,
  rather than re-fetching.

## Accessing / writing to xwiki.org & extensions.xwiki.org via REST

Both sites run XWiki; program against the REST API (`/xwiki/rest/…`), not the `/xwiki/bin/…` UI URLs.
The procedure lives in the `xwiki-rest-api` skill; the durable gotchas are:

- **The sites sit behind Cloudflare, which blocks a browser-like `User-Agent`.** A `Mozilla/5.0 …
  Chrome/…` UA — or no UA at all — gets `403` on `/xwiki/rest/…`; the default `curl/8.x` UA gets
  through, so **never dress the request up as a browser**. The same block fronts ci.xwiki.org
  ([[jenkins]]): it is a farm-wide rule, not a doc-site one.
- **Only `/rest` honors HTTP Basic auth.** The `/bin/` (view/edit/save) endpoints resolve Basic-auth
  requests to `XWiki.Guest`, so a `form_token` scraped from a `/bin/edit` page is the *guest* token
  and gets rejected — authenticate and read/write through `/rest`.
- **REST writes need a CSRF form token** (XWiki 14.10.8+/15.2+): send it in the **`XWiki-Form-Token`
  request header**; every REST response returns the current token in that same header (so any GET
  yields one). Retry once on `403 "Invalid or missing form token."` (it can rotate on server
  restart). An XML page `PUT` is exempt; form-encoded object `POST`/property writes are not.
- **Wiki ids differ:** www.xwiki.org's main wiki is `xwiki` (`/rest/wikis/xwiki/…`);
  **extensions.xwiki.org is a subwiki named `extensions`** (`/rest/wikis/extensions/…`), not `xwiki`.
- **Credentials convention: `~/.xwiki-credentials`** — the developer's xwiki.org write credentials, two
  lines, no quotes and no `export`: `XWIKI_USER=…` / `XWIKI_PASSWORD=…`. Look for that file before
  asking for credentials, but **never print its contents** — not `Read`, not `cat`/`head`/`less`, not
  an `ls`-then-dump of its directory, not a "keys only" probe: the format is documented right here, so
  opening it teaches nothing, while anything printed enters the context *and* the session transcript
  on disk, which outlives the file. Test the *effect* instead: `test -f ~/.xwiki-credentials` answers
  "is it there", an authenticated `/rest` GET answers "does it work". Source it **inside** each command
  that needs it (shell state does not persist between commands), so the password never reaches the
  context: `set -a; . ~/.xwiki-credentials; set +a` then `curl -u "$XWIKI_USER:$XWIKI_PASSWORD" …`.
  If a password does leak into the conversation, say so plainly and tell the developer to rotate it —
  a transcript cannot be un-sent. Same rule for any other secret store the developer points at
  (`~/.netrc`, an env file, a password-manager export).

## Verifying volatile facts

- **Current dev version** → read the repo's root `pom.xml` `<version>`, or check SNAPSHOT jar names
  under `~/.m2` / nexus. Do not trust any cached number (see [[versioning]]).
- **Build / test status** → query the ci.xwiki.org REST API (`/api/json?tree=…`, see [[jenkins]]);
  **quality status** → the `sonarqube` MCP.
- **Current role holders (infra/perf managers), release plans** → fetch the dev wiki; these change.
