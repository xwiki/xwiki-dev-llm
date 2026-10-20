---
name: xwiki-contrib-release-blog-post
description: Announce an xwiki-contrib extension release by creating the "<Extension> Extension <version> Released" blog post on the xwiki.org Blog, following the contrib release-documentation convention (page name, title, content/summary templates, categories, publish date). Use after releasing an xwiki-contrib extension (groupId org.xwiki.contrib) when the blog-post step of the release documentation still needs doing (the release itself is xwiki-contrib-release). This is for contributed extensions only — not core xwiki-platform releases; for the release notes and issue documentation of a core release use xwiki-release-documentation. For writing/reviewing general documentation pages use xwiki-doc-writing instead; for deploying a XAR/JAR to a running instance use xwiki-deploy-extension.
---

# Announce an xwiki-contrib extension release on the xwiki.org Blog

This skill creates the release-announcement blog post on the **xwiki.org Blog** for an
**xwiki-contrib** extension (the "Documentation" step of releasing a contrib project). It applies to
contributed extensions published under the `org.xwiki.contrib` Maven groupId and listed on the
Extensions wiki — not to core xwiki-platform releases, which have their own release-notes process.

The authoritative source of truth is the **Release → Documentation** section of the contrib guide:
https://contrib.xwiki.org/xwiki/bin/view/Main/WebHome#HDocumentation — when a detail here is
unclear or looks outdated, consult that page and prefer it. The templates below already incorporate
one fix the live guide was missing (the per-version page link, see step 3).

The post is created over the **xwiki.org REST API**, never by driving the editor in a browser, and
saved **unpublished**: the developer verifies it, then edits or publishes it (step 6).

## 1. Gather the release facts

From the extension page on the Extensions wiki (e.g.
`https://extensions.xwiki.org/xwiki/bin/view/Extension/<ExtensionSpace>/`) collect:

- **Extension name** — the human title (e.g. "Wiki Link URL Normalizer").
- **Extension space path** — the nested path after `Extension/` in the URL (usually a single
  segment, e.g. `WikiLinkURLNormalizer`). Used to build the reference
  `extensions:Extension.<space path>.WebHome`.
- **Extension type** — shown in the extension's metadata on the page. Most extensions are type
  "Extension" or "Application"; some multi-module projects are type **"Project"**. The templates
  of step 3 are the same for both. The type only decides which page you announce:
  - **Announce the top-level Project page, not a child module page.** A multi-module Project (e.g.
    `Extension/Documentation/`, type "Project") aggregates child pages such as
    `Extension/Documentation/DocumentationApplication/` (type "Application/XAR"). The release
    announcement targets the **top-level Project** page — its space path is the single segment
    (`Documentation`), and the child pages are *not* what you link to. Confirm the type on the page
    you intend to announce; if it says "Application"/"XAR" but sits under a "Project", step up to the
    parent.
- **Released version** and **release date**.
- **What changed** in this version: each version, of a Project as well as of an
  Extension/Application, has a dedicated page at
  `https://extensions.xwiki.org/xwiki/bin/view/Extension/<ExtensionSpace>/Versions/<version>/`
  (reference `extensions:Extension.<space path>.Versions.<version>.WebHome`), the one linked from the
  Version column of the page's Versions table. Its release notes (the JIRA issues of the fix
  version, or the OpenProject work packages copied there at release time) are the basis for the
  release text and any minimal-version change. Complete them with the git log
  (`git log --oneline <prev-tag>..<release-tag>`) when a note is too terse to explain the change.

## 2. Page name and title

- **Title:** `<Extension name> Extension <version> Released` — e.g.
  `Wiki Link URL Normalizer Extension 1.10.0 Released`.
- **Page name:** lowercase kebab-case `<extension>-extension-<version>-released`, with the version
  **kept as is, dots included** — the contrib guide's own example is `blog-extension-1.5-released`,
  so `documentation-extension-1.15-released`, never `…-1-15-released`. Step 5 creates it over REST
  as the nested page `Blog.<page-name>.WebHome`, e.g.
  `wiki-link-url-normalizer-extension-1.10.0-released` (lowercase, dots kept). In a URL the dots
  stay plain; in a wiki *reference* to the page they are escaped
  (`Blog.wiki-link-url-normalizer-extension-1\.10\.0-released.WebHome`).

## 3. Content and summary templates (XWiki 2.1 syntax)

The post's text + metadata live in a `Blog.BlogPostClass` xobject. Fill **both** the content and the
summary/extract fields.

**Present the changes as a bullet list** in the *content* field (one `*` bullet per change — bug fix,
feature, or minimal-version bump), following the intro sentence. The *summary/extract* field stays a
single flowing sentence — no bullet list there.

The version link points to the **dedicated version page** (the older guide pointed it at a
no-longer-existing `anchor="H<version>"` on the extension homepage). This holds for a Project too:
its Versions section is a Live Data table with no per-version heading, so a `#H<version>` anchor
lands nowhere.

**Content:**

```
The [[<extension name>>>doc:extensions:Extension.<space path>.WebHome]] [[<version>>>doc:extensions:Extension.<space path>.Versions.<version>.WebHome]] has been released.

This release brings the following changes:

* <change 1>
* <change 2>
* <...one bullet per change; last one is the minimal-version bump if any>
```

**Summary / extract:**

```
The [[<extension name>>>doc:extensions:Extension.<space path>.WebHome]] [[<version>>>doc:extensions:Extension.<space path>.Versions.<version>.WebHome]] has been released. <one-sentence description>
```

**Escape the dots in `<version>`** — `.` is the entity separator in XWiki references, so version
`1.10.0` must be written `1\.10\.0`. Example version link:

```
[[1.10.0>>doc:extensions:Extension.WikiLinkURLNormalizer.Versions.1\.10\.0.WebHome]]
```

`extensions:` is the cross-wiki prefix (the Blog is on the `xwiki` wiki, versions on the
`extensions` wiki — same farm, so `doc:` references resolve).

When the extension's name reads awkwardly on its own, add the word "extension" after the link —
e.g. `The [[Documentation>>doc:extensions:Extension.Documentation.WebHome]] extension
[[1.15>>doc:extensions:Extension.Documentation.Versions.1\.15.WebHome]] has been released.`

## 4. Categories

Tick **all six** (these also push the announcement to the "What's New" feed of every XWiki instance):

- `Releases`
- `Extensions`
- `Contrib`
- `What's New for XWiki`
- `What's New for XWiki: Admin User`
- `What's New for XWiki: Extension`

## 5. Save it unpublished over REST

Write as the developer's xwiki.org account (`okf/servers/index.md`; the `xwiki-doc-writing`
`tools/xwikidoc.py` client handles the auth and the form token), on
`https://www.xwiki.org/xwiki/rest/wikis/xwiki/spaces/Blog/spaces/<page-name>/pages/WebHome`. Build
that URL yourself: a helper splitting a reference on `.` cuts the dotted page name in two.

1. Check it answers `404`, so no existing post is overwritten.
2. `PUT` the page, form-encoded: `title`, `parent=Blog.WebHome`, `syntax=xwiki/2.1`, an empty
   `content` (the post lives in its object, as in published posts) and `hidden=true`.
3. `POST …/objects` with `className=Blog.BlogPostClass` and `property#title`, `property#content`,
   `property#extract`, `property#published=0`, `property#hidden=1` and `property#publishDate` set to
   the release date as `dd/MM/yyyy HH:mm:ss`. Read the wiki syntax from files, never inline in the
   shell, which mangles quotes.
4. `PUT …/objects/Blog.BlogPostClass/0/properties/category` as `text/plain`, the six
   `Blog.Categories.<name>` values joined by `|`: repeating `property#category` in the POST keeps
   only the first.
5. Read every property back and compare it with what was sent.

Never write a macro name with its braces in the text: a literal `{{image}}` is *executed* and
renders an error box. Refer to macros in prose ("the image macro").

## 6. Verify, then hand off

- Fetch `https://www.xwiki.org/xwiki/bin/view/Blog/<page-name>/` as the developer: it shows
  "This blog post is not published yet.", no `.xwikirenderingerror`, the changes as a bullet list,
  and every link resolving (no `wikicreatelink`), the version link on
  `…/Extension/<ExtensionSpace>/Versions/<version>/`.
- **Never publish it.** Give the developer that URL and ask them to verify the post, then edit it
  or publish it themselves ("Edit", tick "Publish", "Save & View").

## Worked example (Wiki Link URL Normalizer 1.10.0)

- Title: `Wiki Link URL Normalizer Extension 1.10.0 Released`
- Page: `Blog.wiki-link-url-normalizer-extension-1.10.0-released`
- Content:
  ```
  The [[Wiki Link URL Normalizer>>doc:extensions:Extension.WikiLinkURLNormalizer.WebHome]] [[1.10.0>>doc:extensions:Extension.WikiLinkURLNormalizer.Versions.1\.10\.0.WebHome]] has been released.

  This release brings the following changes:

  * Adds support for normalizing local URLs that contain anchors (URL fragments)
  * Raises the minimal supported XWiki version to 15.10
  ```
- Categories: the six in step 4. Published: no (the developer publishes it). Date: `11/06/2026 12:00:00`.
- A **Project** type works the same way: the Documentation project 1.15 announcement links
  `[[1.15>>doc:extensions:Extension.Documentation.Versions.1\.15.WebHome]]`.
