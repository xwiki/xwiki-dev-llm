#!/usr/bin/env python3
"""Turn jev scores into reviewable proposals. Writes results/review.json.

This is the one file that decides anything, and it is deliberately boring code: jev
supplies calibrated probabilities, everything below is arithmetic and policy that a
committer can read, argue with, and change. Retuning a threshold costs nothing — no
re-scoring, no prompt editing — which is the point of keeping the judgment and the policy
apart.

Every threshold below cites what it buys, measured on 360 historically-resolved XWiki
bugs with the outcome a committer actually chose as ground truth (eval/RESULTS.md).
Precision figures are reweighted to the real historical mix (28% of resolved bugs were
closed without a fix), not the balanced sample.

    python3 triage.py                      # default thresholds
    python3 triage.py --close-bar 0.85     # stricter: fewer proposals, higher precision
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
import paths  # noqa: E402
import jev  # noqa: E402

HERE = os.path.dirname(__file__)
RESULTS_DIR = paths.RESULTS_DIR

# --- policy ---------------------------------------------------------------

# P(cannot_reproduce) + P(invalid) + P(wont_fix) from the committer_action Choice: how
# likely a committer would close this without fixing it. Measured precision / share of
# backlog selected:
#   >= 0.90  ~2% of the backlog at ~95% precision
#   >= 0.80  ~4%                at ~94%             <- CLOSE_BAR
#   >= 0.70  ~6%                at ~88%
#   >= 0.60  ~9%                at ~87%             <- SUGGEST_BAR
#   >= 0.50  ~14%               at ~64%
# Re-derive them any time with `python3 eval/backtest.py`.
CLOSE_BAR = 0.80
SUGGEST_BAR = 0.60

# Every bar above was measured on jev's probabilities, and a bar holds only for the model
# and the close rule it was measured on. So each judge lists the close resolutions it has
# been measured for, by `eval/backtest.py --judge <name>`, and passed the pilot gate
# (>= ~90% close precision, zero safety misses). Keys are "jev" (any jev version) or
# "claude:<canonical model>"; any other model — including a newer model behind the same
# `sonnet` alias — has no entry. A judge may rank and suggest anything, but a close whose
# resolution it is not listed for becomes a suggestion, and apply.py has nothing to write.
#
# claude:claude-sonnet-5, measured 2026-09-24 on the same 360 bugs (eval/RESULTS.md):
# - Cannot Reproduce / Invalid / Won't Fix — the no-fix bar with the still_applies guard:
#   at 0.80, 25 bugs at 100% weighted precision and no bug a committer fixed (jev: 39 at
#   97.0%); at 0.70, 49 at 95.4%. jev's 0.80 is reused, not re-tuned on the data it is
#   judged on.
# - Inactive — NOT listed: Claude's answers trigger the Inactive rule on none of the 360
#   bugs, so there is nothing to measure it on, yet it fires on live ones.
# - Duplicate / Solved By — NOT listed: its duplicate selection has not been measured.
JUDGES = {
    "jev": {"closes": ("Duplicate", "Solved By", "Cannot Reproduce", "Won't Fix",
                       "Invalid", "Inactive"),
            "close_bar": CLOSE_BAR, "suggest_bar": SUGGEST_BAR},
    "claude:claude-sonnet-5": {"closes": ("Cannot Reproduce", "Won't Fix", "Invalid"),
                               "close_bar": 0.80, "suggest_bar": 0.60},
}
# What an unmeasured judge borrows to rank its suggestions. Never a licence to close.
UNMEASURED = {"closes": (), "close_bar": CLOSE_BAR, "suggest_bar": SUGGEST_BAR}


def policy(judge_id):
    """The measured policy for a judge id — "jev-1.13.0", "claude:claude-sonnet-5", ... —
    or UNMEASURED. Picks and scores from before judges were recorded are jev's."""
    judge_id = judge_id or "jev"
    return JUDGES["jev"] if judge_id.startswith("jev") else JUDGES.get(judge_id, UNMEASURED)


def may_close(judge_id, resolution):
    return resolution in policy(judge_id)["closes"]


# A close proposal is withdrawn if jev still thinks the bug is live today. The two are
# mostly redundant, which is the point — it costs recall we do not care about.
STILL_APPLIES_CEILING = 0.70

# Quick wins: cheap to fix, and nothing else. On a BFD day the goal is to fix as many bugs
# as possible, so "worth fixing" (P(fix), impact) is deliberately not a criterion — a
# maintainer's decision, not a measurement. fix_effort clusters tightly around its middle
# (quartiles 1.3 / 1.7 / 2.0 on the real backlog), so 1.70 is the real boundary between
# "contained change" and "spans a component"; the report lists them cheapest first.
# fix_effort itself has never been checked against real fix effort — the backtest has no
# ground truth for it — so treat the ranking as jev's estimate, not a measurement.
MAX_EFFORT = 1.70        # on the 0..3 fix_effort scale: trivial to small

# Inactive is the weakest of the close reasons: `targets_removed_subsystem` separates the
# outcomes at AUC 0.62, against 0.81 for the committer_action Choice. So it is never
# enough on its own — an Inactive close also needs jev to be confident the bug is dead
# (`still_applies_today` low) AND uninterested in fixing it (`p_fix` low). Without the
# last of those the branch fired on things like "XWikiDocument.rename deletes the
# original", which lives in Old Core but describes behaviour that may well still exist.
REMOVED_SUBSYSTEM_BAR = 0.80
INACTIVE_MAX_P_FIX = 0.25

# A Duplicate close against a target resolved Fixed tells the reporter "this is fixed".
# That is false when the bug outlived the fix — XWIKI-5612 was matched to XWIKI-12525
# (Fixed 2015) although a 2023 comment had reproduced it on a current version. So such a
# close needs no sign of the bug after the target was fixed: not reported after it, not
# commented on after it. The grace period is one release cycle — someone on the release
# before the fix still reports and discusses the old behaviour. Measured on 250 bugs a
# committer closed against a Fixed target and 164 bugs linked to a Fixed issue that were
# later fixed on their own (eval/closed_targets.json):
#   grace  0d  catches 90% of the bugs that outlived the fix, withholds 39% of real dups
#   grace 30d  catches 82%,                                   withholds 17%   <- default
#   grace 90d  catches 57%,                                   withholds 10%
#   grace 180d catches 46%,                                   withholds  5%
# "Withheld" is not lost: the lead stays in the report as a suggestion.
FIXED_TARGET_GRACE_DAYS = 30

DISPOSITIONS = ("close", "suggest", "quick_win", "keep", "escalate")
CLOSE_RESOLUTIONS = ("Duplicate", "Solved By", "Cannot Reproduce", "Won't Fix",
                     "Invalid", "Inactive")

REOPEN = ("If you can still reproduce it on a currently-supported XWiki release, please "
          "reopen with the steps and the version and we will gladly look again.")


def hard_vetoes(entry):
    """Reasons a bug may never be auto-closed, whatever the scores say.

    Deliberately short. The previous version vetoed on watchers > 1 and on any link to an
    open issue, which removed 31 of 40 pilot candidates and left almost nothing to review;
    the backtest found neither signal supports "leave this open" (bugs with three or more
    watchers were in fact the *least* likely to be fixed). What survives here are the
    signals where being wrong is genuinely costly.
    """
    s = entry.get("signals") or {}
    reasons = []
    if s.get("has_security_label"):
        reasons.append("carries the `security` label — security issues are never aged out")
    if s.get("has_security_level"):
        reasons.append("is security-restricted in JIRA — an undisclosed vulnerability is "
                       "never aged out, and never gets a public comment")
    if s.get("recent_comment"):
        reasons.append(f"commented on in the last 2 years "
                       f"(last activity {s.get('updated_age_days')}d ago)")
    if (entry.get("status") or "").lower() == "in progress":
        reasons.append("someone has it In Progress")
    return reasons


def soft_flags(entry, answers):
    """Reasons to downgrade a close to a suggestion: real, but a human's call."""
    s = entry.get("signals") or {}
    flags = []
    votes = s.get("votes") or 0
    if votes > 0:
        flags.append(f"{votes} vote(s) — someone asked for this")
    # unresolved_debate does not separate close-from-fix on its own (AUC 0.50) but does
    # pick out Won't Fix specifically (0.61). It is used only to push a proposal down a
    # notch, never to drive one.
    if (jev.noul(answers, "unresolved_debate") or 0) >= 0.60:
        flags.append("the comment thread is an unfinished design discussion")
    if (jev.score(answers, "impact") or 0) >= 2.5:
        flags.append("scored at the top of the impact scale (data loss / security / unusable)")
    open_links = s.get("linked_open_issues") or []
    if len(open_links) >= 3:
        flags.append("linked to %d open issues" % len(open_links))
    return flags


def outlived_fixed_target(entry, target_row):
    """Why this bug cannot be closed against a Fixed target, or None if it can.

    Pure — dates only, no JIRA — so both classify() and the invariant check in main()
    can call it. A Fixed target with no known resolution date fails closed: the check
    cannot be made, so the close is not proposed.
    """
    if (target_row or {}).get("resolution") != "Fixed":
        return None
    key = target_row.get("key")
    fixed = parse_date(target_row.get("resolved_date"))
    if not fixed:
        return (f"{key} is Fixed but its fix date is unknown — re-run "
                f"enrich_duplicates.py to check this bug did not outlive the fix")
    grace = fixed + datetime.timedelta(days=FIXED_TARGET_GRACE_DAYS)
    created = parse_date(entry.get("created"))
    if created and created > grace:
        return (f"reported {created:%Y-%m-%d}, after {key} was fixed ({fixed:%Y-%m-%d}) "
                f"— the fix did not stop it being reported")
    last = parse_date((entry.get("comments") or {}).get("last_date"))
    if last and last > grace:
        return (f"commented on {last:%Y-%m-%d}, after {key} was fixed ({fixed:%Y-%m-%d}) "
                f"— check the thread before calling it fixed")
    return None


def already_linked(entry, target_row):
    """Why this bug cannot be closed as a duplicate of the target because a committer has
    already judged the pair, or None.

    A link of any type other than Duplicate is that judgement: XWIKI-11441 was split out
    of XWIKI-6550 when 6550 was closed Won't Fix, and linked Related to it. Of 1750 XWiki
    pairs a committer linked Related, 8 (0.5%) were later closed as each other's
    duplicate; of 259 real duplicates of a closed target, 13 (5%) also carried such a
    link (eval/closed_targets.json). Unknown links fail closed, like an unknown fix date.
    """
    if not target_row:
        return None
    key = target_row.get("key")
    if target_row.get("links") is None:
        return (f"{key}'s links are unknown — re-run enrich_duplicates.py to check a "
                f"committer has not already linked the two as distinct")
    types = sorted({l.get("type") for l in target_row["links"]
                    if l.get("key") == entry.get("key") and l.get("type") != "Duplicate"})
    if types:
        return (f"a committer already linked it to {key} as {' / '.join(types)}, "
                f"not as a duplicate")
    return None


def parse_date(s):
    try:
        return datetime.datetime.strptime(s[:10], "%Y-%m-%d") if s else None
    except ValueError:
        return None


def is_quick_win(p_no_fix, effort, args):
    """Cheap to fix — the other half of a BFD day.

    Only effort decides. The one exclusion is a bug jev already expects a committer to
    close without fixing (P(no fix) at or above the suggest bar): that belongs in the
    close suggestions, and fixing it would be work nobody asked for.
    """
    if effort is None:
        return False
    return effort <= MAX_EFFORT and p_no_fix < args.suggest_bar


def pick_no_fix_resolution(answers):
    """Among the three no-fix outcomes, the one jev weights highest, plus its rationale."""
    options = {
        "Cannot Reproduce": jev.prob(answers, "committer_action", "cannot_reproduce"),
        "Invalid": jev.prob(answers, "committer_action", "invalid"),
        "Won't Fix": jev.prob(answers, "committer_action", "wont_fix"),
    }
    resolution = max(options, key=options.get)
    return resolution, options


def draft_comment(resolution, entry, answers, target=None, target_row=None):
    """A templated closure comment.

    Templates rather than generated prose on purpose: a comment goes to the person who
    reported the bug, sometimes fifteen years ago, and every one of these is reviewed by a
    committer before it is sent. A template says only what the pipeline actually knows,
    cannot drift, and reads the same every time — a generated paragraph can quietly assert
    a cause nobody verified.
    """
    age = round((entry.get("created_age_days") or 0) / 365.25)
    opening = (f"Thank you for this report, and sorry it sat for so long — we are going "
               f"through the oldest part of the bug backlog ({age} years, in this case).")

    # What the target's state lets us truthfully say. "Follow X for updates" is only
    # true of an open target; a Fixed one is a claim that this bug is fixed, and says in
    # which version so the reporter can check.
    t_res = (target_row or {}).get("resolution")
    versions = (target_row or {}).get("fix_versions") or []
    listed = (", ".join(versions[:-1]) + " and " + versions[-1] if len(versions) > 1
              else "".join(versions))
    fixed_in = f"fixed in XWiki {listed}" if versions else "since fixed"
    if_still = ("If you still see it on a current release" if not versions else
                f"If you still see it on {listed} or later" if len(versions) == 1 else
                "If you still see it on one of those versions or later")

    if resolution == "Duplicate":
        if t_res == "Fixed":
            return (f"{opening} This is the same problem as {target}, which was "
                    f"{fixed_in}, so we are closing it as a duplicate. {if_still}, "
                    f"please reopen and tell us the version — then it is a different "
                    f"problem and we will look at it separately.")
        if t_res:
            return (f"{opening} This is the same problem as {target}, which was closed as "
                    f"{t_res}; the explanation there applies here too, so we are closing "
                    f"it as a duplicate. If you think this is actually a distinct problem, "
                    f"please reopen and say how it differs.")
        return (f"{opening} This is the same problem as {target}, so we are closing it as "
                f"a duplicate and keeping the discussion in one place. Please follow "
                f"{target} for updates. If you think this is actually a distinct problem, "
                f"please reopen and say how it differs.")

    if resolution == "Solved By":
        if t_res == "Fixed":
            return (f"{opening} This was addressed by the work done in {target}, "
                    f"{fixed_in}, so we are closing it as solved by that issue. "
                    f"{if_still}, please reopen with the steps and the version and we "
                    f"will gladly look again.")
        return (f"{opening} This was addressed by the work done in {target}, so we are "
                f"closing it as solved by that issue. {REOPEN}")

    if resolution == "Cannot Reproduce":
        missing = ("" if (jev.noul(answers, "has_repro_steps") or 0) >= 0.5 else
                   " The report does not have enough detail for us to reproduce it now.")
        env = (" It also looks specific to an environment (browser, database or office "
               "suite version) we no longer support." if
               (jev.noul(answers, "environment_bound") or 0) >= 0.60 else "")
        return (f"{opening} We can no longer reproduce this on a current release.{missing}"
                f"{env} We are closing it as Cannot Reproduce. {REOPEN}")

    if resolution == "Invalid":
        return (f"{opening} Looking at it again, this is the behaviour XWiki is meant to "
                f"have rather than a defect, so we are closing it as Invalid. If we have "
                f"misread the report, please reopen and explain what you expected instead "
                f"— we would rather be corrected than close something real.")

    if resolution == "Won't Fix":
        return (f"{opening} This is a genuine limitation, but it affects a narrow enough "
                f"case that we do not expect to work on it, so we are closing it as "
                f"Won't Fix rather than leaving it open indefinitely. If it is costing you "
                f"real trouble, please reopen and tell us — that changes the calculation.")

    if resolution == "Inactive":
        return (f"{opening} It concerns a part of XWiki that has since been rewritten, so "
                f"the code path this describes no longer exists. We are closing it as "
                f"Inactive. {REOPEN}")

    return opening


def classify(entry, answers, dup, args):
    """One candidate → one review row. Pure: no JIRA, no jev, no I/O — this is what
    `tests/test_triage.py` exercises."""
    row = {
        "key": entry["key"],
        "summary": entry.get("summary"),
        "url": entry.get("url"),
        "created_age_years": round((entry.get("created_age_days") or 0) / 365.25, 1),
        "components": entry.get("components") or [],
        "affects_versions": entry.get("affects_versions") or [],
        "status": entry.get("status"),
        "signals": entry.get("signals") or {},
        "disposition": "keep",
        "resolution": None,
        "target_issue": None,
        "drafted_comment": None,
        "target_state": None,
        "reasons": [],
        "vetoes": [],
        "flags": [],
        "scores": {},
    }

    if not answers:
        row["disposition"] = "escalate"
        row["reasons"].append("not scored (jev call failed or not run yet)")
        return row

    p_fix = jev.prob(answers, "committer_action", "fix")
    p_dup = jev.prob(answers, "committer_action", "duplicate_or_superseded")
    resolution, no_fix_probs = pick_no_fix_resolution(answers)
    p_no_fix = sum(no_fix_probs.values())
    effort = jev.score(answers, "fix_effort")
    impact = jev.score(answers, "impact")
    still = jev.noul(answers, "still_applies_today")
    removed = jev.noul(answers, "targets_removed_subsystem")

    row["scores"] = {
        "p_fix": round(p_fix, 3),
        "p_duplicate": round(p_dup, 3),
        "p_close_no_fix": round(p_no_fix, 3),
        "no_fix_split": {k: round(v, 3) for k, v in no_fix_probs.items()},
        "fix_effort": round(effort, 2) if effort is not None else None,
        "impact": round(impact, 2) if impact is not None else None,
        "still_applies_today": round(still, 3) if still is not None else None,
        "targets_removed_subsystem": round(removed, 3) if removed is not None else None,
        "confidence": round(jev.choice(answers, "committer_action")[2], 3),
    }

    row["vetoes"] = hard_vetoes(entry)
    row["flags"] = soft_flags(entry, answers)

    pick = (dup or {}).get("pick") or {}
    target = pick.get("target_issue")
    dup_ok = bool(pick.get("meets_bar"))
    target_row = next((c for c in ((dup or {}).get("candidates") or [])
                       if c.get("key") == target), None)

    # Never point a reporter at a dead end. A target that was itself closed as a
    # duplicate is not the canonical issue — closing against it makes the trail one hop
    # longer instead of shorter — and a target closed as Invalid/Incomplete says nothing
    # useful about this bug. Retrieval found the cluster; a human picks its head.
    dup_chain = False
    if dup_ok and (target_row or {}).get("resolution") in (
            "Duplicate", "Invalid", "Incomplete"):
        dup_ok, dup_chain = False, True
        row["flags"].append(
            f"{target} is itself resolved {target_row['resolution']} — follow the chain "
            f"to the canonical issue before closing against it")

    # A target is only a valid close if a committer has not already linked the pair as
    # something else, and — for a Fixed target — this bug did not outlive the fix. When
    # either fails, the lead is kept as a fallback suggestion, and the other branches decide first
    # — XWIKI-5612, which outlived its "duplicate", was a Won't Fix all along.
    outlived = (already_linked(entry, target_row)
                or outlived_fixed_target(entry, target_row)) if dup_ok else None
    if outlived:
        dup_ok = False
        row["reasons"].append(f"not closed against {target}: {outlived}")

    # --- choose the proposal ---
    proposal, proposed_resolution = None, None

    if dup_ok and target:
        proposal = "close"
        proposed_resolution = "Solved By" if pick.get("is_solved_by") else "Duplicate"
        row["target_issue"] = target
        row["target_state"] = (f"{(target_row or {}).get('status')}"
                               f"/{(target_row or {}).get('resolution') or 'unresolved'}"
                               if target_row else None)
        row["reasons"].append(
            f"jev selected {target} from {len(((dup or {}).get('candidates')) or [])} "
            f"retrieved candidates at confidence {pick.get('confidence')}")
    elif dup_chain:
        # A real lead that simply cannot be cited as-is. Surfaced as a suggestion so the
        # reviewer gets the pointer rather than the issue silently falling back to `keep`.
        proposal = "suggest"
        proposed_resolution = "Duplicate"
        row["target_issue"] = target
        row["target_state"] = (f"{(target_row or {}).get('status')}"
                               f"/{(target_row or {}).get('resolution')}")
        row["reasons"].append(
            f"jev selected {target} at confidence {pick.get('confidence')}, but that "
            f"issue is not a canonical target")
    elif p_no_fix >= args.close_bar:
        proposal = "close"
        proposed_resolution = resolution
        row["reasons"].append(
            f"P(closed without a fix) = {p_no_fix:.2f} >= {args.close_bar}; "
            f"strongest outcome {resolution} at {no_fix_probs[resolution]:.2f}")
    elif ((removed or 0) >= REMOVED_SUBSYSTEM_BAR
            and (still or 1) < STILL_APPLIES_CEILING
            and p_fix <= INACTIVE_MAX_P_FIX):
        proposal = "close"
        proposed_resolution = "Inactive"
        row["reasons"].append(
            f"sits in a rewritten-away subsystem ({removed:.2f}), unlikely to still apply "
            f"({still:.2f}), and not scored as worth fixing ({p_fix:.2f})")
    elif is_quick_win(p_no_fix, effort, args):
        row["disposition"] = "quick_win"
        row["reasons"].append(f"cheap to fix: effort {effort:.1f}/3 <= {MAX_EFFORT}")
        return row
    elif p_no_fix >= args.suggest_bar:
        proposal = "suggest"
        proposed_resolution = resolution
        row["reasons"].append(
            f"P(closed without a fix) = {p_no_fix:.2f}, between {args.suggest_bar} and "
            f"{args.close_bar} — a committer's call")
    elif outlived:
        proposal = "suggest"
        proposed_resolution = "Duplicate"
        row["target_issue"] = target
        row["target_state"] = f"{target_row.get('status')}/{target_row.get('resolution')}"
    else:
        row["reasons"].append(
            f"nothing clears a bar (P(fix)={p_fix:.2f}, P(no-fix close)={p_no_fix:.2f})")
        return row

    # --- apply the guards ---
    # A close is only as good as the judges whose numbers fed it, and each must have been
    # measured for this resolution: the triage scores always, and for a Duplicate /
    # Solved By close the duplicate pick too.
    blockers = []
    if proposal == "close":
        if not may_close(getattr(args, "judge", "jev"), proposed_resolution):
            blockers.append(getattr(args, "judge", "jev"))
        if proposed_resolution in ("Duplicate", "Solved By") \
                and not may_close(pick.get("judge"), proposed_resolution):
            blockers.append(f"{pick.get('judge') or 'jev'} (duplicate selection)")
    row["judged_by"] = {"scores": getattr(args, "judge", "jev")}
    if row["target_issue"]:
        row["judged_by"]["duplicate_pick"] = pick.get("judge") or "jev"
    if proposal == "close" and blockers:
        proposal = "suggest"
        row["flags"].append(
            f"judged by {', '.join(blockers)}, not measured for {proposed_resolution} "
            f"closes — a suggestion until `eval/backtest.py` measures it and it passes")

    if proposal == "close" and (still or 0) >= STILL_APPLIES_CEILING \
            and proposed_resolution not in ("Duplicate", "Solved By"):
        proposal = "suggest"
        row["flags"].append(
            f"jev still expects this to happen today ({still:.2f}) — downgraded to a suggestion")

    if row["vetoes"]:
        proposal = "suggest" if proposal == "close" else proposal

    if proposal == "close" and row["flags"]:
        proposal = "suggest"

    row["disposition"] = proposal
    row["resolution"] = proposed_resolution
    row["drafted_comment"] = draft_comment(proposed_resolution, entry, answers,
                                           row["target_issue"], target_row)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default=os.path.join(RESULTS_DIR, "candidates.json"))
    ap.add_argument("--scores", default=os.path.join(RESULTS_DIR, "scores.json"))
    ap.add_argument("--duplicates", default=os.path.join(RESULTS_DIR, "duplicate_candidates.json"))
    ap.add_argument("--out", default=os.path.join(RESULTS_DIR, "review.json"))
    ap.add_argument("--close-bar", type=float, default=None,
                    help="default: the bar measured for the judge that scored the issues")
    ap.add_argument("--suggest-bar", type=float, default=None)
    args = ap.parse_args()

    data = json.load(open(args.candidates))
    candidates = data["candidates"]
    scored = json.load(open(args.scores)) if os.path.exists(args.scores) else {}
    scores = scored.get("scores", {})
    # The judge is the model that actually answered. Scores from more than one model are
    # not one judge, and no measured policy covers them.
    models = {v.get("model") or "jev" for v in scores.values()}
    args.judge = models.pop() if len(models) == 1 else "mixed:" + ",".join(sorted(models))
    args.close_bar = args.close_bar or policy(args.judge)["close_bar"]
    args.suggest_bar = args.suggest_bar or policy(args.judge)["suggest_bar"]
    dups = json.load(open(args.duplicates)) if os.path.exists(args.duplicates) else {}

    rows = [classify(c, (scores.get(c["key"]) or {}).get("answers"), dups.get(c["key"]), args)
            for c in candidates]

    counts = {}
    for r in rows:
        counts[r["disposition"]] = counts.get(r["disposition"], 0) + 1
    # Invariants re-checked here rather than trusted from above: the pipeline's one real
    # failure mode is a close going out that should not have.
    warnings = []
    by_key = {c["key"]: c for c in candidates}
    for r in rows:
        if r["disposition"] != "close":
            continue
        broken = []
        if r["resolution"] in ("Duplicate", "Solved By") and r["target_issue"]:
            target_row = next((c for c in ((dups.get(r["key"]) or {}).get("candidates") or [])
                               if c.get("key") == r["target_issue"]), None)
            withheld = (already_linked(by_key[r["key"]], target_row)
                        or outlived_fixed_target(by_key[r["key"]], target_row))
            if withheld:
                broken.append(f"closed against a target it may not cite: {withheld}")
        if r["resolution"] not in CLOSE_RESOLUTIONS:
            broken.append(f"unknown resolution {r['resolution']!r}")
        if r["resolution"] in ("Duplicate", "Solved By") and not r["target_issue"]:
            broken.append(f"{r['resolution']} close with no target issue")
        if not (r["drafted_comment"] or "").strip():
            broken.append("no drafted comment")
        if r["vetoes"]:
            broken.append(f"hard veto present: {'; '.join(r['vetoes'])}")
        pick_judge = ((dups.get(r["key"]) or {}).get("pick") or {}).get("judge")
        if not may_close(args.judge, r["resolution"]) or (
                r["resolution"] in ("Duplicate", "Solved By")
                and not may_close(pick_judge, r["resolution"])):
            broken.append(f"a judge not measured for {r['resolution']} closes proposed one")
        if broken:
            # Downgrade in place. classify() should never produce these — if one appears,
            # the bug is in classify(), and escalating is how it surfaces instead of
            # reaching apply.py.
            r["disposition"] = "escalate"
            r["resolution"] = None
            r["reasons"].append("downgraded by an invariant check: " + "; ".join(broken))
            warnings.append(f"{r['key']}: " + "; ".join(broken))
            counts["close"] -= 1
            counts["escalate"] = counts.get("escalate", 0) + 1
    for w in warnings:
        print(f"[INVARIANT] {w}")

    res_counts = {}
    for r in rows:
        if r["disposition"] in ("close", "suggest") and r["resolution"]:
            k = f'{r["disposition"]}/{r["resolution"]}'
            res_counts[k] = res_counts.get(k, 0) + 1

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump({
            "cohort": data.get("cohort"),
            "judge": args.judge,
            "judge_closes": list(policy(args.judge)["closes"]),
            "project": data.get("project", "XWIKI"),
            "thresholds": {"close_bar": args.close_bar, "suggest_bar": args.suggest_bar,
                           "max_effort": MAX_EFFORT},
            "counts": counts,
            "resolution_counts": res_counts,
            "warnings": warnings,
            "review": rows,
        }, fh, indent=2, ensure_ascii=False)

    print(f"\nWrote {args.out}: {len(rows)} rows")
    for k in DISPOSITIONS:
        if counts.get(k):
            print(f"  {k:<10} {counts[k]}")
    for k in sorted(res_counts):
        print(f"      {k}: {res_counts[k]}")
    print("Next: python3 make_report.py && open results/report.md")


if __name__ == "__main__":
    main()
