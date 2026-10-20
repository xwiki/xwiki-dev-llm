# Print rules — from a browser page to a book chapter

What makes a documentation page print badly is mostly what its **sheet** adds, not what the author wrote. Most of those additions are only there to navigate or search in a browser.

The rules below are implemented in `transform()` in `tools/docexport.py`. They are keyed on the selectors the sheets produce on xwiki.org today, and those selectors can change with any upgrade of the documentation application. That is why an unknown block stops the build rather than printing.

**Source:** the page body is `/bin/view/<page>/?xpage=plain`. That is `#xwikicontent` only, with none of the skin's chrome (breadcrumb, menus, tags, the Like button, the authors UIX, the comments/history tabs, the panels, the footer). The title and the metadata come from REST.

`?xpage=print` is **not** a better source: it still carries the Live Data, the search box, the breadcrumb and the badges.

## Sheet sections (the generated `h1.wikigeneratedheader`, by id)

| Section | Rule |
|---|---|
| `HSteps`, `HFAQ`, `HRelated`, `HHighlights` | kept |
| `HSummary` (landing pages), `HExplanation`, `HReference`, `HTutorial` | the heading is dropped and its content kept. The label only repeats the page type, which the metadata line gives. |
| `HMore` (a page with children) | the intro sentence, the search form and the children Live Data are dropped. A curated Highlights list (`div.cardlist`) is kept under a "Highlights" heading. The rest becomes the **"In this section"** slot, filled at build time with the children in navigation order. |
| `HWhatareyoulookingfor3F` (landing pages) | dropped whole: a search form and a Live Data of every page of the audience |
| anything else | reported as `section:<id>`; decide before building |

Every page heading moves down one level, because the page title is the h1 of its chapter. `build` then shifts the whole chapter to its tree depth.

## Blocks

| Block | Rule |
|---|---|
| "Content" box (`.box.floatinginfobox`) | dropped: the book's Contents and the PDF outline replace it |
| forms, `<script>`, `.wikimodel-emptyline` | dropped |
| Live Data left in the content (`.liveData`) | replaced by "This interactive table is available online: <URL>". It only renders with JavaScript, and a frozen copy of its data would be wrong by the next edit. |
| Async content (`.xwiki-async`: PlantUML today) | the rendering is asked from `/xwiki/asyncrenderer/<id>?clientId=…`, in the cookie session of the page fetch because the client id is bound to it; the image comes with it. If that fails: "This diagram is available online: <URL>". |
| Highlights cards (`div.cardlist`) | a plain list: link — one-line description |
| Images | downloaded into `assets/`, `src` rewritten. How they look is decided at build time (below). |
| Galleries (`div.gallery`) | the images, stacked; the lightbox attribute is dropped |
| Version badges (`span.badge`: "Since…", "Before…") | `span.version-note` holding the badge's `title` in words ("(Before XWiki 17.8.0, 17.4.5)"). The badge text ("XWiki <17.8.0") is symbols that do not translate. |
| Callouts (`.box.infomessage` / `warningmessage`…) | a tinted box. The FontAwesome glyph is dropped and its `sr-only` label becomes a bold lead ("Warning:"). An `sr-only` outside a box is dropped. |
| Keyboard shortcuts (`div.shortcut`, `span.key`, `span.separator` for the "or" between two) | kept; keys are styled as keycaps |
| Cloudflare-obfuscated email (`a.__cf_email__`) | decoded |
| Inline `style` attributes | removed; the stylesheet decides. That includes the silver-bordered `span` of the image macro, since build borders every screenshot anyway. |
| Links | an in-wiki `documentation.*` link becomes `ref:<reference>[#anchor]`, and everything else an absolute URL. `build` resolves `ref:` against the final manifest: a page in the book becomes a PDF link, any other page an absolute link with its URL printed after the text. Every id is prefixed with its page's key, because `HFAQ`, `HSteps` and similar ids repeat on every page. |
| Code (`pre > code.language-*`) | monospace, wrapped, not colourised. The site colours code with Prism in the browser, and most blocks are `language-none` anyway. |

## Presentation is decided at build time

`fetch` decides **what** is in a page; `build` and `print.css` decide **how it looks**. The line matters: `source/` is what gets translated, and any change to it invalidates the translation of every page it touches. So a presentation change, such as an image border, a heading size or a page break, must never be made in `transform()`.

| At build time | Rule |
|---|---|
| Images | Classified from their file's dimensions. A **screenshot** gets a silver border, is at most the column width and about one page high (scaled, never cut), and is never split across pages. A **small inline icon** (under 64×32 px) stays inline, with no border. A **PlantUML diagram** (marked by `fetch`) is centred, with no border. The border is `box-sizing: border-box`, otherwise a full-width screenshot is two pixels wider than the column and loses its right edge. |
| Headings | The tag follows the page's tree depth, which builds a correct PDF outline. The size follows the heading's level within its page (`rel-N`), so the title of a page five levels deep is still bigger than its own sections. |
| Links | `--medium print` spells out the URL of each link leaving the book after its text; `--medium screen` does not. |
| Page breaks | `--page-break topic` starts each top-level topic on a new page; `page` starts every documentation page on one. |

## The book

- **Cover:** title, source URL, export date. No XWiki version: the documentation on xwiki.org is not tied to one release, and the book is what it showed on that date.
- **Contents:** down to `--toc-depth` (3). Page numbers come from a second print: the first pass carries an invisible marker in each chapter title, `pdftotext` finds the page each marker landed on, and the second pass writes the numbers into a column of fixed width, so nothing moves.
- **Chapters:** a new page per topic or per page (see above). Every page gets a small metadata line ("How-to · Extension: <id>"); the audience is left out, since the whole book has one. The source keeps it in English, and `build` writes it in the book's language from `labels.<lang>.json`.
- **Root page:** its title is the book's title, and its content opens the book.

## Adding a rule

When `fetch` reports an unknown class or tag:

1. Look at one page that has it, in the browser **and** in `source/<key>.html`.
2. Decide what a reader of the printed page needs from it. Then either:
   - add the rule to `transform()` (and `KNOWN_CLASSES` if the result keeps a class), then document it in the table above and `fetch --all`; or
   - accept the block as harmless for this export only with `accept-class <class>`. Use that when it only affects styling and the text reads fine without it.
3. Never make an unknown block disappear by deleting its content in `source/`. The next fetch brings it back.
