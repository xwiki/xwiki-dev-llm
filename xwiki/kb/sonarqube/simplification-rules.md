---
title: SonarQube simplification rules
stability: durable
summary: Correct fixes and XWiki-specific drop conditions for the behaviour-preserving simplification
  rules — collapsible ifs, boolean and ternary reductions, isEmpty(), method references, lambda
  bodies, regex character classes, redundant casts and library copy calls.
---

# SonarQube simplification rules

Behaviour-preserving rewrites that need no dataflow analysis — the best mechanical-fix fodder after
the syntax family. Read [[index]] for the universal drop conditions first.

## S6397 — redundant single-character regex character class

Message: "Replace this character class by the character itself." `"[x]"` → `"x"` inside a regex
argument (`replaceAll`, `split`, `matches`, `Pattern.compile`). One token, no dataflow, and it cannot
change what the regex matches.

- **Keep the escaping the class was carrying.** `"[\\.]"` → `"\\."` (a bare `"."` would match any
  character) and likewise for `[\\(]`, `[\\$]`, `[\\^]`. A non-metacharacter needs no escape.
- **Match the source *text*, not the decoded character**, when scripting the edit: XWiki's
  transliteration tables are written as `"[\u0132]"` — six literal characters in the file — so a
  pattern built from the decoded `Ĳ` finds nothing.
- Only single-character classes are flagged; leave the multi-character ones (`"[\u0136\u01e8]"`)
  alone, and do not "improve" the flagged call into `replace()` — that is S5361 and a separate issue.
- The dense sites are the accent-stripping `replaceAll` tables duplicated in `XWiki.java` (platform)
  and `XWikiSerializer2.java` (rendering).

## S1125 — redundant boolean literal

`x == true` → `x`; `x == false` → `!x`. Ternary shapes: `cond ? x : true` → `!cond || x`;
`cond ? x : false` → `cond && x`; `cond ? true : y` → `cond || y`; `cond ? false : y` → `!cond && y`.
An operand that is a boxed `Boolean` auto-unboxes — still correct.

## S1488 — inline an immediately-returned local

Delete the local and return the expression directly.

## S1264 — a `for` with neither initializer nor update is a `while`

`for (; cond; ) {` → `while (cond) {`. The loop variable stays where it is (it is mutated in the
body, which is why the `for` had no update clause). Nothing else changes.

## S3012 — replace a manual array/collection copy loop with a library call

Message: "Use `Arrays.copyOf`, `Arrays.asList`, `Collections.addAll` or `System.arraycopy` instead."

- Copying a whole array into a collection → `Collections.addAll(target, array)`.
- Copying a *sub-range* of an array into a new list →
  `new ArrayList<>(Arrays.asList(array).subList(from, to))`. Keep the `new ArrayList<>(…)` wrapper
  whenever the result is later mutated or handed on as a mutable list — `subList` returns a view and
  `Arrays.asList` a fixed-size list, so dropping the wrapper is a behaviour change, not a cleanup.
- Check the import: `Arrays` / `Collections` are frequently *not* yet imported in the file.

## S3024 — do not concatenate inside a `StringBuilder.append`

`buf.append("a" + x + "b")` → `buf.append("a").append(x).append("b")`. Use a **char** literal for a
single-character fragment (`append('%')`, `append(';')`) — that selects the `append(char)` overload
and is what the rule is after.

## S1858 — pointless `toString()` on a `String`

Drop the call. Trust the rule; it only fires when the receiver is statically a `String`.

## S1155 / S7158 — use `isEmpty()`

- **S1155**: `size() > 0` → `!isEmpty()`, `size() == 0` → `isEmpty()` (collections).
- **S7158**: `length() == 0` → `isEmpty()`, `length() > 0` (or `!= 0`) → `!isEmpty()`.

**S7158 fires on `String` receivers too, not only `StringBuilder`/`StringBuffer`.** The rule *message*
always names `StringBuilder`, but issues land on plain `String` locals and fields. Do not reject a
site because the receiver turns out to be a `String`: `isEmpty()` exists on `String` (Java 6),
`CharSequence` (default method, Java 15), `StringBuilder` and `StringBuffer`, so the transform is
correct for every receiver on which `.length()` is a *method*.

**Only `.length()`, never `.length`.** The array-length *field* has no `isEmpty()`.

Both rules only shrink the line, so the 120-column check never fires — and `!x.isEmpty()` is a unary
expression, so it never needs parentheses inside `&&`, `||`, `if`, a ternary or a `return`.

Compound conditions are common and safe, because only the flagged comparison changes:
`if (buffer.length() > 0 && buffer.charAt(buffer.length() - 1) == ' ')` →
`if (!buffer.isEmpty() && buffer.charAt(buffer.length() - 1) == ' ')`. The `length() - 1` is not a
comparison against zero and must be left alone.

Two receiver shapes that a simple chained-receiver pattern misses, both safe: a cast-parenthesized
receiver `((StringBuffer) getStackParameter(K)).length() == 0`, and redundant parentheses around the
call `if ((number.length()) == 0)`.

## S2864 — iterate `entrySet()` rather than `keySet()` + `get(k)`

Prefer `values().forEach(…)` when the key is unused. Otherwise use the `entrySet()` enhanced-for —
which is *required* when the key is used, when the body throws a checked exception, or when the body
uses `continue`/`break` or mutates an enclosing local. `Map.Entry` needs no import.

## S1612 — replace a lambda with a method reference

`x -> obj.foo(x)` → `obj::foo`. Also: block bodies `() -> { obj.foo(); }`, constructors
`s -> new Foo(s)` → `Foo::new`, `x -> x instanceof Foo` → `Foo.class::isInstance`, enum
`v -> v.name()` → `Enum::name`, and qualified `super` references.

**Import trap (build-breaker):** a method reference names its target *type*, which the lambda form
never needed imported. If that type is a nested class, or the stream's element type, and it is not
already imported, the build fails with `cannot find symbol` — add the import.
(`Type.class::isInstance` and `Type.class::cast` need no new import.)

## S1602 — useless curly braces around a single-statement lambda body

`x -> { stmt; }` → `x -> stmt`. The "…and then remove useless return keyword" message variant is
`x -> { return expr; }` → `x -> expr`.

- **Drop** when the body statement is a `throw` — that is a statement, not an expression.
- A `//` comment inside the braces moves above the enclosing statement.
- If collapsing the body onto the call line breaches 120 characters, break *before* the lambda
  argument instead: `foo(a,\n    x -> expr)`.
- Combine with S1611 (see [[syntax-rules]]) when both flag the same lambda.

## S1126 — replace an if-then-else returning booleans with a single return

`if (c) { return true; } else { return false; }` → `return c;`. The inverted shape returns `!c`. The
equals-style tail `if (!c) { return false; } … return true;` also collapses to `return c;`.

When the flagged condition returns `false`, you must **negate** it — apply De Morgan to a multi-part
condition (`!(A || B || C)` → `!A && !B && !C`) and wrap onto a `+4` continuation line if the result
breaches 120. A `//` comment between the `if` and the final `return` survives above the merged return.

This is a structural (multi-line) edit — match the exact block, never a single-line pattern replace.

## S3706 — `.stream().forEach()` → `.forEach()`

Two shapes: the flagged line *ends* with `.stream()` (fluent style, `.forEach(` on the next line) —
strip the trailing `.stream()`; or it holds `.stream().forEach(` inline — replace with `.forEach(`.

Gotcha: stripping a trailing `.stream()` can leave a bare receiver alone on its line. It compiles, but
re-join it as `recv.forEach(` with a `+4` continuation for the lambda when the one-liner would breach
120.

## S2130 — parse instead of boxing then unboxing

`Boolean.valueOf(s)` / `new Boolean(s).booleanValue()` / `Integer.valueOf(s)` / `Long.valueOf(s)` in a
primitive context → `Boolean.parseBoolean(s)` / `Integer.parseInt(s)` / `Long.parseLong(s)`.

Semantics are identical (same `NumberFormatException`; `parseBoolean(null)` and `parseBoolean("null")`
are `false` exactly as `valueOf` was), and it retires deprecated `new Boolean(…)` calls. The only
check is line length — `parseBoolean` is six characters longer than `valueOf`.

Convert an unflagged identical construct on an adjacent line too, so the method does not end up
half-converted.

## S1066 — merge collapsible nested `if`

Sonar flags the **inner** `if`. Fix: `if (A) { if (B) { BODY } }` → `if (A && B) { BODY }` — merge with
`&&`, delete the inner `if` line, dedent the body by four, remove one trailing brace. Wrap an operand
that contains a top-level `||` in parentheses.

A triple nest collapses to `if (A && B && C)` and resolves **two** issues, so count resolved issues by
key rather than by edit.

**Drop conditions:**
- The merged condition breaches 120 and cannot be cleanly wrapped onto a `+4` continuation line.
- The inner `if` is not the sole statement of the outer body (it has siblings, or an `else`).
- The **outer** `if` / `else if` has its own trailing `else` or `else if` — merging changes when that
  `else` fires. (An `else if` outer with *no* trailing `else` **is** mergeable:
  `} else if (A) { if (B) {…} }` → `} else if (A && B) {…}`.)
- A **multi-line or block comment** sits between the two `if`s, or a comment there documents the
  *outer* condition. A single-line `//` describing the *inner* condition is recoverable — move it
  above the merged `if` at the same indent.

A residual `X != null && X instanceof Y` left after merging is harmless (`instanceof` already excludes
null), not a defect to chase.

**Brace-balance check before building:** a correct merge removes exactly one `{` and one `}` per
issue, so per file the change in open-brace count must equal the change in close-brace count must
equal that file's issue count. Any mismatch means a stray or missing brace — inspect before building.

## S6353 — use the concise character class

`[0-9]` → `\\d` (likewise `[a-zA-Z0-9_]` → `\\w`, `[ \\t\\n…]` → `\\s`) inside a regex literal.
The sibling of S6397 and just as safe: the two forms are identical in Java's regex engine **unless
`UNICODE_CHARACTER_CLASS` is set**, which XWiki never does — verify with a grep for
`UNICODE_CHARACTER_CLASS` / `(?U)` before a large batch and then stop worrying about it.

Remember the source text carries a doubled backslash: the file contains `"\\d"`. Several issues on
one line are normal (a pattern with two `[0-9]` groups gives two keys) — combine them into one edit.

## S1905 — remove an unnecessary cast

Usually a genuine no-op: a cast to the declared type of the expression, or `(String)` on an
`Iterator<String>.next()`.

**Drop when the cast is an argument of an OVERLOADED method.** Removing it can silently re-dispatch
to a different overload and still compile, so the build will not catch the mistake. Read the callee's
overload set first; a cast such as `write(x, filter, (Map<String, Object>) properties)` where `write`
has several 3-argument forms is not a mechanical fix.

## S4201 — remove a null check made redundant by `instanceof`

`x != null && x instanceof T` → `x instanceof T`; `x == null || !(x instanceof T)` →
`!(x instanceof T)`. `instanceof` is `false` for `null` by definition, so this is exact. Nearly every
site is the head of an `equals()` or a `remove(Object)`, and the observed drop rate is zero.

## S1596 — `Collections.EMPTY_LIST` → `Collections.emptyList()`

Also `EMPTY_MAP`/`EMPTY_SET`. The typed factory infers its type argument from the target, so a call
site that passed the raw constant keeps compiling; it just stops being a raw type.

## S3358 — extract a nested ternary into its own statement

Give the *inner* ternary a name; leave the outer one alone.

```java
- compare = included1 ? (upper ? -1 : 1) : (upper ? 1 : -1);
+ int inclusionOrder = upper ? -1 : 1;
+ compare = included1 ? inclusionOrder : -inclusionOrder;
```

Safe whenever no operand has a side effect (which is nearly always — the XWiki pool is
comparator/ordering arithmetic). Two branches that are exact **negations** of each other collapse to
one local plus a unary minus, which clears both flagged ternaries in one edit.

The caveat is that this is a **readability judgement, not a mechanical fix**: the reviewer has to
agree that the invented name reads better than the expression it replaces. Ship it on its own branch
rather than inside a mechanical batch, so a disagreement about the naming cannot hold up the rest.

## Related

- [[index]] — rule map, denylist, universal drop conditions.
- [[syntax-rules]] — S1611, which pairs with S1602.
- [[verification]] — the build gates that confirm a fix.
