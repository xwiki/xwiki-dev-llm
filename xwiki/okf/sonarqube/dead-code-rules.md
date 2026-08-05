---
title: SonarQube dead-code and unused-code rules
stability: durable
summary: Correct fixes and XWiki-specific drop conditions for S1118, S1144, S1185, S1068, S1481 and
  S1854 — including the XWikiPluginManager reflective-dispatch false positive, Hibernate-mapped
  accessors, and the Revapi/FinalClass follow-ons of adding a private constructor.
---

# SonarQube dead-code and unused-code rules

S1068 · S1118 · S1144 · S1185 · S1481 · S1854

Removing code is where Sonar is least able to see XWiki's actual runtime behaviour: the framework
reaches into classes reflectively in several places, and what looks dead to a static analyser is
load-bearing. **This family has the highest false-positive rate of any covered here** — triage the
class *kind* before committing to a fix. Read [[index]] for the universal drop conditions first.

## S1118 — add a private constructor to a utility class

Two message variants:
- *"Add a private constructor to hide the implicit public one"* — the class has no constructor. Insert
  one after the fields and before the first method (respecting Checkstyle `DeclarationOrder`).
- *"Hide this public constructor"* — the class has a `public` constructor; change it to `private`.

**The body must contain a comment** — `{ // Utility class }`, matching the `XarUtils` / `TikaUtils`
idiom. An empty body merely trades S1118 for a fresh S1186 (empty method), and a reviewer will flag it.
A private constructor does not strictly need Javadoc.

**`FinalClass` follow-on — not optional, it is a build-breaker.** A class whose only constructor is now
`private` trips Checkstyle `FinalClass` ("Class X should be declared as final") and `-Pquality` fails.
Add `final` to the class **in the same edit**, after confirming it has no subclasses. This applies to
inner holder classes too (`static class Holder` → `static final class Holder`, the init-on-demand
idiom).

**Drop conditions:**
- **The constructor is actually instantiated.** Grep for `new Foo(` across the reactor — factory
  classes exposing instance methods, instantiated by a service as `new XxxFactory()`, are a common
  shape.
- **Abstract base classes designed for extension.** A `public abstract class AbstractX` holding only
  static members is already non-instantiable; a private constructor breaks its subclasses' implicit
  `super()`, and adding any constructor to a public abstract class risks Revapi. This is a false
  positive.
- **Public-API holder classes in a non-`internal` package** (for example an enum's
  `public static class Constants`): adding a private constructor *removes* the implicit public one →
  Revapi `java.method.visibilityReduced`.

**Revapi and the legacy re-export.** Reducing a previously-public (or implicit-public) constructor to
`private` on an API class is a breaking change, needing a Revapi ignore. Because `-legacy` modules
**re-export** oldcore's public classes, the same change trips the legacy module's Revapi too — the
ignore must be added in **both** the legacy module and the original. An S1118 change that skips this
leaves the affected module (typically `xwiki-platform-legacy-oldcore`) failing Revapi on a clean build
for everyone. Conversely, if your build fails Revapi on `<init>()` of legacy classes you never touched,
that is this pre-existing debt, not your change — see [[verification]].

**The safe subset** is the purely additive "add a private constructor plus `final`" on a class in an
`internal` package or a package-private inner holder, where Revapi does not apply.

## S1185 — remove an override that only calls `super`

Delete the whole method, including its Javadoc and `@Override`, when the body is only
`super.x(sameArgs)` (optionally returned).

**Critical false positive — reflective declared-method dispatch.** A pure super-call override *is*
needed, not redundant, when a framework registers behaviour by scanning the concrete class's
`getDeclaredMethods()` — inherited methods are excluded from that. In XWiki this is
**`XWikiPluginManager.initPlugin()`**: it maps a plugin to a function name only if that method is
**declared on the plugin class**. So any `com.xpn.xwiki.plugin.*` class (extending
`XWikiDefaultPlugin` or implementing `XWikiPluginInterface`, including all the `skinx` plugins) must
redeclare `endParsing`, `virtualInit` and friends *even to just call super*, or the callback stops
firing. Neither the compiler nor the tests catch the loss.

**Drop every S1185 hit in a plugin class.** The open pool for this rule is dominated by them
(`skinx`, `fileupload`, `packaging`, `jodatime`), so a whole batch is frequently 100% drops — triage
the class kind first and do not commit a build to it before confirming there are non-plugin survivors.

Other drop conditions: the method does anything else at all; it meaningfully changes the return type,
`throws` clause or visibility; it carries a behaviour-bearing annotation. And, per [[index]], an
explicit "we must override this" / "do not remove" Javadoc is a hard stop.

Plain POJOs and component implementations called through their interface, with no such dispatch, are
safe to remove. Removing the sole method of a class orphans its imports — clean them.

**"It is public API" is NOT by itself a drop reason here.** Removing a `public` super-only override
from a public, non-`internal` class passes `revapi:check` — Revapi still sees the method on the type,
inherited from the superclass. (Verified on `XWikiSerializer2.onNewLine()` in
`xwiki-rendering-wikimodel`.) A comment on the override still is a hard stop, and a method that
*widens* visibility or narrows `throws` relative to the parent is a real signature change.

## S1144 — remove an unused private method

Delete the method and anything it orphans.

**Drop conditions:**
- **Hibernate/JPA reflective accessors.** A `getX`/`setX` on a persistent entity such as
  `XWikiDocument` may be mapped **by property name** in an `*.hbm.xml` file. Grep the `.hbm.xml`
  mappings before removing any getter or setter.
- **Serialization hooks** — `writeObject`, `readObject`, `readResolve`, `writeReplace` — are called
  reflectively by Java serialization.
- **An "unused" private member inside a test *of reflection*.** `ReflectionUtilsTest` declares
  `privateMethod` / `privateParentMethod` purely so the assertions can name them in the expected
  `getAllMethods()` output — used, never called. Before removing a private member from any test whose
  subject is reflection or introspection, grep the file for the member's name **as a string**.

**Removal cascades.** Deleting the method can orphan a private helper it was the sole caller of, and
that helper's field with it. Trace and delete the whole dead chain, or you leave a fresh S1144 behind.
Process multiple methods in the same file highest-line-first so earlier edits do not shift later ones.

**Check the sibling class.** A legacy `Deprecated*` class often mirrors a non-deprecated twin, usually
in a different module outside the set you are building, carrying the *same* dead method. Re-query the
rule project-wide by method name so both are fixed in one change rather than in a review round-trip.

## S1068 / S1481 / S1854 — unused field, unused local, dead store

S1068 is an unused private field; S1481 an unused local variable; S1854 a dead store.
**S1481 and S1854 fire as a pair** on the same `Type x = expr;` line — one edit clears both.

**The fix depends on whether the right-hand side has side effects:**
- Pure right-hand side → delete the whole declaration line.
- **Side-effecting right-hand side → keep the call as a bare statement** and drop only the
  `Type name = ` prefix. Side effects that must be kept include `doc.addAttachment` and
  `doc.newXObject` (they mutate the document the assertions later check), `registerMockComponent`, a
  lazily-initializing getter, and `velocityManager.getVelocityContext()`.

Other shapes: an `x = null` dead store in an `else` whose `if` returns → delete the whole
`} else { x = null; }`. A trailing dead `timer++` → drop just the `++` and keep the read.

**Removal cascades** here too: deleting `T x = other.getFoo()` can newly orphan `other`, or a sibling
local that only fed it. Sonar flags only the outermost one. Trace each removed right-hand side's
inputs and delete the whole dead chain — pure getters only, keeping side-effecting calls.

Removing a private `LOGGER` or other field usually orphans its import. Clean up what the removal
leaves behind: a comment that solely described the removed line, a field's Javadoc, and stray blank
lines (doubled blanks, a trailing blank before `}`, a leading blank after `{`). Assert that each blank
line you delete is genuinely blank — a line hint can point one line off, at the next member's `/**`.

**Drop conditions:** the variable is assigned in several places; the field is exposed through a public
setter (API — see [[backward-compatibility]]); a dead store whose call would have to *move* to be
preserved. A write-only field or variable assigned in exactly one place **is** fixable — delete the
declaration and that assignment. An `@Override` setter's now-unused parameter is not re-flagged
(S1172 skips overrides).

## Related

- [[index]] — rule map, denylist, universal drop conditions.
- [[verification]] — the coverage and Revapi gates these rules trip most often.
- [[backward-compatibility]] — what Revapi considers breaking.
- [[component-system]] — why a component implementation's methods are reached through its role.
