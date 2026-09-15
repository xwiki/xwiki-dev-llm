"""Read the built deck back and report what is wrong with it.

Answering these questions by opening the deck costs a turn per slide, and reading a rendered
slide image into the conversation keeps it there for every later turn. This answers all of them
in one call, from the .pptx itself:

- a slide carrying more words than an audience can read while listening,
- body text too small to read from the back of the room,
- slides with no speaker notes, and
- what the per-slide minute budgets add up to — the deck's own running time.

Run: `python -m xwiki_deck.checks path/to/deck.pptx`
"""
import re
import sys

from pptx import Presentation

from . import theme as t


def inspect(path, body_min=None, words_max=None):
    """Return `(rows, summary)` — one row per slide, plus deck-level totals."""
    body_min = t.BODY_MIN_PT if body_min is None else body_min
    words_max = t.WORDS_MAX if words_max is None else words_max
    prs = Presentation(path)
    rows, total, missing = [], 0, []

    for i, s in enumerate(prs.slides, 1):
        words, sizes, pics = 0, [], 0
        for sh in s.shapes:
            if not sh.has_text_frame:
                pics += 1
                continue
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    words += len(r.text.split())
                    if r.font.size:
                        sizes.append(round(r.font.size.pt, 1))
        note = s.notes_slide.notes_text_frame.text if s.has_notes_slide else ''
        m = re.match(r'\[(\d+) min\]', note)
        mins = int(m.group(1)) if m else 0
        total += mins
        if not note.strip():
            missing.append(i)
        rows.append({
            'slide': i,
            'words': words,
            'pics': pics,
            'minutes': mins,
            'notes_chars': len(note),
            'min_pt': min(sizes) if sizes else None,
            'max_pt': max(sizes) if sizes else None,
            'small_runs': sorted({z for z in sizes if z < body_min}),
            'too_wordy': words > words_max,
        })

    return rows, {
        'slides': len(prs.slides),
        'width_in': prs.slide_width.inches,
        'height_in': prs.slide_height.inches,
        'minutes': total,
        'missing_notes': missing,
    }


def report(path, body_min=None, words_max=None):
    """Print the inspection as a table. Returns True when nothing needs attention."""
    body_min = t.BODY_MIN_PT if body_min is None else body_min
    words_max = t.WORDS_MAX if words_max is None else words_max
    rows, s = inspect(path, body_min, words_max)
    print(f"{s['slides']} slides, {s['width_in']:.3f} x {s['height_in']:.2f} in\n")
    for r in rows:
        flag = '  << WORDY' if r['too_wordy'] else ''
        span = (f"{r['min_pt']:.0f}-{r['max_pt']:.0f}pt" if r['min_pt'] else '-')
        print(f"  slide {r['slide']:2d}  words {r['words']:3d}{flag:<11s} pics {r['pics']}   "
              f"notes {r['notes_chars']:4d} ch   {r['minutes']} min   {span}")
    print(f"\nspeaker-note durations sum to {s['minutes']} min")
    print('slides missing notes:', s['missing_notes'] or 'none')
    small = {r['slide']: r['small_runs'] for r in rows if r['small_runs']}
    print(f'\nruns below {body_min:.0f}pt (captions and the byline are expected here):')
    for i, z in small.items():
        print(f'  slide {i:2d}: {z}')
    return not s['missing_notes'] and not any(r['too_wordy'] for r in rows)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: python -m xwiki_deck.checks <deck.pptx>')
    report(sys.argv[1])
