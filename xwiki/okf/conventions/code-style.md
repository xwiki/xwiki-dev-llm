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
- **LGPL license headers** are required on **every** file, configuration files included (validated by
  `license-maven-plugin`). Add missing headers with `mvn license:format -B -ntp`. The comment syntax
  depends on the file type: `/* … */` for Java & JavaScript, `<!-- … -->` for XML & Vue, `#` for shell
  scripts, `.properties` and YAML, `REM` for `.bat`, `##` for Velocity.

## Comment formatting

- **A Javadoc comment is always multi-line, never the one-line `/** text */` form** — even for a
  single sentence on a private constant, and even in a test:

  ```java
  /**
   * Characters that might break the layout.
   */
  private static final Pattern BAD_CHARACTERS = …;
  ```

  This is not on the dev wiki's CodeStyle page (every example there merely happens to be multi-line)
  but it is enforced in review. **When you touch a file that still uses the one-line form, convert
  that file's comments as part of your change.**

## File encoding

- **Java sources: ASCII characters only** — use Unicode escapes inside strings and XML entities in
  Javadoc (there are no `@author` tags, so this is rarely a constraint).
- **Translation files: ASCII only with Unicode escapes** (stricter than the `.properties` spec).
- **Wiki document sources: UTF-8.**
- Other XML files declare their encoding in the `<?xml?>` header, UTF-8 whenever possible; all other
  textual resources are UTF-8 with as few non-ASCII characters as possible.

## Rendering macros

A macro for XWiki Platform is written **in Java**, not as a wiki page (wiki macros lack most of what a
platform macro needs — see the comparison table on the dev wiki).

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

## Suppressing a static-analysis warning

When a SonarQube/SonarCloud rule genuinely does not apply to a piece of code, **retire it in the code,
not in the analysis tool**: add `@SuppressWarnings("java:SXXXX")` with a `//` comment immediately
above the annotation stating *why*. Marking the issue *Accepted* in SonarCloud alone hides the
reasoning from the next developer, who will try to "fix" it again.

Conventions (all verifiable with `grep -rn -B4 '@SuppressWarnings("java:S'`):

- The annotation argument is the **rule key**, e.g. `@SuppressWarnings("java:S5785")`.
- The justifying `//` comment goes **directly above the annotation**, which is placed last before the
  declaration (after `@Override` / `@Test` if present).
- **Prefer method-level scope over class-level**, so the rest of the file stays covered by the rule.
- The comment states the reason as it applies to the code now — see [[code-comments]].

A Checkstyle suppression is a different mechanism and does not affect Sonar: a class-level
`@SuppressWarnings("checkstyle:MultipleStringLiterals")` does **not** suppress `java:S1192`.

Which rules are worth suppressing rather than fixing is in [[index]] (the SonarQube corpus); the
procedure is the `xwiki-fix-sonarqube-issue` skill.

## Related

- [[code-comments]] — what to write (and never write) in code comments.
- [[versioning]] — `@since` / `@Deprecated(since=…)` rules.
- [[naming]] — Maven/npm/configuration-property/UIXP/skin/icon naming.
- [[frontend]] — the JavaScript, HTML/CSS and accessibility equivalents of this file.
