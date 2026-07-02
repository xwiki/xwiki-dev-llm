---
title: Backward compatibility policy
stability: durable
summary: Revapi enforces binary/semantic compatibility of public APIs; @Unstable marks not-yet-stable
  API with a max 1-cycle lifetime; evolve interfaces with default methods, not new interfaces.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HBackwardCompatibility
---

# Backward compatibility policy

XWiki pays close attention to backward compatibility. The **Revapi** Maven plugin (run in the
`quality` profile) fails the build when a public API change breaks compatibility. It checks:

- **Binary** incompatibilities, and
- **Semantic** incompatibilities.

It deliberately does **not** check source incompatibilities (too strict — e.g. adding generics to a
return type should not break the build).

## `@Unstable` annotation

New public API can be marked `@Unstable` (in addition to `@since`) to signal it may change at any
time. Lifecycle rules:

- An API may stay `@Unstable` for at most **one full release cycle**. E.g. an unstable API added in
  N.1 must come out of unstability before N+2 Milestone 1.
- Developers are encouraged to remove `@Unstable` earlier, as soon as the API is considered stable;
  the normal deprecation mechanism then applies for any later change.

## Evolving an interface without breaking it

When you need to add a method to an existing interface, **prefer Java default methods** over
creating a new interface:

- A default method preserves binary compatibility for existing implementors.
- The default implementation should generally **not** throw (e.g. avoid
  `throw new UnsupportedOperationException(...)`), since callers of the default would then fail.

## Deprecation

Deprecated APIs are re-exported from `-legacy` modules (see [[code-style]]); never put new logic
there. Tag deprecations with `@Deprecated(since = "…")` using the [[versioning]] format.
