---
title: Hibernate data migrations and document-queueing migrations
stability: durable
summary: A data migration is a versioned component run at startup per wiki; AbstractDocumentsMigration
  only *queues* documents into the async indexing queue and a TaskConsumer does the real work. Three
  rules that make such a pair a silent no-op are documented here - the empty-string locale, the
  "current" resolver hint in the consumer, and the length()>0 guard in HQL for Oracle.
sources:
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-oldcore/src/main/java/org/xwiki/internal/migration/AbstractDocumentsMigration.java
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-index/xwiki-platform-index-default/src/main/java/org/xwiki/index/internal/TaskExecutor.java
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-oldcore/src/main/java/com/xpn/xwiki/store/migration/hibernate/HibernateDataMigrationManager.java
---

# Hibernate data migrations and document-queueing migrations

## Shape

A Hibernate data migration is a component named `R<version>XWIKI<issue>` (e.g.
`R180600000XWIKI20699`) declaring a `XWikiDBVersion`. `HibernateDataMigrationManager` runs the
migrations whose version is above the stored one, **once per wiki**, at startup, when
`xwiki.store.migration=1` is set in `xwiki.cfg`.

## The queueing pattern

`AbstractDocumentsMigration` subclasses implement `selectDocuments()` (usually an HQL query) and
`getTaskType()`. The migration itself **does not modify any document**: it calls
`TaskManager.addTask(wikiId, docId, taskType)` for each selected reference, writing rows into the
async indexing queue (table `xwikidocumentindexingqueue`). A separate `TaskConsumer`, registered
under the task type id, performs the actual change later, asynchronously.

Consequences worth knowing: the migration finishing does **not** mean the data was migrated, so any
verification must drain the queue first; and the migration and the consumer fail independently and
silently.

## Three rules for such a pair

**1. Pass `""`, never `null`, as the locale.** `AbstractDocumentsMigration.parseLocale` does
`Optional.ofNullable(LocaleUtils.toLocale(locale))`, and `toLocale(null)` *returns null* rather than
throwing — only `""` maps to `Locale.ROOT`. With `null`, every document resolves to
`Optional.empty()` and the migration queues nothing while reporting success (symptom: `[0] documents
queued to task [...]`, preceded by `Failed to resolve document reference [X] with locale [null]`
warnings).

`""`/ROOT is also usually the semantically correct choice: XObjects are held only by a document's
original, never by its translations, and `XWikiDocument.getId()` hashes `getLocalKey()`, which
appends the locale only when it is not ROOT — so ROOT yields the id of the row that actually holds
the objects.

**2. A `TaskConsumer` that compares resolved references must inject its resolver with
`@Named("current")`.** The default (unhinted) resolver resolves against the configured default wiki,
so on a subwiki a locally serialized reference resolves to `xwiki:Space.Page` while the document is
`subwikione:Space.Page` — never equal, and every subwiki is silently skipped. `TaskExecutor` sets
the context wiki from the task (`xWikiContext.setWikiId(task.getWikiId())`) before calling
`consume()`, so the "current" resolver is correct in both cases. On the main wiki the two coincide,
which hides the defect entirely.

This applies only to code that receives a *locally* serialized reference. Code fed a fully qualified
reference string (as REST resources produce, via the default `EntityReferenceSerializer<String>`) is
unaffected, because the resolver has nothing to guess.

**3. Guard possibly-empty strings in HQL with `length(x) > 0`, not `<> ''`.** Oracle stores the empty
string as NULL, so a comparison with `''` never matches there. See [[data-migration-validation]].

## Why unit tests do not catch rules 1 and 2

A unit test that mocks the resolver and stubs its return value cannot be affected by *which*
implementation is injected, so rule 2 is structurally invisible to it — the only signal is that
adding the hint breaks the existing test's `@MockComponent`, because the mock stops matching the
injection point. Rule 1 needs a test asserting the exact ids queued. Rule 3 needs a real Oracle.
Validation approach: [[data-migration-validation]].

See also [[component-system]] for hints in general.
