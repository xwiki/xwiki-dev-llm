#!/usr/bin/env python3
"""results/review.json → results/report.md, the document a committer actually reads.

Three sections, in the order a BFD day runs:
  1. CLOSE  — proposals apply.py will write once they are approved. Read these closely.
  2. FIX    — the quick-wins list: bugs jev scored as cheap to fix, cheapest first.
  3. TRIAGE — suggestions and escalations, for a human to action in JIRA by hand.

Approval is by editing results/review.json: delete a row, or change its disposition away
from `close`, and apply.py will not touch it.
"""

import argparse
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
import paths  # noqa: E402

HERE = os.path.dirname(__file__)
RESULTS_DIR = paths.RESULTS_DIR


def scorebar(value, maximum=3.0, width=10):
    if value is None:
        return "—"
    filled = int(round((value / maximum) * width))
    return "█" * filled + "·" * (width - filled) + f" {value:.1f}"


def issue_line(r):
    comps = ", ".join(r.get("components") or []) or "no component"
    return (f"### [{r['key']}]({r['url']}) — {r['summary']}\n\n"
            f"*{r['created_age_years']} years old · {comps} · "
            f"affects {', '.join(r.get('affects_versions') or []) or 'unspecified'} · "
            f"status {r.get('status')}*\n")


def score_block(r):
    s = r.get("scores") or {}
    sig = r.get("signals") or {}
    return (f"| P(worth fixing) | P(closed without a fix) | effort | impact |\n"
            f"|---|---|---|---|\n"
            f"| {s.get('p_fix', '—')} | {s.get('p_close_no_fix', '—')} | "
            f"{scorebar(s.get('fix_effort'))} | {scorebar(s.get('impact'))} |\n\n"
            f"<sub>votes {sig.get('votes', 0)} · watchers {sig.get('watchers', 0)} · "
            f"last activity {sig.get('updated_age_days', '?')}d ago · "
            f"{len(sig.get('linked_open_issues') or [])} open links</sub>\n")


def render_close(rows):
    out = ["## 1. Proposed closes — `apply.py` will write these\n",
           "Approval is by presence in `review.json`. **Delete a row, or change its "
           "`disposition`, to reject it.** Every close notifies the reporter and every "
           "watcher, so pace real runs with `--limit`.\n"]
    for r in rows:
        out.append(issue_line(r))
        out.append(f"**→ Close as `{r['resolution']}`"
                   + (f" of {r['target_issue']}" if r.get("target_issue") else "") + "**\n")
        out.append(score_block(r))
        for reason in r.get("reasons") or []:
            out.append(f"- {reason}\n")
        for flag in r.get("flags") or []:
            out.append(f"- ⚠️ {flag}\n")
        out.append(f"\n> {r['drafted_comment']}\n\n---\n")
    return out


def render_quick_wins(rows):
    out = ["## 2. Quick wins — cheap to fix on the day\n",
           "Bugs that jev scored as cheap to fix, whatever it thinks they are worth. "
           "Nothing is written to JIRA for these; they are a pick-list. Ordered by "
           "effort, cheapest first.\n"]
    for r in rows:
        s = r.get("scores") or {}
        comps = ", ".join(r.get("components") or []) or "no component"
        out.append(f"- **[{r['key']}]({r['url']})** — {r['summary']}  \n"
                   f"  <sub>{comps} · effort {s.get('fix_effort')}/3 · "
                   f"impact {s.get('impact')}/3 · "
                   f"{r['created_age_years']}y old</sub>\n")
        for reason in r.get("reasons") or []:
            if reason.startswith("not closed against"):
                out.append(f"  <sub>duplicate lead withheld — {reason}</sub>\n")
    return out


def render_triage(rows):
    out = ["## 3. Triage by hand — suggestions and escalations\n",
           "`apply.py` never writes these. Each carries a drafted comment you can paste "
           "into JIRA after deciding.\n"]
    for r in rows:
        out.append(issue_line(r))
        label = (f"suggested `{r['resolution']}`" if r["disposition"] == "suggest"
                 else "needs a human")
        out.append(f"**→ {label}**\n")
        out.append(score_block(r))
        for reason in r.get("reasons") or []:
            out.append(f"- {reason}\n")
        for v in r.get("vetoes") or []:
            out.append(f"- 🛑 {v}\n")
        for f in r.get("flags") or []:
            out.append(f"- ⚠️ {f}\n")
        if r.get("drafted_comment"):
            out.append(f"\n> {r['drafted_comment']}\n")
        out.append("\n---\n")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", default=os.path.join(RESULTS_DIR, "review.json"))
    ap.add_argument("--out", default=os.path.join(RESULTS_DIR, "report.md"))
    ap.add_argument("--max-triage", type=int, default=60,
                    help="cap the hand-triage section; the full set stays in review.json")
    args = ap.parse_args()

    data = json.load(open(args.review))
    rows = data["review"]
    by = {d: [r for r in rows if r["disposition"] == d] for d in
          ("close", "suggest", "quick_win", "escalate", "keep")}

    closes = sorted(by["close"], key=lambda r: -(r["scores"].get("p_close_no_fix") or 0))
    wins = sorted(by["quick_win"], key=lambda r: ((r["scores"].get("fix_effort") or 9),
                                                  -(r["scores"].get("impact") or 0)))
    triage = sorted(by["suggest"] + by["escalate"],
                    key=lambda r: -(r["scores"].get("p_close_no_fix") or 0))

    counts = Counter(r["disposition"] for r in rows)
    th = data.get("thresholds", {})

    judge_name = data.get("judge", "jev")
    lines = [
        f"# BFD triage report — {data.get('project', 'XWIKI')} / cohort {data.get('cohort')}\n",
        f"{len(rows)} bugs scored. "
        f"**{counts['close']} proposed closes**, {counts['quick_win']} quick wins, "
        f"{counts['suggest']} suggestions, {counts['escalate']} escalations, "
        f"{counts['keep']} left alone.\n",
        f"<sub>Judge: {judge_name}. Thresholds: close ≥ {th.get('close_bar')}, suggest ≥ {th.get('suggest_bar')}, "
        f"quick win effort ≤ {th.get('max_effort')}. Retune with `triage.py --close-bar ...` — no "
        f"re-scoring needed.</sub>\n",
    ]
    allowed = data.get("judge_closes")
    if allowed is not None and not allowed:
        lines.append(
            f"\n> **No closes are proposed: this run was judged by `{judge_name}`, whose close "
            f"bars have not been measured.** Everything jev's bars would close is listed "
            f"as a suggestion instead, and `apply.py` has nothing to write. Quick wins are "
            f"unaffected.\n")
    elif allowed is not None and len(allowed) < 6:
        lines.append(
            f"\n> **Only {', '.join(allowed)} closes are proposed in this run:** `{judge_name}` "
            f"has been measured for those resolutions only. Anything else it would close "
            f"is listed as a suggestion.\n")
    if data.get("resolution_counts"):
        lines.append("| proposal | count |\n|---|---|\n")
        for k in sorted(data["resolution_counts"]):
            lines.append(f"| {k} | {data['resolution_counts'][k]} |\n")
        lines.append("\n")
    if data.get("warnings"):
        lines.append(f"\n> ⚠️ {len(data['warnings'])} row(s) were downgraded by an "
                     f"invariant check — see `warnings` in review.json.\n\n")

    lines += ["\n---\n\n"] + render_close(closes)
    lines += ["\n"] + render_quick_wins(wins)
    lines += ["\n"] + render_triage(triage[:args.max_triage])
    if len(triage) > args.max_triage:
        lines.append(f"\n<sub>…and {len(triage) - args.max_triage} more in "
                     f"`review.json`.</sub>\n")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as fh:
        fh.write("".join(lines))
    print(f"Wrote {args.out}")
    print(f"  {counts['close']} closes · {counts['quick_win']} quick wins · "
          f"{counts['suggest']} suggestions · {counts['escalate']} escalations")
    print("Read it, curate results/review.json, then: python3 apply.py")


if __name__ == "__main__":
    main()
