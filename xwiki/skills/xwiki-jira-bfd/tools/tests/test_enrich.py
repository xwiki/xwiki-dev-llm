"""Offline tests for the duplicate-retrieval ranking.

`tokens`, `build_jql` and `rank` never touch JIRA, so the part of duplicate detection that
was measurably broken — the ranking — can be tested without a network.
"""

import unittest

import enrich_duplicates as ed


def hit(key, summary, description="", components=None):
    return {"key": key, "summary": summary, "description": description,
            "components": components or [], "status": "Open", "resolution": None,
            "statusCategory": "new", "resolved": False, "created": "2010-01-01"}


class TestTokens(unittest.TestCase):
    def test_drops_stopwords_and_short_words(self):
        self.assertEqual(ed.tokens("The page cannot be saved in XWiki"), ["saved"])

    def test_deduplicates_while_keeping_order(self):
        self.assertEqual(ed.tokens("attachment upload attachment rename"),
                         ["attachment", "upload", "rename"])

    def test_respects_the_limit(self):
        self.assertEqual(len(ed.tokens("alpha bravo charlie delta echo foxtrot", 3)), 3)

    def test_empty_text_is_not_an_error(self):
        self.assertEqual(ed.tokens(None), [])


class TestJql(unittest.TestCase):
    def test_builds_a_lucene_or_over_the_text_field(self):
        jql = ed.build_jql("XWIKI", "XWIKI-1", ["attachment", "rename"])
        # `text` covers summary, description and comments — a duplicate whose summary
        # shares no words can still be reached through the body of the report.
        self.assertIn('text ~ "attachment OR rename"', jql)
        self.assertIn("key != XWIKI-1", jql)


class TestRank(unittest.TestCase):
    def test_a_rare_shared_term_outranks_several_common_ones(self):
        # This is the property that the previous difflib ranking lacked, and it only
        # shows up in a realistic pool: "document"/"save"/"fails" are in most of the
        # pool and carry almost no weight, while "jodconverter" is in two issues and
        # carries a lot. A pool of four would not separate them.
        entry = {"key": "XWIKI-1", "summary": "jodconverter fails to save the document",
                 "description": "", "components": []}
        hits = [hit("XWIKI-2", "jodconverter conversion failure")]
        hits += [hit(f"XWIKI-{i}", "document fails to save correctly")
                 for i in range(3, 23)]
        ranked = ed.rank(entry, hits)
        self.assertEqual(ranked[0]["key"], "XWIKI-2")

    def test_a_shared_component_breaks_a_tie_upwards(self):
        entry = {"key": "XWIKI-1", "summary": "attachment upload broken",
                 "description": "", "components": ["Attachments"]}
        hits = [hit("XWIKI-2", "attachment upload broken", components=["Other"]),
                hit("XWIKI-3", "attachment upload broken", components=["Attachments"])]
        ranked = ed.rank(entry, hits)
        self.assertEqual(ranked[0]["key"], "XWIKI-3")

    def test_no_shared_terms_scores_zero(self):
        entry = {"key": "XWIKI-1", "summary": "attachment upload broken",
                 "description": "", "components": []}
        ranked = ed.rank(entry, [hit("XWIKI-2", "scheduler cron expression rejected")])
        self.assertEqual(ranked[0]["score"], 0.0)

    def test_ranking_is_ordered_and_keeps_every_hit(self):
        # Unlike the previous version there is no score floor here: the shortlist is cut
        # by position, and jev is always offered `none`, so a weak pool costs nothing.
        entry = {"key": "XWIKI-1", "summary": "attachment upload broken",
                 "description": "", "components": []}
        hits = [hit(f"XWIKI-{i}", "attachment upload broken" if i % 2 else "unrelated text")
                for i in range(2, 12)]
        ranked = ed.rank(entry, hits)
        self.assertEqual(len(ranked), len(hits))
        self.assertEqual([r["score"] for r in ranked],
                         sorted((r["score"] for r in ranked), reverse=True))

    def test_records_which_terms_matched(self):
        entry = {"key": "XWIKI-1", "summary": "attachment upload broken",
                 "description": "", "components": []}
        ranked = ed.rank(entry, [hit("XWIKI-2", "attachment upload fails")])
        self.assertIn("attachment", ranked[0]["shared_terms"])



class TestHitFrom(unittest.TestCase):
    def test_keeps_the_fix_date_and_versions_triage_needs(self):
        h = ed.slim(ed.hit_from({"key": "XWIKI-12525", "fields": {
            "summary": "s", "status": {"name": "Closed", "statusCategory": {"key": "done"}},
            "resolution": {"name": "Fixed"}, "resolutiondate": "2015-09-18T10:00:00.000+0200",
            "fixVersions": [{"name": "7.3-milestone-1"}], "created": "2015-07-20",
            "components": []}}))
        self.assertEqual(h["resolved_date"], "2015-09-18T10:00:00.000+0200")
        self.assertEqual(h["fix_versions"], ["7.3-milestone-1"])


if __name__ == "__main__":
    unittest.main()
