---
name: xwiki-xar-pages
description: Edit wiki pages shipped inside an XWiki extension's XAR — the .xml files under src/main/resources/ of a xar-packaging module. Use when hand-editing or adding an extension wiki page and you need the conventions and the mvn xar:format / xar:verify workflow (page version stays 1.1, authors, license, encoding, hidden/language rules per page type). For the i18n string content inside those pages use xwiki-translations; for the Maven commands use xwiki-build; to deploy the built XAR to a running instance use xwiki-deploy-extension.
---

# Editing XAR wiki pages

XWiki extensions ship wiki pages as XML files under `src/main/resources/` (directories match space
names), packaged into a **XAR** by a module with `<packaging>xar</packaging>`. These files are
maintained with the **XAR Maven plugin** (`xwiki-commons-tool-xar-plugin`).

## Page version stays `1.1` — never bump it

Each page XML carries a `<version>` element. **Always keep it at `<version>1.1</version>`; never
bump it when editing an extension's XAR page.** The extension's own (Maven) version is what tracks
changes across releases — the per-page XML `<version>` is not a changelog, and bumping it only
produces spurious diffs. `xar:verify` enforces this (it fails the build if a page's version is not
`1.1`).

This is unrelated to Java API `@since` / `@Deprecated` version tags (see the OKF `versioning`
convention).

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
- **`<version>` is `1.1`** (this is why extension pages always keep version 1.1 — see above).
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

## Related skills

- **xwiki-build** — the standard Maven commands and profiles for building a XAR module.
- **xwiki-translations** — editing `Translations` pages and i18n string content inside XAR pages
  (those pages are XAR pages, so this `xar:format` / `xar:verify` workflow applies to them too).
- **xwiki-deploy-extension** — deploy the built XAR/JAR to a running XWiki instance.

## References

- XAR Maven plugin: https://dev.xwiki.org/xwiki/bin/view/Community/XARPlugin
