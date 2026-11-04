---
title: Translation key lifecycle (en_US only, registration, deprecation, moving)
stability: durable
summary: Committers maintain only the en_US bundle (US spelling); translations ship inside the
  extension they translate and a new bundle must also be registered on l10n.xwiki.org + in the Weblate
  sync scripts; keys are never deleted or moved, only deprecated in place.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HTranslationBestPractices
  - https://dev.xwiki.org/xwiki/bin/view/Community/L10N/Conventions/
---

# Translation key lifecycle

The rendering and escaping side (how to output a translation safely, in which syntax) is the
`xwiki-translations` skill. This file is the lifecycle of the keys themselves.

## What committers maintain

- Only the **en_US** translation. The suffix-less file (`ApplicationResources.properties`, or the
  default `Translations` page) *is* en_US — so use US spelling: "customize", not "customise";
  "color", not "colour".
- All other languages are contributed by the community on **l10n.xwiki.org** (Weblate); do not hand-edit
  a translated file in git.

## Where a translation resource lives

- Translations belong to the **extension holding the content they translate**.
- Wiki-page content → a page named `Translations` (or `*Translations` when several are needed) in the
  application's space, registered with an `XWiki.TranslationDocumentClass` xobject. Special case: an
  extension made only of wiki macros, which live in the `Macros` space — its Translations page goes in
  that same space.
- `.vm` or Java content → `src/main/resources/ApplicationResources.properties` (so it lands at the jar
  root).
- A **new** resource must additionally be declared on l10n.xwiki.org **and** in the Weblate
  synchronization scripts, otherwise it never gets translated.
- Key names follow the L10N Conventions page (see `sources:`).

## Deprecating, renaming, never moving

- **Never delete a key in place.** Move it to the **deprecated section** at the end of the file, under
  a `## until <version that deprecated it>` header inside the `#@deprecatedstart` block (add the
  section if the file has none). This is a source-file convention only — the marker is not supported by
  the Weblate-based platform.
- **Renaming** = the same move, plus a `#@deprecated <new.key>` comment above the old key pointing at
  the replacement.
- **Do not move keys** between files/extensions: existing extensions reference them, so deprecate the
  old key and create a new one instead. Do copy the existing translated values over to the new key in
  the source files and commit them — a commit hook syncs them to l10n.xwiki.org.
