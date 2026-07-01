---
title: Editing XAR wiki pages (xar:format / xar:verify)
stability: durable
summary: Extension wiki pages are XML files packaged in a XAR (xar-packaging module). After hand-editing
  a page XML, run `mvn xar:format` to normalize it; `mvn install`/`verify` runs `xar:verify`, which fails
  the build if pages break the conventions (version 1.1, authors, license, encoding, hidden/language rules…).
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/XARPlugin
---

# Editing XAR wiki pages

XWiki extensions ship wiki pages as XML files under `src/main/resources/` (directories match space
names), packaged into a **XAR** by a module with `<packaging>xar</packaging>`. These files are
maintained with the **XAR Maven plugin** (`xwiki-commons-tool-xar-plugin`).

## After editing: run `mvn xar:format`

Whenever you hand-edit a page XML, run `mvn xar:format` on that module (e.g.
`mvn -B -ntp xar:format -pl <the-xar-module>`). It normalizes the file so it stays canonical:

- Indents with 2 spaces.
- Sets `author`, `contentAuthor`, `creator` and attachment authors to `xwiki:XWiki.Admin`.
- Forces the document `<version>` to `1.1` and `minorEdit` to `false`.
- Empties `comment`; empties `defaultLanguage` for technical pages (kept for content/translatable pages).
- Removes `date` / `creationDate` / `contentUpdateDate` / attachment date fields (so users don't install
  pages carrying stale dates).
- Adds any missing LGPL license header (when `formatLicense` is enabled).
- Forces the XML declaration to version 1.1 and fixes malformed locales (`pt-BR` → `pt_BR`).

## The build verifies pages: `xar:verify`

`xar:verify` is bound to the `verify` phase, so a normal `mvn install` / `mvn verify` on a
xar-packaging module **fails the build** if any page breaks the conventions. It checks, among others:

- Encoding is UTF-8; authors are `xwiki:XWiki.Admin`; `comment` is empty; `minorEdit` is `false`.
- **`<version>` is `1.1`** (this is why extension pages always keep version 1.1 — see [[versioning]]).
- `defaultLanguage` empty for technical pages, non-empty (and matching the configured language) for
  content/translatable pages; `hidden` set correctly per page type.
- License headers present (when `formatLicense` is on); attachments have a mimetype.
- No `date` fields; `Translations` pages use `plain/1.0` syntax and have neither GLOBAL nor USER
  visibility; translated pages carry no attachment/object.

Skip it (rarely) with `-Dxar.verify.skip=true`.

## Page types (drive the format/verify language & hidden rules)

- **Technical** (default): `hidden`, empty `defaultLanguage`.
- **Content**: not hidden, non-empty `defaultLanguage`, can have translations.
- **Translatable**: technical page that can have translations — hidden, non-empty `defaultLanguage`
  (defaults to files matching `.*/.*Translations\.xml`).

Building a XAR module and the standard Maven commands are covered by the `xwiki-build` skill.
