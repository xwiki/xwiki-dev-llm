---
title: Solr search backend (embedded vs remote/standalone, multi-core setup)
stability: durable
summary: XWiki indexes into Solr and runs an embedded Solr by default; it can be externalised to a
  standalone/remote Solr. A remote Solr needs several pre-created cores (search, extension_index,
  ratings, events) named <prefix>_<core>_<solrMajorVersion> (e.g. xwiki_search_9) because XWiki
  cannot create them itself (the Solr REST API is too limited). Configure it with solr.type=remote +
  solr.remote.baseURL (the Solr base URL under which XWiki manages all cores), not the single-core
  solr.remote.url. The search core also needs Solr's analysis-extras module.
sources:
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Solr%20Search%20API
  - https://www.xwiki.org/xwiki/bin/view/Documentation/AdminGuide/Installation/InstallationViaAPT/#HStandaloneSolrsetup
---

# Solr search backend

XWiki uses Apache Solr as its indexing/search engine (search, the extension index, ratings and the
event/notification store all live in Solr). By default XWiki starts an **embedded** Solr inside the
same JVM, writing its data under the permanent directory (`store/solr`). For larger wikis the Solr
team recommends **externalising** it to a standalone (remote) Solr server — the embedded instance is
mainly there for ease of use.

## A remote Solr needs several cores, and XWiki does not create them

The Solr REST API is too limited for XWiki to create its cores remotely, so on a standalone Solr the
cores must be **pre-created before XWiki starts**. XWiki uses one core per subsystem:

- `search` — the full-text search index; uses the **full** core configuration.
- `extension_index` — the Extension Manager index.
- `ratings` — the ratings store.
- `events` — the event/notification store.

`extension_index`, `ratings` and `events` use the **minimal** core configuration. Cores are named
`<prefix>_<core>_<solrMajorVersion>` — e.g. `xwiki_search_9`, `xwiki_events_9`. The prefix is
`solr.remote.corePrefix` (default `xwiki`) and the trailing number is the Solr **major** version.

Pre-built core configurations are published per XWiki version, in two equivalent forms:

- ZIPs on `maven.xwiki.org`: `xwiki-platform-search-solr-server-core-search` (full) and
  `xwiki-platform-search-solr-server-core-minimal` (the other three).
- Debian packages on `nexus.xwiki.org`: `xwiki-platform-distribution-debian-solr-core-<core>`, which
  unpack to `/var/solr/data/xwiki_<core>_9` with the core's `core.properties`, `conf/` and `lib/`
  (the layout the official `solr` image expects).

Custom cores can be reserved/initialised in-code via the `org.xwiki.search.solr.SolrCoreInitializer`
component role (with `AbstractSolrCoreInitializer` for schema create/migrate helpers) — but that
automation does **not** create the core on a remote Solr; that step stays manual.

## Configuring a remote Solr (xwiki.properties)

```properties
solr.type=remote
solr.remote.baseURL=http://solrhost:8983/solr
```

`solr.remote.baseURL` is the Solr **base URL**, not a single core: XWiki appends each core name under
it and manages several clients. The older single-core `solr.remote.url` property only points at one
core (the search core) and therefore cannot drive the multi-core setup — use `baseURL`.

## Solr version compatibility and the analysis-extras module

Each XWiki version embeds/tests one specific Solr version, and a standalone Solr may run the current
or previous major version (Solr supports N and N-1). XWiki 16.2.0+ uses Solr 9.x. Because the exact
matrix evolves per release, read it from the extension page (`sources:`) rather than caching it here.

Since XWiki 16.6.0 the search core's schema relies on language analyzers (e.g. the Polish
`stempelPolishStem` filter) that live in Solr's optional **`analysis-extras`** module, so that module
must be enabled on the standalone Solr (`SOLR_MODULES=analysis-extras` for the official Solr image);
without it the search core fails to load with an SPI class error. The pre-built core packages cannot
bundle it.

The official Docker image (`xwiki`, repo `xwiki/docker-xwiki`) exposes this through a single
`SOLR_BASE_URL` environment variable, which its entrypoint maps to the two properties above; a helper
Solr image under `contrib/solr/` pre-creates the four cores.
