---
title: Stored data in a wiki application (list properties, generated page names, migrations)
stability: durable
summary: Three traps in a wiki application's own stored data — a non-multiSelect list property is a
  VARCHAR, so range filters on it compare lexicographically; a page name allocated by querying the
  pages that already exist races for the whole editing session; and a wiki-page data migration is
  idempotent only if it drops the old object as it saves. For applications built from XClasses and
  wiki pages (AWM-style or a hand-written XAR), not for Java store code.
sources:
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-oldcore/src/main/java/com/xpn/xwiki/objects/classes/ListClass.java
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-oldcore/src/main/resources/xwiki.hbm.xml
---

# Stored data in a wiki application

## A list property is a VARCHAR, so range filters on it are lexicographic

`ListClass.newProperty()` returns a **`StringProperty`** for any list that is neither `multiSelect`
nor large storage — `StaticListClass` and `DBListClass` alike — and that maps to
`xwikistrings.XWS_VALUE`, a VARCHAR. So `>=` / `<=` / `>` / `<` on such a property in HQL/XWQL
compares text, with an outcome that also depends on the database collation. Only `NumberClass` gives
numeric semantics.

What hides the bug: single-character codes (`0`, `1`, `2`) sort exactly as intended, so it surfaces
only once values differ in length — `"10.0" < "9.0"`, so a `>=9.0` filter silently drops every later
row while the page still renders. Store a zero-padded sortable value beside the display value, or
compare after the query.

## Allocate a generated page name by creating the page, not by querying

Deriving the next `Entry001`-style name from the pages that already **exist**, then sending the author
to that name in an editor, leaves the window open for the whole editing session — the page appears
only on save. Two authors adding an entry at once get the same name and the second save overwrites
the first, with no conflict warning. Create the page from its template first, then hand it out.

Two traps in that query: `order by doc.space desc` is a string sort, so `Entry999` outranks
`Entry1000` once the padding is exceeded; and it must be filtered to the kind of entry being
numbered, or sibling pages of other kinds get counted.

## A wiki-page migration is idempotent only if it drops what it matched on

Remove the old object in the same save that writes the new one: an already-migrated page then stops
matching the selection query, so a re-run is a no-op and no "has it run" flag is needed.

Then make it **observable**. Cost is a document load plus a save (versioning, indexing,
notifications) per row, so an unbounded run times out part-way; without a completion count a
truncated run is indistinguishable from a finished one, and the admin sees a partial success list
with no sign that clicking again is required. Bound it as [[performance]] requires.

## An entry's template must carry the class its queries locate it by

When queries find entries by a marker XClass, the creation template must hold that object — a
template carrying only the type-specific class produces entries invisible to every query.
