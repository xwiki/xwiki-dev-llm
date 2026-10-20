---
name: xwiki-javadoc
description: Write clear, genuinely useful Javadoc for XWiki Java code, following the XWiki Java Code Style and the Oracle "How to Write Doc Comments" conventions. Use when adding or improving Javadoc on classes, interfaces, methods, fields or parameters in an XWiki repo — especially public/protected APIs, REST resources, component roles — or when Checkstyle reports MissingJavadocType / MissingJavadocMethod. For the build/Checkstyle commands use xwiki-build; for the @since / @Deprecated(since) version string use the versioning rules (xwiki-knowledge); for opening the PR use xwiki-pull-request.
---

# Write good XWiki Javadoc

XWiki follows the [Oracle "How to Write Doc Comments" style guide](https://www.oracle.com/technical-resources/articles/java/javadoc-tool.html#styleguide),
as stated in the [XWiki Java Code Style](https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle/JavaCodeStyle/#HJavadocBestPractices).
The bar is not "Checkstyle passes" — it is "a caller who has never seen the code can use the API correctly from the
Javadoc alone".

## The one rule that matters most: be useful, not shallow

The frequent failure is Javadoc that restates the name and stops. Document the things a caller actually wonders about,
and **verify each against the implementation — never guess**:

- **Example values** for every parameter, in `{@code ...}` (for example `{@code xwiki}`, `{@code WebHome}`).
- **Indexing base**: is an offset 0-based or 1-based? What is the default?
- **`null` / empty / absent** behaviour: what does passing `null` (or omitting a query parameter) do?
- **Sentinel values**: is there a "no limit" / "all" value (for example `{@code -1}`), or a cap that triggers an error?
- **Defaults** and what each default means.
- **Valid value sets** (for example `{@code asc}` / `{@code desc}`), and what an invalid value does (reject? fall back?).
- **Units** (for example milliseconds since the epoch for a timestamp).
- **The WHY / edge cases / error conditions**, not just the WHAT. Make `@throws` state real conditions (lack of
  rights vs. not-found vs. validation failure), not a vague "if an error occurs".

Before writing a parameter's description, read the method's implementation (and the service it delegates to) to learn
the real contract. If a detail genuinely can't be determined, describe what is known — do not invent.

### Before / after

```java
// BAD — restates the name, tells the caller nothing
/**
 * @param spaceName the space where the page is located in
 * @param start the index of the first attachment to return
 * @param number the maximum number of attachments to return
 */

// GOOD — verified against the implementation
/**
 * @param spaceName the reference of the space(s) containing the page; nested spaces are separated by
 *  {@code /spaces/} (for example {@code A/spaces/B/spaces/C} for the space {@code A.B.C})
 * @param start the 0-based index of the first attachment to return, used together with {@code number} for
 *  pagination; defaults to {@code 0}
 * @param number the maximum number of attachments to return; when {@code null} the wiki's configured REST query
 *  limit is used, and a value that is negative or larger than that configured limit is rejected with a
 *  {@code 400} response
 */
```

## Style conventions (Oracle + XWiki)

- **First sentence = a standalone summary.** The Javadoc tool copies it into the class/member summary tables, so it
  must make sense on its own. It ends at the first period followed by a space/newline.
- **3rd-person descriptive, present tense**, not 2nd-person imperative, and never "This method …":
  `Returns the label.` / `Gets the label.` (preferred) — not `Return the label.` or `Get the label.`.
- **Method descriptions begin with a verb phrase.** OK to use phrases rather than full sentences for brevity
  (especially the summary and `@param` descriptions).
- **`@param`**: `@param name <description>`. The description is a lowercase phrase (uppercase only if it is a full
  sentence). End with a period only if another sentence follows. Do **not** wrap the parameter *name* in `<code>`/
  `{@code}` (Javadoc does that automatically, and Checkstyle compares the name to the signature).
- **`@return`**: a phrase describing what is returned and its meaningful states; omit only for `void` methods.
- **`@throws`**: `@throws SomeException if <condition>`. Document checked exceptions and any unchecked exception a
  caller might reasonably catch (not `NullPointerException`).
- **`{@code ...}` / `{@link ...}`** for keywords, identifiers and literals — used economically (link the first
  occurrence of an API name, not every one).
- **Avoid Latin abbreviations**: write "for example" (not `e.g.`), "that is" (not `i.e.`), "also known as" (not
  `aka`), "namely" (not `viz.`). ("etc." is fine.)
- **Lines must not exceed 120 characters** (wrap continuation lines, indented for readability).
- **Tag order**: `@param` → `@return` → `@throws` → `@see` → `@since` → `@deprecated`.

## XWiki-specific rules

- **`@version $Id$`** on every class/interface (unexpanded keyword — SCM expands it). **Never use `@author`** —
  XWiki has no code ownership.
- **`@since`** on new API, using the next release of the current dev version written `<X.Y.0>RC1` (for example
  `18.6.0RC1`). Read the real current version from the root `pom.xml`; do not trust a cached value. See the
  versioning rules via the `xwiki-knowledge` skill.
- **Deprecation**: use both the `@Deprecated` annotation (with `since = "…"`, no `forRemoval` — XWiki does not break
  APIs) and the `@deprecated` Javadoc tag. In the tag say WHY it is deprecated and WHAT to use instead (with a
  `{@link}`); do **not** repeat the version there (the annotation's `since` is what the tool shows). For deprecation
  across several branches use a comma-separated `since`, for example `@Deprecated(since = "14.10.12,15.5RC1")`.
- **Do not duplicate inherited Javadoc.** For an `@Override` method, either add nothing (inherits automatically) or
  use `{@inheritDoc}` and then add only what is specific. Always keep the `@Override` annotation.

## The `{@return ...}` combo tag — allowed, but only for simple getters

Java 16's inline `{@return description}` folds the summary and `@return` into one. XWiki's Checkstyle **now accepts
it** (fixed in xwiki-commons by the *"[Misc] Allow {@return...} structure"* change), so it no longer breaks the
`-Pquality` build on current versions. The community agreed
([forum discussion](https://forum.xwiki.org/t/adopt-the-combo-return-tag-javadoc-syntax-to-avoid-redundancy/18595)) to
use it **only for simple getter(-like) methods** whose entire behaviour fits in the one or two sentences of the tag:

```java
/**
 * {@return the key of the space this page belongs to, for example {@code Main}}
 */
String getParentSpaceKey();
```

It is **not** a replacement for comprehensive Javadoc. As soon as there is anything a caller needs to reason about
(parameters, sentinel values, `null` behaviour, defaults, error conditions — see "be useful, not shallow" above), keep
the classic form: a standalone first-sentence summary **and** a separate `@return` tag, both carrying the real detail.
If summary and `@return` feel redundant, that is the signal to make the Javadoc *better* (add the missing detail), not
to collapse it into `{@return}`.

Notes:
- The combo tag renders as `Returns ` + your text + `.`, so write it as a noun phrase (`{@return the label}`), not a
  full sentence beginning with "Returns".
- On older branches that predate the Checkstyle fix, `{@return}` still fails `-Pquality` (with `JavadocStyle: First
  sentence should end with a period.` / `JavadocMethod: @return tag should be present and have description.`); use the
  classic form there. Verify with the `-Pquality` profile (see below).

## Checkstyle

- The `MissingJavadocType` / `MissingJavadocMethod` checks require Javadoc on API types/methods. **Write the Javadoc —
  never add `@SuppressWarnings("checkstyle:MissingJavadocType"|"checkstyle:MissingJavadocMethod")` to silence them.**
  If a method legitimately needs many parameters, keep only the unrelated suppression it already carries (for example
  `@SuppressWarnings("checkstyle:ParameterNumber")`).
- Verify with the `-Pquality` profile using the **xwiki-build** skill, for example (single module):
  `mvn -B -ntp checkstyle:check@default -Pquality -pl <module>`. Aim for `0 Checkstyle violations`.
