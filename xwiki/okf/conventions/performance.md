---
title: Resource efficiency (memory and streaming)
stability: durable
summary: Prefer streaming over buffering when handling potentially large data (request/response
  bodies, attachments, files, exports, query results); never load an unbounded payload fully into
  memory.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices
---

# Resource efficiency (memory and streaming)

The concise, always-on version of this rule is injected into every XWiki session via
`instructions/xwiki-org.md`. This is the expandable home.

XWiki routinely handles **large payloads** — attachments, imports/exports, PDFs, unbounded query
result sets. Code that buffers a whole payload in the heap looks fine in unit tests (small inputs)
but causes `OutOfMemoryError` and GC pressure in production under real data or concurrency. Size is
frequently driven by *user* input, so "it's usually small" is not a safe assumption. Favour bounded,
streaming implementations, and treat a design that holds a whole body/file/result set in memory as a
red flag to justify or avoid.

## Rules

- **Stream, don't buffer.** When the amount of data is driven by user input (a request or response
  body, an attachment, an uploaded file, an export), process it through `InputStream` /
  `OutputStream` pipelines rather than reading it into a `byte[]`, `String`, `ByteArrayOutputStream`,
  or a `List`/`Map` holding the whole thing.
- **Avoid the tempting one-liners on unbounded input**: `IOUtils.toByteArray(…)`,
  `IOUtils.toString(…)`, `InputStream#readAllBytes()`, `Files#readAllBytes(…)`. They are acceptable
  only for data known to be small and bounded (a config file, a fixed template) — never for
  attachments, uploads, or message bodies.
- **Compose streams** with `InputStream#transferTo(out)`, `SequenceInputStream`, and wrappers that
  read lazily, so heap usage stays flat regardless of payload size.
- **Measure without reading.** Get sizes from metadata (`Part#getSize()`,
  `XWikiAttachment#getLongSize()`) instead of reading the content to count its bytes.
- **Collections and queries:** prefer pagination / batching (`Query#setLimit` / `setOffset`,
  iterating in chunks) over loading an entire, unbounded result set at once.
- **Release deterministically:** use try-with-resources so streamed resources (temp files, DB
  cursors, part streams) are closed as soon as they are done.

## Related

- [[code-style]] — formatting and structural conventions.
