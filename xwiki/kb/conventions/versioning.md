---
title: Versions in code and issues (@since / @Deprecated, affected version)
stability: durable
summary: Use the next release of the current dev version, written <X.Y.0>RC1, for @since and
  @Deprecated(since=…). The current version itself is volatile — read it from pom.xml, and another
  branch's from its pom.xml on origin, never from local tags. A deprecation
  done on several branches lists ALL its versions, comma-separated, in the annotation. An issue's
  affected version is always set: the oldest released version that has the problem, else the latest
  release or the current LTS.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/
  - https://dev.xwiki.org/xwiki/bin/view/Community/IssueTracker/JIRA/#HRule:Non-codeissuesareallowed
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle/JavaCodeStyle/#HDeprecation
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle/JavaCodeStyle/#HUseone40sinceperversion
---

# API versioning (`@since` / `@Deprecated`)

**The format rule is durable:** for `@since` and `@Deprecated(since = "…")` tags, use the **next
release of the actual current dev version**, written as `<X.Y.0>RC1` (e.g. `18.5.0RC1`).

**Always three numeric segments** (since XWiki 16.0.0). Write `18.3.0RC1`, never `18.3RC1`;
`17.10.10`, `18.4.3`. A two-segment version like `18.3RC1` is invalid.

## `@Deprecated` — the annotation carries the version, the Javadoc tag carries the reason

A division of labour between the annotation and the Javadoc tag:

- **Always both**: the `@Deprecated` annotation *and* the `@deprecated` Javadoc tag.
- **The annotation carries WHEN**: always `since`. **Never `forRemoval`** — XWiki does not break APIs
  and `false` is the default.
- **The Javadoc tag carries WHY and WHAT INSTEAD**, and **must not repeat the version** — that would
  duplicate the annotation, and the javadoc tool already renders the annotation's `since`. So
  `@deprecated use {@link #getRoleType()} instead`, not `@deprecated since 4.4M1, use …`.
- **A deprecation done on several branches lists ALL of its versions in `since`, comma-separated** —
  `@Deprecated(since = "14.10.12,15.5RC1")`. Do **not** pick one of them (neither the newest nor the
  oldest): each version-line in which the deprecation shipped belongs in the list. No ordering is
  prescribed, so keep the order the source used.

**Backporting adds `@since` lines, it does not replace them.** List one `@since` line per
version-line where the API becomes available, keeping the original, and make the block **identical
on every branch** the code lives on (master included). Write the lines **ascending** (`@since 17.10.10`
/ `@since 18.4.3` / `@since 18.5.0RC1`), but the order is not an XWiki rule: never flag or reorder an
existing block for it. When it is clear that a change will be backported (a security fix, an
important bug fix), the original commit already carries one line per branch it will reach; remove a
line whose backport does not happen.

**`@since` goes on reusable code, not only on public API.** Anything something else calls carries
`@since` — including `internal` classes and methods, and the *tools* tests are written with: page
objects (`*-test-pageobjects`), test frameworks and test helpers (`*-test-*` modules — for example
the `@UITest` annotation and its `TestConfiguration`, or `TestUtils`). A caller needs to know when
what it calls appeared, whatever its module or visibility. Annotate a new **class** *and* any new
**member** added to an existing one. On a `private` member it is optional: never flag it, present or
absent.

**Tests themselves carry no `@since`.** A test class or test method (`src/test/**`, `*IT.java`,
`*Test.java`) is not reusable — nothing calls it — so there is nothing to version. And when
backporting, **never invent an `@since`** where the source code didn't already have one.

**The version number itself is volatile — do not cache it here or trust any `CLAUDE.md` string.**
To get the current dev version:

- Read the root `pom.xml` `<version>` of the repo you are in, or
- Look at the SNAPSHOT jar names under `~/.m2` / nexus.

The version a change will **ship in on another branch** (the `@since` line of a backport, a JIRA Fix
Version, an advisory's patched version) comes from that branch's root `pom.xml` on the remote —
`git fetch origin <branch> && git show origin/<branch>:pom.xml` — never from local tags or a local
checkout, which go stale. Drop `-SNAPSHOT` on a stable branch (`16.10.20-SNAPSHOT` gives `16.10.20`);
an `X.Y.0-SNAPSHOT` (master) gives `X.Y.0RC1`, as above.

XWiki Commons, XWiki Rendering and XWiki Platform are **released together with the same version**,
so the same version string applies across those repos.

See also [[backward-compatibility]] for the `@Unstable` lifecycle that pairs with `@since`.

## Affected version of an issue

Whatever the tracker — JIRA's **Affects Version/s**, OpenProject's **Observed in versions** — always set
it, whatever the issue type or component (even `Development Issues only`). For a bug, set the **oldest
released version that has the problem**, never just the latest release: that understates the range and
defeats backport triage. It is the first release containing the faulty code, on every maintained line:
that code reaches stable branches as cherry-picks with other SHAs, which `git tag --contains <commit>`
and `git merge-base --is-ancestor` miss — take the causing issue's Fix Versions, or `git grep` the code
on each `origin/stable-*` branch; if that predates the versions the tracker defines, use its oldest
one; if pinning it is impractical, fall back to the last LTS that has the problem. When no released version is really affected
(a new feature, a new check, an improvement), use the latest release or the current LTS — usually the
LTS's `.0`, e.g. `17.10.0` while dev is on `18.x` — not the first release of the code it touches (the
LTS: [[jira]]).
