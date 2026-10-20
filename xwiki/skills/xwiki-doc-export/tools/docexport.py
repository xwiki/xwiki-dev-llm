#!/usr/bin/env python3
"""docexport.py -- export an xwiki.org documentation subtree to one PDF, optionally translated.

The mechanical half of `xwiki-doc-export`: walking the tree in the reader's order, turning each
browser page into a book chapter, deciding what changed since the last export, sizing the
translation work, checking a translation kept the page's structure, and printing the book. The
translation itself, and every judgement call, stay in SKILL.md.

Every subcommand is one call that prints a short summary, so a session spends its context on the
work and not on reading state files.

    docexport.py scan     --root documentation.xs.user --lang de [--exclude <ref>]...
    docexport.py fetch    --root ... --lang de [--all]
    docexport.py glossary --root ... --lang de --platform ~/dev/xwiki/xwiki-platform
    docexport.py plan     --root ... --lang de [--chunk-bytes N] [--chunks-per-session N] [--force]
    docexport.py prompt   --root ... --lang de --task 03 [--failed]
    docexport.py check    --root ... --lang de (--task 03 | <ref>...)
    docexport.py todo     --root ... --lang de
    docexport.py accept-class --root ... --lang de <class>...
    docexport.py build    --root ... --lang de [--no-toc-pages]

State lives in `<work>/xwiki-doc-export/<root>__<lang>/`, the work root being what
`xwiki/scripts/state-dir.mjs` prints. Layout and resume rules: references/export-plan.md; the
browser-to-print rules: references/print-rules.md.

Standard library only. Reads are anonymous: the documentation is public.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import html
import html.parser
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'xwiki-doc-writing', 'tools'))
import xwikidoc as x  # noqa: E402  (the shared farm client: Cloudflare UA, cookie session)

x.CREDENTIALS = None  # stay anonymous even when ~/.xwiki-credentials exists

SITE = 'https://www.xwiki.org'
REST = x.WWW
DOCPLAN = os.path.normpath(os.path.join(HERE, '..', '..', 'xwiki-doc-writing', 'tools', 'docplan.py'))
STATE_DIR_SCRIPT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'scripts', 'state-dir.mjs'))

TYPE_LABELS = {'howto': 'How-to', 'tutorial': 'Tutorial', 'reference': 'Reference',
               'explanation': 'Explanation'}
EXTENSION_PREFIX = 'Extension: '

# Labels the book needs that are the same on every page, so they are translated once here rather
# than by each translator: the cover, the Contents, and the words of each page's metadata line.
# English defaults; `glossary` writes them into labels.<lang>.json to translate.
LABELS = {
    'contents': 'Contents',
    'in_this_section': 'In this section',
    'cover_source': 'Source',
    'cover_date': 'Exported on',
    'cover_subtitle': 'XWiki documentation',
    **{'type_' + t: label for t, label in TYPE_LABELS.items()},
    'extension': 'Extension',
}
TYPE_LABEL_KEYS = {label: 'type_' + t for t, label in TYPE_LABELS.items()}


def labels_ready(labels):
    """Whether labels.<lang>.json is translated and holds every label -- a newer tool can add some."""
    return bool(labels and labels.get('translated') and LABELS.keys() <= labels.keys())

# Sheet-generated top-level sections, by the id of their h1 (see references/print-rules.md).
SECTION_KEEP = {'HSteps', 'HFAQ', 'HRelated', 'HHighlights'}
SECTION_UNWRAP = {'HSummary', 'HExplanation', 'HReference', 'HTutorial'}  # keep body, drop label
SECTION_DROP = {'HWhatareyoulookingfor3F'}
SECTION_MORE = 'HMore'                    # keep its Highlights, replace the rest with the child list

# Classes a transformed page may still carry. Anything else is reported by `fetch` and stops `build`
# until it is given a rule or accepted: an xwiki.org sheet change must surface as a question, not
# print silently. Entries ending in `-` match as prefixes.
KNOWN_CLASSES = {
    'wikilink', 'wikiexternallink', 'wikiattachmentlink', 'wikigeneratedid', 'wikigeneratedheader',
    'monospace', 'box', 'infomessage', 'warningmessage', 'errormessage', 'successmessage',
    'callout-label', 'gallery', 'highlights', 'hl-desc', 'diagram', 'language-', 'table-bordered',
    'table', 'key', 'shortcut', 'separator', 'version-note', 'online-only', 'page-title', 'page-meta', 'in-this-section',
    'wikimodel-', 'footnote', 'footnotes', 'code', 'plantuml', 'wikicreatelink', 'wikiinternallink',
    'xwiki-metadata-container', 'figure', 'figcaption', 'wikiimage',
}
KNOWN_TAGS = set('article p a span div ul ol li h1 h2 h3 h4 h5 h6 img pre code table thead tbody tfoot tr '
                 'th td caption colgroup col strong em b i u s br hr dl dt dd blockquote sup sub del ins '
                 'tt kbd figure figcaption small abbr q cite mark'.split())

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source',
        'track', 'wbr'}


# --------------------------------------------------------------------------------------------------
# A minimal DOM: the pages are well-formed XHTML from the XWiki renderer, so a stack parser suffices.

class Node:
    __slots__ = ('tag', 'attrs', 'children', 'parent', 'text')

    def __init__(self, tag=None, attrs=None, text=None):
        self.tag, self.attrs, self.text = tag, dict(attrs or {}), text
        self.children, self.parent = [], None

    def append(self, n):
        n.parent = self
        self.children.append(n)
        return n

    def classes(self):
        return (self.attrs.get('class') or '').split()

    def has_class(self, c):
        return c in self.classes()

    def walk(self):
        yield self
        for c in list(self.children):
            yield from c.walk()

    def elements(self):
        return [n for n in self.walk() if n.tag]

    def remove(self):
        if self.parent is not None:
            self.parent.children.remove(self)
            self.parent = None

    def replace(self, *nodes):
        p = self.parent
        i = p.children.index(self)
        self.parent = None                  # first: `nodes` may hold self (insert before/after it)
        p.children[i:i + 1] = list(nodes)
        for n in nodes:
            n.parent = p

    def unwrap(self):
        self.replace(*self.children)

    def textcontent(self):
        return ''.join(n.text for n in self.walk() if n.text is not None)


class _Parser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root')
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = self.cur.append(Node(tag, attrs))
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.append(Node(text=data))


def parse(s):
    p = _Parser()
    p.feed(s)
    p.close()
    return p.root


def serialize(n):
    if n.tag is None:
        return html.escape(n.text, quote=False)
    inner = ''.join(serialize(c) for c in n.children)
    if n.tag == '#root':
        return inner
    attrs = ''.join(f' {k}' if v is None else f' {k}="{html.escape(v)}"' for k, v in n.attrs.items())
    if n.tag in VOID:
        return f'<{n.tag}{attrs} />'
    return f'<{n.tag}{attrs}>{inner}</{n.tag}>'


def el(tag, attrs=None, *children):
    n = Node(tag, attrs)
    for c in children:
        n.append(Node(text=c) if isinstance(c, str) else c)
    return n


# --------------------------------------------------------------------------------------------------
# State

def work_root():
    try:
        out = subprocess.run(['node', STATE_DIR_SCRIPT], capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError) as e:
        raise SystemExit(f'cannot resolve the work directory with {STATE_DIR_SCRIPT}: {e}')
    return out.stdout.strip()


class State:
    def __init__(self, args):
        self.root, self.lang = args.root, args.lang
        if not self.root.endswith('.WebHome'):
            self.root += '.WebHome'
        self.dir = args.dir or os.path.join(work_root(), 'xwiki-doc-export',
                                            f'{self.root[:-len(".WebHome")]}__{self.lang}')
        os.makedirs(self.dir, exist_ok=True)

    def path(self, *p):
        return os.path.join(self.dir, *p)

    def load(self, name, default=None):
        try:
            with open(self.path(name), encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return default

    def save(self, name, data):
        tmp = self.path(name + '.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
        os.replace(tmp, self.path(name))

    @property
    def translating(self):
        return self.lang != 'en'


def space_of(ref):
    return ref[:-len('.WebHome')] if ref.endswith('.WebHome') else ref


def page_key(root, ref):
    """Stable id prefix of a page in the book: its reference relative to the root."""
    rel = space_of(ref)[len(space_of(root)):].lstrip('.')
    return 'pg-' + (rel or 'root')


def file_key(key):
    return key + '.html'


def sha(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()[:16]


def get_text(url, accept='*/*'):
    st, _, b = x.call(url, accept=accept)
    if st != 200:
        raise RuntimeError(f'HTTP {st} for {url}')
    return b.decode('utf-8')


def get_json(url):
    return json.loads(get_text(url + ('&' if '?' in url else '?') + 'media=json', 'application/json'))


def solr(q, number=500):
    out, start = [], 0
    while True:
        url = (REST.rsplit('/wikis/', 1)[0] + f'/wikis/query?type=solr&number={number}&start={start}'
               + '&q=' + urllib.parse.quote(q))
        got = get_json(url).get('searchResults', [])
        out += got
        if len(got) < number:
            return out
        start += number


# --------------------------------------------------------------------------------------------------
# scan

def tree_walk(root, excludes):
    """Pages under `root` in the reader's order (depth-first, pinned children first, then by title --
    the DocumentTree service applies both, so its order *is* the navigation panel's)."""
    out = []

    def rec(ref, depth, parent):
        st, kids = x.tree_children(ref)
        if st != 200:
            raise SystemExit(f'DocumentTree answered HTTP {st} for {ref}')
        child_refs = []
        for title, cref in kids:
            if cref.endswith('.WebPreferences') or cref in excludes or \
                    any(cref.startswith(space_of(e) + '.') for e in excludes):
                continue
            child_refs.append((title, cref))
        entry = {'ref': ref, 'depth': depth, 'parent': parent, 'children': []}
        out.append(entry)
        for title, cref in child_refs:
            entry['children'].append(cref)
            rec(cref, depth + 1, ref)
    rec(root, 0, None)
    return out


def attachment_versions(ref):
    try:
        d = get_json(x.pageurl(REST, ref) + '/attachments')
    except RuntimeError:
        return {}
    return {a['name']: a.get('version') for a in d.get('attachments', [])}


def cmd_scan(s, args):
    cfg = s.load('export.json') or {}
    excludes = sorted(set(cfg.get('excludes', [])) | {e if e.endswith('.WebHome') else e + '.WebHome'
                                                     for e in (args.exclude or [])})
    root_space = space_of(s.root)
    hits = {h['pageFullName']: h for h in solr(f'space_prefix:{root_space} AND type:DOCUMENT '
                                               f'AND locale:(en OR "")')}
    type_landings = {h['pageFullName'] for h in solr(
        f'space_prefix:{root_space} AND type:DOCUMENT AND '
        f'property.DocApp.Code.LandingPageClass.listChildren:0')}
    pages = tree_walk(s.root, set(excludes) | type_landings)

    # A page Solr knows but the tree does not show is one the reader cannot reach: exporting the
    # tree would drop it silently, so that stops the scan. The reverse is only a stale index (seen
    # live: a page missing from Solr for weeks) -- the page is dated from REST instead.
    in_tree = {p['ref'] for p in pages}
    def excluded(ref):
        return ref in excludes or any(ref.startswith(space_of(e) + '.') for e in excludes)
    expected = {r for r in hits if not r.endswith('.WebPreferences') and r not in type_landings
                and not excluded(r)}
    missing_tree = sorted(expected - in_tree)
    for r in sorted(in_tree - set(hits)):
        d = get_json(x.pageurl(REST, r))
        hits[r] = {'title': d.get('title'), 'version': d.get('version'), 'modified': d.get('modified')}
        print(f'  not in the Solr index (dated from REST): {r}')
    if missing_tree:
        for r in missing_tree:
            print(f'  in Solr, not in the navigation tree: {r}')
        if not args.ignore_mismatch:
            raise SystemExit('pages exist that the navigation tree does not show -- fix upstream, '
                             '--exclude them, or pass --ignore-mismatch after deciding they do not belong')

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        atts = dict(zip(in_tree, pool.map(attachment_versions, in_tree)))
    for p in pages:
        h = hits.get(p['ref'], {})
        p.update(key=page_key(s.root, p['ref']), title=h.get('title') or p['ref'],
                 version=h.get('version'), modified=h.get('modified'), attachments=atts[p['ref']])

    xwiki_version = get_json(REST.rsplit('/wikis/', 1)[0]).get('version')
    state = s.load('state.json', {})
    deleted = [r for r in state if r not in in_tree]
    for r in deleted:
        for sub in ('source', 'translated'):
            try:
                os.remove(s.path(sub, file_key(state[r]['key'])))
            except (FileNotFoundError, KeyError):
                pass
        del state[r]
    s.save('state.json', state)

    new, changed = [], []
    for p in pages:
        st = state.get(p['ref'])
        if st is None:
            new.append(p['ref'])
        elif st.get('fetchedVersion') != p['version'] or st.get('fetchedAttachments') != p['attachments']:
            changed.append(p['ref'])
    last = s.load('last-export.json')
    moved = []
    if last:
        before = [p['ref'] for p in last['pages'] if p['ref'] in in_tree]
        after = [p['ref'] for p in pages if p['ref'] in set(before)]
        moved = [r for r, q in zip(after, before) if r != q]

    cfg.update(root=s.root, lang=s.lang, excludes=excludes,
               created=cfg.get('created') or datetime.date.today().isoformat())
    set_layout(cfg, args)
    s.save('export.json', cfg)
    s.save('manifest.json', {'root': s.root, 'lang': s.lang, 'xwikiVersion': xwiki_version,
                             'scanned': datetime.datetime.now().isoformat(timespec='seconds'),
                             'excludes': excludes, 'skippedTypeLandings': sorted(type_landings),
                             'pages': pages})
    print(f'State dir: {s.dir}')
    print(f'{len(pages)} pages in navigation order (xwiki.org {xwiki_version}); '
          f'skipped {len(type_landings)} type landing pages, {len(excludes)} exclusion(s)')
    print(f'new {len(new)}, changed {len(changed)}, deleted {len(deleted)}, '
          f'reordered {len(moved)}, unchanged {len(pages) - len(new) - len(changed)}')
    for label, refs in (('changed', changed), ('deleted', deleted), ('reordered', moved)):
        for r in refs[:20]:
            print(f'  {label}: {r}')
    print('next: fetch' if new or changed else 'next: nothing to fetch -- plan (a build at most)')
    return 0


# --------------------------------------------------------------------------------------------------
# fetch: one browser page -> one print-ready chapter (references/print-rules.md)

def ref_from_view_path(path):
    """`/xwiki/bin/view/a/b/c/` -> `a.b.c.WebHome` (a nested page), or None when not a view URL."""
    m = re.match(r'^/xwiki/bin/view/(.+?)/?$', path)
    if not m:
        return None
    parts = [urllib.parse.unquote(p) for p in m.group(1).split('/') if p]
    if not parts:
        return None
    if parts[-1] == 'WebHome':
        parts = parts[:-1]
    return '.'.join(p.replace('.', '\\.') for p in parts) + '.WebHome'


def normalize_href(href):
    """In-wiki page links become `ref:<reference>[#anchor]` so `build` decides, against the final
    manifest, whether they point inside the book. Everything else becomes absolute."""
    if not href or href.startswith('#') or href.startswith('mailto:'):
        return href
    u = urllib.parse.urlsplit(href)
    if u.scheme in ('http', 'https') and u.netloc not in ('www.xwiki.org', ''):
        return href
    ref = ref_from_view_path(u.path) if not u.query else None
    if ref and ref.startswith('documentation.'):
        return 'ref:' + ref + ('#' + u.fragment if u.fragment else '')
    return urllib.parse.urljoin(SITE + '/', href)


def cf_decode(hexstr):
    b = bytes.fromhex(hexstr)
    return ''.join(chr(c ^ b[0]) for c in b[1:])


def download_asset(s, url):
    absu = urllib.parse.urljoin(SITE + '/', url)
    base = os.path.basename(urllib.parse.urlsplit(absu).path) or 'asset'
    name = sha(absu)[:10] + '-' + re.sub(r'[^A-Za-z0-9._-]', '_', urllib.parse.unquote(base))
    dest = s.path('assets', name)
    if not os.path.exists(dest):
        st, _, b = x.call(absu, accept='*/*')
        if st != 200:
            raise RuntimeError(f'HTTP {st} for {absu}')
        os.makedirs(s.path('assets'), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(b)
    return 'assets/' + name


def online_note(text, ref):
    url = x.viewurl(ref)
    return el('p', {'class': 'online-only'}, text + ' ', el('a', {'href': url}, url))


def transform(s, page, raw, meta):
    """The print transform. Returns (html, unknown sheet sections)."""
    root = parse(raw)
    ref = page['ref']
    unknown_sections = []

    for n in root.elements():
        if n.tag == 'script' or n.has_class('floatinginfobox') or \
                (n.tag == 'form') or n.has_class('wikimodel-emptyline'):
            n.remove()

    # Sheet sections: split the top level on the generated h1s.
    section, more_seen = None, False
    for n in list(root.children):
        if n.tag == 'h1' and n.has_class('wikigeneratedheader'):
            section = n.attrs.get('id')
            if section in SECTION_UNWRAP or section in SECTION_DROP:
                n.remove()
            elif section == SECTION_MORE:
                more_seen = True
                n.replace(el('div', {'class': 'in-this-section'}))
            elif section not in SECTION_KEEP:
                unknown_sections.append(section)
            continue
        if section in SECTION_DROP or (section == SECTION_MORE and not
                                       (n.tag == 'div' and n.has_class('cardlist'))):
            n.remove()
        elif section == SECTION_MORE:
            n.replace(el('h1', {'id': 'HHighlights'}, 'Highlights'), n)

    for n in root.elements():
        if n.parent is None:
            continue
        cls = n.classes()
        if 'liveData' in cls:                                   # used as content
            n.replace(online_note('This interactive table is available online:', ref))
        elif 'xwiki-async' in cls:
            n.replace(*async_content(s, n, ref))
        elif 'cardlist' in cls:
            ul = next((c for c in n.children if c.tag == 'ul'), None)
            if ul is not None:
                ul.attrs = {'class': 'highlights'}
                for li in ul.children:
                    for sub in [c for c in li.children if c.tag == 'ul']:
                        desc = ' '.join(t.textcontent().strip() for t in sub.children if t.tag)
                        sub.replace(Node(text=' — '), el('span', {'class': 'hl-desc'}, desc))
                n.replace(ul)
        elif n.tag == 'a' and ('__cf_email__' in cls or 'email-protection' in (n.attrs.get('href') or '')):
            enc = n.attrs.get('data-cfemail') or (n.attrs.get('href') or '').rpartition('#')[2]
            try:
                addr = cf_decode(enc)
                n.replace(el('a', {'href': 'mailto:' + addr}, addr) if '__cf_email__' not in cls
                          else Node(text=addr))
            except ValueError:
                pass
        elif n.tag == 'span' and 'badge' in cls:
            # Version badges ("Since XWiki 18.7.0", "Before XWiki 17.8.0, 17.4.5"): the title says it
            # in words, the badge text in symbols ("XWiki <17.8.0") that do not translate.
            n.replace(el('span', {'class': 'version-note'},
                         '(' + (n.attrs.get('title') or n.textcontent()).strip() + ')'))
        elif 'sr-only' in cls:
            box = n.parent
            while box is not None and not box.has_class('box'):
                box = box.parent
            if box is not None:
                n.replace(el('strong', {'class': 'callout-label'}, n.textcontent().strip()), Node(text=' '))
            else:
                n.remove()
        elif any(c == 'fa' or c.startswith('fa-') for c in cls):
            n.remove()
        elif 'icon-block' in cls:
            n.unwrap()

    for n in root.elements():
        if n.parent is None and n is not root:
            continue
        # Presentation is decided at build time (image borders, sizes), never here: a change to it
        # must not change the source, or every translation would be invalidated with it.
        n.attrs.pop('style', None)
        n.attrs.pop('data-xwiki-lightbox', None)
        if n.tag == 'a' and 'href' in n.attrs:
            n.attrs['href'] = normalize_href(n.attrs['href'])
        if n.tag == 'img' and n.attrs.get('src'):
            try:
                n.attrs['src'] = download_asset(s, n.attrs['src'])
            except RuntimeError as e:
                print(f'  !! {ref}: image not downloaded ({e})')
        # Page headings drop one level: the page title is the h1 of every chapter.
        m = re.match(r'^h([1-6])$', n.tag or '')
        if m:
            n.tag = 'h' + str(min(int(m.group(1)) + 1, 6))

    if not more_seen and page['children']:
        root.append(el('div', {'class': 'in-this-section'}))

    head = [el('h1', {'class': 'page-title'}, page['title'])]
    if meta:
        head.append(el('p', {'class': 'page-meta'}, meta))
    article = el('article', {'data-ref': ref})
    for n in head + list(root.children):
        article.append(n)
    return serialize(article), unknown_sections


def async_content(s, n, ref):
    """Content rendered asynchronously (PlantUML today) is an empty div in the HTML: ask the async
    renderer for it, in the same cookie session as the page fetch (the client id is bound to it)."""
    aid, cid = n.attrs.get('data-xwiki-async-id'), n.attrs.get('data-xwiki-async-client-id')
    if aid and cid:
        try:
            body = get_text(f'{SITE}/xwiki/asyncrenderer/{aid}?clientId={cid}&timeout=30000', 'text/html')
            frag = parse(body)
            if frag.elements():
                for img in (e for e in frag.elements() if e.tag == 'img'):
                    img.attrs.update({'class': 'diagram', 'alt': ''})   # the alt is a temp file path
                return frag.children
        except RuntimeError:
            pass
    return [online_note('This diagram is available online:', ref)]


def page_meta(ref, landing):
    if landing:
        return ''
    parts = []
    st, doc = x.get_object(REST, ref, 'DocApp.Code.DocumentationClass')
    if st == 200 and doc.get('type'):
        parts.append(TYPE_LABELS.get(doc['type'], doc['type']))
    st, ext = x.get_object(REST, ref, 'DocApp.Code.DocumentationExtensionClass')
    if st == 200 and ext.get('id'):
        parts.append(EXTENSION_PREFIX + re.sub(r'^[a-z]+:(?=[^:]+:[^:]+$)', '', ext['id']))
    return ' · '.join(parts)


def localized_meta(source_meta, labels):
    """The metadata line in the book's language, rebuilt from the English line page_meta() wrote in
    the source: its words come from labels.<lang>.json, so every page says them the same way."""
    out = []
    for part in source_meta.split(' · '):
        if part.startswith(EXTENSION_PREFIX):
            out.append(f'{labels["extension"]}: {part[len(EXTENSION_PREFIX):]}')
        else:
            out.append(labels.get(TYPE_LABEL_KEYS.get(part), part))
    return ' · '.join(out)


def class_inventory(article_html):
    found = set()
    for n in parse(article_html).elements():
        if n.tag != '#root' and n.tag not in KNOWN_TAGS:
            found.add('tag:' + n.tag)
        for c in n.classes():
            if c in KNOWN_CLASSES or any(k.endswith('-') and c.startswith(k) for k in KNOWN_CLASSES):
                continue
            found.add(c)
    return found


def cmd_fetch(s, args):
    manifest = s.load('manifest.json')
    if not manifest:
        raise SystemExit('no manifest -- run scan first')
    state = s.load('state.json', {})
    os.makedirs(s.path('source'), exist_ok=True)
    todo = [p for p in manifest['pages'] if args.all or p['ref'] not in state
            or state[p['ref']].get('fetchedVersion') != p['version']
            or state[p['ref']].get('fetchedAttachments') != p['attachments']]
    # A re-fetched page is re-inventoried from scratch, so a block that has gone away, or has gained
    # a rule since, stops being reported.
    fetched = {p['ref'] for p in todo}
    unknown = {c: [r for r in refs if r not in fetched] for c, refs in s.load('unknown-blocks.json', {}).items()}
    unknown = {c: refs for c, refs in unknown.items() if refs}
    same, fresh = 0, 0
    for i, p in enumerate(todo, 1):
        raw = get_text(x.viewurl(p['ref']) + '?xpage=plain', 'text/html')
        landing = p['depth'] == 0 or bool(x.get_object(REST, p['ref'], 'DocApp.Code.LandingPageClass')[1])
        out, sections = transform(s, p, raw, page_meta(p['ref'], landing))
        h = sha(out)
        with open(s.path('source', file_key(p['key'])), 'w', encoding='utf-8') as f:
            f.write(out)
        st = state.setdefault(p['ref'], {})
        if st.get('sourceHash') == h:
            same += 1
        else:
            fresh += 1
        st.update(key=p['key'], sourceHash=h, fetchedVersion=p['version'],
                  fetchedAttachments=p['attachments'], bytes=len(out.encode('utf-8')))
        for c in class_inventory(out) | {f'section:{sec}' for sec in sections}:
            unknown.setdefault(c, [])
            if p['ref'] not in unknown[c]:
                unknown[c].append(p['ref'])
        if i % 20 == 0:
            s.save('state.json', state)
            print(f'  {i}/{len(todo)}')
    s.save('state.json', state)
    accepted = set(s.load('accepted-classes.json', []))
    unknown = {c: refs for c, refs in unknown.items() if c not in accepted}
    s.save('unknown-blocks.json', unknown)
    print(f'fetched {len(todo)} page(s): {fresh} with new content, {same} rendering unchanged '
          f'(their translation stays valid)')
    if unknown:
        print(f'{len(unknown)} block class(es) with no print rule -- build will refuse until each gets a '
              f'rule in references/print-rules.md or is accepted with accept-class:')
        for c, refs in sorted(unknown.items()):
            print(f'  {c}: {len(refs)} page(s), e.g. {refs[0]}')
    return 0


def cmd_accept_class(s, args):
    accepted = set(s.load('accepted-classes.json', [])) | set(args.classes)
    s.save('accepted-classes.json', sorted(accepted))
    unknown = {c: r for c, r in s.load('unknown-blocks.json', {}).items() if c not in accepted}
    s.save('unknown-blocks.json', unknown)
    print(f'accepted {len(args.classes)}; {len(unknown)} still unreviewed')
    return 0


# --------------------------------------------------------------------------------------------------
# glossary: the official UI strings of the target language, from an xwiki-platform checkout

def decode(data):
    # Most .properties files are UTF-8, but some are still ISO-8859-1.
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        return data.decode('iso-8859-1')


def read_file(path):
    try:
        with open(path, 'rb') as f:
            return decode(f.read())
    except OSError:
        return ''


def parse_properties(text):
    out, key, buf = {}, None, ''
    for line in text.splitlines():
        if key is None:
            st = line.strip()
            if not st or st[0] in '#!':
                continue
            m = re.match(r'^\s*([^=:\s]+)\s*[=:]\s?(.*)$', line)
            if not m:
                continue
            key, buf = m.group(1), m.group(2)
        else:
            buf += line.lstrip()
        if buf.endswith('\\') and not buf.endswith('\\\\'):
            buf = buf[:-1]
            continue
        out[key] = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), buf).replace("''", "'")
        key = None
    return out


def translation_page(text):
    """The properties held by a wiki translation page -- a `plain/1.0` page whose content is a
    properties file. A translated *document* also carries `<translation>1</translation>`, but its
    content is wiki syntax, so the syntax is what tells them apart."""
    if '<syntaxId>plain/1.0</syntaxId>' not in text[:4000]:
        return {}
    m = re.search(r'<content>(.*?)</content>', text, re.S)
    return parse_properties(html.unescape(m.group(1))) if m else {}


def ui_pair(e, v):
    """Whether an English string and its translation make a usable UI label (not a sentence, not a
    message with parameters, not left untranslated)."""
    return bool(e and v and e != v and len(e) <= 80 and '{' not in e)


OLDER_UI = '(older UI)'


def older_labels(platform, files, current):
    """English labels the UI no longer shows, with the translation the UI showed for them then.

    A page that describes an older version ("before 17.8.0 the field was called ...") quotes a label
    renamed since, which the current catalogue no longer holds. The checkout's history has it: for
    every commit that changed an English value, the old value, and the translation of that key in
    the parent commit, even for a label another screen still shows ("Locale" was renamed on the
    Information tab only). An old translation the label still has today is left out. A shallow
    checkout only yields the renames its history covers."""
    en_files = {en: tr for en, tr in files}
    try:
        log = subprocess.run(['git', '-C', platform, 'log', '-p', '-U0', '--no-merges', '--format=@@@%H',
                              '--', *en_files], capture_output=True, text=True, errors='replace',
                             check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        print('  (not a git checkout: labels renamed in older versions are not looked up)')
        return {}
    renames, commit, path, removed = {}, None, None, {}

    def flush():
        # A value is renamed when the same commit removes and re-adds its key with another value.
        for (c, f, k), old in removed.items():
            if (c, f, k) in added and added[(c, f, k)] != old:
                renames.setdefault((c, f), {})[k] = old
    added = {}
    for line in log.splitlines():
        if line.startswith('@@@'):
            commit = line[3:]
        elif line.startswith('+++ b/') or line.startswith('--- a/'):
            path = line[6:] if line.startswith('+++') else path
        elif line[:1] in '+-' and not line.startswith(('+++', '---')) and path in en_files:
            m = re.match(r'^[+-]\s*([^=:\s#!<]+)\s*[=:]\s?(.*)$', html.unescape(line) if path.endswith('.xml') else line)
            if m:
                (removed if line[0] == '-' else added)[(commit, path, m.group(1))] = m.group(2).strip()
    flush()
    def translation_before(item):
        (c, f), keys = item
        tr_path = en_files[f]
        try:
            text = decode(subprocess.run(['git', '-C', platform, 'show', f'{c}^:{tr_path}'],
                                         capture_output=True, check=True).stdout)
        except subprocess.CalledProcessError:
            return keys, {}                             # no translation yet, or a shallow boundary
        return keys, translation_page(text) if tr_path.endswith('.xml') else parse_properties(text)

    older = {}
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        for keys, tr in pool.map(translation_before, renames.items()):
            for k, old in keys.items():
                old = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), old).replace("''", "'")
                old = old.removesuffix('</content>').strip()
                v = tr.get(k)
                if ui_pair(old, v) and v.strip() not in current.get(old.lower(), ()):
                    slot = older.setdefault(old.lower(), {})
                    slot[v.strip()] = slot.get(v.strip(), 0) + 1
    return older


def cmd_glossary(s, args):
    if not args.platform or not os.path.isdir(args.platform):
        manifest = s.load('manifest.json') or {}
        v = manifest.get('xwikiVersion', '<version>')
        raise SystemExit('pass --platform <xwiki-platform checkout at the version xwiki.org runs>, e.g.\n'
                         f'  git clone --shallow-since=5.years --branch xwiki-platform-{v} '
                         'https://github.com/xwiki/xwiki-platform.git <dir>\n'
                         '(its history gives the labels renamed since, which pages about older versions quote;\n'
                         'with --depth 1 those are not found)')
    en2l, pairs, files = {}, 0, []
    for dirpath, dirnames, filenames in os.walk(args.platform):
        dirnames[:] = [d for d in dirnames if not d.startswith(('target', '.', 'node_modules'))]
        for fn in filenames:
            en = tr = None
            if fn.endswith(f'_{s.lang}.properties'):
                en_path = os.path.join(dirpath, fn[:-len(f'_{s.lang}.properties')] + '.properties')
                en = parse_properties(read_file(en_path))
                tr = parse_properties(read_file(os.path.join(dirpath, fn)))
            elif fn.endswith(f'.{s.lang}.xml'):
                en_path = os.path.join(dirpath, fn[:-len(f'.{s.lang}.xml')] + '.xml')
                tr = translation_page(read_file(os.path.join(dirpath, fn)))
                if tr:
                    en = translation_page(read_file(en_path))
            if not en or not tr:
                continue
            files.append((os.path.relpath(en_path, args.platform),
                          os.path.relpath(os.path.join(dirpath, fn), args.platform)))
            for k, v in tr.items():
                e = en.get(k)
                if not ui_pair(e, v):
                    continue
                pairs += 1
                slot = en2l.setdefault(e.strip().lower(), {})
                slot[v.strip()] = slot.get(v.strip(), 0) + 1
    ui = {e: sorted(vs, key=lambda v: -vs[v])[:3] for e, vs in en2l.items()}
    older = older_labels(args.platform, files, ui)
    for e, vs in older.items():
        ui[e] = ui.get(e, []) + [f'{v} {OLDER_UI}' for v in sorted(vs, key=lambda v: -vs[v])[:3]]
    s.save(f'ui-strings.{s.lang}.json', ui)
    cfg = s.load('export.json') or {}
    cfg['platform'] = os.path.abspath(args.platform)
    s.save('export.json', cfg)
    labels = s.load(f'labels.{s.lang}.json')
    if labels is None:
        s.save(f'labels.{s.lang}.json', {'translated': False, **LABELS})
    elif not LABELS.keys() <= labels.keys():
        s.save(f'labels.{s.lang}.json', {**labels, 'translated': False,
                                          **{k: v for k, v in LABELS.items() if k not in labels}})
    if s.load(f'glossary.{s.lang}.json') is None:
        s.save(f'glossary.{s.lang}.json', {})
    print(f'{pairs} translated UI strings, {len(ui)} distinct English labels ({len(older)} of them with an '
          f'older-UI translation) -> ui-strings.{s.lang}.json')
    print(f'translate the book labels in labels.{s.lang}.json and set "translated": true')
    return 0


QUOTED = re.compile(r'["“„«]([^"”“»\n]{1,60})["”“»]')


def terms_for(s, refs):
    """The UI strings the given pages actually mention, with their official translation. UI labels
    appear quoted ("Attachments" tab) or bold in the documentation; only those are looked up, so a
    translator's prompt carries a few dozen terms instead of the whole catalogue."""
    ui = s.load(f'ui-strings.{s.lang}.json', {})
    state = s.load('state.json', {})
    found = {}
    for r in refs:
        try:
            with open(s.path('source', file_key(state[r]['key'])), encoding='utf-8') as f:
                root = parse(f.read())
        except (KeyError, FileNotFoundError):
            continue
        text = root.textcontent()
        cands = set(QUOTED.findall(text))
        cands |= {n.textcontent() for n in root.elements() if n.tag in ('strong', 'b') or n.has_class('key')}
        for c in cands:
            c = c.strip().rstrip(':.…').strip()
            if c[:1].isupper() and c.lower() in ui:     # a label, not a fragment such as "at"
                found[c] = ui[c.lower()]
    return found


# --------------------------------------------------------------------------------------------------
# plan / prompt / check / todo

def needs_translation(s, state, ref):
    st = state.get(ref, {})
    return s.translating and st.get('sourceHash') and st.get('translatedFromHash') != st.get('sourceHash')


def chunks_of(items, limit):
    out, cur, size = [], [], 0
    for ref, b in items:
        if cur and size + b > limit:
            out.append(cur)
            cur, size = [], 0
        cur.append(ref)
        size += b
    if cur:
        out.append(cur)
    return out


PLAN_HEAD = """# Export: {root} -> {lang}

Status: executing
Working dir: {dir}
Started: {today}

## Scope

- Root: {root} ({n} pages in navigation order, xwiki.org {version})
- Language: {lang}
- Excluded subtrees: {excludes}
- Skipped: the type landing pages (query listings; their pages are in the tree already)

## Setup (do not re-ask)

- Tool: `python3 {tool} <cmd> {args}`
- Plan status: `python3 {docplan} --plan {dir}/PLAN.md status`
- xwiki-platform checkout for the UI strings: {platform}

## Decisions

## Open questions

## Tasks

| # | Task | File | Status | Outcome |
|---|---|---|---|---|
"""

TASK_TEMPLATES = {
    'glossary': """Status: todo

# Task {num}: official UI strings for `{lang}`

1. `python3 {tool} glossary {args} --platform <checkout>` -- the checkout must be
   at the version the manifest records ({version}); clone it shallow if needed (the command prints how).
2. Translate the few book labels in `{dir}/labels.{lang}.json` yourself and set `"translated": true`.
3. Record the checkout path in PLAN.md's Setup section.

## Outcome
""",
    'translate': """Status: todo

# Task {num}: translate {npages} page(s) into `{lang}` ({nchunks} chunk(s))

This session only orchestrates: it never reads a page itself.

1. `python3 {tool} prompt {args} --task {num}` -- writes one prompt file per chunk
   and prints their paths.
2. Launch **one subagent per chunk, all in a single message**, each told only: "Read and follow
   <prompt file>. Reply with one line: the pages written, any term you added to the glossary, and
   any glossary entry that contradicts the UI labels."
3. `python3 {tool} check {args} --task {num}` -- marks the passing pages as
   translated and lists the failures.
   A reported contradiction is settled here, not by the translators: set the glossary entry to the
   UI's word, record it under Decisions, and have one subagent reword the pages already written
   with the old one.
4. For failures: `prompt ... --task {num} --failed`, relaunch those chunks, re-check. A page that fails
   twice goes to Open questions with the check's reason; do not fix it by hand in this session.

## Chunks

{chunks}

## Outcome
""",
    'build': """Status: todo

# Task {num}: build the PDF

1. `python3 {tool} build {args}` -- refuses while pages are untranslated or
   block classes are unreviewed, and says which.
2. Open the PDF **once** and spot-check: cover, the Contents page numbers, one page per top-level
   topic, a screenshot, a code block, an "In this section" list, an external link.
3. Report the PDF path and the change report (`out/changes-<date>.md`) to the developer.

## Outcome
""",
}


def cmd_plan(s, args):
    manifest = s.load('manifest.json')
    if not manifest:
        raise SystemExit('no manifest -- run scan and fetch first')
    state = s.load('state.json', {})
    unfetched = [p['ref'] for p in manifest['pages'] if state.get(p['ref'], {}).get('fetchedVersion') != p['version']]
    if unfetched:
        raise SystemExit(f'{len(unfetched)} page(s) not fetched yet (e.g. {unfetched[0]}) -- run fetch first')
    plan = s.path('PLAN.md')
    decisions = ''
    if os.path.exists(plan):
        with open(plan, encoding='utf-8') as f:
            text = f.read()
        if re.search(r'^\|\s*\d+\s*\|.*\|\s*(todo|doing|blocked)\s*\|', text, re.M) and not args.force:
            raise SystemExit('PLAN.md still has open tasks -- finish them, or pass --force to replace it')
        # Decisions hold for the whole export (layout, glossary rulings), not for one plan.
        m = re.search(r'^## Decisions\n(.*?)^## ', text, re.S | re.M)
        decisions = m.group(1).strip() if m else ''
        os.makedirs(s.path('plans'), exist_ok=True)
        shutil.move(plan, s.path('plans', f'PLAN-{datetime.datetime.now():%Y%m%d-%H%M%S}.md'))
    if os.path.isdir(s.path('tasks')):
        shutil.rmtree(s.path('tasks'))
    os.makedirs(s.path('tasks'))

    todo = [(p['ref'], state[p['ref']].get('bytes', 0)) for p in manifest['pages']
            if needs_translation(s, state, p['ref'])]
    chunks = chunks_of(todo, args.chunk_bytes)
    sessions = [chunks[i:i + args.chunks_per_session] for i in range(0, len(chunks), args.chunks_per_session)]
    labels = s.load(f'labels.{s.lang}.json')
    tasks = []
    if s.translating and (not os.path.exists(s.path(f'ui-strings.{s.lang}.json'))
                          or not labels_ready(labels)):
        tasks.append(('glossary', 'Official UI strings and book labels', {}))
    for sess in sessions:
        tasks.append(('translate', f'Translate {sum(len(c) for c in sess)} pages', {'chunks': sess}))
    tasks.append(('build', 'Build the PDF', {}))

    ctx = dict(root=s.root, lang=s.lang, dir=s.dir, tool=os.path.join(HERE, 'docexport.py'),
               args=f'--root {space_of(s.root)} --lang {s.lang}' + (f' --dir {s.dir}' if args.dir else ''),
               docplan=DOCPLAN, version=manifest.get('xwikiVersion'), n=len(manifest['pages']),
               today=datetime.date.today().isoformat(), excludes=', '.join(manifest['excludes']) or 'none',
               platform=(s.load('export.json') or {}).get('platform', 'not set yet'))
    rows, batches = [], {}
    for i, (kind, name, extra) in enumerate(tasks, 1):
        num = f'{i:02d}'
        fname = f'tasks/{num}-{kind}.md'
        tctx = dict(ctx, num=num)
        if kind == 'translate':
            batches[num] = extra['chunks']
            tctx.update(npages=sum(len(c) for c in extra['chunks']), nchunks=len(extra['chunks']),
                        chunks='\n'.join(f'- chunk {j}: ' + ', '.join(space_of(r)[len(space_of(s.root)):].lstrip('.') or '(root)'
                                                                     for r in c)
                                         for j, c in enumerate(extra['chunks'], 1)))
        with open(s.path(fname), 'w', encoding='utf-8') as f:
            f.write(TASK_TEMPLATES[kind].format(**tctx))
        rows.append(f'| {num} | {name} | {fname} | todo | |')
    s.save('batches.json', batches)
    with open(plan, 'w', encoding='utf-8') as f:
        head = PLAN_HEAD.format(**ctx)
        if decisions:
            head = head.replace('## Decisions\n', f'## Decisions\n\n{decisions}\n', 1)
        f.write(head + '\n'.join(rows) + '\n')
    print(f'PLAN.md: {len(tasks)} task(s) -- {len(todo)} page(s) to translate in {len(chunks)} chunk(s) '
          f'over {len(sessions)} session(s)')
    print(f'status: python3 {DOCPLAN} --plan {plan} status')
    return 0


PROMPT = """You are translating pages of the XWiki documentation from English into `{lang}` for a
printed book. Work only on the files named here -- never modify another, not even with a script:
other translators are writing the rest of `translated/` at the same time. Write each result with
your file-writing tool, and do not read anything else.

## Pages

{pages}

For each page: read the source file, translate it, write the result to the target path.

## What to translate

- Every text node, plus the `alt` and `title` attributes, including the page title
  (`h1.page-title`).
- Except the metadata line under it (`p.page-meta`, e.g. "How-to · Extension: ..."): leave it as it
  is. The build writes it in {lang} from the book's own labels, the same on every page.
- Translate, do not edit: add nothing and drop nothing, even where a passage reads oddly in {lang};
  name it in your reply instead.

## What must come out byte-identical

- Every tag, attribute name, `id`, `href`, `src` and `class` -- the check compares them one by one
  and fails the page on any difference, including an added or removed element.
- The whole content of `pre`, `code` and `span.monospace`: code, configuration keys, macro names,
  page names and file names are not prose.
- URLs, version numbers, keyboard keys (`span.key`).

## Terminology

- UI labels -- button, menu, tab and field names, usually quoted or bold -- must use XWiki's own
  translation, so the book matches the screen a {lang} user sees. The labels these pages mention,
  with the translations XWiki's UI catalogue holds for them. Where several are listed, they come
  from different screens: pick the one that fits the context (the first is the most frequent), and
  if none fits -- a lookup can match a sentence fragment -- translate freely. A translation marked
  "{older_ui}" is what the {lang} UI showed before that English label was renamed. Where a page
  describes a rename ("previously called ...", "before 17.8.0 ..."), quote it (without the mark) for
  the old label. If none is listed, the {lang} label may never have changed: quote that passage's
  English labels as they are:

{terms}

- Terms already chosen for this book (reuse them exactly):

{glossary}

- When you have to choose the translation of a recurring XWiki concept (e.g. "Page", "Space",
  "Wiki", "Macro") that is not listed above, add it to `{glossary_path}` as
  `"<English>": "<translation>"` (read-modify-write the JSON; another translator may be writing it
  too, so re-read it just before writing) and use it consistently. Before choosing, look the
  concept up in the UI labels above: a word the {lang} UI already uses for it is the one to take.
- Never change or remove an entry that is already in that file, even one you would word
  differently: other translators working at the same time have used it. Where the file (re-read
  just before writing) has gained an entry for a term your pages use, switch your pages to it.
- Where a book term contradicts the UI labels above, the UI wins in your pages (the reader sees
  the screen); name the contradiction in your reply, and leave the file alone.

## Style

Natural, idiomatic {lang} technical documentation, formal register (for German: "Sie"), the
imperative for steps. Keep the typography of the target language (for German: „…" quotes around
UI labels; for French: « … » with a non-breaking space, U+00A0, inside).
"""


def cmd_prompt(s, args):
    batches = s.load('batches.json', {})
    chunks = batches.get(args.task)
    if not chunks:
        raise SystemExit(f'no chunks for task {args.task} (have: {", ".join(batches) or "none"})')
    state = s.load('state.json', {})
    glossary = s.load(f'glossary.{s.lang}.json', {})
    os.makedirs(s.path('prompts'), exist_ok=True)
    os.makedirs(s.path('translated'), exist_ok=True)
    for j, chunk in enumerate(chunks, 1):
        refs = [r for r in chunk if not args.failed or needs_translation(s, state, r)]
        if not refs:
            continue
        pages = '\n'.join(f'- `{s.path("source", file_key(state[r]["key"]))}` -> '
                          f'`{s.path("translated", file_key(state[r]["key"]))}`' for r in refs)
        terms = terms_for(s, refs)
        body = PROMPT.format(
            lang=s.lang, older_ui=OLDER_UI, pages=pages, glossary_path=s.path(f'glossary.{s.lang}.json'),
            terms='\n'.join(f'  - "{e}" -> ' + ' / '.join(f'"{v}"' for v in vs) for e, vs in sorted(terms.items()))
            or '  (none found)',
            glossary='\n'.join(f'  - "{e}" -> "{v}"' for e, v in sorted(glossary.items())) or '  (none yet)')
        p = s.path('prompts', f'{args.task}-chunk{j}.md')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(body)
        print(p)
    return 0


# Words that are not also common words of the usual target languages ("in", "an", "will" are German).
STOP_EN = set('the and of to is for you that with this are on be it can as or by from your which when '
              'not have if its at use their'.split())


def skeleton(root):
    out = []
    for n in root.elements():
        if n.tag == '#root':
            continue
        out.append((n.tag, n.attrs.get('id'), n.attrs.get('href'), n.attrs.get('src'), n.attrs.get('class')))
    return out


def verbatim(root):
    return [n.textcontent() for n in root.elements()
            if n.tag in ('pre', 'code') or n.has_class('monospace') or n.has_class('key')]


def check_page(src_html, tr_html):
    src, tr = parse(src_html), parse(tr_html)
    a, b = skeleton(src), skeleton(tr)
    if len(a) != len(b):
        return f'{len(b)} elements instead of {len(a)}'
    for i, (p, q) in enumerate(zip(a, b)):
        if p != q:
            return f'element {i} differs: {p} vs {q}'
    if verbatim(src) != verbatim(tr):
        return 'the content of a pre/code/monospace/key element changed'
    words = [w for n in tr.walk() if n.text and not _in_verbatim(n)
             for w in re.findall(r"[A-Za-z']+", n.text.lower())]
    if len(words) > 60:
        ratio = sum(w in STOP_EN for w in words) / len(words)
        if ratio > 0.12:
            return f'still mostly English ({ratio:.0%} English stop words)'
    return None


def _in_verbatim(n):
    p = n.parent
    while p is not None:
        if p.tag in ('pre', 'code') or p.has_class('monospace') or p.has_class('key'):
            return True
        p = p.parent
    return False


def cmd_check(s, args):
    state = s.load('state.json', {})
    refs = args.refs or [r for c in s.load('batches.json', {}).get(args.task or '', []) for r in c]
    if not refs:
        raise SystemExit('nothing to check -- pass --task NN or page references')
    ok, failed, missing = 0, [], []
    for r in refs:
        st = state.get(r)
        if st is None:
            failed.append((r, 'not in the export'))
            continue
        try:
            with open(s.path('translated', file_key(st['key'])), encoding='utf-8') as f:
                tr = f.read()
        except FileNotFoundError:
            missing.append(r)
            continue
        with open(s.path('source', file_key(st['key'])), encoding='utf-8') as f:
            src = f.read()
        why = check_page(src, tr)
        if why:
            failed.append((r, why))
            st.pop('translatedFromHash', None)
        else:
            st['translatedFromHash'] = st['sourceHash']
            ok += 1
    s.save('state.json', state)
    print(f'{ok} passed, {len(failed)} failed, {len(missing)} not written')
    for r, why in failed:
        print(f'  FAIL {r}: {why}')
    for r in missing:
        print(f'  MISSING {r}')
    return 1 if failed or missing else 0


def cmd_todo(s, args):
    manifest = s.load('manifest.json') or {'pages': []}
    state = s.load('state.json', {})
    unfetched = [p['ref'] for p in manifest['pages'] if state.get(p['ref'], {}).get('fetchedVersion') != p['version']]
    untranslated = [p['ref'] for p in manifest['pages'] if needs_translation(s, state, p['ref'])]
    unknown = s.load('unknown-blocks.json', {})
    print(f'{len(manifest["pages"])} pages: {len(unfetched)} to fetch, {len(untranslated)} to translate, '
          f'{len(unknown)} unreviewed block class(es)')
    for r in (unfetched + untranslated)[:30]:
        print('  ' + r)
    return 0


# --------------------------------------------------------------------------------------------------
# build

def find_chrome():
    for c in (os.environ.get('CHROME'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Chromium.app/Contents/MacOS/Chromium', shutil.which('google-chrome'),
              shutil.which('google-chrome-stable'), shutil.which('chromium'), shutil.which('chromium-browser'),
              shutil.which('chrome')):
        if c and os.path.exists(c):
            return c
    return None


def print_pdf(chrome, html_path, pdf_path):
    # Success is judged on the output file, not the exit code: headless Chrome on macOS can write the
    # whole PDF and then exit non-zero from a teardown watchdog.
    if os.path.exists(pdf_path):
        os.remove(pdf_path)
    r = subprocess.run([chrome, '--headless', '--disable-gpu', '--no-pdf-header-footer',
                        '--generate-pdf-document-outline', '--run-all-compositor-stages-before-draw',
                        '--allow-file-access-from-files', f'--print-to-pdf={pdf_path}',
                        'file://' + urllib.parse.quote(html_path)],
                       capture_output=True, text=True, timeout=600)
    if not os.path.exists(pdf_path) or os.path.getsize(pdf_path) == 0:
        raise SystemExit(f'Chrome failed to print (exit {r.returncode}): {r.stderr[-800:]}')


def marker_pages(pdf_path, count):
    """Physical page of each chapter marker, read back with pdftotext (poppler)."""
    r = subprocess.run(['pdftotext', '-enc', 'UTF-8', pdf_path, '-'], capture_output=True, text=True)
    pages = {}
    for i, text in enumerate(r.stdout.split('\f'), 1):
        for m in re.finditer(r'XDXM(\d+)X', text.replace(' ', '')):
            pages.setdefault(int(m.group(1)), i)
    return pages


def resolve_links(root, key, keys_by_ref):
    """Prefix ids with the page key and point `ref:` links inside the book, or back to the site."""
    for n in root.elements():
        if 'id' in n.attrs:
            n.attrs['id'] = f'{key}--{n.attrs["id"]}'
        href = n.attrs.get('href') if n.tag == 'a' else None
        if not href:
            continue
        if href.startswith('#'):
            n.attrs['href'] = f'#{key}--{href[1:]}'
        elif href.startswith('ref:'):
            ref, _, frag = href[4:].partition('#')
            if ref in keys_by_ref:
                k = keys_by_ref[ref]
                n.attrs['href'] = f'#{k}--{frag}' if frag else f'#{k}'
            else:
                n.attrs['href'] = x.viewurl(ref) + ('#' + frag if frag else '')
                n.attrs['class'] = (n.attrs.get('class', '') + ' ext').strip()
        elif href.startswith('http'):
            n.attrs['class'] = (n.attrs.get('class', '') + ' ext').strip()


LAYOUT = {'medium': ('print', 'screen'), 'page_break': ('topic', 'page')}


def set_layout(cfg, args):
    """The book's layout choices, asked once and kept with the export (see SKILL.md):
    - medium: `print` spells out the URL of every link that leaves the book, since paper cannot be
      clicked; `screen` keeps links clickable and the text clean.
    - page_break: `topic` starts each top-level topic on a new page, `page` every documentation page."""
    for k, allowed in LAYOUT.items():
        v = getattr(args, k, None)
        if v:
            cfg[k] = v
        cfg.setdefault(k, allowed[0])


def image_size(path):
    """(width, height) of a PNG, GIF or JPEG from its header, or None."""
    try:
        with open(path, 'rb') as f:
            d = f.read(64 * 1024)
    except OSError:
        return None
    if d[:8] == b'\x89PNG\r\n\x1a\n':
        return int.from_bytes(d[16:20], 'big'), int.from_bytes(d[20:24], 'big')
    if d[:6] in (b'GIF87a', b'GIF89a'):
        return int.from_bytes(d[6:8], 'little'), int.from_bytes(d[8:10], 'little')
    if d[:2] == b'\xff\xd8':
        i = 2
        while i + 9 < len(d):
            if d[i] != 0xFF:
                i += 1
                continue
            marker, seglen = d[i + 1], int.from_bytes(d[i + 2:i + 4], 'big')
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                return int.from_bytes(d[i + 7:i + 9], 'big'), int.from_bytes(d[i + 5:i + 7], 'big')
            i += 2 + seglen
    return None


def classify_images(s, article):
    """Every screenshot gets a border, whether or not its page used the image macro that draws one
    on xwiki.org. Diagrams and small inline icons do not."""
    for img in (n for n in article.elements() if n.tag == 'img'):
        cls = img.classes()
        if 'diagram' in cls:
            continue
        size = image_size(s.path(img.attrs.get('src', '')))
        kind = 'icon' if size and (size[0] < 64 or size[1] < 32) else 'shot'
        img.attrs['class'] = ' '.join(cls + [kind])


def cover_html(title, root_ref, labels, today):
    """The first page. It names no XWiki version: the book is what xwiki.org showed on the export
    date, and the documentation there is not tied to one release."""
    return (f'<section class="cover"><h1 class="book-title">{html.escape(title)}</h1>'
            f'<p class="book-sub">{html.escape(labels["cover_subtitle"])}</p>'
            f'<dl><dt>{html.escape(labels["cover_source"])}</dt><dd>{html.escape(x.viewurl(root_ref))}</dd>'
            f'<dt>{html.escape(labels["cover_date"])}</dt><dd>{today}</dd></dl></section>')


def cmd_build(s, args):
    manifest = s.load('manifest.json')
    if not manifest:
        raise SystemExit('no manifest -- run scan and fetch first')
    chrome = find_chrome()
    if not chrome:
        raise SystemExit('no Chrome/Chromium found -- install one or point CHROME at its binary')
    state = s.load('state.json', {})
    problems = []
    unknown = s.load('unknown-blocks.json', {})
    if unknown:
        problems.append(f'{len(unknown)} unreviewed block class(es): {", ".join(sorted(unknown)[:8])}')
    if s.translating:
        pending = [p['ref'] for p in manifest['pages'] if needs_translation(s, state, p['ref'])
                   or not state.get(p['ref'], {}).get('translatedFromHash')]
        if pending:
            problems.append(f'{len(pending)} page(s) not translated and checked, e.g. {pending[0]}')
    stored = s.load(f'labels.{s.lang}.json')
    if s.translating and not labels_ready(stored):
        problems.append(f'labels.{s.lang}.json is not translated, or lacks labels -- run glossary, then '
                        'translate what it added')
    labels = dict(LABELS, **(stored or {}))
    if problems:
        raise SystemExit('cannot build:\n  ' + '\n  '.join(problems))

    pages = manifest['pages']
    keys_by_ref = {p['ref']: p['key'] for p in pages}
    folder = 'translated' if s.translating else 'source'
    chapters, titles = [], {}
    for i, p in enumerate(pages):
        with open(s.path(folder, file_key(p['key'])), encoding='utf-8') as f:
            root = parse(f.read())
        article = next(n for n in root.children if n.tag == 'article')
        title = next((n for n in article.elements() if n.has_class('page-title')), None)
        titles[p['ref']] = title.textcontent().strip() if title is not None else p['title']
        meta = next((n for n in article.elements() if n.has_class('page-meta')), None)
        if meta is not None:
            if s.translating:
                with open(s.path('source', file_key(p['key'])), encoding='utf-8') as f:
                    source_meta = next(n for n in parse(f.read()).elements() if n.has_class('page-meta'))
            else:
                source_meta = meta
            meta.children = []
            meta.append(Node(text=localized_meta(source_meta.textcontent().strip(), labels)))
        chapters.append((p, root, article, title))

    body = []
    for i, (p, root, article, title) in enumerate(chapters):
        depth = max(p['depth'], 1)
        resolve_links(root, p['key'], keys_by_ref)
        # The tag follows the tree depth (it builds the PDF outline); the look follows the level
        # within the page, so a deep page's title still stands out from its own sections.
        for n in article.elements():
            m = re.match(r'^h([1-6])$', n.tag or '')
            if m:
                n.attrs['class'] = ' '.join(n.classes() + [f'rel-{m.group(1)}'])
                n.tag = 'h' + str(min(int(m.group(1)) + depth - 1, 6))
        if title is not None:
            title.attrs['id'] = p['key']
            if p['depth'] == 0:
                title.remove()                         # the root's title is the book's title
            else:
                title.append(el('span', {'class': 'marker'}, f'XDXM{i}X'))
        for slot in [n for n in article.elements() if n.has_class('in-this-section')]:
            if p['children'] and p['depth'] > 0:
                ul = el('ul')
                for c in p['children']:
                    ul.append(el('li', None, el('a', {'href': '#' + keys_by_ref[c]}, titles[c])))
                slot.children = []
                slot.append(el('p', {'class': 'its-label'}, labels['in_this_section']))
                slot.append(ul)
            else:
                slot.remove()
        classify_images(s, article)
        article.attrs['class'] = f'depth-{p["depth"]}'
        body.append(serialize(article))

    def toc(numbers):
        items = []
        for i, (p, *_rest) in enumerate(chapters):
            if 1 <= p['depth'] <= args.toc_depth:
                num = str(numbers.get(i, '')) if numbers is not None else ''
                items.append(f'<li class="toc-{p["depth"]}"><a href="#{p["key"]}">'
                             f'{html.escape(titles[p["ref"]])}</a><span class="toc-page">{num}</span></li>')
        return f'<nav class="toc"><h1>{html.escape(labels["contents"])}</h1><ul>{"".join(items)}</ul></nav>'

    cfg = s.load('export.json') or {}
    set_layout(cfg, args)
    s.save('export.json', cfg)
    body_class = f'medium-{cfg["medium"]} break-{cfg["page_break"]}'
    root_page = pages[0]
    today = datetime.date.today().isoformat()
    cover = cover_html(titles[root_page['ref']], root_page['ref'], labels, today)
    with open(os.path.join(HERE, 'print.css'), encoding='utf-8') as f:
        css = f.read()

    def document(numbers, markers):
        # The markers only exist in the first pass: left in, they would show up in the PDF outline
        # and in a text search of the book.
        chapters_html = ''.join(body)
        if not markers:
            chapters_html = re.sub(r'<span class="marker">XDXM\d+X</span>', '', chapters_html)
        return (f'<!DOCTYPE html><html lang="{s.lang}"><head><meta charset="utf-8">'
                f'<title>{html.escape(titles[root_page["ref"]])}</title><style>{css}</style></head>'
                f'<body class="{body_class}">{cover}{toc(numbers)}{chapters_html}</body></html>')

    os.makedirs(s.path('out'), exist_ok=True)
    book_html = s.path('book.html')
    pdf = s.path('out', f'{space_of(s.root)}-{s.lang}.pdf')
    with open(book_html, 'w', encoding='utf-8') as f:
        f.write(document({}, True))
    print_pdf(chrome, book_html, pdf)
    note = ''
    if shutil.which('pdftotext'):
        # Second pass: the markers of the first tell where each chapter landed. The TOC reserves the
        # same width for its numbers in both passes, so writing them in moves nothing.
        numbers = marker_pages(pdf, len(chapters))
        with open(book_html, 'w', encoding='utf-8') as f:
            f.write(document(numbers, False))
        print_pdf(chrome, book_html, pdf)
    else:
        with open(book_html, 'w', encoding='utf-8') as f:
            f.write(document(None, False))
        print_pdf(chrome, book_html, pdf)
        note = ' (no pdftotext: the Contents has links but no page numbers -- install poppler)'

    last = s.load('last-export.json')
    report = changes_report(last, manifest, state, today)
    with open(s.path('out', f'changes-{today}.md'), 'w', encoding='utf-8') as f:
        f.write(report)
    s.save('last-export.json', {'built': today, 'pages': [
        {'ref': p['ref'], 'version': p['version'], 'sourceHash': state.get(p['ref'], {}).get('sourceHash')}
        for p in pages]})
    print(f'PDF: {pdf} ({os.path.getsize(pdf) // 1024} KB, {len(pages)} pages of documentation, '
          f'{cfg["medium"]}, a new page per {cfg["page_break"]}){note}')
    print(f'changes: {s.path("out", f"changes-{today}.md")}')
    return 0


def changes_report(last, manifest, state, today):
    pages = manifest['pages']
    lines = [f'# Export of {manifest["root"]} ({manifest["lang"]}), {today}', '']
    if not last:
        lines.append(f'First export: {len(pages)} pages.')
        return '\n'.join(lines) + '\n'
    before = {p['ref']: p for p in last['pages']}
    now = {p['ref'] for p in pages}
    new = [p['ref'] for p in pages if p['ref'] not in before]
    changed = [p['ref'] for p in pages if p['ref'] in before
               and before[p['ref']].get('sourceHash') != state.get(p['ref'], {}).get('sourceHash')]
    deleted = [r for r in before if r not in now]
    lines.append(f'Since the export of {last.get("built")}: {len(new)} new, {len(changed)} changed, '
                 f'{len(deleted)} removed.')
    for label, refs in (('New', new), ('Changed', changed), ('Removed', deleted)):
        if refs:
            lines += ['', f'## {label}', ''] + [f'- {x.viewurl(r)}' for r in refs]
    return '\n'.join(lines) + '\n'


# --------------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)

    def add(name, **kw):
        p = sub.add_parser(name, **kw)
        p.add_argument('--root', required=True, help='e.g. documentation.xs.user')
        p.add_argument('--lang', required=True, help='target language code; en = no translation')
        p.add_argument('--dir', help='state directory (default: under the work directory)')
        return p

    p = add('scan')
    p.add_argument('--exclude', action='append', help='a page whose whole subtree is left out')
    p.add_argument('--medium', choices=LAYOUT['medium'], help='print: URLs of outside links spelled out')
    p.add_argument('--page-break', choices=LAYOUT['page_break'], help='new PDF page per topic or per page')
    p.add_argument('--ignore-mismatch', action='store_true')
    p = add('fetch')
    p.add_argument('--all', action='store_true', help='re-fetch every page (after a print-rule change)')
    p = add('glossary')
    p.add_argument('--platform', help='xwiki-platform checkout at the version xwiki.org runs')
    p = add('plan')
    p.add_argument('--chunk-bytes', type=int, default=30000,
                   help='transformed source bytes per translator subagent (20 KB measured at ~77k subagent tokens)')
    p.add_argument('--chunks-per-session', type=int, default=8)
    p.add_argument('--force', action='store_true')
    p = add('prompt')
    p.add_argument('--task', required=True)
    p.add_argument('--failed', action='store_true')
    p = add('check')
    p.add_argument('--task')
    p.add_argument('refs', nargs='*')
    add('todo')
    p = add('accept-class')
    p.add_argument('classes', nargs='+')
    p = add('build')
    p.add_argument('--toc-depth', type=int, default=3)
    p.add_argument('--medium', choices=LAYOUT['medium'], help='override the export\'s choice (and keep it)')
    p.add_argument('--page-break', choices=LAYOUT['page_break'], help='override the export\'s choice (and keep it)')

    args = ap.parse_args()
    s = State(args)
    return {'scan': cmd_scan, 'fetch': cmd_fetch, 'glossary': cmd_glossary, 'plan': cmd_plan,
            'prompt': cmd_prompt, 'check': cmd_check, 'todo': cmd_todo,
            'accept-class': cmd_accept_class, 'build': cmd_build}[args.cmd](s, args)


if __name__ == '__main__':
    sys.exit(main())
