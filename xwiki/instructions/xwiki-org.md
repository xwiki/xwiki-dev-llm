# XWiki org-wide conventions

These conventions apply to every repository in the `xwiki` and `xwiki-contrib` GitHub
organizations. They are injected automatically at the start of each session by the `xwiki`
plugin (scoped by git remote). Repo-specific `CLAUDE.md` files add to (and may override) what
follows. This file is deliberately lean; deeper detail lives in the skills and the OKF (see map
below).

## Project facts

- **Issue tracker:** https://jira.xwiki.org (NOT GitHub Issues). Each repo has its own JIRA project
  key — `XWIKI` (Platform), `XCOMMONS` (Commons), `XRENDERING` (Rendering), a per-extension key for
  contrib. Reference issues by their key (e.g. `XWIKI-12345`). To view/create/update issues use the
  **`xwiki-jira`** skill (jira-cli or REST); issue-field conventions are in `okf/servers/jira.md`.
- XWiki Commons, XWiki Rendering and XWiki Platform are **released together with the same version**.
- The **Java version depends on the XWiki version** (defined in the `pom.xml`) — see
  https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/JavaSupportStrategy/#HByXWikiVersions

## Commit messages

- When there is an issue, the summary line is the key followed by **the issue's title, verbatim** —
  not a summary you write: `XWIKI-12345: <the JIRA issue title>` (use the repo's own key —
  `XCOMMONS-…`, `XRENDERING-…`, etc.). What *this* commit does goes in the body as `*` bullets.
- Use `[Misc]` only for trivial changes with no issue; anything affecting users or extension
  developers needs an issue. Full rule: `okf/conventions/commit-messages.md`.

## Building & tests

- For all Maven build/test commands — full build, single module, single test, profiles, skip flags,
  `clean`/`verify` gotchas — use the **`xwiki-build`** skill (the canonical reference).
- **Always pass `-B -ntp`** on every `mvn` invocation (batch mode + no-transfer-progress), to
  suppress interactive prompts and the download/progress lines that otherwise flood the output.
- Unit test classes end with `*Test.java` (Surefire); integration test classes end with `*IT.java`
  (Failsafe).
- Tests must **not** write to stdout/stderr — enforced by Surefire's `CaptureConsole` listener.
  Skip per-module with `-Dxwiki.surefire.captureconsole.skip=true`.
- After adding or changing unit tests in a module, run the **`xwiki-increase-test-coverage`** skill
  as part of that change. Deeper testing guidance: **`xwiki-test-guidelines`** skill /
  `okf/testing/strategy.md`.

## Code conventions

- **Lines must not exceed 120 characters.**
- LGPL license headers are required on every source file — run `mvn license:format -B -ntp` to add
  missing headers.
- In new code, prefer the `jakarta.*` namespaces over `javax.*` (the project is migrating
  `javax`→`jakarta`) — e.g. `jakarta.inject.*` for `@Inject`, `@Named`, `Provider`.
- Use the XWiki **Component system** (`@Component`/`@Inject`/`@Role`) rather than passing context
  objects around in new code — `okf/architecture/component-system.md`.
- **Prefer streaming over buffering for large / user-sized data** — never read attachments, bodies,
  uploads, exports or unbounded query results fully into memory (`byte[]`/`String`/
  `ByteArrayOutputStream`), which OOMs on real data. Full guidance: `okf/conventions/performance.md`.
- `-legacy` modules only re-export deprecated APIs; public API changes are checked by Revapi. Rules:
  `okf/conventions/code-style.md`, `okf/conventions/backward-compatibility.md`.
- **Comments:** describe the code as it is *now* and state the real reason inline; never justify by
  history ("as it was before") or link transient resources (JIRA keys, forum/PR/commit URLs) — those
  rot. Full policy: `okf/conventions/code-comments.md`.

## Versioning new/deprecated APIs

- For `@since` and `@Deprecated(since = "…")`, use the **next release of the current dev version**,
  written `<X.Y.0>RC1` (e.g. `18.5.0RC1`).
- Do **not** trust the version string in a repo's `CLAUDE.md` — it goes stale. Read the real version
  from the root `pom.xml` (`<version>`) or the SNAPSHOT jar names under `~/.m2`.

## OKF — how to go deeper

Fuller *declarative* knowledge lives in this plugin's **OKF** knowledge base. When a question is
about how XWiki works or what its rules are — rather than performing a task — consult the OKF. The
**`xwiki-knowledge`** skill is the entry point for both reading and extending it, and `okf/index.md`
is the full, described map. **Volatile facts are never cached** (current version, build/issue status,
role holders): the relevant file gives a `verify:` recipe instead (read `pom.xml`, query the
`sonarqube`/`discourse` MCP, or WebFetch the dev wiki — the upstream source of truth).

OKF map (topic files under `okf/`, described in `okf/index.md`):

- `okf/conventions/` — `code-style`, `code-comments`, `commit-messages`, `versioning`,
  `backward-compatibility`, `security`, `performance`, `logging`,
  `naming` (Maven groupId/artifactId + `-api`/`-ui`/`-webjar`/`-node-*`/`-test*` qualifiers, npm
  packages, `xwiki.properties` properties, UIXP/UIX ids, skins/icons), `frontend` (JavaScript as
  `xwiki-`-prefixed AMD modules in WebJars/JSX, never inline; the Velocity-in-minified-JS trap;
  `compatibility.js`; WCAG 2.2 AA), `translations` (key lifecycle: en_US only, registering a new
  bundle, deprecating/renaming a key, never moving one), `dependencies` (the checklist a new
  third-party dependency must pass), `documentation` (xwiki.org doc rules —
  Diataxis, titles, the **result step** closing a How-to/Tutorial and a **screenshot on most steps** of
  a UI procedure, **show don't only tell** (screenshots
  for User/Admin, code examples for Developer, diagrams for Explanations — without forcing it),
  page granularity incl. **low verbosity** and
  a hub page routing rather than narrating + how cross-page duplication is detected, page structure incl.
  Highlights/More/Related semantics, style incl. **never hard-wrapping prose** (one paragraph = one
  unbroken line, on xwiki.org pages and forum posts alike; 120 chars is a Java-source rule),
  attachments/images/videos (`{{image}}` needs a mandatory
  `size` in the `documentation` space, `caption` is never the capture version, the red box is an
  overlay not an `outline`, `webm` + the `{{embed}}` macro),
  **placement confirmed with the developer up front as concrete trees**, versioning + the `{{version}}`
  macro incl. documenting a feature ahead of its release, XWiki syntax traps (incl. the links that must
  stay absolute URLs, and preserving a heading's anchor id across a rename), navigation pinning;
  applied by `xwiki-doc-writing` / `xwiki-doc-convert`), `documentation-migration`
  (migration only: handling the original page — stripping its prose, deleting its leftover
  attachments, triaging its backlinks), `page-deletion` (**before deleting ANY page on xwiki.org —
  including an intermediate page you created yourself — list and fix its backlinks**: the delete
  wizard only repoints them if given a "New target" + "Update links", never over REST, and never for
  absolute-URL links — which the Information-tab Backlinks list does not show either),
  `documentation-mechanics`
  (the storage side: the `DocApp` xobjects — incl. the separate `LandingPageClass` that makes a
  `DocumentationClass` sweep skip every landing page — reading the doc-quality checker's findings —
  objects *and* the inline error boxes that create none — how pinning and hidden `{{display}}` fragments
  are stored).
- `okf/architecture/` — `component-system`, `macro-refactoring`, `wiki-user-scope`, `solr-search`.
- `okf/testing/` — `strategy`.
- `okf/sonarqube/` — which SonarCloud fixes are *correct* in XWiki and which look mechanical but
  silently break something. Read `sonarqube/index.md` (rule → file map, the rules never worth fixing,
  the universal drop conditions), then **only** the family file for the rule at hand: `syntax-rules`,
  `simplification-rules`, `modernization-rules`, `dead-code-rules`, `constant-and-resource-rules`,
  `test-code-rules`; plus `verification` (never skip the tests, `-Plegacy,quality`, why removing
  covered instructions always lowers a JaCoCo ratio). Pool sizes are volatile and deliberately absent.
  Applied by the `xwiki-fix-sonarqube-issue` skill, which owns the procedure.
- `okf/servers/` — `index` (JIRA, CI, Nexus, SonarCloud, forum… and how to access/verify each, plus
  writing via REST: only `/rest` honors Basic auth, the `XWiki-Form-Token` CSRF header, the
  `extensions` subwiki id);
  `jira` (jira.xwiki.org access via jira-cli/REST + issue-field conventions + resolving/closing conventions + wiki-markup gotchas — see the `xwiki-jira` skill);
  `jenkins` (query ci.xwiki.org via the Jenkins REST API `/api/json?tree=…` rather than scraping the
  UI — endpoints for failing tests, changesets, built SHA and artifacts; the Cloudflare trap where a
  spoofed browser User-Agent 403s and plain `curl` succeeds; `FAILURE` vs `UNSTABLE`; and why a test
  case's `age` is not a reliable first-failure).
- `okf/processes/` — `release`, `security-policy` (incl. merging a security PR by hand from the
  advisory's private fork), `module-lifecycle` (`git subtree` extract/merge-in, retiring to the Attic,
  top-level extensions).
- `okf/decisions/` — ADRs (the *why* behind durable architectural choices).

**Capturing learnings:** when a task relies on or fetches a durable, generic XWiki fact whose topic
is absent from (or contradicts) the map above, or the developer corrects you on a convention or
architecture point, **proactively offer** to capture it via the `xwiki-knowledge` EXTEND flow
(reviewed PR only — never a silent or private write). Stay silent for trivial, personal, secret,
session-specific, or already-present facts.
