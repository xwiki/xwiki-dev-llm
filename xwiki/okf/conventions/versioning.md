---
title: Versioning (@since / @Deprecated tags, and XAR page versions)
stability: durable
summary: Use the next release of the current dev version, written <X.Y.0>RC1, for @since and
  @Deprecated(since=…); the current version is volatile — read it from pom.xml. Wiki pages shipped
  in an extension's XAR always keep <version>1.1</version> — never bump it.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/
  - XWiki maintainer convention (stated in-session): extension XAR pages ship at page version 1.1
---

# API versioning (`@since` / `@Deprecated`)

**The format rule is durable:** for `@since` and `@Deprecated(since = "…")` tags, use the **next
release of the actual current dev version**, written as `<X.Y.0>RC1` (e.g. `18.5.0RC1`).

**The version number itself is volatile — do not cache it here or trust any `CLAUDE.md` string.**
To get the current dev version:

- Read the root `pom.xml` `<version>` of the repo you are in, or
- Look at the SNAPSHOT jar names under `~/.m2` / nexus.

XWiki Commons, XWiki Rendering and XWiki Platform are **released together with the same version**,
so the same version string applies across those repos.

See also [[backward-compatibility]] for the `@Unstable` lifecycle that pairs with `@since`.

# XAR page version (wiki pages shipped in an extension)

Wiki pages packaged in an extension's XAR are stored as XML files (e.g.
`src/main/resources/.../MyPage.xml`) that carry a `<version>` element (`<version>1.1</version>`).

**Always keep that page version at `1.1`; never bump it when editing an extension's XAR page.** The
extension's own (Maven) version is what tracks changes across releases — the per-page XML `<version>`
is not a changelog, and bumping it only produces spurious diffs. Extensions ship their pages at
version `1.1`.

This is unrelated to the `@since` / `@Deprecated` version above, which is about Java API tags.
