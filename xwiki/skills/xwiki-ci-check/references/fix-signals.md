# An open PR, a fix on another branch, a closed flicker issue

Read by `xwiki-ci-check` (SKILL.md §3) when an incident's `fixState` is `fix-in-flight` (a
`candidate`) or `fixed-elsewhere`, or it carries `jiraClosed` — before deciding its line or writing
its *Next* cell. § numbers are those of SKILL.md.

| Field | Meaning |
|---|---|
| `jiraClosed` | a **closed** flicker issue naming this exact test — the fix already exists. Carries `fixVersions` and `earlier`, the older issues filed for the same test. Never suppresses anything; see below |

**An open PR is a candidate, never an answer on its own.** `fix-in-flight` (`candidate: true`) is
a class name found in a PR's title or body, so the incident stays live and you decide: read the PR's
title, changed files and, if needed, its diff. It answers the incident only if it changes what
makes *this* failure fail — the code under test, the page object, the broken line; then treat the
incident as answered (one line, no write). A PR that adds or extends tests does not: drop the
candidate line from the paste.

**`fixed-elsewhere` is a backport candidate, and that is all it is.** The same signature was red on
another maintained branch and is green there now, and the tool names the commit that did it — the
one fact nobody reading three branches' dashboards side by side at 06:00 was ever going to notice.
Hand that sha to **`xwiki-backport`**, and **never open the backport here**: it needs the adaptation
to the older branch and the verification that skill exists for, and what this pass is worth is the
noticing. Verify before backporting, because a signature also goes green when the test is *deleted*
on that branch — for a test the tool excludes that by construction (it must still have *run* there,
having failed and then passed in two consecutive builds each way), for a build break it cannot.

**`fixed-elsewhere` only sees inside the window, and `jiraClosed` is how the older fix is found.**
That value needs a red→green edge in the eight builds Jenkins retains, so it answers "has somebody
just fixed this elsewhere?" and cannot answer "was this fixed elsewhere months ago and never landed
here?" — on the branches that carry the fix there is no failure in the window at all, so there is no
edge to see. `jiraClosed` closes that gap from the other side: a **closed** flicker issue naming the
failing test means the fix exists and has been reviewed, merged and released somewhere. Read it by
comparing its `fixVersions` with the branch that is red, which is a judgement the tool deliberately
does not make — encoding version-line arithmetic here would turn a guess into an assertion that
sends somebody to do a backport nobody needed:

- **no `fixVersions` entry on this branch's line** ⇒ the fix never shipped here. This is a
  **backport candidate**: name the issue and hand it to **`xwiki-backport`**, which owns the
  adaptation and the verification; never land it here. It is also the strongest thing a run can
  produce, because the change already exists and the other branches have been running it.
- **an entry that does cover this branch** ⇒ the fix is here and the test fails anyway. The issue is
  wrong, not missing: **comment on it** and file nothing; it is released, so it is never reopened
  (`okf/servers/jira.md`, "Whether to file an issue at all"). An `earlier`
  list is the same signal repeated — a test filed three times is one that keeps coming back, and
  saying so is worth more than a fourth issue.

`jiraClosed` **never suppresses**. Every `fixState` value buys silence; this one buys work, so it
raises the incident rather than quieting it, and it is the `Next` cell's business to say whose.

**Not every branch is a backport target, and the report must not invent one.** Which lines are, and
which one may never be named in a public artifact, is `okf/processes/release.md`. What follows from
it here: a `jiraClosed` gap on an unsupported line is still reported in the paste and the terminal,
which are internal, and is actionable only as a keyless `[Misc]` fix on the branch itself.
