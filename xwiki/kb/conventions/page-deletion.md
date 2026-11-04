---
title: Deleting a page on xwiki.org — handle its backlinks first
stability: durable
summary: Before **any** page on xwiki.org is deleted, the links pointing *at* it must be listed and
  handled — deleting breaks every one of them. The deletion wizard can repoint them, but only if you
  give it a **"New target"** and tick **"Update links"** (plus optionally an automatic redirect); with
  no replacement page, or when deleting over REST, nothing is repointed and the callers must be fixed
  by hand. Links written as **absolute URLs are never updated and never even appear** in the
  Information tab's Backlinks list, so complete that list with a farm-wide search. Generic — applies to
  documentation pages, extension pages, blog posts, and to intermediate pages you created yourself.
  The migration-specific triage table is in [[documentation-migration]].
sources:
  - https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/refactoring-operations-pages/delete-page/
  - https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/refactoring-operations-pages/delete-page/deletion-wizard/
  - https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/refactoring-operations-pages/delete-page/consequences/
  - https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/linking-references/updating-links/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/HandleOriginalDocumentationPages/
---

# Deleting a page on xwiki.org

**Rule: no page on xwiki.org is deleted before its backlinks have been listed and handled.** "All links
pointing to the deleted Page will stop working" is the first documented consequence of a deletion. This
holds for every kind of page and every reason for deleting — a migrated `Documentation`-space page, a
superseded or duplicate doc page, an obsolete extension or blog page, and equally the **intermediate
pages you created yourself** during a task and then decided to remove. "I created it, so nothing can
link to it" is wrong: as soon as a page exists, hubs, `related` fields, Highlights, navigation and the
other pages you edited in the same task may already point at it.

The failure mode is asymmetric, which is why the rule is absolute: deleting is one click and *looks*
finished, while the breakage lands on **other** pages — pages nobody is looking at, and which nothing
in the delete flow names for you.

## What the deletion wizard does and does not repoint

The wizard's link handling is **opt-in and needs a replacement page**:

| Wizard option | Effect |
|---|---|
| **"New target"** | The page backlinks will be repointed to. Hidden pages are not offered; when children are deleted too, do not pick one of them. |
| **"Update links"** | Actually rewrites the backlinks to the new target. **Only available once a "New target" is chosen**, and the checkbox is only visible to an **advanced user**. |
| **"Create an automatic redirect"** | Adds an `XWiki.RedirectClass` object to the deleted page so *external* links to it keep working. Use it whenever the page may be linked from outside the wiki. |
| **"Affected children"** | Deletes the descendants as a batch — each of them has its own backlinks. |

So automatic repointing is unavailable exactly when the content is genuinely going away (no
replacement page to point at), and it is skipped whenever the delete does not go through the wizard —
notably a **REST `DELETE`** (see the `xwiki-rest-api` skill), which has no wizard, no link update and no
redirect. In both cases the callers must be fixed **by hand, before deleting**.

Even with the wizard, two classes of link are **not** updated:

- **Links written as absolute URLs** (`https://www.xwiki.org/xwiki/bin/view/…`). XWiki treats them as
  external links, not document references, so they are never rewritten — and never listed as backlinks
  either. xwiki.org pages contain plenty of them, which is why [[documentation]] forbids them in new
  content. Only an automatic redirect keeps these alive.
- **Links inside macro parameters**, unless the macro implements `MacroRefactoring`; the default
  implementation is content-only (see [[macro-refactoring]]).

Also verify by hand anything stored in **xproperties** rather than page content — a parent hub's
`related` / Highlights fields and the navigation pinning on `WebPreferences` (see
[[documentation-mechanics]]) — instead of assuming the refactoring job covered them.

When the goal is to **relocate** content, **rename/move the page instead of deleting and re-creating
it**: there "Update links" is on by default and history is preserved. Delete is for content that is
going away.

## Procedure

1. **List the backlinks**: the page's Information tab, `<page URL>?viewer=information`. The list is
   **farm-wide**, so it includes the other wikis of xwiki.org (`extensions.xwiki.org`,
   `dev.xwiki.org`, …). Scope any parsing of that page to the Backlinks `<dd>` itself: a fixed-size
   window around the word "Backlinks" bleeds into neighbouring sections and invents entries that do not
   exist.
2. **Complete the list with a farm-wide search** for the page's name, full reference **and** URL (Solr
   search, or the `xwiki-rest-api` skill's search call) — that is what catches the absolute-URL and
   macro-parameter links the Backlinks list omits.
3. **Triage each entry** (table below) — read the surrounding sentence, not the link label.
4. **Fix the callers**: either delete through the wizard with a **New target + "Update links"** (and a
   redirect) when there is a replacement page, or edit the callers first when there is not. Either way,
   the entries the automation cannot reach are yours to edit.
5. **Delete**, then **verify**: re-run the search and confirm the remaining hits are only the ones you
   deliberately left.

| Backlink | Action |
|---|---|
| A page linking to content that moved elsewhere | **Repoint** at the new page |
| A page linking to content that is simply gone | **Remove the link** and the sentence that depended on it |
| A structural reference (parent hub, `related` field, Highlights, pinned navigation) | **Update the field** — an xobject edit, not a content edit |
| Generated or incidental (registry livetables, `ChangeRequest.Data.*`, `WebPreferences`, demo/test wikis) | **Leave** |
| A dated blog post or release announcement | **Leave** — a historical record; do not rewrite history |

For a documentation **migration** the triage is more specific (an "install this extension" link stays
on the extension page while a "read about this" link is repointed) — that table, plus the rule that an
e.x.o extension page is never deleted at all, is in [[documentation-migration]].

## If a page was already deleted

The page is in the **trash** (Deleted pages), so the situation is recoverable and the recovery is what
gives back the list: **restore the page**, read its Information tab → Backlinks, fix the callers, then
delete it again — this time through the wizard, with a new target and a redirect if a replacement page
exists. Do not try to reconstruct the list from what you remember editing: the whole point is that the
broken links sit on pages you never touched.
