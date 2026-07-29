---
name: xwiki-backport-testneeded
description: Backport the automated test of one JIRA issue labelled `testneeded` to the currently-supported stable branches, adjust its `@since` tags across all branches, and open the PRs. Use when asked to backport the test of a given testneeded issue, or to catch a stable branch up with a recently-added test. (For several issues at once, the user will say so — then apply this per issue.) This is the test-specific layer on top of xwiki-backport (which owns the generic cherry-pick / adapt-to-branch / verify mechanics — including the mandatory pom-version, Java-version and `@since` checks). For Maven use xwiki-build; for PR/commit conventions use xwiki-pull-request; for the `@since` rules use xwiki-knowledge; for querying JIRA (the testneeded sweep) use xwiki-jira.
---

Backport the test added for **one** `testneeded`-labelled JIRA issue onto the currently-supported
stable branches, keep its `@since` tags consistent across every branch, and open one PR per branch.

**This skill is the `testneeded` layer on top of `xwiki-backport`.** Do the generic backport work —
establishing the target branches/versions, finding all the issue's commits, worktree +
`cherry-pick -x` oldest-first, the **adapt-to-branch checks (pom versions §3.A, Java level §3.B,
conflict rules §3.C, `@since` §3.D)**, reset-and-re-cherry-pick when a base moves, verification, and push/PR — by
following **xwiki-backport**. This file adds only what is specific to backporting `testneeded` tests:
finding the issues, the `@since` policy for test-support classes, the `testneeded` label, and the
consolidated master PR.

Related skills: **xwiki-backport** (mechanics), **xwiki-build** (Maven), **xwiki-pull-request**
(PR/commit conventions), **xwiki-knowledge** (the `@since` / versioning convention in the OKF).

## Scope & finding the issues

Run per **one** issue. Doing several at once is opt-in: only when the user asks, apply the steps per
issue (a worktree + subagent per issue parallelises well) and consolidate the master `@since` edits
of all issues into a **single** master PR (see below) instead of one per issue.

To find candidate issues, sweep JIRA with this JQL:
```
project = XWIKI AND labels = testneeded AND resolution = Fixed AND resolutiondate >= <cutoff>
```
Run the JQL and the per-issue lookups via the **`xwiki-jira`** skill (it owns JIRA access — jira-cli
or REST — and auth). For each candidate, read `fixVersions` + `summary`
(`.../issue/<KEY>?fields=fixVersions,summary`) and the version release dates / branch-cut points
(`.../project/XWIKI/versions`) to drive the branch decision (xwiki-backport §1: a branch needs the
test only if the fix landed after that branch was cut and is not already released on its line).
(Network calls redirected under context-mode: run them via `ctx_execute`/`ctx_fetch_and_index`.)

## Backport it — via xwiki-backport

Follow **xwiki-backport** end to end. Two testneeded-specific touches on top:
- Add `--label testneeded` to the `gh pr create` command (create the label once if missing:
  `gh label create testneeded ...`).
- These are test-only changes, but the adapt-to-branch checks still apply in full — in particular a
  new `*-test-docker` / `*-test-pageobjects` **module** hits the pom-version trap (xwiki-backport
  §3.A) even on a clean cherry-pick, and page-object code copied from the source branch can hit the
  Java-level trap (§3.B). Do not skip them because "it's just a test".

## `@since` on every branch (and master) — the test-specific layer

The **generic `@since` adjustment** — add the target branch's line, keep the block identical on every
branch (master/source included), decide the lines empirically and ascending, the durable format — is
**xwiki-backport §3.D**. Apply it. This section adds only what is specific to `testneeded` tests:

Scope — what carries `@since` for a test backport (see `xwiki-knowledge` → versioning):
- **The test tools do**, since they are reusable code other tests call: a new page object under
  `*-test-pageobjects/src/main/java`, or a new test-framework/test-helper class — **and** any new
  member added to an existing one.
- **The tests don't**: IT/unit test classes (`src/test/**IT.java`, `*Test.java`) are not reusable, so
  no `@since`. If the issue only adds tests and touches no test tool, there is **no `@since` work at
  all**.
- Never *invent* an `@since` the source branch didn't have — carry over what master has, and add one
  line per branch where the element becomes available.

Concretely, deciding the lines for a new class or member (the §3.D empirical check, made explicit
here): keep the element's existing original `@since` from master; if it is **absent** on
`origin/stable-17.10.x` → add `@since 17.10.10`; if **absent** on `origin/stable-18.4.x` (and the
issue was backported there) → add `@since 18.4.3`; if it already exists on a branch, do not re-add
that branch's line.

Apply the identical edit on **each backport branch** (an extra commit on the existing PR branch — it
updates that PR) **and on master** (the "source branch also carries it" half of §3.D). The master
change is a **single commit whose subject = the original commit title** (body noting the `@since` was
adjusted), on a `backport/master/XWIKI-nnnnn` branch, opened as its own master PR. For several issues
at once, fold all their master `@since` edits into one consolidated master PR.
