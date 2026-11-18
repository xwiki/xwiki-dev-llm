---
title: Adding an autocomplete to the CKEditor integration (AdvancedAutoComplete vs mentions)
stability: durable
summary: CKEDITOR.plugins.AdvancedAutoComplete (xwiki-slash plugin) ignores a minChars option, unlike
  the CKEditor mentions config used by the link, image and icon plugins; an extension using
  AdvancedAutoComplete must enforce its minimum query length itself.
sources:
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-ckeditor/xwiki-platform-ckeditor-plugins/src/main/webjar/xwiki-slash/plugin.js
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-ckeditor/xwiki-platform-ckeditor-plugins/src/main/webjar/xwiki-link/plugin.js
provenance: official
last-confirmed: 2026-11-18
related: [conventions/frontend.md]
applies-to: ["**/*.js", "**/*.xml"]
applies-when:
  - '\bAdvancedAutoComplete\b'
---

# Adding an autocomplete to the CKEditor integration

An extension adds an editor autocomplete either through the CKEditor **mentions** config
(`editor.config.mentions.push({marker, minChars, feed, ...})`, as the `xwiki-link`, `xwiki-image` and
`xwiki-icon` plugins do) or with `new CKEDITOR.plugins.AdvancedAutoComplete(editor, config)` from the
`xwiki-slash` plugin, which adds groups and a `dataCallback`.

**Trap:** `AdvancedAutoComplete` silently **ignores `minChars`**. Its default `textTestCallback` matches
the marker followed by `.{0,30}`, so `dataCallback` runs from the first keystroke after the marker,
with an empty query. Enforce the minimum yourself: pass your own `textTestCallback`, or answer
`callback([])` in `dataCallback` while the query is too short.
