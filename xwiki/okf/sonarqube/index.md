---
title: SonarQube rule fixes — index / map
stability: durable
summary: Entry map for "what makes a SonarCloud fix correct in XWiki". Maps each rule key to the
  family file that holds its transform and its drop conditions, lists the rules never worth fixing,
  and states the drop conditions that apply to every rule.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle/JavaCodeStyle/
---

# SonarQube rule fixes — index / map

Declarative knowledge about **which SonarCloud fixes are correct in XWiki** and — far more often the
question that matters — **which look mechanical but silently break something**. Sonar's own rule
descriptions are generic; everything here is the XWiki-specific delta, learned by fixing these rules
in `xwiki-platform` / `xwiki-commons` / `xwiki-rendering`.

The *procedure* (how to find an issue, apply a batch safely, open the PR, accept the issue) is the
**`xwiki-fix-sonarqube-issue`** skill, not this corpus.

## How to use this (READ)

1. Pick the rule you are going to fix.
2. Find it in the **Rule map** below and **Read only that one family file**. Do not read the others —
   the split exists so a fix loads ~4 KB instead of ~35 KB.
3. Apply the **universal drop conditions** (below) on top of whatever that file says.

**Pool sizes are volatile and are deliberately absent here.** Nothing in this corpus tells you how
many issues a rule has, which module they are in, or whether a rule is "drained" — those change
every day.
`verify:` query the live distribution instead —
`curl -s -u "$SONARQUBE_TOKEN:" "https://sonarcloud.io/api/issues/search?organization=xwiki&componentKeys=$SONARQUBE_PROJECT_KEY&issueStatuses=OPEN&facets=rules&ps=1"`
(and read `total` from a `&rules=java:SXXXX&ps=1` query for an exact per-rule count).

## Rule map

| Rule keys | Family file |
|---|---|
| S1116 S1124 S1128 S1161 S1197 S1611 S1659 S2209 S3252 S3878 S6208 S6213 S6355 S7476 | [[syntax-rules]] |
| S1066 S1125 S1126 S1155 S1264 S1488 S1596 S1602 S1612 S1858 S1905 S2130 S2864 S3012 S3024 S3358 S3706 S4201 S6353 S6397 S7158 | [[simplification-rules]] |
| S1604 S1640 S1643 S6126 S6201 S6204 S6211 S6485 | [[modernization-rules]] |
| S125 S1068 S1118 S1130 S1144 S1172 S1185 S1481 S1854 | [[dead-code-rules]] |
| S1143 S1163 S1192 S2093 S2119 S2147 S3626 S4719 S5361 | [[constant-and-resource-rules]] |
| S2133 S3415 S5778 S5783 S5785 S5786 S6068 S8714 S8924 | [[test-code-rules]] |

Ordered roughly safest-first: comment-only and pure-syntax rules cannot change behaviour;
simplification rules need no dataflow check; modernization and dead-code rules do.

## Rules not worth fixing (denylist)

Each of these is either bad ROI or a false positive against a deliberate XWiki idiom. Verify before
"fixing" any of them:

- **`S3776`** cognitive complexity — a genuine refactor, never a mechanical fix. Likewise **`S2143`**
  (migrate to `java.time`), **`S2160`** (override `equals` in a subclass) and **`S1141`** (nested
  try) — all real design changes that deserve a JIRA issue, not a Sonar sweep.
- **`S1186`** empty method — the empty body is usually a deliberate no-op hook.
- **`S2629`** "logging arguments should not require evaluation" — **read [[logging]] before touching
  a single site.** In XWiki a log argument is *stored as an object*: a job captures the `LogEvent`
  with its raw `Object[]` and XStream-serializes it into the job log, so an explicit `toString()` at
  the call site is usually a deliberate snapshot, not redundancy. "SLF4J calls `toString()` itself"
  is the wrong justification for deleting one — SLF4J is not the only consumer. The rule is only ever
  resolved here by `@SuppressWarnings("java:S2629")` plus the inline reason, never by removing the
  eager String.
- **`javabugs:S2259`** "fix this access that will throw a NullPointerException" — not a sweep. It is
  100% `src/main`, every site needs its own dataflow argument, and the fix changes behaviour. Sonar
  reports it where its analysis cannot follow an indirection, so the false-positive rate is highest on
  the files carrying the most of them. One shape is mechanical: a helper defaulting a nullable
  parameter (`return factory != null ? factory : DEFAULT;`) called from an overload that passes
  `DEFAULT` in *as* that parameter — the analyzer takes the `null` branch, which constrains `DEFAULT`
  itself to null, then reports every dereference of the helper's result. Fix it by passing `null`, the
  documented way of asking for the default.
- **`S899`** ignored `File.delete()` result and **`S4042`** "use `java.nio.file.Files#delete`" — these
  two fire on the SAME line, so one edit looks like it clears two issues. It does not pay: the XWiki
  pool is temp-file cleanup in a `finally`, and `Files.delete` *throws*, which masks the original
  exception and creates a fresh **`S1163`**. The other S899 shape is `queue.offer()` on an unbounded
  queue (always `true`), where "doing something" with the result is a design decision.
- **`S1948`** "make this non-static field `transient` or serializable" — the exact inverse of
  **`S2065`** and load-bearing for the same reason: XWiki serializes job statuses and requests with
  XStream, which honours `transient`, so adding it changes what gets persisted.
- **`S2386`** "make this member `protected`" — reduces the visibility of a public static member →
  Revapi `java.field.visibilityReduced`, the same break as **`S5993`**.
- **`S6213`** "rename this **method**…" (`record`, `yield`, `var`) — a rename of a public method is an
  API change, and the pool sits on the `record(…)` methods of the `*QuestionRecorder` classes. The
  rule's *variable* half is a different matter and is **not** denylisted — see [[syntax-rules]].
- **`S4144`** "implementation is identical to method X" — deduplicating two methods that legitimately
  mean different things is a design decision.
- **`S115`** constant naming, **`S1214`** constants-in-interface — cross-module renames, breaking.
- **`S1845`** name differing only by capitalization — a cross-module rename of published API.
- **`S2447`** "return null from a Boolean method" — in XWiki **script services** returning `null` is a
  deliberate contract meaning "an error occurred, call `getLastError()`". Not a defect.
- **`S1215`** `System.gc()` — the enclosing method is sometimes a deliberately exposed API (`$xwiki.gc()`).
- **`S2696`** writing to a static field from an instance method — usually a lazy-init needing sync.
- **`S2157`** "add `clone()`", **`S1113`** `finalize()` — API changes, not cleanups.
- **`S2065`** remove `transient` — **load-bearing in XWiki**: job-status classes (`IndexerJob`,
  `PDFExportJobStatus`, …) are serialized by the job-status store with XStream, which honours
  `transient`. Removing it changes what gets persisted.
- **`S5845`** assert on dissimilar types — erasure can make the assertion correct as written.
- **`S5993`** reduce an abstract class's constructor to `protected` — **only outside an `internal`
  package**, where it is a real Revapi `java.method.visibilityReduced` break. Inside one it is a clean
  mechanical pool: `revapi.json` excludes `**.internal.**` from the API check, and JLS §6.6.2.2 lets
  both `super(…)` and `new AbstractX(…){…}` reach a `protected` constructor from any package while
  plain `new AbstractX(…)` is already illegal on an abstract class, so no compilable caller can break.
  Split the pool on `/internal/` in the path.
- **`S5411`** boxed → primitive `boolean`, **`S1168`** return empty instead of `null` — real
  behaviour changes. **`S1172`** remove an unused parameter — a signature change on anything
  **non-`private`**; its `private` subset is a normal mechanical pool, see [[dead-code-rules]].
- **`S1123`** "add the missing `@Deprecated` annotation / `@deprecated` Javadoc tag" — one shape needs
  prose only the API's author can write (*why*, and what to use instead); the other adds an annotation
  that changes what tools report about a published API. A product decision, not a cleanup.
- **`S6035`** "replace this alternation with a character class" — safe in principle, but the XWiki
  pool sits on `public static final String` regex constants. The value of a **compile-time constant**
  changing is a Revapi `java.field.constantValueChanged` break even when the two regexes match
  identically. Only fix it on a private or local pattern.
- **`S3824`** `Map.get()`/`containsKey()` + condition → `computeIfAbsent` — check the guarded block
  before believing the message. When it does anything beyond the single `put` (touching another key,
  logging, an early return), `computeIfAbsent` is not an equivalent rewrite.

## Universal drop conditions

These apply to every rule, on top of each family file's own list. Any one of them means **drop the
issue and pick another** — never suppress an issue merely to make it go away, and never weaken a
build gate to make a fix pass.

- **The rewritten line exceeds 120 characters** and cannot be recovered by dropping redundant
  parentheses, choosing a shorter in-scope name, or wrapping onto a `+4`-indented continuation line.
  This is consistently the single biggest cause of dropped fixes. A pre-existing over-long line with
  no slack is an unavoidable drop. (Note that files rich in a given issue are often *excluded from
  Checkstyle* at the module-pom level — which is why the debt accumulated there — but Sonar scans
  them anyway, so the 120-char rule still applies to what you write.)
- **The fix changes a public API's shape or visibility** → Revapi fails under `-Pquality`. Reducing an
  implicit-public constructor to `private`, narrowing a modifier, or removing a public member are all
  breaking. See [[backward-compatibility]]. Classes in an `internal` package are exempt (Revapi
  ignores them) and are therefore the clean subset for these rules.
- **The fix removes covered instructions from a module pinned near its coverage floor** → JaCoCo
  fails. See [[verification]] — the resolution is to drop that module from the change, never to lower
  the pinned ratio.
- **A comment or Javadoc on the flagged code explains why it is the way it is.** Treat it as
  authoritative and drop: Sonar cannot see reflective dispatch, serialization contracts, or a
  deliberate disambiguation, but the developer who wrote that comment could.
- **The code carries a `@SuppressWarnings("java:SXXXX")` for that rule** at file, class or method
  level — the team already decided. See [[code-style]] for the convention.
- **The fix would take more than roughly fifteen minutes.** These are mechanical-cleanup fixes; a
  hard one is a normal development task that deserves a JIRA issue, not a Sonar sweep.

## Retiring an issue that should not be fixed

When an issue is a genuine false positive, the resolution is **in the code, not in SonarCloud**: add
`@SuppressWarnings("java:SXXXX")` with a `//` comment above it stating why. Marking the issue
*Accepted* in SonarCloud alone hides the reasoning from the next developer, who will try to "fix" it
again. The full convention is in [[code-style]].

## Related

- [[verification]] — what makes a Sonar fix *verified* (the build gates that catch a bad one).
- [[code-style]] — the 120-column rule and the `@SuppressWarnings` convention.
- [[backward-compatibility]] — Revapi and what counts as a breaking change.
- [[code-comments]] — how to write the rationale comment that accompanies a suppression.
