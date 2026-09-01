---
name: xwiki-rest-api
description: Read from and write to a running XWiki instance over its REST API — get a page's content and its xobjects, update page content or object properties, create a new page (optionally with xobjects), and search pages with a Solr query. Use when the user wants to fetch/modify/create wiki pages or objects on a live XWiki (not the XAR source files on disk — for those use xwiki-xar-pages), or to run a Solr search via REST. For deploying a built XAR/JAR extension via the job REST API use xwiki-deploy-extension instead.
---

Interact with a running XWiki over its REST API using `curl`.

## Fundamentals

- **Base URL:** `http://<host>:<port>/xwiki/rest` — for local dev this is
  `http://localhost:8080/xwiki/rest`. If XWiki is deployed as the root webapp (e.g. the official
  Docker image), the `/xwiki` context is dropped: `http://<host>:<port>/rest`.
- **Auth:** HTTP Basic — `curl -u Admin:admin ...`. With no credentials you act as `XWiki.Guest`
  (read-only on public pages; writes get `401`). Always authenticate for write operations.
  For a **remote** instance (xwiki.org…), look for the `~/.xwiki-credentials` file before asking the
  developer for credentials — **never print that file**, source it inside each command; its format and
  the full rule are in `okf/servers/index.md`.
- **xwiki.org is behind Cloudflare:** `www.xwiki.org` and `extensions.xwiki.org` answer `403` to a
  `/xwiki/rest/…` request carrying a browser-like `User-Agent` (or none at all) — send the default
  `curl/8.x` UA and do not dress the request up as a browser (see [[servers/index]]).
- **Format:** responses are XML by default. Ask for JSON with `?media=json` on the URL **or** an
  `Accept: application/json` header. Send bodies with `-H "Content-Type: application/xml"` (or
  `application/x-www-form-urlencoded`).
- **Reference identifiers, not URLs, for reasoning:** a page reference like `Sandbox.WebHome` maps
  to path segments — see nested spaces below.
- **Nested spaces (important):** each space is its own `/spaces/{name}` segment. The page reference
  `A.B.C` is `spaces/A/spaces/B/pages/C`. In XWiki's nested model a "page" `A.B` is usually stored as
  `A.B.WebHome`, i.e. `spaces/A/spaces/B/pages/WebHome`. When unsure whether a page is terminal or
  nested, GET the space's pages list or try `.../pages/WebHome`.
- Response headers include `xwiki-version` (WAR version) and `xwiki-user` (the resolved user, absent
  for guest) — handy to confirm you authenticated as expected. Add `-i` to `curl` to see them.
- **CSRF form token (writes, XWiki 14.10.8+/15.2+):** a state-changing REST call whose body is
  `text/plain`, `multipart/form-data` or `application/x-www-form-urlencoded` needs a form token in
  the **`XWiki-Form-Token` request header**, or it fails with `403` and body `Invalid or missing form
  token.`. Every REST response returns the current token in that same `XWiki-Form-Token` header, so a
  cheap GET (e.g. `GET .../rest/wikis/xwiki`) yields one; read it and echo it back on the write:

  ```
  TOKEN=$(curl -s -I -u Admin:admin "http://localhost:8080/xwiki/rest/wikis/xwiki" \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="xwiki-form-token"{print $2}')
  curl -s -u Admin:admin -X POST -H "XWiki-Form-Token: $TOKEN" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "className=XWiki.TestClass" --data-urlencode "property#text=hi" \
    ".../pages/WebHome/objects"
  ```

  The token stays constant per server run but can rotate on restart — **retry once on `403`** with the
  token from the error response. Sending it when it isn't needed is harmless. An `application/xml`
  page `PUT` is exempt; form-encoded object `POST` and property writes are not. On **xwiki.org
  specifically**, the token cannot be scraped from a `/bin/edit` page — `/bin/` rejects Basic auth and
  returns the *guest* token; only `/rest` honors Basic auth, so obtain the token from a `/rest`
  response (see [[servers/index]]).

Path template used throughout (with `{S}` standing for the possibly-repeated `/spaces/{name}`
segments):

```
http://localhost:8080/xwiki/rest/wikis/{wiki}{S}/pages/{page}
```

`{wiki}` is normally `xwiki` on a default install.

## 1. Get page content (including xobjects)

Page (title, content, syntax, version, author…):

```
curl -s -u Admin:admin \
  "http://localhost:8080/xwiki/rest/wikis/xwiki/spaces/Sandbox/pages/WebHome?media=json"
```

All objects attached to the page:

```
curl -s -u Admin:admin \
  "http://localhost:8080/xwiki/rest/wikis/xwiki/spaces/Sandbox/pages/WebHome/objects?media=json"
```

One specific object (by class + number, usually `0` for the first) and its properties:

```
curl -s -u Admin:admin \
  ".../pages/WebHome/objects/XWiki.TestClass/0?media=json"
curl -s -u Admin:admin \
  ".../pages/WebHome/objects/XWiki.TestClass/0/properties?media=json"
```

A single property value: append `/properties/{propertyName}`.

**Two traps that return *empty* rather than failing**, so they read as "the page has no such field":

- **`<value>` is not the first child of `<property>`** — two `<link/>` elements come first, so a
  `<property name="…">\s*<value>` regex matches nothing and reports **every field as empty**. Match the
  whole `<property …>…</property>` block, then find `<value>` inside it. `?media=json` avoids this.
- **`GET …/objects` carries no property values** — only summaries. Fetch `…/objects/{Class}/{n}`.

## Enumerating the pages of a tree

**Enumerate by space prefix, not by asking for children.** `GET <space>/spaces` returns **the space
itself, not its sub-spaces**, the `query` endpoint rejects XWQL (`400`), and REST-created pages have an
**empty `parent`** — so any `parent`/`children` walk under-reports *silently*, looking complete. List
the pages explicitly and assert the expected count; cache the tree locally for repeated scans.

When merging object properties into page data, note that a class may define its own `content` property,
which then **clobbers the page content** — keep them under a separate key.

## 2. Write page changes (content, title) — update an existing page

PUT to the page URL. Three body formats are accepted; pick the simplest that fits.

Only the content (quickest), `text/plain`:

```
curl -s -u Admin:admin -X PUT \
  -H "Content-Type: text/plain" \
  --data-binary "New page content in {{/}} wiki syntax" \
  "http://localhost:8080/xwiki/rest/wikis/xwiki/spaces/Sandbox/pages/WebHome"
```

Title + content together, `application/x-www-form-urlencoded` (allowed fields: `title`, `parent`,
`content`):

```
curl -s -u Admin:admin -X PUT \
  --data-urlencode "title=Hello world" \
  --data-urlencode "content=This is **bold**." \
  "http://localhost:8080/xwiki/rest/wikis/xwiki/spaces/Sandbox/pages/WebHome"
```

Full control, `application/xml` — send a `<page>` element (only include the fields you want to set):

```xml
<page xmlns="http://www.xwiki.org">
  <title>Hello world</title>
  <syntax>xwiki/2.1</syntax>
  <content>This is a new page</content>
</page>
```

```
curl -s -u Admin:admin -X PUT -H "Content-Type: application/xml" \
  --data-binary "@page.xml" \
  "http://localhost:8080/xwiki/rest/wikis/xwiki/spaces/Sandbox/pages/WebHome"
```

Returns `201` if the page was created, `202` if updated, `304` if unchanged. Add
`?minorRevision=true` to record a minor version instead of a major one.

### Change xobject properties

Update all given properties of an existing object (PUT the object URL, form-encoded):

```
curl -s -u Admin:admin -X PUT \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "property#text=Updated value" \
  ".../pages/WebHome/objects/XWiki.TestClass/0"
```

Update a single property (PUT its property URL):

```
curl -s -u Admin:admin -X PUT \
  --data-urlencode "property#text=Updated value" \
  ".../pages/WebHome/objects/XWiki.TestClass/0/properties/text"
```

Delete an object with `-X DELETE` on the object URL (`204` on success).

### A `202` does not mean the write landed — always read it back

**Back-to-back writes to the same page can silently drop one**: a property `PUT` issued right after a
content `PUT` returned `202` and was **lost** (it read back empty, while properties written *after* it
stuck); re-issuing it a moment later stored it byte-for-byte. **Follow every write with a read-back
assert** and re-issue on mismatch. A rendered-page check is no substitute — a lost field that is not
displayed renders as nothing at all.

**A malformed property write also returns `202` — and blanks the property.** On the single-property
URL the form field must be named **`property#<name>`**, not `<name>`: sending `faq=…` instead of
`property#faq=…` is accepted, reports success, and leaves the property **empty**, destroying whatever
was there. The same happens with a `#`-less field name on the object URL. So the read-back assert is
not only about lost writes: it is the only thing standing between a wrong field name and silent data
loss on a live page. Sending the raw value as a `text/plain` body works too, and has no field name to
get wrong.

`hidden` is settable as a **plain form field** on the page `PUT` (alongside `content`, `title`,
`syntax`) — no separate object is needed.

## 3. Create a new page (optionally with xobjects)

Creating a page is the same PUT as updating one — PUT to a URL that does not yet exist. Any missing
parent spaces are created automatically.

```
curl -s -u Admin:admin -X PUT -H "Content-Type: application/xml" \
  --data-binary "@page.xml" \
  "http://localhost:8080/xwiki/rest/wikis/xwiki/spaces/Sandbox/spaces/New/pages/WebHome"
```

Then add one or more objects by POSTing to the page's `objects` collection.

Form-encoded (concise) — `className` plus `property#name=value` pairs:

```
curl -s -u Admin:admin -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "className=XWiki.TestClass" \
  --data-urlencode "property#text=Whatever you want" \
  ".../spaces/New/pages/WebHome/objects"
```

Or XML — POST an `<object>` element:

```xml
<object xmlns="http://www.xwiki.org">
  <className>XWiki.TestClass</className>
  <property name="text">
    <value>Whatever you want to put here</value>
  </property>
</object>
```

```
curl -s -u Admin:admin -X POST -H "Content-Type: application/xml" \
  --data-binary "@object.xml" \
  ".../spaces/New/pages/WebHome/objects"
```

`201` on creation; the `Location` response header holds the new object's URI (including its assigned
object number). Only the class's own properties are settable — the class must already exist.

## 4. Search pages with a Solr query

Query a single wiki (Solr is the default and only-by-default type since 17.10.5+ / 18.2.0+):

```
curl -s -u Admin:admin \
  "http://localhost:8080/xwiki/rest/wikis/xwiki/query?q=Sandbox&type=solr&number=10&media=json"
```

Useful parameters: `type={solr,hql,xwql,lucene}` (non-Solr types must be enabled via
`rest.allowedQueryTypes` in `xwiki.properties`), `number=n` (page size), `start=n` (offset),
`order={asc,desc}`, `prettyNames={true,false}`.

The `q` value is a Solr query. Filter by field, e.g. restrict to the Sandbox space and title text:

```
q=title:hello AND space:Sandbox
```

Search across several wikis at once with the root query resource and a `wikis` list:

```
curl -s -u Admin:admin \
  "http://localhost:8080/xwiki/rest/wikis/query?q=hello&wikis=xwiki,subwiki&number=10&media=json"
```

Results come back as `searchResults`/`searchResult` entries, each with the page's reference, title
and a link to its REST resource — feed that link back into use case 1 to fetch full content.

## Notes

- **Deleting a page over REST bypasses the deletion wizard** — no "New target"/"Update links"
  repointing, no automatic redirect — so on a real wiki the page's backlinks must be handled first, per
  the OKF's `conventions/page-deletion.md`.
- URL-encode reserved characters in page/space names (a space name with a dot, `/`, space, etc.).
  `curl --data-urlencode` handles bodies; encode path segments yourself.
- Editing **xwiki.org documentation** pages? The tree's own specifics — the `DocApp` xobjects, reading
  the doc-quality checker's findings, navigation pinning, hidden `{{display}}` fragments — are in the
  OKF's `conventions/documentation-mechanics.md`, not here. For more than a one-field edit, the
  `xwiki-doc-writing` skill ships a client and a publish/audit CLI in its `tools/` directory that
  already handle the traps below (session-bound token, read-back asserts) — prefer them over fresh
  `curl` calls.
- On a write failure, add `-i` and read the status line and `xwiki-user` header — a `401` almost
  always means you posted as guest (wrong/missing `-u`), a `403` means either the authenticated user
  lacks edit rights on that page or (body `Invalid or missing form token.`) a missing/stale CSRF
  token — see the `XWiki-Form-Token` note under Fundamentals.
- The XML representations conform to the [REST model XSD](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-rest/xwiki-platform-rest-model/src/main/resources/xwiki.rest.model.xsd);
  full endpoint reference: https://www.xwiki.org/xwiki/bin/view/Documentation/UserGuide/Features/XWikiRESTfulAPI
