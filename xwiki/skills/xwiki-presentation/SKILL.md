---
name: xwiki-presentation
description: Build a slide deck about XWiki — for a conference talk, a meetup, a project or team presentation, a release or roadmap review. Produces a .pptx from a Python build script in a consistent XWiki look, then publishes it to PDF (always) and optionally per-slide PNGs, Keynote and a speaker-notes text file. Use when asked to create, build, update or regenerate a presentation, slide deck or slides. For writing xwiki.org documentation pages use xwiki-doc-writing; for a release announcement blog post use xwiki-contrib-release-blog-post.
---

# Building an XWiki presentation

A deck is **code, not a file you edit** — a Python build script that places every element, so it
can be regenerated after any change to its data instead of being hand-patched. That is the whole
point: the figures on a slide come from the source they were measured from, and re-running the
script is how a stale deck is fixed.

This skill ships `tools/xwiki_deck/`, a small library over `python-pptx`:

| Module | Holds |
|---|---|
| `theme` | Geometry (16:9, 13.333×7.5in), the palette, the font stack, the readability limits |
| `shapes` | `textbox` · `bullets` · `rect` · `picture` · `blank` · `title` · `chrome` · `notes` · `delta_chip` |
| `charts` | `hbar` · `vbar` · `trend` · `stacked_bar` · `figure_tile` · `thumb`, plus `bare`/`save` for a one-off chart |
| `publish` | `capabilities` · `require` · `to_pdf` · `to_pngs` · `to_keynote` · `to_notes` · `publish` |
| `checks` | `report` — reads the built deck back and reports what is wrong with it |

## Step 1 — Settle these with the author before writing anything

Do not guess them; each one changes the content, not just the styling.

1. **Audience.** Developers, a mixed community room, or decision-makers. Decides how much is
   explained and what may be assumed.
2. **Slot length**, and whether it includes a live demo. At roughly **2 minutes per slide**, the
   slot *is* the slide count. A demo displaces three to four slides.
3. **What the audience should do afterwards.** A deck with no ask is a report; say which it is.
   This decides how each slide ends.
4. **Output formats.** Ask explicitly. **PDF is always produced**; offer `pptx`, `png`, `key` and
   `notes` alongside it (see Step 2).
5. **Where it goes** — the output directory — and the **byline** (name and month).
6. **Published or not.** A deck meant to circulate carries its licence badge; one that is not
   carries a short marker such as `Internal`. Pass one or the other to `shapes.chrome()`, never
   both. **If any slide carries material that is sensitive when aggregated** — unfixed security
   issues, their count, their severity mix — settle this *before* writing that slide, and when the
   deck will circulate, state the aggregate without the pool size or the attack shape.

## Step 2 — Check this machine can produce the formats, before building

```bash
python -m xwiki_deck.publish --check
```

`publish.require(formats)` does the same from the build script and **must be called before the
deck is built**. Discovering at the conversion step that LibreOffice is absent costs a full
rebuild and reads like a bug in the deck.

| Format | Needs | Notes |
|---|---|---|
| `pptx` | — | What the script writes |
| `pdf` | **LibreOffice** | Required. macOS `brew install --cask libreoffice`, Debian `apt install libreoffice` |
| `png` | LibreOffice + `pdftoppm` (poppler) | One image per slide, for checking the build |
| `key` | macOS + Keynote + LibreOffice | Optional; see the trap below |
| `notes` | — | Speaker notes as text, read back out of the built deck |

## Step 3 — Set up the deck's own directory

The deck is a piece of work, so it lives in the **work directory** (`<work>/<repo>/<date>-<slug>/`),
never in a repo:

```bash
python3 -m venv .venv
./.venv/bin/pip install -r "<this skill>/tools/requirements.txt"
```

Put the skill's `tools/` on `sys.path` (or `PYTHONPATH`) so `import xwiki_deck` resolves. Keep
`data/` (the JSON each figure comes from), `img/` (screenshots and generated charts) and `out/`
(PDF and per-slide PNGs) beside the script.

## Step 4 — Write the build script

```python
import os, sys
sys.path.insert(0, os.environ['XWIKI_DECK_TOOLS'])          # the skill's tools/ directory

from pptx import Presentation
from pptx.util import Inches
from xwiki_deck import theme as t, shapes as sh, charts, publish, checks

FORMATS = ('pptx', 'pdf', 'notes')      # what the author asked for, in Step 1
DEST = os.path.expanduser('~/…')        # where the author wants it
BYLINE = 'Name, Month Year'
LOGO = os.path.join(os.environ['XWIKI_DECK_ASSETS'], 'xwiki-logo.png')

publish.require(FORMATS)                # fail now, not after the slides are built
charts.out_dir('img/gen')

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(t.W), Inches(t.H)

def slide(title, sub=None):
    s = sh.blank(prs)
    sh.title(s, title, sub)
    return s

s = slide('What we built', 'and what it cost')
sh.bullets(s, t.MARGIN, 1.8, 6.0, 4.0, [
    ('The headline', True, t.INK),
    ('the detail under it', False, t.MUTED),
])
sh.chrome(s, byline=BYLINE, logo=LOGO, marker='Internal')
sh.notes(s, 'What to actually say on this slide.', 2)

prs.save('deck.pptx')
publish.publish('deck.pptx', DEST, formats=FORMATS, work_out='out')
checks.report('deck.pptx')
```

### Layout rules the helpers assume

- **Inches from the top-left**, on a 13.333 × 7.5 canvas with a 0.5 margin. `title()` occupies the
  top 1.4in; content starts at about `y=1.6`.
- **Two columns** are `t.MARGIN` and `t.W / 2 + 0.1`, each about 5.9in wide.
- **Every slide gets `chrome()` and `notes()`.** `notes()` takes a minute budget, and that budget
  is what lets the deck report its own running time.
- **Colour is semantic.** Blue is the accent; green, amber and red mean status or direction and
  nothing else. A chart that uses red for a category in a deck where red also means "bad" teaches
  the audience to misread both.
- **Never hard-wrap prose inside a text box** — `word_wrap` is on, and manual breaks reflow wrongly
  at a different font size.

### Charts

Charts are **pictures, not native pptx charts**, so their typography matches the slide: a native
chart is restyled by whatever theme the viewing application applies and arrives in Keynote with
different fonts and colours. Use the generic builders in `charts`; a chart that exists to make one
argument on one slide belongs in the deck's own script, calling `charts.bare()` and `charts.save()`
so it still matches.

## Step 5 — Check the build without opening it

```bash
./.venv/bin/python -m xwiki_deck.checks deck.pptx
```

One call reports word counts per slide, body text below the readable minimum, slides with no
speaker notes, and what the minute budgets sum to. **Do not read the rendered slide PNGs back to
judge whether a slide "looks right"** — an image read into the conversation stays there for every
later turn, and a render-look-adjust loop is the most expensive pattern in this work. Open one PNG
only when the question is genuinely visual, and then once.

Fix what it reports:

- **wordy slide** — the text is being read aloud; move it into `notes()`.
- **missing notes** — every slide needs them; they are also the minute budget.
- **runs below the minimum** — captions and the byline are expected; body text is not.

## Step 6 — Publish

`publish.publish()` writes each requested format into the destination and returns the paths.
Report them to the author, and the deck's total running time from `checks`.

## Traps

- **Keynote silently refuses a `python-pptx` file.** AppleScript `open` returns a missing value and
  no document ever appears — and it refuses again after a LibreOffice `pptx`→`pptx` round-trip.
  Converting to **PowerPoint 97 `.ppt` first** is the route that works, and it preserves the
  slides, the speaker notes and the layout. `publish.to_keynote()` does this; do not "simplify" it
  into opening the `.pptx`.
- **A missing font fails silently.** `Gill Sans MT` is absent on most Linux machines and the text
  renders in something else at a different width, so a layout tuned on macOS overflows. The stack
  in `theme.FONT_STACK` is the fallback chain; check a PDF built on the presenting machine.
- **`shadow.inherit` must be switched off** on every shape, or pptx applies a theme shadow that
  survives into the PDF as a grey smear. `shapes.rect()` already does it.
- **Pictures stretch.** `add_picture` with both a width and a height distorts; `shapes.picture()`
  scales to fit the box instead.
- **`clean`/`verify` on the output directory.** Regenerating writes over the previous PDF and
  PNGs; if the author has the PDF open, LibreOffice still writes but the viewer may show the old
  one. Close it, or write to a fresh directory.

## Related

- Work-directory conventions: the org-wide instructions (`<work>/<repo>/<YYYY-MM-DD>-<slug>/`).
- For xwiki.org documentation pages use **`xwiki-doc-writing`**; for a release announcement post
  use **`xwiki-contrib-release-blog-post`**.
