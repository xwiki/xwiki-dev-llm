---
title: Data migrations and the document-queueing pattern
stability: durable
summary: A Hibernate data migration runs once per wiki at startup; AbstractDocumentsMigration only
  queues documents into the async indexing queue and a TaskConsumer does the work later. Three rules
  keep such a pair from being a silent no-op, and only a real cross-engine upgrade proves it works.
verify: The engine versions supported by a release are in that release's Release Notes; the engine
  list and the "Latest + LTS" policy are on the Database Support Strategy page.
sources:
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-oldcore/src/main/java/org/xwiki/internal/migration/AbstractDocumentsMigration.java
  - https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/DatabaseSupportStrategy
---

# Data migrations and the document-queueing pattern

A Hibernate data migration is a component named `R<version>XWIKI<issue>` declaring a
`XWikiDBVersion`; `HibernateDataMigrationManager` runs those above the stored version **once per
wiki** at startup, when `xwiki.cfg` sets `xwiki.store.migration=1`.

`AbstractDocumentsMigration` subclasses change **no document**: `selectDocuments()` feeds
`TaskManager.addTask(...)`, which only writes rows into the async indexing queue, and a
`TaskConsumer` registered under the task type does the real work later. So the migration reporting
success does not mean the data changed, and the two halves fail independently and silently.

Three rules keep such a pair from being a silent no-op:

1. **Pass `""`, never `null`, as the locale.** `LocaleUtils.toLocale(null)` *returns* null instead of
   throwing, so `parseLocale` yields `Optional.empty()` and nothing is queued (symptom: `[0]
   documents queued`). `""`/ROOT is also the right target: only the original document holds XObjects,
   and `XWikiDocument.getId()` appends the locale to the hashed key only when it is not ROOT.
2. **A `TaskConsumer` comparing resolved references must inject `@Named("current")`.** Given a
   *locally* serialized reference the default resolver uses the default wiki, so on a subwiki nothing
   ever matches and every subwiki is skipped — invisible on the main wiki, where the two coincide.
   `TaskExecutor` sets the context wiki from the task before calling `consume()`.
3. **Guard possibly-empty strings in HQL with `length(x) > 0`, not `<> ''`** — Oracle stores the
   empty string as NULL, so `<> ''` never matches there.

Unit tests cannot catch rules 1 and 2 (a mocked resolver behaves the same whichever implementation is
injected), so validate with a **real upgrade**: install the FROM version, seed with it, redeploy the
TO version and let the migration run — on a **subwiki as well as the main wiki**, **draining the task
queue before asserting**, and on **Oracle**, whose `''`=NULL also makes an assertion about blanking
unfalsifiable unless it distinguishes NULL from `''`. A subwiki is a separate database on
MySQL/MariaDB but a schema on PostgreSQL/Oracle, so prove a cross-wiki SQL check is wiki-aware with a
sentinel before trusting it.
