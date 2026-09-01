---
title: SonarQube modernization rules
stability: durable
summary: Correct fixes and XWiki-specific drop conditions for the language-modernization rules —
  instanceof patterns, .toList()/.toSet(), EnumMap, lambdas, StringBuilder, text blocks and the
  collection factory methods. Holds the .toList() escape analysis and the EnumMap null-key break.
---

# SonarQube modernization rules

These rewrite code into a newer language or API form. They are compiler-checked in shape but **not in
behaviour** — each has a way to break at runtime that the compiler cannot see, so each has a real drop
list. Read [[index]] for the universal drop conditions first.

All of them depend on a minimum Java level. **The Java level is volatile** — it follows the XWiki
version. `verify:` read `maven.compiler.release` (or the enforcer's Java requirement) from the root
`pom.xml`, per [[code-style]] and the Java support strategy.

## S6201 — instanceof pattern matching

Message: "Replace this instanceof check and cast with 'instanceof Foo foo'". Bind a pattern variable
and delete the redundant cast. Requires Java 16+.

```java
// positive guard
if (x instanceof Foo) { ((Foo) x).m(); }        →  if (x instanceof Foo foo) { foo.m(); }
// compound && (the pattern variable scopes rightward and into the block)
x instanceof Foo && ((Foo) x).m()               →  x instanceof Foo foo && foo.m()
// ternary / return
return x instanceof Foo ? ((Foo) x).m() : y;    →  return x instanceof Foo foo ? foo.m() : y;
// negated guard with early exit (flow scoping)
if (!(x instanceof Foo)) { return; }
Foo foo = (Foo) x;                              →  if (!(x instanceof Foo foo)) { return; }
// negated || short-circuit — valid: the RHS runs only when the instanceof was true
!(x instanceof Foo) || ((Foo) x).m()            →  !(x instanceof Foo foo) || foo.m()
```

**Sonar reports one issue per cast, all keyed to the `instanceof` line.** A single line can therefore
carry two, four, even seven issues. A repeated line number is not a duplicate — count the casts in the
block to reconcile.

**Replace every cast within the pattern variable's scope.** A cast *outside* that scope (in an `else`
branch, in a later statement, or to a *different* type) is a separate matter — leave it. Casts to a
different type inside the same block are not flagged, and generic casts like `(Map<?, ?>) x` are never
flagged.

**Naming:** idiomatic camelCase, not Sonar's suggested all-lowercase. In an `equals()` method name it
for its role (`otherBlock`, `otherSource`) rather than after the type, to avoid colliding with a
field. The pattern variable may be a try-with-resources resource (it is effectively final).

**Flow-scoping shapes worth knowing:**
- `if (!(x instanceof T t)) { … } else { /* t is in scope */ }` works with no early exit — the `else`
  branch is exactly the "true" case.
- `if (obj instanceof T t) { return t; }` followed later by another declaration named `t` is a
  **compile error**: when the then-block completes abruptly the pattern variable leaks into the
  enclosing scope. Give the two different names. This bites in `getInstance(Object obj)`-style
  converters that chain two or three such `if`s.
- `if (a instanceof T t) { … } else if (a instanceof U u) { … }` — reusing the same name in both
  branches is legal, but distinct names read better.

**Drop conditions:**
- The cast cannot reach the pattern variable's flow scope — a negated `instanceof` with no early exit
  whose cast sits under a *separate* positive `instanceof`; or a negated `instanceof` used as a
  ternary or `&&` condition whose cast is in the other branch
  (`x != null && !(x instanceof Y) ? … : ((Y) x)…` short-circuits via `x == null` too, so the variable
  is not definitely assigned).
- The chosen name collides with something in scope.
- Line length — see [[index]]. Usually recoverable by re-wrapping the condition; when you do, XWiki
  style puts the `{` **on its own line** for a multi-line `if` condition (copy the shape already used
  in that file).
- **Coverage**, not correctness, is the characteristic drop cause for this rule: removing a *covered*
  `CHECKCAST` lowers the module's JaCoCo instruction ratio, so a module pinned just above its floor
  goes red under `-Pquality`. See [[verification]].

**The cleanest fodder is `equals()`-heavy code**: `if (obj instanceof XBlock && super.equals(obj))`
followed by several `((XBlock) obj).getY()` calls in an `EqualsBuilder` chain is one edit resolving
several issues with zero dataflow. Other near-zero-drop shapes: event-listener `onEvent(Event event,
…)` guards, exception-rethrow guards (`if (e instanceof XException) { throw (XException) e; }`),
servlet-filter `request`/`response instanceof HttpServlet*`, and internal `*Reference` / `*Resolver` /
`*Serializer` and AST-visitor converters.

When reusing an **existing explicit local** (`if (x instanceof Foo) { Foo foo = (Foo) x; … }`), take
that local's name into the pattern and delete its declaration. If that declaration was followed by a
blank line, deleting it leaves a stray blank right after the pattern `if {` — remove that too.

**Shapes beyond the two obvious ones** (all safe, and all easy for a regex sweep to miss):
- **`} else if (x instanceof T) {` chains** — the converter's most common site (type-dispatch
  converters such as `InputSourceConverter` / `OutputTargetConverter` are entirely this shape). If you
  locate the block by brace-matching from the flagged line, skip that leading `}` first or the block
  looks one line long and every site in the chain reads as "no cast found".
- **A bare cast in argument position** — `new DefaultFileInputSource((File) value)` → `…(file)`. Only
  the `((T) x).m()` form needs the outer parentheses removed; a bare `(T) x` is replaced by the pattern
  variable as-is, and a pattern variable is an atom so precedence never changes.
- **A non-identifier operand** — `arguments[arguments.length - 1] instanceof Throwable last` and
  `types[types.length - 1] instanceof Class clazz` are legal and clear away the duplicated index
  expression too.
- **An array type** — `value instanceof byte[] bytes` is valid Java 16+.

**Naming, once more:** lower-casing only the first letter mangles acronyms (`URL` → `uRL`); write
`url`. And a pattern variable name may be **reused** in sibling `if` blocks and in other methods of the
same class, so the plain name is almost always available — prefer `logTreeNode` four times over
inventing `theLogTreeNode` / `logTreeNodeValue`.

### Three traps when SCRIPTING the cast replacement

Each of these produces code that looks plausible in a summary table and is obvious in `git diff -U0`.

- **`((T) x)` only owns its outer paren when a `.` follows it.** Replacing the bare string `((T) x)`
  turns `compareTo((Element) obj)` into `compareToelement` — the outer `(` there belongs to the
  *enclosing call*. Replace `((T) x).` → `name.` first, then the bare `(T) x` → `name`; never the
  parenthesized form on its own.
- **Brace-count the block from the `{`, not from the start of the line.** On the very common
  `} else if (x instanceof T) {` the leading `}` cancels the opening brace, the scope collapses to a
  single line, and every site in an else-if chain reports "no cast found in scope".
- **A `\b` after the type name does not match an array type.** `String[]` is followed by `)`, and
  `]` is already a non-word character, so `instanceof\s+([\w.]+(?:\[\])?)\b` silently backtracks
  to capture `String` and then looks for a `(String) x` cast that does not exist. Use a negative
  lookahead (`(?![\w\[])`) instead.

## S6204 / S6211 — `collect(Collectors.toList()/toSet())` → `.toList()` / `.toSet()`

Mechanically trivial, but **`.toList()` returns an UNMODIFIABLE list** where `Collectors.toList()`
returned a mutable `ArrayList`. The question is therefore not "is it mutated here" but **"can it
escape into an API where an external caller could mutate it"**. This is the number-one reviewer
objection on this rule.

**Convert when the result stays confined:** returned, iterated, `isEmpty`/`size`/`get`/`toArray`-ed
locally, or used as the *source* of an `addAll` (the elements are copied out and the unmodifiable list
discarded). Test-code lists built only for `assertEquals` or iteration are safe.

**Drop when it escapes:**
- The result is later `add`/`set`/`remove`/`sort`/`removeIf`-ed, or assigned to an `ArrayList`-typed
  target.
- **Script-exposed escape** — the characteristic XWiki drop. A `private` collector method whose result
  is returned up through a public `ScriptService` method, or any `internal` method whose result reaches
  a `@Component` role's return type callable from Velocity, must be dropped: Velocity callers are
  untraceable and can `.add()` or `.sort()` the list. **Trace the return chain to the outermost
  public or role-bearing method**, not just the immediate caller.
- **"Passed to a setter or constructor" is not automatically safe.** If the setter stores the list *by
  reference* (`this.x = x;`) on a non-`internal` public model class whose getter returns it directly,
  the unmodifiable list becomes the live backing list of a public getter, and an extension calling
  `obj.getX().add(…)` breaks at runtime. Read the target setter *and* getter before trusting it.

**Two ways out of the escape case**, both accepted by reviewers:
- **Sibling-branch signal (strong safe signal, even for a public method):** if another return branch of
  the *same* method already returns an unmodifiable list (`Collections.emptyList()`, `List.of()`), the
  method's contract is already read-only — a caller doing `getX().add(…)` would already break on that
  branch. Converting the other branch is consistent with the existing contract, not a regression.
- **Defensive-copy setter** (preferred when the model class is XWiki-owned): keep the `.toList()` and
  make the setter copy — `this.x = x == null ? null : new ArrayList<>(x);`. That clears the Sonar issue
  *and* preserves the mutable-getter contract, so the escaping list no longer matters.

A REST JAXB response DTO (`*.rest.model.jaxb`) built once and only serialized is safe.

`.toList()` is shorter than the original, so line length never breaches.

**Orphaned-import pitfall (build-breaker).** After converting a file, drop
`import java.util.stream.Collectors;` only if `Collectors.` no longer appears **outside import lines**.
A naive whole-file substring test is fooled by a surviving
`import static java.util.stream.Collectors.joining;`, which literally contains `Collectors.` — the
plain import is then wrongly kept and Checkstyle `UnusedImports` fails the build. The two import forms
can coexist, and the static one being used does *not* keep the plain one alive. Keep the plain import
when a sibling `Collectors.toSet`/`joining`/`toMap`/`groupingBy` genuinely survives. The
`import static …Collectors.toList;` variant shows up in code as a bare `.collect(toList())`.

## S6485 — use the collection factory method instead of the sizing constructor

Message: "Replace this call to the constructor with the better suited static method
`HashMap.newHashMap`." Applies to `new HashMap<>(n)`, `new HashSet<>(n)`, `new LinkedHashMap<>(n)` and
`new LinkedHashSet<>(n)` → `HashMap.newHashMap(n)`, `HashSet.newHashSet(n)`,
`LinkedHashMap.newLinkedHashMap(n)`, `LinkedHashSet.newLinkedHashSet(n)`. Requires **Java 19+**.

The point of the rule is intent: the constructor argument is an *initial capacity*, while nearly every
XWiki call site passes an expected element count (`new HashSet<>(references.size())`, `new HashMap<>(4)`).
The factory sizes the table so that many mappings fit without rehashing. Nothing observable changes —
same type, same contents, same iteration semantics — so this is one of the safest rules there is.

- No import is needed (the type is already imported to be constructed) and the target type infers from
  the assignment, so `Set<String> s = LinkedHashSet.newLinkedHashSet(n);` is fine.
- The copy constructor `new LinkedHashMap<>(otherMap)` is **not** flagged — do not convert it; the
  factory takes an int.
- Sonar does not flag `new HashMap<>()`; leave the no-arg form alone.
- The only real check is line length: the call is ~7-14 characters longer than the constructor.

## S1640 — convert a `Map` with enum keys to `EnumMap`

Keep the declared type (`Map<TheEnum, V>`) and change only the constructor:
`new HashMap<>()` → `new EnumMap<>(TheEnum.class)`. Add `import java.util.EnumMap;` and drop the
`HashMap` import if the simple name no longer occurs. A nested enum needs qualification
(`Outer.ParametersKey.class`) or the outer class imported.

**Drop conditions:**
- **`EnumMap` rejects `null` keys.** `put(null, …)` throws NPE where `HashMap` accepted it. This is a
  **runtime** break invisible to the compiler, and on a class-initializer path it surfaces as an
  `ExceptionInInitializerError` cascading into `NoClassDefFoundError` in unrelated tests. XWiki has a
  real instance of this idiom: `Right` (in `security-authorization-api`) uses a `null` `EntityType` key
  as an "all entity types" wildcard via `enableFor(null, …)`. Before converting a **main-code** map,
  check every `.put(` and every initializer for a possibly-null key — grepping for a literal
  `.put(null` is necessary but not sufficient, since the key can be a nullable variable.
- **Iteration order changes**: `EnumMap` iterates in enum *ordinal* order, `HashMap` in hash order.
  Irrelevant for lookup-by-key and for test-assertion maps, but drop any site whose output depends on
  iteration order.
- The constructor already takes an initial capacity or a source map, or the key is not actually an enum.

Test-assertion maps are the safest sites. Because the null-key break is runtime-only, the module's
tests must actually run — see [[verification]].

## S1604 — make an anonymous inner class a lambda

Applies to an anonymous class implementing a **functional interface** (one abstract method). Use an
expression body when the method just returns, a block body otherwise. Common XWiki targets:
`Comparator`, `Runnable`, `Visitor`, `BlockFilter`, `ElementSelector`, and even `Iterable` (its single
abstract method is `iterator()`).

**Drop conditions:**
- **`this` means something different.** In an anonymous class `this` is the anonymous instance; in a
  lambda it is the *enclosing* instance. If the body references `this`, or its own instance fields or
  methods, this is not a plain conversion — drop. References to enclosing fields/methods and to
  effectively-final locals are identical in both forms and are fine.
- **Lambda parameters share the enclosing method's scope**, so a parameter may not shadow a variable
  in scope. Where an anonymous-class method parameter had its own scope and could shadow freely, the
  lambda is a compile error — rename the lambda parameter (for example a `BlockFilter` lambda inside
  `createLink(Block block, …)` needs its parameter renamed from `block`).
- **The target method is overloaded on two functional interfaces with the same descriptor** — the
  anonymous class names which one it implements, an implicitly-typed lambda cannot, and the call
  becomes `reference to … is ambiguous`. The XWiki instance is
  `AccessController.doPrivileged(new PrivilegedAction<T>() {…}, acc)` in the legacy
  `URIClassLoader`: `doPrivileged(PrivilegedAction, AccessControlContext)` and
  `doPrivileged(PrivilegedExceptionAction, AccessControlContext)` both match, so **every
  `doPrivileged` site is a permanent drop** (a disambiguating cast would be worse code than the
  anonymous class). Where the enclosing method is overloaded like this, either check the JDK
  signature or settle it with a ten-line `javac` probe before editing.

Remove the now-unused interface import only after a word-boundary check that the simple name is truly
gone — it often survives as a method return type or field type. Delete any dangling `@Override` or
method Javadoc left behind. A one-line lambda that breaches 120 should be wrapped to a block body
rather than dropped.

## S1643 — use a `StringBuilder` instead of `+=` in a loop

Declare a `StringBuilder` before the loop (seeded with any pre-loop value), replace each `x += expr`
with `builder.append(expr)`, and assign `x = builder.toString()` after the loop. `StringBuilder` is in
`java.lang`, so no import. This is more surgery than the other rules in this family — verify each site.

**Drop conditions:**
- **Prepend, not tail-append.** `x = expr + x` — zero-padding (`s = "0" + s`), or building a reversed
  or hierarchical string (`number = seg + "." + number`) — is order-sensitive, and a plain `append`
  reverses the output. XWiki has real instances in `PasswordClass` and `TOCGenerator`.
- **The loop condition or body reads the intermediate string.** If the loop tests `x.length()` or
  otherwise reads `x` between concatenations, the running `String` value is load-bearing.

**Trap — a `StringBuilder` passed to a mock-verified call breaks the test.** If the accumulated value
flows into a method call that a test verifies by argument equality (Mockito
`verify(logger).warn(msg, value)`), passing the `StringBuilder` **directly** fails: `StringBuilder`
does not override `equals`, so it never equals the expected `String` — even though at runtime SLF4J or
`String.format` calls `toString()` and the real output is identical. Materialise it at the use site
with `.toString()` and keep the builder for accumulation only. General rule: when the built value is
handed to any API a test asserts on, call `.toString()`.

## S6126 — replace String concatenation with a text block

Message: "Replace this String concatenation with Text block." Fires on a multi-line
`"a\n" + "b\n" + "c"` concatenation. Requires Java 15+.

This is a **judgment and churn** rule, not mechanical-safe fodder — every site needs byte-identity
verification. Keep it in its own PR rather than bundling it with a mechanical batch.

**Prefer test files.** Expected-output strings passed to `assertBlocks`/`assertEquals` are the ideal
sub-pool: the test compares the exact string, so a byte-wrong conversion fails the build — full
verification for free. Be far more cautious with production strings (SQL, log messages, HTML) whose
exact content is not asserted anywhere; there a subtle whitespace slip ships silently.

**Getting byte-identity right:**
- The opening `"""` stays on the statement line (after `=`, `return`, or the method argument), then a
  newline; content lines follow. Indent every content line **and the closing `"""`** to the same
  column — Java strips the common incidental leading whitespace. Meaningful *leading* spaces need that
  line indented further than the baseline.
- **Trailing-newline rule (the number-one correctness trap):** if the original ends *without* a
  trailing `\n`, put the closing `"""` immediately after the last character (`endDocument"""`). If it
  ends *with* `\n`, the closing `"""` goes on its own line — that newline *is* the trailing `\n`. A
  blank line in the middle is just an empty content line.
- A leading fragment with no `\n` merges onto the next line: `"{{groovy}}" + "println…\n"` becomes one
  line `{{groovy}}println…`. Keep escapes (`\t`, `\\`); a lone `"` needs no escaping; never emit `"""`.
- **Remove a `// @formatter:off` / `// @formatter:on` pair only when it wraps solely the converted
  literal** (it existed to protect the manual concatenation layout). Keep it when it wraps a whole
  statement, such as a multi-argument `registerWikiMacro(…)` call.

**Drop conditions** (expect a high drop rate on this rule):
- **A resulting content line exceeds 120 characters** — the dominant cause, and it clusters on
  predictable content: DOCTYPE declarations, Velocity `{{info}}$services.localization.render(…)`
  markup rows, `$services.model.resolveObject*('xwiki:…')` reference lines, long
  `beginMetaData [[…]]` event lines, and any two no-`\n` fragments the author deliberately split to
  stay within 120 (merging re-breaches). Splitting is not an option — it would insert a newline into
  the string.
- **Meaningful trailing whitespace on a content line.** Text blocks unconditionally strip trailing
  whitespace per line, so a fragment like `"| row | 12 | 13 | 14 \n"` cannot be reproduced. Table, CSV
  and chart-data test strings are usually a whole-file drop for this reason. An all-whitespace row
  breaches both this and the length rule.
- **`\r\n` in the string.** A text block's line terminators are always `\n`; there is no way to
  emit a `\r` from a content line. Any fixture asserting CRLF input is a permanent drop.
- **No content line sits at the baseline indent.** Java strips the *minimum* indentation over all
  content lines, so a "ladder" fixture whose shallowest line still carries one meaningful leading
  space (`"            a\n" + "  a c\n" + " a c  d\n" + " e"`) loses that space. Reproducing it
  needs `\s` escapes on the shallowest lines, which reads worse than the concatenation — drop.

**A whole module's pool can be a single drop.** Every `xwiki-rendering-wikimodel` parser-test site
fails one of the three conditions above; before triaging such a pool site by site, check whether its
fixtures share a shape (wiki tables with trailing spaces, CRLF input, indent ladders).
- The string's exact content is not test-asserted **and** you cannot prove byte-identity by inspection.

## Related

- [[index]] — rule map, denylist, universal drop conditions.
- [[verification]] — why these rules in particular must be verified with the module's tests running.
- [[backward-compatibility]] — Revapi and public API shape.
