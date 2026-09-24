#!/usr/bin/env python3
"""Apply approved closes from results/review.json to JIRA. THE ONLY SCRIPT THAT WRITES.

For every row with disposition == "close" it, per the xwiki-jira workflow:
  1. fetches the issue's current status and lists available transitions (never transitions
     blind — XWiki's workflow may need an intermediate state to reach a resolved state);
  2. posts the drafted comment;
  3. transitions the issue to a closed status with the row's resolution — one of
     "Duplicate", "Solved By", "Cannot Reproduce", "Won't Fix", "Invalid" or "Inactive".
     These are the resolutions XWiki committers actually use to retire a bug (in the
     project's history: 1175 Duplicate, 874 Cannot Reproduce, 746 Won't Fix, 324 Invalid,
     322 Solved By — and 6 Inactive). Rows with disposition `suggest` are report-only and
     are never written here, whatever their resolution says;
  4. for Duplicate/Solved By, best-effort adds an issue link to the target (a Duplicate
     link, or a Related link for Solved By — there is no dedicated "Solved By" link type).
     A failed link never undoes the close.

SAFETY:
- Default is a DRY RUN: it prints exactly what it would do and writes nothing.
- Real writes require BOTH --apply AND typing the confirmation phrase when prompted.
- --limit caps how many issues are processed in one run, so the notification wave can be
  paced (every close notifies the reporter + watchers).
- Approval = presence in review.json. To reject a close, delete its row (or change its
  disposition) before running this.

Usage:
  python3 apply.py                      # dry run (default), all close rows
  python3 apply.py --limit 5            # dry run, first 5
  python3 apply.py --apply --limit 5    # REAL: apply first 5 (asks for confirmation)
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
import paths  # noqa: E402
import jira  # noqa: E402
import triage  # noqa: E402

HERE = os.path.dirname(__file__)
RESULTS_DIR = paths.RESULTS_DIR
CLOSE_RESOLUTIONS = {"Duplicate", "Solved By", "Cannot Reproduce", "Won't Fix",
                     "Invalid", "Inactive"}
# No default: a close with no resolution is a bug upstream, and guessing one would be the
# pipeline inventing a verdict. Such a row is skipped and reported.
CONFIRM_PHRASE = "apply bfd closes"

# Transition target: a transition whose name indicates it closes/resolves the issue.
CLOSING_HINTS = ("close", "resolve", "done", "inactive")

# Link to add after a successful transition, keyed by resolution. Inactive gets no link.
# Duplicate -> a "Duplicate" link (bug_key duplicates target). Solved By has no dedicated
# JIRA link type, so it gets a "Related" link plus the drafted comment naming the target.
LINK_TYPE_FOR_RESOLUTION = {
    "Duplicate": "Duplicate",
    "Solved By": "Related",
}

# Resolutions that assert something about another issue, so they need a target to name.
NEEDS_TARGET = ("Duplicate", "Solved By")


def link_for(resolution, bug_key, target_key):
    """Return (link_type_name, bug_key, target_key) or None for Inactive/no target."""
    link_type = LINK_TYPE_FOR_RESOLUTION.get(resolution)
    if not link_type or not target_key:
        return None
    return (link_type, bug_key, target_key)


def pick_closing_transition(transitions):
    """Choose a transition that lands the issue in a resolved/closed state."""
    for t in transitions:
        to = (t.get("to", {}) or {})
        cat = (to.get("statusCategory", {}) or {}).get("key")
        name = (t.get("name") or "").lower()
        to_name = (to.get("name") or "").lower()
        if cat == "done" or any(h in name or h in to_name for h in CLOSING_HINTS):
            return t
    return None


def close_is_measured(row):
    """Whether every judge recorded on a close row was measured for that resolution."""
    judged = row.get("judged_by") or {}
    res = row.get("resolution")
    if not triage.may_close(judged.get("scores"), res):
        return False
    if res in ("Duplicate", "Solved By"):
        return triage.may_close(judged.get("duplicate_pick"), res)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", default=os.path.join(RESULTS_DIR, "review.json"))
    ap.add_argument("--apply", action="store_true", help="actually write to JIRA")
    ap.add_argument("--limit", type=int, default=None, help="cap issues processed this run")
    args = ap.parse_args()

    data = json.load(open(args.review))
    review = data["review"]
    closes = [r for r in review if r["disposition"] == "close"]
    # triage.py never emits a close a judge was not measured for. A close row here anyway
    # means review.json was edited by hand, and the whole run is refused.
    unmeasured = [r["key"] for r in closes if not close_is_measured(r)]
    if unmeasured:
        raise SystemExit(f"{len(unmeasured)} close row(s) come from a judge with no measured "
                         f"close bar for them ({', '.join(unmeasured[:5])}). Refusing.")
    if args.limit:
        closes = closes[:args.limit]

    mode = "APPLY (writing to JIRA)" if args.apply else "DRY RUN (no writes)"
    by_res = {}
    for r in closes:
        by_res[r.get("resolution")] = by_res.get(r.get("resolution"), 0) + 1
    print(f"=== {mode} === {len(closes)} close row(s) ===")
    for res in sorted(by_res, key=lambda x: (x is None, x)):
        print(f"      {res}: {by_res[res]}")
    print()

    if not closes:
        print("Nothing to do.")
        return

    if args.apply:
        # Guardrails: never bulk-modify without explicit approval (xwiki-jira rule).
        got = input(f'Type "{CONFIRM_PHRASE}" to proceed with {len(closes)} closes: ').strip()
        if got != CONFIRM_PHRASE:
            print("Confirmation phrase not matched. Aborting — nothing written.")
            return

    done, failed = 0, 0
    for r in closes:
        key = r["key"]
        resolution = r.get("resolution")
        target = r.get("target_issue")
        comment = r.get("drafted_comment") or ""

        if not resolution:
            print(f"[skip] {key}: close row with no resolution — fix triage.py, do not guess.")
            failed += 1
            continue
        if resolution not in CLOSE_RESOLUTIONS:
            print(f"[skip] {key}: unsupported close resolution '{resolution}'.")
            failed += 1
            continue
        if resolution in NEEDS_TARGET and not target:
            print(f"[skip] {key}: resolution {resolution} but no target_issue set.")
            failed += 1
            continue
        if not comment.strip():
            print(f"[skip] {key}: no drafted comment (should not happen post-ingest).")
            failed += 1
            continue

        link = link_for(resolution, key, target)

        # 1. current state + transitions (always fetch first).
        issue = jira.get_issue(key, ["status", "resolution"])
        status = (issue.get("fields", {}).get("status", {}) or {}).get("name")
        if (issue.get("fields", {}).get("resolution")):
            print(f"[skip] {key}: already resolved ({status}). Someone got there first.")
            continue
        transitions = jira.get_transitions(key)
        t = pick_closing_transition(transitions)

        if not args.apply:
            names = ", ".join(tr.get("name") for tr in transitions) or "—"
            chosen = t.get("name") if t else "!! none matched — inspect manually"
            print(f"[dry] {key} (status={status})")
            print(f"      available transitions: {names}")
            print(f"      would use transition: {chosen}  → resolution {resolution}")
            if target:
                print(f"      target issue: {target}")
            if link:
                print(f"      would add link: {link[0]} ({link[1]} → {link[2]})")
            print(f"      would comment: {comment[:120]}{'...' if len(comment) > 120 else ''}\n")
            continue

        if not t:
            print(f"[FAIL] {key}: no closing transition among "
                  f"{[tr.get('name') for tr in transitions]}. Skipping.")
            failed += 1
            continue

        # 2. comment, then 3. transition.
        cstat, _ = jira.add_comment(key, comment)
        if cstat not in (200, 201):
            print(f"[FAIL] {key}: comment failed (HTTP {cstat}). Not transitioning.")
            failed += 1
            continue
        tstat, tdata = jira.do_transition(key, t["id"], resolution=resolution)
        if tstat not in (200, 204):
            print(f"[FAIL] {key}: transition failed (HTTP {tstat}): {json.dumps(tdata)[:200]}")
            failed += 1
            continue

        # 4. best-effort link — a failed link must NOT undo the close.
        if link:
            link_type, bug_key, target_key = link
            lstat, ldata = jira.add_link(bug_key, target_key, link_type)
            if lstat not in (200, 201):
                print(f"      [WARN] {key}: link to {target_key} failed "
                      f"(HTTP {lstat}): {json.dumps(ldata)[:200]}")

        print(f"[OK] {key}: commented + transitioned via '{t['name']}' → {resolution}")
        done += 1

    print(f"\nDone. applied={done} failed={failed} "
          f"{'(dry run — nothing written)' if not args.apply else ''}")


if __name__ == "__main__":
    main()
