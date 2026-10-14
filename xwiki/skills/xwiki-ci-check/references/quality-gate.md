# A failing Sonar quality gate

Read by `xwiki-ci-check` (SKILL.md §3) when an incident is `sonar-gate:failed`, before writing its
*Why* and *Next* cells, commenting on it (§4) or handing it to `xwiki-fix-sonarqube-issue`. §
numbers are those of SKILL.md.

| Field | Meaning |
|---|---|
| `sonar` | on a quality-gate incident: the failing conditions with their actual and wanted values, the new-code period, the newest issues under them (file, line, rule, severity, the day it was raised, the line's author by GitHub login, the commit that last touched that file) and `culprits`, the people whose code is under the failing condition |

**Sonar quality-gate failures (`sonar-gate:failed`): the build is red for everyone, so this is the
run's *first* fix, not a line in a report.** It blocks every release on that branch until it is
cleared, which is why it outranks any flicker (§5). Hand the fixing itself to
**`xwiki-fix-sonarqube-issue`** — per-rule correctness lives in `okf/sonarqube/` and a mechanical
"fix" there silently breaks things — but in a routine, open its PR with `pull-request.mjs --kind
fix` like every other (§5), never with the `gh` that skill names. It is a fix PR, so it takes one of
the run's two slots: the brake is the reviewers' load, whatever the PR fixes.

**The report says who caused it, and the sweep has already found out.** The Jenkins log cannot —
it says `QUALITY GATE STATUS: FAILED` and stops, which is why `blame` is `none` here — but
SonarCloud holds the failing condition, the new-code issues under it, and for each one the file,
the line, the rule, the day it was raised and usually the SCM author of that line; the sweep reads
that into **`sonar`** and asks GitHub which commit last touched each file by that day. Report what
is in the field, and do not go querying for more: the condition and how far off it is, the newest
issues that fail it, and `sonar.culprits` — the people whose code is under it. SonarCloud records an
author as an email address; the sweep turns it into the GitHub login of a commit carrying it, or
keeps only its local part, so an address never reaches the room (and `matrix.mjs` refuses one).

**One name or none.** `sonar.unequivocal` is true only when every commit that touched any of the
gate-causing files in the two days before the analysis is by the *same* author and SonarCloud
attributes the lines to at most one person; then `blame` is `likely`, and §4 comments — on
`commentable`, which is the pull request when the commit had one, unless another incident blames
that commit too: then it is the commit, and one comment answers both (§4). Two names anywhere — two
people's changes both under the gate, or a line author who is not the committer — and
`sonar.equivocalBecause` says which, the blame stays `none`, and the room hears about it instead.
A file with **no** commit in that window took no part in the decision: the issue is a new rule run
over an existing line, and nobody caused it.

Wording is `likely`, never more, whatever the tool says: the gate went red when an analysis ran,
not when the commit landed, and an author of a line is not automatically the author of a failure.

Absent `sonar` means the token was missing or SonarCloud refused —
`summary.sonar.unavailable` says which, and then the gate is reported without its cause.

**On an old cycle-2 branch the gate itself is usually the bug.** A branch that only receives
backported security fixes should not be failing a quality gate at all, and the fix is to stop that
branch running (or failing) the gate rather than to chase its issues. That is a change to the
branch's CI configuration and a proposal to the team — say so in the paste and in the digest, and
do not make it here.
