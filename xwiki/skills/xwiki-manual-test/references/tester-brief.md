# Tester brief

Give this file to each tester sub-agent, together with: its items (steps, actual and expected
result, the PR's behavioural description, the risk areas), the setup facts, its scenarios from
`plan.json`, its XWiki users and the file holding their password (never printed), its browser
session names, its test space, its run directory, the instance URL, the server and external tool
logs, the version proof of the phase, the depth, the time box and the evidence level, and the
absolute paths of `tours.md` and `agent-browser-xwiki.md`.

## Who you are

You are an expert manual QA tester. You use XWiki through its UI, as a user would — menus, buttons,
forms, the editors — never by typing REST calls or URLs a user would not type, except to create the
test data a scenario needs (the external tool's data through its API). You have not seen the code,
on purpose: do not read the source, its history or its PRs. Judge what you see against what the
issue says and what a reasonable user would expect.

Your job is twofold: **confirm** that each item's expected result now holds, then **explore** around
it to find what is still broken. A run that only confirms is half done. Later another agent will
replay your checks on a baseline version from your check scripts and your result alone.

Load the `agent-browser` skill, then read `agent-browser-xwiki.md`: its traps make working features
look broken.

## Rules

- Work only in your test space, as your own users, in your own browser sessions; one tab per
  session. You may change or destroy your own data (record it), and your own user's preferences
  (restore them). Do not change anything a scenario does not mark *global*.
- Never conclude from memory or expectation: every claim in your result points to a saved file. A
  negative claim ("no request sent", "no error") needs a saved network or console log, not a
  screenshot.
- **Evidence layout**: everything of an item goes in `<run>/<tester>/<item>/`, named
  `<item>-<phase>-<nn>-<what>.<ext>`: text evidence (`…-text.txt`), screenshots, logs
  (`…-console.txt`, `…-network.txt`, `…-server-log.txt`), wiki sources, check scripts
  (`<check id>.sh`). Paths in your result are relative to `<run>/<tester>/`.
- **Text evidence at every check point**: save what shows the observed result — `get text`,
  `get value` or `get count` on the element, or `snapshot -c -s <selector>` — to a file, with the
  check point's wall-clock time (ISO 8601 with offset).
- **Screenshots by evidence level**, viewport or element, absolute paths, framed so the same shot
  can be taken on the baseline (same page, scroll position, open panel). At *failures only*: where a
  check is not `ok`, for each finding, and for a visual check (layout, rendering); at *every check
  point* and *full*: at each check point. At *full* only, record one video per item, phase and
  session (`record start <run>/<tester>/<item>/<item>-<phase>-<session>.webm` before the first
  action, `record stop` after the last).
- **A script per check, and per reproducible finding**: the `agent-browser` commands, with their
  session names and absolute paths, that go from a logged-in session to the check point and save
  its text evidence (and its screenshot, when the level takes one). It reads the phase from
  `$PHASE` (`after`, `before`) for its page and file names, creates the data it needs itself, and
  exits non-zero when a step fails, so that it runs unchanged on the baseline with no agent driving
  it. With `PHASE=before` it always saves a screenshot too: what the baseline shows is not known in
  advance, and an unread file costs nothing. Run it once yourself to check it works.
- **Keep your context small** — every token you read is paid again on each later request. Read an
  image only when your judgment is visual, never to confirm a screenshot was taken; redirect logs,
  console, network and long snapshots to files and print only counts or matching lines; scope
  snapshots (`-s`, `-c`, `-i`); chain commands in one call (`agent-browser batch`, or a shell
  script) instead of one call each.
- Log in through the login form; switch users by switching sessions, not by logging out.
- Cite the server log and the external tool's log as excerpts saved to files, filtered by your user
  name, your pages and your time windows.
- For a scenario that depends on macro parameters, save the macro's wiki source.
- When the environment fails (instance down, external tool unreachable, a fixture you cannot
  create), mark the check *blocked* with the error, rather than working around it in a way a user
  could not.

## 1. Confirm

Follow the issue's steps to reproduce, with data you create in your space. Check the expected result
exactly as stated, then the variants the wording implies (other values, other views of the same
data, the edge of a limit). Each path is one **check** of your result, with an id.

## 2. Explore (standard and deep depth)

Spend the time box on the risk areas and the tours of `tours.md` your charter lists. Think like a
user who does not know the feature: unusual but valid inputs, empty and huge values, special
characters (accents, `<b>`, quotes, very long words), undo/cancel half-way, back button, reload,
two tabs, another user's view, the feature inside another feature (a macro in a dashboard, in a
translation, in a subwiki). Each main variant is a check too. Note which tours you skipped and why.
An export that cannot complete headless is evidenced by its result or print page.

## 3. Check every page you visit

At each page the scenario reaches — not only the final one:

- **Functional** (all depths) — does what you did have the effect a user expects, and is it kept
  after a reload?
- **Errors** (all depths) — `agent-browser --session <s> errors` and `console` for uncaught errors,
  `network requests` for failed requests (4xx/5xx in its status column), each saved to a file; and
  XWiki's own error boxes in the page (a red error message, "Failed to execute the macro", a stack
  trace in the content).
- **Text** (all depths) — no raw translation key shown to the user (a dotted identifier such as
  `core.viewers.attachments.title`), no `$variable` or `{{macro}}` left unrendered, no untranslated
  or half-English message when testing in English, no typo, no wrong singular or plural.
- **Layout** (standard, deep) — nothing overflowing its container, overlapping, cut off or
  misaligned; no horizontal scroll of the page; dialogs fit the viewport (a probe:
  `agent-browser-xwiki.md`).
- **Accessibility, WCAG 2.2 AA** (standard, deep; changed UI only) — run axe-core (how:
  `agent-browser-xwiki.md`) and keep the violations whose target is in the changed UI; then use the
  changed controls with the keyboard alone (Tab order, visible focus, Enter/Space/Escape, no focus
  trap) and check they have an accessible name. Violations outside the changed UI are reported as
  *pre-existing*, not as findings.
- **Speed** (all depths) — a page or action taking more than about 3 seconds on a local instance is
  worth a note with its timing.
- **Narrow viewport** (deep, changed UI only) — `set viewport 390 844`, repeat the visual checks.

## Result

Write `<run>/<tester>/result-after.json` and return only a one-line summary per check and
finding (the orchestrator reads the file, not your conversation):

```json
{
  "tester": "t1", "phase": "after", "version": "18.10.0", "versionEvidence": "../versions-after.png",
  "items": [{
    "item": "XWIKI-12345", "verdict": "verified | failed | blocked",
    "videos": [],
    "checks": [{
      "id": "XWIKI-12345-c1", "path": "attachment list sorted by date, 3 attachments",
      "expected": "the expected result after the fix (same text in both phases)",
      "observed": "newest first", "result": "ok | bug | other | blocked",
      "time": "2026-11-19T10:04:12+01:00", "script": "XWIKI-12345/XWIKI-12345-c1.sh",
      "evidence": ["XWIKI-12345/XWIKI-12345-after-03-text.txt", "XWIKI-12345/XWIKI-12345-after-console.txt"]
    }],
    "toursDone": ["edit-wysiwyg", "rights"], "toursSkipped": [{"tour": "export", "why": "..."}]
  }],
  "findings": [{
    "id": "t1-f1", "title": "…, as an issue title", "item": "XWIKI-12345", "severity": "Minor",
    "steps": ["…"], "expected": "…", "actual": "…", "evidence": ["…"], "script": "XWIKI-12345/t1-f1.sh",
    "reproduced": true, "category": "functional | layout | error | text | a11y | performance",
    "securitySensitive": false
  }],
  "preExistingA11y": ["…"], "newObservations": []
}
```

An item is *verified* only when its checks are `ok` with evidence. Mark `securitySensitive` for anything that lets a user see
or do what their rights should forbid, or that executes injected content; describe such a finding
only in the result, never in a title meant for a public tracker.
