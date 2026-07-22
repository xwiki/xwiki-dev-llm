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

- Prefix the summary with the JIRA issue key when there is one: `XWIKI-12345: <summary>` (use the
  repo's own key — `XCOMMONS-…`, `XRENDERING-…`, etc.). Use `[Misc]` when there is no issue.

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
  `backward-compatibility`, `security`, `performance`.
- `okf/architecture/` — `component-system`, `macro-refactoring`, `wiki-user-scope`, `data-migrations`.
- `okf/testing/` — `strategy`, `data-migration-validation`.
- `okf/servers/` — `index` (JIRA, CI, Nexus, SonarCloud, forum… and how to access/verify each);
  `jira` (jira.xwiki.org access via jira-cli/REST + issue-field conventions + resolving/closing conventions + wiki-markup gotchas — see the `xwiki-jira` skill).
- `okf/processes/` — `release`, `security-policy`.
- `okf/decisions/` — ADRs (the *why* behind durable architectural choices).

**Capturing learnings:** when a task relies on or fetches a durable, generic XWiki fact whose topic
is absent from (or contradicts) the map above, or the developer corrects you on a convention or
architecture point, **proactively offer** to capture it via the `xwiki-knowledge` EXTEND flow
(reviewed PR only — never a silent or private write). Stay silent for trivial, personal, secret,
session-specific, or already-present facts.
