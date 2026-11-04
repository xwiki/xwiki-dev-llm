---
title: Watching a merged functional test on CI
stability: durable
summary: Proving a merged or backported functional test on CI — what counts as "it ran and passed",
  and the in-session watch that checks it.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/
---

# Watching a merged functional test on CI

The rule — a functional test is done once proven on CI on every branch it landed on — is in
[[strategy]]. This file is how to check it.

## What counts as "it ran and passed"

Data: test results from Develocity (the `develocity` MCP), the build ↔ commit mapping from
ci.xwiki.org ([[jenkins]]). For each branch, use only builds whose commit **contains the merge**:
`git merge-base --is-ancestor <merge-sha> <build-sha>`, or the commit date (`%cd`), never the author
date, which can predate the merge by days.

A green build is not evidence until each of these holds:

- **The test class was in the run.** CI runs a module's tests nested in its `AllIT`, so look for
  `AllIT$NestedXxxIT` and the method itself; an absent class or method is "not run", not "passed".
- **It executed rather than came from the cache.** A failsafe goal restored from the Develocity build
  cache reports 0 tests: not a run.
- **A failure may be a ghost.** A method renamed or removed by a later commit can show as failed or
  0-passed in an aggregate; check it still exists at the build's commit before diagnosing.
- **Environment Tests count** — both their passes and their failures — but a test merged with the code
  it needs is transiently red there (see [[jenkins]]).

## The in-session watch

1. **List what to watch** — per merged PR and per branch it landed on (the backport is its own row):
   the `*IT` classes and `@Test` methods it added or changed (`gh pr view <n> --json files`, then the
   diff).
2. **Keep a state file in the work directory**, one row per PR × branch: merge sha, classes/methods,
   builds checked (ids), result (`pending` / `green ×k` / `FAILING: <cause>`), action taken. It is what
   lets a later session resume.
3. **Schedule a recurring check in the session** (e.g. every ~3 h, through the host's scheduler such as
   `CronCreate`). Such a schedule is session-scoped and expires (about 7 days), so the state file plus
   the rule are what carry the watch beyond it.
4. **Run each check in a subagent** that reads the state file, examines the new builds, updates the
   file and returns only what changed (a new failure, a row newly proven, a fix proposed), so the main
   context stays small.
5. **Diagnose a failure in that same session**: a bug in the test or its page objects gets a fix PR; a
   pre-existing flicker gets a flickering issue ([[jira]]). For a flicker, the browser console in the
   test's captured output and the build's screen recording help.
6. **Stop** when every row is proven, and say so.
