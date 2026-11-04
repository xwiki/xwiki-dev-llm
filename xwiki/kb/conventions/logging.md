---
title: Logging — a log argument is an object, not text
stability: durable
summary: In XWiki a log argument is stored as an object, XStream-serialized into the job log and
  rendered later by type, so forcing a String and passing the object are each wrong in different
  cases. The decision table, the mechanism behind it, and the java:S2629 interaction.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle/JavaCodeStyle/#HLoggingBestPractices
---

# Logging — a log argument is an object, not text

The general rules (SLF4J parameterized form, never `String.format` or concatenation in a log call,
`[]` around parameters, root cause via `ExceptionUtils.getRootCauseMessage()`, never drop a caught
exception) are on the dev wiki `JavaCodeStyle` page, which is the source of truth. This file covers
the XWiki-specific part that the generic SLF4J advice gets wrong.

## Why an argument is not just something to render

- `AbstractJobStatus` pushes a `LoggerListener`, which forwards **any** `LogEvent` regardless of
  level, so every log call *enabled at its level* on a job thread is captured into that job's log,
  whatever class emitted it — a class needs to know nothing about jobs to end up in one. `warn` and
  `error` are always enabled with the default configuration and so are **always** captured; a `debug`
  call is captured too whenever debug is on, which is why an eager String under a `debug` guard still
  has to follow the rules below.
- The captured `LogEvent` keeps the raw `Object[]`; nothing is formatted at log time.
- The job log is XStream-serialized to disk (`XStreamFileLoggerTail`) argument by argument in
  `SafeMessageConverter.marshal()`: an argument whose class `XStreamUtils.isSerializable()` accepts is
  written as a **full object graph**, and only the rest are reduced to `toString()`.
  `isSerializable()` **defaults to `true`** — anything that is not a `@Component`, `Logger`,
  `Provider` or stream is serialized completely, including everything that merely happens to
  implement `java.io.Serializable`.
- On read, `SafeArrayConverter.readBareItem()` turns **any failure into `null`** (logged at debug
  only). An argument whose class can no longer be resolved is therefore lost, where a String would
  have survived.
- Consumers read arguments **by type**: the log displayers render some types richly (entity
  references and extension ids as links), and `Importer` casts `log.getArgumentArray()[0]` to
  `EntityReference`.

## Decision table

**Pass the object** when it is a small, stable, always-resolvable value type that a displayer can
render richly:

- `EntityReference` / `DocumentReference` and other model references
- `ExtensionId`, `Version`
- enums, `String`, `Number`, `Boolean`, `File`
- a `@Component` instance — the converter already stringifies it, so the plain object is equivalent
- a `Collection`, whose `toString()` already brackets its content (so do not add `[]` in the message
  for it either)

**Force an eager String** when the argument is any of:

- an **arbitrary `Object`** whose type is not known at compile time (an event `source`, a progress
  step source) — nothing useful can be kept, and the graph is unbounded
- a **live resource**: a Hibernate `Session`, a connection, a stream — several of these implement
  `Serializable` and would be walked field by field
- a **mutable builder**: a `StringBuilder` is serialized as its internal char array, and its value can
  change between the log call and the rendering
- a **request or plan-sized graph**: `Request` is `Serializable`, so a job logging its own request
  puts a copy of it in its own log
- an object whose `toString()` is **deliberately narrower than its fields** — e.g.
  `MailConfiguration.toString()` masks the SMTP password that the object carries in clear text, and
  `Mail.toString()` omits the body and the attachments
- a `Class` or a `Type` **from an extension jar**, which may be unresolvable when the log is read back
  (use `getName()` / `getTypeName()`)

Prefer `String.valueOf(x)` over `x.toString()` when the value can be null, `getName()` /
`getTypeName()` for a `Class` / `Type`, and a String local when one is needed anyway for another
purpose.

## Never silently remove an explicit toString()

"SLF4J calls `toString()` itself, so this is redundant" does not hold — SLF4J is not the only
consumer. Two further justifications that look right and are not:

- *"It is eager."* `warn` and `error` are always enabled, so nothing is saved by deferring. It only
  matters under a `debug`/`trace` level guard.
- *"It NPEs on null."* True, but the fix is `String.valueOf(x)`, not passing the object.

When writing such a site, **state the reason inline** (log arguments are serialized into the job log,
plus the site-specific consequence), so the next audit does not remove it again.

## java:S2629 interaction

`java:S2629` ("`Preconditions` and logging arguments should not require evaluation") fires on the
eager String. Per its implementation (`LazyArgEvaluationCheck` in sonar-java) it:

- only examines arguments whose **static type is `String`** — passing the raw object is never flagged;
- exempts **no-arg `get*`/`is*` calls**, so `getName()` / `getTypeName()` produce no issue, while
  `toString()`, `String.valueOf(x)` and `getRootCauseMessage(e)` (a `get*` **with** a parameter) do;
- skips the log call entirely when it is inside a **`catch` block** or inside a **level guard**
  (`if (logger.isDebugEnabled())`);
- does not follow locals, so assigning to a String local first also produces no issue.

Where a suppression is genuinely needed, use `@SuppressWarnings("java:S2629")` on the enclosing
method with the explanatory comment at the call site. That is the house convention (see the
`java:S2789` suppressions in `ServletEnvironment`); `NOSONAR` is not used in these repositories.

See also [[code-comments]] for how to word the inline reason, and [[code-style]] for the general
formatting rules.
