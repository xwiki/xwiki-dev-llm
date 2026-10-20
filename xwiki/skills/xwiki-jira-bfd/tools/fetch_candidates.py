#!/usr/bin/env python3
"""Fetch a cohort of candidate bugs with everything the triage stage needs.

Read-only. Writes results/candidates.json — one entry per bug, self-contained, so no
later stage has to touch JIRA to read an issue.

    python3 fetch_candidates.py --cohort 5yr --limit 40
    python3 fetch_candidates.py --cohort all            # the whole open-bug backlog

Cohorts are ordered OLDEST-FIRST (created ASC).

WHAT AN ENTRY CARRIES, and why:
- `description` and `comment_bodies`. A bug's description is the only place the actual
  defect is written down, and its comments are where "this was fixed by X" or "I still
  see this" live. Both are the substance of the triage judgment; a summary line is not
  enough to close a fifteen-year-old report on.
- `signals`. Community-interest counters (votes, watchers, links, comment recency). These
  are recorded as DATA, not as a verdict. `triage.py` owns what they mean; see the
  comment on `sign_of_life` below.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
import paths  # noqa: E402
import jira  # noqa: E402

RESULTS_DIR = paths.RESULTS_DIR

# Thresholds (documented in README.md). Bugs are already years old; these decide
# whether there has been any recent human signal on the issue.
STALE_UNTOUCHED_DAYS = 730     # not updated in ~2yr → "untouched"
RECENT_COMMENT_DAYS = 730      # a comment newer than this is genuine recent human interest
MAX_COMMENT_BODIES = 12        # newest N comment bodies carried into the bundle
MAX_COMMENT_CHARS = 1500       # per comment, so one essay cannot crowd out the rest

COHORTS = {
    "5yr": "created <= -260w",
    "2yr": "created <= -104w",
    "1yr": "created <= -52w",
    "all": "created <= -4w",    # everything but the very fresh, still-being-triaged tail
}

FIELDS = [
    # "description" belongs here: without it every later stage judges a bug from its
    # one-line summary alone. It was missing until the jev rework; see eval/RESULTS.md.
    "summary", "description", "status", "resolution", "created", "updated", "votes",
    "watches", "labels", "issuelinks", "components", "versions", "fixVersions",
    "reporter", "comment", "priority", "issuetype",
    # A security level is how XWiki hides an undisclosed vulnerability, and unlike the
    # `security` label it is not in `labels`.
    "security",
]


def linked_open_issues(issuelinks):
    """Return keys of linked issues that are not in a 'done' status category."""
    out = []
    for link in issuelinks or []:
        for side in ("outwardIssue", "inwardIssue"):
            other = link.get(side)
            if not other:
                continue
            cat = other.get("fields", {}).get("status", {}).get("statusCategory", {}) or {}
            if cat.get("key") != "done":
                out.append({
                    "key": other.get("key"),
                    "type": (link.get("type", {}) or {}).get("name"),
                    "status": other.get("fields", {}).get("status", {}).get("name"),
                })
    return out


def comment_signals(comment_field):
    comments = (comment_field or {}).get("comments", []) or []
    if not comments:
        return {"count": 0, "last_date": None, "last_author": None, "last_age_days": None}
    last = comments[-1]
    return {
        "count": len(comments),
        "last_date": last.get("created"),
        "last_author": (last.get("author", {}) or {}).get("displayName"),
        "last_age_days": jira.age_days(last.get("created")),
    }


def comment_bodies(comment_field):
    """The newest MAX_COMMENT_BODIES comments, oldest-first, each capped in length.

    Kept chronological because the triage judgment often turns on how a thread ended.
    """
    comments = (comment_field or {}).get("comments", []) or []
    out = []
    for c in comments[-MAX_COMMENT_BODIES:]:
        out.append({
            "author": (c.get("author") or {}).get("displayName"),
            "date": (c.get("created") or "")[:10],
            "body": (c.get("body") or "")[:MAX_COMMENT_CHARS],
        })
    return out


def build_entry(issue):
    f = issue.get("fields", {})
    votes = (f.get("votes", {}) or {}).get("votes", 0) or 0
    watchers = (f.get("watches", {}) or {}).get("watchCount", 0) or 0
    labels = f.get("labels", []) or []
    has_security = any(l.lower() == "security" for l in labels)
    restricted = bool(f.get("security"))
    linked_open = linked_open_issues(f.get("issuelinks"))
    cmt = comment_signals(f.get("comment"))
    recent_comment = cmt["last_age_days"] is not None and cmt["last_age_days"] <= RECENT_COMMENT_DAYS
    updated_age = jira.age_days(f.get("updated"))

    signals = {
        "votes": votes,
        "watchers": watchers,
        "has_security_label": has_security,
        "has_security_level": restricted,
        "linked_open_issues": linked_open,
        "recent_comment": recent_comment,
        "updated_age_days": updated_age,
    }
    # `sign_of_life` is recorded but deliberately NOT used as a veto any more.
    #
    # It used to be a hard pre-judge filter, and it removed 31 of 40 pilot candidates —
    # mostly for having two watchers. The backtest (eval/) says that reading is backwards:
    # among historically-resolved old bugs, 26% of those with 0-1 watchers were fixed
    # against 4% at two watchers and 0% at three or more. Watchers accumulate on issues
    # that get discussed and superseded, so a high count is if anything a mild signal that
    # the issue ended up CLOSED, not that it is alive.
    #
    # triage.py now owns what each signal means, per signal: a security label and a recent
    # comment are still hard vetoes, votes downgrade a close to a suggestion, and watchers
    # are carried for the reviewer to see but do not gate anything.
    sign_of_life = bool(
        votes > 0
        or has_security
        or recent_comment)
    untouched = updated_age is not None and updated_age >= STALE_UNTOUCHED_DAYS

    return {
        "key": issue.get("key"),
        "summary": f.get("summary"),
        "status": (f.get("status", {}) or {}).get("name"),
        "created": f.get("created"),
        "created_age_days": jira.age_days(f.get("created")),
        "updated": f.get("updated"),
        "reporter": (f.get("reporter", {}) or {}).get("displayName"),
        "components": [c.get("name") for c in (f.get("components", []) or [])],
        "affects_versions": [v.get("name") for v in (f.get("versions", []) or [])],
        "labels": labels,
        "priority": (f.get("priority", {}) or {}).get("name"),
        "comments": cmt,
        "comment_bodies": comment_bodies(f.get("comment")),
        "signals": signals,
        "sign_of_life": sign_of_life,
        "untouched": untouched,
        "description": (f.get("description") or "").strip(),
        "url": f"https://jira.xwiki.org/browse/{issue.get('key')}",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cohort", choices=sorted(COHORTS), required=True)
    ap.add_argument("--project", default="XWIKI",
                    help="JIRA project key (XWIKI, XCOMMONS, XRENDERING...)")
    ap.add_argument("--limit", type=int, default=None,
                    help="cap the number of bugs (pilot). Omit for the whole cohort.")
    ap.add_argument("--out", default=os.path.join(RESULTS_DIR, "candidates.json"))
    args = ap.parse_args()

    jql = (f"project = {args.project} AND issuetype = Bug AND resolution = Unresolved "
           f"AND {COHORTS[args.cohort]} ORDER BY created ASC")
    total = jira.count(jql)
    print(f"Cohort {args.cohort}: {total} open bugs match. "
          f"Fetching {'all' if not args.limit else args.limit}, oldest-first...")

    entries = []
    for issue in jira.search(jql, FIELDS, max_total=args.limit):
        entries.append(build_entry(issue))
        if len(entries) % 20 == 0:
            print(f"  ... {len(entries)} fetched")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    payload = {
        "cohort": args.cohort,
        "project": args.project,
        "jql": jql,
        "cohort_total": total,
        "fetched": len(entries),
        "thresholds": {
            "stale_untouched_days": STALE_UNTOUCHED_DAYS,
            "recent_comment_days": RECENT_COMMENT_DAYS,
        },
        "candidates": entries,
    }
    with open(args.out, "w") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)

    with_desc = sum(1 for e in entries if e["description"])
    with_cmt = sum(1 for e in entries if e["comment_bodies"])
    with_sol = sum(1 for e in entries if e["sign_of_life"])
    print(f"Wrote {len(entries)} candidates to {args.out}")
    print(f"  with a description: {with_desc}  with comments: {with_cmt}")
    print(f"  sign-of-life flagged (votes / security label / recent comment): {with_sol}")
    print("Next: python3 score_issues.py")


if __name__ == "__main__":
    main()
