---
title: SonarQube test-code rules
stability: durable
summary: Correct fixes and XWiki-specific drop conditions for the test-code rules — including why
  assertEquals must not replace assertTrue(a.equals(b)) inside equals()/hashCode() contract tests,
  when the expected/actual swap is safe and the two shapes that must be dropped, how far a Mockito
  eq() unwrap may reach, and why hoisting out of an assertThrows lambda must never move the throwing
  call.
---

# SonarQube test-code rules

These touch only test code, so production behaviour is untouched and review risk is low. But the
module's tests actually run during verification, so a wrong edit fails the build rather than shipping
silently — which makes this family safe in a different way from the others. Read [[index]] for the
universal drop conditions first.

## S5786 — a JUnit 5 test class or method should be package-private

Two message variants: method-level *"Remove this 'public' modifier"* and class-level *"Remove
redundant visibility modifiers…"*.

**Do not infer the scope from the message or the line** — the method-level message frequently points
at the class declaration. Key the fix **by file** instead: strip the leading `public ` from

- the class declaration (including nested and `@Nested` classes), and
- every method whose immediately preceding contiguous annotation block contains a **real JUnit
  annotation**: `@Test`, `@BeforeEach`, `@AfterEach`, `@BeforeAll`, `@AfterAll`, `@ParameterizedTest`,
  `@RepeatedTest`, `@TestFactory`, `@TestTemplate`, `@Nested`.

Keep the other modifiers (`@BeforeAll public static void` → `static void`).

**Do not touch** fields, unannotated helper methods, or methods carrying an XWiki-specific (non-JUnit)
lifecycle annotation — `@BeforeComponent` and `@AfterComponent` methods stay public. **Nor an
`@Override`**: a JUnit-annotated method that also overrides a public parent method (`@BeforeEach
@Override void setUp()` of an abstract base test) cannot have its visibility reduced — that does not
compile. If it is the only thing left public in the file, the issue cannot be cleared; drop it rather
than shipping a half fix.

A class-level flag means the whole file's test methods get stripped, so a dense file yields far more
removals than its issue count. That is expected.

**Cross-module compile check.** `xwiki-platform-oldcore` publishes a widely used test-jar, so making a
class package-private can break another module that extends it. For each class you make
package-private, grep for `extends <Class>` across the source tree outside its own module. Grep for the **bare
class name** too: a sibling test in another package reading a constant off it
(`DefaultHTMLCleanerTest.HEADER`) blocks the change just as hard and is easier to miss. The risk is
only with `abstract` or base test classes — and note that a class *named* `Abstract*Test` is often not
actually abstract, so read the declaration rather than the name.

## S5785 — use `assertEquals` instead of `assertTrue(a.equals(b))`

### Do not apply this inside `equals()` / `hashCode()` contract tests

This is a **reviewer-rejected** transformation in that context, and the objection is right. In a test
whose *purpose* is to pin the equals contract, `assertTrue(a.equals(b))` shows at the call site which
object's `equals` runs, while `assertEquals(a, b)` hides that in JUnit internals — and Sonar's own
S3415 would later tell someone to swap the arguments, which **would** break it.

So the **site** decides, not the shape. Skip any assertion inside a `testEquals` / `equality` /
`nonEquality` / `hashCode` test method — especially `equals(null)`, `equals("other class")` and
self-equality assertions.

**The resolution is not to accept the issue in SonarCloud.** Put `@SuppressWarnings("java:S5785")`
plus a `//` rationale on the contract-test method, per the convention in [[code-style]].

Remaining fair game: assertions in ordinary tests that merely happen to use `assertTrue(x.equals(y))`
to compare two values.

Useful fact if you need to make that argument (verified against `junit-jupiter-api` bytecode): both
`assertEquals` and `assertNotEquals` route through `AssertionUtils.objectsAreEqual(a, b)`, which is
`a == null ? b == null : a.equals(b)`. So with the receiver kept first, the original `equals` call —
including `a.equals(null)` — really is still made. The transformation is mechanically safe; the point
is that the guarantee is invisible to a reader of the test.

### Mechanics, when a site does qualify

**Default to receiver-first — this is universally safe.** JUnit's `assertEquals(expected, actual)`
calls `expected.equals(actual)`, so keeping the original receiver in the first slot reproduces the
exact call, which stays correct even for a custom or asymmetric `equals` or a differently-typed
argument. **Never flip the operands** — doing so has caused real test failures.

```java
assertTrue(a.equals(b))                    → assertEquals(a, b)
assertFalse(a.equals(b))                   → assertNotEquals(a, b)
assertTrue(LIT == x)                       → assertEquals(LIT, x)
assertTrue(x != LIT)                       → assertNotEquals(LIT, x)     // covers hashCode() != 0
assertTrue(null == x)                      → assertNull(x)
assertTrue(a.hashCode() == b.hashCode())   → assertEquals(a.hashCode(), b.hashCode())
```

The degenerate `assertFalse(x.equals(null))` and `assertTrue(x.equals(x))` convert too — JUnit uses
`Objects.equals`. A `==` or `!=` between **references** is a distinct message and maps to
`assertSame` / `assertNotSame`, where operand order is cosmetic; trust the message. Only convert
flagged lines — an `assertTrue(x instanceof Y)` sibling on the next line stays. A message argument
moves to the end of the new call.

**Imports:** add the new static imports in alphabetical order, and remove `assertTrue`/`assertFalse`
only once the file no longer uses them.

**Two site-level gotchas:** identical assert lines can recur in one file, so a uniqueness assertion
will trip — diagnose rather than force it. And an already-half-fixed site (a flagged line sitting
directly above an existing equivalent assertion) should have the redundant flagged line **deleted**.

Handle this rule with a small parser rather than a pattern match: find the `assert(True|False)(` at the
flagged line, gather continuation lines to the statement's trailing `;`, paren-match to the outer
close, then split the inner text at the depth-zero `.equals(`, `==` or `!=`. That handles the
multi-line shape for free. Cross-check the function you derived against the one Sonar's message names
and abort on any mismatch — that check is what makes the batch trustworthy. Negation is
`assertFalse XOR (op == "!=")`.

## S3415 — swap the expected and actual arguments

**Mostly safe, but two shapes must be dropped — and both are visible in the flagged line.** A full
sweep of the rule needs a drop on a minority of sites, so what follows is a drop list, not a reason
to skip the rule. The **free classifier is whether either operand reads `null`**: if one does,
drop it; otherwise the swap is a pure re-ordering. The two shapes that depend on operand order (the
same root cause as "never flip operands" above):

- **Asymmetric `equals`.** `RegexEntityReference.equals` does regex matching, so
  `regexRef.equals(plain)` is not `plain.equals(regexRef)`. Swapping flips the result and breaks the
  test.
- **`assertNotEquals(obj, null)` deliberately exercises `obj.equals(null)`.** Swapping to
  `(null, obj)` short-circuits inside `Objects.equals` and no longer tests that contract.

Swap when both operands are plain values with symmetric `equals` and neither is `null`. That covers
most of the pool: an actual-side getter against a constant, a `List` against a `List`, a computed
`String` against a `CONTENT_*` constant, a numeric expression against a literal. Only read the
asserted type's `equals` implementation when the type name suggests it might be asymmetric
(`Regex*`, a matcher, a pattern holder) — the operands being of *different* static types is not by
itself a reason to look.

**Convert the whole file, not just the flagged lines.** Sonar flags only *some* of a file's reversed
assertions, apparently arbitrarily — a single test can hold several times as many as were reported,
and the `-1.0` sibling of a flagged `1.0` line goes unflagged. Shipping only the flagged half
leaves the file reading two ways, which is what a reviewer objects to; swap all of them and count only
the flagged keys as fixed.

Two mechanics: identical assertion lines repeat within one file, so extend the `old` with the unique
line above it (or assert an exact count for a global replace) rather than expecting `count == 1`; and
overload resolution is unchanged by a swap even across numeric types — `Math.signum(int)` returns
`float`, and `(float, double)` and `(double, float)` both resolve to `assertEquals(double, double)`.

Where a whole test method is nothing but such assertions, suppress the method per [[code-style]]
rather than accepting the issues in SonarCloud. `RegexEntityReferenceTest` in
`xwiki-platform-model-api` is the reference example: a class-level
`@SuppressWarnings("java:S3415")` with a multi-line rationale.

## S8924 — use a static import for a Mockito method

Message: `Use a static import for "mock"` (also `when`, `verify`, `doReturn`, …). Test code only, so
there is **zero coverage risk** — the safest batch after the comment-only rules.

Fully mechanical, with no per-site reading needed:

1. Take the flagged method names from the issue **message**, not from the line numbers — the message is
   drift-proof.
2. Replace `Mockito.<name>(` → `<name>(`. **The trailing `(` matters**: without it, `Mockito.mock(`
   also eats `Mockito.mockStatic(`.
3. Add `import static org.mockito.Mockito.<name>;` if absent. **XWiki convention: static imports form
   one alphabetically sorted block at the end of the import list, after a blank line.** Merge the new
   ones into the existing block and re-sort it; create the block after the last plain import if the
   file has none.
4. Drop `import org.mockito.Mockito;` **only if** `Mockito` no longer appears outside import lines
   (strip the import lines first, then word-search) — a surviving `Mockito.verify` or a Javadoc
   `{@link Mockito}` must keep it.

Lines only get shorter, so the 120-column check never fires.

## S6068 — remove a useless Mockito `eq()` matcher

Message: "Remove this useless `eq(...)` invocation; pass the values directly" (or "Remove this and
every subsequent useless `eq(...)` invocation"). Fix: unwrap `eq(x)` back to `x`.

**The safety argument is the whole rule.** Mockito forbids mixing raw values and matchers in one
invocation, so `eq()` is only *required* when some other argument is a matcher. Sonar raises S6068
only when **every** argument of the stubbed/verified call is an `eq()`, and in that case Mockito
treats the raw values exactly as `eq()` did — the rewrite is behaviour-preserving. It follows that:

- **Unwrap the whole statement, not just the flagged argument.** One issue key can cover several
  `eq()` calls (the "and every subsequent" message variant), and a partially-unwrapped call is an
  `InvalidUseOfMatchersException` at runtime, not a compile error. Locate the enclosing statement
  (scan up until the previous line ends in `;`/`{`/`}`, down until the line ends in `;`) and unwrap
  everything in it.
- **Never touch a call Sonar did not flag.** A call mixing `eq()` with `any()`/`argThat()`/`isNull()`
  genuinely needs its `eq()`s; those are not reported and removing one breaks the test.
- `never()`, `times(n)` and `atLeastOnce()` inside `verify(mock, …)` are not arguments of the
  verified call — they neither block nor need unwrapping.

**Scripting it:** match `eq(` only when the preceding character is not `[\w.$]` (so `Matchers.eq(`
and an identifier ending in `eq` are left alone), then find the matching `)` with a scanner that
skips string and char literals. Drop `import static org.mockito.ArgumentMatchers.eq;` only when no
`eq(` survives **outside the import lines** — files usually keep some mixed-matcher calls.

Test sources only, so there is no coverage or API risk, and the module's own test suite is the
complete verification. Lines only get shorter; where the shortened statement now fits, re-join its
continuation line rather than leaving a one-token orphan.

## S2133 — an object instantiated only to get its class

Message: "Remove this object instantiation and use `X.class` instead." The XWiki shape is a test that
builds an event purely to feed `any(event.getClass())` to a Mockito verification:

```java
final Event event = new CommentAddedEvent("wiki:space.page", "0");
…
verify(this.observationManager)
    .notify(any(event.getClass()), same(this.document), same(this.oldcore.getXWikiContext()));
```

Fix: delete the local and pass the class literal — `any(CommentAddedEvent.class)`. `getClass()` on a
`new X(...)` is exactly `X.class`, so this is behaviour-identical. The declaration usually was the
only use of an interface-typed import (`org.xwiki.observation.event.Event`); remove it too, or you
trade the issue for an `S1128`.

## S5778 / S5783 — only one method invocation may throw inside an `assertThrows` lambda

Two messages, one rule in practice: S5778 is "…only one invocation possibly throwing a **runtime**
exception", S5783 "…multiple invocations throwing the same **checked** exception". Same fix, same
check. Hoist the *other* invocations into locals above the assertion:

```java
WordBlock notExisting = new WordBlock("not existing");
assertThrows(InvalidParameterException.class, () -> parentBlock.replaceChild(word3, notExisting));
```

**The one check that decides the fix: read the call you are about to hoist and confirm it is not the
thrower.** That is the entire point of the rule — with two candidates in the lambda the test does not
say which one it is asserting on. When the hoisted call is what actually throws, moving it out puts
the exception *outside* `assertThrows` and the test fails. `BlobPath.relative("..", "bad/name")` is
the canonical example: the `IllegalArgumentException` comes from `relative()`, not from the
`resolve()` it is fed to, so that site is a drop — cleaning it up means rewriting what the test
asserts.

Hoisted locals must be effectively final (the compiler enforces it), and the shortened
`assertThrows(...)` call usually fits back on one line — re-join it.

**S5783 is the trap an S8714 conversion sets for itself.** A `try` body that *constructs* an argument
inline — `this.printer.print(new URL("http://…"))` — has two checked-exception throwers
(`MalformedURLException` from the constructor, `IOException` from the call) the moment you wrap it in
a lambda, so a clean S8714 fix ships a fresh S5783 BUG that only surfaces on the next scan. When
converting, look at the try body before wrapping it: any `new X(…)` or helper call that itself throws
a checked exception goes into a local above the assertion, named after the value
(`URL printPreviewURL = new URL(…)`), leaving exactly one throwing invocation in the lambda.

## S8714 — replace a try/catch/`fail` with `assertThrows`

Not a drop has been seen for this rule; three shapes cover the whole pool.

- **Single-call try** (~90%): `try { call(); fail("…"); } catch (T e) { assertEquals(…, e.getMessage()); }`
  becomes `T e = assertThrows(T.class, () -> call());` followed by the original assertions.
- **`catch { fail() }` with nothing else** — the test is asserting the call does *not* throw:
  `assertDoesNotThrow(() -> call())`.
- **Multi-statement try where only the last call throws** — hoist the setup statements above the
  assertion; locals stay effectively final, so the lambda still compiles.

Three follow-ons: `fail` usually becomes an unused static import (remove it, or you trade the issue
for an `S1128`); **two sites in the same test method collide** — `T e = assertThrows(…)` twice is a
duplicate local, so declare once and assign on the second site; and a try body that builds an argument
inline (`print(new URL(…))`) trades the S8714 for an **`S5783`** unless the constructor is hoisted out
of the lambda — see [[#s5778--s5783--only-one-method-invocation-may-throw-inside-an-assertthrows-lambda]].

## Related

- [[index]] — rule map, denylist, universal drop conditions.
- [[code-style]] — the `@SuppressWarnings("java:SXXXX")` + rationale convention.
- [[strategy]] — XWiki's testing conventions and where each framework lives.
- [[verification]] — the build gates.
