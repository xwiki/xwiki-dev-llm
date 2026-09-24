#!/usr/bin/env python3
"""Build a leakage-controlled labelled backtest set from XWiki JIRA history.

The pipeline's thresholds are only as good as the evidence they were set from, so the
evidence is checked in as a runnable step rather than quoted. XWiki has closed thousands
of bugs with an explicit resolution; each one is a committer's own verdict on a report, so
the resolution field is the ground truth and the report as it stood before that verdict is
the input.

LEAKAGE CONTROL: the comment in which a committer writes "duplicate of X" is normally
posted at closing time, so every comment from 24h before the resolution onward is dropped.
What remains is what a triager would have seen at the start of a BFD day.

KNOWN BIAS, stated because it bounds what these numbers mean: this samples *resolved*
bugs. The still-open backlog is by construction the residue nobody closed, and may be
harder. Treat the measured precision as an upper bound and confirm it on a live pilot.

    python3 eval/fetch_labeled.py          # → eval/labeled.json  (60 per resolution)
"""
import sys, os, json, datetime
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import jira

OUT = os.path.join(os.path.dirname(__file__), 'labeled.json')
PER_CLASS = 60
FIELDS = ["summary","description","status","resolution","resolutiondate","created","updated",
          "votes","watches","labels","issuelinks","components","versions","fixVersions",
          "reporter","comment"]

# Only bugs old enough to plausibly be BFD-day material, resolved at least a while ago.
CLASSES = {
    "Duplicate":        'resolution = "Duplicate"',
    "Solved By":        'resolution = "Solved By"',
    "Cannot Reproduce": 'resolution = "Cannot Reproduce"',
    "Invalid":          'resolution = "Invalid"',
    "Won't Fix":        'resolution = "Won\'t Fix"',
    "Fixed":            'resolution = "Fixed"',
}

def parse(s):
    return jira.parse_jira_date(s) if s else None

def strip_leaky_comments(comments, resolution_date):
    """Drop comments posted from 1 day before the resolution onward — those are the
    triager's own closing rationale and would leak the label."""
    if not resolution_date:
        return []
    cutoff = resolution_date - datetime.timedelta(days=1)
    kept = []
    for c in comments:
        d = parse(c.get("created"))
        if d and d < cutoff:
            kept.append({
                "author": (c.get("author") or {}).get("displayName"),
                "date": (c.get("created") or "")[:10],
                "body": (c.get("body") or "")[:1500],
            })
    return kept

def build(issue, label):
    f = issue["fields"]
    rd = parse(f.get("resolutiondate"))
    comments = ((f.get("comment") or {}).get("comments") or [])
    return {
        "key": issue["key"],
        "label": label,
        "summary": f.get("summary"),
        "description": (f.get("description") or "")[:6000],
        "created": (f.get("created") or "")[:10],
        "resolved": (f.get("resolutiondate") or "")[:10],
        "age_at_resolution_days": (rd - parse(f["created"])).days if rd and f.get("created") else None,
        "components": [c["name"] for c in (f.get("components") or [])],
        "affects_versions": [v["name"] for v in (f.get("versions") or [])],
        "labels": f.get("labels") or [],
        "votes": (f.get("votes") or {}).get("votes", 0),
        "watchers": (f.get("watches") or {}).get("watchCount", 0),
        "n_comments_total": len(comments),
        "comments": strip_leaky_comments(comments, rd),
        "reporter": (f.get("reporter") or {}).get("displayName"),
    }

def main():
    out = []
    for label, clause in CLASSES.items():
        # sample across history: bugs created long ago, resolved before 2024 so the
        # set is stable and not the ones we're about to act on.
        # `level is EMPTY`: this file is published, so no security-restricted issue.
        jql = (f'project = XWIKI AND issuetype = Bug AND level is EMPTY AND {clause} '
               f'AND created <= -156w AND resolved <= -52w AND description IS NOT EMPTY '
               f'ORDER BY created DESC')
        n = 0
        for issue in jira.search(jql, FIELDS, max_total=PER_CLASS):
            out.append(build(issue, label))
            n += 1
        print(f"{label}: {n}")
    json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print("wrote", OUT, len(out))

main()
