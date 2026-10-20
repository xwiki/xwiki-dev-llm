"""Build an XWiki-styled slide deck as a .pptx, then publish it to the formats you want.

Typical use, from a deck's own build script:

    from pptx import Presentation
    from pptx.util import Inches
    from xwiki_deck import theme as t, shapes as sh, charts, publish

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(t.W), Inches(t.H)

    s = sh.blank(prs)
    sh.title(s, 'The talk', 'and what it is about')
    sh.bullets(s, t.MARGIN, 1.8, 6.0, 4.0, ['first point', 'second point'])
    sh.chrome(s, byline='Name, Month Year', logo='assets/xwiki-logo.png')
    sh.notes(s, 'What to say here.', 2)

    prs.save('deck.pptx')
    publish.publish('deck.pptx', dest, formats=('pptx', 'pdf', 'notes'))

`theme` holds the geometry and palette, `shapes` the slide primitives, `charts` the PNG chart
builders, `publish` the format pipeline and `checks` the read-back report.
"""

__all__ = ['theme', 'shapes', 'charts', 'publish', 'checks']
