---
title: XWiki documentation conventions (Documentation Guide)
stability: durable
summary: The rules for xwiki.org documentation — Diataxis page types & audiences, title/page-name
  rules, per-type content rules (incl. the mandatory result step closing a How-to/Tutorial), showing
  rather than only telling — screenshots for User/Admin pages, code examples for Developer ones,
  architecture/concept diagrams for Explanations, and when *not* to force a visual, how much belongs on
  one page (granularity, keeping verbosity low, a hub page routing rather than narrating & how
  duplication is actually detected), the page-structure xobject fields (Highlights/More/Related and their exact
  semantics), documentation style (incl. never hard-wrapping prose — on xwiki.org pages and forum
  posts alike), attachment/image/video rules (incl. webm + the `{{embed}}` macro),
  page location, version-perspective and `{{version}}` rules, the XWiki syntax traps that silently
  mis-render, and navigation-order pinning. Handling the *original* page after a migration is split
  out into [[documentation-migration]]; deleting any page (backlinks first) into [[page-deletion]]. The
  live Documentation Guide is the evolving source of truth; prefer it whenever a detail here is
  borderline or missing.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ApplyDiataxis/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ChooseRightLocation/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/CreateNewDocumentation/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/CreateLandingPages/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/PageTitlesNames/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/PageStructure/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/HighlightsPage/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationNavigationTree/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/HorizontalMenu/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationResources/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/Versioning/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/SaveChanges/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/WorkingAttachments/
  - https://www.xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/create-documentation-page/page-structure/
  - https://www.xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/documentation-xwiki-org/page-structure-xwikiorg/
  - https://www.xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/version-macro/
  - https://www.xwiki.org/xwiki/bin/view/Macros/SCM
  - https://diataxis.fr/
---

# XWiki documentation conventions

Declarative rules for **xwiki.org** documentation. The **procedures** that apply them live in the
skills: [`xwiki-doc-writing`] (write / update / review a page) and [`xwiki-doc-convert`] (convert old
documentation into the new `/documentation` tree).

The authoritative source of truth is the **XWiki Documentation Guide**
(https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide and its sub-pages — the ones this file
derives from are listed in `sources:` above). The guide is actively evolving: the rules below are a
durable working summary, but **when a detail matters or is missing here, consult the live guide and
prefer it over this file**.

Scope facts:

- All **new** and refactored documentation lives under the documentation root
  https://www.xwiki.org/xwiki/bin/view/documentation/ — **not** under the old `Documentation` space
  or the Extensions wiki (those are the *old* documentation, being migrated out).
- Documentation pages are **wiki pages**, not files in a git repo — authored in XWiki syntax on the
  wiki, and submitted via a Change Request.
- All documentation is written in **English**, and a feature must be tested on a real wiki running an
  LTS version (or beyond) before being documented.

## Diataxis: one type + one audience per page

Every page follows the [Diataxis](https://diataxis.fr/) methodology and is **exactly one of four
types**, tagged with **one audience** (User / Administrator / Developer). If a page mixes types, it
must be split. The Diataxis type is stored on the page (see page-structure fields below) and drives
the type-grouped landing pages.

| Type | Orientation | Purpose |
|------|-------------|---------|
| **How-to** | goal-oriented | directions to achieve a specific goal |
| **Tutorial** | learning-oriented | a How-to applied to a concrete example; more specific / end-to-end |
| **Reference** | information-oriented | technical description covering a topic extensively |
| **Explanation** | understanding-oriented | discussion that answers "why" |

## Titles and page names

**Title rules depend on the type:**

| Type | Title |
|------|-------|
| How-to | **Starts with a verb** — "Select", "Configure", "Edit a Page" (not "Editing a Page") |
| Tutorial | **Starts with a verb**, and is **more specific** than a How-to — "Build a FAQ Application" |
| Reference | **Does not** start with a verb; indicates the topic is covered extensively — "All Wiki Pages" |
| Explanation | **Does not** start with a verb; a phrase naming the subject, answering "why" — "Conflict Resolution" |

**Titles use English title case** — capitalise the significant words, not just the first:
*"Edit a Page Using the WYSIWYG Editor"*, not *"Edit a Page using the WYSIWYG Editor"*. This rule is **not currently
stated** on the guide's
[Page Titles and Page Names](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/PageTitlesNames/)
page even though existing pages follow it, so it is worth adding upstream.

**Titles and page names must not contain the page type** — no "How to", "Explanation", "Reference",
"Tutorial", etc. These are **reserved terms**: the type is already conveyed by the content, the
structure and the badge, so repeating it is redundant. Per the guide's
[Page Titles and Page Names](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/PageTitlesNames/)
page.

**Disambiguation is a parenthetical in the title, and is not added to the page name** — e.g. "All the
Pages on the Wiki (for Administrators)". Same source page.

**Titles and page names must be understandable out of context** — a reader may arrive from a search
result, a bookmark or a link, none of which carry the surrounding context. Same source page.

**Page-name rules** (the URL segment):

- Use **kebab-case** (XWiki naming strategy).
- **Remove stop words** manually ("a", "the", "on", "when", "while"…) until xwiki.org is on XWiki
  18.1.0+ (which does it automatically).
- Follow the title as closely as possible while respecting the rules above.
- **No repetition between parent and child paths** — rely on the parent for context
  (`../wiki-editor-toolbar/support`, not `../wiki-editor-toolbar/wiki-editor-toolbar-support`).

## Content rules per type

- **How-to / Tutorial** — every step **starts with a verb** and is an item of a **numbered list**.
  Do **not** add extra explanations inside the steps; reader questions and clarifications go in the
  **FAQ** field instead. Tutorials may include short concrete examples.
- **The last step of a How-to / Tutorial shows the result.** A procedure that ends on the last action
  leaves the reader unable to tell whether it worked. Close with a step that *shows what they should now
  see* — "The macro is inserted in the page, as follows:" plus a **screenshot** (or, for a Developer
  page, the produced output). This is a step of the numbered list, not a trailing paragraph, so it does
  not violate the one-short-intro / no-explanations-in-steps rules. A How-to whose numbered list stops
  at "Click Save" is incomplete, and nothing in the automatic checks says so.
- **Reference** — prefer **tables**, keep information concise; use **code examples** for API references.
- **Explanation** — explain concepts, limitations, consequences, and background.

### Show, don't only tell — images, code and diagrams

Prose alone is the weakest form of documentation: an image is worth a thousand words, and so is a code
example. **Aim for every page to show something**, and reach for a visual or a snippet wherever one would
replace a paragraph:

- **User and Administrator pages: screenshots.** Every UI element or screen the reader has to find is
  worth a **screenshot** — it beats a paragraph of "click the three-dot menu at the top right of the
  second panel". A whole page of steps through a UI with **not one screenshot** is the typical miss.
- **Developer pages: code examples.** A runnable snippet (script macro, Java API call, REST request,
  configuration file) shows in five lines what a paragraph struggles to say. Use the code macro with an
  explicit `language`.
- **Explanation pages: a diagram, when there is a structure to show.** An Explanation has no UI steps to
  screenshot, but one that discusses **design or architecture** is often carried by an **architecture
  diagram** — components and what flows between them — especially for a Developer audience. For a User
  audience, prefer a diagram that reads without technical vocabulary: a lifecycle, a state or workflow
  diagram, a decision tree between alternatives, a before/after. Be creative about what actually
  clarifies the concept. Diagrams use the **PlantUML macro with the `bluegray` theme** (see below), so
  the source stays editable in the page.
- **Do not force it.** This is a strong default, not a checkbox: a short Explanation of a single concept,
  a small Reference table, a FAQ-shaped page can be perfectly complete with no visual at all. A
  decorative screenshot, a diagram of something that is not a structure, or a snippet added to satisfy
  the rule each cost the reader attention and cost a maintainer an update. The test is **does it replace
  or clarify something the prose does badly?** — if not, leave it out.
- Screenshots have hard mechanical rules (mandatory `size`, capture width, red box, PNG, `{{image}}`
  + `alt`) — see "Attachments, images and videos" below. Those rules govern *how*; this section is the
  *whether*.

### Troubleshooting pages

A "troubleshooting" page is **not** a fifth Diataxis type (none exists — see the allowed `type` values
below). The established convention on xwiki.org is: `type=explanation`, with **level-3** `=== Cause ===`
/ `=== Solution ===` headings. Level 3 is deliberate and is what the existing troubleshooting pages
use, even though level 2 is the norm for ordinary section headings elsewhere — do not "correct" it.

## How much belongs on one page

- **A How-to is ONE procedure**: a single numbered list, **no level-2 sections**, and no explanatory
  material inside the steps. Reader questions go to the **FAQ** field; the *why* goes to an
  Explanation page. As an order of magnitude (indicative sizes observed on one refactored tree, **not**
  limits): a leaf How-to came to a few thousand characters, under ten steps and **0 headings**; a hub
  Explanation was somewhat shorter and carried no procedure at all.
- **Two alternative procedures for the same goal are two How-tos**, with an **Explanation hub** above
  them that explains how to choose between them — e.g. several alternative ways to install or deploy
  something become one How-to each, under a single Explanation that compares them.
- **When a topic needs both a How-to and an Explanation, the How-to is the parent** and the
  Explanation its child, linked from the How-to's intro, so the reader lands on the goal page first.
  **This inverts for a hub**: when one Explanation covers several sibling How-tos, the Explanation is
  the parent and the How-tos are its children. The guide's
  [Choose the Right Location](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ChooseRightLocation/)
  does not state a rule either way.
- **One fact lives on one page; every other page links to it.** A How-to's intro states the goal plus
  the facts needed to follow the steps — never the *why*, which is the Explanation's job. Do not
  copy-paste a paragraph, a FAQ entry or a step between pages, however short it is.
- When the **same** content genuinely must appear in two places, use the **`{{display}}` macro**, not a
  second copy — the shared text lives on a **hidden page nested inside one of the consuming pages** and
  is displayed from the others. Never a second copy, however short. Mechanics (hiding the page, what
  objects it must *not* carry, reference syntax, heading levels): [[documentation-mechanics]].
- **A How-to's intro is one short paragraph.** Anything that wants to be a second or trailing
  paragraph is misplaced content, and each kind has a home: a **prerequisite** shrinks to one clause
  with a link, a **reader question** becomes a **FAQ** entry, the ***why*** goes to the Explanation.
  Explanatory paragraphs wrapped around the numbered list are the most common way a How-to drifts —
  the steps *are* the page.
- **Keep verbosity low — readers skim, they do not read.** Length is itself a defect: a wall of text is
  skipped, so a fact buried in the fourth paragraph is a fact the reader never gets. The test for each
  sentence is **"does the reader lose something they need in order to act if I delete it?"** — if not,
  delete it, and do not "compress" it into a subordinate clause. Restating what the next section
  already says, motivating the feature at length, and describing what the reader can see on screen are
  the three that inflate a page most. Prefer a **screenshot or a code example** over a paragraph
  wherever one will do (see "Every page shows something" above), a **table** over prose in a Reference,
  and a **link** over a summary.
- **A hub page's job is to route, not to narrate.** An extension/topic landing page that explains the
  feature in several paragraphs but never links to its own How-to, Reference and Explanation pages has
  failed at the one thing it exists for. Every page it introduces is **named and linked** (in the prose,
  in **Highlights**, or both); the prose around those links stays a short orienting sentence each.
  Observed failure mode: an extension hub whose intro read as a mini-manual, with the pages documenting
  each of its features reachable only through the automatic "More" table.
- **Duplication is found by comparing pages, not by writing each one carefully.** Every page reads
  fine on its own; that is exactly why the duplication survives. Before finishing a tree, put the
  intros, the FAQ entries and the hub prose **side by side** and look for *the same fact stated
  twice*, not for repeated wording — a re-phrased sentence is still a duplicate, and re-phrasing is
  what makes it invisible. Observed on one refactored tree: "the paste plugin must be activated by an
  administrator" appeared in **five** places (two How-to intros, two FAQ entries, one hub) in five
  different phrasings, and a limitation ("Jira Cloud is not supported, because …") appeared verbatim
  on both the user and the administrator hub. Give each recurring fact **one named home**, and
  elsewhere state it as a clause with a link — or not at all.

## Page-structure fields

Documentation pages have stable, auto-generated level-1 headings backed by the
`DocApp.Code.DocumentationClass` xobject; the **Technical ID** lives on a separate
`DocApp.Code.DocumentationExtensionClass` xobject (`id` property). The page body itself is the page
**content** field (XWiki 2.1 syntax). Developer API-reference pages sit under
`documentation/xs/dev/<topic>/<subtopic>/WebHome`. For how these xobjects are stored and read
programmatically, see [[documentation-mechanics]].

The **exact allowed values** of the two classification properties, read from the class definition
itself (`GET /rest/wikis/xwiki/classes/DocApp.Code.DocumentationClass`) rather than guessed:

| Property | Allowed values |
|----------|----------------|
| `type` | `tutorial` \| `howto` \| `reference` \| `explanation` |
| `target` | `user` \| `administrator` \| `developer` (**`administrator`**, not `admin`) |

There are only those four `type` values — in particular **there is no `troubleshooting` type**; a
troubleshooting page is an **Explanation** (see "Troubleshooting pages" below).

The fields:

- **Content** — the main content for the page type. Additional headings go under it as level-2 (or
  lower) headings.
- **FAQ** — level-2 headings phrased as **questions** a user/admin/developer might have, with answers
  limited to **1–2 sentences**. If a longer answer is needed, create a dedicated Explanation page.
  **At most 5 entries, and at most 25 lines of FAQ content**: beyond either limit the `faqEntryCount`
  documentation check reports a **warning**, and the surplus must become a separate troubleshooting
  documentation page. Per [Page Structure](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/PageStructure/).
- **Highlights** — **a short list of the most important *child* pages**, to guide readers when a page
  has **many** children. It is *not* prose, and *not* a general "key points" summary. The syntax is a
  strict two-level list — level 1 is the **link**, level 2 its **one-line description** — written with
  plain page references and **no `doc:` prefix**:
  ```
  * [[Page Title 1>>reference.to.page1.WebHome]]
  ** Description of the first page
  * [[Page Title 2>>reference.to.page2.WebHome]]
  ** Description of the second page
  ```
  **Fill it only when a page has many children**, and then **only with a subset** — the "More" section
  already lists every child, so highlighting all of them defeats the purpose (on one refactored tree the
  hubs settled on 5 highlights out of 9 children, and 5 out of 7). A **leaf page's Highlights is empty**;
  so is that of a page with one or a few children. Do not "fill Highlights everywhere".

  Highlights are **recommended once a page has more than 15 child pages**, with a **maximum of 6**
  highlights — on documentation pages and landing pages alike. "Child pages", "rows of the automatic
  *More* table" and the guide's former "pages in the LiveTable" all mean the same set. **No automatic
  documentation check enforces any of this** (the checks cover FAQ size, images, videos, attachments,
  page names/titles, syntax and verbs — never Highlights), so it is a convention reviewers uphold, not
  a gate. Source of truth:
  [Highlights on a Page](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/HighlightsPage/).
- **More** — **automatic**; a filterable livedata table of the page's **child** pages plus a search
  box. Nothing to fill. Highlights are displayed inside this section.
- **Related links** — links to pages with related content that are **NOT children** of this page. A
  child belongs in **Highlights**, never here. Two further rules:
  - **A `related` field must never link to its own page.**
  - **After a restructure, re-check it.** Moving a page *in* under a hub turns it into a child, which
    silently puts it in breach of the not-children rule inside that hub's `related` — the link still
    resolves, so no broken-reference sweep can detect it. The check a restructure needs is not only
    "does every reference still resolve?" but **"is every field still allowed to hold what it holds?"**
- **Technical ID** — **every documentation page must be associated with an Extension**, and located
  accordingly (see "Choose the right location" above); the Technical ID is that extension's id (or its
  NPM package), copied from the Extensions-wiki `ExtensionCode` xobject. The value is
  **prefixed by how the feature is distributed** — the bare `<groupId>:<artifactId>` is *not* the
  format:
  - an XWiki Extension → **`xwiki:<extension id>`**, e.g. `xwiki:org.xwiki.platform:xwiki-platform-icon-macro`
  - an NPM package → **`npm:<package id>`**, e.g. `npm:@xwiki/platform-dsapi` (Documentation 1.7+)

  The prefix is what makes the badge at the bottom of the page resolve to the Extensions wiki, so an
  unprefixed id renders no badge. Empty when no extension applies (e.g. installation pages).
  **Older pages carrying an unprefixed id are the non-conformant ones** — do not "fix" a prefixed id
  to match them. The generic
  [Apply Diataxis](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ApplyDiataxis/) page does
  not state this xwiki.org-specific prefix; the authority is
  [Page Structure on xwiki.org](https://www.xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/documentation-xwiki-org/page-structure-xwikiorg/).

The **Documentation application's own reference** for these fields is
[Documentation Page Structure](https://www.xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/create-documentation-page/page-structure/)
— note that it lives on **www**.xwiki.org under `/documentation`, and is a *different* resource from
the [Documentation Guide](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide) on **dev**.xwiki.org.
Use the guide for the authoring rules, and that page for what each structure field does.

## Documentation style

- **Syntax** — write content in XWiki syntax. **Avoid HTML**; use XWiki syntax instead. Per the
  guide's [Documentation Style](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/)
  "Syntax" section.
- **No inline styles** — do not write `(% style="font-family:…" %)` or similar; pages carry **content
  only**, so they all look the same. Same source page, "No Styles" section.
- **UI elements** — buttons, menu items, tabs, panel names go in `"quotes"` — e.g. `Click the
  "Edit" button.`
- **XWiki terminology** — words with a special XWiki meaning (Panel, Sheet…) are written in **plain
  text with an uppercase first letter**, until a Glossary strategy exists.
- **Glossary** — until the Glossary Application is configured, all XWiki terminology must be collected
  on the [`dev:Drafts.Glossary.WebHome`](https://dev.xwiki.org/xwiki/bin/view/Drafts/Glossary/) page,
  and each entry gets a Diataxis **Explanation** page, located in the place in the documentation
  hierarchy where that explanation makes sense. Same source page, "Glossary" section.
- **Literals / computer terms** — use the `##monospace##` notation — e.g. `the ##age## xproperty`.
- **Linking** — do **not** hardcode xwiki.org URLs; use XWiki **link reference syntax** (copy the
  page reference from its Information tab). Use the relative reference for same-wiki links and the
  global reference for cross-wiki links. To link to a file on GitHub, use the `{{scm}}` macro so SCM
  moves don't break links — but note its **two hard limits**, which make the rule not always
  achievable: a macro **does not render inside `{{code}}`** (so a download URL inside a shell snippet
  can never use it), and it has **no `anchor` parameter** (so it cannot link to a section of a README).
  Signature (from [Macros.SCM](https://www.xwiki.org/xwiki/bin/view/Macros/SCM)): `user` (default
  `xwiki`), `project` (default `xwiki-platform`), `branch` (default `master`), `path`, `raw`.
- **Macros** — use the **code macro with an explicit `language` parameter** for code snippets
  (omitting it is slower and mis-colors). Use the **display macro** to avoid duplicated content: put
  repeated text/steps/images on a single hidden page and display it where needed.
- **Never hard-wrap prose** — write each paragraph (and each list item) as a **single unbroken line**,
  however long. This holds for xwiki.org page content *and* for forum.xwiki.org (Discourse) posts:
  both reflow prose themselves, so manual line breaks inside a paragraph gain nothing and actively
  hurt — they are painful to re-wrap in the web editor and can leak into the rendered output. The
  **120-character limit is a Java-source rule** ([[code-style]]), enforced by Checkstyle; applying it
  to prose bound for a web editor is a category error. Only fenced/`{{code}}` blocks keep their own
  line structure, since there the code's formatting rules apply.

## Attachments, images and videos

The guide's own page is
[Working with Attachments](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/WorkingAttachments/).
These rules decide whether a page renders as intended, so they belong to authoring, not to clean-up:

- **Attachment names follow the page-name rules** — kebab-case, and a **lowercase extension**:
  `Image.png` and `Image.PNG` are two different attachments with separate version histories.
- **Insert an image with the `{{image}}` macro**, always with an `alt` (WCAG), and optionally a
  `caption` — a good place for the product version the screenshot was taken in:
  `{{image reference="…" size="large" alt="…" caption="…"/}}`. Present the image *before* a
  description of what it shows.
- **In the `documentation` space `size` is mandatory and `width` is forbidden.** The quality checker
  rejects the image otherwise: *"Best practice: The Image macro, when used in the "documentation"
  space, must specify a 'size' parameter and no 'width' one."* A screenshot therefore **cannot** be
  rendered at its natural width, which is why the capture rules below fix the width at capture time.
- **Screenshot standards** — capture with the **latest skin**; capture while actually **using the
  feature** (not a staged state); capture **at exactly the pixel width of the `size` it will be shown
  at**, at `devicePixelRatio` 1 (resize the browser first) — anything else is rescaled by the browser,
  and an undersized original is upscaled and blurred; save in **PNG** only; add a **red square, RGB
  `255, 0, 0`**, around the UI element concerned. The `size` parameter's named values:

  | Value | Width |
  |-------|-------|
  | `extra` | 960px (whole interface screens) |
  | `large` | 650px |
  | `medium` | 350px |
  | `small` | 150px |

  The capture-width constraint comes from the checker rule above; the rest is the guide's
  [Working with Attachments](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/WorkingAttachments/)
  "Screenshot Standards" section.
- **Never generate an example of rendered output — screenshot it.** A generated example (calling
  `{{displayIcon}}` to show an icon, say) silently changes when the product does.
- **Several images side by side go in the Gallery macro**, so variations don't clutter the page.
- **No animated GIFs** — they are unmaintainable; use several PNGs instead.
- **Never wrap a table in the `{{figure}}` / `{{figureCaption}}` macros.** The Figure macro is
  **`org.xwiki.contrib:figure-macro`**, a contrib extension that xwiki.org does not have, so the
  wrapper renders an `Unknown macro: figure` error box **in place of the table** — the content
  disappears while the page still looks deliberate. The guide's
  [Working with Attachments](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/WorkingAttachments/)
  never asks for it (it mentions figures only in a WCAG aside about describing non-text content), and
  no page under `documentation` uses it. Write the table on its own; if it needs a caption, that is a
  sentence of prose before it. More generally, **a macro being bundled in XWiki is not the test — what
  matters is whether xwiki.org has it**: PlantUML is contrib too (`org.xwiki.contrib.plantuml`) and the
  guide *requires* it, because xwiki.org installs it. Checking a local instance proves nothing either
  way; its extension set is not xwiki.org's.
- **Videos: avoid them unless they carry real value** — they rot as the UI changes. When one is
  justified it is in **`webm`** format and it is **displayed with the `{{embed}}` macro**:
  `{{embed attachment="usage.webm" width="780"/}}`, which renders a real HTML5 player. **A video is
  embedded, never linked.** Downgrading an embed to an `attach:` link — the tempting move when
  converting an old page whose video you are re-encoding — loses the player, and nothing flags it:
  the link resolves, the checker stays silent, and the page reads fine.
- **Diagrams use the PlantUML macro with the `bluegray` theme**, never a screenshot of a rendered
  diagram, so the source stays in the page and stays editable.
- **Updating an attachment means re-uploading it under the same name**, which versions it — do not
  delete and re-add. The one place attachments *are* deleted is the original page after a migration
  (see [[documentation-migration]]).

## Choose the right location

**Step 1 is bundled-vs-not.** Every documentation page must be associated with an Extension: a
**bundled** extension's page goes under `documentation.xs`, a **non-bundled** one under
`documentation.extensions`. This is the *first* decision an author makes, before audience or topic.
Per the guide's
[Choose the Right Location](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ChooseRightLocation/)
page.

Then place the page under the **most relevant existing topic / subtopic** of the `/documentation`
tree, matching its audience (User / Admin / Developer) and type. Create a new top-level topic **only**
when no existing topic fits.

## Versioning and perspective

- Write documentation from the perspective of the **latest version**.
- Document differences from the latest version **secondarily**, using the
  [`{{version}}` macro](https://xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/version-macro/):
  - **New feature** — mark the version-specific content with `{{version since="…"}}`.
  - **Changed behavior / UI** — write the latest behavior normally, and use the macro's `before`
    parameter for the old behavior — e.g.
    `The tab uses the "Language" terminology ({{version before="16.10.12"}}Previously, the tab was using the "Locale" terminology{{/version}}).`
  - Skip the macro for trivial UI changes (no text changed, same behavior, same area) — it only
    clutters the page.
- **Documenting a feature before it is released is accepted, and even desirable** — the documentation
  is then ready on release day. The condition is that the unreleased content carries
  `{{version since="…"}}`, so a reader on the current release knows it does not apply to them yet.
  This also settles what "the perspective of the latest version" means when the newest UI ships in no
  release yet: keep the **released** version as the baseline prose — which is also what the
  screenshots can show — and badge the additions. Describing unreleased UI as if it were current is
  the failure mode, not documenting it early.
- **Version bounds** — for **XWiki itself**, only specify versions **at or after the LTS**, and only
  while that version is within the currently supported **LTS cycle**. For **extensions**, specify the
  **released version**. Per the guide's
  [Versioning](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/Versioning/) page, "The Version
  Macro" section.
- **Maintenance** — remove content and version macros for **unsupported old versions**, and remove
  obsolete macros once the referenced version is no longer relevant.

### The `{{version}}` macro — real signature and rendering

Full signature (Documentation 1.7+, per
[Version Macro](https://www.xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/version-macro/)):
`{{version product="…" since|before="…, …, …"}}content{{/version}}`.

- **`since`/`before` take a comma-separated *list* of versions**, not a single value — which is what
  you need when a change ships on several maintained branches at once.
- **`product`** is free text, defaulting to `XWiki`.
- **How it renders:** `since` produces `XWiki 17.10.11+, 18.4.3+, 18.6.0+` and `before` produces
  `XWiki <17.10.11, <18.4.3, <18.6.0`. The badge is **prefixed to** the wrapped content, so **the
  sentence must not repeat the numbers** or the reader sees them twice.
- **Where it works:** inline, **inside a table cell**, and as a block wrapping several paragraphs plus
  a code block.

### What deserves a version badge at all

- **Only product behaviour gets a badge.** A capability of the *surrounding* platform that works against
  every release (a container-runtime flag, a filesystem mount, a database setting) is never
  version-scoped, however new the documentation's *use* of it is.
- **Do not pin a version in prose unless it is load-bearing.** The test that separates the two cases:
  **does the sentence stay complete and true without the number?** If yes, the number is an incidental
  "what happens to be current" value — delete it. If no, it marks a real behavioural boundary — badge
  it with `{{version}}`. This is what keeps the versioning rule above from colliding with the general
  preference for writing from the latest version's perspective.

## Saving changes: minor directly, major via a Change Request

The guide's [Save the Changes](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/SaveChanges/)
page splits edits in two, and the split decides whether a Change Request is the right tool:

- **Minor changes — fix them directly on the page, with no Change Request.** Grammar and spelling,
  typing errors, broken links, small rephrasings for clarity, and other low-impact fixes that change
  neither structure nor meaning. Tick **"minor"** so the page's followers are not notified, write a
  short version summary ("fixed typo", "fix broken link"), and use **Preview** before saving. Opening
  a Change Request for a typo is the noise this rule exists to prevent.
- **Major changes — save via a Change Request.** New documentation, refactoring a page to the guide,
  restructuring navigation, moving content between locations, and bulk edits across many pages. When
  a page already has an open Change Request covering related work, add to **that** one rather than
  opening a second.
- **Automatic documentation checks run on save** for any page carrying the documentation object class,
  and report guide violations inline — read them before moving on.

## Handling the original page after migration

Migrating old content is not done until the **source** page is handled — stripping its prose without
deleting an extension page, deleting its leftover attachments, and triaging its backlinks. Those
rules are in [[documentation-migration]]; they apply only to a migration, so they are not repeated
here.

## Deleting a page

Whenever a page is **removed** — a superseded or duplicate page, an obsolete one, or a page you created
earlier in the task and then decided against — **its backlinks are listed and handled first**, and
relocating content is a **rename/move** rather than a delete-and-recreate. The rule and the procedure
are in [[page-deletion]]; they are not doc-specific, so they are not repeated here.

## XWiki syntax traps that bite when authoring documentation

All verified against rendered output on www.xwiki.org. Each one produces a *plausible-looking* page
rather than an error, which is why they are worth listing.

- **Newlines are significant.** A paragraph, a table row or a list item must be on **one single
  line** — never wrap for readability. A newline inside a paragraph splits it in two; inside a table
  row it breaks the table.
- **Never let the word `image` be followed by a colon, anywhere.** XWiki parses `image:` as a
  resource-scheme prefix, so a sentence ending `…a ready-to-use image:` emits an *empty image
  reference*, which the doc-quality checker flags (`Use the Image macro instead.`) and which makes the
  page render a red validation banner. Before `(((` it also swallows the word and leaks a literal `)))`
  into the page. **Rephrase** ("…image, as follows:") — never escape it. The same applies to any
  scheme-like token followed by `:` — `attach:`, `url:`, `mailto:`. **Grep every draft for these.**
- **`--` is strikethrough, and `##…##` does not protect it.** A monospace span such as
  `##--flag-name=value##` renders as `<del>flag-name=value</del>`: the leading dashes are *eaten*. An
  **unmatched** `--` opens a `<del>` that runs **to the end of the block**, silently striking through
  every remaining sentence. So every occurrence is a defect, not just paired ones. Use
  `{{code language="none"}}--flag{{/code}}` inline, or a block code macro. Command-line flags are
  exactly the content that trips this.
- **`##…##` does not work around a URL.** `##http://localhost:8080/##` renders as
  `http://localhost:8080/#` plus a stray `#`, because the autolinker eats one hash. Use
  `{{code language="none"}}` for URLs.
- **Never escape the hashes of a monospace span.** `~#~#1/1~#~#` renders as a *literal* `##1/1##`.
  Plain `##1/1##` works fine, even directly after a sentence.
- **Never put a bare URL in a heading** — the autolinker absorbs the trailing punctuation into the
  href, so `== …look like https://wiki.example.com:80/? ==` loses its question mark, and it poisons the
  generated anchor id. Rephrase the heading and put the URL in the body inside a code macro.
- **A blank line between two list items ends the list**, so numbering restarts at 1. Keep list items on
  consecutive lines.
- **Angle brackets inside `##…##` are safe** — `##<prefix>_xwiki-data##` renders as literal monospace.
  XWiki 2.1 does not accept raw HTML outside `{{html}}`, so `<…>` placeholders need no escaping.
- **Section anchors barely work on www.xwiki.org.** The syntax is
  `[[label>>doc:PageA.PageB||anchor="HMyheading"]]` (the id is `H` + the heading with only
  alphanumerics kept), but the fragment **is only serialized when a `queryString` is also present** —
  `||anchor="…"` alone is silently dropped from the rendered `href`. Appending `#HMySection` to the
  reference is **not** an alternative: it is parsed as part of the page name and yields a red
  `wikicreatelink` to a non-existent page. Until this is fixed, **link to the page and make the section
  title the link label** so the reader knows what to look for on arrival.
- **Copy-pasted content carries non-breaking spaces (`\xa0`)**, which defeat exact-string matching and
  look like double spaces. Match on line prefixes rather than whole-string equality.
- **An image inside a list item must be wrapped in `(((…)))`.** Writing the `{{image}}` macro on its
  own line after a list item ends the list and starts a second one, leaving the image outside the
  item. `* Item 2(((` + the macro + `)))` keeps it inside. Per the guide's
  [Documentation Style](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/)
  "List Items" section.

## Navigation order — pinning child pages

The documentation navigation panel is a **Document Tree macro**, and an unpinned node lists its
children **alphabetically by page *title*** (not by page name — which is what makes the default order
so hard to predict from a URL). So **finishing a documentation tree includes deciding its order**:
creating or restructuring pages without pinning silently hands the reader an alphabetical one, in which
an advanced "build your own image" How-to can easily precede the pages that tell you how to run it.

The authority is the guide's
[Documentation Navigation Panel](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationNavigationTree/):
top-level nodes **must** be pinned, ordered by "usability, relevance, and importance"; other pages
pinned "where it makes sense"; and **type landing pages** (a distinct thing from ordinary pages) are
pinned in Diataxis order Tutorial → How-to → Reference → Explanation.

Two further rules, established in practice and **not** stated in the guide:

- **Pin a node in full, or not at all.** A partial pin leaves the remaining children sorting
  alphabetically underneath the pinned ones, which is worse than either extreme because it looks
  deliberate.
- **The tree must not contradict the page.** When a landing page's prose lists its children in a
  deliberate order, the pin repeats that order rather than inventing a second one. The same applies to
  the **Highlights** field: if it singles out a subset, take them in the pinned order.

A node with a single child needs no pin. For the **mechanism** — where the pin is stored, and why it
must be verified through the tree service rather than by reading the stored value back — see
[[documentation-mechanics]].

**Documentation pages must not appear in the xwiki.org horizontal menu** — that menu is for content
shared across all projects, not project-specific documentation — and **pages that do appear in it
must not have left panels**. Per the guide's
[Horizontal Menu](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/HorizontalMenu/) page.
