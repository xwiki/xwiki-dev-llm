---
name: xwiki-openproject
description: Interact with XWiki's OpenProject instance (op.xwiki.org) over its REST API v3 — search, view, create, update and comment on work packages (Bug / Improvement / New Feature / Task) and list projects, types, statuses and versions. Use when the user mentions op.xwiki.org, an OpenProject work package, or asks to file/triage/update one. This is NOT the issue tracker: bugs and tasks about XWiki code live in jira.xwiki.org — use xwiki-jira for those. For reading/writing wiki pages on a running XWiki use xwiki-rest-api; for the commit/PR conventions use xwiki-pull-request.
---

# XWiki OpenProject

Natural-language interaction with **`https://op.xwiki.org`** — the XWiki project's
[OpenProject](https://www.openproject.org) instance, used for project/roadmap work organised as
**work packages** inside **projects**. It is a different system from `jira.xwiki.org`: JIRA tracks
issues against the XWiki *code base*, OpenProject tracks project management work. If the user names
an issue key like `XWIKI-12345`, they mean JIRA — use `xwiki-jira`.

**All the calls live in `references/rest-api.md` — load it before your first one.** This file is
only the backend choice, the order of operations, and the rules that must hold before a write.

## Which backend

The instance also exposes an **MCP server** at `https://op.xwiki.org/mcp`, but it is **read-only
below OpenProject 17.8**: 17.7 registers only `search_*` / `list_*` / `current_user`, and any write
tool returns `-32602 "Tool not found"`. 17.8 adds `create_work_package`, `update_work_package`,
`create_work_package_comment` and the relation tools.

```
1. Does an openproject MCP server appear in this session's tools?
     no   → USE REST (this skill)
     yes  → does it expose a create/update tool?
              yes → prefer the MCP tool, fall back here for anything it lacks
              no  → the instance still runs < 17.8 → USE REST (this skill)
```

Read the instance version from `GET /api/v3` → `coreVersion` rather than assuming one; never cache
it here.

## Workflow

**Creating a work package:**
1. **Search first**, so you do not file a duplicate.
2. Resolve the project, then pick a type from the types that project enables. A project with no
   types enabled cannot hold work packages at all, so check before drafting.
3. Draft `subject` and a Markdown `description` describing the work in user-visible terms.
4. **Run the create form** and show the user the drafted fields, the defaults it resolved and any
   validation errors.
5. On approval, POST the real endpoint. Report the returned id and
   `https://op.xwiki.org/work_packages/{id}`.

**Updating a work package:**
1. **GET it first** — never assume the current subject, status, assignee or type. Keep its
   `lockVersion`; the update needs it.
2. **Run the update form**, show current vs. proposed, get approval.
3. `PATCH`, then re-read to verify.

## Before you write to OpenProject

Each guards something that cannot be undone or that reaches other people:

- **Run the `/form` dry run first and show its result** — before every create, update and comment.
  Each write has a `/form` twin that applies the same validation and **persists nothing**, so there
  is never a reason to send a write blind. Empty `validationErrors` **and** a present `_links.commit`
  is your proof it will succeed; a missing `commit` link means the token may not perform it.
- **Pass `notify=false` unless the user wants people emailed.** The default is to notify every
  watcher, the author and the assignee — noisy, and not undoable.
- **Never guess an id or a field value.** Project, type, status, priority and version ids are
  instance configuration that changes; read them from the discovery calls and from the form's
  `allowedValues` every time, and never remember one between sessions.
- **Never guess a status in particular.** `status` is workflow-gated: the allowed set depends on the
  current status and type, and can legitimately contain only the status already set. If the target
  status is absent from `allowedValues`, say so rather than forcing it.
- **Editing a description replaces it.** Show the original first — the API has no undo.
- **Get explicit approval before a bulk change** — each one notifies people.
- **Never print `$OPENPROJECT_API_TOKEN`.** Reference it by name; never echo it or put it anywhere
  it would be logged (it authenticates as that user, with their full permissions).

## No credential available

Every call returns `401 unauthorized` when `OPENPROJECT_API_TOKEN` is unset. Point the user at the
plugin README's "OpenProject access" section, and check the usual cause: a bare assignment in a
shell profile is only a shell variable, so it never reaches a child process — it needs `export`. Do
not invent a credential or a different OpenProject host.

If the project ever settles conventions for *which* fields a work package must carry (as
`okf/servers/jira.md` does for JIRA), those belong in the OKF, not here — this skill is mechanics.
