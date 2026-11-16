---
title: Mocking dependencies in TypeScript unit tests with vitest-mock-extended
stability: durable
summary: In xwiki-platform's Node packages, mock a dependency with vitest-mock-extended's typed mock<T>(), never an
  object literal cast with as unknown as T. Use calledWith for argument-specific returns. Give an Inversify
  Container mock a fallbackMockImplementation that throws on an unstubbed id, except on a mock Vue receives as a
  prop or that gets stringified. mockDeep does not reach provider.get().method, so stub get to return a mock.
sources:
  - https://www.xwiki.org/xwiki/bin/view/documentation/xs/dev/front-end/test/mock-dependencies/
  - https://www.npmjs.com/package/vitest-mock-extended
provenance: official
last-confirmed: 2026-11-17
related: [testing/strategy.md, testing/test-value.md, testing/unit-test-framework.md]
applies-to: ["xwiki-platform-core/xwiki-platform-node/src/main/node/**/*.test.ts"]
---

# Mocking dependencies in TypeScript unit tests

For the Vitest tests under `xwiki-platform-core/xwiki-platform-node/src/main/node`. Which test to write
is [[strategy]] and [[test-value]]. The Java tests use the frameworks in [[unit-test-framework]].

Where this file and the mock-dependencies page on xwiki.org disagree, the page wins.

## Typed mocks: `mock<T>()`, no cast

Mock a dependency with `mock<T>()` from `vitest-mock-extended`, or `mock<T>(partialImpl)` to pre-set
members. It returns `MockProxy<T> & T`, so it passes where a `T` is expected with no cast. Do not write
an object-literal stub cast with `as unknown as T`: the cast hides every member the code under test
calls that the stub forgot, where a typed mock fails on a signature that no longer exists.

## Argument-specific returns: `calledWith`

```ts
container.get.calledWith("DocumentService").mockReturnValue(documentService);
```

## Fail on a missing stub: `fallbackMockImplementation` on a `Container`

An unstubbed call on a mock returns `undefined`, and the test then fails later and far from the cause.
Give an Inversify `Container` mock a `fallbackMockImplementation` that throws on an id with no stub, so
the failure is at the lookup.

The fallback covers every member of the mock, `toString` included. Do not set it on a mock that Vue
receives as a prop or that gets stringified: the fallback throws on those accesses too.

## `mockDeep` stops at a provider

`mockDeep` does not cover `provider.get().method`: `get()` returns `undefined` unless stubbed. Stub `get`
to return a `mock<X>()`.
