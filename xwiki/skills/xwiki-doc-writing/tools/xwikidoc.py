# -*- coding: utf-8 -*-
"""REST client for the xwiki.org farm, sized for documentation work.

Why this exists rather than `curl` per call: the **form token is stored in the HTTP session**, so a
token scraped by one request is rejected by the next unless the session cookie travels with it. A
cookie-less client gets intermittent `403 Invalid or missing form token.` on object writes — passing
for a while, then failing, depending on which node answered. That single fact is most of this file.

Credentials come from the environment. Source the credentials file inside the command that runs a
tool, never print it:

    set -a; . ~/.xwiki-credentials; set +a; python3 docpages.py save

Environment:
    XWIKI_USER, XWIKI_PASSWORD   required
    XWIKI_BASE                   REST root of the main wiki (default www.xwiki.org's `xwiki`)
"""
import base64
import http.cookiejar
import json
import os
import urllib.error
import urllib.parse
import urllib.request

WWW = os.environ.get('XWIKI_BASE', 'https://www.xwiki.org/xwiki/rest/wikis/xwiki')
EXO = 'https://extensions.xwiki.org/xwiki/rest/wikis/extensions'
VIEW = 'https://www.xwiki.org/xwiki/bin/view/'

# xwiki.org REST sits behind Cloudflare: it answers 403 both to a request with no User-Agent and to
# one with a browser-like UA. A curl-style UA passes.
_UA = 'curl/8.0'
_JAR = http.cookiejar.CookieJar()
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_JAR))
_token = None


def _auth():
    try:
        user, password = os.environ['XWIKI_USER'], os.environ['XWIKI_PASSWORD']
    except KeyError:
        raise SystemExit('XWIKI_USER / XWIKI_PASSWORD are not set — source your credentials file '
                         'inside the command, e.g. `set -a; . ~/.xwiki-credentials; set +a; …`')
    return 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()


def pageurl(base, ref):
    """`a.b.c.WebHome` -> `<base>/spaces/a/spaces/b/spaces/c/pages/WebHome`.

    Each space is its own path segment; a "page" `A.B` is stored as `A.B.WebHome`.
    """
    parts = ref.split('.')
    return (base + ''.join('/spaces/' + urllib.parse.quote(s) for s in parts[:-1])
            + '/pages/' + urllib.parse.quote(parts[-1]))


def viewurl(ref):
    """Rendered-page URL of a nested `…WebHome` reference, as a reader sees it."""
    parts = ref.split('.')
    return VIEW + '/'.join(urllib.parse.quote(s) for s in parts[:-1]) + '/'


def call(url, method='GET', data=None, ctype=None, token=False, accept='application/json'):
    global _token
    headers = {'User-Agent': _UA, 'Authorization': _auth()}
    if accept:
        headers['Accept'] = accept
    if ctype:
        headers['Content-Type'] = ctype
    if token:
        headers['XWiki-Form-Token'] = get_token()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        r = _OPENER.open(req)
        body = r.read()
    except urllib.error.HTTPError as e:
        r, body = e, e.read()
    tok = r.headers.get('XWiki-Form-Token')
    if tok:
        _token = tok
    return getattr(r, 'status', None) or r.code, r.headers, body


def get_token(base=WWW):
    global _token
    if _token is None:
        call(base, accept=None)
    if _token is None:
        raise RuntimeError('no XWiki-Form-Token returned')
    return _token


def write(url, method, data=None, ctype=None, base=WWW):
    """State-changing call. On a token rejection, fetch a fresh one in the same cookie session and
    retry once — the token rotates on a server restart."""
    global _token
    st, h, b = call(url, method, data, ctype, token=True)
    if st == 403 and b'form token' in b:
        _token = None
        call(base, accept=None)
        st, h, b = call(url, method, data, ctype, token=True)
    return st, h, b


def getjson(url):
    sep = '&' if '?' in url else '?'
    st, _, b = call(url + sep + 'media=json')
    return (st, json.loads(b)) if st == 200 else (st, None)


def form(pairs):
    return urllib.parse.urlencode(pairs).encode()


def farm_wikis():
    """The wiki ids of the farm — what makes `doc:<wiki>:<ref>` the correct form of a cross-wiki
    link instead of an absolute URL (see okf/conventions/documentation.md)."""
    st, d = getjson(WWW.rsplit('/wikis/', 1)[0] + '/wikis')
    return [w['id'] for w in (d or {}).get('wikis', [])]


def put_page(base, ref, title=None, content=None, syntax=None, hidden=None):
    pairs = [(k, v) for k, v in (('title', title), ('content', content), ('syntax', syntax))
             if v is not None]
    if hidden is not None:
        pairs.append(('hidden', 'true' if hidden else 'false'))
    st, _, b = write(pageurl(base, ref), 'PUT', form(pairs),
                     'application/x-www-form-urlencoded', base)
    return st, b[:200]


def post_object(base, ref, classname, props):
    pairs = [('className', classname)] + [(f'property#{k}', v) for k, v in props.items()]
    st, h, b = write(pageurl(base, ref) + '/objects', 'POST', form(pairs),
                     'application/x-www-form-urlencoded', base)
    return st, h.get('Location'), b[:200]


def put_property(base, ref, classname, number, prop, value):
    """Write one property with a `text/plain` body — no field name to get wrong.

    On the form-encoded route the field must be `property#<name>`; a `#`-less name is accepted,
    reports success and leaves the property **empty**, which is why every write here is read back.
    """
    url = f'{pageurl(base, ref)}/objects/{classname}/{number}/properties/{prop}'
    st, _, b = write(url, 'PUT', value.encode('utf-8'), 'text/plain', base)
    return st, b[:200]


def put_object(base, ref, classname, number, props):
    """Write several properties of an existing object (the route that can also blank one)."""
    url = f'{pageurl(base, ref)}/objects/{classname}/{number}'
    st, _, b = write(url, 'PUT', form([(f'property#{k}', v) for k, v in props.items()]),
                     'application/x-www-form-urlencoded', base)
    return st, b[:200]


def get_object(base, ref, classname, number=0):
    st, d = getjson(f'{pageurl(base, ref)}/objects/{classname}/{number}')
    if st != 200:
        return st, None
    return st, {p['name']: p.get('value', '') for p in d.get('properties', [])}


def list_objects(base, ref):
    """(className, number) pairs. Note the summaries carry **no property values** — read each
    object individually."""
    st, d = getjson(pageurl(base, ref) + '/objects')
    if st != 200:
        return st, []
    return st, [(o['className'], o['number']) for o in d.get('objectSummaries', [])]


def list_attachments(base, ref):
    st, d = getjson(pageurl(base, ref) + '/attachments')
    if st != 200:
        return st, []
    return st, [(a['name'], a.get('size')) for a in d.get('attachments', [])]


def put_attachment(base, ref, name, path):
    with open(path, 'rb') as f:
        data = f.read()
    url = f'{pageurl(base, ref)}/attachments/{urllib.parse.quote(name)}'
    st, _, _ = write(url, 'PUT', data, 'application/octet-stream', base)
    return st, len(data)


def delete_attachment(base, ref, name):
    url = f'{pageurl(base, ref)}/attachments/{urllib.parse.quote(name)}'
    st, _, b = write(url, 'DELETE', base=base)
    return st, b[:200]


def tree_children(ref):
    """The document children of a page **in display order** — what the navigation panel will show.

    Reading `XWiki.PinnedChildPagesClass.pinnedChildPages` back only proves it was stored; this asks
    the tree macro what it will render. Non-document nodes (`attachments:…`, `translations:…`) are
    dropped: they are siblings of the real children in the response and would shift the order.
    """
    url = ('https://www.xwiki.org/xwiki/bin/get/XWiki/DocumentTree'
           '?outputSyntax=plain&data=children&limit=100&id=document:xwiki:' + ref)
    st, _, b = call(url, accept='*/*')
    if st != 200:
        return st, []
    return st, [(n['text'], n['id'][len('document:xwiki:'):]) for n in json.loads(b)
                if n['id'].startswith('document:xwiki:')]
