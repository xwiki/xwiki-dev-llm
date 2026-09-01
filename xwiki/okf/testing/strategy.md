---
title: XWiki testing strategy (overview)
stability: durable
summary: The kinds of tests XWiki uses, their naming, the no-stdout rule, the prefer-the-lightest-base
  rule, the scenario rule (no two @Test methods build the same fixture, a distinct fixture is what
  justifies a distinct method, and @Order is not a substitute), the page-object boundary (no
  getDriver() in a test), the don't-pay-the-timeout rule, how to read a PRChecker log line, the bare @UITest on an AllIT
  container, coverage, and where each test framework lives. Procedures live in the test skills.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HDon27tpaythetimeout
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
- **A functional test is a scenario, not a unit test — never pay for the same fixture twice** — a
  `*IT` pays a wiki start, a browser start and a page load per navigation, so what drives its runtime
  is the number of *fixtures*, not the number of assertions. Write scenarios: a method builds its
  fixture once and asserts the successive states that fixture goes through, rather than one method
  per assertion as in a unit test. The operative rule is **no two methods building the same
  fixture** — before adding a `@Test`, if a method in the class already builds the fixture your
  assertion needs, add the assertion there; before adding a new `*IT` class, look for an existing
  `*IT` covering the same feature and extend it. It is **not** "always a single method": a method
  nobody can follow end to end, or one whose failure no longer says which behaviour broke, has been
  merged too far. **A distinct fixture justifies a distinct method; a merely distinct assertion does
  not** — that is the line, and readability decides what happens on the fixture-sharing side of it.
  **`@Order` is not a substitute** — it fixes execution order only, it does not share a fixture, and
  making methods depend on each other's leftover state makes them impossible to run in isolation;
  sharing a fixture across methods needs
  `@TestInstance(PER_CLASS)` plus shared state, which is rarely worth it below a handful of methods.
  Whatever is fixture rather than subject is built with `TestUtils` (`createPage`, `createUser`,
  `loginAsSuperAdmin`, REST), never by driving the UI as a user would.
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/#HBestPractices)
- **No `getDriver()` in a test — the page-object boundary** — a functional test (`*IT.java`) drives
  the UI only through page objects. Needing `getDriver()` in the test class (or a raw `findElement`,
  `By` lookup or `getCssValue()` on top of it) means **an API is missing from a page object
  somewhere** — add it there, then call it from the test. Which page object gets it follows from what
  a page object *is*: **a page object represents a real XWiki page and the actions that can be
  performed on that page.** So widen or add the method on the existing page object for the page under
  test — widening an already-private helper to public counts — and do not create a page object for a
  page the test itself creates as a fixture, which is not a real XWiki page. What is specific to the
  test, such as the wiki content it gives that fixture page, likewise stays in the test.
- **Don't pay the timeout (Docker functional tests)** — a test must never burn the full Selenium
  wait timeout waiting for something that will not appear. The waiting APIs (`findElement`,
  `findElements`, and the `waitUntil…` helpers) are for elements *expected to be present*; to assert
  an element's absence, or to look without blocking, use `findElementWithoutWaiting()`,
  `hasElementWithoutWaiting()` or `waitUntilElementDisappears()` instead. Since XWiki 18.6.0 a
  wasteful wait logs an `org.xwiki.test.ui.XWikiWebDriver - The currently running test wasted [N] ms
  waiting for element …` WARN, with a stack trace (`warnIfWastefulWait`) pointing at the offending
  `findElement*` call — treat any such warning for the test/page-objects you are touching as a defect
  to fix (fix the page object doing the wait, not just the test). A warning charged to an unrelated,
  untouched test is out of scope for your change — just report it.
- **A `PRChecker` log line reports a probe, not a requirement** — functional tests run with
  `ProgrammingRightCheckerAuthorizationManager` (`xwiki-platform-test-checker`), which overrides the
  authorization manager so that wiki content never obtains Programming Right, and logs
  `PRChecker: Block programming right for page [X]`. It fires whenever *any* code evaluates the
  Programming Right while `X` is the context's secure document (`sdoc`) — including callers that merely
  ask in order to choose between a privileged and a non-privileged branch and that behave correctly on
  the latter. The line therefore means "the right was asked for here and denied", **not** "`X` requires
  Programming Right". Before treating one as a defect, locate the actual call and check whether the
  denied branch is harmful. Each secure document is logged only once per instance, so one line can hide
  further probes from the same page. A page that legitimately needs the right is allowlisted with the
  `test.prchecker.excludePattern` property (a regex matched against the serialized secure-document
  reference), which logs `PRChecker: Skipping check for [X] since it's excluded` instead.
- **An `AllIT` container class carries a bare `@UITest`** — the Docker framework resolves the
  `@UITest` of the container class **and of every nested class** (walking each nested class's
  superclass chain) and merges them all into one configuration
  (`ExtensionContextTestConfigurationResolver`). So `properties`, `extraJARs` and the rest declared
  on an individual `*IT` class already apply when it runs nested: repeating them on the container is
  redundant, and repeating a scalar (`browser`, `database`, `servletEngine`, …) that a nested class
  also sets aborts the run with a `DockerTestException` as soon as the two values differ.
- **Test method order matches `@Order`** — in a test class that orders its methods with `@Order(n)`,
  keep the physical (source) order of the `@Test` methods aligned with their `@Order` values (1, 2,
  3 …) so the file reads in execution order. When adding a new test, place it according to its
  `@Order` value rather than simply appending it at the end.
- **Coverage** — keep a module's coverage current by running the `xwiki-increase-test-coverage`
  skill as part of any unit-test change: it raises the module pom's `xwiki.jacoco.instructionRatio`
  when the achieved ratio has grown, and otherwise guides adding the missing tests. (The mvn command
  lives in the skill.)

## Where the test frameworks live (per repo checkout)

- **Simple + component-based** framework: `xwiki-commons` →
  `xwiki-commons-tools/xwiki-commons-tool-test`.
- **Rendering** test framework: `xwiki-rendering` → `xwiki-rendering-test`.
- **Oldcore + Docker + page-test** frameworks: `xwiki-platform` →
  `xwiki-platform-core/xwiki-platform-test`.

The authoritative, evolving strategy (with sub-pages for Java unit testing, view/page testing and
Docker testing) is on the dev wiki — prefer it when a detail matters:
https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
