---
name: xwiki-doc-writing
description: Write, update or review a page of XWiki documentation on xwiki.org, following the XWiki Documentation Guide (Diataxis type & audience, titles/page-names, page-structure fields, style, location, versioning). Use when authoring a NEW documentation page, updating an existing one, or reviewing a page for quality. Also use before DELETING any page on xwiki.org — deletion requires fixing the page's backlinks first. New documentation lives under https://www.xwiki.org/xwiki/bin/view/documentation/. To CONVERT old documentation (the Documentation space or the Extensions wiki) into the new tree, use xwiki-doc-convert instead.
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

For anything larger than a single page edit, use the scripts in this skill's `tools/` directory rather
than hand-rolling REST calls: draft the pages as a `pages.py` data module, then

```bash
set -a; . ~/.xwiki-credentials; set +a
python3 tools/docpages.py lint      # offline; the mechanical rules of documentation.md
python3 tools/docpages.py save      # idempotent publish, every field read back
python3 tools/docpages.py pin       # child order, verified via the tree service
python3 tools/docpages.py verify    # audit + BOTH doc-checker surfaces
```

plus `tools/docshot.sh` and `tools/checkredbox.py` for screenshots. `tools/README.md` documents the
page-set contract and, for each step, the silent failure it protects against — a lost `202`, an object
write blanked by a `#`-less field name, a finding that creates no violation object, a red box clipped
into three sides. Read it before writing the first page; the review checklist below still applies to
everything a regex cannot decide.

## Flow — create a new page

1. **Check it doesn't already exist** elsewhere in `/documentation` (avoid duplication).
2. **Classify** the content: pick the single Diataxis type and the audience
   (see `okf/conventions/documentation.md`). If it mixes types, split it into several pages.
3. **Choose the location** — first, **bundled vs not**: a bundled extension's page goes under
   `documentation.xs`, a non-bundled one under `documentation.extensions`; then the most relevant
   existing topic/subtopic for that audience and type; create a new top-level topic only when nothing
   fits.
4. **Write the title and page name** per the type's rules (verb-led for How-to/Tutorial; noun phrase
   for Reference/Explanation; kebab-case page name, stop words removed, no parent/child repetition).
5. **Fill the page-structure fields** — Content (per type), FAQ (questions with 1–2 sentence
   answers), Related links (**non-child** pages only), Technical ID (`xwiki:<extension id>`, or empty).
   **Leave Highlights empty unless the page has many children**: it is a two-level list of the most
   important *child* pages, not a "key points" summary, and the automatic "More" table already lists
   every child — see `okf/conventions/documentation.md`.
6. **End a How-to / Tutorial with a result step** — the last numbered item shows the reader *what they
   should now see*: a short "The macro is inserted in the page, as follows:" plus a **screenshot** (or,
   on a Developer page, the produced output). A procedure that stops at the last action leaves the
   reader unable to tell whether it worked.
7. **Apply the style rules** — `"quotes"` for UI elements, uppercase-first XWiki terminology,
   `##literals##`, link-reference syntax (never hardcoded URLs), `{{scm}}` for GitHub files, the
   code macro with an explicit `language`, the display macro to avoid duplication, and **no overused
   em dashes** (use the comma, period, colon or parentheses the sentence needs; quoted text keeps its
   dashes).
8. **Give the page something to look at, wherever it earns its place** — **screenshots** on
   User/Administrator pages (every UI element or screen the reader must find), **code examples** on
   Developer pages, and on an Explanation about design/architecture a **PlantUML `bluegray` diagram**
   (components and flows for developers; a lifecycle, workflow or decision diagram for users — be
   creative about what clarifies the concept). An image replaces a paragraph of "click the menu at the top
   right", a snippet replaces a paragraph of API prose. **Don't force it**: a short Explanation or a small
   Reference table can be complete with no visual, and a decorative one costs the reader attention and a
   maintainer an update. Capture screenshots on the local instance agreed above, using the
   [Documentation Resources](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationResources/)
   XARs for realistic content.
9. **Handle attachments by the rules** — kebab-case name with a lowercase extension and **stop words
   removed** (the naming checker applies the page-name rules to attachments), images via the
   `{{image}}` macro with an `alt` and the mandatory `size`, **framed on the element plus the nearest
   landmark that locates it** and cropped to exactly that size's pixel width, with a red
   (`255, 0, 0`) box around the element concerned, **videos in `webm` displayed with the
   `{{embed}}` macro and never as a link**, Gallery for several images, PlantUML (`bluegray`) for
   diagrams. See `okf/conventions/documentation.md`.
10. **Respect version perspective** — write for the latest version; use `{{version}}` (with `before`
    for changed behavior) only for genuine new/changed behavior.
11. **Run the de-duplication *and trimming* pass before saving** — this is a separate step because every
    page reads fine on its own and both defects are invisible while writing. Start with the two that need
    no judgement and that `lint` decides for you — **the sibling How-tos' step 1** and **an attachment
    name declared by more than one page** — then lay the page's intro next
    to its own FAQ, then next to its parent/hub and sibling pages, and hunt for **the same fact stated
    twice in different words**. Each hit: pick one home, and reduce the others to a clause with a link or
    delete them. Then **cut verbosity**: take each sentence and ask *does the reader lose something they
    need in order to act if I delete it?* — if not, delete it rather than compress it. Readers skim, so
    length itself hides content. A How-to whose numbered list is wrapped in explanatory paragraphs, and
    a hub page that narrates the feature instead of **linking every page it introduces**, both fail this
    step.
12. **Save.** A new or substantially rewritten page is a **major** change: save it via a **Change
    Request**, adding to an existing open one on that page if there is one. A pure typo, broken-link
    or small-rephrasing fix is a **minor** change: save it **directly**, ticked "minor", with a short
    summary — do **not** open a Change Request for it. See `okf/conventions/documentation.md`.
    Then read any automatic documentation-check violations the save reports.

## Flow — update an existing page

Keep the page a single Diataxis type. Re-check the title/page-name rules if the scope changed. Update
for the latest version and prune version macros/content for versions no longer supported. Move any
explanation that crept into How-to steps out to the FAQ field or a dedicated Explanation page. An update
is also the moment to fix what the page is **missing**: add the **result step** if the procedure has
none, add the **screenshots / code examples / diagram** the prose is doing badly, cut the prose the reader
does not need, and add the links a hub page owes the pages below it.

## Flow — delete a page

**Never delete a page on xwiki.org before listing and handling its backlinks** — including a page you
created yourself earlier in the task and then decided to remove. The breakage lands on *other* pages and
nothing in the delete flow names them for you. Follow `okf/conventions/page-deletion.md`, which holds
the procedure, what the deletion wizard does and does not repoint, and the triage.

## Review checklist

When reviewing a page, verify and report against these (each finding should cite the rule it relates
to; confirm against the live guide when borderline):

- [ ] **Type** — clearly one Diataxis type (not mixing How-to + Reference + …) with a target audience.
- [ ] **Title** — follows the verb rule for its type; Tutorial titles are specific.
- [ ] **Page name** — kebab-case, no stop words, follows the title, no parent/child path repetition.
- [ ] **Steps** — in How-to/Tutorial each step starts with a verb and is in a numbered list, no
      inline explanations.
- [ ] **Result step** — a How-to/Tutorial's **last step shows the result** (what the reader should now
      see), normally with a screenshot; the list does not stop at the final action.
- [ ] **Shows, not only tells** — User/Administrator pages have **screenshots** of the UI they describe;
      Developer pages have **code examples**; an Explanation about design/architecture has a diagram where
      there is a structure to show. Flag a *missing* visual only where it would replace or clarify prose —
      and flag a **gratuitous** one too.
- [ ] **Verbosity** — no sentence survives that the reader does not need in order to act; no paragraph
      restates the next section, motivates the feature at length, or describes what a screenshot shows.
- [ ] **Hub pages link** — a landing/hub page **names and links every page it introduces** (in the prose
      or Highlights) instead of narrating the feature and leaving the "More" table to do the routing.
- [ ] **Intro** — a How-to's intro is **one short paragraph**; no second or trailing paragraph
      explaining the steps.
- [ ] **No duplication** — no fact is stated on two pages (or in both a page's intro and its own FAQ),
      *however differently it is worded*. Compare against the parent/hub and the siblings, not just
      within the page.
- [ ] **No repeated entry step, one home per attachment** — sibling How-tos do not open with the same
      navigation step, and no attachment name is declared by two pages. The fix is a **visible** page the
      others link to (here, its own How-to), not a hidden `{{display}}` fragment.
- [ ] **FAQ** — reader questions live in the FAQ field (1–2 sentence answers), not buried in steps;
      longer answers split into an Explanation page.
- [ ] **Attachments** — kebab-case names with lowercase extensions; images use `{{image}}` with an
      `alt`; **videos are `webm` embedded with `{{embed}}`, not links**; no animated GIFs.
- [ ] **Structure fields** — Content, FAQ and Related links filled; Technical ID set when an extension
      applies. **Highlights empty** unless the page has many children (and then only a subset of them);
      **Related holds no children** and never links to the page itself.
- [ ] **Title case** — significant words capitalised ("Using", not "using").
- [ ] **Style** — UI elements in `"quotes"`, terminology uppercased, literals in `##…##`, code macro
      uses a `language` parameter.
- [ ] **Punctuation** — no em dash is doing the job of a comma, period, colon or parentheses. Dashes
      inside a **direct quote** are never a finding.
- [ ] **Links** — link-reference syntax (no hardcoded xwiki.org URLs); `{{scm}}` for GitHub files.
- [ ] **Location** — `documentation.xs` for a bundled extension, `documentation.extensions` otherwise;
      then the most relevant existing topic for its audience/type.
- [ ] **Versioning** — written for the latest version; `{{version}}` only for new/changed behavior;
      no obsolete macros or content for unsupported versions.
- [ ] **FAQ size** — at most **5** entries **and at most 25 lines**; the surplus became a separate
      troubleshooting page.
- [ ] **Title/name has no type word** — no "How to", "Explanation", "Reference", "Tutorial" in the
      title or the page name; disambiguation, if any, is a parenthetical in the **title only**.
- [ ] **Understandable out of context** — the title and page name make sense from a search result.
- [ ] **No inline styles** — no `(% style="…" %)`; no raw HTML where XWiki syntax exists.
- [ ] **Images in list items** — wrapped in `(((…)))` so the list is not split.
- [ ] **Screenshot standards** — latest skin, captured while using the feature, captured at the exact
      `size` width, PNG, red (`255, 0, 0`) box around the UI element concerned.
- [ ] **Screenshot framing** — each shot is cropped to the element plus the landmark that locates it,
      not a whole window repeated on every step; the box marks what the step asks for; only the entry
      step keeps the surrounding chrome.
- [ ] **Technical ID** — prefixed: `xwiki:<extension id>` (or `npm:<package id>`), empty only when no
      extension applies. An unprefixed id is the defect; do not "fix" a prefixed one.

Report findings as a list of concrete, actionable items. Do **not** flag a pure style preference:
every finding must be justified by a rule violation (type/title/page-name/structure/style/link/
location/versioning) or a concrete usability or maintainability problem.

## Live examples per page type

Real, well-formed pages in the new tree — read them to calibrate structure, title style, and voice
for each Diataxis type:

- **How-to** (verb-led title, numbered verb-led steps):
  - [Edit a Page](https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/edit-page/)
  - [Configure a Servlet Container](https://www.xwiki.org/xwiki/bin/view/documentation/xs/admin/installation/methods/install-xwiki-war/configure-servlet-container/)
- **Tutorial** (verb-led, more specific / end-to-end than a How-to):
  - [Create an npm package](https://www.xwiki.org/xwiki/bin/view/documentation/xs/dev/front-end/create-npm-package/) (Developer)
  - [Set up NginX Proxy Server](https://www.xwiki.org/xwiki/bin/view/documentation/xs/admin/installation/http-reverse-proxy/nginx-key-configurations/set-nginx/) (Administrator)
- **Reference** (noun-phrase title, tables, concise, code for APIs):
  - [Realtime Edit Actions](https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/edit-page/realtime-edit-actions/)
  - [Ways to Resolve Edit Conflicts](https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/edit-page/resolve-conflict-page/ways-resolve-edit-conflicts/)
  - [Blob Store API](https://www.xwiki.org/xwiki/bin/view/documentation/xs/dev/store/blob/)
- **Explanation** (noun-phrase title, answers "why", concepts/limitations/consequences):
  - [Class Page Deletion](https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/refactoring-operations-pages/delete-page/class-page-deletion/)
  - [Comments Tab in Page Extra Area](https://www.xwiki.org/xwiki/bin/view/documentation/xs/user/base/page/view-page/comments-tab/)
