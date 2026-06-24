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
  run `mvn license:format` to add missing headers).
- Use the XWiki **Component system** (`@Component`, `@Inject`, `@Role`, declared in
  `META-INF/components.txt`) rather than passing context objects around in new code.
- The project is **migrating away from `javax.*` in favor of `jakarta.*`**. In new code, prefer the
  `jakarta.*` namespaces — e.g. use `jakarta.inject.*` (not `javax.inject.*`) for `@Inject`,
  `@Named`, `Provider`, etc., and likewise for other migrated `javax`→`jakarta` packages.
- `-legacy` modules only re-export deprecated APIs — never add new logic there, and non-legacy
  modules must not depend on legacy ones.
- Public API changes are checked for binary/source compatibility by **Revapi**.

## Versioning new/deprecated APIs

- For `@since` and `@Deprecated(since = "…")` tags, use the **next release of the actual current
  dev version**, written as `<X.Y.0>RC1` (e.g. `18.5.0RC1`).
- Do **not** trust the version string in a repo's `CLAUDE.md` — it goes stale. Read the real
  version from the root `pom.xml` (`<version>`) or the SNAPSHOT jar names under `~/.m2`.
