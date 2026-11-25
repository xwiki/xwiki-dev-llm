# Run files and report

## `plan.json` — the run's state

Written in step 4, updated with each verdict; a re-test reads it back.

```json
{
  "scope": "XWiki 18.10.0 (JIRA fix version 18.10.0)",
  "environment": {"xwiki": "18.10.0", "database": "PostgreSQL 17", "engine": "Tomcat 10", "browser": "Chrome",
                  "external": {}, "build": "18.10.0-SNAPSHOT from the store, 2026-11-19",
                  "buildVerified": true, "url": "http://localhost:8080/xwiki"},
  "baseline": {"version": "18.9.0", "verified": true, "why": "last release without the fixes"},
  "depth": "standard", "timeBoxMinutes": 15, "evidence": "failures only",
  "models": {"tester": "inherit", "replayer": "sonnet", "verifier": "sonnet"},
  "triage": [{"item": "XWIKI-12350", "class": "nothing user-visible", "reason": "test-only change"}],
  "testers": [{"id": "t1", "users": ["QATester1", "QATester1Simple"], "sessions": ["t1", "t1-simple", "t1-guest"],
               "space": "QA.2026-11-19-xs1810-t1", "items": ["XWIKI-12345"]}],
  "items": [{
    "item": "XWIKI-12345", "title": "…", "url": "…", "tester": "t1", "global": false,
    "expected": "The attachments of the page are listed newest first",
    "setupFacts": ["the attachments tab of a page", "sort by date from the column header"],
    "riskAreas": ["attachments with the same date", "pagination of the list", "a guest's view"],
    "tours": ["many-and-none", "rights"],
    "users": ["admin", "simple", "guest"],
    "scenarios": [{"id": "confirm", "steps": ["…"]}, {"id": "explore", "charter": "…"}],
    "baselineHasBug": true,
    "baselineProof": "replay | {\"test\": \"<class#method>\", \"assertion\": \"<quoted>\"}",
    "verdict": null, "verifierVerdict": null
  }],
  "createdData": {"spaces": [], "users": [], "external": [], "pages": []}
}
```

`createdData` is what the clean-up deletes; record each creation as it happens, so a run that stops
half-way can still be cleaned.

## `result-before.json` — the baseline replay

Written by the orchestrator per tester from the script runs, completed by a replayer for the ids it
replays by hand; the verifier, not this file, says what each shows (`before` in its result).

```json
{
  "tester": "t1", "phase": "before", "run": "2026-11-19T14:02", "version": "18.9.0",
  "versionEvidence": "../versions-before.png",
  "checks": [{"id": "XWIKI-12345-c1", "result": "unjudged", "exit": 0,
              "start": "2026-11-19T14:05:01+01:00", "end": "2026-11-19T14:05:19+01:00",
              "observed": "only when replayed by hand", "byHand": null,
              "evidence": ["XWIKI-12345/XWIKI-12345-before-03-text.txt", "XWIKI-12345/XWIKI-12345-before-03.png",
                           "XWIKI-12345/XWIKI-12345-before-console.txt", "XWIKI-12345/XWIKI-12345-before-server-log.txt"]}],
  "findings": [{"id": "t1-f1", "result": "unjudged", "exit": 0, "evidence": ["…"]}],
  "newObservations": []
}
```

## The HTML report

`report/index.html` in the run directory, published as a private artifact when the host can; every
piece of evidence stays in the run directory, and no evidence of a security-sensitive finding is
published. Little prose: the tables carry the content, explanations sit in collapsed details. Order:

1. **Header** — scope, build under test and baseline (both verified), environment, depth, date, and
   tiles: checks run, bug shown on the baseline, fixed in the build, regressions, findings.
2. **Findings table** — one row per finding: id, item, severity, title, regression or
   pre-existing, and the proposal (reopen #N, new issue, not a bug) with a one-line why.
3. **One section per item**, labelled:
   - **Bug** — the issue title, linked;
   - **Expected after fix** — one sentence;
   - **Videos** — at *full* evidence only: baseline and build under test, one link per session video;
   - **Checks** — a compact table, one row per check: the path tested (expected and observed in a
     collapsed detail), a baseline chip (the verifier's `before`) and a build chip (the tester's
     `result`), the verifier's check verdict when it differs, and the evidence of both phases side
     by side — the text
     excerpts, or the screenshots where taken (click to enlarge). The section heading shows "N/M
     fixed".
4. **Findings detail** — collapsed, one per finding: steps, expected vs actual, the baseline and
   build screenshots, the logs, the verifier's decision. Then the "observed once" list.
5. **Not tested, observations, test data** — the triage list with reasons, the verifier's
   observations, the pre-existing accessibility violations, and the data the run created (still
   there or deleted).
6. **Drafts** — each proposed reopen comment, issue and "verified on" comment, ready to copy,
   marked "not posted".

Build the report with a script over the result and verifier files, not by having an agent read the
evidence again. Publish screenshots and videos as files of the artifact (WebM videos of a scenario are small); when
the host limits the size of one publish, publish them in several batches to the same artifact.
