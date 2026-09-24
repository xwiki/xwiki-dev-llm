#!/usr/bin/env python3
"""Build the labelled set that measures triage.py's guards on closed duplicate targets.

A Duplicate close against a target that is already closed borrows that target's verdict:
"this is fixed" for a Fixed target, "this was decided" for a Won't Fix one. Two pilot
proposals borrowed a verdict that did not apply:

  XWIKI-5612  → XWIKI-12525 (Fixed 2015), although a 2023 comment had reproduced it.
  XWIKI-11441 → XWIKI-6550 (Won't Fix 2014), although XWIKI-11441 is the specific case a
                committer split out of 6550 when closing it, linked it `Related`, and
                confirmed in 2021 as still accurate.

For each target resolution R in RESOLUTIONS, two groups, with the committer's verdict as
ground truth:

  dup_of_<R>       — bugs a committer closed Duplicate / Solved By, linked `duplicates` to
                     a Bug resolved R before them. Closing against that target was right,
                     so every one a guard withholds is lost volume (the cost).
  outlived_<R>     — bugs a committer later *fixed on their own*, linked `relates to` a Bug
                     resolved R at least OUTLIVED_DAYS earlier. The target's verdict did
                     not cover them, so closing against it would have been a wrong close.

Each row also records `related_link`: whether the bug and its target were linked by a
link type other than Duplicate. On a dup_of_ row that is the cost of the "a committer
already linked them as something else" guard.

LEAKAGE CONTROL, as in fetch_labeled.py: comments from 1 day before the bug's own
resolution onward are dropped, so a guard sees what a triager would have seen.

    python3 eval/fetch_closed_targets.py     # → eval/closed_targets.json
    python3 eval/backtest.py                 # its last tables read this file
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import jira  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "closed_targets.json")
PER_GROUP = 250
POOL = 1000          # bugs scanned per group; most are dropped for the wrong target kind
OUTLIVED_DAYS = 30   # a same-week double fix is one fix landing in two issues, not "outlived"
RESOLUTIONS = ("Fixed", "Won't Fix")

# `level is EMPTY` keeps security-restricted issues out: this file is published, and even
# the key and fix date of an undisclosed vulnerability must not be.
BASE = ("project = XWIKI AND issuetype = Bug AND level is EMPTY "
        "AND created <= -156w AND resolved <= -52w")
GROUPS = {
    "dup_of": (f'{BASE} AND resolution in (Duplicate, "Solved By") '
               f'AND issueLinkType = duplicates ORDER BY created DESC', "Duplicate"),
    "outlived": (f'{BASE} AND resolution = Fixed AND issueLinkType = "relates to" '
                 f'ORDER BY created DESC', "Related"),
}
FIELDS = ["created", "resolutiondate", "resolution", "issuelinks", "comment"]
TARGET_FIELDS = ["issuetype", "resolution", "resolutiondate"]


def parse(s):
    return jira.parse_jira_date(s) if s else None


def links(issue):
    """(other key, link type name, is outward) for every link of an issue."""
    for link in (issue["fields"].get("issuelinks") or []):
        other = link.get("outwardIssue") or link.get("inwardIssue")
        yield other["key"], link["type"]["name"], "outwardIssue" in link


def candidates(issue, kind):
    """The target a group is about: the `duplicates` target of a Duplicate close, or any
    `Related` issue, which has no meaningful direction."""
    for key, typ, outward in links(issue):
        if (kind == "dup_of" and typ == "Duplicate" and outward) or \
                (kind == "outlived" and typ == "Related"):
            yield key


def targets_info(keys):
    info = {}
    keys = sorted(set(keys))
    for i in range(0, len(keys), 50):
        for t in jira.search(f"key in ({','.join(keys[i:i + 50])}) AND level is EMPTY",
                             TARGET_FIELDS):
            f = t["fields"]
            info[t["key"]] = {
                "is_bug": (f.get("issuetype") or {}).get("name") == "Bug",
                "resolution": (f.get("resolution") or {}).get("name"),
                "resolutiondate": f.get("resolutiondate"),
            }
    return info


def row(issue, key, t, kind):
    """One labelled row, or None if this (bug, target) pair does not fit the group."""
    f = issue["fields"]
    res, t_resolved = t.get("resolution"), parse(t.get("resolutiondate"))
    resolved = parse(f.get("resolutiondate"))
    if not (t.get("is_bug") and res in RESOLUTIONS and t_resolved and resolved):
        return None
    if kind == "dup_of" and not (
            (f.get("resolution") or {}).get("name") in ("Duplicate", "Solved By")
            and t_resolved < resolved):
        return None
    if kind == "outlived" and not (
            (f.get("resolution") or {}).get("name") == "Fixed"
            and (resolved - t_resolved).days >= OUTLIVED_DAYS):
        return None
    cutoff = resolved - datetime.timedelta(days=1)
    comments = [c for c in ((f.get("comment") or {}).get("comments") or [])
                if parse(c.get("created")) and parse(c["created"]) < cutoff]
    return {
        "key": issue["key"], "group": f"{kind}_{res}", "target": key,
        "target_resolution": res,
        "created": f.get("created"),
        "resolved": f.get("resolutiondate"),
        "target_resolved": t["resolutiondate"],
        "comment_dates": [c["created"] for c in comments],
        "related_link": any(k == key and typ != "Duplicate" for k, typ, _ in links(issue)),
    }


def from_targets(resolution, kind):
    """Scan from the target side. JQL cannot filter a bug by its *target's* resolution,
    and Won't Fix targets are too rare to find from the bug side (9 in 1000 Duplicate
    closes), so start from targets resolved that way and follow their links back."""
    link = {"dup_of": "is duplicated by", "outlived": "relates to"}[kind]
    jql = (f'{BASE} AND resolution = "{resolution}" AND issueLinkType = "{link}" '
           f'ORDER BY created DESC')
    info, pairs = {}, []
    for t in jira.search(jql, ["issuetype", "resolution", "resolutiondate", "issuelinks"],
                         max_total=POOL):
        f = t["fields"]
        info[t["key"]] = {"is_bug": True, "resolution": resolution,
                          "resolutiondate": f.get("resolutiondate")}
        for key, typ, outward in links(t):
            if (kind == "dup_of" and typ == "Duplicate" and not outward) or \
                    (kind == "outlived" and typ == "Related"):
                pairs.append((key, t["key"]))
    bugs = {}
    keys = sorted({b for b, _ in pairs})
    for i in range(0, len(keys), 50):
        for issue in jira.search(f"key in ({','.join(keys[i:i + 50])}) AND issuetype = Bug "
                                 f"AND level is EMPTY", FIELDS):
            bugs[issue["key"]] = issue
    out, seen = [], set()
    for b, key in pairs:
        if b in bugs and b not in seen and len(out) < PER_GROUP:
            r = row(bugs[b], key, info[key], kind)
            if r:
                out.append(r)
                seen.add(b)
    return out


def related_pairs():
    """How often a pair a committer linked `Related` later became a Duplicate close of each
    other — the premise of the existing-link guard: that Related means "not the same"."""
    jql = (f'{BASE} AND resolution is not EMPTY AND issueLinkType = "relates to" '
           f'ORDER BY created DESC')
    pairs = became_dup = 0
    for issue in jira.search(jql, ["issuelinks", "resolution"], max_total=POOL):
        ls = list(links(issue))
        dups = {k for k, typ, outward in ls if typ == "Duplicate" and outward}
        closed_dup = (issue["fields"].get("resolution") or {}).get("name") in (
            "Duplicate", "Solved By")
        for k in {k for k, typ, _ in ls if typ == "Related"}:
            pairs += 1
            became_dup += closed_dup and k in dups
    return {"pairs": pairs, "became_duplicate": became_dup}


def main():
    out = []
    for kind, (jql, _) in GROUPS.items():
        # Fixed targets are common enough to find from the bug side.
        issues = list(jira.search(jql, FIELDS, max_total=POOL))
        info = targets_info(k for i in issues for k in candidates(i, kind))
        n = 0
        for issue in issues:
            for key in candidates(issue, kind):
                r = row(issue, key, info.get(key) or {}, kind)
                if r and r["target_resolution"] == "Fixed":
                    out.append(r)
                    n += 1
                    break   # one target per bug, so no bug is counted twice
            if n >= PER_GROUP:
                break
        print(f"{kind}_Fixed: {n}")
        rows = from_targets("Won't Fix", kind)
        print(f"{kind}_Won't Fix: {len(rows)}")
        out += rows
    stats = related_pairs()
    print(f"Related pairs: {stats['pairs']}, later closed as each other's duplicate: "
          f"{stats['became_duplicate']}")
    json.dump({"rows": out, "related_pairs": stats}, open(OUT, "w"), indent=1)
    print("wrote", OUT, len(out))


if __name__ == "__main__":
    main()
