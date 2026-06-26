---
name: xwiki-contrib-release-blog-post
description: Announce an xwiki-contrib extension release by creating the "<Extension> Extension <version> Released" blog post on the xwiki.org Blog, following the contrib release-documentation convention (page name, title, content/summary templates, categories, publish date). Use after releasing an xwiki-contrib extension (groupId org.xwiki.contrib) when the blog-post step of the release documentation still needs doing. This is for contributed extensions only — not core xwiki-platform releases. For writing/reviewing general documentation pages use xwiki-documentation instead; for deploying a XAR/JAR to a running instance use xwiki-deploy-extension.
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

Browser mechanics (open/snapshot/fill/click) are handled by the **agent-browser** skill — load it
for the how-to of driving Chrome; this skill covers only the XWiki-specific content and the gotchas.

## 1. Gather the release facts

From the extension page on the Extensions wiki (e.g.
`https://extensions.xwiki.org/xwiki/bin/view/Extension/<ExtensionSpace>/`) collect:

- **Extension name** — the human title (e.g. "Wiki Link URL Normalizer").
- **Extension space path** — the nested path after `Extension/` in the URL (usually a single
  segment, e.g. `WikiLinkURLNormalizer`). Used to build the reference
  `extensions:Extension.<space path>.WebHome`.
- **Released version** and **release date**.
- **What changed** in this version — read the version's row/release notes. Each version now has a
  dedicated page at
  `https://extensions.xwiki.org/xwiki/bin/view/Extension/<ExtensionSpace>/Versions/<version>/`
  (reference `extensions:Extension.<space path>.Versions.<version>.WebHome`). The JIRA issues listed
  there (e.g. "Add support for local URL fragments", "Depend on XWiki 15.10+") are the basis for the
  release text and any minimal-version change.

## 2. Page name and title

- **Title:** `<Extension name> Extension <version> Released` — e.g.
  `Wiki Link URL Normalizer Extension 1.10.0 Released`.
- **Page name:** lowercase kebab-case `<extension>-extension-<version>-released`. The Blog quick-add
  form turns spaces **and dots** into dashes and keeps the original case, so it produces a
  capitalized name like `Wiki-Link-URL-Normalizer-Extension-1-10-0-Released` — **not** what we want.
  Instead create the page with a controlled name by opening the edit URL directly (nested page,
  matching recent posts such as `guided-tour-extension-0-1-released`):

  ```
  https://www.xwiki.org/xwiki/bin/edit/Blog/<page-name>/WebHome?template=Blog.BlogPostTemplate&parent=Blog.WebHome&title=<URL-encoded title>&Blog.BlogPostClass_0_title=<URL-encoded title>
  ```

  with `<page-name>` = `wiki-link-url-normalizer-extension-1-10-0-released` (lowercase, dots → dashes).

## 3. Content and summary templates (XWiki 2.1 syntax)

The post's text + metadata live in a `Blog.BlogPostClass` xobject. Fill **both** the content and the
summary/extract fields. Use these templates (the version link points to the **dedicated version
page** — the older guide pointed it at a no-longer-existing `anchor="H<version>"` on the extension
homepage):

**Content:**

```
The [[<extension name>>>doc:extensions:Extension.<space path>.WebHome]] [[<version>>>doc:extensions:Extension.<space path>.Versions.<version>.WebHome]] has been released.

<one or two sentences describing what this release adds/changes>
```

**Summary / extract** (same lead sentence, condensed on one paragraph):

```
The [[<extension name>>>doc:extensions:Extension.<space path>.WebHome]] [[<version>>>doc:extensions:Extension.<space path>.Versions.<version>.WebHome]] has been released. <short description>
```

**Escape the dots in `<version>`** — `.` is the entity separator in XWiki references, so version
`1.10.0` must be written `1\.10\.0`. Example version link:

```
[[1.10.0>>doc:extensions:Extension.WikiLinkURLNormalizer.Versions.1\.10\.0.WebHome]]
```

`extensions:` is the cross-wiki prefix (the Blog is on the `xwiki` wiki, versions on the
`extensions` wiki — same farm, so `doc:` references resolve).

## 4. Categories

Tick **all six** (these also push the announcement to the "What's New" feed of every XWiki instance):

- `Releases`
- `Extensions`
- `Contrib`
- `What's New for XWiki`
- `What's New for XWiki: Admin User`
- `What's New for XWiki: Extension`

## 5. Publish and date

- Check the **Publish** checkbox (so it publishes when saved).
- Set **Publish date** to the actual release date (form format `dd/mm/yyyy hh:mm:ss`), unless the
  user wants the posting date.

## 6. Create it in the browser

Use the **agent-browser** skill. Key gotchas learned the hard way:

- **Login required.** Creating a blog post needs an authenticated xwiki.org account with blog-post
  permissions. If not logged in, have the user log in in the visible window.
- **agent-browser launches headless (invisible) by default.** If the user needs to see the page /
  click Save themselves, launch a **visible** window: `agent-browser --headed --session <name>
  open …`. A pre-existing headless daemon for the default session will ignore `--headed`, so use a
  fresh `--session` (and `close --all` / kill stragglers if needed). Transfer an existing login into
  the new session with `state save <file>` from the logged-in session then `--state <file>` on the
  headed launch.
- **Enter wiki syntax via Source mode.** The content and summary fields are CKEditor; click each
  field's **"Source"** button, then `fill` the resulting textarea with the wiki-syntax template.
- Check the 6 category checkboxes, the Publish checkbox, and set the publish date.

## 7. Verify, then hand off

- Use the editor's **Preview** to confirm the links resolve: the version link `href` must point to
  `…/Extension/<ExtensionSpace>/Versions/<version>/` and there must be **no rendering errors**
  (`.xwikirenderingerror`). Click **"Back To Edit"** to return.
- **Do not Save unless asked.** The default is to leave the form fully filled and let the user
  review and press **Save** / **Save & View** themselves. Save automatically only when the user
  explicitly tells you to.

## Worked example (Wiki Link URL Normalizer 1.10.0)

- Title: `Wiki Link URL Normalizer Extension 1.10.0 Released`
- Page: `Blog.wiki-link-url-normalizer-extension-1-10-0-released`
- Content:
  ```
  The [[Wiki Link URL Normalizer>>doc:extensions:Extension.WikiLinkURLNormalizer.WebHome]] [[1.10.0>>doc:extensions:Extension.WikiLinkURLNormalizer.Versions.1\.10\.0.WebHome]] has been released.

  This version adds support for normalizing local URLs that contain anchors (URL fragments). It now requires XWiki 15.10 or later.
  ```
- Categories: the six in step 4. Publish: on. Date: `11/06/2026 12:00:00`.
