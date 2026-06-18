---
name: xwiki-documentation
description: Write and review XWiki documentation for xwiki.org following the XWiki Documentation Guide (Diataxis page types, titles/naming, page structure, style, location, versioning). Use when writing new documentation for XWiki, or when reviewing existing documentation pages for quality and adherence to best practices. New documentation lives under https://www.xwiki.org/xwiki/bin/view/documentation/.
---

# Writing and reviewing XWiki documentation

This skill helps you **write** new XWiki documentation and **review** existing pages for quality and
adherence to the project's documentation practices.

The authoritative source of truth is the **XWiki Documentation Guide** at
https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide and its sub-pages (indexed at the end of
this skill). The rules below are a working summary — the guide is actively evolving, so when a
detail matters or is missing here, **consult the live guide pages and prefer them over this
summary**.

## Scope

- All **new** (and refactored) documentation lives under the documentation root:
  https://www.xwiki.org/xwiki/bin/view/documentation/ — not under the old `Documentation` space or
  the Extensions wiki.
- Documentation pages are **wiki pages**, not files in a git repo. This skill produces
  well-structured page content (in XWiki syntax) and review findings; it does not commit files. The
  developer creates/edits the page on the wiki.
- All documentation is written in **English**, and features must be tested on a real wiki running an
  LTS version or beyond before being documented.

## 1. Classify the page (Diataxis)

Every documentation page must follow the [Diataxis](https://diataxis.fr/) methodology. Each page is
**exactly one of four types**, and is also tagged with **one target audience**.

Types:

| Type | Orientation | Purpose |
|------|-------------|---------|
| **How-to** | goal-oriented | directions to achieve a specific goal |
| **Tutorial** | learning-oriented | a How-to applied to a concrete example; more specific |
| **Reference** | information-oriented | technical description covering a topic extensively |
| **Explanation** | understanding-oriented | discussion that answers "why" |

Audiences: **User**, **Administrator**, **Developer**.

To apply Diataxis: split content by type and audience, create the page at the right location, and
fill the page-structure fields correctly. If a page mixes types, split it.
Ref: [Apply Diataxis](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ApplyDiataxis/).

## 2. Title and page name

**Title rules depend on the type:**

| Type | Title |
|------|-------|
| How-to | **Starts with a verb** — "Select", "Apply", "Set", "Configure", "Edit a Page" (not "Editing a Page") |
| Tutorial | **Starts with a verb**, and is **more specific** than a How-to — "Build a FAQ Application" |
| Reference | **Does not** start with a verb; clearly indicates the topic is covered extensively — "All Wiki Pages", "Common Edit Actions" |
| Explanation | **Does not** start with a verb; a phrase representing the subject, answering "why" — "Conflict Resolution" |

**Page name rules** (the URL segment):

- Use **kebab-case** (XWiki naming strategy).
- **Remove stop words** manually ("a", "the", "on", "when", "while"…) until xwiki.org is on XWiki
  18.1.0+ (which does it automatically).
- The page name should follow the title as closely as possible while respecting the rules above.
- **No repetition between parent and child paths.** Rely on the parent for context — use
  `../wiki-editor-toolbar/support`, not `../wiki-editor-toolbar/wiki-editor-toolbar-support`.

Ref: [Page Titles and Page Names](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/PageTitlesNames/).

## 3. Content rules per type

- **How-to / Tutorial**: every step **starts with a verb** and is an item of a **numbered list**.
  Do **not** add extra explanations inside the steps — put reader questions and clarifications in
  the **FAQ** field instead. Tutorials may include short concrete examples.
- **Reference**: prefer **tables**, keep information concise; use **code examples** for API
  references.
- **Explanation**: explain concepts, limitations, consequences, and background.

## 4. Page structure (fields)

Documentation pages have stable, auto-generated level-1 headings backed by the
`DocApp.Code.DocumentationClass` xobject. Complete each field:

- **Content** — the main content for the page type. Additional headings go under it as level-2 (or
  lower) headings. Follow the Documentation Style.
- **FAQ** — level-2 headings phrased as **questions** a user/admin/developer might have, with
  answers limited to **1–2 sentences**. If a longer answer is needed, create a dedicated
  Explanation page instead.
- **Highlights** — short points to help readers quickly discover key information.
- **Related links** — links to related pages.
- **Technical ID** — the id of the extension that provides the documented feature (or its NPM
  package). Copy the `id` from the Extensions wiki `ExtensionCode` xobject via the Object Editor.
  Leave empty when no extension applies (e.g. installation pages).

Ref: [Page Structure](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/PageStructure/).

## 5. Documentation style

- **Syntax** — write content in XWiki syntax.
- **UI elements** — put buttons, menu items, tabs, panel names in `"quotes"` — e.g. `Click the
  "Edit" button.`
- **XWiki terminology** — words with a special XWiki meaning (Panel, Sheet…) are written in **plain
  text, uppercase first letter**, until a Glossary strategy exists.
- **Literals / computer terms** — use the `##monospace##` notation — e.g. `the ##age## xproperty`.
- **Linking** — do **not** hardcode xwiki.org URLs; use XWiki **link reference syntax** (copy the
  page's reference from its Information tab). Use the relative reference for same-wiki links and the
  global reference for cross-wiki links. To link to a file on GitHub, use the `{{scm}}` macro (so
  SCM moves don't break links).
- **Macros** — use the **code macro with an explicit `language` parameter** for code snippets
  (omitting it is slower and mis-colors). Use the **display macro** to avoid duplicated content:
  put repeated text/steps/images on a single hidden page and display it where needed.

Ref: [Documentation Style](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/).

## 6. Choose the right location

Place the page under the **most relevant existing topic / subtopic** of the `/documentation` tree,
matching its audience (User / Admin / Developer) and type. Create a new top-level topic **only** when
no existing topic fits.
Ref: [Choose the Right Location](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ChooseRightLocation/).

## 7. Versioning and perspective

- Write documentation from the perspective of the **latest version**.
- Document differences from the latest version **secondarily**, using the
  [`{{version}}` macro](https://xwiki.org/xwiki/bin/view/documentation/extensions/user/documentation/version-macro/):
  - **New feature**: mark the version-specific content with the `{{version}}` macro.
  - **Changed behavior / UI**: write the latest behavior normally, and use the macro's `before`
    parameter for the old behavior — e.g.
    `The tab uses the "Language" terminology ({{version before="16.10.12"}}Previously, the tab was using the "Locale" terminology{{/version}}).`
  - Skip the macro for trivial UI changes (no text changed, same behavior, same area) — it only
    clutters the page.
- **Maintenance**: remove content and version macros for **unsupported old versions** and remove
  obsolete macros once the referenced version is no longer relevant.

Ref: [Versioning](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/Versioning/).

## 8. Flow for creating a new page

1. Check the information doesn't already exist elsewhere (avoid duplication).
2. Use the [Documentation Resources](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationResources/)
   XARs to set up a realistic environment for screenshots/examples.
3. Choose the right location (section 6).
4. Apply Diataxis — pick the type and audience (section 1).
5. Follow the page structure (section 4).
6. Respect versioning (section 7), style (section 5), and the attachment rules.
7. Save the changes (a Change Request is the expected way to submit edits).
8. (Optional) Add Highlights.

Ref: [Create New Documentation – Flow Guide](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/CreateNewDocumentation/).

## 9. Migrating / refactoring existing documentation

When moving older content (from the `Documentation` space or Extensions wiki) into `/documentation`:

1. Check for existing Change Requests first, so two people don't refactor the same page.
2. Choose the right location and apply Diataxis to the migrated content.
3. Handle the original page after the content is moved (leave a link, rename the extension page,
   add the "Documentation" button as described in the guide).

Refs: [Migrate and Refactor Documentation](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/),
[Handle Original Documentation Pages](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/HandleOriginalDocumentationPages/).

## 10. Review checklist

When reviewing an existing documentation page, verify:

- [ ] **Type** — the page is clearly one Diataxis type (not mixing How-to + Reference + …) and has a
      target audience.
- [ ] **Title** — follows the verb rule for its type (verb for How-to/Tutorial; no leading verb for
      Reference/Explanation); Tutorial titles are specific.
- [ ] **Page name** — kebab-case, no stop words, follows the title, no parent/child path repetition.
- [ ] **Steps** — in How-to/Tutorial, each step starts with a verb and is in a numbered list, with
      no inline explanations.
- [ ] **FAQ** — reader questions live in the FAQ field (1–2 sentence answers), not buried in steps;
      longer answers are split into an Explanation page.
- [ ] **Structure fields** — Content, FAQ, Highlights, Related links filled; Technical ID set when an
      extension applies.
- [ ] **Style** — UI elements in `"quotes"`, terminology uppercased, literals in `##…##`, code macro
      uses a `language` parameter.
- [ ] **Links** — use link reference syntax (no hardcoded xwiki.org URLs); `{{scm}}` for GitHub
      files.
- [ ] **Location** — under the most relevant existing `/documentation` topic for its audience/type.
- [ ] **Versioning** — written for the latest version; `{{version}}` macro used only for new/changed
      behavior; no obsolete version macros or content for unsupported versions.

Report findings as a list of concrete, actionable items, each citing the rule/section it relates to,
and confirm against the live guide page when a point is borderline.

## XWiki Documentation Guide — reference index

Consult these authoritative pages (the left-navigation of the Documentation Guide):

- [Documentation Guide (root)](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide)
- [Apply Diataxis](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ApplyDiataxis/)
- [Choose the Right Location](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/ChooseRightLocation/)
- [Create New Documentation – Flow Guide](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/CreateNewDocumentation/)
- [Landing Pages](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/CreateLandingPages/)
- [Documentation Style](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/)
- [Page Titles and Page Names](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationStyle/PageTitlesNames/)
- [Page Structure](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/PageStructure/)
- [Documentation Navigation Panel](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationNavigationTree/)
- [Documentation Resources](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/DocumentationResources/)
- [Versioning](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/Versioning/)
- [Working with Attachments](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/WorkingAttachments/)
- [Migrate and Refactor Documentation](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/)
- [Handle Original Documentation Pages](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/MigrateDocumentation/HandleOriginalDocumentationPages/)
- [Save Changes](https://dev.xwiki.org/xwiki/bin/view/Community/DocGuide/SaveChanges/)
- [Diataxis methodology](https://diataxis.fr/)
