# Known major XWiki rewrites & removals (grounding for dead-reason citations)

Curated, conservative list of large subsystem changes a judge may cite as a concrete
reason a very old bug no longer applies. **Only cite an item here if the bug's reported
problem is clearly in the rewritten/removed area.** When unsure, downgrade to `escalate` —
a vague "probably obsolete" is never a valid citation.

Keep this list factual and reviewed by a human. Do not invent entries.

- **Skin: Colibri/Toucan → Flamingo (Bootstrap).** The old Colibri skin and its Velocity
  layout were replaced by the Flamingo skin (Bootstrap-based) around XWiki 6.x (2014).
  Bugs about Colibri-specific CSS/layout, the old `colibri` skin, or pre-Bootstrap panels
  are candidates.
- **WYSIWYG editor: GWT editor → CKEditor.** The original GWT-based WYSIWYG editor was
  replaced by CKEditor (default from XWiki 8.2, 2016). Bugs about the old GWT editor, its
  toolbar, or `xwiki-gwt` are candidates.
- **Office import: OpenOffice → LibreOffice server + jodconverter upgrades.** The office
  importer was reworked over time; very old office-import quirks tied to specific
  OpenOffice behaviour may no longer reproduce.
- **Watchlist → Notifications.** The old Watchlist application was superseded by the
  Notifications module (XWiki 9.x+). Bugs about the Watchlist UI/emails are candidates.
- **Activity Stream → Event Stream / Notifications.** The legacy Activity Stream was
  superseded. Bugs about the old activity stream storage/macro are candidates.
- **Rendering: XWiki 1.0 syntax → XWiki 2.0/2.1 + new rendering engine.** The pre-2.0
  rendering (Radeox-based) was replaced by the current rendering engine. Bugs specific to
  XWiki 1.0 syntax rendering are candidates.
- **Solr search replaced Lucene plugin.** The old Lucene search plugin was replaced by the
  Solr-based search. Bugs about the old `LucenePlugin` are candidates.
- **Extension Manager replaced the old plugin/XAR install mechanisms.** Bugs about manual
  plugin installation predating the Extension Manager are candidates.

If a bug's area is not clearly covered above, do **not** stretch an item to fit — escalate.
