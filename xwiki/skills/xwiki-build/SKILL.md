---
name: xwiki-build
description: Build and test XWiki Maven modules. Use when building XWiki, running its tests, or when the user mentions mvn, a build, a failing test, or a specific XWiki module.
---

# Building and testing XWiki

XWiki is a multi-module Maven project. Almost every build needs the `legacy` profile.

**Always start with `clean`** (`mvn clean <goal>`). XWiki builds leave generated artifacts and
per-module state behind, and stale `target/` (and locally-installed SNAPSHOTs) cause confusing,
hard-to-diagnose failures.

## Full build (fast, unit tests only — no integration tests)

```bash
mvn clean install -Plegacy,snapshot \
  -Dxwiki.checkstyle.skip=true -Dxwiki.surefire.captureconsole.skip=true \
  -Dxwiki.revapi.skip=true
```

Without the `integration-tests` profile, `*IT.java` tests don't run. To include integration tests,
add `-Pintegration-tests` (and `-Pdocker` for the Docker-based ITs). `-DskipITs` skips ITs while
keeping unit tests; `-DskipTests` skips all tests.

## Build a single module

```bash
mvn clean install -pl <module-path> -Plegacy,snapshot
```

For example in xwiki-platform: `-pl xwiki-platform-core/xwiki-platform-<module>`.

## Run tests

```bash
# All unit tests in a module
mvn test -pl <module-path>

# A single test class
mvn test -pl <module-path> -Dtest=MyTestClass

# A single test method
mvn test -pl <module-path> -Dtest=MyTestClass#myMethod

# Integration tests
mvn verify -pl <module-path> -Pintegration-tests
```

## Notes

- The `legacy` profile activates backward-compatibility shim modules and is almost always required.
- The `snapshot` profile enables XWiki snapshot repositories.
- Skip flags worth knowing: `-Dxwiki.checkstyle.skip=true` (Checkstyle),
  `-Dxwiki.revapi.skip=true` (API compat), `-Dxwiki.surefire.captureconsole.skip=true`
  (stdout capture check).
- Checkstyle and Revapi run in the `verify` phase (not `test`), so `mvn test` won't catch them —
  use `mvn clean verify` or `install` to validate.
