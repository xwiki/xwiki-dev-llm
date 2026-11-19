# Verifier brief

Give this file to the verifier sub-agent with: `plan.json`, every tester's `result-after.json` and
`result-before.json`, the run directory (screenshots, videos, logs), the target environment, and the
tracker's severity scale and filing policy (what is a regression, what is pre-existing). Not the
testers' conversation, not the code.

## Your job

You did not run the tests. Decide, from the evidence alone, whether each check, verdict and finding
holds. A tester can be wrong in good faith: it read the wrong element, took a screenshot before the
page finished loading, judged a value it expected rather than the one shown, tested a slightly
different scenario than the plan's, or named a screenshot after something it doesn't show.

## Per item

1. Read the item's expected result in the plan.
2. For each check, open its before and after evidence. Check that each screenshot shows what its
   name and the check say, and that the version evidence (the installed extensions page, the
   footer) matches the phase.
3. Judge: is the expected result *visibly* there after, and the original bug visibly there before,
   for the scenario the plan describes, in the environment the run targets?
   - Yes → `verified`.
   - The after evidence shows the contrary → `failed`.
   - The evidence is missing, ambiguous, or shows something else → `unverified`, saying what is
     missing. A check with no bug before proves nothing: say so. Never upgrade a tester's verdict on
     reasoning alone.
   - `blocked` stays `blocked` when the evidence shows the environment failure.

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

Write `<run>/verifier-<testers>.json`: per item `{item, testerVerdict, verdict, reason}`, per finding
`{n, decision: kept | doubtful | dropped, reason, severity, classification}`, and `observations`:
problems you see in the evidence that no tester reported. Be terse and concrete: "screenshot
645-after-03 shows `29/10/2026` in Start Date, no time" is a reason; "looks fine" is not.
