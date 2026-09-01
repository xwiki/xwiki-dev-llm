# -*- coding: utf-8 -*-
"""Lint, publish and audit a set of xwiki.org documentation pages held in a Python module.

    set -a; . ~/.xwiki-credentials; set +a
    python3 docpages.py lint                    # offline; run until it prints 0 problems
    python3 docpages.py save [ref …]            # idempotent publish (page, attachments, xobjects)
    python3 docpages.py pin                     # pin child order, verified via the tree service
    python3 docpages.py verify                  # read-back audit + both doc-checker surfaces

The page set is a module (default `pages.py` in the current directory, override with
`--pages <module>`) exposing `ALL`, a list of dicts:

    ALL = [dict(
        space=["documentation", "extensions", "admin", "antispam"], page="WebHome",
        title="AntiSpam", type="explanation", target="administrator",
        ext="xwiki:org.xwiki.contrib:application-antispam-ui",
        attachments=["applications-panel.png"],     # files under SHOTS, kebab-case, lowercase ext
        content="…", faq="…", related="…",          # XWiki 2.1 syntax; highlights defaults to ""
    ), …]
    SHOTS = "shots"                                 # optional, default "shots"
    PIN = {"documentation.extensions.admin.antispam.WebHome":
           ["configure-keywords", "delete-spam-pages-users"]}   # optional, ordered child names

The rules enforced here are the mechanical subset of okf/conventions/documentation.md — the ones a
regex can decide. They are not a substitute for the review checklist in the skill.
"""
import importlib
import os
import re
import sys

import xwikidoc as x

DOC_CLASS = 'DocApp.Code.DocumentationClass'
EXT_CLASS = 'DocApp.Code.DocumentationExtensionClass'
VIO_CLASS = 'DocApp.Code.DocumentationViolationClass'
PIN_CLASS = 'XWiki.PinnedChildPagesClass'

# Words that must not appear in a title: the page type and the audience are both carried by the
# path and the badge already.
BANNED_IN_TITLE = [r'\bHow[- ]?to\b', r'\bTutorial\b', r'\bReference\b', r'\bExplanation\b',
                   r'\bfor (Developers|Administrators|Admins|Users)\b']


def load(name='pages'):
    sys.path.insert(0, os.getcwd())
    mod = importlib.import_module(name)
    for p in mod.ALL:
        p.setdefault('highlights', '')
        p.setdefault('faq', '')
        p.setdefault('related', '')
        p.setdefault('attachments', [])
        p['ref'] = '.'.join(p['space']) + '.' + p['page']
    return mod


def shots_dir(mod):
    return getattr(mod, 'SHOTS', 'shots')


def strip_verbatim(text):
    """Blank the body of `{{plantuml}}` / `{{code}}` blocks: their content is not XWiki syntax and
    must not be linted as such (a PlantUML arrow is a legitimate `--`)."""
    out, inside = [], False
    for line in text.split('\n'):
        if re.search(r'\{\{(plantuml|code)\b', line):
            inside = True
            out.append('')
        elif re.search(r'\{\{/(plantuml|code)\}\}', line):
            inside = False
            out.append('')
        else:
            out.append('' if inside else line)
    return '\n'.join(out)


def steps_of(content):
    """The numbered-list items of a How-to, each with whatever follows it (its `(((…)))` block)."""
    return re.findall(r'^1\. .*(?:\n(?!1\. ).*)*', content, re.M)


def lint(mod):
    problems = []
    farm = ('www|extensions|dev|design|snippets|rendering|commons|contrib|cristal|test')
    refs = {p['ref'] for p in mod.ALL}
    for p in mod.ALL:
        name = p['ref']

        for field in ('content', 'faq', 'related'):
            for i, line in enumerate(strip_verbatim(p[field]).split('\n'), 1):
                where = f'{name}/{field}:{i}'
                if re.search(r'\b(image|attach|url|mailto):', line):
                    problems.append(f'{where} scheme-like token followed by a colon: {line[:80]}')
                if '--' in line:
                    problems.append(f'{where} double hyphen (strikethrough trap): {line[:80]}')
                if re.search(r'##[^#]*https?://', line):
                    problems.append(f'{where} URL inside ## monospace: {line[:80]}')
                # A `{{macro}}` written in an f-string field arrives as `{macro}` and renders as
                # literal text; no violation object and no rendered error box says so.
                if re.search(r'(?<!\{)\{/', line) or re.search(r'/\}(?!\})', line):
                    problems.append(f'{where} single-brace macro (an f-string field halves '
                                    f'`{{{{`, double them): {line[:80]}')
                if re.search(r'\(% *style', line):
                    problems.append(f'{where} inline style: {line[:80]}')
                if re.search(rf'https?://({farm})\.xwiki\.org', line):
                    problems.append(f'{where} absolute URL to a page of the same farm — use '
                                    f'doc:<wiki>:<ref>: {line[:80]}')

        hits = [m.group(0) for pattern in BANNED_IN_TITLE
                for m in [re.search(pattern, p['title'], re.I)] if m]
        if hits:
            problems.append(f'{name}: title carries the page type or the audience '
                            f'({", ".join(hits)}): {p["title"]!r}')

        entries = len(re.findall(r'^== ', p['faq'], re.M))
        if entries > 5:
            problems.append(f'{name}: FAQ has {entries} entries (max 5)')
        if len(p['faq'].split('\n')) > 25:
            problems.append(f'{name}: FAQ is {len(p["faq"].split(chr(10)))} lines (max 25)')

        for m in re.finditer(r'\{\{image ([^}]*)/\}\}', p['content']):
            attrs = m.group(1)
            if 'size=' not in attrs:
                problems.append(f'{name}: image without size: {attrs[:70]}')
            if 'alt=' not in attrs:
                problems.append(f'{name}: image without alt: {attrs[:70]}')
            if 'width=' in attrs:
                problems.append(f'{name}: image with forbidden width: {attrs[:70]}')
            cap = re.search(r'caption="([^"]*)"', attrs)
            if cap and re.search(r'\d+\.\d+', cap.group(1)):
                problems.append(f'{name}: caption used for a version: {cap.group(1)!r}')

        referenced = set(re.findall(r'reference="([^"]+)"', strip_verbatim(p['content'])))
        declared = set(p['attachments'])
        if referenced - declared:
            problems.append(f'{name}: referenced but not declared: {sorted(referenced - declared)}')
        if declared - referenced:
            problems.append(f'{name}: declared but not referenced: {sorted(declared - referenced)}')
        for a in p['attachments']:
            path = os.path.join(shots_dir(mod), a)
            if not os.path.exists(path):
                problems.append(f'{name}: attachment file missing: {path}')
            if a != a.lower() or not re.fullmatch(r'[a-z0-9-]+\.[a-z0-9]+', a):
                problems.append(f'{name}: attachment name is not kebab-case/lowercase: {a}')

        if p['type'] in ('howto', 'tutorial'):
            steps = steps_of(p['content'])
            if not steps:
                problems.append(f'{name}: {p["type"]} without a numbered list')
            if re.search(r'^== ', p['content'], re.M):
                problems.append(f'{name}: {p["type"]} with a level-2 heading in Content')
            if steps and '{{image' not in steps[-1]:
                problems.append(f'{name}: result step shows no screenshot')
            shown = len([s for s in steps if '{{image' in s])
            if steps and shown * 2 < len(steps):
                problems.append(f'{name}: only {shown}/{len(steps)} steps carry a screenshot')
            if '>>doc:' not in p['content'].split('\n1. ')[0]:
                problems.append(f'{name}: intro links to no Explanation page')

        if name in (p['ref'] for p in mod.ALL):
            parent = '.'.join(p['space'][:-1]) + '.WebHome'
            if parent not in refs:            # a root of this page set = a topic page
                if p['type'] != 'explanation':
                    problems.append(f'{name}: topic page is not an explanation')
                if 'doc:extensions:' not in p['content'].split('. ')[0]:
                    problems.append(f'{name}: topic page\'s first sentence has no wiki link to its '
                                    f'Extensions-wiki page')

        if name in p['related']:
            problems.append(f'{name}: Related links to itself')

    # Cross-page checks. Both defects are invisible page by page — every page above passes on its own
    # — and both are decidable without reading a word of prose.
    firsts, owners = {}, {}
    for p in mod.ALL:
        steps = steps_of(p['content'])
        # Only a repeated opening step that carries its own screenshot is the defect: the one-line
        # link that replaces it is *meant* to read identically on every page.
        if steps and '{{image' in steps[0]:
            firsts.setdefault(steps[0].split('(((')[0].strip(), []).append(p['ref'])
        for a in p['attachments']:
            owners.setdefault(a, []).append(p['ref'])
    for step, on in firsts.items():
        if len(on) > 1:
            problems.append(f'{len(on)} pages open with the same step and screenshot — extract it as '
                            f'its own How-to and link to that: {step[:60]!r} on {", ".join(on)}')
    for a, on in owners.items():
        if len(on) > 1:
            problems.append(f'{a}: declared by {len(on)} pages ({", ".join(on)}) — an attachment has '
                            f'one owning page, and the others link to that page')

    return problems


def save(mod, only=None):
    problems = []
    for p in mod.ALL:
        ref = p['ref']
        if only and ref not in only:
            continue
        print('===', ref)

        st, _ = x.getjson(x.pageurl(x.WWW, ref))
        if st != 200:
            st, b = x.put_page(x.WWW, ref, title=p['title'], content='', syntax='xwiki/2.1')
            print('  create', st)
            if st not in (201, 202):
                problems.append(f'{ref}: create -> {st} {b}')
                continue

        # Attachments before content, so no revision is ever saved with a dangling image.
        if p['attachments']:
            st, got = x.list_attachments(x.WWW, ref)
            onserver = dict(got)
            for a in p['attachments']:
                path = os.path.join(shots_dir(mod), a)
                if onserver.get(a) == os.path.getsize(path):
                    continue
                st, size = x.put_attachment(x.WWW, ref, a, path)
                print(f'  attach {a} -> {st} ({size} bytes)')
                if st not in (201, 202):
                    problems.append(f'{ref}: attach {a} -> {st}')
            st, got = x.list_attachments(x.WWW, ref)
            missing = set(p['attachments']) - {n for n, _ in got}
            if missing:
                problems.append(f'{ref}: attachments missing after upload: {sorted(missing)}')
        st, got = x.list_attachments(x.WWW, ref)
        for aname, _ in got:
            if aname not in p['attachments']:
                st, b = x.delete_attachment(x.WWW, ref, aname)
                print(f'  drop {aname} -> {st}')
                if st not in (200, 204):
                    problems.append(f'{ref}: dropping {aname} -> {st} {b}')

        st, d = x.getjson(x.pageurl(x.WWW, ref))
        if not d or d.get('content') != p['content'] or d.get('title') != p['title']:
            st, b = x.put_page(x.WWW, ref, title=p['title'], content=p['content'],
                               syntax='xwiki/2.1')
            print('  content', st)
            if st not in (201, 202, 304):
                problems.append(f'{ref}: content -> {st} {b}')
            # A 202 does not mean it landed: back-to-back writes can silently drop one.
            st, d = x.getjson(x.pageurl(x.WWW, ref))
            if not d or d.get('content') != p['content']:
                x.put_page(x.WWW, ref, title=p['title'], content=p['content'], syntax='xwiki/2.1')
                st, d = x.getjson(x.pageurl(x.WWW, ref))
                if not d or d.get('content') != p['content']:
                    problems.append(f'{ref}: content read-back mismatch')

        st, existing = x.list_objects(x.WWW, ref)
        have = {cn for cn, _ in existing}
        docprops = {'type': p['type'], 'target': p['target'], 'faq': p['faq'],
                    'highlights': p['highlights'], 'related': p['related']}
        # DocumentationClass defines its own unused `content` property — never merge it with the
        # page content, it would clobber the page.
        if DOC_CLASS not in have:
            st, _, b = x.post_object(x.WWW, ref, DOC_CLASS, docprops)
            print('  DocumentationClass', st)
            if st != 201:
                problems.append(f'{ref}: {DOC_CLASS} -> {st} {b}')
        if EXT_CLASS not in have:
            st, _, b = x.post_object(x.WWW, ref, EXT_CLASS, {'id': p['ext']})
            print('  DocumentationExtensionClass', st)
            if st != 201:
                problems.append(f'{ref}: {EXT_CLASS} -> {st} {b}')

        st, got = x.get_object(x.WWW, ref, DOC_CLASS)
        for k, v in docprops.items():
            if ((got or {}).get(k) or '') != v:
                x.put_property(x.WWW, ref, DOC_CLASS, 0, k, v)
                st, again = x.get_object(x.WWW, ref, DOC_CLASS)
                if ((again or {}).get(k) or '') != v:
                    problems.append(f'{ref}: {DOC_CLASS}.{k} read-back mismatch')
        st, got = x.get_object(x.WWW, ref, EXT_CLASS)
        if ((got or {}).get('id') or '') != p['ext']:
            x.put_property(x.WWW, ref, EXT_CLASS, 0, 'id', p['ext'])
            st, again = x.get_object(x.WWW, ref, EXT_CLASS)
            if ((again or {}).get('id') or '') != p['ext']:
                problems.append(f'{ref}: {EXT_CLASS}.id read-back mismatch')
    return problems


def pin(mod):
    """Pinning lives on the **parent space's WebPreferences page**, not on its WebHome."""
    problems = []
    for parent, children in getattr(mod, 'PIN', {}).items():
        prefs = parent.rsplit('.', 1)[0] + '.WebPreferences'
        value = '|'.join(c.rstrip('/') + '/' for c in children)
        print('===', prefs)
        st, _ = x.getjson(x.pageurl(x.WWW, prefs))
        if st != 200:
            # A space may have no WebPreferences page at all — create it hidden first.
            st, b = x.put_page(x.WWW, prefs, title='Page Administration', content='',
                               syntax='xwiki/2.1', hidden=True)
            print('  create', st)
        st, objs = x.list_objects(x.WWW, prefs)
        if PIN_CLASS not in {cn for cn, _ in objs}:
            st, _, b = x.post_object(x.WWW, prefs, PIN_CLASS, {'pinnedChildPages': value})
            print('  pin object', st)
        else:
            x.put_property(x.WWW, prefs, PIN_CLASS, 0, 'pinnedChildPages', value)
            print('  pin updated')
        # Ask the tree what it will display; the stored value only proves it was stored.
        st, shown = x.tree_children(parent)
        got = [r.rsplit('.', 2)[-2] for _, r in shown if r.endswith('.WebHome')]
        if got[:len(children)] != children:
            problems.append(f'{parent}: tree shows {got[:len(children)]}, expected {children}')
        else:
            print('  tree order OK:', ' | '.join(children))
    return problems


def verify(mod):
    problems = []
    for p in mod.ALL:
        ref = p['ref']
        st, d = x.getjson(x.pageurl(x.WWW, ref))
        if st != 200:
            problems.append(f'{ref}: page GET {st}')
            continue
        if d.get('title') != p['title']:
            problems.append(f'{ref}: title {d.get("title")!r} != {p["title"]!r}')
        if d.get('content') != p['content']:
            problems.append(f'{ref}: content differs from the source')
        if d.get('syntax') != 'xwiki/2.1':
            problems.append(f'{ref}: syntax is {d.get("syntax")!r}')
        if d.get('hidden'):
            problems.append(f'{ref}: page is hidden')

        st, objs = x.list_objects(x.WWW, ref)
        counts = {}
        for cn, _ in objs:
            counts[cn] = counts.get(cn, 0) + 1
        for cls in (DOC_CLASS, EXT_CLASS):
            if counts.get(cls) != 1:
                problems.append(f'{ref}: {counts.get(cls, 0)} {cls.rsplit(".", 1)[-1]} object(s)')

        st, props = x.get_object(x.WWW, ref, DOC_CLASS)
        for k, v in (('type', p['type']), ('target', p['target']), ('faq', p['faq']),
                     ('highlights', p['highlights']), ('related', p['related'])):
            cur = (props or {}).get(k) or ''
            if cur != v:
                problems.append(f'{ref}: {k} mismatch (stored {len(cur)} chars, expected {len(v)})')
        st, props = x.get_object(x.WWW, ref, EXT_CLASS)
        if ((props or {}).get('id') or '') != p['ext']:
            problems.append(f'{ref}: Technical ID is {(props or {}).get("id")!r}')

        # Checker surface 1: the violation objects the quality checker leaves on the page.
        for cn, n in objs:
            if cn == VIO_CLASS:
                st, vp = x.get_object(x.WWW, ref, cn, n)
                problems.append(f'{ref}: VIOLATION {vp.get("severity")} {vp.get("context")!r} '
                                f'{vp.get("message")!r}')

        st, got = x.list_attachments(x.WWW, ref)
        names = dict(got)
        for a in p['attachments']:
            path = os.path.join(shots_dir(mod), a)
            if a not in names:
                problems.append(f'{ref}: attachment {a} missing')
            elif names[a] != os.path.getsize(path):
                problems.append(f'{ref}: attachment {a} size {names[a]} != local')
        extra = set(names) - set(p['attachments'])
        if extra:
            problems.append(f'{ref}: unexpected attachments {sorted(extra)}')

        # Checker surface 2: the rendered page. Some findings — the mandatory-`size` rule on
        # `{{image}}` among them — create no object and show only as an inline error box, so an
        # object-only check reports a broken page as clean.
        st, _, b = x.call(x.viewurl(ref), accept='text/html')
        if st != 200:
            problems.append(f'{ref}: rendered GET {st}')
            continue
        html = b.decode('utf-8', 'replace')
        for m in re.finditer(r'Best practice:[^<]{0,140}', html):
            problems.append(f'{ref}: RENDER {m.group(0).strip()}')
        for marker, label in (('macro is not installed', 'missing macro'),
                              ('Failed to execute the [', 'macro error'),
                              ('rendering-error', 'rendering error')):
            if marker in html:
                problems.append(f'{ref}: RENDER {label}')
        for a in p['attachments']:
            if a not in html:
                problems.append(f'{ref}: image {a} is not in the rendered HTML')
    return problems


def main():
    argv = sys.argv[1:]
    module = 'pages'
    if '--pages' in argv:
        i = argv.index('--pages')
        module = argv[i + 1]
        del argv[i:i + 2]
    command = argv[0] if argv else 'lint'
    mod = load(module)
    if command == 'lint':
        problems = lint(mod)
    elif command == 'save':
        problems = save(mod, only=argv[1:] or None)
    elif command == 'pin':
        problems = pin(mod)
    elif command == 'verify':
        problems = verify(mod)
    else:
        raise SystemExit(f'unknown command {command!r} (lint | save | pin | verify)')
    print(f'\n{len(mod.ALL)} page(s), {len(problems)} problem(s)')
    for p in problems:
        print(' -', p)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
