---
title: Writing a unit test with XWiki's test frameworks — temp dirs, setup order, mocked Providers, logs
stability: durable
summary: The XWiki JUnit 5 test framework mechanics a model cannot guess. A scratch directory is
  @XWikiTempDir, never @TempDir. A per-test @BeforeComponent("<test>") runs before initialize(), in a
  fixed annotation order. A mocked component the code's Provider does not return means fixing the
  Provider. Every captured log must be asserted, initialize() logs from a static extension in
  @AfterAll, one per test.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/JavaUnitTesting/
provenance: official
last-confirmed: 2026-11-14
related: [testing/strategy.md, testing/test-value.md, architecture/component-system.md]
applies-to: ["**/src/test/java/**/*.java"]
---

# Writing a unit test with XWiki's test frameworks

What `@ComponentTest` and `@OldcoreTest` do that their annotations do not show. Which test
to write is [[strategy]] and [[test-value]]; converting an old test is the `xwiki-convert-tests` skill.
Where this file and the dev.xwiki.org testing pages disagree, it follows the code
(`xwiki-commons-tool-test`).

## A scratch directory: `@XWikiTempDir`, never `@TempDir`

Neither the system temp directory nor JUnit 5's `@TempDir` (which uses it): data left in a shared
location makes other tests fail, and Jenkins errors on files a test creates or removes outside the
workspace. Annotate a
`File` with `@XWikiTempDir` for a fresh directory under the module's `target/`: a **static** field
gets one per class, an instance field one per test, a test-method parameter one for that test. It is
active under `@ComponentTest` and `@OldcoreTest`, elsewhere with `@ExtendWith(XWikiTempDirExtension.class)`.

## Setup for one test before `initialize()`

The component manager and the `@InjectMockComponents` component are rebuilt for **each test**, in
this order: `@InjectComponentManager` fields, `@MockComponent` fields, `@BeforeComponent` methods,
`@AllComponents` / `@ComponentList`, `@AfterComponent` methods, `@InjectMockComponents` fields (an
`Initializable` is initialized here), `@Inject` fields, then Mockito's `@Mock` / `@InjectMocks`.
So stub what `initialize()` reads in a `@BeforeComponent`, on `@MockComponent` fields, never on `@Mock`
ones. For one test's own fixture, `@BeforeComponent("<testMethodName>")` runs only
before that test, after the unnamed ones; `@AfterComponent("<testMethodName>")` exists too.

## A mocked component that the code's `Provider` does not return

When the code's `Provider` asks for a role other than the one a `@MockComponent` registered,
`@InjectMockComponents` silently mocked the role the provider asks for: fix the provider in the
production code ([[component-system]]), not the mock's type.

## Every captured log must be asserted

`LogCaptureExtension` fails the test with `Following messages must be asserted: […]` for each message
at or above its level that the test did not read (`getMessage(i)` / `getLogEvent(i)`). A message
logged by `initialize()` or in `@BeforeAll` is emitted before an instance-field extension starts
capturing: register it `static` and assert in a static `@AfterAll`. Under
`@ComponentTest`, `initialize()` runs again before every test, so that `@AfterAll` gets one such
message per test, unless each test asserts its own.
