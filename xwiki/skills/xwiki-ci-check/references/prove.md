# Proving a blocker's culprit in the stabilisation slot

Read by `xwiki-ci-check` (SKILL.md §5) when `summary.stabilise.prove` names an incident, before
running anything for it — in a local run, once the developer has said yes to starting: it holds
port 8080 and Docker for up to an hour. § numbers are those of SKILL.md.

**Why the slot goes here.** A morning with a release blocker open stabilises no flake, so the slot's
hour is free — and it is what one functional test's proof costs. The tool picks the incident: a
deep, release-blocking test breakage whose culprit was asked at least two mornings ago (`unanswered`)
and has not replied on the commit, not tried in the last week. "Could you check?" has not worked;
a proof either states the cause or drops the suspicion. Never pick another incident.

**The goal: show whether the failure comes with the culprit.** Run the failing test (`prove.test`)
at `prove.sha` and at its parent, on `prove.configuration` — the browser, database and servlet
container where it fails most often, on any branch it is red on — with everything else equal. When
`prove.branch` is another branch than the incident's, the culprit there is its copy on that branch
(the commit carrying the same issue key).

What you cannot guess:

- **When the culprit changed the failing test too, a clean parent separates nothing**: the parent's
  test lacks the new steps. Run the culprit's version of the test against the parent's production
  code instead — failing there, the test (or an older product bug it now reaches) is at fault; clean,
  the commit's production change is. That is still a `reproduced` proof of the commit.

- **Build what the culprit changed, at each revision.** A Docker test resolves the production
  modules it does not build from the local repository or the last deployed snapshot, so running
  only the test module at the parent tests the culprit's code twice — the Environment Tests trap in
  reverse (`okf/servers/jenkins.md`). How to run one test: `okf/testing/running-docker-its.md`.
- **A breakage that is not 100% needs repeats.** A clean parent means something only after
  `prove.parentRuns` clean runs (`n ≥ ln(0.05) / ln(1 − r)` at `prove.rate`; 27% → 10). Repeating
  the test may need a local harness change; it is never committed.
- **Bound it by running, not by estimating.** Start, and stop at the hour with what ran: a partial
  result is evidence, not a proof. Then render the paste with `--proof-ran`, which records the
  attempt; a proof never started leaves no record, and the slot comes back to it the next morning.

Then, and only then:

| Result | What follows |
|---|---|
| Fails at the culprit with the CI symptom, `n` clean runs at the parent | **Reproduced.** One follow-up comment on the commit — `commit-comment.mjs --incident <id> --sha <sha> --proof reproduced --why "<k/m at the culprit, 0/n at its parent, on <configuration>>"` — stating the cause (`references/commit-comment.md`). A fix PR follows the usual rules (§5, `references/fix-prs.md`) if the run sees the fix. |
| Fails at the parent too | The culprit is not it. No comment; the paste says so, with the runs, and the *Next* cell sends the incident back to analysis. |
| Clean at both, or too few runs | No proof either way. No comment; the paste gives the runs. |

The tool refuses any comment on this commit without `--proof reproduced`: it was asked once, and a
second message is the proof or nothing. Fill the row's `COMMENT` and `DONE` markers with the result
(`references/paste.md`, `references/digest.md`). With `--proof-ran` the run memory records the
attempt, so the slot does not return to this incident for a week, whatever the result.
