---
name: xwiki-jira
description: Interact with XWiki's self-hosted JIRA (jira.xwiki.org) — view, search, create, update, comment on and transition issues. Use when the user mentions a JIRA issue key (e.g. XWIKI-12345, XCOMMONS-123, XRENDERING-45), asks to file/triage/update a bug or task, or wants issue/sprint status. Uses jira-cli when installed (recommended) and falls back to the REST API otherwise. For the issue-field conventions (Component, Affects/Fix Version) it relies on okf/servers/jira.md; for commit/PR conventions use xwiki-pull-request.
---

# XWiki JIRA

Natural-language interaction with **`https://jira.xwiki.org`** — XWiki's issue tracker (NOT GitHub
Issues), a **self-hosted Atlassian JIRA** (Server/Data Center). Per-repo project keys: `XWIKI`
(Platform), `XCOMMONS` (Commons), `XRENDERING` (Rendering), a per-extension key for each
xwiki-contrib extension. Issue keys match `[A-Z]+-[0-9]+`.

There is **no Atlassian MCP** for this instance. Pick a backend:

```
1. Is jira-cli installed?  → run: which jira
     found  → USE CLI BACKEND (recommended)
2. Not installed?
     → USE REST BACKEND (needs JIRA_API_TOKEN in the environment)
     → and tell the user they can install jira-cli for a nicer experience
       (setup instructions are in the plugin README).
```

| Backend | When | Reference |
|---------|------|-----------|
| **jira-cli** | `jira` command available | Quick reference below |
| **REST API** | no `jira-cli` | `references/rest-api.md` |

**Field conventions are not in this skill — they live in `okf/servers/jira.md`** (which Component to
set, how to choose Affects Version/s and Fix Version/s). Read it before creating or curating an
issue, so the same rules apply whichever backend you use.

## Quick reference (jira-cli)

> Skip this section if using the REST backend. jira-cli reads `JIRA_API_TOKEN` + `JIRA_AUTH_TYPE=bearer`
> and its config from `jira init` (see the plugin README). Always pass `--project`/`-p` for the repo
> you are in (`XWIKI`, `XCOMMONS`, …) since one JIRA hosts all projects.

| Intent | Command |
|--------|---------|
| View an issue | `jira issue view XWIKI-12345` |
| Open in browser | `jira open XWIKI-12345` |
| My issues | `jira issue list -a$(jira me) -pXWIKI` |
| My in-progress | `jira issue list -a$(jira me) -s"In Progress" -pXWIKI` |
| Search (JQL) | `jira issue list -pXWIKI --jql "text ~ 'charset' ORDER BY created DESC"` |
| Create a bug | `jira issue create -pXWIKI -tBug -s"Summary" -b"Description" -C"REST"` |
| Add a comment | `jira issue comment add XWIKI-12345 -b"Comment text"` |
| Transition | `jira issue move XWIKI-12345 "In Progress"` |
| Assign to me | `jira issue assign XWIKI-12345 $(jira me)` |
| Who am I | `jira me` |

Set **Affects/Fix Version** with `--affects-version`/`--fix-version` and **Component** with `-C`,
per `okf/servers/jira.md`. Multi-line descriptions: use `--template -` and pipe the body on stdin, or
`--no-input` only when every required field is supplied (see the jira-cli deep-dive note below).

**jira-cli gotchas:**
- **Bodies are treated as Markdown, not wiki markup.** jira-cli runs comment/description text
  (including `--template` files and stdin) through a Markdown→JIRA-wiki converter, so pass **Markdown**
  and let it convert. Passing raw JIRA wiki markup gets double-escaped (hyphens, parens, `*`) and
  `[text|url]` links mangled. To store **raw wiki markup verbatim**, use the REST backend instead
  (`references/rest-api.md`).
- **`-t`/`--type` exists only on `jira issue create`, not `jira issue edit`.** jira-cli cannot change
  the type of an *existing* issue (e.g. Bug→Improvement) — use the REST recipe in
  `references/rest-api.md`. (`jira issue move` changes status, not type.)

## Workflow

**Creating an issue:**
1. Gather context (the code/PR/commit it concerns; whether a similar issue already exists — search first).
2. Read `okf/servers/jira.md` and resolve the fields: issue type, **Component/s**, **Affects
   Version/s** (oldest affected, else last LTS — verify the version values, don't cache them),
   **Fix Version/s**. Write the description explaining the *user-visible* problem — in JIRA wiki markup
   for the REST backend, in Markdown for jira-cli (it converts; see the gotcha above).
3. Show the user the drafted summary + description + fields, then create.
4. Report the created key and URL.

**Updating an issue:**
1. **Fetch the issue first** — never assume its current status, assignee or field values.
2. Show current vs. proposed values.
3. Get approval, apply, then verify by re-reading the issue.

## Before you write to JIRA

Each of these guards an operation that cannot be undone or that reaches other people:

- **Show the original before editing a description** — JIRA has no undo.
- **List the available transitions before moving an issue** — transition and status names vary
  between projects and are not universal, and a workflow may require an intermediate state, so a
  blind move can fail or misfire.
- **Get explicit approval before a bulk modification** — each change notifies watchers.
- **Component is never left empty, and Affects Version is not merely the latest release** — follow
  `okf/servers/jira.md`.
- **Never print the token value.** `JIRA_API_TOKEN` is a secret; reference it by name only, never
  echo it or pass it where it would be logged.

## Safety

- Show the command / REST call before running it, and get approval before modifying anything.
- Preserve original information when editing; verify updates after applying.
- Surface authentication failures clearly so the user can fix their setup (see the README).

## No backend available

If `jira-cli` is not installed AND `JIRA_API_TOKEN` is not set, guide the user to the plugin README's
"JIRA access" setup (install jira-cli and run `jira init`, or export `JIRA_API_TOKEN`). Do not invent
credentials or a different JIRA host.

## Deep dive

Load `references/rest-api.md` when using the REST backend, or for anything beyond a simple
view/list/comment on the CLI: creating an issue with multi-line body or version/component fields,
transitions (which need the available-transition list), or JQL beyond a trivial filter.
