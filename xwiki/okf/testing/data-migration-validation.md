---
title: Validating a data migration across the supported databases
stability: durable
summary: What a real cross-engine upgrade test must cover for a data migration (the five supported
  engines, a subwiki fixture, draining the async queue) and the engine-specific behaviours that
  otherwise produce a passing-but-wrong result - chiefly that Oracle stores the empty string as NULL.
  The tested engine versions are volatile.
verify: The exact versions tested for a given release are listed in that release's Release Notes;
  the engine list and the "Latest + LTS" policy are on the Database Support Strategy page.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/DatabaseSupportStrategy
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/
---

# Validating a data migration across the supported databases

A data migration is one of the few changes whose behaviour genuinely differs per database engine, so
unit tests and a single-engine functional test are not sufficient evidence. See
[[data-migrations]] for how migrations are structured.

## The supported engines

HSQLDB (embedded, used by the standalone distribution), MySQL, MariaDB, PostgreSQL and Oracle.
Versions follow a "Latest + LTS" strategy and are **volatile** — never cache them here; read the
target release's Release Notes, or the Database Support Strategy page for the policy.

## What a meaningful validation covers

- A **real upgrade**: install the FROM version, seed data with it, redeploy the TO version and let
  the migration run at startup (`xwiki.store.migration=1`). Seeding directly into the TO version
  tests nothing.
- **A subwiki as well as the main wiki.** Several defect shapes (notably the resolver-hint rule in
  [[data-migrations]]) are invisible on the main wiki because the current and default wiki coincide
  there.
- **Draining the async task queue before asserting.** A document-queueing migration reports success
  as soon as the tasks are queued; the data changes later.
- **Assertions that distinguish NULL from the empty string** (see below), otherwise the Oracle
  result is unfalsifiable.

## Engine-specific behaviour that changes the result

- **Oracle stores the empty string as NULL.** A blanked column reads back as `NULL` on Oracle and as
  `''` on the other four, so assertions must encode the difference, and HQL must use
  `length(x) > 0` rather than `<> ''` (which never matches on Oracle).
- **`psql` and `sqlplus` render NULL and `''` identically by default.** Set `\pset null` /
  `SET NULL` explicitly, or an assertion about blanking cannot fail.
- **`SELECT 1` is invalid on Oracle** (no FROM-less SELECT) — a database readiness probe must use
  `SELECT 1 FROM dual` there.
- **A subwiki maps to different storage per engine**: a separate database on MySQL/MariaDB, a schema
  on PostgreSQL (with `xwiki.virtual_mode=schema`), Oracle (`ALTER SESSION SET CURRENT_SCHEMA`) and
  HSQLDB. A SQL check that ignores this silently re-reads the main wiki while appearing to validate
  the subwiki — prove wiki-awareness with sentinel values before trusting any cross-wiki result.

Ordering and syntax assumptions that the four fast engines satisfy silently are typically the ones
Oracle exposes; budget Oracle debugging accordingly.

## Traps when scripting such a run

- **`xwiki-platform-distribution` sits behind an inactive `distribution` Maven profile** — a
  `BUILD SUCCESS` on the core reactor produces no WAR and no flavour; the distribution must be built
  as a second phase from its own directory. Build commands live in the `xwiki-build` skill.
- **HTTP 202 from XWiki is ambiguous** — returned both while initializing and when up but awaiting
  the Distribution Wizard. Use "the REST API answers 200" as the readiness signal.
- **Setting `extension.repositories` replaces XWiki's defaults rather than appending**, so declaring
  a local Maven repository to make a locally built SNAPSHOT installable also requires re-declaring
  the standard repositories.
- **Patch the WAR's own shipped Hibernate config** rather than supplying a hand-written one: the
  mapping list is version-specific and easy to get silently wrong.
