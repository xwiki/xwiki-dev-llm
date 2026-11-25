# Verifier brief

Give this file to each verifier sub-agent with: `plan.json`, the `result-after.json` and
`result-before.json` of its testers, the run directory (screenshots, videos, logs), the version
proofs (`versions-<phase>.png`), the evidence level, and the tracker's severity scale and filing
policy (what is a regression, what is pre-existing). Not the testers' conversation, not the code.

Evidence is mostly text — the element's text or a scoped snapshot, logs — with screenshots where
the level asks for them. Text evidence that shows the expected result is enough for a content
check; a visual check needs its screenshot. Open the screenshots of failures, findings and visual
checks, and a baseline screenshot only when its text evidence does not settle the check; keep long
logs out of your context (search them for the lines you need).

The before-phase results are `unjudged`: a script, or a replayer that does not judge, replayed the
check, and you are its only judge — so judge the before outcome as carefully as the verdict.

## Your job

You did not run the tests. Decide, from the evidence alone, whether each check, verdict and finding
holds. A tester can be wrong in good faith: it read the wrong element, took a screenshot before the
page finished loading, judged a value it expected rather than the one shown, tested a slightly
different scenario than the plan's, or named a screenshot after something it doesn't show.

## Per item

1. Read the item's expected result and `baselineHasBug` in the plan, and check the version proof of
   each phase.
2. For each check, open its before and after evidence, and check that each file shows what its
   name and the check say. Judge the check: `ok` (fixed: bug before, expected result after), `failed`
   (the after evidence shows the bug or another wrong result), `unproven` (no bug before, while the
   plan expects one: the check does not detect the bug), `unverified` (evidence missing or
   ambiguous: say what), `blocked` (the evidence shows an environment failure). A confirm check of an
   item whose `baselineProof` names an automated test has no before evidence: judge its after
   evidence, and whether the quoted assertion checks the same behaviour at the same level (the
   test's source is the one piece of code you may open, to confirm the quote).
3. Judge the item: `verified` when its checks are `ok`; `failed` when one is `failed`; otherwise
   `unverified` or `blocked`. When `baselineHasBug` is false, judge on the after phase alone and say
   "not proven against a baseline". Never upgrade a tester's verdict on reasoning alone.

A negative claim ("no request sent", "no error") holds only with a saved network or console log; a
log line cited in free text with no saved file is partial evidence.

## Per finding

Check that the evidence shows the actual result and that the steps plausibly lead there, claim by
claim: a finding can be kept for one claim and dropped for another. Keep it, mark it `doubtful`
(evidence weak, say why), or drop it (evidence contradicts it). Check its before-phase result
(regression or pre-existing) and its severity against the tracker's scale; a severity may be
conditional ("Major if the parameter is meant to exist, else a documentation fix"). Check that
nothing security-sensitive is in a title or text meant for a public tracker.

## Result

Write `<run>/verifier-<testers>.json` (e.g. `verifier-t1-t2.json`): per item
`{item, testerVerdict, verdict, reason, checks: [{id, before: bug | ok | other | blocked | proven
by test, verdict, reason}]}`, per finding `{id, before: present | absent | different, decision:
kept | doubtful | dropped, reason, severity, classification}`, and `observations`:
problems you see in the evidence that no tester reported. Be terse and concrete: "screenshot
XWIKI-12345-after-03 shows the newest attachment first" is a reason; "looks fine" is not.
