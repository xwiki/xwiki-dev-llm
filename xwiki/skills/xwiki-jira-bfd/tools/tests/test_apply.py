import unittest

import apply


class TestCloseIsMeasured(unittest.TestCase):
    def test_jev_and_legacy_rows_are_measured(self):
        self.assertTrue(apply.close_is_measured({"resolution": "Duplicate"}))
        self.assertTrue(apply.close_is_measured(
            {"resolution": "Invalid", "judged_by": {"scores": "jev-1.13.0"}}))

    def test_a_hand_edited_close_from_an_unmeasured_judge_is_refused(self):
        self.assertFalse(apply.close_is_measured(
            {"resolution": "Invalid", "judged_by": {"scores": "claude:claude-sonnet-6"}}))

    def test_measured_claude_may_close_but_not_as_a_duplicate(self):
        j = {"scores": "claude:claude-sonnet-5", "duplicate_pick": "claude:claude-sonnet-5"}
        self.assertTrue(apply.close_is_measured({"resolution": "Won't Fix", "judged_by": j}))
        self.assertFalse(apply.close_is_measured({"resolution": "Duplicate", "judged_by": j}))
        self.assertFalse(apply.close_is_measured({"resolution": "Inactive", "judged_by": j}))


class TestLinkFor(unittest.TestCase):
    def test_duplicate_returns_link_tuple(self):
        self.assertEqual(
            apply.link_for("Duplicate", "XWIKI-1", "XWIKI-2"),
            ("Duplicate", "XWIKI-1", "XWIKI-2"))

    def test_solved_by_returns_related_link_tuple(self):
        self.assertEqual(
            apply.link_for("Solved By", "XWIKI-1", "XWIKI-2"),
            ("Related", "XWIKI-1", "XWIKI-2"))

    def test_inactive_returns_none(self):
        self.assertIsNone(apply.link_for("Inactive", "XWIKI-1", None))

    def test_duplicate_without_target_returns_none(self):
        self.assertIsNone(apply.link_for("Duplicate", "XWIKI-1", None))


# A small fake-transition fixture, modeled on jira.xwiki.org's real transition shapes.
FAKE_TRANSITIONS = [
    {"id": "1", "name": "Start Progress", "to": {"name": "In Progress",
     "statusCategory": {"key": "indeterminate"}}},
    {"id": "2", "name": "Close Issue", "to": {"name": "Closed",
     "statusCategory": {"key": "done"}}},
    {"id": "3", "name": "Reopen Issue", "to": {"name": "Reopened",
     "statusCategory": {"key": "new"}}},
]


class TestPickClosingTransition(unittest.TestCase):
    def test_selects_done_category_transition(self):
        t = apply.pick_closing_transition(FAKE_TRANSITIONS)
        self.assertIsNotNone(t)
        self.assertEqual(t["name"], "Close Issue")

    def test_returns_none_when_no_closing_transition(self):
        transitions = [FAKE_TRANSITIONS[0], FAKE_TRANSITIONS[2]]
        self.assertIsNone(apply.pick_closing_transition(transitions))


if __name__ == "__main__":
    unittest.main()
