"""Offline tests for triage.classify — the one function that decides anything.

No JIRA, no jev: `classify` is pure, which is the point. Every test here is a rule a
committer should be able to rely on when reading a close proposal.
"""

import argparse
import unittest

import triage


def args(close_bar=0.80, suggest_bar=0.60, judge="jev"):
    return argparse.Namespace(close_bar=close_bar, suggest_bar=suggest_bar, judge=judge)


def entry(**over):
    e = {
        "key": "XWIKI-1", "summary": "Something is broken", "url": "http://x",
        "created_age_days": 5000, "components": ["Old Core"], "affects_versions": ["2.0"],
        "status": "Open",
        "signals": {"votes": 0, "watchers": 0, "has_security_label": False,
                    "linked_open_issues": [], "recent_comment": False,
                    "updated_age_days": 4000},
    }
    e.update(over)
    return e


def answers(fix=0.1, cnr=0.6, invalid=0.1, wont=0.1, dup=0.1,
            still=0.2, removed=0.1, effort=1.0, impact=1.5, debate=0.0, repro=0.8):
    return {
        "committer_action": {
            "type": "choice", "choice": "cannot_reproduce", "confidence": 0.7,
            "probabilities": {"fix": fix, "cannot_reproduce": cnr, "invalid": invalid,
                              "wont_fix": wont, "duplicate_or_superseded": dup},
        },
        "still_applies_today": {"type": "noul", "noul": still},
        "targets_removed_subsystem": {"type": "noul", "noul": removed},
        "unresolved_debate": {"type": "noul", "noul": debate},
        "has_repro_steps": {"type": "noul", "noul": repro},
        "is_expected_behaviour": {"type": "noul", "noul": 0.1},
        "environment_bound": {"type": "noul", "noul": 0.1},
        "niche_edge_case": {"type": "noul", "noul": 0.1},
        "evidence_already_addressed": {"type": "noul", "noul": 0.1},
        "fix_effort": {"type": "score", "score": effort, "confidence": 0.6,
                       "probabilities": {}},
        "impact": {"type": "score", "score": impact, "confidence": 0.6,
                   "probabilities": {}},
    }


def dup_pick(target="XWIKI-99", confidence=0.9, meets_bar=True, is_solved_by=False,
             resolution=None, status="Open", resolved_date=None, fix_versions=None,
             links=()):
    return {
        "candidates": [{"key": target, "summary": "The same thing", "status": status,
                        "resolution": resolution, "components": [], "created": "2010-01-01",
                        "resolved_date": resolved_date, "fix_versions": fix_versions or [],
                        "links": None if links is None else list(links)}],
        "pick": {"target_issue": target, "confidence": confidence,
                 "meets_bar": meets_bar, "is_solved_by": is_solved_by},
    }


class TestCloseBar(unittest.TestCase):
    def test_above_close_bar_proposes_a_close(self):
        r = triage.classify(entry(), answers(cnr=0.85, invalid=0.0, wont=0.0), None, args())
        self.assertEqual(r["disposition"], "close")
        self.assertEqual(r["resolution"], "Cannot Reproduce")
        self.assertTrue(r["drafted_comment"])

    def test_between_the_bars_only_suggests(self):
        r = triage.classify(entry(), answers(fix=0.3, cnr=0.65, invalid=0.0, wont=0.0),
                            None, args())
        self.assertEqual(r["disposition"], "suggest")
        self.assertEqual(r["resolution"], "Cannot Reproduce")

    def test_below_both_bars_is_left_alone(self):
        r = triage.classify(entry(), answers(fix=0.3, cnr=0.2, invalid=0.1, wont=0.1, effort=2.5),
                            None, args())
        self.assertEqual(r["disposition"], "keep")
        self.assertIsNone(r["resolution"])

    def test_strongest_no_fix_outcome_wins_the_resolution(self):
        r = triage.classify(entry(), answers(cnr=0.2, invalid=0.1, wont=0.6), None, args())
        self.assertEqual(r["resolution"], "Won't Fix")

    def test_the_bar_is_the_sum_not_any_single_outcome(self):
        # No single outcome clears 0.80, but together they do: a committer would close it,
        # even if which label they'd pick is a coin flip.
        r = triage.classify(entry(), answers(fix=0.1, cnr=0.35, invalid=0.3, wont=0.25),
                            None, args())
        self.assertEqual(r["disposition"], "close")


class TestGuards(unittest.TestCase):
    def test_a_security_label_can_never_be_closed(self):
        e = entry()
        e["signals"]["has_security_label"] = True
        r = triage.classify(e, answers(cnr=0.95), None, args())
        self.assertEqual(r["disposition"], "suggest")
        self.assertTrue(any("security" in v for v in r["vetoes"]))

    def test_a_security_restricted_issue_can_never_be_closed(self):
        e = entry()
        e["signals"]["has_security_level"] = True
        r = triage.classify(e, answers(cnr=0.95), None, args())
        self.assertEqual(r["disposition"], "suggest")
        self.assertTrue(any("security-restricted" in v for v in r["vetoes"]))

    def test_a_recent_comment_can_never_be_closed(self):
        e = entry()
        e["signals"]["recent_comment"] = True
        r = triage.classify(e, answers(cnr=0.95), None, args())
        self.assertEqual(r["disposition"], "suggest")

    def test_in_progress_can_never_be_closed(self):
        r = triage.classify(entry(status="In Progress"), answers(cnr=0.95), None, args())
        self.assertEqual(r["disposition"], "suggest")

    def test_a_vote_downgrades_a_close_to_a_suggestion(self):
        e = entry()
        e["signals"]["votes"] = 1
        r = triage.classify(e, answers(cnr=0.95), None, args())
        self.assertEqual(r["disposition"], "suggest")

    def test_watchers_alone_do_not_block_anything(self):
        # The signal the previous pipeline vetoed on, and the backtest found backwards.
        e = entry()
        e["signals"]["watchers"] = 7
        r = triage.classify(e, answers(cnr=0.9), None, args())
        self.assertEqual(r["disposition"], "close")

    def test_still_applying_today_downgrades_a_no_fix_close(self):
        r = triage.classify(entry(), answers(cnr=0.9, still=0.85), None, args())
        self.assertEqual(r["disposition"], "suggest")

    def test_an_unscored_issue_escalates_rather_than_being_kept(self):
        r = triage.classify(entry(), None, None, args())
        self.assertEqual(r["disposition"], "escalate")


class TestInactive(unittest.TestCase):
    def test_a_rewritten_subsystem_closes_as_inactive(self):
        r = triage.classify(entry(), answers(fix=0.05, cnr=0.2, invalid=0.1, wont=0.1,
                                             removed=0.9, still=0.1), None, args())
        self.assertEqual(r["disposition"], "close")
        self.assertEqual(r["resolution"], "Inactive")

    def test_a_rewritten_subsystem_is_not_enough_when_it_still_looks_worth_fixing(self):
        r = triage.classify(entry(), answers(fix=0.45, cnr=0.2, invalid=0.1, wont=0.1,
                                             removed=0.9, still=0.1), None, args())
        self.assertNotEqual(r["resolution"], "Inactive")


class TestDuplicates(unittest.TestCase):
    def test_a_confident_pick_closes_as_duplicate(self):
        r = triage.classify(entry(), answers(), dup_pick(), args())
        self.assertEqual(r["disposition"], "close")
        self.assertEqual(r["resolution"], "Duplicate")
        self.assertEqual(r["target_issue"], "XWIKI-99")
        self.assertIn("XWIKI-99", r["drafted_comment"])

    def test_a_fixing_target_closes_as_solved_by(self):
        r = triage.classify(entry(), answers(), dup_pick(is_solved_by=True), args())
        self.assertEqual(r["resolution"], "Solved By")

    def test_a_pick_below_the_confidence_bar_is_not_a_duplicate_close(self):
        r = triage.classify(entry(), answers(cnr=0.2, fix=0.4),
                            dup_pick(meets_bar=False), args())
        self.assertNotEqual(r["resolution"], "Duplicate")

    def test_a_target_that_is_itself_a_duplicate_only_suggests(self):
        r = triage.classify(entry(), answers(), dup_pick(resolution="Duplicate",
                                                         status="Closed"), args())
        self.assertEqual(r["disposition"], "suggest")
        self.assertEqual(r["target_issue"], "XWIKI-99")
        self.assertTrue(any("canonical" in f for f in r["flags"]))


def fixed_pick(**over):
    kw = dict(resolution="Fixed", status="Closed", resolved_date="2015-09-18T10:00:00.000+0200",
              fix_versions=["7.3-milestone-1"])
    kw.update(over)
    return dup_pick(**kw)


def old_bug(last_comment=None, created="2010-10-25T10:45:07.000+0200"):
    return entry(created=created,
                 comments={"count": 1 if last_comment else 0, "last_date": last_comment})


def dupish():
    """Scores that clear no bar of their own, so only the duplicate lead can close it."""
    return answers(fix=0.2, cnr=0.1, invalid=0.05, wont=0.05, dup=0.6, effort=2.5)


class TestFixedTargets(unittest.TestCase):
    """XWIKI-5612: matched to XWIKI-12525 (Fixed 2015), reproduced in 2023."""

    def test_a_bug_silent_since_before_the_fix_closes_as_its_duplicate(self):
        r = triage.classify(old_bug("2011-01-01T00:00:00.000+0100"), dupish(), fixed_pick(),
                            args())
        self.assertEqual(r["disposition"], "close")
        self.assertEqual(r["resolution"], "Duplicate")

    def test_a_comment_after_the_fix_blocks_the_duplicate_close(self):
        r = triage.classify(old_bug("2023-12-13T20:10:40.000+0100"), dupish(), fixed_pick(),
                            args())
        self.assertNotEqual(r["disposition"], "close")
        self.assertEqual(r["disposition"], "suggest")
        self.assertEqual(r["target_issue"], "XWIKI-99")
        self.assertTrue(any("after XWIKI-99 was fixed" in x for x in r["reasons"]))

    def test_a_bug_that_outlived_the_fix_falls_through_to_its_own_verdict(self):
        # The 5612 shape: a committer's "feels like a won't fix" and P(no fix) = 0.99.
        r = triage.classify(old_bug("2023-12-13T20:10:40.000+0100"),
                            answers(cnr=0.0, invalid=0.0, wont=0.95), fixed_pick(), args())
        self.assertEqual(r["disposition"], "close")
        self.assertEqual(r["resolution"], "Won't Fix")
        self.assertIsNone(r["target_issue"])

    def test_a_bug_reported_after_the_fix_is_not_its_duplicate(self):
        r = triage.classify(old_bug(created="2017-02-02T00:00:00.000+0100"), dupish(),
                            fixed_pick(), args())
        self.assertEqual(r["disposition"], "suggest")

    def test_activity_within_one_release_cycle_of_the_fix_is_tolerated(self):
        r = triage.classify(old_bug("2015-10-01T00:00:00.000+0200"), dupish(), fixed_pick(),
                            args())
        self.assertEqual(r["disposition"], "close")

    def test_a_fixed_target_with_no_known_fix_date_fails_closed(self):
        r = triage.classify(old_bug(), dupish(), fixed_pick(resolved_date=None), args())
        self.assertNotEqual(r["disposition"], "close")
        self.assertTrue(any("re-run" in x for x in r["reasons"]))

    def test_open_targets_are_untouched_by_the_fix_date_check(self):
        r = triage.classify(old_bug("2023-12-13T20:10:40.000+0100"), dupish(), dup_pick(),
                            args())
        self.assertEqual(r["disposition"], "close")

    def test_the_comment_says_it_was_fixed_and_in_which_version(self):
        r = triage.classify(old_bug(), dupish(), fixed_pick(), args())
        self.assertIn("fixed in XWiki 7.3-milestone-1", r["drafted_comment"])
        self.assertNotIn("for updates", r["drafted_comment"])

    def test_several_fix_versions_read_as_a_list(self):
        r = triage.classify(old_bug(), dupish(),
                            fixed_pick(fix_versions=["12.10.10", "13.4.4", "13.8-rc-1"]), args())
        self.assertIn("fixed in XWiki 12.10.10, 13.4.4 and 13.8-rc-1", r["drafted_comment"])
        self.assertIn("one of those versions or later", r["drafted_comment"])

    def test_the_comment_never_promises_updates_from_a_closed_target(self):
        r = triage.classify(old_bug(), dupish(), dup_pick(resolution="Won't Fix",
                                                           status="Closed"), args())
        self.assertIn("closed as Won't Fix", r["drafted_comment"])
        self.assertNotIn("for updates", r["drafted_comment"])


class TestExistingLinks(unittest.TestCase):
    """XWIKI-11441: split out of XWIKI-6550 when 6550 was closed Won't Fix, linked Related."""

    def test_a_pair_already_linked_related_is_not_closed_as_duplicates(self):
        r = triage.classify(entry(), dupish(),
                            dup_pick(resolution="Won't Fix", status="Closed",
                                     links=[{"key": "XWIKI-1", "type": "Related"}]), args())
        self.assertEqual(r["disposition"], "suggest")
        self.assertEqual(r["target_issue"], "XWIKI-99")
        self.assertTrue(any("already linked it to XWIKI-99 as Related" in x
                            for x in r["reasons"]))

    def test_an_existing_duplicate_link_is_no_objection(self):
        r = triage.classify(entry(), dupish(),
                            dup_pick(links=[{"key": "XWIKI-1", "type": "Duplicate"}]), args())
        self.assertEqual(r["disposition"], "close")

    def test_links_to_other_issues_do_not_count(self):
        r = triage.classify(entry(), dupish(),
                            dup_pick(links=[{"key": "XWIKI-7", "type": "Related"}]), args())
        self.assertEqual(r["disposition"], "close")

    def test_a_cheap_bug_whose_lead_was_withheld_is_a_quick_win_that_keeps_the_lead(self):
        r = triage.classify(entry(), answers(fix=0.2, cnr=0.1, invalid=0.05, wont=0.05,
                                             effort=1.0),
                            dup_pick(links=[{"key": "XWIKI-1", "type": "Related"}]), args())
        self.assertEqual(r["disposition"], "quick_win")
        self.assertTrue(any(x.startswith("not closed against XWIKI-99") for x in r["reasons"]))

    def test_unknown_links_fail_closed(self):
        r = triage.classify(entry(), dupish(), dup_pick(links=None), args())
        self.assertNotEqual(r["disposition"], "close")
        self.assertTrue(any("re-run" in x for x in r["reasons"]))


class TestQuickWins(unittest.TestCase):
    def test_cheap_becomes_a_quick_win(self):
        r = triage.classify(entry(), answers(fix=0.85, cnr=0.05, invalid=0.05, wont=0.05,
                                             effort=1.0, impact=2.0), None, args())
        self.assertEqual(r["disposition"], "quick_win")
        self.assertIsNone(r["resolution"])

    def test_worth_is_not_a_criterion_only_cost_is(self):
        # A BFD day fixes as many bugs as possible: low P(fix), low impact, still a win.
        r = triage.classify(entry(), answers(fix=0.3, cnr=0.2, invalid=0.1, wont=0.1,
                                             effort=1.0, impact=0.3), None, args())
        self.assertEqual(r["disposition"], "quick_win")

    def test_expensive_is_not_a_quick_win(self):
        r = triage.classify(entry(), answers(fix=0.85, cnr=0.05, invalid=0.05, wont=0.05,
                                             effort=2.8, impact=2.0), None, args())
        self.assertEqual(r["disposition"], "keep")

    def test_a_likely_close_stays_a_close_suggestion_even_when_cheap(self):
        r = triage.classify(entry(), answers(fix=0.2, cnr=0.65, invalid=0.0, wont=0.0,
                                             effort=0.5), None, args())
        self.assertEqual(r["disposition"], "suggest")

    def test_a_quick_win_never_carries_a_drafted_closure_comment(self):
        r = triage.classify(entry(), answers(fix=0.9, cnr=0.03, invalid=0.03, wont=0.02,
                                             effort=0.8, impact=2.0), None, args())
        self.assertIsNone(r["drafted_comment"])


SONNET = "claude:claude-sonnet-5"


class TestJudges(unittest.TestCase):
    """Bars are measured per judge and model; an unmeasured one may rank, never close."""

    def test_the_measured_claude_model_closes_what_clears_the_bar(self):
        r = triage.classify(entry(), answers(cnr=0.95), None, args(judge=SONNET))
        self.assertEqual(r["disposition"], "close")
        self.assertEqual(r["judged_by"], {"scores": SONNET})

    def test_an_unmeasured_model_suggests_what_jev_would_close(self):
        for judge in ("claude:claude-sonnet-6", "claude:claude-haiku-4-5", "mixed:a,b"):
            with self.subTest(judge=judge):
                r = triage.classify(entry(), answers(cnr=0.95), None, args(judge=judge))
                self.assertEqual(r["disposition"], "suggest")
                self.assertEqual(r["resolution"], "Cannot Reproduce")
                self.assertTrue(any("not measured for" in f for f in r["flags"]))

    def test_claude_duplicate_picks_only_suggest_until_measured(self):
        d = dup_pick()
        d["pick"]["judge"] = SONNET
        r = triage.classify(entry(), dupish(), d, args(judge=SONNET))
        self.assertEqual(r["disposition"], "suggest")
        self.assertEqual(r["resolution"], "Duplicate")
        self.assertTrue(any("duplicate selection" in f for f in r["flags"]))

    def test_claude_is_not_measured_for_inactive(self):
        r = triage.classify(entry(), answers(fix=0.05, cnr=0.2, invalid=0.1, wont=0.1,
                                             removed=0.9, still=0.1), None, args(judge=SONNET))
        self.assertEqual(r["disposition"], "suggest")
        self.assertEqual(r["resolution"], "Inactive")

    def test_picks_from_before_judges_were_recorded_count_as_jev(self):
        r = triage.classify(entry(), dupish(), dup_pick(), args())
        self.assertEqual(r["disposition"], "close")

    def test_any_jev_version_is_jev(self):
        r = triage.classify(entry(), answers(cnr=0.95), None, args(judge="jev-1.13.0"))
        self.assertEqual(r["disposition"], "close")

    def test_quick_wins_do_not_depend_on_the_judge(self):
        r = triage.classify(entry(), answers(fix=0.3, cnr=0.2, invalid=0.1, wont=0.1,
                                             effort=1.0), None, args(judge="claude:other"))
        self.assertEqual(r["disposition"], "quick_win")


class TestDraftedComments(unittest.TestCase):
    def test_every_close_resolution_drafts_something_that_invites_a_reopen(self):
        for resolution in ("Cannot Reproduce", "Won't Fix", "Invalid", "Inactive"):
            with self.subTest(resolution=resolution):
                text = triage.draft_comment(resolution, entry(), answers())
                self.assertTrue(text)
                self.assertIn("reopen", text.lower())

    def test_target_resolutions_name_the_target(self):
        for resolution in ("Duplicate", "Solved By"):
            with self.subTest(resolution=resolution):
                text = triage.draft_comment(resolution, entry(), answers(), "XWIKI-42")
                self.assertIn("XWIKI-42", text)


if __name__ == "__main__":
    unittest.main()
