---
name: xwiki-jira-bfd
description: Prepare an XWiki Bug Fixing Day (BFD) on jira.xwiki.org — score the old open-bug backlog, propose a disposition for every bug (close as Duplicate, Solved By, Cannot Reproduce, Won't Fix, Invalid or Inactive; a suggestion for a human; or a quick win to fix on the day), write a report plus an editable review file, and apply only the closes the developer approved. Use when asked to prepare or run a BFD, triage or clean up the old bug backlog, find bugs to close in bulk, or find cheap bugs to fix on the day. It never writes to JIRA on its own — the real apply is a command the developer runs in their own terminal, after a dry run. For one issue (view, file, comment, transition) use xwiki-jira; for failing CI tests use xwiki-release-test-triage.
---

# Prepare a Bug Fixing Day

A BFD aims to retire or fix as many JIRA bugs as possible in one day. This skill does the
preparation: it scores the oldest open bugs, proposes which ones a committer would close
(and why), which are cheap enough to fix on the day, and which need a human's call. Then
it applies only the closes the developer approved.

**The one real harm is a wrong close**: a report closed on someone who is still hitting
the bug, sometimes fifteen years after they filed it. Everything below exists to prevent
that. Recall does not matter; a bug wrongly left open simply stays open.

**Never write to JIRA from this skill.** The only writer is `apply.py --apply`, which asks
for a typed confirmation phrase. Hand the developer that command to run in **their own
terminal**. Never run it yourself, and never pipe, echo or otherwise feed it the phrase:
the phrase is the developer's approval, not a formality to route around.

`<skill>` below is this skill's directory. The tools are Python 3, standard library only.
[`tools/README.md`](tools/README.md) explains how they decide, and
[`tools/eval/RESULTS.md`](tools/eval/RESULTS.md) holds the measurement behind every
threshold.

## 0. Before running anything

1. **`JIRA_API_TOKEN`** must be set (a jira.xwiki.org personal access token, see
   `docs/setup.md`). Reads need it too. If it is missing, stop and say so.
2. **Pick the judge**, which answers the typed questions about each bug:
   - `TYPESAFE_TOKEN` (or `TYPESAFE_API_KEY`) set: the judge is **jev**. Say so and go on.
   - Not set: **ask once** before scoring. *"No TypeSafe key. Use Claude as the judge
     through the `claude` CLI? It costs your Claude usage, measured at about $0.04 a bug to
     score (so about $8 for 200 bugs), plus a smaller duplicate-selection call per bug. It
     can propose Cannot Reproduce, Invalid and Won't Fix closes; its Inactive and Duplicate
     closes come out as suggestions."* On a no, stop: without a judge there is nothing to
     propose. A host without the `claude` CLI can only use jev.
3. **Scope.** Ask for the cohort and size if the developer did not give them. Default to
   a pilot: `--cohort 5yr --limit 200`. Cohorts are `5yr`, `2yr`, `1yr` and `all`, taken
   oldest first. `--project` defaults to `XWIKI`. Every bar was measured on XWIKI bugs, so
   say so when another project is chosen.

## 1. Run the pipeline

Use one run directory per BFD, under the work directory:
`<work>/jira/<YYYY-MM-DD>-bfd-<project>/`. Create it, tell the developer the path once,
and export it for every step:

```bash
export BFD_RESULTS_DIR="<work>/jira/<YYYY-MM-DD>-bfd-xwiki"
python3 <skill>/tools/fetch_candidates.py --cohort 5yr --limit 200   # bugs + descriptions + comments
python3 <skill>/tools/score_issues.py                                 # the judge scores each bug
python3 <skill>/tools/enrich_duplicates.py                            # find + pick duplicate targets
python3 <skill>/tools/triage.py                                       # scores → proposals → review.json
python3 <skill>/tools/make_report.py                                  # → report.md
```

Add `--judge claude` to `score_issues.py` and `enrich_duplicates.py` when the developer
chose Claude and a TypeSafe key is also set. Without a key, Claude is already the default.
Every step checkpoints into the run directory. Re-running a step resumes it, and the two
judge steps skip work already done, so a failed or interrupted run is continued, not
restarted. For 200 bugs, retrieval takes a couple of minutes; scoring takes seconds with
jev and a few minutes with Claude.

Do not pass `--close-bar`, and do not edit a threshold in `triage.py`, to get more closes.
The bars are measured, and changing one needs a new backtest (see `tools/README.md`).

## 2. Present the result

Read `report.md` and give the developer a summary, not the file:

- the counts: closes, quick wins, suggestions, and anything escalated;
- **the closes, grouped by resolution**, one line each: key, summary, and the reason
  triage gave. Call out every `Duplicate` / `Solved By` close for a careful look, since a
  wrong target is the most common mistake;
- the report's banner when a judge could not propose some resolutions;
- the path of `report.md` and `review.json`.

Section 1 of the report holds the closes, section 2 the quick wins (cheapest first) and
section 3 the suggestions.

## 3. Curate the closes with the developer

Approval is the **presence of a `close` row in `review.json`**. When the developer
rejects a close, edit `review.json`: delete the row, or change its `disposition` to
`suggest` or `keep`. Then re-run `make_report.py`.

- **Never turn a row into a `close`**, and never add one. Only `triage.py` proposes closes.
  `apply.py` refuses a close row whose judge was not measured for that resolution, so a
  hand-made close fails anyway.
- **Never change a `target_issue`** to a key the pipeline did not retrieve. If the
  developer names the right target, record the correction and leave that bug to be closed
  by hand in JIRA.
- **Drafted comments are templates.** Change one only as the developer dictates, and never
  add a claim about a cause, a fix or a version that nobody verified. The comment goes to
  the reporter.

## 4. Apply

Run the dry run yourself. It writes nothing and lists exactly what would be written:

```bash
python3 <skill>/tools/apply.py
```

Then give the developer the real command to run **in their own terminal**, starting with
a small batch so the first closes can be checked in JIRA:

```bash
BFD_RESULTS_DIR="<run dir>" python3 <skill>/tools/apply.py --apply --limit 5
```

It comments, transitions each approved issue with its resolution, and links a
Duplicate / Solved By target. It skips an issue someone already resolved, but it does
**not** re-read comments posted since the analysis. So when days have passed, re-run
`fetch_candidates.py` and the steps after it before applying.

## 5. After applying

- **Quick wins** are a pick-list; nothing is written for them. When the developer takes
  one, work on it like any other bug (`xwiki-jira` to read it, `xwiki-build` and
  `xwiki-pull-request` to fix it).
- **Suggestions** are actioned by a human in JIRA, one decision at a time. Change a JIRA
  issue only when the developer asks for that specific issue, through `xwiki-jira`.
- **The pilot gate.** Before running on a whole cohort rather than a sample, the pilot
  must show that the developer approved at least ~90% of the proposed closes, and that no
  close had a live signal the tool missed (a *safety miss*). A safety miss is a bug in
  the tool, not in the data. Report it as an issue or PR on `xwiki-dev-llm` with the
  issue key, and do not work around it by hand-tuning a threshold.
