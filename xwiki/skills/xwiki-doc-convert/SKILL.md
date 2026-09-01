---
name: xwiki-doc-convert
description: Convert OLD XWiki documentation into the new xwiki.org documentation tree. Old documentation = pages under https://www.xwiki.org/xwiki/bin/view/Documentation/ and all extension pages under https://extensions.xwiki.org/xwiki/bin/view/Extension/ (the Extensions wiki). New documentation = https://www.xwiki.org/xwiki/bin/view/documentation/ (and pages nested under it). Use when migrating/refactoring a legacy page (or an extension page) into the new tree — treating the legacy content as source material, re-classifying it by Diataxis type, dropping obsolete content, and verifying nothing useful was lost. A conversion is run as a persisted plan of one-session tasks, so also use this skill to RESUME, continue or check the status of a conversion already under way. For authoring/reviewing a page that is already in the new tree, use xwiki-doc-writing instead.
---

# Converting old documentation into the new documentation

The goal is to move **all** old documentation into the new tree:

- **Old documentation** — pages under https://www.xwiki.org/xwiki/bin/view/Documentation/ (the old
  `Documentation` space) and every extension page under
  https://extensions.xwiki.org/xwiki/bin/view/Extension/ (the Extensions wiki, a different wiki).
- **New documentation** — https://www.xwiki.org/xwiki/bin/view/documentation/ and the pages nested
  under it.

Conversion is **not** a like-for-like rewrite. Treat the legacy page as **source material**, not as
the target structure: extract the still-useful information, update it, drop the obsolete parts, and
**re-organize it into one or more pages** that each follow the new documentation rules.

This skill builds on **`xwiki-doc-writing`** (the authoring procedure, review checklist, and live
per-type examples) and on the OKF rules in **`okf/conventions/documentation.md`** (Diataxis types,
titles/page-names, page-structure fields, style, location, versioning) plus
**`okf/conventions/documentation-migration.md`** (what to do with the *original* page once its
content has moved). Read those for the rules; this skill covers only what is specific to converting.

A conversion is also the case the **`tools/` scripts of `xwiki-doc-writing`** exist for: several pages
drafted together as data, linted offline, published idempotently, then audited. Start from
`xwiki-doc-writing/tools/README.md` — hand-rolling REST calls for a whole tree re-earns every trap it
already handles.

## A conversion runs as a plan, one task per session

A real conversion — a legacy page split into several new ones, each needing freshly captured
screenshots, plus the original page's attachments and backlinks — does not fit in one context
window. So this skill **never converts directly**. It first writes a plan to disk, then executes
**one task per session**, keeping the status in that plan so any later session can pick the work up
cold.

**Do this before anything else, on every invocation:**

1. From the conversion working directory (the one holding `pages.py` and `shots/` — a
   `<work>/<repo>/<date>-<slug>/` directory under the work directory given in the org-wide
   conventions), run **`python3 docplan.py status`**. That one call *is* the orientation: it finds
   `conversion/PLAN.md`, and prints the current task's full brief, the setup answers, the recent
   decisions, the open questions and what comes next. **Do not read `PLAN.md` by hand** — in chunks
   it costs a dozen turns at full context, which is the single largest avoidable cost in a
   conversion. Ask the developer only if the tool finds no plan and several conversions are in
   flight.
2. **No plan yet** → this session is the **planning session**. Do steps 0–1 of the flow below and
   *enumerate* (do not yet read) the legacy pages in scope, then write
   `conversion/PLAN.md` and the first task files — one `extract-*` per legacy page, then
   `target-map` (layout, standard task set and templates:
   [references/conversion-plan.md](references/conversion-plan.md)), show the developer the task list,
   and **stop**. Converting nothing is the correct outcome of a planning session.
3. **A plan exists** → `docplan.py status` already gave you the task and its brief. Run `docplan.py
   start <NN>`, execute it, then `docplan.py done <NN> "<outcome>"` (which writes the status and the
   Outcome to both PLAN.md and the task file), and **stop** — report what landed and what comes
   next. Do not read the other task files or the raw legacy source; not spending that context is the
   entire point of the split. Do not roll into the next task.
4. **Checkpoint before you run out of room**, not after: at roughly a quarter of the context window
   left, stop mid-task, record in the task file exactly where to resume, and hand back. A task that
   is too big for one session is a planning bug — split it in PLAN.md rather than pushing through.

**How a session runs out of room.** Every turn re-reads the whole conversation, so a session costs
roughly *turns × context* and each of these is paid for by every turn that follows it. Three habits
decide whether a task fits in one session:

- **One call, not a conversation, for anything mechanical.** `docplan.py status` instead of reading
  the plan in chunks; one script that answers five questions instead of five `cat`/`grep`/`sed`
  commands. Exploration is where the turns go, not the writing.
- **Never open a screenshot to check whether the capture worked** — `docshot.sh` reports its own
  dimensions and box verdict, and a PNG read into the conversation stays there for every later turn.
  Open one only to judge *content* ("is the right menu open?"), once, not once per attempt.
- **Read the inventory, never the raw legacy source.** That is what the `extract-*` tasks produced
  it for; re-reading the legacy page spends the context the split was meant to save.

**Nothing reaches xwiki.org until the whole set is ready.** xwiki.org is public: for the weeks a
conversion is in flight, every reader who lands on it sees whatever is currently there. A page
published on its own is a page with **red links** to the siblings and hubs that do not exist yet,
often with **no parent page**, and sometimes with a defect the author has not caught. So the
`page-*` tasks are **preparation** tasks — they draft into `pages.py`, capture screenshots, and lint
offline — and **one final `publish` task puts the whole set live in a single pass**, parents before
children. Publish order matters even within that pass: a child saved before its parent is briefly
live with a broken hierarchy. A partially converted tree is never the visible state of the wiki.

The steps below are the *content* of the conversion; `references/conversion-plan.md` says which task
owns each one, and holds the PLAN.md / task-file templates and the resume rules. Read it in the
planning session, and in any session that has to re-plan or split a task.

## Conversion flow

Which task owns which step: **0–1** the planning session · **2** one `extract-*` task per legacy
page · **3–5** `target-map` · **6–8** one `page-*` task per target page, which drafts and lints but
does **not** publish · **9** `dedup` · **10** `original-*` · **11** `deletions` · **12** the single
`publish` task at the end.

0. **Ask the developer the four setup questions from `xwiki-doc-writing` first** (that skill's "Before
   writing anything" section owns the credentials-file lookup and the exact questions), and **record
   the answers in PLAN.md's Setup section** — they are asked once per conversion, not once per
   session. A conversion needs the local instance even more than fresh authoring does: legacy
   screenshots are usually stale or absent, so most of the images on the new pages have to be
   **re-captured**, not moved.
1. **Check for existing Change Requests** on the target first, so two people don't refactor the same
   page in parallel.
2. **Read the legacy page in source mode and save it to `conversion/source/`** so you capture its real
   syntax, links, macros and version
   notes (not just the rendered text) — and so the sessions that come after this one, including the
   final audit, still have the legacy content after the original page has been stripped. Alongside the
   verbatim copy write the **inventory**: one bullet per atomic piece of material (concept,
   prerequisite, procedure, warning, limitation, config detail, example, troubleshooting note, image,
   video), tagged with its Diataxis type and audience. Every later task reads the inventory instead of
   the raw legacy text. For an **e.x.o extension page** the page content is empty and
   the documentation lives in xobject xproperties — **enumerate every xproperty of every xobject and
   filter for prose**, never just `description`. `installation` and `compatibility` routinely hold
   mandatory steps and prerequisites that appear nowhere else, and missing them is invisible later:
   the "nothing lost" verification below would compare against your incomplete extraction and pass.
   The field-by-field table is in `okf/conventions/documentation-migration.md`.
3. **Decompose by Diataxis type**, working from the inventories rather than the raw legacy text. A
   legacy page usually mixes types — some explanation, a procedure
   or two, a configuration reference, maybe a tutorial. Identify each distinct piece and its type and
   audience. Do **not** keep the mixed structure.
4. **Split into target pages** — one page per How-to, one per Explanation, one per Reference topic,
   and a separate Tutorial whenever an end-to-end scenario exists. Splitting is preferred over a long
   mixed page. Merge only when several legacy pages describe a single coherent topic.
5. **Choose the location** for each target page in the new tree (most relevant existing
   topic/subtopic for its audience and type). Then **fill PLAN.md's target map and write one
   `page-*` task per target page**, mapping every inventory item to the page that will carry it — an
   item mapped to no page is either deliberately dropped as obsolete (say so in the map) or a gap
   that the "nothing lost" audit will later fail on.
6. **Rewrite each page** with the `xwiki-doc-writing` flow — correct title/page-name, page-structure
   fields, style, and latest-version perspective. The style rules apply to the sentences you *carry
   over* too, not only to the ones you write.
7. **Update while converting** — remove obsolete information; update deprecated terminology, UI
   names, and configuration examples; convert version-specific notes to the `{{version}}` macro and
   drop notes for versions no longer supported. **Never silently lose still-valid information.**
8. **Move the attachments too — and add the visuals the legacy page never had.** A legacy page is rarely
   illustrated to the new tree's standard, so carrying its images over is the floor, not the goal: the
   converted User/Administrator pages want **screenshots** of the UI they describe (re-captured on the
   local instance, since legacy ones show old skins), the Developer pages **code examples**, and an
   Explanation you extracted about design/architecture a **PlantUML `bluegray` diagram** where the legacy
   page described the structure in prose. Don't add a visual that clarifies nothing. Then, by the new
   tree's rules — images and videos are content. Re-upload
   them under **kebab-case, lowercase-extension** names, insert images with `{{image}}` + `alt`, and
   **re-encode a video to `webm` and display it with `{{embed}}`**. When the legacy page *embedded* a
   video or an image, the new page **embeds it too**: turning an embed into an `attach:` link is a
   silent regression that no check catches. See `okf/conventions/documentation.md`.
9. **De-duplicate and trim across the pages you produced** — splitting one legacy page into several is
   exactly what breeds duplication, because each new page wants to restate the context the legacy page
   stated once. Do the cross-page comparison **and trimming** pass from `xwiki-doc-writing` before
   declaring the conversion done, hub prose included. Legacy pages are typically far more verbose than the
   new tree allows, and copying their prose across imports that verbosity: keep only what the reader needs
   in order to act. A **How-to/Tutorial** you extracted also gets its **result step** (legacy procedures
   almost never have one), and the **hub page** you create over the split must **link every page it
   introduces** rather than re-tell the legacy page's introduction.
10. **Handle the original page** — after the content is moved, follow the guide's
    [Handle Original Documentation Pages](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/HandleOriginalDocumentationPages/)
    steps: strip the prose (leaving a link to the new location / adding the "Documentation" button),
    then the two steps that outlive the prose and are the ones actually forgotten —
    **delete the page's leftover attachments** and **triage and repoint its backlinks**. Both
    procedures, including how to prove an attachment is safe to delete and which backlinks to leave
    alone, are in `okf/conventions/documentation-migration.md`.
11. **Handle the backlinks of anything you delete — including the pages you created.** A conversion
    often ends by removing a page: one superseded by the new tree, or one of the **new pages you created
    earlier in this conversion** and then merged, moved or dropped. Every deletion follows
    `okf/conventions/page-deletion.md` (list the backlinks, complete the list with a search, handle them,
    then delete), and relocating a page is a rename/move rather than a delete-and-recreate.
12. **Publish, once, at the end** — as a single task, after `dedup` and `original-*` have settled the
    set. Save the pages **parents before children** so no page is ever live without its hub, then run
    `docpages.py verify`, which is the first time xwiki.org's own doc checker sees them: expect a
    round of fixes (page-name violations in particular) and re-save. Prefer a **Change Request** for
    the whole set where the tooling can write into one — a conversion is a major change, the new
    pages and the original-page edits belong in the *same* one so a reviewer sees the move whole, and
    the pages stay invisible until it is merged. (The minor-change exception in
    `okf/conventions/documentation.md` does not apply to a conversion.) Saving direct instead is a
    decision to record in PLAN.md's Setup section, and it does not license publishing early: the set
    still goes live in one pass, at the end.

    Two consequences for the tasks before it. **The offline `lint` is the only gate a `page-*` task
    has**, so anything the live checker would have caught has to be checkable offline — page names
    with stop words in them, for one. And a `page-*` task cannot prove its page renders correctly,
    so the `publish` task **reads back what it published** rather than assuming the syntax was right.

Refs: [Migrate and Refactor Documentation](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/),
[Handle Original Documentation Pages](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/HandleOriginalDocumentationPages/).

## Verify the conversion

This is the `verify` task, the last one in the plan. A conversion is only correct if the new pages
preserve the legacy page's meaning and useful content.
Verify against `conversion/source/` — the verbatim legacy copy and its inventory, which by now is the
only complete record of what the legacy page said — comparing legacy → new, and report issues with a
**severity** (Critical / Major / Minor / Suggestion), a **location** (page + section), the
**problem**, and a **recommendation**:

- **Nothing useful lost** — every still-relevant concept, prerequisite, warning, limitation,
  configuration detail, example and troubleshooting note from the legacy page is present somewhere in
  the new pages. Walk the **inventory** item by item: each one is either on a new page or marked
  obsolete in the target map — an item that is neither is the finding. (Ignore genuinely
  obsolete/deprecated/unsupported content — that is meant to be dropped.)
- **Meaning preserved** — the rewrite did not change what the feature does, its requirements, or the
  relationships between features; nothing was over-simplified into being wrong.
- **Up to date** — no obsolete UI names, deprecated terminology, removed features, or references to
  unsupported versions survive; the `{{version}}` macro is used correctly.
- **Diataxis respected** — each new page is exactly one type; no procedures inside an Explanation, no
  conceptual essays inside a How-to, no configuration tables inside a Tutorial.
- **Placement & splitting** — content sits on the right page; a page covering several unrelated
  topics/goals should be split further; over-fragmented pages on one coherent topic should be merged.
- **Nothing duplicated** — no fact appears on two of the new pages, or in both a page's intro and its
  own FAQ, however differently phrased. This is the check the split most often fails, and the one that
  cannot be done page by page.
- **Attachments carried over faithfully** — every image/video is on the new page, under a conforming
  name, and **displayed the way the legacy page displayed it** (an embed stays an embed).
- **Illustrated to the new standard** — the converted pages show as well as tell (screenshots for
  User/Administrator, code examples for Developer, a diagram where an Explanation describes a structure),
  whether or not the legacy page had any, and without adding visuals that clarify nothing; each
  How-to/Tutorial ends on a **result step**; the hub page links every page below it.
- **Not more verbose than it needs to be** — the rewrite cut the legacy prose rather than reflowing it;
  no sentence survives that the reader does not need in order to act.
- **Nothing was live half-built** — the set went public in one pass, parents first, and no reader
  could reach a converted page while its hub, siblings or parent were still missing.
- **Original page finished** — prose stripped, "Documentation" button set, **attachments deleted**,
  **backlinks triaged**. A conversion that stops at the new pages is not done.
- **No page was deleted with live backlinks** — for every page the conversion removed (the original, a
  superseded page, or an intermediate page created during this conversion), the backlinks were handled
  **before** the delete, per `okf/conventions/page-deletion.md`.
- **Guideline compliance** — titles, page names, page-structure fields and style follow
  `okf/conventions/documentation.md` (reuse the `xwiki-doc-writing` review checklist).

Do **not** raise a finding merely because you would have phrased something differently: every finding
must be justified by lost information, changed meaning, outdated content, a Diataxis violation, a
documentation-guideline violation, or a concrete usability/maintainability problem.
