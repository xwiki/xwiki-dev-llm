---
title: XWiki testing strategy (overview)
stability: durable
summary: The kinds of tests XWiki uses, their naming, the no-stdout rule, the prefer-the-lightest-base
  rule, coverage, and where each test framework lives. Procedures live in the test skills.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
---

# XWiki testing strategy (overview)

This is the declarative map of how testing works in XWiki. For **doing** the work, use the skills:

- `xwiki-test-guidelines` — what to do when writing a test (entry point).
- `xwiki-convert-tests` — convert unit tests to JUnit5/Mockito.
- `xwiki-convert-tests-docker` — convert functional IT tests to the Docker `@UITest` framework.
- `xwiki-fix-flickering-docker-test` — stabilise a flaky Docker test.
- `xwiki-increase-test-coverage` — raise a module's unit-test coverage.

## Test kinds and naming

- **Unit tests** — class names end with `*Test.java`, run by Surefire.
- **Integration / functional tests** — class names end with `*IT.java`, run by Failsafe, activated
  by the `integration-tests` profile (Docker-based functional tests also need the `docker` profile).

## Durable rules

- **No stdout/stderr in tests** — enforced by Surefire's `CaptureConsole` listener. Skip per-module
  with `-Dxwiki.surefire.captureconsole.skip=true` only when justified.
- **Prefer the lightest base that works** — use `@ComponentTest` rather than `@OldcoreTest` when
  oldcore is not required.
- **Test method order matches `@Order`** — in a test class that orders its methods with `@Order(n)`,
  keep the physical (source) order of the `@Test` methods aligned with their `@Order` values (1, 2,
  3 …) so the file reads in execution order. When adding a new test, place it according to its
  `@Order` value rather than simply appending it at the end.
- **Coverage** — whenever you add or change unit tests in a module, run the
  `xwiki-increase-test-coverage` skill as part of that change (not as a separate opt-in step). It
  recomputes the module's achieved JaCoCo instruction ratio and, when that ratio has risen above the
  `xwiki.jacoco.instructionRatio` property in the module `pom.xml`, raises the property to lock the
  gain in (otherwise it guides adding the missing tests). Under the hood it uses
  `-Pquality -Dxwiki.jacoco.instructionRatio=0.00` + `jacoco:report` to read the achievable ratio.

## Where the test frameworks live (per repo checkout)

- **Simple + component-based** framework: `xwiki-commons` →
  `xwiki-commons-tools/xwiki-commons-tool-test`.
- **Rendering** test framework: `xwiki-rendering` → `xwiki-rendering-test`.
- **Oldcore + Docker + page-test** frameworks: `xwiki-platform` →
  `xwiki-platform-core/xwiki-platform-test`.

The authoritative, evolving strategy (with sub-pages for Java unit testing, view/page testing and
Docker testing) is on the dev wiki — prefer it when a detail matters:
https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
