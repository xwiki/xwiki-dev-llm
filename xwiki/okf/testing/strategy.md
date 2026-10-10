---
title: XWiki testing strategy (overview)
stability: durable
summary: The kinds of tests XWiki uses, their naming, the no-stdout rule, the prefer-the-lightest-base
  rule, the assertion rule (JUnit 5 where it fits, Hamcrest assertThat where it reports better), the
  scenario rule (no two @Test methods build the same fixture, a distinct fixture is what justifies a
  distinct method, and @Order is how methods share one), @Order on every @UITest method, the
  page-object boundary (a test holds no HTML/JS knowledge: no getDriver(), selector or WebElement),
  page-object actions (and reads after input) that wait for their own outcome,
  the don't-pay-the-timeout rule, expected console output, TestReference, configuration cleanup, no
  volume mapping (DOOD), the wiki descriptor target, how to read a PRChecker log line and how to grant
  Programming Rights to a test's own content, asserting whose rights code runs with, the assertion channel
  (browser vs REST), the bare @UITest on an AllIT container, the functional-test module layout
  (which pom lists which module under which profile, the -test-docker pom), getting a mandatory class in an
  @OldcoreTest, MockitoOldcore's save authors, mocking a raw injected Provider, coverage, and where
  each test framework lives. Procedures live in the test skills.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/JavaUnitTesting/#HBestpractices
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HBestPractices
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
  with `-Dxwiki.surefire.captureconsole.skip=true` only when justified. A functional test's console
  is validated too: output it provokes on purpose is declared with `registerExpected(...)` on an
  injected `LogCaptureConfiguration`; an unexpected error is fixed, `registerExcludes(...)` being
  technical debt.
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HStdout2Fstderrvalidationerrors)
- **Prefer the lightest base that works** — use `@ComponentTest` rather than `@OldcoreTest` when
  oldcore is not required.
- **Assertions: the JUnit 5 one where it fits, Hamcrest `assertThat` where it reports better** —
  JUnit 5 has no substring or collection matcher, and `assertTrue(content.contains(x))` fails with
  `expected: <true> but was: <false>`, never showing `content`, where
  `assertThat(content, containsString(x))` prints it. It runs the other way too: `assertThat(a,
  equalTo(b))` has a good JUnit 5 equivalent and belongs as `assertEquals(b, a)`. A message that
  restates the matcher is then noise — keep one only where it says something the matcher does not,
  as `assertThat(reason, actual, matcher)`.
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/JavaUnitTesting/#HBestpractices)
- **A functional test is a scenario, not a unit test — never pay for the same fixture twice** — a
  `*IT` pays a wiki start, a browser start and a page load per navigation, so what drives its runtime
  is the number of *fixtures*, not the number of assertions. Write scenarios: a method builds its
  fixture once and asserts the successive states that fixture goes through, rather than one method
  per assertion as in a unit test. The operative rule is **no two methods building the same
  fixture** — before adding a `@Test`, if a method in the class already builds the fixture your
  assertion needs, add the assertion there or in a method ordered after it; before adding a new
  `*IT` class, look for an existing `*IT` covering the same feature and extend it. It is **not**
  "always a single method": a method nobody can follow end to end, or one whose failure no longer
  says which behaviour broke, has been merged too far. **A distinct fixture justifies a distinct
  method; a merely distinct assertion does not** — that is the line, and readability decides what
  happens on the fixture-sharing side of it.
  **`@Order` is how methods share a fixture** — the methods of a `@UITest` class run against the
  same instance, so a later method may rely on what an earlier one left behind; that is the point of
  ordering them, since rebuilding a fixture per method is what makes functional tests slow. The
  exception is a fixture that is cheap to build: a method may then build it itself, so it can be run
  on its own when debugging.
  Whatever is fixture rather than subject is built with `TestUtils` (`createPage`, `createUser`,
  `loginAsSuperAdmin`, REST), never by driving the UI as a user would.
  A page the test needs is named by an injected `TestReference` parameter, not hardcoded.
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HScenarios,
  https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HTestReference)
- **A test knows nothing of the HTML or JavaScript — the page-object boundary** — a functional test
  (`*IT.java`) drives *and inspects* the UI only through page objects, in the user's terms. Any
  knowledge of the markup or scripts in the test class — `getDriver()`, a `By`, a CSS selector or
  XPath, a CSS class or DOM attribute value, a `WebElement`, `executeScript`, `getCssValue()` —
  means **an API is missing from a page object somewhere** — add it there, then call it from the
  test. That includes a selector handed *to* a page-object method
  (`viewPage.contentContainsElement(By.cssSelector(".box.infomessage"))` → a method that says what
  the user sees) and a DOM identifier passed as a plain string (a category's `data-*` value rather
  than its label or an enum). Visible text, keyboard input and the wiki syntax of the source
  (including a macro parameter name) are what the user sees, so they stay in the test; a page-object
  getter of text decides whether screen-reader-only labels (`sr-only`) are part of it and says so.
  Which page object gets the new API follows from what a page object *is*: **a page object represents
  a real XWiki page and the actions that can be performed on that page** — a component shown on many
  pages (a message box, a suggest input) gets a reusable `*Element` returned by those pages. So widen
  or add the method on the existing page object for the page under test — widening an
  already-private helper to public counts — and do not create a page object for a page the test
  itself creates as a fixture, which is not a real XWiki page. What is specific to the
  test, such as the wiki content it gives that fixture page, likewise stays in the test.
  **Such calls already in the test class are not a precedent** — most classes predate the rule, so
  matching the surrounding code is exactly what breaks it. New code complies, and a method edited for
  any other reason is the moment to move its calls behind a page object.
- **A page-object action waits for its own outcome** — a page-object method that acts (click, insert,
  submit, open, select) returns only once the UI is in the state that action produces: the dialog
  open or closed, the menu closed, the button toggled, the macro rendered, the list filtered. A read
  that follows input waits for the result of that input, not a stale one (suggestions after typing).
  A wait in the test right after a page-object call belongs in that method. A page object shared by
  several callers is handed the wait by the one that opens it (`MacroDialogEditModal` gets its
  editor's content refresh to run on submit). The test keeps only the waits no page object can know,
  such as content specific to the test, and a wait that *is* the check (a query selects a given item).
- **Assert through the channel that matches what is checked** — what the *user* sees (rendered
  content, an error message, an image, a button's state) goes through the browser and page objects
  (`ViewPage#getContent`, `BasePage#hasRenderingError`); data no user looks at in the UI (a
  document's authors, a REST resource) goes through `setup.rest()` or `TestUtils#getString`, which
  skip the page load. `executeAndGetBodyAsString` is not that shortcut: it drives the browser too.
  `ViewPage` (`BasePage`) already waits for the window `load` event and every pending request, so
  images in the content are loaded — don't add a wait of your own for that.
- **Don't pay the timeout (Docker functional tests)** — never wait on a timer (`Thread.sleep()`),
  and never burn the full Selenium wait timeout waiting for something that will not appear. The waiting APIs (`findElement`, `findElements`, and
  the `waitUntil…` helpers) are for elements *expected to be present*; to assert an element's
  absence, or to look without blocking, use `findElementWithoutWaiting()`,
  `hasElementWithoutWaiting()` or `waitUntilElementDisappears()` instead. Since XWiki 18.6.0 a
  wasteful wait logs an `org.xwiki.test.ui.XWikiWebDriver - The currently running test wasted [N] ms
  waiting for element …` WARN, with a stack trace (`warnIfWastefulWait`) pointing at the offending
  `findElement*` call — treat any such warning for the test/page-objects you are touching as a defect
  to fix (fix the page object doing the wait, not just the test). A warning charged to an unrelated,
  untouched test is out of scope for your change — just report it.
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HDon27tpaythetimeout)
- **Cleanup only where other domains' tests follow** — a test that changes existing configuration
  (default language, rights, …) restores it only if it also runs among other domains' tests (flavor
  tests); a module's own `-test-docker` skips that cleanup to save time. Created pages need not be
  deleted.
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HConfigurationandCleanup)
- **No volume mapping in a test's own containers** — CI builds inside a Docker agent whose containers
  run beside it (Docker out of Docker), so a host path is not the agent's. Copy files in and out (`withCopyFileToContainer(MountableFile.forHostPath(…), …)`,
  `copyFileFromContainer`).
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HDockeroutofDocker)
- **A URL generated outside a request uses the wiki descriptor** (XWiki 18.8.0+) — a scheduler mail
  or a reset-password link takes its host/port from the main wiki descriptor, which the framework
  points at the browser's address. Change it for the whole instance with the `wikiDescriptorTarget`
  `@UITest` option (one value per `AllIT`; `-Dxwiki.test.ui.wikiDescriptorTarget=http_client`), for
  one test with `@UseWikiDescriptorTarget` (the closest declaration wins), or to any value with
  `TestUtils.setMainWikiDescriptorTarget()`, which needs no restoring.
  (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HWikiDescriptorTarget)
- **A `PRChecker` log line reports a probe, not a requirement** — functional tests run with
  `ProgrammingRightCheckerAuthorizationManager` (`xwiki-platform-test-checker`), which overrides the
  authorization manager so that wiki content never obtains Programming Right, and logs
  `PRChecker: Block programming right for page [X]`. It fires whenever *any* code evaluates the
  Programming Right while `X` is the context's secure document (`sdoc`) — including callers that merely
  probe to choose between a privileged and an unprivileged branch and behave correctly on the latter.
  The line therefore means "the right was asked for here and denied", **not** "`X` requires
  Programming Right". Before treating one as a defect, locate the actual call and check whether the
  denied branch is harmful. Each secure document is logged only once per instance, so one line can hide
  further probes from the same page. Conversely, when content **your own test creates** needs the right
  — a `{{groovy}}` macro rendering `You need Programming Rights to execute the script macro [groovy]`,
  a sheet silently taking its unprivileged branch — allowlist its page on the test class, which really
  grants the right (and logs `PRChecker: Skipping check for [X] since it's excluded`):
  `@UITest(properties = {"xwikiPropertiesAdditionalProperties=test.prchecker.excludePattern=.*:MySpace\\.MyPage"})`.
  The regex must match the **whole** serialized reference, wiki included (`xwiki:Space.Page`); the
  patterns of several merged `@UITest`s are OR-ed together. A pattern anchored on the test class's
  own name must allow a prefix (`.*:.*MyIT\..*`), because `TestReference` names the page after the
  *running* class's simple name — `NestedMyIT` once the test runs inside an `AllIT`, which is how CI
  runs it.
- **Asserting whose rights code runs with — use Script Right, not Programming Right** — to check
  in a functional test that some stored code runs with the rights of the right author (not a more
  privileged author's), have the unprivileged author's code output a value that only executed
  Velocity produces (`#set ($x = 'EXEC')${x}UTED`) and assert it is absent. Standard users lack
  Script Right on XWiki 14.10+, so the assertion fails as soon as the code runs with a privileged
  author's rights. A Programming Right check proves nothing here: PRChecker (above) denies
  Programming Right to all wiki content, so the test passes with the bug still in.
- **An `AllIT` container class carries a bare `@UITest`** — the Docker framework resolves the
  `@UITest` of the container class **and of every nested class** (walking each nested class's
  superclass chain) and merges them all into one configuration
  (`ExtensionContextTestConfigurationResolver`). So `properties`, `extraJARs` and the rest declared
  on an individual `*IT` class already apply when it runs nested: repeating them on the container is
  redundant, and repeating a scalar (`browser`, `database`, `servletEngine`, …) that a nested class
  also sets aborts the run with a `DockerTestException` as soon as the two values differ. **Every
  nested test class carries its own `@UITest` too**, bare or with the configuration it needs.
  `xwiki-platform-rest-test-docker` deliberately leaves its classes unannotated: an exception, not a
  template.
- **Every functional test method carries `@Order`, in source order** — give each `@Test` of a
  `@UITest` class an `@Order(n)`, even when it is the only one, so the next method added gets
  `@Order(n+1)` rather than none. `@UITest` uses `MethodOrderer.OrderAnnotation`, under which methods
  without `@Order` run in an order JUnit leaves unspecified. Keep the source order of the methods
  aligned with their `@Order` values, and place a new method according to its value rather than
  appending it. (https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HScenarios)
- **A mandatory class in an `@OldcoreTest`** — to get a real XClass from its
  `MandatoryDocumentInitializer` (rather than mocking `BaseObject`s), list the initializer in
  `@ComponentList` and call `oldcore.getSpyXWiki().initializeMandatoryDocuments(context)` in the
  setup; `MockitoOldcore` does not run it on its own. The initializer then needs mocks of
  `ObservationManager`, `JobProgressManager`, `SheetBinder` named `document` and
  `ContextualLocalizationManager` (`DefaultIOServiceTest` in xwiki-platform-annotation-io and
  `UpdatedDocumentMentionsAnalyzerTest` follow this pattern).
- **`MockitoOldcore`'s save sets authors like the real store** — it sets the content author to the
  effective metadata author only when the content is dirty. A change made only through objects
  dirties the metadata, so after one user saves a page and another modifies its objects, the content
  author is still the first user and only the metadata author is the second.
- **`@MockComponent` and an injected raw `Provider`** — a component injecting
  `Provider<SomeComponent>` (raw type) looks up the raw role, so a mock declared as
  `@MockComponent SomeComponent<?> mock` (a parameterized role) is not what the provider returns:
  `@InjectMockComponents` silently creates another mock for the raw role. Declare the mock with the
  raw type (`@SuppressWarnings("rawtypes") @MockComponent SomeComponent mock`), and the automatically
  injected provider returns it.
- **Coverage** — keep a module's coverage current by running the `xwiki-increase-test-coverage`
  skill as part of any unit-test change: it raises the module pom's `xwiki.jacoco.instructionRatio`
  when the achieved ratio has grown, and otherwise guides adding the missing tests. (The mvn command
  lives in the skill.)

## Functional-test module layout

**Follow these conventions even if the examples you find don't** — many modules predate one rule or
another, and copying the nearest example is how the deviations spread.

A feature's functional tests live in that feature's own test modules, created next to it when it
has none yet — not in an unrelated module because it already exists
(`xwiki-platform-flamingo-skin-test-docker` in particular is already far too big).

```
xwiki-platform-<feature>/
  pom.xml                       ← lists -test only under the integration-tests profile
  xwiki-platform-<feature>-test/
    pom.xml                     ← packaging pom; -test-pageobjects in <modules>, -test-docker under docker
    xwiki-platform-<feature>-test-pageobjects/   ← jar on xwiki-platform-test-ui; only when a page object is needed
    xwiki-platform-<feature>-test-docker/
      src/test/it/…/{AllIT,FeatureIT}.java
      src/test/resources/…      ← optional (XAR packages, …)
      src/test/webapp/…         ← optional files overlaid onto the test WAR
```

- **The `-test` parent** sets `xwiki.revapi.skip` and `xwiki.checkstyle.skip` to `true`: test
  modules are not API.
- **The `-test-docker` pom** — `jar` packaging, `<testSourceDirectory>src/test/it</testSourceDirectory>`,
  `maven-failsafe-plugin` declared in `<build><plugins>`, `xwiki.surefire.captureconsole.skip` set to
  `true`, test-scoped dependencies on `xwiki-platform-test-docker` and the feature's
  `-test-pageobjects`, the modules under test as ordinary runtime dependencies (the framework
  installs them as extensions; `extraJARs` is a last resort), and the `clover` profile copied from a
  sibling module.
- **`AllIT`** is the only class failsafe runs (`**/AllIT.java`, set by the `xwiki-commons` parent):
  it lists every test class as a `@Nested` subclass so XWiki starts once. `@UITest` placement: the
  `AllIT` rule above.
- **`@since`** goes on page objects, never on test classes: `conventions/versioning.md`.

## Where the test frameworks live (per repo checkout)

- **Simple + component-based** framework: `xwiki-commons` →
  `xwiki-commons-tools/xwiki-commons-tool-test`.
- **Rendering** test framework: `xwiki-rendering` → `xwiki-rendering-test`.
- **Oldcore + Docker + page-test** frameworks: `xwiki-platform` →
  `xwiki-platform-core/xwiki-platform-test`.

The authoritative, evolving strategy (with sub-pages for Java unit testing, view/page testing and
Docker testing) is on the dev wiki — prefer it when a detail matters:
https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
