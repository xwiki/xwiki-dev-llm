# XWiki org-wide conventions

These conventions apply to every repository in the `xwiki` and `xwiki-contrib` GitHub
organizations. They are injected automatically at the start of each session by the `xwiki`
plugin (scoped by git remote). Repo-specific `CLAUDE.md` files add to (and may override) what
follows.

## Project facts

- **Issue tracker:** https://jira.xwiki.org (NOT GitHub Issues). Each repo has its own JIRA project
  key, e.g. `XWIKI` (Platform), `XCOMMONS` (Commons), `XRENDERING` (Rendering), and a per-extension
  key for contrib. Reference issues by their key (e.g. `XWIKI-12345`).
- **Dev guide:** https://dev.xwiki.org/xwiki/bin/view/Community/
- **CI:** https://ci.xwiki.org — build scans on Develocity at https://ge.xwiki.org/scans
- XWiki Commons, XWiki Rendering and XWiki Platform are **released together with the same version**.
- Java version to be used depends on the XWiki version (defined in the pom.xml), as indicated on
  https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/JavaSupportStrategy/#HByXWikiVersions

## Commit messages

- Prefix the summary with the JIRA issue key when there is one: `XWIKI-12345: <summary>`
  (use the repo's own project key — `XCOMMONS-…`, `XRENDERING-…`, etc.).
- Use `[Misc]` as the prefix for changes that have no associated issue.

## Building

For Maven build/test commands — full build, single module, single test, skip flags, and the
`clean`/`verify`-phase gotchas — use the **`xwiki-build`** skill (the canonical reference).

**Always pass `-B -ntp`** (batch mode + no-transfer-progress) on every `mvn` invocation, to suppress
interactive prompts and the download/progress lines that otherwise flood the output.

### Common profiles

Standardized across all XWiki projects — see
https://dev.xwiki.org/xwiki/bin/view/Community/Building/#HUsingProfiles for the full list and
definitions.

| Profile             | Purpose                                                              |
|---------------------|---------------------------------------------------------------------|
| `legacy`            | Includes backward-compatibility (`-legacy`) modules; almost always needed |
| `snapshot`          | Enables XWiki snapshot repositories                                  |
| `integration-tests` | Activates integration-test (`*IT.java`) execution via Failsafe       |
| `docker`            | Runs the Docker-based integration tests (requires Docker installed); used together with `integration-tests` |
| `quality`           | Checkstyle + Revapi + Enforcer checks                                |

## Tests

- Unit test classes end with `*Test.java` (Surefire); integration test classes end with `*IT.java`
  (Failsafe).
- Tests must **not** write to stdout/stderr — enforced by Surefire's `CaptureConsole` listener.
  Skip per-module with `-Dxwiki.surefire.captureconsole.skip=true`.
- Prefer the lightest test base that works: use `@ComponentTest` rather than `@OldcoreTest` when
  oldcore is not required.
- Full testing strategy: https://dev.xwiki.org/xwiki/bin/view/Community/Testing/

## Code conventions

- **Lines must not exceed 120 characters.**
- LGPL license headers are required on every source file (validated by `license-maven-plugin`;
  run `mvn license:format -B -ntp` to add missing headers).
- Use the XWiki **Component system** (`@Component`, `@Inject`, `@Role`, declared in
  `META-INF/components.txt`) rather than passing context objects around in new code.
- The project is **migrating away from `javax.*` in favor of `jakarta.*`**. In new code, prefer the
  `jakarta.*` namespaces — e.g. use `jakarta.inject.*` (not `javax.inject.*`) for `@Inject`,
  `@Named`, `Provider`, etc., and likewise for other migrated `javax`→`jakarta` packages.
- `-legacy` modules only re-export deprecated APIs — never add new logic there, and non-legacy
  modules must not depend on legacy ones.
- Public API changes are checked for binary/source compatibility by **Revapi**.

### Code comments

- Comment about the code as it is *now* and state the real reason inline (the use case, constraint
  or edge case). **Never** justify code by its history ("as it was before", "to keep the old
  behavior") or point to transient external resources (JIRA keys, forum/PR/commit URLs) — those rot.
  Full policy and rationale: `okf/conventions/code-comments.md` (see the OKF map below).

## Versioning new/deprecated APIs

- For `@since` and `@Deprecated(since = "…")` tags, use the **next release of the actual current
  dev version**, written as `<X.Y.0>RC1` (e.g. `18.5.0RC1`).
- Do **not** trust the version string in a repo's `CLAUDE.md` — it goes stale. Read the real
  version from the root `pom.xml` (`<version>`) or the SNAPSHOT jar names under `~/.m2`.

## OKF — how to go deeper

The above are the always-on essentials. Fuller *declarative* knowledge (conventions, architecture,
the dev-server ecosystem, release process) lives in this plugin's **OKF** knowledge base. When a
question is about how XWiki works or what its rules are — rather than performing a task — consult
the OKF; when you learn a durable, generic XWiki fact, propose adding it (via PR). The
`xwiki-knowledge` skill is the entry point for both reading and extending it.

OKF map (files under the plugin's `okf/` directory):

- `okf/conventions/` — `code-style`, `code-comments`, `commit-messages`, `versioning`,
  `backward-compatibility`, `security` (escaping, untrusted input/translations, context-author
  right checks).
- `okf/architecture/` — `component-system` (`@Role`/`@Component`/`components.txt`, `@Inject`).
- `okf/testing/` — `strategy` (test kinds, naming, framework locations; procedures are in the skills).
- `okf/servers/` — `index` (JIRA, CI, Nexus, SonarCloud, forum… and how to access/verify each).
- `okf/processes/` — `release` (version/release orientation; detailed steps are dev-wiki pointers),
  `security-policy` (CVSS-4 severity + the never-disclose-a-vuln-publicly rule).
- `okf/decisions/` — ADRs: the *why* behind durable architectural choices (each grounded in a
  cited source). Record a new ADR when you hit an architectural decision whose rationale is grounded.

**Volatile facts are never cached** in the OKF (current version, build/issue status, role holders):
the relevant file gives a `verify:` recipe instead — read `pom.xml`, query the `sonarqube`/
`discourse` MCP, or WebFetch the dev wiki. The dev wiki (dev.xwiki.org) remains the upstream source
of truth.

### Capturing learnings into the OKF

When you complete a substantive task, consider whether it produced a **durable, generic,
non-obvious** XWiki learning — or whether the developer **corrected you** on an XWiki convention,
architecture point, or an existing OKF/skill statement. If so, **proactively ask** the developer
whether to capture it in the OKF, and on yes run the `xwiki-knowledge` skill's EXTEND flow (gate
checklist → entry or ADR → reviewed PR). Apply the same gate before asking: **stay silent** for
trivial sessions and for anything personal, secret, session-specific, or already present — do not
pester. Shared XWiki knowledge belongs in the OKF (it ships to the whole team via PR), never in a
private/per-machine LLM memory.
