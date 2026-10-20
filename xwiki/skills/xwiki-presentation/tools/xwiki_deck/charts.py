"""Charts rendered as PNGs, in the deck's own typography.

Charts are pictures rather than native pptx charts **on purpose**: a native chart is restyled
by whatever theme the viewing application applies, so it arrives in Keynote with different
fonts and colours from the slide it sits on. A PNG looks the same everywhere.

Only generic builders live here. A chart that exists to make one argument on one slide belongs
in that deck's own build script, calling `bare()` and `save()` from here so it still matches.
"""
import os

import matplotlib

matplotlib.use('Agg')  # no display in a build script; must precede the pyplot import
import matplotlib.pyplot as plt  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from . import theme as t  # noqa: E402

DPI = 200
_out_dir = 'img/gen'

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': t.FONT_STACK,
    'text.color': t.INK,
    'axes.labelcolor': t.INK,
    'xtick.color': t.MUTED,
    'ytick.color': t.MUTED,
    'axes.edgecolor': t.RULE,
    'figure.facecolor': 'white',
    'axes.facecolor': 'white',
    'svg.fonttype': 'none',
})


def out_dir(path):
    """Set where save() writes. Call once, before building any chart."""
    global _out_dir
    _out_dir = path
    os.makedirs(path, exist_ok=True)


def bare(ax, keep_bottom=True, hgrid=False):
    """Strip the frame down to at most one axis line.

    A slide chart is read in seconds from a distance: every rule that is not carrying
    information is competing with the one that is.
    """
    for s in ('top', 'right', 'left'):
        ax.spines[s].set_visible(False)
    ax.spines['bottom'].set_visible(keep_bottom)
    ax.tick_params(length=0)
    if hgrid:
        ax.set_axisbelow(True)
        ax.grid(axis='y', color=t.RULE, lw=0.6)


def save(fig, name):
    """Write the figure under the configured output directory and return its path."""
    os.makedirs(_out_dir, exist_ok=True)
    p = os.path.join(_out_dir, name)
    fig.savefig(p, dpi=DPI, bbox_inches='tight', pad_inches=0.06, facecolor='white')
    plt.close(fig)
    return p


def hbar(rows, name, title=None, subtitle=None, figsize=(11.6, 3.15), color=None,
         legend=None, value_fmt='{:,}'):
    """Horizontal bars, largest first, each labelled with its own value.

    `rows` is a sequence of `(label, value)` or `(label, value, colour)`. Horizontal is the
    right default for ranked categories: the labels are prose and read left-to-right, where a
    vertical bar chart would rotate them.

    `legend` maps a name to a colour, for when the bar colours are themselves categorical.
    """
    fig, ax = plt.subplots(figsize=figsize)
    labels = [r[0] for r in rows]
    values = [r[1] for r in rows]
    cols = [r[2] if len(r) > 2 else (color or t.BLUE) for r in rows]
    y = list(range(len(rows)))
    ax.barh(y, values, color=cols, height=0.62)
    span = max(values) if values else 1
    for i, v in enumerate(values):
        ax.text(v + span * 0.012, i, value_fmt.format(v), va='center', fontsize=10.5,
                color=t.INK)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=10.5)
    ax.invert_yaxis()
    ax.set_xticks([])
    ax.set_xlim(0, span * 1.12)
    bare(ax, keep_bottom=False)
    if title:
        ax.set_title(title, fontsize=13, loc='left', pad=26 if subtitle else 10)
    if subtitle:
        ax.text(0, 1.015, subtitle, transform=ax.transAxes, fontsize=9.5, color=t.MUTED)
    if legend:
        handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in legend.values()]
        ax.legend(handles, list(legend), frameon=False, fontsize=9.5, loc='lower right',
                  ncol=min(4, len(legend)), handlelength=1.0)
    return save(fig, name)


def vbar(rows, name, title=None, subtitle=None, figsize=(6.2, 3.1), color=None,
         value_fmt='{:,}', highlight_last=False):
    """Vertical bars over an ordered sequence — a time series of counts, typically.

    `highlight_last` draws the final bar in the accent colour and the rest in grey, for the
    common case where the point is "where it ended up".
    """
    fig, ax = plt.subplots(figsize=figsize)
    labels = [r[0] for r in rows]
    values = [r[1] for r in rows]
    if highlight_last:
        cols = [t.GREY] * (len(rows) - 1) + [color or t.BLUE]
    else:
        cols = [r[2] if len(r) > 2 else (color or t.BLUE) for r in rows]
    x = list(range(len(rows)))
    ax.bar(x, values, color=cols, width=0.66)
    span = max(values) if values else 1
    for i, v in enumerate(values):
        ax.text(i, v + span * 0.03, value_fmt.format(v), ha='center', fontsize=10,
                color=t.INK if (highlight_last and i == len(rows) - 1) else t.MUTED)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_yticks([])
    ax.set_ylim(0, span * 1.18)
    bare(ax, keep_bottom=False)
    if title:
        ax.set_title(title, fontsize=13, loc='left', pad=26 if subtitle else 10)
    if subtitle:
        ax.text(0, 1.015, subtitle, transform=ax.transAxes, fontsize=9.5, color=t.MUTED)
    return save(fig, name)


def trend(labels, values, name, title=None, subtitle=None, figsize=(5.5, 3.3),
          target=None, target_label=None, value_fmt='{:,}'):
    """A single line with every point annotated, and an optional dashed target line.

    Annotating every point rather than drawing a y-axis keeps the figures readable from the
    back of a room, where axis ticks are not.
    """
    fig, ax = plt.subplots(figsize=figsize)
    if target is not None:
        ax.axhline(target, color=t.RED, lw=1.1, ls=(0, (4, 3)))
        if target_label:
            ax.text(len(labels) - 0.68, target, ' ' + target_label, va='center', fontsize=10,
                    color=t.RED)
    ax.plot(labels, values, color=t.BLUE, lw=2.2, marker='o', ms=7, zorder=3)
    last = len(values) - 1
    for i, v in enumerate(values):
        ax.annotate(value_fmt.format(v), (i, v), textcoords='offset points',
                    xytext=(0, 12 if i < last else -20), ha='center',
                    fontsize=12 if i == last else 10.5,
                    color=t.INK if i == last else t.MUTED)
    lo, hi = min(values), max(values)
    pad = (hi - lo) * 0.35 or hi * 0.1 or 1
    ax.set_ylim(lo - pad, hi + pad)
    ax.set_xlim(-0.35, len(labels) - 0.1 + 0.55)
    ax.set_yticks([])
    ax.tick_params(axis='x', labelsize=10.5)
    bare(ax, keep_bottom=False)
    if title:
        ax.set_title(title, fontsize=13.5, loc='left', pad=10)
    if subtitle:
        ax.text(0, -0.17, subtitle, transform=ax.transAxes, fontsize=9, color=t.MUTED)
    return save(fig, name)


def stacked_bar(labels, series, name, title=None, subtitle=None, figsize=(6.4, 3.2),
                horizontal=False):
    """Stacked bars. `series` is a sequence of `(name, values, colour)`, bottom segment first."""
    fig, ax = plt.subplots(figsize=figsize)
    base = [0] * len(labels)
    x = list(range(len(labels)))
    for sname, values, col in series:
        if horizontal:
            ax.barh(x, values, left=base, color=col, height=0.62, label=sname)
        else:
            ax.bar(x, values, bottom=base, color=col, width=0.66, label=sname)
        base = [b + v for b, v in zip(base, values)]
    if horizontal:
        ax.set_yticks(x)
        ax.set_yticklabels(labels, fontsize=10.5)
        ax.invert_yaxis()
        ax.set_xticks([])
    else:
        ax.set_xticks(x)
        ax.set_xticklabels(labels, fontsize=10)
        ax.set_yticks([])
    bare(ax, keep_bottom=False)
    ax.legend(frameon=False, fontsize=9.5, loc='lower right',
              ncol=min(4, len(series)), handlelength=1.0)
    if title:
        ax.set_title(title, fontsize=13, loc='left', pad=26 if subtitle else 10)
    if subtitle:
        ax.text(0, 1.015, subtitle, transform=ax.transAxes, fontsize=9.5, color=t.MUTED)
    return save(fig, name)


# --------------------------------------------------------------------------------------- #
# Image tiles — for grids that mix screenshots with figures
# --------------------------------------------------------------------------------------- #
def _pil_font(size, bold=False):
    for p in ('/System/Library/Fonts/Supplemental/GillSans.ttc',
              '/System/Library/Fonts/Helvetica.ttc',
              '/Library/Fonts/Arial.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size, index=1 if bold and p.endswith('.ttc') else 0)
            except Exception:
                pass
    return ImageFont.load_default()


def figure_tile(name, big, small, sub=None, size=(470, 380), color=None):
    """A number-led tile, for a grid cell where no screenshot exists.

    Keeps a mixed grid even: a row of screenshots with one empty cell reads as a mistake.
    """
    im = Image.new('RGB', size, 'white')
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, size[0] - 1, size[1] - 1], outline='#dcdcdc', width=2)
    fb, fs = _pil_font(96), _pil_font(26)
    d.text(((size[0] - d.textlength(big, font=fb)) / 2, size[1] * 0.24), big, font=fb,
           fill=color or t.BLUE)
    d.text(((size[0] - d.textlength(small, font=fs)) / 2, size[1] * 0.58), small, font=fs,
           fill=t.INK)
    if sub:
        fsub = _pil_font(20)
        d.text(((size[0] - d.textlength(sub, font=fsub)) / 2, size[1] * 0.70), sub, font=fsub,
               fill=t.MUTED)
    os.makedirs(_out_dir, exist_ok=True)
    p = os.path.join(_out_dir, name)
    im.save(p)
    return p


def thumb(src, name, size=(470, 380), anchor='top'):
    """Letterbox a screenshot into a uniform tile so a grid stays even.

    A very tall screenshot is cropped from the top rather than shrunk: scaled to fit it becomes
    illegible, and an illegible screenshot is worse than a cropped one.
    """
    im = Image.open(src).convert('RGB')
    tw, th = size
    if im.height / im.width > (th / tw) * 1.9:
        im = im.crop((0, 0, im.width, int(im.width * th / tw * 1.35)))
    scale = min(tw / im.width, th / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))),
                   Image.LANCZOS)
    canvas = Image.new('RGB', size, 'white')
    y = 0 if anchor == 'top' and im.height < th else (th - im.height) // 2
    canvas.paste(im, ((tw - im.width) // 2, y))
    ImageDraw.Draw(canvas).rectangle([0, 0, tw - 1, th - 1], outline='#dcdcdc', width=2)
    os.makedirs(_out_dir, exist_ok=True)
    p = os.path.join(_out_dir, name)
    canvas.save(p)
    return p
