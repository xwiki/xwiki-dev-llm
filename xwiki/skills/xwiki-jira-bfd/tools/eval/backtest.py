#!/usr/bin/env python3
"""Score the labelled set with jev and report how well each threshold would have done.

Run this after changing anything in `lib/questions.py` or a threshold in `triage.py`. It
answers the only question that matters before scaling: of the bugs the pipeline would
propose closing, what share did a committer actually close?

    python3 eval/fetch_labeled.py     # once — builds eval/labeled.json
    python3 eval/backtest.py          # scores it and prints the tables

Results are cached under $BFD_RESULTS_DIR/eval/ (tools/results/eval/ in a checkout), so
re-running is free unless the questions
changed (then pass --rescore).

    python3 eval/backtest.py --judge claude            # the same tables for Claude
    python3 eval/backtest.py --judge claude --limit 20 # a cheap smoke run first

Each judge (and Claude model) has its own cache, eval/answers-<judge>.json: their
probabilities are not comparable, and the point of the run is to measure that judge's
own bars before triage.JUDGES lets it propose a close.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import claude_judge  # noqa: E402
import jev        # noqa: E402
import judge      # noqa: E402
import paths      # noqa: E402
import questions  # noqa: E402
sys.path.insert(0, os.path.join(HERE, ".."))
import triage     # noqa: E402

# Ground truth: the resolution a committer chose, collapsed to the outcome the pipeline
# has to distinguish. Duplicate and Solved By are one class because retrieval, not
# judgment, decides between them.
CLASSES = {
    "Duplicate": "dup", "Solved By": "dup", "Cannot Reproduce": "cnr",
    "Invalid": "invalid", "Won't Fix": "wontfix", "Fixed": "fix",
}

# The real historical mix of XWiki bug resolutions. The sample is balanced (60 each), so
# every rate below is reweighted to this — otherwise precision reads far too high.
POPULATION = {"fix": 8681, "dup": 1497, "cnr": 874, "invalid": 324, "wontfix": 746}


def weights(rows):
    sampled = {}
    for r in rows:
        c = CLASSES[r["label"]]
        sampled[c] = sampled.get(c, 0) + 1
    return {c: POPULATION[c] / n for c, n in sampled.items()}


def curve(rows, answers, score_fn, positive_fn, w, title):
    print(f"\n{title}")
    print("  threshold   share of backlog   precision")
    graded = []
    for r in rows:
        a = (answers.get(r["key"]) or {}).get("answers")
        if not a:
            continue
        graded.append((score_fn(a), positive_fn(CLASSES[r["label"]]), w[CLASSES[r["label"]]]))
    total = sum(g[2] for g in graded)
    for th in (0.9, 0.8, 0.7, 0.6, 0.5):
        sel = [g for g in graded if g[0] >= th]
        sw = sum(g[2] for g in sel)
        if sw <= 0:
            continue
        pw = sum(g[2] for g in sel if g[1])
        print(f"    {th:.2f}       {sw / total * 100:8.1f}%      {pw / sw * 100:6.1f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labeled", default=os.path.join(HERE, "labeled.json"))
    # A cache, so it goes with the run's other state (BFD_RESULTS_DIR), not into the tools.
    cache_dir = os.path.join(paths.RESULTS_DIR, "eval")
    ap.add_argument("--answers", default=None,
                    help=f"answer cache (default: {cache_dir}/answers[-<judge>].json)")
    ap.add_argument("--rescore", action="store_true")
    ap.add_argument("--limit", type=int, default=None,
                    help="score at most N more bugs (spread across the classes)")
    judge.add_arg(ap)
    args = ap.parse_args()
    judge_name = judge.resolve(args.judge)
    if not args.answers:
        os.makedirs(cache_dir, exist_ok=True)
        args.answers = os.path.join(cache_dir, "answers.json" if judge_name == "jev" else
                                    f"answers-{judge_name}-{claude_judge.MODEL}.json")
    print(f"Judge: {judge_name} (cache {os.path.basename(args.answers)})")

    if not os.path.exists(args.labeled):
        raise SystemExit("No eval/labeled.json — run `python3 eval/fetch_labeled.py` first.")
    rows = json.load(open(args.labeled))
    cached = {} if args.rescore or not os.path.exists(args.answers) \
        else json.load(open(args.answers))

    todo = [r for r in rows if r["key"] not in cached]
    if args.limit:
        # Round-robin over the classes so a small run still has every outcome in it.
        by_class = {}
        for r in todo:
            by_class.setdefault(r["label"], []).append(r)
        todo = [r for group in zip(*by_class.values()) for r in group][:args.limit]
    if todo:
        print(f"Scoring {len(todo)} issues with {judge_name}...")
        results, errors, usage = judge.ask_many(
            judge_name, todo,
            state_fn=lambda r: questions.triage_state({
                **r, "created_age_days": r.get("age_at_resolution_days"),
                "signals": {"votes": r.get("votes", 0), "watchers": r.get("watchers", 0)},
                "comment_bodies": r.get("comments"),
            }),
            questions_fn=lambda _r: questions.TRIAGE_QUESTIONS,
        )
        cached.update(results)
        json.dump(cached, open(args.answers, "w"), indent=1)
        print(f"  {len(results)} scored, {len(errors)} failed, "
              f"{usage['input_tokens']} input tokens"
              + (f", ${usage['cost_usd']:.2f}" if usage.get("cost_usd") else ""))
        for key, msg in errors[:3]:
            print(f"    {key}: {msg}")
    rows = [r for r in rows if r["key"] in cached]

    w = weights(rows)
    p = jev.prob
    print(f"\n{len(rows)} labelled bugs. Real base rate closed without a fix: "
          f"{(1 - POPULATION['fix'] / sum(POPULATION.values())) * 100:.0f}%")

    curve(rows, cached,
          lambda a: (p(a, "committer_action", "cannot_reproduce")
                     + p(a, "committer_action", "invalid")
                     + p(a, "committer_action", "wont_fix")),
          lambda c: c in ("cnr", "invalid", "wontfix"), w,
          "CLOSE bar — P(cannot_reproduce)+P(invalid)+P(wont_fix)  vs  'a committer "
          "closed it without a fix'  [triage.CLOSE_BAR / SUGGEST_BAR]")

    curve(rows, cached, lambda a: p(a, "committer_action", "fix"),
          lambda c: c == "fix", w,
          "P(fix)  vs  'a committer fixed it'  [informational: quick wins no longer use it]")

    curve(rows, cached, lambda a: 1 - p(a, "committer_action", "fix"),
          lambda c: c != "fix", w,
          "Overall close-vs-keep separation — 1 - P(fix)")

    # Per-signal AUC, so a question that has stopped discriminating is visible rather
    # than quietly carried.
    print("\nPer-question AUC against 'closed without a fix' "
          "(0.5 = no signal; below 0.5 means it points the other way):")
    labels, scored = [], {}
    for r in rows:
        a = (cached.get(r["key"]) or {}).get("answers")
        if not a:
            continue
        labels.append(CLASSES[r["label"]] != "fix")
        for qid, q in questions.TRIAGE_QUESTIONS.items():
            v = jev.noul(a, qid) if q["type"] == "noul" else (
                jev.score(a, qid) if q["type"] == "score" else None)
            if v is not None:
                scored.setdefault(qid, []).append(v)
    for qid in sorted(scored):
        if len(scored[qid]) == len(labels):
            print(f"  {qid:<28} {auc(scored[qid], labels):.2f}")

    closed_target_guards(os.path.join(HERE, "closed_targets.json"))


def closed_target_guards(path):
    """triage.py's two guards on a closed duplicate target — no jev, dates and links only."""
    if not os.path.exists(path):
        print("\n(no eval/closed_targets.json — run eval/fetch_closed_targets.py to "
              "measure the closed-target guards)")
        return
    data = json.load(open(path))
    rows = [r for r in data["rows"] if r["target_resolution"] == "Fixed"]
    groups = {g: [r for r in rows if r["group"] == g] for g in ("outlived_Fixed", "dup_of_Fixed")}
    default = triage.FIXED_TARGET_GRACE_DAYS
    print("\nFIXED-TARGET guard — does the bug show life after its Fixed target was fixed? "
          "[triage.FIXED_TARGET_GRACE_DAYS]")
    print("  grace   outlived the fix: caught   real duplicates: withheld")
    for grace in (0, 30, 90, 180):
        triage.FIXED_TARGET_GRACE_DAYS = grace
        rate = {}
        for g, rs in groups.items():
            hits = sum(triage.outlived_fixed_target(
                {"created": r["created"],
                 "comments": {"last_date": max(r["comment_dates"], default=None)}},
                {"key": r["target"], "resolution": "Fixed",
                 "resolved_date": r["target_resolved"]}) is not None for r in rs)
            rate[g] = (hits, len(rs))
        (ok, on), (dk, dn) = rate["outlived_Fixed"], rate["dup_of_Fixed"]
        mark = "   <- default" if grace == default else ""
        print(f"  {grace:>4}d   {ok:>3}/{on} = {ok / on * 100:3.0f}%"
              f"              {dk:>3}/{dn} = {dk / dn * 100:3.0f}%{mark}")
    triage.FIXED_TARGET_GRACE_DAYS = default

    dups = [r for r in data["rows"] if r["group"].startswith("dup_of_")]
    linked = sum(r["related_link"] for r in dups)
    rp = data["related_pairs"]
    print("\nEXISTING-LINK guard — a committer already linked the pair as something other "
          "than Duplicate [triage.already_linked]")
    print(f"  pairs linked Related, later closed as each other's duplicate: "
          f"{rp['became_duplicate']}/{rp['pairs']} = "
          f"{rp['became_duplicate'] / rp['pairs'] * 100:.1f}%")
    print(f"  real duplicates of a closed target that also carried such a link (withheld): "
          f"{linked}/{len(dups)} = {linked / len(dups) * 100:.0f}%")


def auc(scores, labels):
    """Rank-based AUC with ties averaged. Pure; no dependencies."""
    pairs = sorted(zip(scores, labels))
    rank_sum = n_pos = n_neg = 0
    i = 0
    while i < len(pairs):
        j = i
        while j < len(pairs) and pairs[j][0] == pairs[i][0]:
            j += 1
        avg_rank = (i + 1 + j) / 2
        for k in range(i, j):
            if pairs[k][1]:
                rank_sum += avg_rank
                n_pos += 1
            else:
                n_neg += 1
        i = j
    if not n_pos or not n_neg:
        return 0.5
    return (rank_sum - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)


if __name__ == "__main__":
    main()
