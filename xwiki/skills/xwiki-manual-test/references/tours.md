# XWiki user tours

Things users routinely do around any feature, and where XWiki features commonly break. The plan
lists the tours that apply to an item; the tester reports the ones it skipped and why. Pick by what
the feature touches, not all of them.

| Tour | What to do | Typical breakage |
| --- | --- | --- |
| `edit-wysiwyg` | Insert / edit the macro or content in the WYSIWYG editor (CKEditor): the macro wizard, its parameters, save and continue, cancel. | Wizard fields missing or mislabelled, parameters lost on re-edit, macro placeholder errors in the editor. |
| `edit-wiki` | The same in the wiki (source) editor and the in-place editor. | Syntax only one editor writes; escaping of parameter values. |
| `preview` | Preview before saving, then back to edit. | Preview renders differently from view, content lost on back. |
| `view-reload` | Save, view, reload, open in a new tab. | State only in memory; async rendering placeholders that never fill. |
| `rename-move-copy` | Rename, move and copy the page holding the feature; then use it. | Stale references, links to the old name, lost objects. |
| `history` | Compare versions, roll back, delete and restore from the recycle bin. | Feature data not versioned, rollback leaving it broken. |
| `rights` | The same page as a simple user, as a guest, and with view/edit denied. | Data of others leaking, actions offered that then fail, errors instead of "not allowed". |
| `subwiki` | The feature in a subwiki (create one when the farm allows). | Main-wiki-only configuration, wrong wiki in references. |
| `translations` | The page in another language (a document translation), the UI in another locale (the tester's own language preference, restored afterwards). | Raw keys, untranslated labels, data shown in the wrong language. |
| `export` | Export the page to PDF (the PDF export), HTML or XAR. | Feature not rendered in export, JS-only content missing. |
| `search` | Find the page or the feature's data from the search. | Indexing gaps, results without the new data. |
| `dashboard-include` | The feature inside a dashboard gadget, an included page, a Live Data or a template. | Context lost (current page, user), duplicated IDs when shown twice. |
| `many-and-none` | No data, one item, many items (pagination, limits), very long values. | Empty-state errors, limits applied wrongly, layout overflow. |
| `config-change` | Change the configuration the feature reads (administration, preferences) and use it again. **Global.** | Setting cached until restart, ignored per wiki or per space. |
| `concurrency` | Two users or two tabs editing / using it at once. | Lost updates, stale UI, conflicts not detected. |
