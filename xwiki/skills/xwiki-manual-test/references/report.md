# Run files and report

## `plan.json` — the run's state

Written in step 4, updated with each verdict; a re-test reads it back.

```json
{
  "scope": "project-management 1.4.1 (GitHub milestone 1.4.1)",
  "environment": {"xwiki": "18.9.0", "database": "HSQLDB", "engine": "Jetty", "browser": "Chrome",
                  "external": {"OpenProject": "17.9.7"}, "build": "local main@546082f0 as 1.4.1-local-SNAPSHOT",
                  "buildVerified": true, "url": "http://localhost:8080/xwiki"},
  "baseline": {"version": "1.4.0", "verified": true, "why": "last release without the fixes"},
  "depth": "standard", "timeBoxMinutes": 15,
  "triage": [{"item": "#660", "class": "nothing user-visible", "reason": "test-only change"}],
  "testers": [{"id": "t1", "user": "QATester1", "sessions": ["qa-t1", "qa-t1-simple", "qa-t1-guest"],
               "space": "QA.2026-11-19-pm141-t1", "items": ["#643", "#655"]}],
  "items": [{
    "item": "#645", "title": "…", "url": "…", "tester": "t2", "global": false,
    "expected": "Start and Due Date shown without time, in the wiki date format's day part",
    "setupFacts": ["connection: instance=\"OpenProject QA\"", "property ids: startDate, dueDate"],
    "riskAreas": ["custom date fields", "dates in the cards and single displayers", "spent time days"],
    "tours": ["edit-wysiwyg", "config-change"],
    "users": ["admin", "simple"],
    "scenarios": [{"id": "confirm", "steps": ["…"]}, {"id": "explore", "charter": "…"}],
    "baselineHasBug": true,
    "verdict": null, "verifierVerdict": null
  }],
  "createdData": {"spaces": [], "users": [], "external": [], "pages": []}
}
```

`createdData` is what the clean-up deletes; record each creation as it happens, so a run that stops
half-way can still be cleaned.

## The HTML report

A private artifact; its source and every piece of evidence stay in the run directory. Little prose:
the tables carry the content, explanations sit in collapsed details. Order:

1. **Header** — scope, build under test and baseline (both verified), environment, depth, date, and
   tiles: checks run, bug shown on the baseline, fixed in the build, regressions, findings.
2. **Findings table** — one row per finding: number, item, severity, title, regression or
   pre-existing, and the proposal (reopen #N, new issue, not a bug) with a one-line why.
3. **One section per item**, labelled:
   - **Bug** — the issue title, linked;
   - **Expected after fix** — one sentence;
   - **Videos** — baseline and build under test, one link each (every scenario has one);
   - **Checks** — a compact table, one row per check: the path tested (expected and observed in a
     collapsed detail), a baseline chip (bug / ok / other) and a build chip, and the two screenshots
     side by side (click to enlarge). The section heading shows "N/M fixed".
4. **Findings detail** — collapsed, one per finding: steps, expected vs actual, the baseline and
   build screenshots, the logs, the verifier's decision. Then the "observed once" list.
5. **Not tested, observations, test data** — the triage list with reasons, the verifier's
   observations, the pre-existing accessibility violations, and the data the run created (still
   there or deleted).
6. **Drafts** — each proposed reopen comment, issue and "verified on" comment, ready to copy,
   marked "not posted".

Publish screenshots and videos as files of the artifact (WebM videos of a scenario are small); when
the host limits the size of one publish, publish them in several batches to the same artifact.
