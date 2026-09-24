"""Offline tests for the Claude judge's schema and answer mapping — no `claude` call."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import claude_judge  # noqa: E402
import jev           # noqa: E402
import questions     # noqa: E402


class TestSchema(unittest.TestCase):
    def test_a_duplicate_pick_can_only_name_a_retrieved_key(self):
        qs = questions.duplicate_questions([{"key": "XWIKI-1", "summary": "s"}])
        opts = claude_judge._schema(qs)["properties"]["same_problem"]
        self.assertEqual(set(opts["properties"]), {"XWIKI-1", questions.DUP_NONE})
        self.assertFalse(opts["additionalProperties"])

    def test_every_question_is_required(self):
        schema = claude_judge._schema(questions.TRIAGE_QUESTIONS)
        self.assertEqual(set(schema["required"]), set(questions.TRIAGE_QUESTIONS))


class TestToAnswers(unittest.TestCase):
    def test_maps_to_jev_shapes_that_the_accessors_read(self):
        raw = {
            "committer_action": {"fix": 0.2, "duplicate_or_superseded": 0.0,
                                 "cannot_reproduce": 0.6, "invalid": 0.1, "wont_fix": 0.1},
            "still_applies_today": 0.3,
            "fix_effort": {"0": 0.0, "1": 0.5, "2": 0.5, "3": 0.0},
        }
        a = claude_judge.to_answers(raw, questions.TRIAGE_QUESTIONS)
        self.assertEqual(jev.choice(a, "committer_action")[0], "cannot_reproduce")
        self.assertAlmostEqual(jev.prob(a, "committer_action", "cannot_reproduce"), 0.6)
        self.assertEqual(jev.noul(a, "still_applies_today"), 0.3)
        self.assertEqual(jev.score(a, "fix_effort"), 1.5)

    def test_probabilities_are_renormalised(self):
        raw = {"committer_action": {"fix": 2, "duplicate_or_superseded": 0,
                                    "cannot_reproduce": 2, "invalid": 0, "wont_fix": 0}}
        a = claude_judge.to_answers(raw, questions.TRIAGE_QUESTIONS)
        self.assertAlmostEqual(jev.prob(a, "committer_action", "fix"), 0.5)

    def test_an_unknown_option_is_dropped(self):
        qs = questions.duplicate_questions([{"key": "XWIKI-1", "summary": "s"}])
        a = claude_judge.to_answers({"same_problem": {"XWIKI-1": 0.3, "none": 0.3,
                                                      "XWIKI-666": 0.9}}, qs)
        self.assertNotIn("XWIKI-666", jev.choice(a, "same_problem")[1])


if __name__ == "__main__":
    unittest.main()
