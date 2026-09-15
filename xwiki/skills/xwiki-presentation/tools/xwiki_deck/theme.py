"""Geometry, palette and typography shared by the slides and the charts.

Everything a deck's look depends on is here, so a deck's own build script never restates a
colour or a size. Override by assigning to these names before building — see SKILL.md.
"""

# 16:9 at the size PowerPoint and Keynote both treat as native. Inches throughout: python-pptx
# takes EMU, and Inches() is the only unit that stays readable in layout arithmetic.
W, H = 13.333, 7.5
MARGIN = 0.5

# A humanist sans keeps a dense slide readable at the back of a room. The fallbacks matter:
# Gill Sans MT is not present on Linux, and a missing font silently renders as something else.
FONT = 'Gill Sans MT'
FONT_STACK = ['Gill Sans MT', 'Gill Sans', 'Helvetica Neue', 'DejaVu Sans']

# One accent family (blue), plus green/amber/red reserved for *semantics* — status and
# direction — never for decoration. A chart that uses red for a category and red for "bad" in
# the same deck teaches the audience to misread both.
INK = '#111111'
MUTED = '#6b6b6b'
RULE = '#d8d8d8'
BLUE = '#2b5f9e'
BLUE_L = '#7fa4cf'
BLUE_XL = '#c3d5ea'
TEAL = '#2f7d76'
GREY = '#b9b9b9'
GREEN = '#2e7d4f'
AMBER = '#c8871c'
RED = '#b3261e'
WHITE = '#ffffff'

# Body text below this is unreadable past the third row. checks.py reports anything smaller so
# the exceptions (captions, the byline) stay deliberate rather than accidental.
BODY_MIN_PT = 14.0
# A slide carrying more than this is being read aloud rather than shown.
WORDS_MAX = 40


def rgb(value):
    """'#2b5f9e' (or an RGBColor) -> pptx RGBColor. Lets the palette stay plain strings."""
    from pptx.dml.color import RGBColor
    if isinstance(value, RGBColor):
        return value
    return RGBColor.from_string(value.lstrip('#').upper())
