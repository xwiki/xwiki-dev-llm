---
title: Backward compatibility policy
stability: durable
summary: Revapi enforces binary/semantic compatibility of public APIs, though not uniformly per module;
  @Unstable marks not-yet-stable API with a max 1-cycle lifetime; evolve interfaces with default
  methods, not new interfaces; main code never uses another project's `internal` packages.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HBackwardCompatibility
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle/JavaCodeStyle/#HPackagenames
---

# Backward compatibility policy

XWiki pays close attention to backward compatibility. The **Revapi** Maven plugin (run in the
default build) fails the build when a public API change breaks compatibility. It checks:

- **Binary** incompatibilities, and
- **Semantic** incompatibilities.

It deliberately does **not** check source incompatibilities (too strict — e.g. adding generics to a
return type should not break the build).

## Who may use `internal` packages

`internal` packages are not API: Revapi ignores them, so they can change or vanish in any release. Main
code may only use the `internal` packages of its **own project** — xwiki-commons, xwiki-rendering and
xwiki-platform count as one project and may use each other's. Anything else (a contrib extension) must
not import theirs: when no public API covers the need, ask for one in the core project. Test code may
use any `internal` class.

## `@Unstable` annotation

New public API can be marked `@Unstable` (in addition to `@since`) to signal it may change at any
time. Lifecycle rules:

- An API may stay `@Unstable` for at most **one full release cycle**. E.g. an unstable API added in
  N.1 must come out of unstability before N+2 Milestone 1.
- Developers are encouraged to remove `@Unstable` earlier, as soon as the API is considered stable;
  the normal deprecation mechanism then applies for any later change.
- The build **enforces** both halves automatically: it fails when an `@Unstable` has outlived its
  cycle, and it checks that a correctly-formatted `@since` is present (that tag is what dates the
  annotation).

## Evolving an interface without breaking it

When you need to add a method to an existing interface, **prefer Java default methods** over
creating a new interface:

- A default method preserves binary compatibility for existing implementors.
- The default implementation should generally **not** throw (e.g. avoid
  `throw new UnsupportedOperationException(...)`), since callers of the default would then fail — that
  is not backward compatibility. Two exceptions: the new method **declares a checked exception**, or it
  documents a runtime exception the call chain is supposed to handle; throwing those from the default
  is fine.

The alternative — a new interface plus deprecation of the old one — is discouraged: callers then have
to support both interfaces.

## Deprecation

Deprecating happens in **two steps**:

1. Add `@Deprecated` **and** the `@deprecated` Javadoc tag naming the replacement, with the version
   ([[versioning]] format). The code stays where it is.
2. Once no XWiki code uses the deprecated API any more — which can be immediately — move it to the
   repo's `-legacy` module.

APIs are **never removed from a legacy module** by default; doing it anyway is decided case by case with
a VOTE. Never put new logic in a legacy module (see [[code-style]]).

### How `-legacy` modules work

Each repo hosts its legacy modules in one place: `xwiki-commons-core/xwiki-commons-legacy/`,
`xwiki-platform-core/xwiki-platform-legacy/`, `xwiki-rendering-legacy/`.

A `-legacy` module is the backward-compatibility companion of a main module. It re-exports the same
`xwiki.extension.features` as the main module and, when it must keep an API that the main module has
dropped, it **weaves the main artifact's bytecode with AspectJ** (`aspectj-maven-plugin` +
`<weaveDependency>`) so the produced legacy jar is a full *replacement* of the main jar:

- A removed **whole type** is re-added as a plain `.java` file in the legacy module (same package).
- A removed **member** is re-added by an aspect: an inter-type declaration for a concrete class, or a
  companion interface with a `default` method plus `declare parents : <Iface> implements <Companion>`
  for an interface method — each delegating to the replacement.
- A weaving legacy module merges its own `META-INF/components.txt` onto the woven one, excludes the
  main jar from the test classpath, and declares the main artifact once as `<type>pom</type>` (trigger)
  and once as `provided` (weaving source). Because it now bundles the main classes, its
  `xwiki.jacoco.instructionRatio` is pinned low.
- Because the woven legacy jar *replaces* the main jar, the WAR must never contain both: the
  xwiki-platform `xwiki-platform-distribution-war-legacydependencies` pom **bans** the main artifact
  (enforcer `bannedDependencies`) and **excludes** it from the clean dependency tree. So the first
  time a legacy module becomes a weaver, that pom must be updated too.

**Moving an API to legacy needs no Revapi ignore.** A main module wrapped by a weaving legacy module
sets `<xwiki.revapi.skip>true</xwiki.revapi.skip>`, and Revapi runs on the legacy module instead,
comparing the woven jar with its previous release — so the check is on what extensions actually get,
and a failure there means the re-add is not faithful (fix the re-add, never ignore it). Never add an
ignore pre-emptively; the only exception is a downstream consumer (see the last section). The full
procedure — migrate callers (`xwiki-fix-deprecation`), then remove, re-add, ban in the WAR, verify
(`xwiki-legacy`) — lives in those two skills.

## Choosing the `<criticality>` of a Revapi ignore

**Never add a Revapi ignore without the developer's explicit approval** — the goal is never to break
existing users or extensions, so show them the reported break and why it is acceptable first.

Every ignore added to a repo's `<revapi.differences>` carries a criticality, and **it feeds the release
notes** (`allowed` items are not listed there), so it is not cosmetic:

| Criticality | When |
|---|---|
| `highlight` | a real break we still want to do — existing code using the API will or may fail at runtime, so users must be warned |
| `documented` | a real break, but on `@Unstable` code |
| `allowed` | not a break in our opinion: a semantically-"breaking" but harmless change (e.g. adding an annotation), a Revapi bug/limitation, or an API moved to another Maven module that a downstream consumer still reports (see the last section) |

**Where the ignore goes** — two silent failures, both leaving the build failing with the ignore
apparently in place. `<revapi.differences>` needs `combine.children="append"`, or Maven merges your
`<item>`s *positionally* into the ones inherited from the parent and each takes on the parent's
`<old>`/`<ignore>`, matching nothing; and it must sit inside the `revapi-check` `<execution>`, whose
own configuration otherwise wins.

## Where Revapi does and does not look

Revapi analyses the primary artifact **and its transitive dependencies**, but only reports differences
on dependency classes the primary artifact's own API *reaches*. Its coverage is therefore **not uniform
per module**: a module can opt out with `<xwiki.revapi.skip>true</xwiki.revapi.skip>`
(every main module wrapped by a weaving `-legacy` module does, the legacy module checking the woven jar
in its place). A downstream module that depends on the **clean** main jar still sees the dropped API as
removed when its own API *reaches* the class, and fails far from the change (moving the
`XWikiHibernateStore` constructors to legacy failed `xwiki-platform-extension-script`, which reaches the
class via `XWiki.getHibernateStore()`). That, and only that, warrants an `allowed` ignore for a legacy
move — added when that build actually fails, justified by the move, and approved (see above). A green build on the changed
module therefore never means "compatible".
