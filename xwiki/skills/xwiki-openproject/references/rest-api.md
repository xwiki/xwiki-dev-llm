# XWiki OpenProject — REST API v3

Mechanics for `https://op.xwiki.org`. The *when* and the safety rules are in `SKILL.md`; this file
is the calls.

- Base: `https://op.xwiki.org/api/v3`
- Auth header: `Authorization: Bearer $OPENPROJECT_API_TOKEN`
- Responses are **HAL+JSON**: real data sits under `_embedded`, capabilities under `_links`. A
  `_links.<action>` that is present is an action the token may perform; an absent one is a
  permission answer.
- Every response is large. Always pipe through `python3`/`jq` and keep only the fields you need —
  never dump a raw work package or collection into context.

OpenProject also accepts the token via basic auth as user `apikey`
(`curl -u apikey:$OPENPROJECT_API_TOKEN …`); the bearer header above is preferred.

## Verify auth / identity

```bash
curl -s -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" \
  https://op.xwiki.org/api/v3/users/me \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['login'], d['admin'])"
```

`GET /api/v3` (authenticated) returns `coreVersion` — use it to decide whether the instance is new
enough (≥ 17.8) to have MCP write tools, per `SKILL.md`.

## List projects, and the types each one enables

```bash
curl -s -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" \
  "https://op.xwiki.org/api/v3/projects?pageSize=100" \
  | python3 -c "
import sys,json
for p in json.load(sys.stdin)['_embedded']['elements']:
    print(p['id'], p['identifier'], '|', p['name'])"
```

```bash
curl -s -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" \
  "https://op.xwiki.org/api/v3/projects/<PROJECT_ID>/types" \
  | python3 -c "
import sys,json
els = json.load(sys.stdin)['_embedded']['elements']
print(', '.join(f\"{t['id']}={t['name']}\" for t in els) or 'NONE - cannot hold work packages')"
```

An empty list means the project holds no work packages; pick another project.

## Search work packages

`filters` is a URL-encoded **JSON array** of single-key objects, each `{field: {operator, values}}`.

```bash
# every work package the token can see (operator "*" = "all", values must still be present)
FILTERS='[{"status":{"operator":"*","values":[]}}]'
curl -s -G -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" \
  --data-urlencode "filters=$FILTERS" --data-urlencode "pageSize=20" \
  https://op.xwiki.org/api/v3/work_packages \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)
print('total', d['total'])
for w in d['_embedded']['elements']:
    print(w['id'], '|', w['_links']['type']['title'], '|', w['_links']['status']['title'], '|', w['subject'])"
```

Useful filters (same shape, combined in the array):

| Intent | Filter element |
|--------|----------------|
| One project | `{"project":{"operator":"=","values":["<PROJECT_ID>"]}}` |
| Open only | `{"status":{"operator":"o","values":[]}}` (`c` = closed) |
| Free-text | `{"search":{"operator":"**","values":["charset"]}}` |
| By type | `{"type":{"operator":"=","values":["<TYPE_ID>"]}}` |
| Assigned to me | `{"assignee":{"operator":"=","values":["me"]}}` |

Add `sortBy=[["createdAt","desc"]]` (also URL-encoded) to order results.

## View one work package

```bash
curl -s -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" \
  https://op.xwiki.org/api/v3/work_packages/<ID> \
  | python3 -c "
import sys,json
w = json.load(sys.stdin)
print('subject     ', w['subject'])
print('lockVersion ', w['lockVersion'])
print('type/status ', w['_links']['type']['title'], '/', w['_links']['status']['title'])
print('project     ', w['_links']['project']['title'])
print('description\n', (w.get('description') or {}).get('raw'))"
```

Keep `lockVersion` — every update needs it.

## Create a work package

**Dry run first** (`SKILL.md` says why this is not optional).

```bash
BODY='{
  "subject": "<one-line summary>",
  "description": {"format": "markdown", "raw": "<the body, in Markdown>"},
  "_links": {"type": {"href": "/api/v3/types/<TYPE_ID>"}}
}'

curl -s -X POST -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" "https://op.xwiki.org/api/v3/projects/<PROJECT_ID>/work_packages/form" \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)
errs = d.get('_embedded', {}).get('validationErrors', {})
print('validationErrors:', ', '.join(f\"{k}: {v['message']}\" for k,v in errs.items()) or 'none')
c = d.get('_links', {}).get('commit')
print('commit:', (c.get('method','post') + ' ' + c['href']) if c else 'ABSENT - not permitted')
p = d.get('_embedded', {}).get('payload', {})
print('resolved status/priority:', p.get('_links',{}).get('status',{}).get('href'),
      p.get('_links',{}).get('priority',{}).get('href'))"
```

Show the user that output. On approval, **commit where the form said to** — do not hardcode a
creation path. `_links.commit` resolves the deprecation question for you: `projects/{id}` is marked
deprecated in favour of `workspaces/{id}` (both work on 17.7, with identical validation), and the
form points at the project-less `/api/v3/work_packages` regardless of which one you dry-ran.

```bash
curl -s -X POST -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" "https://op.xwiki.org<COMMIT_HREF>?notify=false" \
  | python3 -c "import sys,json;w=json.load(sys.stdin);print('created', w['id'], w['subject'])"
```

`$BODY` works because the commit endpoint accepts the same shape, except that the project-less
endpoint needs `_links.project`. The form has already resolved one for you, so the robust body is
its own `_embedded.payload` — send that when your own `$BODY` omits the project.

Then report `https://op.xwiki.org/work_packages/<id>`.

Required writable fields are `subject`, `project`, `type`, `status`, `priority` — `project` comes
from the path (or the payload), and `status`/`priority` are defaulted by the instance, so
`subject` + `type` is the minimum you must supply. Optional writable fields include `description`,
`assignee`, `version`, `parent`, `startDate`, `dueDate`, `estimatedTime`; link-valued ones go under
`_links` as `{"href": "/api/v3/<collection>/<id>"}`.

## Update a work package

`PATCH` is a partial update, but it **requires the current `lockVersion`** (optimistic locking) —
without it, or with a stale one, the call is rejected. Send only the fields you are changing.

```bash
# 1. read the current lockVersion (see "View one work package")
# 2. dry run
BODY='{"lockVersion": <LOCK_VERSION>, "subject": "<new subject>"}'
curl -s -X POST -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" "https://op.xwiki.org/api/v3/work_packages/<ID>/form" \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)
errs = d.get('_embedded', {}).get('validationErrors', {})
print('validationErrors:', ', '.join(f\"{k}: {v['message']}\" for k,v in errs.items()) or 'none')
# what this field will actually accept, straight from the schema
for f in ('status','type','priority','version'):
    s = d.get('_embedded', {}).get('schema', {}).get(f) or {}
    vals = (s.get('_embedded') or {}).get('allowedValues')
    if isinstance(vals, list):
        print(f, 'allowed:', ', '.join(v.get('name','?') for v in vals))
    elif (s.get('_links') or {}).get('allowedValues'):
        print(f, 'allowed via GET', s['_links']['allowedValues']['href'])"

# 3. after approval
curl -s -X PATCH -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" "https://op.xwiki.org/api/v3/work_packages/<ID>?notify=false" \
  | python3 -c "import sys,json;w=json.load(sys.stdin);print('now at lockVersion', w['lockVersion'])"
```

A `status` whose `allowedValues` holds only the status already set means no transition is
available to this user from here — a different role or an intermediate state may be needed.

Changing `type` is a normal field update (`_links.type`), unlike JIRA where it needs a special call.

## Add a comment

```bash
curl -s -X POST -H "Authorization: Bearer $OPENPROJECT_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"comment": {"raw": "<Markdown comment>"}}' \
  "https://op.xwiki.org/api/v3/work_packages/<ID>/activities?notify=false" \
  | python3 -c "import sys,json;a=json.load(sys.stdin);print('comment', a['id'], 'added')"
```

Read the existing thread with `GET /api/v3/work_packages/<ID>/activities` — elements are
`Activity` objects whose `comment.raw` is Markdown; many carry only field changes and no comment.

## Errors

Errors are HAL too: `_type: "Error"` with an `errorIdentifier` and `message`.

| Status | `errorIdentifier` ends in | Meaning |
|--------|---------------------------|---------|
| 401 | (plain `unauthorized` body) | token missing, unexported, revoked or expired |
| 403 | `MissingPermission` | token authenticates but the user lacks the permission (e.g. *add work packages*) |
| 400 | `InvalidRequestBody` | body was not a single JSON object |
| 422 | `PropertyConstraintViolation` | a field failed validation, on the **real** call |
| 409 | `UpdateConflict` | `lockVersion` stale **or absent** — re-read the work package and retry |

Two behaviours worth knowing, because they change how you read a form response:

- A **failed field validation on a form is not an error response**: the form returns **HTTP 200**
  with the failure under `_embedded.validationErrors` (each entry carrying its own
  `PropertyConstraintViolation` identifier and a message like `Subject can't be blank.`) and
  **omits `_links.commit`**. So "empty `validationErrors` *and* a present `commit`" is the check —
  a non-200 status is not what tells you the payload was rejected.
- **`409 UpdateConflict` fires on the form too**, and an *omitted* `lockVersion` produces it just
  like a stale one. So always read the current `lockVersion` first; the form cannot validate an
  update without it.

Surface the `message` verbatim to the user; it names the offending attribute.
