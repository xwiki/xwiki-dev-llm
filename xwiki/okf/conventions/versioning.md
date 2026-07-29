---
title: API versioning (@since / @Deprecated)
stability: durable
summary: Use the next release of the current dev version, written <X.Y.0>RC1, for @since and
  @Deprecated(since=…). The current version itself is volatile — read it from pom.xml.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/
---

# API versioning (`@since` / `@Deprecated`)

**The format rule is durable:** for `@since` and `@Deprecated(since = "…")` tags, use the **next
release of the actual current dev version**, written as `<X.Y.0>RC1` (e.g. `18.5.0RC1`).

**Always three numeric segments** (since XWiki 16.0.0). Write `18.3.0RC1`, never `18.3RC1`;
`17.10.10`, `18.4.3`. A two-segment version like `18.3RC1` is invalid.

**Backporting adds `@since` lines, it does not replace them.** When an API is backported to stable
branches, list one `@since` line per version-line where it becomes available, **ascending by version
number**, keeping the original (e.g. `@since 17.10.10` / `@since 18.4.3` / `@since 18.5.0RC1`). Make
the block **identical on every branch** the code lives on (master included).

**`@since` goes on reusable code, not only on public API.** Anything something else calls carries
`@since` — including `internal` classes and methods, and the *tools* tests are written with: page
objects (`*-test-pageobjects`), test frameworks and test helpers (`*-test-*` modules — for example
the `@UITest` annotation and its `TestConfiguration`, or `TestUtils`). A caller needs to know when
the thing it calls appeared, whatever the module and whatever the visibility. Annotate a new
**class** *and* any new **member** added to an existing one.

**Tests themselves carry no `@since`.** A test class or test method (`src/test/**`, `*IT.java`,
`*Test.java`) is not reusable — nothing calls it — so there is nothing to version. And when
backporting, **never invent an `@since`** where the source code didn't already have one.

**The version number itself is volatile — do not cache it here or trust any `CLAUDE.md` string.**
To get the current dev version:

- Read the root `pom.xml` `<version>` of the repo you are in, or
- Look at the SNAPSHOT jar names under `~/.m2` / nexus.

XWiki Commons, XWiki Rendering and XWiki Platform are **released together with the same version**,
so the same version string applies across those repos.

See also [[backward-compatibility]] for the `@Unstable` lifecycle that pairs with `@since`.
