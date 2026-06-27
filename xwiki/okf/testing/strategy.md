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
- **Coverage** — after adding tests, check whether the JaCoCo threshold can be raised by running
  `-Pquality -Dxwiki.jacoco.instructionRatio=1.00` (it fails but reports the achievable ratio, which
  you then set as the new threshold).

## Where the test frameworks live (per repo checkout)

- **Simple + component-based** framework: `xwiki-commons` →
  `xwiki-commons-tools/xwiki-commons-tool-test`.
- **Rendering** test framework: `xwiki-rendering` → `xwiki-rendering-test`.
- **Oldcore + Docker + page-test** frameworks: `xwiki-platform` →
  `xwiki-platform-core/xwiki-platform-test`.

The authoritative, evolving strategy (with sub-pages for Java unit testing, view/page testing and
Docker testing) is on the dev wiki — prefer it when a detail matters:
https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
