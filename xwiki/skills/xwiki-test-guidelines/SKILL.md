---
name: xwiki-test-guidelines
description: Best practices, rules and XWiki-specific testing framework documentation for writing tests for the XWiki code base.
---

For the declarative testing map — test kinds and naming, the no-stdout rule, the lightest-base rule, coverage, and **where each test framework lives** — see `okf/testing/strategy.md` (via the `xwiki-knowledge` skill). This skill is the *procedure* for writing a test.

When **converting** existing tests (JUnit4/JMock → JUnit5/Mockito), use the `xwiki-convert-tests` skill in addition to this one.

When writing a test:
* Follow the test strategy at https://dev.xwiki.org/xwiki/bin/view/Community/Testing/#HTestingStrategy
* When writing unit tests for Java code, follow https://dev.xwiki.org/xwiki/bin/view/Community/Testing/#HJavaUnitTesting
* When writing unit tests for code using XWiki Rendering (like rendering macros), follow https://rendering.xwiki.org/xwiki/bin/view/Main/Extending#HAddingTests
* When writing unit tests for XWiki templates (.vm files) or XWiki pages (.xml files representing a wiki page), follow https://dev.xwiki.org/xwiki/bin/view/Community/Testing/ViewUnitTesting/
* When writing a functional test, follow https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/
* For functional tests, follow the best practices defined at https://dev.xwiki.org/xwiki/bin/view/Community/Testing/#HBestPractices but also at https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/
* For other types of tests, see https://dev.xwiki.org/xwiki/bin/view/Community/Testing/ which has sections for other types
* After writing a test, use Maven to verify that any test written works fine. However, if the test is a functional test, ask before executing Maven since there could be an already running XWiki instance locally on the developer's machine, and the test is supposed to start one too.
* Apply XWiki's general code best practices and code style when writing tests.
* Don't use @OldcoreTest when @ComponentTest is enough.
* Verify if the jacoco coverage threshold cannot be increased after tests have been added, by running maven with `-Pquality -Dxwiki.jacoco.instructionRatio=1.00` which should fail but provide the current threshold value that can then be used to replace the current value.

For where each XWiki test framework lives in the source tree (commons/rendering/platform), see `okf/testing/strategy.md`.
