# Release-note entry writes

Read by `xwiki-release-documentation` at §6.2 when the release note does not exist yet, or before the
first entry that carries a screenshot. The contract and representations are in
`okf/processes/release-notes.md`.

## Creating a missing release note

Say that it does not exist, show exactly what will be created, and create it **only on
confirmation**:

```
POST /xwiki/rest/wikis/xwiki/releasenotes
{"product": "XWiki", "version": "<the JIRA version name>", "released": false}
```

A `409` means somebody created it in between — re-read the list and carry on. The template leaves
several things for the **release manager** (the OKF lists them): report those in §7, never invent
them here.

## Screenshots on an entry

A `screenshots` name must name an attachment that already exists on the entry page, and that page
does not exist until the POST allocates it. So: post the change *without* `screenshots`; **download
the screenshot from the documentation page and re-upload it** to the page named by `reference`
(standard attachment REST); then set `screenshots` — over the RN API's `PUT` on one change where the
wiki runs a version that has it, otherwise on the entry's `ChangeClass` object through generic object
REST (`xwiki-rest-api`). The OKF's endpoint list says how to tell the two apart, and that a `PUT`
replaces rather than merges. Copy the file — never link the documentation page's attachment, or
refreshing that page later rewrites what old release notes show. Never pre-create the entry page to
get around the ordering: a page sitting at the next `Entry###` corrupts the allocation.
