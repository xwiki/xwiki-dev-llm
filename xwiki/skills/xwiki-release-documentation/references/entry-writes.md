# Release-note entry writes

Read by `xwiki-release-documentation` at §6.2 when the release note does not exist yet, or before the
first entry that carries a screenshot. The contract and representations are in
`okf/processes/release-notes.md`; the access rules (default `curl` User-Agent, Basic auth parsed from
`~/.xwiki-credentials` and never sourced or printed, the `XWiki-Form-Token` header) are in
`okf/servers/index.md`. Below, `$RN` is `https://www.xwiki.org/xwiki/rest/wikis/xwiki/releasenotes`
, `$AUTH` the Basic credentials built from that file, and `$TOKEN` the `XWiki-Form-Token` header of
an authenticated `/rest` GET.

## Creating a missing release note

Say that it does not exist, show exactly what will be created, and create it **only on
confirmation**:

```
curl -s -H "Authorization: Basic $AUTH" -H 'Content-Type: application/json' \
  -H 'Accept: application/json' -X POST "$RN" \
  -d '{"product": "XWiki", "version": "<the JIRA version name>", "released": false}'
```

`201` answers the stored note. A `409` means somebody created it in between: check that its
`reference` is `ReleaseNotes.Data.XWiki.<ShortVersion>.WebHome`, re-read the list and carry on. The
template leaves several things for the **release manager** (the OKF lists them): report those in §7,
never invent them here.

## Screenshots on an entry

A `screenshots` name must name an attachment that already exists on the entry page, and that page
does not exist until the POST allocates it. So:

1. Post the change *without* `screenshots`, and keep the `reference` it answers
   (`ReleaseNotes.Data.XWiki.18\.8\.0RC1.Entry004.WebHome`). Its REST page URL, `$ENTRY` below, has
   one `/spaces/` segment per unescaped segment, written unescaped:
   `https://www.xwiki.org/xwiki/rest/wikis/xwiki/spaces/ReleaseNotes/spaces/Data/spaces/XWiki/spaces/18.8.0RC1/spaces/Entry004/pages/WebHome`.
2. **Download the screenshot from the documentation page** — `GET <its REST page URL>/attachments/<name>`
   (the wiki is `extensions` for a page on extensions.xwiki.org) — and **re-upload it** to the entry
   page:

   ```
   curl -s -H "Authorization: Basic $AUTH" -H "XWiki-Form-Token: $TOKEN" \
     -H 'Content-Type: application/octet-stream' -X PUT \
     --data-binary @<file> "$ENTRY/attachments/<name>"
   ```

3. Set `screenshots`. The wiki's Release Notes Application decides how:
   - **2.7 (what xwiki.org runs at the time of writing)** has no update endpoint, so write the
     property of the entry's `ReleaseNotes.Code.Change.ChangeClass` object through generic object
     REST (`xwiki-rest-api`). The stored value is the names joined by `,` with no space:

     ```
     curl -s -H "Authorization: Basic $AUTH" -H "XWiki-Form-Token: $TOKEN" \
       -H 'Content-Type: text/plain' -X PUT --data-binary '<name1>,<name2>' \
       "$ENTRY/objects/ReleaseNotes.Code.Change.ChangeClass/0/properties/screenshots"
     ```

   - **2.8 and later** have `PUT $RN/XWiki/<version>/changes/<entry>`, `<entry>` being the
     `Entry###` segment of `reference` (also returned as `entry`). It *replaces*: send the change
     the POST answered, with `screenshots` added as a JSON array.

   `GET $RN/XWiki/<version>/changes/<entry>` answering `404` on the change just created means 2.7.
   Either way, read the change back and check `screenshots` — a property write can answer success
   and store nothing (`xwiki-rest-api`).

Copy the file — never link the documentation page's attachment, or refreshing that page later
rewrites what old release notes show. Never pre-create the entry page to get around the ordering: a
page sitting at the next `Entry###` corrupts the allocation.
