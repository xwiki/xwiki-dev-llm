# Backtest results

Everything the pipeline's thresholds are set from. Regenerate with:

```bash
python3 eval/fetch_labeled.py        # → eval/labeled.json  (360 bugs, 60 per resolution)
python3 eval/fetch_closed_targets.py # → eval/closed_targets.json  (closed-target guards)
python3 eval/backtest.py             # → the tables below
python3 eval/backtest.py --judge claude   # → the same tables for Claude (see "Other judges")
```

## The set

360 XWiki bugs that a committer resolved with an explicit resolution — 60 each of
`Duplicate`, `Solved By`, `Cannot Reproduce`, `Invalid`, `Won't Fix` and `Fixed` — all
created ≥3 years and resolved ≥1 year before sampling. **Ground truth is the committer's
own verdict**, which is the closest thing available to "what should this pipeline have
recommended".

Two controls that matter when reading any number below:

- **Leakage.** The comment where someone writes *"duplicate of X"* is posted at closing
  time, so every comment from 24h before the resolution onward is stripped. The model
  sees what a triager would see at the start of a BFD day, not the answer.
- **Base rate.** The sample is balanced; the project is not. Every precision figure is
  reweighted to XWiki's real historical mix (8681 Fixed vs 3441 closed without a fix, so
  **28%** of resolved bugs were closed without a fix). Unweighted, the same tables read
  about 20 points higher and mean nothing.

**Known bias, which bounds all of this:** the set is *resolved* bugs. The still-open
backlog is by construction the residue nobody closed and is probably harder. Treat these
as an upper bound; the live pilot is what confirms them.

## Close bar — `P(cannot_reproduce) + P(invalid) + P(wont_fix)`

Against "a committer closed this without fixing it".

| threshold | share of backlog selected | precision |
|---|---|---|
| ≥ 0.90 | 2.1% | 95.1% |
| **≥ 0.80** (`CLOSE_BAR`) | **3.7%** | **94.4%** |
| ≥ 0.70 | 5.9% | 87.8% |
| **≥ 0.60** (`SUGGEST_BAR`) | **8.6%** | **86.8%** |
| ≥ 0.50 | 14.2% | 64.0% |

The cliff between 0.60 and 0.50 is why the suggest bar sits where it does.

## Quick-win bar — `P(fix)` (no longer used for quick wins)

Against "a committer fixed it". Kept as a record: quick wins are now selected on fix
effort alone (`triage.MAX_EFFORT`), because a BFD day is about fixing as many bugs as
possible, not the ones most worth fixing. That is a decision, not a measurement, and
`fix_effort` has no ground truth in this backtest — the quick-win list is jev's estimate
of cost, ranked cheapest first.

| threshold | share of backlog | precision |
|---|---|---|
| ≥ 0.80 | 10.6% | 90.5% |
| **≥ 0.70** (`FIX_BAR`) | **31.0%** | **88.5%** |
| ≥ 0.60 | 50.5% | 87.4% |

Precision is flat across this range, which is part of why dropping it cost nothing
measurable.

## Per-question discrimination (AUC vs "closed without a fix")

0.50 means no signal. Below 0.50 means the question points the other way, which is just as
useful — `still_applies_today` at 0.34 is a strong *inverted* signal.

| question | AUC | used for |
|---|---|---|
| `is_expected_behaviour` | 0.73 | Invalid |
| `environment_bound` | 0.70 | Cannot Reproduce |
| `niche_edge_case` | 0.64 | Won't Fix |
| `evidence_already_addressed` | 0.62 | Won't Fix / superseded |
| `targets_removed_subsystem` | 0.62 | Inactive (never on its own — see `triage.py`) |
| `still_applies_today` | 0.34 (inverted) | guard on every close |
| `unresolved_debate` | 0.50 | downgrade flag only (0.61 for Won't Fix specifically) |
| `impact`, `fix_effort` | 0.45 / 0.48 | quick-wins ranking, not closing |
| `has_repro_steps` | 0.41 | comment drafting only |

`has_repro_steps` deserves a note: it does **not** predict `Cannot Reproduce`. In XWiki
that resolution means "we tried and could not", not "the reporter gave no steps". It stays
in the bank because the drafted comment has to say which detail is missing, and it is
explicitly excluded from the decision.

Two questions were dropped after scoring ~0.5 on everything: `is_defect` and
`report_completeness`.

## Duplicate detection

Measured against 73 bugs a committer had explicitly linked with a `Duplicate` link.

**Retrieval is the bottleneck, not judgment.**

| retrieval | true target in the shortlist |
|---|---|
| previous (25 hits, unordered, difflib on summaries) | 22% |
| Lucene OR over `text`, 300-deep pool, IDF rerank, top 10 | 40% |
| same, measured over the whole 400-deep pool | 73% |

**Selection is strong.** Given a shortlist that contained the real target, jev picked it
**15 times out of 18 (83%)**.

Precision against the committer's exact linked key is ~44% at confidence ≥ 0.6, but that
number understates the truth: hand-checking the "wrong" picks showed most were genuine
members of the same duplicate cluster and simply not the key that got linked (for example
`XWIKI-19661` → `XWIKI-19662` where the committer had linked `XWIKI-19639`). A few were
plainly wrong. This is exactly why a `Duplicate` close is **proposed for review and never
applied unreviewed**, and why a target that is itself resolved `Duplicate` is downgraded
to a suggestion rather than cited.

### Closing against a target that is already closed

A Duplicate close against a closed target borrows that target's verdict: "this is fixed"
for a Fixed one, "this was decided" for a Won't Fix one. The first pilot borrowed a verdict
that did not apply twice:

- **XWIKI-5612 → XWIKI-12525** (Fixed 2015), although a 2023 comment had reproduced
  XWIKI-5612 on a current version: related bugs, but the target's fix had not fixed it.
- **XWIKI-11441 → XWIKI-6550** (Won't Fix 2014). XWIKI-11441 is the specific case a
  committer split out of 6550 when he closed it, linked `Related`, and confirmed in 2021
  as still accurate.

Two guards now withhold such a close; the lead stays in the report as a suggestion. Both
are measured on `eval/closed_targets.json` (same leakage control as above: comments
from the day before resolution onward are dropped):

- **dup_of_Fixed** (250): bugs a committer closed Duplicate / Solved By against a Bug
  resolved Fixed before them. Closing was right; withholding one costs volume.
- **outlived_Fixed** (164): bugs a committer later fixed on their own, linked
  `relates to` a Bug resolved Fixed ≥30 days earlier. Closing against that target would
  have been a wrong close.

**Existing link** (`triage.already_linked`). If a committer already linked the bug and its
target by anything other than Duplicate, they have already judged the two distinct. Of
1750 pairs linked `Related`, **8 (0.5%)** were later closed as each other's duplicate. Of
259 real duplicates of a closed target, 13 (5%) also carried such a link and would have
been withheld.

**Fix date** (`triage.outlived_fixed_target`), Fixed targets only. The bug must show no
life after the fix: not reported, and not commented on, more than
`FIXED_TARGET_GRACE_DAYS` after the target was resolved.

| grace | outlived the fix: caught | real duplicates: withheld |
|---|---|---|
| 0 days | 90% | 39% |
| **30 days** (`FIXED_TARGET_GRACE_DAYS`) | **82%** | **17%** |
| 90 days | 57% | 10% |
| 180 days | 46% | 5% |

Security-restricted issues are excluded from this set (`level is EMPTY`), because it is
published: 4 rows involving one were dropped, which moved no figure by more than a point.

30 days is one release cycle: until the fix ships, people still report and discuss the
old behaviour. The 18% it misses show no sign of life at all (no comment, and reported
before the fix), so dates alone cannot catch them. That residue is why every Duplicate
close is still reviewed by a person.

**No date guard for Won't Fix targets.** Only 26 Won't Fix bugs in XWiki's whole history
have ever been duplicated (9 usable in this set). That is too few to set a threshold from,
and a threshold with no measurement behind it is a regression. The existing-link guard
covers the XWIKI-11441 case.

On the live 200-bug cohort the two guards withheld 12 of the 16 Duplicate closes that cited
a closed target. A drafted comment against a Fixed target now names the version that
fixed it. Against any closed target it no longer says "follow X for updates".

## Other judges: Claude, for developers without a TypeSafe key

`lib/claude_judge.py` answers the same question bank through the `claude` CLI, in jev's
answer shape. Its probabilities are not jev's, so its bars are measured separately, and
`triage.JUDGES` lists, per judge and exact model, the close resolutions it passed for.

**claude-sonnet-5**, 2026-09-24, on the same 360 labelled bugs. 348 were scored fresh for
$13.44, about $0.04 a bug, so a 200-bug cohort costs about $8. The real close rule was
applied to both judges: the no-fix bar plus the `still_applies_today` guard.

| no-fix bar | jev: bugs, weighted precision | Claude: bugs, weighted precision | committer-fixed bugs selected (jev / Claude) |
|---|---|---|---|
| 0.90 | 23, 94.7% | 6, 100% | 0 / 0 |
| **0.80** | **39, 97.0%** | **25, 100%** | 0 / 0 |
| 0.70 | 62, 87.5% | 49, 95.4% | 0 / 0 |
| 0.60 | 87, 86.5% | 73, 92.4% | 0 / 0 |

Claude is as precise and more conservative. Its stated probabilities bunch in the middle,
so fewer bugs clear a bar. They are reasonably calibrated where it matters: 88% of bugs it
put at 0.6–0.8 "closed without a fix" really were, and 97% at 0.8–1.0. At 0.80, 18 of its
25 picks are also jev picks. The per-question AUCs are close to jev's. `still_applies_today`
is weaker (0.40 against 0.34) but still points the right way.

What it was enabled for, and why not more:

- **Cannot Reproduce / Invalid / Won't Fix: enabled at jev's 0.80.** The bar was reused,
  not re-tuned on the data it is judged on. With 0 harmful selections out of 25, the upper
  bound on the harmful rate is still roughly 12%, the same kind of uncertainty jev's 39
  carry. The live pilot confirms or refutes it.
- **Inactive: not enabled.** Claude's answers trigger the Inactive rule on none of the 360
  bugs (jev's trigger it on 8, none fixed), so there is nothing to measure. Yet it fired on
  2 of the first 10 live bugs.
- **Duplicate / Solved By: not enabled.** Its duplicate selection has not been measured;
  there is no duplicate-selection backtest for either judge yet.

The permission is keyed to the canonical model that answered (`claude:claude-sonnet-5`),
not to the `sonnet` alias. A newer model behind the alias, another `CLAUDE_JUDGE_MODEL`,
or a scores file mixing models gets no close at all until it is measured.

## What this replaced

The previous pipeline, on its 40-bug pilot: **2 proposed closes**, 6 escalations, 31
auto-keeps. 31 of 40 candidates never reached any judgment at all — the mechanical
sign-of-life veto removed them first, 22 of those for having more than one watcher.

Two things were wrong with that.

1. **`description` was missing from the JIRA field list in `fetch_candidates.py`**, so
   every one of those 40 bugs was judged on its one-line summary. All 40 had an empty
   `description` in `candidates.json`; all 40 have a real description in JIRA.
2. **The watcher veto is backwards.** Among historically-resolved old bugs: 26% of those
   with 0–1 watchers were fixed, 4% at two watchers, **0% at three or more**. Watchers
   accumulate on issues that get discussed and superseded. The veto was removing the
   candidates most likely to be closeable.

Rerun on the oldest 200 open bugs, the rebuilt pipeline proposes **21 closes, 67 quick wins
and 62 suggestions**. Before the closed-target guards it was 32 closes, and before quick
wins went effort-only it was 8 quick wins.
