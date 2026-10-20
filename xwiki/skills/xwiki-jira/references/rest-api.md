# XWiki JIRA — REST API backend (fallback)

Use this when `jira-cli` is not installed. XWiki's JIRA is a self-hosted **Server/Data Center**
instance, so use REST API **v2** with the personal access token as a **bearer** token.

- Base: `https://jira.xwiki.org/rest/api/2`
- Auth header: `Authorization: Bearer $JIRA_API_TOKEN` (the same token jira-cli uses)
- **Never echo `$JIRA_API_TOKEN`.** Pass it only in the header; never print or log it.

For which values to put in Component / Affects Version / Fix Version, see `okf/servers/jira.md` — this
file is only the mechanics.

## Verify auth / identity

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Accept: application/json" \
  https://jira.xwiki.org/rest/api/2/myself | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['name'])"
```

## View an issue (only the fields you need)

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Accept: application/json" \
  "https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345?fields=summary,status,components,versions,fixVersions,description"
```

`versions` = Affects Version/s, `fixVersions` = Fix Version/s. Always pipe through `python3`/`jq` and
keep only the fields you need — never dump a raw issue into context. To find which `customfield_*`
holds a field, add `expand=names`: it maps each field id to its display name.

## List a project's versions (to choose Affects/Fix Version)

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Accept: application/json" \
  "https://jira.xwiki.org/rest/api/2/project/XWIKI/versions"
```

Each entry has `name`, `released` (bool) and `releaseDate` — sort by `releaseDate` to find the latest
released feature line, and read the current LTS line off the `X.10` versions (see `okf/servers/jira.md`).

## Create an issue

`createmeta` is restricted on this instance (returns "Issue Does Not Exist"), so don't rely on it —
send the minimal fields and let the API report any missing required field. Build the JSON in a file
to avoid shell-quoting problems, then POST it. Write the description in JIRA wiki markup.

```bash
# 1) build payload (keeps non-ASCII / newlines / quotes intact)
python3 - <<'PY'
import json
desc = open("desc.txt").read()   # JIRA wiki markup, explaining the user-visible problem
json.dump({"fields": {
    "project":   {"key": "XWIKI"},
    "issuetype": {"name": "Bug"},
    "summary":   "Concise summary of the bug",
    "description": desc,
    "components":  [{"name": "REST"}],
    # affects version(s) — oldest affected, else last LTS (okf/servers/jira.md):
    "versions":    [{"name": "17.10.0"}],
}}, open("payload.json", "w"))
PY

# 2) create (201 Created → returns the new key)
curl -s -w '\n%{http_code}\n' -X POST \
  -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Content-Type: application/json" \
  --data @payload.json https://jira.xwiki.org/rest/api/2/issue
```

**Fix Version/s, Assignee and the Flickering Test field (`customfield_10870`) cannot be set at
creation**: the create screen does not carry them (400 `Field 'fixVersions' cannot be set. It is not
on the appropriate screen`). Set them right after, with the `update` block below (`set` for the
field) and with `PUT /issue/KEY/assignee` and `{"name":"<username>"}` (204).

## Update fields (add/remove without clobbering others)

`PUT /issue/KEY` with an `update` block returns **204 No Content** on success:

```bash
# add an Affects Version and a Component; swap a version by pairing remove+add
curl -s -w '\n%{http_code}\n' -X PUT \
  -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"update":{
        "versions":[{"add":{"name":"17.10.0"}}],
        "components":[{"add":{"name":"REST"}}],
        "fixVersions":[{"add":{"name":"18.7.0-rc-1"}}]
      }}' \
  "https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345"
```

## Change issue type or summary

Use a `fields` block (it overwrites the named fields). jira-cli's `issue edit` has no type flag, so
REST is the only way to convert an existing issue (e.g. Bug→Improvement). Returns **204 No Content**:

```bash
curl -s -w '\n%{http_code}\n' -X PUT \
  -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"issuetype":{"name":"Improvement"},"summary":"New summary"}}' \
  "https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345"
```

## Link two issues

The link types are `Related` (relates to), `Causality` (causes / is caused by), `Dependency`
(blocks / depends on) and `Duplicate`; `GET /rest/api/2/issueLinkType` lists them. Returns **201**:

```bash
curl -s -w '\n%{http_code}\n' -X POST \
  -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":{"name":"Related"},"inwardIssue":{"key":"XWIKI-12345"},"outwardIssue":{"key":"XWIKI-12000"}}' \
  https://jira.xwiki.org/rest/api/2/issueLink
```

Read the issue back with `fields=issuelinks` to check the link.

## Add a comment

Unlike jira-cli (which Markdown-converts the body), REST stores the body **verbatim** — send JIRA
wiki markup directly.

```bash
curl -s -w '\n%{http_code}\n' -X POST \
  -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"Comment in JIRA wiki markup."}' \
  "https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345/comment"
```

Edit an existing comment with `PUT .../comment/<id>` and the same `{"body":…}` payload (returns
**200**) — handy to fix a comment that jira-cli mangled by Markdown-converting wiki markup.

## Transition an issue (status change)

List the available transitions first — names/ids are workflow-specific, not universal:

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Accept: application/json" \
  "https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345/transitions"

curl -s -w '\n%{http_code}\n' -X POST \
  -H "Authorization: Bearer $JIRA_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"transition":{"id":"<transition-id-from-the-list>"}}' \
  "https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345/transitions"
```

## Notes

- The context-mode plugin may redirect `curl` through its sandbox; that is fine — `$JIRA_API_TOKEN`
  is available there too. Print only derived values (a key, a status, a field list), never raw bodies.
- On a 4xx, read the `errors`/`errorMessages` JSON — it names the offending or missing required field.
