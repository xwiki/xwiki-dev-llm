---
name: xwiki-doc-writing
description: Write, update or review a page of XWiki documentation on xwiki.org, following the XWiki Documentation Guide (Diataxis type & audience, titles/page-names, page-structure fields, style, location, versioning). Use when authoring a NEW documentation page, updating an existing one, or reviewing a page for quality. Also use before DELETING any page on xwiki.org — deletion requires fixing the page's backlinks first. New documentation lives under https://www.xwiki.org/xwiki/bin/view/documentation/. To CONVERT old documentation (the Documentation space or the Extensions wiki) into the new tree, use xwiki-doc-convert instead; to export a subtree to a (translated) PDF, use xwiki-doc-export; to sweep the fixed issues of a release and document what each one needs, use xwiki-release-documentation (which delegates the prose back to this skill).
---

# Writing, updating and reviewing XWiki documentation

This skill is the **procedure** for producing and reviewing a page in the new `/documentation` tree.
The **rules** it applies (Diataxis types, titles/page-names, page-structure fields, style, location,
versioning) are declarative knowledge and live in the OKF: read
**`okf/conventions/documentation.md`** first — it is the working summary, and it points to the live
XWiki Documentation Guide, which is the evolving source of truth. When a detail is borderline or
missing, consult the live guide and prefer it.

For **converting** legacy documentation (old `Documentation` space or the Extensions wiki) into the
new tree, use the **`xwiki-doc-convert`** skill instead — it builds on this one.

## What this skill produces

Well-structured **page content in XWiki syntax** plus, when reviewing, a list of concrete findings.
Documentation pages are wiki pages, not files in a git repo: this skill does not commit files — the
developer creates/edits the page on the wiki and submits a Change Request.

## Before writing anything — ask the developer these four things

Ask **before** starting the work, in one go, because each answer changes what you produce and two of
them cannot be recovered later (a page saved directly cannot become a Change Request, and a screenshot
cannot be taken without a running instance). Ask for authoring, updating **and** converting.

**First look for `~/.xwiki-credentials`** (`test -f`, **never print it**) — when that file exists it
answers question 2, so drop that question. Its format, and how to use it without pulling the password
into the conversation, are in `okf/servers/index.md`.

Ask the remaining questions in a **single `AskUserQuestion` call** so the developer clicks options
instead of typing answers back (fall back to a numbered list in a message only on a host without that
tool). Question headers and options:

1. **`Save mode`** — Change Request or direct save? **Change Request (Recommended)** for anything but
   a genuine minor fix, **Save directly** for a typo / broken link / small rephrasing (see step "Save"
   below and `okf/conventions/documentation.md`) — but let the developer decide.
2. **`Credentials`** — which xwiki.org account to write with, and where to find its credentials?
   **Create `~/.xwiki-credentials` (Recommended)** (you re-read the file afterwards), **They are
   elsewhere** (environment variable, password manager entry, `~/.netrc`…), **Don't save** (you
   produce the content and the developer pastes it). Without this the whole task stops at the save
   step, so it is not a question to leave for the end.
3. **`Screenshots`** — is a local XWiki instance running for the screenshots? **Yes**, **I will start
   one**, **No — skip the screenshots**. Suggest the [Documentation Resources](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationResources/)
   XARs to get realistic content in it. Pages need images (see `okf/conventions/documentation.md`),
   and xwiki.org itself is **not** the place to capture them. Don't *ask* which **version** it runs —
   read it from the `xwiki-version` header of any `/rest` response, and check it is recent enough for
   the screenshots to show the latest skin. The version is **not** recorded on the page: putting it in
   an image `caption` is a misuse the guide names explicitly (`okf/conventions/documentation.md`).
4. **`Local login`** — credentials for the local instance: **`Admin`/`admin` (Recommended)**, the
   default, or **Other**. These are never the xwiki.org credentials.

If the developer declines the local instance, say plainly which images the page will be missing rather
than shipping a page with none.

**Placement is a fifth question, asked separately** — once you know what pages there will be, and
before the first one is created. It is not a yes/no: propose two or three **written-out page trees**
with their costs and your recommendation, per "Choose the right location" in
`okf/conventions/documentation.md`. Getting it wrong is a rename/move with backlink handling, not an
edit.

## Tooling — `tools/`

For every new or rewritten page, a single one included, use the scripts in this skill's `tools/`
directory rather than hand-rolling REST calls (only a minor fix, per step 13, is made by hand): draft
the pages as a `pages.py` data module, then

```bash
python3 tools/docpages.py lint      # offline; the mechanical rules of documentation.md
python3 tools/docpages.py save      # idempotent publish, every field read back
python3 tools/docpages.py pin       # child order, verified via the tree service
python3 tools/docpages.py verify    # audit + BOTH doc-checker surfaces
```

plus `tools/docshot.sh` and `tools/checkredbox.py` for screenshots. `tools/README.md` documents the
page-set contract and, for each step, the silent failure it protects against — a lost `202`, an object
write blanked by a `#`-less field name, a finding that creates no violation object, a red box clipped
into three sides. Read it before writing the first page; the review checklist (see "Review") still
applies to everything a regex cannot decide.

## Flow — create a new page

1. **Check it doesn't already exist** elsewhere in `/documentation` (avoid duplication).
2. **Classify** the content: pick the single Diataxis type and the audience
   (see `okf/conventions/documentation.md`). If it mixes types, split it into several pages. Before
   drafting a type you have not written in this session, read the real pages for it listed in
   `references/live-examples.md` to calibrate structure, title style and voice.
3. **Choose the location** — first, **bundled vs not**: a bundled extension's page goes under
   `documentation.xs`, a non-bundled one under `documentation.extensions`; then the most relevant
   existing topic/subtopic for that audience and type; create a new top-level topic only when nothing
   fits. A new topic is a page of its own, an **Explanation** (`okf/conventions/documentation.md`), so
   a How-to that opens one brings that topic page with it: put both in the placement proposal.
4. **Write the title and page name** per the type's rules (verb-led for How-to/Tutorial; noun phrase
   for Reference/Explanation; kebab-case page name, stop words removed, no parent/child repetition, even of
   the action's object: `tags/add-page`, the title saying "Add a Tag to a Page").
5. **Fill the page-structure fields** — Content (per type), FAQ (questions with 1–2 sentence
   answers), Related links (**non-child** pages only), Technical ID (`xwiki:<extension id>`, or empty).
   When the extension page's `id` is empty, completing it is a write to extensions.xwiki.org: propose
   the value to the developer (from the module's `pom.xml`) and save it only on their yes.
   **Leave Highlights empty unless the page has many children**: it is a two-level list of the most
   important *child* pages, not a "key points" summary, and the automatic "More" table already lists
   every child — see `okf/conventions/documentation.md`.
6. **End a How-to / Tutorial with a result step** — the last numbered item shows the reader *what they
   should now see*: a short "The macro is inserted in the page, as follows:" plus a **screenshot** (or a
   **code macro** when the result is text, or the produced output on a Developer page). A procedure that
   stops at the last action leaves the reader unable to tell whether it worked.
7. **Put a Reference's members in one table** — `|=Member |=Returns |=Default |=What it does`, not a
   section per member and not a `name: meaning` bullet list. "Use code examples for API references"
   asks for the parameters, types, defaults and return value, which is a *row*: a bare signature is a
   column, and the code example is reserved for what a cell cannot hold (a usage snippet, a builder
   call, a whole role interface). A section per member earns its place only when each carries something
   uncellable, such as a screenshot per option. **The table never gets a `Since` / `Version` column** —
   version information is a `{{version}}` badge on the rows that need one, and only for versions at or
   after the LTS (step 11).
8. **Apply the style rules** — `"quotes"` for UI elements, uppercase-first XWiki terminology,
   `##literals##`, link-reference syntax (never hardcoded URLs), `{{scm}}` for GitHub files, the
   code macro with an explicit `language`, the display macro to avoid duplication, and **no overused
   em dashes** (use the comma, period, colon or parentheses the sentence needs; quoted text keeps its
   dashes).
9. **Give the page something to look at, wherever it earns its place** — **screenshots** on
   User/Administrator pages (every UI element or screen the reader must find), **code examples** on
   Developer pages, and on an Explanation about design/architecture a **PlantUML `bluegray` diagram**
   (components and flows for developers; a lifecycle, workflow or decision diagram for users — be
   creative about what clarifies the concept). An image replaces a paragraph of "click the menu at the top
   right", a snippet replaces a paragraph of API prose. **Never screenshot text**: whenever what you are
   showing is itself text — a configuration file, a command, a log line, a query — it goes in a **code
   macro**, whatever the page's audience, and most of all when the reader has to edit or copy it, since
   text cannot be selected out of an image (an Administrator How-to editing `xwiki.properties` shows code
   blocks, not pictures of them). **Don't force it**: a short Explanation or a small
   Reference table can be complete with no visual, and a decorative one costs the reader attention and a
   maintainer an update. Capture screenshots on the local instance agreed above, using the
   [Documentation Resources](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationResources/)
   XARs for realistic content.
10. **Handle attachments by the rules** — kebab-case name with a lowercase extension and **stop words
   removed** (the naming checker applies the page-name rules to attachments), images via the
   `{{image}}` macro with an `alt` and the mandatory `size`, **framed on the element plus the nearest
   landmark that locates it** and cropped to exactly that size's pixel width, with a red
   (`255, 0, 0`) box around the element concerned, **videos in `webm` displayed with the
   `{{embed}}` macro and never as a link**, Gallery for several images, PlantUML (`bluegray`) for
   diagrams. See `okf/conventions/documentation.md`.
11. **Respect version perspective** — write for the latest version; use `{{version}}` (with `before`
    for changed behavior) only for genuine new/changed behavior. A version is **only ever** a
    `{{version}}` badge, never bare text and never a table column; and only versions **at or after the
    current LTS** appear at all — anything older is deleted, not badged. The macro strips the
    qualifier (`since="18.8.0RC1"` renders `XWiki 18.8.0+`), so a Java `@since` value can be passed to
    it verbatim. See `okf/conventions/documentation.md`.
12. **Run the de-duplication *and trimming* pass before saving** — this is a separate step because every
    page reads fine on its own and both defects are invisible while writing. Start with the two that need
    no judgement and that `lint` decides for you — **the sibling How-tos' step 1** and **an attachment
    name declared by more than one page**, which it sees only among the pages of the set, so compare a
    lone new page with its siblings by hand — then lay the page's intro next
    to its own FAQ, then next to its parent/hub and sibling pages, and hunt for **the same fact stated
    twice in different words**. Each hit: pick one home, and reduce the others to a clause with a link or
    delete them. Then **cut verbosity**: take each sentence and ask *does the reader lose something they
    need in order to act if I delete it?* — if not, delete it rather than compress it. Readers skim, so
    length itself hides content. A How-to whose numbered list is wrapped in explanatory paragraphs, and
    a hub page that narrates the feature instead of **linking every page it introduces**, both fail this
    step.
13. **Review, then save.** Apply the review checklist first (see "Review"). A new or substantially
    rewritten page is a **major** change: save it via a **Change Request**, adding to an existing open
    one on that page if there is one. A pure typo, broken-link
    or small-rephrasing fix is a **minor** change: save it **directly**, ticked "minor", with a short
    summary — do **not** open a Change Request for it. See `okf/conventions/documentation.md`.
    Then read any automatic documentation-check violations the save reports.

## Flow — update an existing page

Keep the page a single Diataxis type. Re-check the title/page-name rules if the scope changed. Update
for the latest version and prune version macros/content for versions no longer supported. Move any
explanation that crept into How-to steps out to the FAQ field or a dedicated Explanation page. An update
is also the moment to fix what the page is **missing**: add the **result step** if the procedure has
none, add the **screenshots / code examples / diagram** the prose is doing badly, cut the prose the reader
does not need, and add the links a hub page owes the pages below it. Review it (see "Review") before
saving.

## Flow — delete a page

**Never delete a page on xwiki.org before listing and handling its backlinks** — including a page you
created yourself earlier in the task and then decided to remove. The breakage lands on *other* pages and
nothing in the delete flow names them for you. Follow `okf/conventions/page-deletion.md`, which holds
the procedure, what the deletion wizard does and does not repoint, and the triage.

## Review

Reviewing a page — when asked to, and on **every page you wrote or updated, before step 13 saves it**
— means applying `references/review-checklist.md` to it, page by item. Read that file at that point
each time: `lint` covers only its mechanical subset.
