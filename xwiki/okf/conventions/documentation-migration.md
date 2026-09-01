---
title: Handling the original page after a documentation migration
stability: durable
summary: What to do with the **source** page once its content has been migrated into the
  `/documentation` tree — repointing an old `Documentation`-space page, stripping the prose from an
  Extensions-wiki (e.x.o) extension page without deleting it (all the xproperties that hold prose,
  not just `description`), wiring the "Documentation" button through the `ExtensionLD` URL, deleting
  the original's leftover attachments, and triaging its backlinks (which to repoint, which to leave —
  the generic "fix backlinks before deleting any page" rule and the mechanics of getting the list are
  in [[page-deletion]]). Also holds **when** a migration is allowed to publish: never page by page,
  because xwiki.org is public and a half-built tree is what readers would see. Split out of
  [[documentation]], which holds the authoring rules; this file is only needed when migrating, and is
  applied by the `xwiki-doc-convert` skill.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/HandleOriginalDocumentationPages/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/HandleExtensionPages/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/WorkingAttachments/
---

# A migration publishes once, at the end

xwiki.org is public, and a migration of any size runs for days or weeks. Whatever is saved is
immediately what every reader sees — so **the new pages are drafted and reviewed in full before any
of them is saved**, and go live in a single pass.

Publishing a page as soon as it is written looks harmless and is not. That page is live:

- with **red links** to every sibling and hub the migration has not written yet — links a reader
  cannot follow and cannot tell from a genuine gap;
- often with **no parent page**, so it sits under a 404 and its breadcrumb is broken;
- carrying any defect nobody has caught yet, for as long as the migration lasts.

The rules:

- **Draft the whole set first**, then publish it in one pass, **parents before children** — sort by
  path depth, so no page is ever live under a missing parent.
- **A Change Request is the preferred vehicle**: the pages stay invisible until it is merged, and a
  reviewer sees the whole move at once. A migration is a major change, so the minor-change exception
  in [[documentation]] does not apply. Saving direct is a deliberate choice to record, and it changes
  nothing about the timing.
- **Forward links between pages of the same batch are fine while drafting.** They resolve when the
  batch goes live; that is what makes the batch the right unit.
- If something has to be visible early, publish a **complete subtree** — a hub with its children —
  never a single leaf.
- The **live doc checker only runs on saved pages**, so a deferred publish means its findings all
  arrive at once. Budget a fix round after the first save, and move whatever it catches into an
  offline check when the same class of defect can be decided without the server.

# Handling the original page after migration

The authoring rules — Diataxis types, titles, page structure, style, attachments, versioning, syntax
traps — live in [[documentation]]. This file covers only the last step of a **migration**: what
happens to the page the content came *from*. The procedure that applies it is the
[`xwiki-doc-convert`] skill.

Migrating old content is not done until the **source** page is handled. The rules differ by origin:

- **Old `Documentation`-space page** — repoint its backlinks to the new page(s). When only part of a
  page is moved, keep the section heading and point it to the new page, preserving its old anchor
  with the `{{id}}` macro (see [[documentation]]) so saved links still resolve.
- **Extensions-wiki (e.x.o) extension page** — **never delete it**: it still carries technical
  metadata (dependencies, prerequisites, versions). Instead:
  1. Remove the migrated documentation from **every xproperty that holds prose** — not just
     `description` (see "Where an e.x.o extension page keeps its prose" below) — so the page keeps
     only technical information. An `installation` step that is genuinely **mandatory at install
     time** is the exception: replace it with a one-line pointer at the new page rather than blanking
     it, so it stays discoverable where the reader installs the extension.
  2. Add the **"Documentation" button** by setting the ExtensionClass **`website`** field to
     `https://www.xwiki.org/xwiki/bin/view/DocApp/Code/ExtensionLD?id=<extension id>&name=%22<name>%22`.
     The `id` **must equal the new doc page's Technical ID** (its `DocApp.Code.DocumentationExtensionClass`
     `id`) — that is what makes the generated page list the migrated docs; it need not equal the
     extension page's own `id` field.
  3. **Delete the page's remaining attachments** (next section).
  4. Repoint the original page's backlinks to the new location (section after that).

## Deleting the original page's attachments

Whichever the origin, once a page holds **no documentation content any more**, the guide requires
removing **every remaining attachment from its Attachments tab**. This is the step most easily
forgotten, because stripping the prose makes the page *look* finished while the images and videos stay
behind, orphaned and invisible — nothing on the rendered page reveals them. It is also the one place
the "never delete an attachment, replace it" rule from
[[documentation#attachments-images-and-videos]] does **not** apply.

Deletion is not reversible, so prove the migration first, per attachment: **a counterpart exists on a
new page, and the name no longer appears in any xproperty or in the page content of the original**.
Note the two things that break a naive name-for-name check — the new tree renames attachments to
kebab-case (`jiraMacroTable.png` → `jira-macro-table.png`), and a re-encoded video changes both name
and size (`usage.mp4` → `usage.webm`) — so map old to new explicitly rather than by equality, and
compare byte sizes only where the file was copied unchanged.

## Repointing backlinks

How to obtain the list and why it is incomplete — the **"Backlinks" entry of the original page's
Information tab** (`<page URL>?viewer=information`, farm-wide), plus the search that catches the
absolute-URL and macro-parameter links it never indexes — is in [[page-deletion]], which also holds the
rule that **no page is deleted before its backlinks are handled** (that rule is generic; this section is
only the migration-specific triage).

Most entries are **not** things to edit, and the guide's wording — "for each *documentation page* that
appears in the Backlinks" — is what narrows it. Triage before touching anything:

| Backlink | Action |
|---|---|
| A documentation page pointing at the moved content | **Repoint** at the new page |
| A *prose* link whose intent is "read about this" | **Repoint** |
| A link whose intent is "install this extension" (a prerequisite list) | **Keep** — the extension page is the correct target and still exists |
| A dated blog post (release announcement, article) | **Keep** — a historical record, and it points at the extension page on purpose |
| Registry livetables, `ChangeRequest.Data.*`, `WebPreferences`, demo/test wikis | **Keep** — generated or incidental, not documentation |

So the same link text can need opposite treatment on two sibling pages, depending on whether it says
*install the extension* or *see how to configure it*: read the surrounding sentence, not the link
label.

## Where an e.x.o extension page keeps its prose

An extension page's own **content field is empty** — everything the reader sees comes from
xproperties of its xobjects, and **more than one of them holds documentation**. Extracting only
`description` silently loses content, and the loss is invisible afterwards: every "nothing lost"
sweep then compares the new pages against an already-incomplete source and reports success. So
**enumerate all xproperties of all the page's xobjects and filter for prose**, rather than reading
the fields you expect.

| xobject | xproperty | Migrate? |
|---|---|---|
| `ExtensionCode.ExtensionClass` | `description` | **Yes** — the bulk of the documentation |
| `ExtensionCode.ExtensionClass` | `installation` | **Yes** — often holds a mandatory setup step that appears nowhere else |
| `EXOExtensionCode.ExtensionClass` | `compatibility` | **Yes** — prerequisites and supported-version constraints |
| `ExtensionCode.ExtensionClass` | `website` | No — the "Documentation" button (see above) |
| `ExtensionCode.ExtensionClass` | `properties`, `supportPlans` | No — Maven metadata and support-plan references |
| `ExtensionCode.ProjectClass` | `description`, `entryPoints` | No — project overview and navigation |

Two further traps:

- A **project** page (`ExtensionCode.ProjectClass`) has **no `id` xproperty**, so no `ExtensionLD`
  URL and therefore no "Documentation" button is possible — point its `description` at the new pages
  instead.
- The `compatibility` and `installation` fields commonly carry **long-obsolete** rows (errors on
  XWiki versions no longer supported, ancient version tables). Those are content to **drop**, not to
  migrate — but confirm against the repo's real minimum version rather than trusting the field.
