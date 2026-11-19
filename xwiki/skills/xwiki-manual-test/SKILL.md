---
name: xwiki-manual-test
description: Manual (acceptance) testing of XWiki features end to end, as an expert QA tester using the UI like a user - verify that fixed issues really work, prove each check detects its bug by replaying it on a baseline version without the fix (before/after), and hunt for the problems around them (functional, layout, page errors, untranslated text, accessibility). Use when asked to manually test, QA, acceptance-test or "verify the fixes of" a release, an extension version, a list of issues or a test.xwiki.org manual test plan. Asks for the scope, environment and baseline each run, tests through parallel blind tester sub-agents, has an independent verifier re-judge the evidence (video, screenshots, logs), and writes a local report; nothing is posted without approval. Not for writing automated tests (use xwiki-test-guidelines), nor for a before/after screenshot of one UI fix (use xwiki-capture-ui-change), nor for deploying an extension alone (use xwiki-deploy-extension).
---

# Manual testing of XWiki features

## What this is for

The deliverable is **a trustworthy verdict per tested item** — verified, failed, blocked or
unverified — and **the problems found around it**, each with the evidence a developer needs to act.
A verdict is trustworthy only when someone who did not run the test can check it from the evidence,
and when the same check **fails on a version without the fix**: a check that passes on both proves
nothing. That is why every check has a before and an after, every scenario is recorded, and an
independent verifier re-judges it before the user sees anything.

The tester is an expert manual QA tester: it uses the product through the UI as a user would, does
what the issue says should now work, then deliberately tries to break what surrounds it. Testing
only the happy path of the issue's description is what automated tests already do.

## Never, whatever the run

- **Post nothing** — no issue, comment, reopen, label or attachment, on any tracker or forum —
  without the user's explicit OK on that exact text. Drafts never carry security details: a
  security-sensitive finding is reported to the user only, flagged as such, and its evidence stays
  out of any hosted report.
- **Never modify content the run did not create**, and never stop, reconfigure or switch the
  versions of an instance this session did not start without asking. A wiki-wide setting a scenario
  must change is restored afterwards (see "Global scenarios").
- **Nothing is written to test.xwiki.org**: a test plan read from it stays read-only.
- **Never open the `edit` or `inline` action with `curl`** (to probe rights, say): XWiki takes an
  edit lock in that user's name. Check rights through the REST API or the browser, and cancel any
  edit a setup session opened (its lock shows to the testers as "locked by").

## 1. Scope: what to test

**Ask for the scope, every run**, even when the conversation makes it look obvious. It is one of:
all the issues fixed in an XWiki version, all the issues of an extension version (released or not),
a list of issues, or a manual test plan (a test.xwiki.org page, whose model is in
`kb/testing/manual-tests.md`). Resolve it into items through the right tracker: JIRA fix version
(`xwiki-jira`), the repository's GitHub milestone (`gh`), or the given keys. For each issue also
read its linked PRs: their description gives the intended behaviour, their diff the risk areas —
**the diff is read here, by the orchestrator, never handed to a tester** (see step 4). Check the
intended behaviour against what a user can actually reach (the macro's parameter list, the
documentation): a PR description can name an internal parameter no user can set, and testing it
yields false findings.

**Triage every issue and let the user confirm.** Classify each as *manual test*, *covered by
automated tests* (name the tests), *nothing user-visible* (build, test-only, refactoring, dependency
bump) or *not testable here* (needs an environment you cannot build), with a one-line reason, and
show the list. A release can hold a hundred issues; testing all of them wastes the run, and silently
skipping some hides the decision from the user.

## 2. Run questions — ask, never assume

Ask the user, every run, in one round of questions (a question dialog when the host has one):

- **XWiki version(s)**, **database** and **servlet engine** to test on.
- **Browser(s).** The `agent-browser` CLI drives Chrome only; another browser needs another driver
  (e.g. Playwright), so say what it adds in setup and time.
- **The external tool and its version** when the feature integrates one (OpenProject, an LDAP, an
  office server...).
- **The build under test**: a released version, a published snapshot, or a local build of a branch.
- **The baseline** the "before" runs on, with a proposed default: the last release without the
  fixes (the previous final for a bug-fix release; for an RC, the previous RC or the last final).
  An item whose bug came in after the baseline cannot be reproduced there: propose its issue's
  affected version, or mark it `baselineHasBug: false` (new behaviour has no before either).
- **Depth**: *quick* (each item's expected result, errors and text checks), *standard* (plus a
  time-boxed exploration, about 15 minutes of wall clock per item, and the layout and accessibility
  checks on changed UI) or *deep* (plus the other users and the narrow viewport).

Then propose — and wait for an OK on — the split into parallel testers (step 4) with its rough cost.

## 3. Environment, and proof it runs the build under test

Reuse a matching instance already on the machine when there is one; otherwise create it — an
official Docker image (`xwiki:<version>-<db>-<engine>`: MySQL, MariaDB or PostgreSQL on Tomcat) or a
distribution zip (HSQLDB on Jetty) under the work directory — after telling the user what will be
created. External tools likewise (their official image).

**Then prove the instance runs the build under test** before testing anything, and again after each
version switch (step 5): list the installed extensions with their versions and namespaces from a
wiki page, compare them with the expected artifacts, and save that page's screenshot as
`<run>/versions-<phase>.png`, the proof testers and verifier are pointed to. For a local build,
also compare the jars with the built ones entry by entry, not by checksum. A mismatch makes the
whole run *blocked*. How to install, switch versions and avoid a local snapshot losing to a published
one: `xwiki-deploy-extension`.

Tell the user the run directory once: `<work dir>/<repo>/<date>-manual-test-<slug>/`. Everything
the run produces goes there: `plan.json`, evidence, report.

## 4. Plan, then test with blind testers

Write `plan.json` (format: `references/report.md`): for each item, the scenarios — the scripted
confirmation of the expected result first, then the exploration charter (concrete risk areas, the
tours of `references/tours.md` that apply) — the users each needs (Admin always; a simple user and
a guest when what is shown depends on rights), and whether it is **global**.

**Testers are fresh sub-agents, blind to the code.** Brief each with `references/tester-brief.md`
(and the absolute paths of the other references it names) plus its items' steps to reproduce,
actual and expected result (strip any "Cause" or code analysis from the issue text), the PR's
behavioural description, the risk areas, and the **setup facts** a user would know from the
documentation: the connection or instance name to use, parameter value formats (an id or a name),
property ids, how to point a page at a non-default configuration. Never the diff, the fixer's
reasoning, or your own expectation of the bug. A tester who has read the code tests what the
developer thought of; the point is to find what they did not. Missing setup facts cost more than
anything else: a macro that silently renders nothing looks like a bug.

**Parallel testers share one instance.** Each gets its own users (`QATester<n>`, and
`QATester<n>Simple` when rights matter, created by the run), its own browser sessions
(`agent-browser --session <tester>`, `<tester>-simple`, `<tester>-guest`), its own test space
`QA.<date>-<slug>-<tester>` and, for an integration, its own project in the external tool, created
through that tool's API. Split by area so two testers do not exercise the same page. **Keep the
testers alive for the whole run** and resume them with a message for the before phase, so they replay
exactly their own checks; where the host cannot resume a sub-agent, a fresh tester given the
`result-after.json` replays its checks.

### Global scenarios

A scenario that changes shared state would change what the other testers see mid-run: a wiki
preference (date format, language), an extension's administration settings or its default
connection, global rights, the configuration files, and **the external tool's instance-wide
settings**. Prefer a per-page alternative when there is one (link the test page to its own
configuration instead of changing the default). Otherwise mark it global; run global scenarios
alone, after the parallel batch, one at a time, recording the original value and restoring it at the
end of each phase.

## 5. Before and after

Every check runs on both versions, with the same steps and screenshot framing. The order:

1. **After, parallel then global** — on the build under test: confirm and explore (the tester
   brief), each check recorded with an id in `result-after.json`.
2. **Switch to the baseline** (`xwiki-deploy-extension`, one job per extension, dependents first)
   and prove it (step 3). Testers close their sessions and log in again: skin extensions are cached.
3. **Before, parallel then global** — the same testers replay every check (the original bug must
   show: `result: bug`) and every finding's steps (present, absent or different), in
   `result-before.json`. A step that writes data is redone in fresh pages on the baseline: data the
   fixed build wrote can look fine there and hide the bug. No new exploration; something new and
   important goes in `newObservations`.
4. **Restore** the build under test when the instance outlives the run.

A check that does not show the bug on the baseline is reported as such: it does not prove the fix.
**A finding absent on the baseline is a regression of the fix**: a reopen of its issue while
unreleased, else a new blocking issue. Present on the baseline, it is pre-existing: a new issue that
does not block. "Different" is decided per finding: one the original bug masked on the baseline (an
error or an empty table in its place) is a regression. This classification applies to every
severity, since the release decision depends on it.

## 6. Evidence

Every item carries, at minimum (layout and details: the tester brief):

- a **video** per item and phase, per user session it uses;
- a **screenshot at each check point**, in the same framing in both phases;
- each check point's wall-clock time (ISO 8601 with offset), the **browser console, page errors and
  failed requests** saved as files, and the **server log** and external tool log excerpts for its
  time window (with parallel testers, a line that cannot be attributed is reported as such);
- the macro's wiki source for parameter-dependent scenarios; a HAR for findings only.

A finding has: steps to reproduce from a clean state, expected and actual result, the evidence
above, the environment, and a severity on the target tracker's own scale (JIRA priorities; the
repository's priority labels on GitHub). A problem seen once and not reproduced goes in a separate
"observed once" list. Accessibility findings are measured against WCAG 2.2 AA, and only violations
introduced on the changed UI are findings; pre-existing ones are listed apart.

## 7. Independent verification

Before reporting, hand fresh verifier sub-agents `references/verifier-brief.md`, the plan, the
tracker's severity scale and filing policy, the version proofs and the evidence — not the testers'
reasoning. Give one verifier a group of testers small enough for it to open every screenshot. It
re-judges every check, verdict and finding from the evidence alone: a *verified* verdict whose
expected result is not visible becomes *unverified*; a finding the evidence does not support is
dropped or marked doubtful. Report the verifiers' verdicts, and where one disagreed with a tester,
both.

## 8. Report, drafts, clean-up

Write the report as `report/index.html` in the run directory (structure: `references/report.md`),
and publish it as a private artifact when the host can: the findings with their proposal (reopen,
new issue, not a bug), then per item its before/after check table with screenshot pairs and video
links, findings detail collapsed. Little text: the tables carry it.

Prepare drafts — a reopen comment for a regression of an unreleased fix, a new issue per pre-existing
finding, a "verified on <environment>" comment per verified issue — and show them. Post each only
after the user's OK.

Ask before deleting the test spaces, users and external-tool data the run created (keep them while
findings are open, so the user can look), and stop only the instances the run started.

## Re-test

`plan.json` keeps the verdicts. A re-test of the same scope re-runs the items that are not
*verified*, plus a quick check of the verified ones in the areas the new fixes touch, with the same
verification and report.
