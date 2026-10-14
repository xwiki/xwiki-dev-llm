# Review checklist

Applied to every page this skill writes or updates, before it is saved, and to any page it is asked
to review. The rules behind each item are in `okf/conventions/documentation.md`.

Apply it **page by item**: every item against every page, and record the ones that came back clean
alongside the findings. A checklist run as a list of things to look for stops at the pages that
already have findings, and "not looked at" then reads exactly like "no finding". `docpages.py lint`
covers only the mechanical subset, so an item it cannot decide — duplication, verbosity, whether a
visual is missing — is only covered if this pass covers it.

Each finding cites the rule it relates to; confirm against the live guide when borderline.

- [ ] **Type** — clearly one Diataxis type (not mixing How-to + Reference + …) with a target audience.
- [ ] **Title** — follows the verb rule for its type; Tutorial titles are specific.
- [ ] **Page name** — kebab-case, no stop words, follows the title, no parent/child path repetition.
- [ ] **Steps** — in How-to/Tutorial each step starts with a verb and is in a numbered list, no
      inline explanations.
- [ ] **Result step** — a How-to/Tutorial's **last step shows the result** (what the reader should now
      see), normally with a screenshot, or a code macro when the result is text; the list does not stop
      at the final action.
- [ ] **Shows — User/Administrator** — **screenshots** of the UI the page describes, on the steps that
      need them.
- [ ] **Shows — no screenshots of text** — anything that is itself text (configuration file, command,
      log line, query) is in a **code macro**, not an image, whatever the audience — above all where the
      reader has to edit or copy it.
- [ ] **Shows — Developer** — **code examples**, and a result step showing the **produced output**
      rather than a screenshot of a UI the page does not have.
- [ ] **Shows — Explanation** — a **diagram** where there is a component structure, a request or data
      flow, a lifecycle or a decision between alternatives; none for a risk narrative, a
      single-concept definition or a FAQ-shaped page.
- [ ] **Shows — Reference** — member-by-member data is **one table**, not a section per member
      (heading + signature + a line of prose) and not a `name: meaning` bullet list. A bare signature
      is a column, not a code example; the code example is for what a cell cannot hold. Check this
      **even on a page whose facts are all correct** — the observed miss was a review that pronounced a
      seven-member API reference "complete and correct" and never asked about its shape.
- [ ] **No gratuitous visual** — flag a decorative screenshot, a diagram of something that is not a
      structure, or a snippet added to satisfy a rule. The test is whether it replaces or clarifies
      something the prose does badly.
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
- [ ] **Structure fields** — Content filled (the FAQ is optional); a top-level page's Related links
      its same-topic counterparts for the other audiences; Technical ID set when an extension applies. **Highlights empty** unless the page has many children (and then only a subset of them);
      **Related holds no children** and never links to the page itself. On a leaf page, an obvious
      missing Related link is advisory only.
- [ ] **Title case** — significant words capitalised ("Using", not "using").
- [ ] **Style** — UI elements in `"quotes"`, terminology uppercased, literals in `##…##`, code macro
      uses a `language` parameter.
- [ ] **Punctuation** — no em dash is doing the job of a comma, period, colon or parentheses. Dashes
      inside a **direct quote** are never a finding.
- [ ] **Links** — link-reference syntax (no hardcoded xwiki.org URLs); `{{scm}}` for GitHub files; a
      JIRA issue is linked only for a bug or limitation that is still unresolved, never for the issue
      that added a feature or fixed a bug.
- [ ] **Location** — `documentation.xs` for a bundled extension, `documentation.extensions` otherwise;
      then the most relevant existing topic for its audience/type.
- [ ] **Versioning** — written for the latest version; `{{version}}` only for new/changed behavior;
      no obsolete macros or content for unsupported versions. **Every version on the page is inside a
      `{{version}}` macro** — no bare version in prose and **no `Since` / `Version` column in a
      reference table** — and every version cited is at or after the current LTS; an older one is
      removed outright rather than reformatted.
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
