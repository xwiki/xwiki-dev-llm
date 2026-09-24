#!/usr/bin/env python3
"""Score every candidate with the judge (jev, or Claude without a TypeSafe key).
Read-only; writes results/scores.json.

This replaces the old "mechanical veto, then an LLM judge on whatever survived" stage.
Every candidate is scored — nothing is filtered out before a judgment is made — and what
comes back is a calibrated probability per outcome rather than a verdict. `triage.py`
turns those probabilities into proposals, so the thresholds live in one place and can be
retuned against `eval/` without re-running anything here.

Why this shape (see eval/RESULTS.md for the numbers):
- One request per issue carrying the whole question bank. jev evaluates the questions in
  parallel, so eleven questions cost barely more wall-clock than one.
- 360 issues x 11 questions took 34 seconds and ~2.5k input tokens per issue, which is
  what makes scoring the entire 1476-bug backlog practical rather than a 40-bug pilot.

    python3 score_issues.py                 # score everything not already scored
    python3 score_issues.py --limit 50      # pilot
    python3 score_issues.py --rescore       # ignore the cache and score again
    python3 score_issues.py --judge claude  # no TypeSafe key: Claude answers (see lib/judge.py)
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
import paths  # noqa: E402
import judge      # noqa: E402
import questions  # noqa: E402

HERE = os.path.dirname(__file__)
RESULTS_DIR = paths.RESULTS_DIR


def load_cache(path, judge_name):
    """Cached scores, refusing to mix judges: their probabilities are not comparable, and
    triage.py applies one judge's thresholds to the whole file."""
    if not os.path.exists(path):
        return {}
    data = json.load(open(path))
    cached = data.get("judge", "jev")
    if data.get("scores") and cached != judge_name:
        raise SystemExit(f"{path} was scored by {cached!r}, not {judge_name!r}. Re-run with "
                         f"--judge {cached}, or --rescore to replace it.")
    return data.get("scores", {})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default=os.path.join(RESULTS_DIR, "candidates.json"))
    ap.add_argument("--out", dest="outfile", default=os.path.join(RESULTS_DIR, "scores.json"))
    ap.add_argument("--limit", type=int, default=None, help="score at most N unscored issues")
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--rescore", action="store_true", help="discard the cache and score again")
    judge.add_arg(ap)
    args = ap.parse_args()
    judge_name = judge.resolve(args.judge)

    candidates = json.load(open(args.infile))["candidates"]
    cache = {} if args.rescore else load_cache(args.outfile, judge_name)
    todo = [c for c in candidates if c["key"] not in cache]
    if args.limit:
        todo = todo[:args.limit]

    print(f"Judge: {judge_name}. {len(candidates)} candidates, {len(cache)} already scored, "
          f"{len(todo)} to score.")
    if not todo:
        print("Nothing to do.")
        return

    missing_desc = sum(1 for c in todo if not c.get("description"))
    if missing_desc:
        print(f"  note: {missing_desc} have an empty description — they are scored from the "
              f"summary alone and will rarely clear a close threshold.")

    started = time.time()

    def progress(done, total):
        if done % 50 == 0:
            print(f"  ... {done}/{total}", flush=True)

    results, errors, usage = judge.ask_many(
        judge_name, todo,
        state_fn=questions.triage_state,
        questions_fn=lambda _c: questions.TRIAGE_QUESTIONS,
        workers=args.workers,
        on_progress=progress,
    )

    cache.update(results)
    os.makedirs(os.path.dirname(args.outfile), exist_ok=True)
    with open(args.outfile, "w") as fh:
        json.dump({
            "judge": judge_name,
            "scored": len(cache),
            "questions": sorted(questions.TRIAGE_QUESTIONS),
            "scores": cache,
        }, fh, indent=2, ensure_ascii=False)

    elapsed = time.time() - started
    print(f"\nScored {len(results)} in {elapsed:.0f}s → {args.outfile} ({len(cache)} total)")
    print(f"  tokens: {usage['input_tokens']} in / {usage['output_tokens']} out"
          + (f" · ${usage['cost_usd']:.2f}" if usage.get("cost_usd") else ""))
    if errors:
        print(f"  {len(errors)} failed (re-run to retry them):")
        for key, msg in errors[:5]:
            print(f"    {key}: {msg}")
    print("Next: python3 enrich_duplicates.py   then   python3 triage.py")


if __name__ == "__main__":
    main()
