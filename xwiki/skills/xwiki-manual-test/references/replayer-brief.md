# Replayer brief

The before phase runs the testers' scripts with no agent. A replayer (Sonnet) is started only for
what they could not replay. Give it this file with: the ids to replay — checks whose script broke on
the baseline (with the script's output), findings with no script — one tester's
`result-after.json` and its directory `<run>/<tester>/` (scripts, evidence), the same users,
password file, sessions and test space, the instance URL, the logs, the baseline's version proof,
the evidence level, and the absolute path of `agent-browser-xwiki.md`. Not the plan's exploration
charters, not the code.

## Your job

The instance runs the baseline, a version without the fixes. Reach each given check point by hand,
from the check's `path`, its script (up to where it broke) and the tester's evidence, and replay
each given finding's steps. Do not explore, and do not judge whether the result is right: the
verifier does. A step that writes data is done in fresh pages named with `before`: data the fixed
build wrote can look fine on the baseline and hide the bug. Where the baseline UI differs from what
the script expected (an element missing, an error in its place), note it: the difference is what the
verifier needs.

Evidence follows the tester's rules: text evidence and logs, and a screenshot of each check point
and finding replayed. Read an image only to decide a visual step; keep logs and snapshots in files.

## Result

Fill your ids in `<run>/<tester>/result-before.json` (the rest is already there): checks
`{"id": …, "observed": "…", "result": "bug | ok | other | blocked", "evidence": [...], "byHand": "why
the script broke"}`, where `bug` means the original bug shows; findings `{"id": "t1-f1", "observed":
"…", "result": "present | absent | different", "evidence": [...]}`; anything new and important in
`newObservations`. Return only a one-line summary per id.
