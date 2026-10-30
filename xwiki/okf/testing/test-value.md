---
title: Writing a test worth having — level, outcome assertions, mocks
stability: durable
summary: Which level a change's test belongs at (unit, oldcore/page, rendering, functional) by the
  kind of code changed, asserting outcomes rather than calls, when verify() is legitimate, the
  signals that a unit test is working around a design problem, what needs no test of its own, and
  why coverage is never the reason for a test.
sources:
  - https://abseil.io/resources/swe-book/html/ch12.html
  - https://abseil.io/resources/swe-book/html/ch13.html
  - https://kentbeck.github.io/TestDesiderata/
  - http://xunitpatterns.com/Fragile%20Test.html
  - https://enterprisecraftsmanship.com/posts/when-to-mock/
  - https://martinfowler.com/bliki/TestCoverage.html
---

# Writing a test worth having

[[strategy]] requires a test with every change; this topic is what makes that test worth its
maintenance. A test is worth what it catches times how well it survives refactoring (Khorikov, *Unit
Testing Principles, Practices, and Patterns*, ch. 4): one that fails when the code is restructured
without any behaviour change is a *change-detector* (Software Engineering at Google, ch. 13) and costs
more than it protects, however much coverage it adds.

## Pick the level by the kind of code changed

- **Logic** (a parser, a filter or query builder, an escaper, a computation, a rule deciding
  something) — a unit test calling it and asserting what it returns. Feed it the hostile and edge
  inputs; this is where unit tests pay most.
- **Code that loads, changes and saves documents or xobjects** — an `@OldcoreTest` (MockitoOldcore's
  in-memory store) that asserts the stored document, its objects and authors afterwards. Not a
  `@ComponentTest` with mocked `XWikiDocument`/`BaseObject`/`XWiki`, which can only check that `set`
  and `saveDocument` were called.
- **Wiki pages, templates, Velocity** — a page test (`PageTest`) asserting the rendered output; a
  rendering macro — a `.test` rendering test.
- **Orchestration** (a REST resource, a listener, a script service that mostly calls other
  components) — test its contract (status, entity, errors, rights) and the logic it holds; when it
  holds none worth isolating, the functional test of the feature is the test. Don't replay its calls
  with mocks.
- **UI flows and cross-component behaviour** — a functional test ([[strategy]]).
- **Configuration** (a Live Data JSON, a default value, a mapping) — test it where it takes effect,
  never by asserting the value itself.

## Assert outcomes, not calls

Assert what a caller or user can observe: the returned value, the stored state, the rendered output,
the HTTP status and entity, the logged message. `verify()` is legitimate only for:

- an **outgoing command to something outside the code under test** whose effect the test cannot
  observe otherwise — sending a mail, calling a remote API, scheduling a job, firing an event,
  starting an OAuth authorization;
- a **call count or absence that is the requirement** — a cache hit not reaching the backend, a
  refused request performing no write, a check that must not leak whether a page exists.

Never verify a query (a getter, a resolver, `getDocument`, `exists`) — stub it and assert the
result. When what matters is the argument sent to a remote API (the filter of a search), stub the
call with the exact expected argument and assert the output it produces; a mismatch then surfaces as
missing output, so make that assertion readable. A `verify(save…)` next to assertions on the saved state duplicates them; drop it.

Don't mock value objects (`DocumentReference`, `LocalDocumentReference`, model POJOs, connection or
configuration beans with a constructor): build real ones.

## A hard-to-write unit test is design feedback

Stop and reconsider when a unit test needs any of:

- more than about three stubbed collaborators;
- an `ArgumentCaptor` to reach the actual result (the result is only visible as an argument);
- a `doAnswer` simulating a side effect of another component (e.g. a displayer mutating the model);
- `InOrder`, or a `verify` inside an answer;
- reflection to set fields, or mocking a static.

These mean the logic is tangled with plumbing. Prefer extracting the logic into a class or method
whose output can be asserted (the persistence or orchestration left around it becomes thin enough
for an oldcore, page or functional test), or testing at that higher level directly. Extracting
code the change already touches is in its scope; beyond that, say so to the developer rather than
writing the call-replaying test. Don't add an interface or indirection *only* so something can be
mocked. Extracted logic tested on its own doesn't prove its caller still uses it: also check the
caller's output once, at the level where it is visible.

Real components wired with `@ComponentList` instead of stubs cost setup (missing component lists,
test-jar dependencies) but are not "stubbed collaborators". The first `@OldcoreTest` of a module needs
the `xwiki-platform-test-oldcore` test dependency (type `pom`) and, to create xobjects, the
reference component lists (`@ReferenceComponentList`). A legacy plugin reached through
`XWiki#getPluginManager()` (the scheduler) is stubbed on MockitoOldcore's spied `XWiki`.

## What needs no test of its own

Name the reason in the commit or PR instead:

- trivial code — accessors, constructors, pure delegation, wiring, logging;
- a change whose only possible test would replay its implementation with mocks; the behaviour is
  then covered at the level that observes it (often the feature's functional test);
- what an existing test already covers ([[strategy]]);
- a behaviour only a new functional scenario could observe, when that scenario is out of proportion
  to the change (a hardening of a JS URL builder no IT reaches) — the PR names the gap.

Existing mock-heavy tests the change doesn't need to touch are left as they are; one the change does
touch is the moment to move it to the right level.

## Coverage is a floor, not a target

The JaCoCo ratio ([[strategy]]) catches untested code; it doesn't measure whether tests detect bugs
(Fowler, *TestCoverage*: "high coverage numbers are too easy to reach with low quality testing").
Never add a test whose only purpose is the ratio. Replacing a mock-based test by one at the right
level can lower the ratio: the mocks were reaching paths real runs don't — cover the real ones.

When a test's worth is in doubt, mutate the line it is meant to protect: the test must fail. Check
the mutant really changes behaviour (a rewritten compound condition can still hold), and that the
test fails for the right reason: mock defaults (`false`, `null`) make a "denied" test pass whatever
the code checks, so grant in the fixture what the old code checked.
