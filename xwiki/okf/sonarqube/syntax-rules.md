---
title: SonarQube syntax and annotation rules
stability: durable
summary: Correct fixes and XWiki-specific drop conditions for the pure syntax and annotation rules —
  the safest family, zero dataflow. Holds the varargs-array infinite-recursion trap, the
  static-access pair (instance-reference and declaring-class), modifier order, and the
  @Deprecated(since) move.
---

# SonarQube syntax and annotation rules

The safest family: zero dataflow, and (except S3878) no way for a correct edit to change behaviour.
Read [[index]] for the universal drop conditions first.

## S6208 — merge fall-through `case` labels into one comma-separated label

Message: "Merge the previous cases into this one using comma-separated label." Sonar flags the **last**
label of a run of empty fall-through cases: `case 'a': case 'b': case 'c': BODY` → `case 'a', 'b', 'c':
BODY`. Requires Java 14+. Behaviour is identical — the labels shared one body before and after.

- **Count the group upwards from the flagged line** until a non-`case` line, and merge exactly that
  run. Several groups in one `switch` are several issues; process them highest-line-first.
- A long run needs wrapping: fill to 120 and continue on a `+4`-indented line, closing with the `:`
  after the last label. A run long enough to need two lines still reads fine.
- **Drop the group when a case in the run has a body**, even an empty one with a comment, or when a
  `// fallthrough` comment marks a *non-empty* case falling into the run — that comment documents real
  fall-through behaviour and merging it away changes what the reader is told. Labels *after* such a
  comment can still be merged with each other.
- Escapes are copied verbatim (`'\''`, `'\\'`, `'\"'`, `'\t'`); a numeric label (`case 160:`) can
  join a char run.

## S1128 — unused import

Delete the flagged `import …;` line. **Trust Sonar** here: it correctly keeps imports referenced only
from a `{@link}` in Javadoc, so a flagged import really is unused. A delegating subclass can
legitimately have ten or more removable imports at once.

## S1197 — array designator on the variable

`TYPE NAME[]` → `TYPE[] NAME`.

Drop condition: none in practice. The trap is in *matching*, not in the fix — a naive
`\b(\w+)\s+(\w+)\[\]` pattern also matches a return type that is *already* in the correct form when a
modifier precedes it (`public String[] foo`). Require that the `[]` is not followed by an identifier.

## S1116 — empty statement

Three shapes: a lone `;` on its own line (delete the line), a trailing `;;` (strip one), and `};`
where the `}` closes a block or method (strip the `;`).

**Never strip the `;` from `new Foo(){…};` or `Type x = new Foo(){…};`** — that semicolon terminates a
declaration or expression statement and is required. Sonar does not flag those, so distinguish the
shapes by the exact flagged line rather than by pattern.

## S1161 — missing `@Override`

Purely additive: insert an `@Override` line above the flagged signature at the same indent. Trust
Sonar. A method in an interface that redeclares a super-interface method legitimately takes
`@Override` (legal since Java 6).

Sanity-check before writing: the flagged line contains a `(`, and neither it nor the line above is
already `@Override`.

## S1611 — redundant parentheses around a lambda parameter

`(x) -> …` → `x -> …`, single untyped parameter only.

Pairs with S1602 (see [[simplification-rules]]) — the *same* lambda is often flagged by both rules,
so make one combined edit rather than two.

## S2209 — a `static` member should be accessed statically

Message: "Change this instance-reference to a static reference." A `static` field or method is being
read through `this.` or through an instance variable. Fix: drop the `this.` (or the instance
qualifier) and leave the bare name.

S2209 changes nothing but the qualifier of a resolution the compiler already performed, so it is a
pure syntax fix. The typical XWiki site is a subclass reading a `protected static final` constant of
its parent as `this.CONSTANT` — the XWiki style's mandatory `this.` for *instance* fields does not
apply to static ones. Its sibling is S3252 below, which is the same kind of fix.

## S3252 — a `static` member should be accessed through the class that declares it

Message: "Use static access with "&lt;fully.qualified.Declaring&gt;" for "&lt;MEMBER&gt;"." A `static`
constant or method is read through a *derived* type instead of the class that declares it
(`Child.COUNTER` where `Parent` declares `COUNTER`). Fix: replace the qualifier with the declaring
class and adjust the imports.

**This is not an API change** — nothing is declared, renamed or re-typed; only the qualifier of a
compile-time resolution changes, and static method dispatch is by the compile-time type, so the same
member is reached. Sonar names the *resolved* declaring class, so a member the subclass hides is never
flagged. The rule converts with no observed drops.

Two mechanics carry the batch:

- **Classify each site by the token BEFORE the flagged range.** The issue's `textRange` covers only
  the member name. If the preceding qualifier differs from the declaring class's simple name the fix
  is a pure qualifier swap. If it is the SAME simple name, the "fix" is really an import swap to the
  base class — see the drop below.
- **Fix imports in both directions in the same edit.** Add the declaring class's import (not needed
  when it is in the file's own package — a redundant import is a Checkstyle error), and remove the old
  qualifier's import once the swap orphans it, matching the simple name with a word boundary over the
  whole file so a `{@link X}` in Javadoc still counts as a use. Insert the new import into the group
  whose first package segment matches and keep that group alphabetical.

**Drop condition — the derived type is an XWiki utility subclass of the same simple name.**
`org.xwiki.text.StringUtils` and `org.xwiki.localization.LocaleUtils` deliberately extend the Apache
Commons classes they are named after so that a single import serves both the Apache helpers and the
XWiki additions. Every inherited call through them is flagged, and "fixing" one means importing the
base class instead — a style regression, and impossible without a fully-qualified name in any file
that also uses the XWiki-specific methods. Permanent drop.

## S1124 — modifier order

Reorder the leading run of modifiers into canonical JLS order:

```
public/protected/private → abstract → default → static → final → transient → volatile
→ synchronized → native → strictfp
```

In practice almost always `final static` → `static final` or `static public` → `public static`.

- **Zero behaviour or visibility change → no `@since` tag**, even on a public constant.
- Sites cluster many-per-file (a block of constants can yield a dozen in one file).
- Verification tip: assert that the reordered modifier run actually *differs* from the original. A
  no-op means the flagged line has drifted and points at something else now.

## S3878 — array created for a varargs parameter

Two message variants: "Remove this array creation / and simply pass the elements", and "Disambiguate
this call by either casting as Object or Object[]". The fix is to drop the `new T[]{…}` wrapper and
pass the elements directly.

For a multi-line array, edit the opening line (drop `new T[]{`) and the closing line (drop one `}`),
then normalise the continuation indent to `+4`.

### The infinite-recursion trap (the dominant drop shape)

**Before touching any `new Object[]{…}` argument, check whether the enclosing method has the same
name as the method being called. If it does, drop the issue.**

Spreading the array's elements re-binds the call from the varargs overload to a **fixed-arity
overload of the same name** — which is frequently the enclosing method itself, producing infinite
recursion. The canonical XWiki case is the SLF4J `Logger` implementations in `xwiki-commons-logging-*`
(`LogQueue`, `LogTree`, the `AbstractLogger` in `logging-common`): their
`trace/debug/info/warn/error(Marker, String, Object)` overrides deliberately delegate to the varargs
sibling via `new Object[] { arg }`. The array *is* the disambiguation — which is exactly what the
"Disambiguate this call…" message variant is warning about. Every site of that shape is a drop.

### Other drop conditions

- A single `new Object[]{y}` where `y` could itself be an array — genuinely ambiguous.
- An **empty-array** delegation `foo(x, new Object[]{})` where a fixed-arity overload of the same name
  exists — the same recursion trap. Reducing an empty array to no arguments is *safe* for reflection
  on an external class (`getConstructor()` / `newInstance()` have unambiguous no-arg forms).

## S7476 — a single-line comment should start with exactly two slashes

The safest rule there is: comments only, so it cannot change behaviour.

In XWiki this is essentially always a **decorative banner line of pure slashes** (`//////`,
`////////////////`, occasionally a lone `///`) framing a real comment. **Delete the banner line** and
keep the comment underneath — converting the banner to `//` would leave a meaningless empty comment.

Gotcha: a standalone separator (blank line / banner / blank line, common in test files) leaves two
consecutive blank lines once the banner is deleted. Collapse the pair, and check the diff for an
introduced triple newline.

## S1659 — declare each local variable on its own line

`String a = "", b = "", c = "";` → one `String x = …;` statement per variable, at the same indent.
Sonar names the **second** declaration ("Declare `b` and all following declarations on a separate
line"), so one issue can cover several variables — count resolved issues by key.

The dense sites are the declaration preamble of long legacy methods (`XWiki.java`,
`DBListClass`, `StaticListClass`), where the list is often already wrapped onto a continuation line;
un-wrap it entirely rather than keeping a half-split declaration. Nothing about scoping or
initialisation order changes, so there is no drop condition beyond a comment on the line.

## S5993 — an `abstract` class's constructor should not be `public`

`public Foo(` → `protected Foo(` on the flagged line, one keyword, nothing else. **This is not a
backward-compatibility break, in any package.** For an abstract class there are exactly two ways to
reach a constructor and [JLS §6.6.2.2] permits both on a `protected` one from *any* package: a
`super(…)` call in a subclass, and `new AbstractX(…){…}`. The one form it forbids across packages,
plain `new AbstractX(…)`, is already illegal on an abstract class — so no compilable caller exists
that the change can break. `revapi:check` agrees on published, non-`internal` API: XWiki's
`revapi.json` reclassifies all *source*-compatibility differences to EQUIVALENT severity, and this is
a source-only change.

- The line grows by 3 characters — re-check the 120-column rule and re-wrap the parameter list if
  needed (~1 site in 40).
- Assert the enclosing class really is `abstract` before writing.
- Nothing else changes: no import, no signature, no `@since`.
- Only drop condition beyond the universal ones: the flagged **declaration line already carries an
  open method-metric issue** (`S3776`, `S107`, `S1541`), which rewriting it would hand to your own
  PR's quality gate. See [[verification]].

[JLS §6.6.2.2]: https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.6.2.2

## S6355 — `@Deprecated` should carry `since`

**Fixable whenever the element's own `@deprecated` Javadoc tag names the version** — which in XWiki it
usually does, so the version is copied, never invented. Moving it is the whole fix; the conventions
(strip it from the tag, list every version of a multi-branch deprecation, no `forRemoval`) are in
[[versioning]].

```java
    /**
-    * @deprecated since 8.3RC1, use {@link #AbstractCache(CacheConfiguration)} instead
+    * @deprecated use {@link #AbstractCache(CacheConfiguration)} instead
     */
-   @Deprecated
+   @Deprecated(since = "8.3RC1")
```

**Drop** when the version is not written down: no Javadoc, no `@deprecated` tag, or a tag naming no
version (`@deprecated use {@link X} instead`). Never guess one.

Three mechanics:

- Sonar flags the bare `@Deprecated` line itself, so `line.strip() == "@Deprecated"` is both the site
  location and the guard.
- **Anchor the version pattern** (`…(?![\w.])`) and require a `since`-style keyword before it: the pool
  holds malformed versions (`4.4MA`, `5.2M`, `14.0CR1`) whose numeric prefix otherwise matches, which
  silently truncates the version and orphans the rest of the token in the tag. Those sites should drop.
- Adding the attribute is not an API break — `revapi:check` passes.

## Related

- [[index]] — rule map, denylist, universal drop conditions.
- [[versioning]] — the `@since` / `@Deprecated(since = …)` version format (needed only when a version
  must be *written*, which S6355's fixable subset never does).
- [[simplification-rules]] — S1602, which pairs with S1611.
- [[verification]] — the build gates that confirm a fix.
