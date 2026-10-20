---
name: xwiki-doc-export
description: Export a subtree of the new xwiki.org documentation (https://www.xwiki.org/xwiki/bin/view/documentation/ — xs or extensions, then user, admin or dev, or any page below) to ONE print-ready PDF in the order of the navigation tree, optionally translated into another language (UI labels use XWiki's own translations). Re-running it re-fetches and re-translates only the pages that changed upstream since the last export, then rebuilds the whole PDF. An export runs as a persisted plan of one-session tasks, so also use this skill to RESUME, continue or check the status of an export already under way. It only reads xwiki.org. To write, update or review a documentation page use xwiki-doc-writing; to migrate old documentation into the new tree use xwiki-doc-convert.
---

# Exporting xwiki.org documentation to a PDF

The documentation is written to be read in a browser. This skill turns a subtree of it into a book:

- one PDF, pages in the reader's order (pinned pages first, then by title, as in the navigation
  panel);
- in English or translated;
- rebuilt incrementally, so a later export only pays for what changed.

Everything mechanical is done by **`tools/docexport.py`**, which is Python 3 with the standard library only. It prints a short summary per call. You make the judgement calls and do the translation.

- **Needs:** Chrome or Chromium to print (set `CHROME` if it is somewhere unusual).
- **Optional:** `pdftotext` (poppler) for page numbers in the Contents; without it the Contents has links only.
- **Also needed to translate:** an xwiki-platform checkout at the version xwiki.org runs, for the official UI strings. Its git history also gives the labels renamed since, with what the UI showed for them then, for the pages that describe an older version; a `--depth 1` clone has none, so `glossary` suggests `--shallow-since=5.years`.
- **No credentials:** the documentation is public, and every read is anonymous.

## An export runs as a plan

A first export does not fit in one session: `documentation/xs/user` alone is about 180 pages. So,
as in `xwiki-doc-convert`, the skill never exports directly:

1. **Find the state.** An export lives in `<work>/xwiki-doc-export/<root>__<lang>/`, where `<work>` is the work directory from the org-wide conventions.
   - The directory is named after the subtree and the language, not after a date. A later export must find the previous one's cache: that cache is the incremental part.
   - If `PLAN.md` exists there with open tasks, run `python3 <xwiki-doc-writing>/tools/docplan.py --plan <dir>/PLAN.md status`. That one call *is* the orientation. Do the current task: `docplan.py start NN`, the task, then `docplan.py done NN "<outcome>"`. Then **stop**.
2. **No plan, or every task done** → this is a **planning session**:
   ```
   T=<this skill>/tools/docexport.py
   python3 $T scan  --root documentation.xs.user --lang de [--exclude <ref>]...
   python3 $T fetch --root documentation.xs.user --lang de
   python3 $T glossary --root documentation.xs.user --lang de --platform <checkout>   # translating only
   python3 $T plan  --root documentation.xs.user --lang de
   ```
   - The first time, ask the developer:
     - the root, the language, and any subtree to leave out;
     - **print or screen** (`--medium`): a printed book spells out the URL of every link that leaves the book, since paper cannot be clicked; a PDF read on screen keeps its links clickable and its text clean;
     - **a new page per topic or per page** (`--page-break`). Per topic is more compact; per page makes every documentation page start at the top of a sheet, easier to find and to hand out one by one, at about a quarter more pages (roughly 245 against 310 for `xs/user`).

     Record the answers in PLAN.md's Setup and Decisions sections: they are asked once per export, not once per session. `scan` keeps the two layout choices in `export.json`, and `build` can override them later without affecting any translation.
   - `glossary` also writes `labels.<lang>.json`, the handful of labels that are the same on every page: the cover, "Contents", and the page types and "Extension" of the metadata line. Translate them yourself and set `"translated": true`. When a newer tool adds labels, `glossary` adds them to an existing file and unsets `translated`.
   - Show the developer the task list and the state directory path, then **stop**.
   - An incremental export often plans to just "translate 3 pages, build". Say so: it fits in the planning session if the developer wants it done now.
3. **Checkpoint before you run out of room.** A session's budget is **30% of the context window**. A translate session only orchestrates subagents, so it stays far below that; if one does not, the chunks are too big (see `--chunk-bytes` in `references/export-plan.md`).

Session habits that keep that budget:
- **Never read a page's HTML in the main session.** `check` says what is wrong with a translation; the translator subagent is the one that reads the page.
- **Open the PDF once, in the build task, to spot-check it.** Never open it to see whether the build worked: `build` reports that.

## What `scan` and `fetch` do

- **`scan`** walks the tree through the DocumentTree service (the navigation panel's own order).
  - It skips `WebPreferences` and the **type landing pages** (tutorial / howto / reference / explanation). Those are query listings of pages the tree already contains, so keeping them would duplicate pages.
  - It cross-checks the walk against Solr, per `okf/conventions/documentation-mechanics.md`:
    - A page Solr knows but the tree does not show **stops the scan**. Exporting the tree would drop it silently. Fix it upstream, `--exclude` it, or pass `--ignore-mismatch`.
    - A page missing from Solr only means a stale index. It is dated from REST instead.
  - It compares versions and attachment versions with the last fetch, and reports what is new, changed, deleted and reordered.
- **`fetch`** downloads each new or changed page's rendered body, runs the **print transform** (`references/print-rules.md`) and stores the result under `source/`.
  - The transform removes what only makes sense in a browser: the search box, the Live Data tables, the "Content" box and the "More" section.
  - It converts what does make sense into its print form.
  - A page whose transformed HTML is identical to the last fetch keeps its translation. This happens after an edit that only touched metadata.
- **An unknown block stops the build.** `fetch` reports every element class or tag the print rules do not cover.
  - For each one, look at one example page and decide. Either add a rule to `transform()` and to `references/print-rules.md` (then `fetch --all`), or accept it as harmless with `accept-class`.
  - A sheet change on xwiki.org therefore shows up as a question, never as a silently broken page.

## Translating

A translate task never translates in the main session:

1. `prompt --task NN` writes one prompt file per chunk. Each file holds the page paths, the rules, the glossary, and the official UI strings **these pages mention**, looked up in the xwiki-platform catalogue: a few dozen terms, not thousands.
2. Launch one subagent per chunk, **all in one message**, each told only to read and follow its prompt file.
3. `check --task NN` compares every translation against its source:
   - the same elements, ids, hrefs, srcs and classes;
   - the same code;
   - no longer mostly English.
   It marks the passing pages as translated.
4. Failed pages go back to a subagent through `prompt --failed`. A page that fails twice becomes an Open question in PLAN.md, with the check's reason.

**Rules for the translation**, all written into the prompt, so do not repeat them to the subagents:
- Translate the prose, `alt` and `title`. Code, identifiers, URLs and markup stay byte-identical.
- Translate, do not edit: nothing added or dropped. A translator writes only its own pages, never another file, even by script.
- UI labels use XWiki's own translation, so the book matches the screen a reader of that language sees. A label renamed upstream is offered with its older translation too, marked "(older UI)", for a page that says what the field was called before version X; with none listed, such a passage quotes the English labels.
- A recurring concept the catalogue does not cover goes into `glossary.<lang>.json`, so that later chunks and later exports reuse the same word.
- A translator only adds to the glossary, never changes an entry: chunks run in parallel, and a changed entry leaves the pages already written with the old word. An entry that contradicts the UI is reported back, and the translate session settles it (see the task file).
- The metadata line under each title is left in English: `build` writes it from `labels.<lang>.json`, so every page words it the same way.
- Screenshots stay as they are, in English.

## Building

`build` refuses to run while pages are untranslated, labels are untranslated or block classes are unreviewed, and says which. Otherwise it produces the book:

- a cover (title, source URL, export date — no XWiki version: the book is what xwiki.org showed that day);
- a Contents down to depth 3 with page numbers;
- a new page per top-level topic, or per documentation page;
- page headings at their tree depth in the PDF outline, and sized by their level within the page, so a deep page's title still stands out;
- every screenshot with a border and scaled to fit the page, whether or not its page used the image macro that draws the border on xwiki.org;
- in-book links as PDF links; outside links clickable, with their URL spelled out when the book is meant for print;
- an "In this section" list, in navigation order, on each page with children;
- a PDF outline.

It also writes `out/changes-<date>.md` (what is new, changed or removed since the previous build) and records the export in `last-export.json`, which the next `scan` compares against.

## Related

- `references/export-plan.md`: the state directory, PLAN.md and task layout, and the incremental rules.
- `references/print-rules.md`: the browser-to-print transform, block by block, and how to extend it.
- `okf/conventions/documentation.md`: the structure of documentation pages (types, sheet sections, landing pages) that the print rules are built on.
- `xwiki-doc-writing/tools/`: `xwikidoc.py` (the REST client this tool imports) and `docplan.py` (the plan bookkeeping it reuses).
