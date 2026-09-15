"""Turn the built .pptx into the formats the author asked for.

Formats:

- **pptx** — always; it is what the build script wrote.
- **pdf**  — required. Needs LibreOffice, which `require()` checks *before* anything is built
             so a missing dependency fails in the first second rather than after the slides.
- **png**  — one image per slide, from the PDF. Needs `pdftoppm` (poppler).
- **key**  — Keynote. macOS only, and it goes through PowerPoint 97 `.ppt`; see `to_keynote()`.
- **notes**— speaker notes as plain text, read back out of the built deck.

Run `python -m xwiki_deck.publish --check` to see what this machine can produce.
"""
import os
import shutil
import subprocess
import sys
import tempfile

SOFFICE_CANDIDATES = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    'soffice',
    'libreoffice',
]

ALL_FORMATS = ('pptx', 'pdf', 'png', 'key', 'notes')


def find_soffice():
    """Absolute path to LibreOffice's headless binary, or None."""
    for c in SOFFICE_CANDIDATES:
        p = shutil.which(c) if not os.path.isabs(c) else (c if os.path.exists(c) else None)
        if p:
            return p
    return None


def capabilities():
    """What this machine can currently produce: {format: None | 'reason it cannot'}."""
    caps = {'pptx': None, 'notes': None}
    caps['pdf'] = None if find_soffice() else (
        'LibreOffice not found. Install it (macOS: `brew install --cask libreoffice`; '
        'Debian/Ubuntu: `apt install libreoffice`) or add `soffice` to PATH.')
    caps['png'] = caps['pdf'] or (
        None if shutil.which('pdftoppm') else
        'pdftoppm not found — install poppler (macOS: `brew install poppler`).')
    if sys.platform != 'darwin':
        caps['key'] = 'Keynote is macOS-only.'
    elif not os.path.exists('/Applications/Keynote.app'):
        caps['key'] = 'Keynote is not installed.'
    else:
        caps['key'] = caps['pptx']
    return caps


def require(formats):
    """Fail now, with the fix, if a requested format cannot be produced on this machine.

    Called before the deck is built. Discovering halfway through the pipeline that LibreOffice
    is missing costs a full rebuild and reads like a bug in the deck.
    """
    caps = capabilities()
    unknown = [f for f in formats if f not in ALL_FORMATS]
    if unknown:
        raise SystemExit(f'Unknown format(s): {", ".join(unknown)}. '
                         f'Choose from: {", ".join(ALL_FORMATS)}')
    problems = [f'  {f}: {caps[f]}' for f in formats if caps[f]]
    if problems:
        raise SystemExit('Cannot produce every requested format:\n' + '\n'.join(problems))


def _run(cmd, **kw):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, **kw)


def to_pdf(pptx, out_dir):
    """Convert with LibreOffice headless. Returns the PDF path."""
    soffice = find_soffice()
    if not soffice:
        raise SystemExit(capabilities()['pdf'])
    os.makedirs(out_dir, exist_ok=True)
    _run([soffice, '--headless', '--convert-to', 'pdf', '--outdir', out_dir, pptx])
    pdf = os.path.join(out_dir, os.path.splitext(os.path.basename(pptx))[0] + '.pdf')
    if not os.path.exists(pdf):
        raise SystemExit(f'LibreOffice produced no PDF for {pptx}')
    return pdf


def to_pngs(pdf, out_dir, count, prefix='slide', dpi=100):
    """One PNG per slide, for checking the built deck without opening it."""
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for n in range(1, count + 1):
        stem = os.path.join(out_dir, f'{prefix}-{n:02d}')
        _run(['pdftoppm', '-f', str(n), '-l', str(n), '-r', str(dpi), '-png', '-singlefile',
              pdf, stem])
        paths.append(stem + '.png')
    return paths


def to_keynote(pptx, key_path):
    """Save the deck as a Keynote document — macOS only.

    Keynote silently refuses a python-pptx file: AppleScript `open` returns a missing value and
    no document ever appears, and it refuses again after a LibreOffice pptx->pptx round-trip.
    Converting to PowerPoint 97 `.ppt` first is the route that works, and it preserves the
    slides, the speaker notes and the layout. Do not "simplify" this by opening the .pptx.
    """
    if sys.platform != 'darwin':
        raise SystemExit('Keynote export is macOS-only.')
    soffice = find_soffice()
    if not soffice:
        raise SystemExit(capabilities()['pdf'])
    tmp = tempfile.mkdtemp()
    try:
        _run([soffice, '--headless', '--convert-to', 'ppt', '--outdir', tmp, pptx])
        ppt = os.path.join(tmp, os.path.splitext(os.path.basename(pptx))[0] + '.ppt')
        if not os.path.exists(ppt):
            raise SystemExit('LibreOffice produced no .ppt; Keynote cannot be fed the .pptx.')
        if os.path.exists(key_path):
            shutil.rmtree(key_path, ignore_errors=True)
            if os.path.exists(key_path):
                os.remove(key_path)
        script = f'''
tell application "Keynote"
    open POSIX file "{ppt}"
    delay 6
    if (count of documents) is 0 then error "Keynote refused the .ppt"
    save document 1 in POSIX file "{key_path}"
    delay 3
    close every document saving no
end tell
'''
        subprocess.run(['osascript', '-e', script], check=True)
        return key_path
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def to_notes(pptx, txt_path, header=None):
    """Write the speaker notes to a plain-text file, read back out of the built deck.

    Generated from the deck rather than from the build script, so the notes file cannot drift
    from what is actually attached to the slides.
    """
    from pptx import Presentation
    rule = '=' * 78
    prs = Presentation(pptx)
    out = list(header or [])
    if out:
        out.append('')
    total = 0
    for i, s in enumerate(prs.slides, 1):
        note = s.notes_slide.notes_text_frame.text.strip() if s.has_notes_slide else ''
        head = note.splitlines()[0] if note else ''
        if head.startswith('[') and head.endswith(']'):
            note = '\n'.join(note.splitlines()[1:]).strip()
            total += int(''.join(c for c in head if c.isdigit()) or 0)
        else:
            head = ''
        heading = f'SLIDE {i} - {_slide_title(s)}'.upper() + (f'   {head}' if head else '')
        out += [rule, heading, rule, '', note, '']
    out += [rule, f'Total: {len(prs.slides)} slides, {total} min of notes.', rule]
    with open(txt_path, 'w') as f:
        f.write('\n'.join(out) + '\n')
    return txt_path


def _slide_title(slide):
    """First line of the topmost text shape — the slide's visible title."""
    best = None
    for sh in slide.shapes:
        if not sh.has_text_frame or not sh.text_frame.text.strip():
            continue
        if best is None or sh.top < best.top:
            best = sh
    return best.text_frame.text.strip().splitlines()[0] if best else '(no title)'


def publish(pptx, dest_dir, formats=('pptx', 'pdf'), work_out='out', slide_count=None,
            notes_header=None):
    """Produce `formats` from `pptx` and place them in `dest_dir`. Returns {format: path}.

    Only the requested formats are delivered. The `.pptx` is always *built* — it is what every
    other format is converted from — but it is only copied to the destination when it was asked
    for, so an author who wanted a PDF does not also get the intermediate.

    The PNGs stay in `work_out`: they are for checking the build, not for the audience.
    """
    require(formats)
    os.makedirs(dest_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(pptx))[0]
    made = {}

    if 'pptx' in formats:
        target = os.path.join(dest_dir, stem + '.pptx')
        if os.path.abspath(pptx) != os.path.abspath(target):
            shutil.copy(pptx, target)
        made['pptx'] = target

    if 'pdf' in formats or 'png' in formats:
        pdf = to_pdf(pptx, work_out)
        if 'pdf' in formats:
            shutil.copy(pdf, os.path.join(dest_dir, stem + '.pdf'))
            made['pdf'] = os.path.join(dest_dir, stem + '.pdf')
        if 'png' in formats:
            if slide_count is None:
                from pptx import Presentation
                slide_count = len(Presentation(pptx).slides)
            made['png'] = to_pngs(pdf, work_out, slide_count)

    if 'notes' in formats:
        made['notes'] = to_notes(pptx, os.path.join(dest_dir, stem + '-notes.txt'),
                                 header=notes_header)

    if 'key' in formats:
        made['key'] = to_keynote(pptx, os.path.join(dest_dir, stem + '.key'))

    return made


if __name__ == '__main__':
    if '--check' in sys.argv:
        for fmt, why in capabilities().items():
            print(f'  {fmt:6s} {"OK" if why is None else "unavailable - " + why}')
    else:
        print(__doc__)
