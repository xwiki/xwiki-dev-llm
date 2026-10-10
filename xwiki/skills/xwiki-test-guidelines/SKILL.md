---
name: xwiki-test-guidelines
description: Rules and XWiki-specific framework documentation for writing tests. Load it BEFORE creating or
  changing any test — a new test class, a single added @Test/@UITest method in an existing class, or an edit
  to an existing method — and for unit, integration and functional (Docker @UITest) tests alike. "It is only
  one method", "the class already exists" and "this one is simple" are not reasons to skip it — the traps it
  carries (rights granted to the content a test creates, the page-object boundary, waits, ordering) bite the
  smallest additions. For CONVERTING existing tests use xwiki-convert-tests (unit) or xwiki-convert-tests-docker
  (functional); for a flickering test use xwiki-fix-flickering-docker-test.
---

For the declarative testing map — test kinds and naming, the no-stdout rule, the lightest-base rule, coverage, and **where each test framework lives** — see `okf/testing/strategy.md` (via the `xwiki-knowledge` skill). This skill is the *procedure* for writing a test.

When **converting** existing tests (JUnit4/JMock → JUnit5/Mockito), use the `xwiki-convert-tests` skill in addition to this one.

When writing a test:
* Follow the test strategy at https://dev.xwiki.org/xwiki/bin/view/Community/Testing/#HTestingStrategy
* When writing unit tests for Java code, follow https://dev.xwiki.org/xwiki/bin/view/Community/Testing/#HJavaUnitTesting
* When writing unit tests for code using XWiki Rendering (like rendering macros), follow https://rendering.xwiki.org/xwiki/bin/view/Main/Extending#HAddingTests
* When writing unit tests for XWiki templates (.vm files) or XWiki pages (.xml files representing a wiki page), follow https://dev.xwiki.org/xwiki/bin/view/Community/Testing/ViewUnitTesting/
* When writing a functional test, follow https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/
* Before writing a functional test, check whether an existing `*IT` — or an existing `@Test` method inside it — already builds the fixture you need, and extend that instead of adding a new one: a functional test is a scenario, and no two methods should build the same fixture. This is not a licence to merge everything into one unreadable method — a distinct fixture justifies a distinct method, a merely distinct assertion does not. Methods share a fixture through `@Order`: a later method may rely on what an earlier one built, unless the fixture is cheap enough to rebuild so the method can run alone. Give every `@Test` method an `@Order(n)`, numbered in source order, even when there is only one. See the scenario and `@Order` rules in `okf/testing/strategy.md`.
* For functional tests, follow the best practices defined at https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/#HBestPractices (their rules are in `okf/testing/strategy.md`)
* When a functional test needs a test module or page-object module the feature doesn't have yet, lay it out as the "Functional-test module layout" section of `okf/testing/strategy.md` describes — even where the nearest existing module doesn't.
* In a functional test, check what a user sees through page objects and other data through REST or `TestUtils#getString` — `executeAndGetBodyAsString` drives the browser too (see the assertion-channel rule in `okf/testing/strategy.md`).
* In a functional test, the test class knows nothing of the HTML or JavaScript: no `getDriver()`, `By`/selector, CSS class, DOM attribute value, `WebElement` or `executeScript` — not even handed to a page-object method (`contentContainsElement(By.cssSelector(...))`). If you need one, an API is missing from a page object; add it there, in the user's terms, and call that instead (see the page-object boundary rule in `okf/testing/strategy.md`).
* A page-object method waits for its own outcome, so the test needs no `waitUntil…` after calling it; a wait there belongs in that method (page-object rules in `okf/testing/strategy.md`).
* For other types of tests, see https://dev.xwiki.org/xwiki/bin/view/Community/Testing/ which has sections for other types
* After writing a test, use Maven to verify that any test written works fine. However, if the test is a functional test, ask before executing Maven since there could be an already running XWiki instance locally on the developer's machine, and the test is supposed to start one too. The `xwiki-build` skill has the pre-run checks (port 8080, JDK on `PATH`).
* Apply XWiki's general code best practices and code style when writing tests.
* Don't use @OldcoreTest when @ComponentTest is enough.
* Verify if the jacoco coverage threshold cannot be increased after tests have been added, by running maven with `-Pquality -Dxwiki.jacoco.instructionRatio=1.00` which should fail but provide the current threshold value that can then be used to replace the current value.

For where each XWiki test framework lives in the source tree (commons/rendering/platform), see `okf/testing/strategy.md`.
