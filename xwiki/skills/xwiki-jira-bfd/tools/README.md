# xwiki-jira-bfd tools

The pipeline behind the `xwiki-jira-bfd` skill. This file is for **changing** the tools;
`../SKILL.md` covers running them. Python 3, **standard library only**: no dependencies
and no build step.

## How it decides

The pipeline keeps three things apart, and that separation is what makes it tunable:

1. **Evidence** (`fetch_candidates.py`). Each bug's summary, **description**, comment bodies
   and community signals. An entry is self-contained: nothing downstream calls JIRA to read
   an issue. If you touch its `FIELDS`, keep `description` and `comment` in it. Without
   them every later stage judges a bug from its one-line summary, which is what the first
   version of this tool did.
2. **Judgment** (`lib/questions.py`, `score_issues.py`, `enrich_duplicates.py`). A judge
   answers about 11 narrow typed questions per bug and returns **probabilities**, never
   prose. The judge is [jev](https://docs.typesafe.ai) when `TYPESAFE_TOKEN` is set. Without
   it, `lib/claude_judge.py` answers the same bank through `claude -p` in jev's answer shape.
   `lib/judge.py` chooses between them.
3. **Policy** (`triage.py`). Plain arithmetic over those probabilities: thresholds, guards
   and templated comments. Every threshold carries a comment saying what it buys, measured.

`make_report.py` renders the result. `apply.py`, the only writer, performs the approved
closes.

## Bars are measured per judge, per exact model and per close resolution

`triage.JUDGES` lists, for each judge, the close resolutions its own
`eval/backtest.py --judge <name>` passed the pilot gate for (≥ ~90% close precision, zero
safety misses). A close whose resolution the judge is not listed for becomes a suggestion.
Keys are `jev` (any version) or `claude:<canonical model>`, so a newer model behind the
same `sonnet` alias has no entry until it is measured. Today:

| judge | may close as |
|---|---|
| jev | all six resolutions |
| `claude:claude-sonnet-5` | Cannot Reproduce, Invalid, Won't Fix |

The gate is enforced three times: in `classify()`, again in `triage.py`'s invariant pass,
and again per row in `apply.py` (`judged_by`). That way a hand-edited `review.json` cannot
reintroduce a close nobody measured.

## Run it from a checkout

```bash
export JIRA_API_TOKEN="..."      # jira.xwiki.org PAT
export TYPESAFE_TOKEN="..."      # optional; without it the judge is Claude
python3 fetch_candidates.py --cohort 5yr --limit 200
python3 score_issues.py
python3 enrich_duplicates.py
python3 triage.py
python3 make_report.py           # → results/report.md
python3 apply.py                 # dry run
python3 -m unittest discover -s tests -t .   # offline; needs no token
```

Results go to `$BFD_RESULTS_DIR`, or to `results/` next to the tools when it is unset.
Every step checkpoints there, so the pipeline is resumable, and `score_issues.py` and
`enrich_duplicates.py` skip work already done.

## The backtest

```bash
python3 eval/backtest.py                  # jev
python3 eval/backtest.py --judge claude   # Claude (about $15 for the full set)
python3 eval/fetch_labeled.py             # rebuild eval/labeled.json from JIRA history
python3 eval/fetch_closed_targets.py      # rebuild eval/closed_targets.json
```

`eval/labeled.json` (360 resolved bugs) and `eval/closed_targets.json` are the ground truth
the thresholds are set from. They are checked in so the backtest reproduces without a JIRA
round trip. Answer caches go to `$BFD_RESULTS_DIR/eval/`. The numbers, and the reasoning
behind every threshold and guard, are in [`eval/RESULTS.md`](eval/RESULTS.md).

## Conventions that must be preserved

- **The tools never write to JIRA on their own.** Analysis produces an editable
  `review.json` and a report. `apply.py` writes only with `--apply` and a typed
  confirmation.
- **Dispositions are exactly `{close, suggest, quick_win, keep, escalate}`**, and `apply.py`
  writes **only** `close`. `suggest` is report-only by definition.
- **Close resolutions are `{Duplicate, Solved By, Cannot Reproduce, Won't Fix, Invalid,
  Inactive}`**, shared between `triage.py` and `apply.py`. Change one, change both.
- **Approval = presence of a `close` row in `review.json`.** Rejecting a close means
  deleting its row or changing its disposition. Never add an auto-apply path.
- **`triage.py` re-checks its own invariants** and downgrades anything that slipped
  through. That check is how a bug in `classify()` surfaces instead of reaching JIRA.
- **A `target_issue` may only be a key retrieval actually found.** Each judge picks from a
  list: jev through its Choice, Claude through a JSON schema that admits only the listed
  keys.
- **Thresholds are evidence-backed, not taste.** If you change one, or add a model or a
  resolution to `triage.JUDGES`, re-run `eval/backtest.py` and update the number beside it
  and in `eval/RESULTS.md`.
- **Drafted comments are templates, not generated prose** (`triage.draft_comment`). They
  go to real people, sometimes fifteen years after they reported the bug.
- **Grounding is curated.** `grounding/rewrites.md` and `support-strategy.md` are
  human-reviewed. `lib/questions.XWIKI_CONTEXT` mirrors `rewrites.md`, so keep them in step,
  and never invent an entry.
- **A wrong close is the only real harm.** Recall is irrelevant: a bug wrongly kept simply
  stays open. A change that trades precision for volume needs a number, not an argument.
- **Secrets.** `lib/jira.py`, `lib/jev.py` and the `claude` CLI hold the only credentials,
  and a token is only ever placed in an `Authorization` header, never printed or logged.
