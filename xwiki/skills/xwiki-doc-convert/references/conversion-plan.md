# The conversion plan — layout, templates and the resume protocol

A conversion never fits in one session: extracting the legacy source, drafting several pages,
re-capturing every screenshot, finishing the original page and auditing the result each cost a
sizeable share of a context window. This file defines the on-disk plan that lets a conversion run as
a sequence of tasks that a session chains until a gate or the hand-off point, and that any fresh
session can resume cold.

## Layout

Everything lives in the conversion **working directory** — the same directory that holds the
`pages.py` and `shots/` the `xwiki-doc-writing` tools use. One working directory per conversion, and
it is a task directory under the work directory the org-wide conventions define, never inside the
repo: none of this is publishable and none of it belongs in a commit.

```
<work>/<repo>/<YYYY-MM-DD>-<slug>/
  pages.py                      the page set (grows as target-page tasks are done)
  shots/                        screenshots
  conversion/
    PLAN.md                     scope, setup answers, target map, status table   <- read it through `docplan.py status`
    tasks/
      01-extract.md             one file per task, self-contained
      02-target-map.md
      03-page-install.md
      ...
    source/
      antispam.txt              verbatim legacy source (wiki syntax / xproperties)
      antispam.inventory.md     the atomic material extracted from it, tagged
```

`conversion/source/` is the conversion's memory of the legacy page. The final "nothing useful lost"
audit runs against those files, in a much later session, long after the legacy page has been
stripped — **if the extraction was incomplete, the audit compares against the incomplete copy and
passes**. Extract once, completely, to disk.

Nothing under `conversion/` is ever published. It is scratch state for the conversion, and can be
deleted once the set is live (or its Change Request merged).

**`pages.py` is a staging area, not a publication queue.** The `page-*` tasks fill it and lint it;
only the final `publish` task saves any of it to xwiki.org. See "Nothing is published until the end"
below.

## PLAN.md

```markdown
# Conversion: <legacy page / extension name>

Status: planning | executing | verifying | done
Working dir: <absolute path>
Started: <YYYY-MM-DD>

## Scope

- Legacy source(s): <URLs>
- Target root in the new tree: <page reference, e.g. documentation.extensions.admin.antispam>
- Out of scope: <what this conversion deliberately does not touch>

## Setup (answers from the `xwiki-doc-writing` setup questions — do not re-ask)

- Local instance: <URL> / version <X.Y>
- Credentials file: ~/.xwiki-credentials
- Publication: Change Request <URL> | direct save (developer's choice, <date>) — either way the set
  goes live only in the final `publish` task
- Anything the developer decided up front: <...>

## Target page map

| # | Target page | Type | Audience | Location | From (source sections) |
|---|---|---|---|---|---|

(Empty until the target-map task is done.)

## Tasks

| # | Task | File | Status | Outcome |
|---|---|---|---|---|
| 01 | Extract legacy AntiSpam page | tasks/01-extract-antispam.md | done | source/antispam.txt + inventory, 34 items |
| 02 | Decide the target page map | tasks/02-target-map.md | doing | |

Status is one of `todo`, `doing`, `done`, `blocked`.

## Decisions

- <date> — <decision and the reason>, so a later session does not re-litigate it.

## Open questions for the developer

- <question> (blocks task NN)
```

## A task file

```markdown
# NN — <one-line goal>

Status: todo
Depends on: <task numbers, or "nothing">

## Goal

One or two sentences. What exists at the end that does not exist now.

## Inputs

- `conversion/source/<file>` — sections X, Y (the only source material this task needs)
- PLAN.md target map row N

## Steps

1. ...
2. ...

## Screenshots to capture

| Name | size | Region / selector | Shows |
|---|---|---|---|

## Done when

- `python3 docpages.py lint` prints 0 problems
- the page's dict is appended to `pages.py` (nothing is saved to xwiki.org — the `publish` task does
  that for the whole set)
- <other machine-checkable conditions>

## Out of scope

- <what looks related but belongs to another task — name the task>

## STOP and report instead of improvising if

- <the condition that means the plan was wrong>

## Outcome

(Filled in when the task is done: what landed, and anything the next task must know.)
```

The task file is written for **a session that has read only `SKILL.md`, `PLAN.md` and this one task
file** — which is exactly what a session resuming after a hand-off has. It has not seen the legacy page, the survey, or any other task. A step that says "as decided
above" or "the same way as the previous page" is broken — inline it, or point at the exact file and
section that holds it.

## The standard task set

Adjust the set to the conversion; keep the ordering. A session chains them, so size a task by its
work, not by a session: a small task is merged, never given a session of its own.

1. **`extract`** — every legacy source page, in one task; give a page its own `extract-<slug>` only
   when it is large (an e.x.o page with many xobjects, a long multi-section page). Read each in
   source mode (for an e.x.o extension page: every xproperty of every xobject) and write it verbatim
   to `conversion/source/<slug>.txt`. Then write `<slug>.inventory.md`: one bullet per atomic piece of
   material — concept, prerequisite, procedure, warning, limitation, config detail, example,
   troubleshooting note, image/video — each tagged with its Diataxis type and audience, and with the
   source section it came from. **The inventory is what every later task reads instead of the raw
   legacy text**, which is why it must be exhaustive rather than a summary.
2. **`target-map`** — read the inventories only (never the raw source) and decide the split: the
   target pages, their type, audience and location. Fill the target map table in PLAN.md, map every
   inventory item to a target page (an item mapped nowhere is either dropped-as-obsolete — say so —
   or a gap), and **append one `page-<slug>` task per target page to the task table**, writing each
   task file.
3. **`page-<slug>`** — one per target page: draft it into `pages.py`, capture its screenshots, and
   run `docpages.py lint` until it is clean. **It does not save anything to xwiki.org** — it is a
   preparation task. One page per task; if a page turns out to need more, split the task.
4. **`dedup`** — the cross-page de-duplication and trimming pass, hub prose included. Cannot be done
   page by page, which is why it is its own task.
5. **`originals`** — for every legacy page: strip the prose, set the "Documentation" button, delete
   the leftover attachments, triage and repoint the backlinks. Then the backlink handling for every
   page the conversion removes, including intermediate pages this conversion itself created and then
   dropped.
6. **`publish`** — the one task that writes to xwiki.org. Save the
   whole set in a single pass, **parents before children**, run `docpages.py verify`, fix what the
   live doc checker reports (page-name violations especially — the offline lint cannot see them all)
   and re-save, then `docpages.py pin` the hub orders. Budget for the fix round, not just the save.
7. **`verify`** — the full "Verify the conversion" checklist in `SKILL.md`, run against
   `conversion/source/`.

## Nothing is published until the end

xwiki.org is public and a conversion runs for weeks. A page saved the moment it is drafted is a page
the world can find while its hub does not exist, its siblings are red links and its parent is a 404 —
and a defect in it stays visible until someone happens to look. Publishing once, at the end, is what
keeps the visible state of the wiki either "not converted yet" or "converted", never "half".

- `page-*` tasks **draft and lint**; they never call `docpages.py save`.
- The `publish` task saves everything **parents before children**, so no page is ever live under a
  missing parent. Sort the page set by path depth before saving it.
- The **offline `lint` is the only gate the drafting tasks have.** Whatever the live checker would
  have told them has to be decidable offline instead; when a `publish` round finds a class of defect
  the lint could have caught, add the check rather than only fixing the page.
- **Forward links are fine while drafting** — a page may link to a sibling that does not exist yet,
  because they go live together. That is the point of the batch.
- If the developer wants something visible early, publish a **complete subtree** (a hub plus its
  children), never a single leaf.

## Resume protocol

The steps are in `SKILL.md`; what they rely on:

- `docplan.py status` finds `conversion/PLAN.md` by searching upwards, and its current task is the
  first whose status is not `done`. **Read `PLAN.md` by hand only when the digest says something is
  missing** — past 70 KB, reading it in `sed` chunks costs a dozen turns at full context.
- `start` marks the task `doing`, so an interrupted session is visible; `done` writes the status and
  the outcome into **both** PLAN.md's row and the task file, the pair that otherwise drifts. Record a
  new decision in PLAN.md's Decisions yourself — that is prose, not bookkeeping.

**Why chained, and why ~200k.** Every turn re-reads the whole context, so a session costs roughly
*turns × context*. A fresh session's warm-up (system prompt, skill, digest, inventory, `pages.py`,
browser login) is ~100k of context over 20–40 turns: run one task per session, the LaTeX conversion
spent 55–82% of most sessions on it, and the developer approved every step. Replaying the LaTeX and
Markdown runs turn by turn, priced, at hand-off thresholds from 125k to never put the cheapest at
150–200k; 250k cost 5–12 points more, 300k 10–25, never handing off 75–170%. A sub-agent per task,
replayed on the Markdown run, cut raw context by ~20% but writes its fresh context to the cache at
1.25× where the main session reads its own at 0.1×: equal or up to 12% dearer.

## Checkpoint rules

- **A mid-task checkpoint** (the ~300k case in `SKILL.md`): write what is done into the task's
  Outcome and leave its status `doing` with a `Resumed at:` note naming the exact next step. A task
  that dies mid-way with nothing written costs the whole session.
- **Blocked** means it needs the developer (a question, a missing credential, a Change Request
  conflict). `python3 docplan.py block <NN>`, write the question in PLAN.md's Open questions, and
  move on to the next unblocked task only if it does not depend on the blocked one.
- PLAN.md is the single source of truth for status. If a task file and PLAN.md disagree, PLAN.md is
  right and the task file is stale — `docplan.py status` reports the drift, and `start` / `done`
  write both at once so it stops happening.
- **Keep Decisions and Open questions to entries that still bind a future session.** `docplan.py
  status` shows the most recent of them and says how many it dropped, so a decision buried under
  fifty later ones is one a session will not see. A decision already baked into a published page has
  done its job; the ones worth carrying are the ones a later task would otherwise re-litigate.
