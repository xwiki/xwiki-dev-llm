---
title: Code style and structural conventions
stability: durable
summary: Line length, license headers, the component system, the javax→jakarta migration, and the
  -legacy module rules for XWiki Java code.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices
---

# Code style and structural conventions

The concise, always-on version of these rules is injected into every XWiki session via
`instructions/xwiki-org.md`. This is the expandable home; the dev wiki `CodeStyle` page is the
authoritative source of truth.

## Formatting

- **Lines must not exceed 120 characters.** This is enforced by Checkstyle in the `quality` profile.
- **LGPL license headers** are required on every source file (validated by `license-maven-plugin`).
  Add missing headers with `mvn license:format -B -ntp`.

## Use the component system, not context passing

Use the XWiki **Component system** (`@Component`, `@Inject`, `@Role`, declared in
`META-INF/components.txt`) rather than passing context objects around in new code. See
[[component-system]] for how it works.

## javax → jakarta migration

The project is **migrating away from `javax.*` in favour of `jakarta.*`**. In new code prefer the
`jakarta.*` namespaces — e.g. `jakarta.inject.*` (not `javax.inject.*`) for `@Inject`, `@Named`,
`Provider`, and likewise for other migrated `javax`→`jakarta` packages.

## -legacy modules

`-legacy` modules only **re-export deprecated APIs** for backward compatibility:

- Never add new logic in a `-legacy` module.
- Non-legacy modules must **not** depend on legacy ones.
- The `legacy` Maven profile includes these modules and is almost always needed in a build.

## Backward compatibility

Public API changes are checked for binary/semantic compatibility by **Revapi** (in the `quality`
profile). See [[backward-compatibility]] for the policy, the `@Unstable` lifecycle, and the
default-method pattern for evolving interfaces.

## Related

- [[code-comments]] — what to write (and never write) in code comments.
- [[versioning]] — `@since` / `@Deprecated(since=…)` rules.
