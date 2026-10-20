#!/usr/bin/env python3
"""Find, rank and verify duplicate/superseding targets for each candidate.

Two stages, because the backtest showed they fail differently:

  RETRIEVAL (this file, local)  — the bottleneck. Measured against 73 XWiki bugs a
    committer had actually linked as duplicates, the previous approach (a JQL OR over the
    six longest summary words, the first 25 hits in arbitrary order, ranked by character
    similarity of the summaries) put the real target in its shortlist 22% of the time.
    Two things were wrong: the 25-hit cap truncated the pool *before* ranking, and
    character similarity cannot see that "Failed to load the cache in 5 attempts" and
    "cache loading gives up after retries" are the same bug. This version searches `text`
    (summary + description + comments) with a Lucene OR over the informative tokens of
    both the summary and the description, pulls a wide pool, and ranks it by IDF-weighted
    token overlap so rare, discriminating words dominate. Widening the pool from 25 to 300
    and reranking took top-10 recall from 22% to 40%.

  SELECTION (jev) — already strong. Given a shortlist containing the real target, jev
    picked it 15 times out of 18 (83%). It can only choose a key that retrieval found, so
    an invented target is impossible by construction rather than by a rule a judge has to
    follow. `none` is always an option and is the answer it gives most often.

Reads : results/candidates.json
Writes: results/duplicate_candidates.json  {issue_key: {"candidates": [...], "pick": {...}}}

COST: one JIRA search (several pages) per candidate, plus one jev call. Use --limit for a
pilot; the whole backlog is thousands of searches and takes a while.
"""

import argparse
import json
import math
import os
import re
import sys
import threading
import queue

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
import paths  # noqa: E402
import jira       # noqa: E402
import jev        # noqa: E402
import judge      # noqa: E402
import questions  # noqa: E402

HERE = os.path.dirname(__file__)
RESULTS_DIR = paths.RESULTS_DIR

# resolutiondate and fixVersions are what triage.py needs to tell a reporter *when* a
# Fixed target was fixed — and to notice that their bug was seen again after that.
FIELDS = ["summary", "description", "status", "resolution", "resolutiondate", "fixVersions",
          "created", "components"]

# Retrieval knobs. POOL_SIZE is the one that matters most: recall against known duplicate
# links was 22% at 25, 40% at 300. Raising it further keeps helping (73% of targets were
# somewhere in a 400-deep pool) at the cost of more JIRA paging.
POOL_SIZE = 300
SHORTLIST = 10          # candidates offered to jev; its accuracy is flat across 5-10
QUERY_TOKENS = 12       # informative tokens fed to the Lucene OR
MIN_TOKEN_LEN = 4

# Minimum confidence in jev's pick before triage.py may propose a Duplicate close.
# Measured precision against the committer's own linked target: ~44% at 0.6. That number
# understates it — hand-checking the "wrong" picks showed most were genuine members of the
# same duplicate cluster, just not the key the committer happened to link — which is
# exactly why a Duplicate close is proposed for review and never applied unreviewed.
PICK_CONFIDENCE = 0.60

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "when",
    "using", "unable", "cannot", "does", "not", "is", "are", "be", "page", "pages",
    "xwiki", "wiki", "from", "into", "that", "this", "have", "has", "been", "should",
    "would", "could", "will", "your", "you", "but", "than", "then", "also", "used",
    "use", "user", "users", "after", "before", "while", "some", "such", "there",
    "their", "these", "those", "about", "still", "only", "even", "issue", "problem",
    "error", "which", "being", "other", "more", "less", "very", "just", "like",
    "make", "made", "take", "need", "needs", "work", "works", "working", "doesn",
}


def tokens(text, limit=None):
    """Lowercase alphanumeric tokens, stopwords and short words dropped, order kept.

    Pure — no JIRA calls — so the retrieval ranking stays unit-testable offline.
    """
    out = []
    for w in re.split(r"[^A-Za-z0-9]+", (text or "").lower()):
        if len(w) >= MIN_TOKEN_LEN and w not in STOPWORDS and w not in out:
            out.append(w)
    return out[:limit] if limit else out


def query_text(entry):
    """The text a search should be built from: the summary plus the opening of the
    description, where the actual symptom is usually stated."""
    return f"{entry.get('summary') or ''} {(entry.get('description') or '')[:400]}"


def build_jql(project, self_key, toks):
    """A Lucene OR inside a `text ~` clause. `text` covers summary, description and
    comments, so a bug whose summary shares no words with its duplicate can still be
    found through the wording of the report itself."""
    lucene = " OR ".join(toks)
    return (f'project = {project} AND issuetype = Bug AND key != {self_key} '
            f'AND text ~ "{lucene}"')


def rank(entry, hits):
    """IDF-weighted token overlap, normalised by query length, with a component bonus.

    A word shared by half the pool ("save", "document") carries almost no weight; a word
    shared by two issues ("multipart", "jodconverter") carries a lot. That is what lets a
    genuine duplicate outrank a hit that merely repeats the same common vocabulary.
    """
    n = len(hits) or 1
    doc_freq = {}
    hit_tokens = []
    for h in hits:
        ht = set(tokens(f"{h.get('summary') or ''} {h.get('description') or ''}"))
        hit_tokens.append(ht)
        for t in ht:
            doc_freq[t] = doc_freq.get(t, 0) + 1

    query_tokens = set(tokens(query_text(entry)))
    own_components = set(entry.get("components") or [])
    norm = math.sqrt(len(query_tokens) or 1)

    scored = []
    for h, ht in zip(hits, hit_tokens):
        shared = query_tokens & ht
        s = sum(math.log(1 + n / (1 + doc_freq.get(t, 0))) for t in shared) / norm
        if own_components & set(h.get("components") or []):
            s *= 1.15
        scored.append((s, dict(h, score=round(s, 3), shared_terms=sorted(shared)[:8])))
    scored.sort(key=lambda x: -x[0])
    return [h for _, h in scored]


def hit_from(issue):
    """The retrieval view of one JIRA issue — shared by search_pool() and the backfill."""
    f = issue.get("fields", {}) or {}
    status = f.get("status") or {}
    resolution = f.get("resolution") or {}
    return {
        "key": issue.get("key"),
        "summary": f.get("summary"),
        "description": (f.get("description") or "")[:400],
        "status": status.get("name"),
        "resolution": resolution.get("name") if resolution else None,
        "statusCategory": (status.get("statusCategory") or {}).get("key"),
        "resolved": (status.get("statusCategory") or {}).get("key") == "done",
        "resolved_date": f.get("resolutiondate"),
        "fix_versions": [v.get("name") for v in (f.get("fixVersions") or []) if v.get("name")],
        "created": f.get("created"),
        "components": [c.get("name") for c in (f.get("components") or []) if c.get("name")],
        # Only fetched for picked targets (backfill_targets); None means "not fetched".
        "links": ([{"key": (l.get("outwardIssue") or l.get("inwardIssue") or {}).get("key"),
                    "type": (l.get("type") or {}).get("name")}
                   for l in f["issuelinks"]] if "issuelinks" in f else None),
    }


def search_pool(project, entry):
    """Live JIRA search — kept separate from tokens()/rank() so those stay offline-testable."""
    toks = tokens(query_text(entry), QUERY_TOKENS)
    if len(toks) < 2:
        return []
    return [hit_from(issue) for issue in
            jira.search(build_jql(project, entry["key"], toks), FIELDS, max_total=POOL_SIZE)]


def backfill_targets(out):
    """Fetch what triage.py needs about each *picked* target and the pool search does not
    carry: its fix date and versions, and its links — a committer who already linked the
    pair as Related has already said they are not duplicates. One JIRA search per 50
    targets, not a re-run of retrieval; targets already backfilled are skipped."""
    stale = {}
    for v in out.values():
        target = (v.get("pick") or {}).get("target_issue")
        for c in v.get("candidates") or []:
            if c.get("key") == target and ("resolved_date" not in c or c.get("links") is None):
                stale.setdefault(target, []).append(c)
    keys = sorted(stale)
    for i in range(0, len(keys), 50):
        for issue in jira.search(f"key in ({','.join(keys[i:i + 50])})",
                                 FIELDS + ["issuelinks"]):
            fresh = slim(hit_from(issue))
            for c in stale.get(issue["key"], []):
                c.update({k: v for k, v in fresh.items() if k not in ("score", "shared_terms")})
    return len(keys)


def slim(candidate):
    """What is persisted and shown to jev — the description was only needed for ranking."""
    return {k: candidate.get(k) for k in
            ("key", "summary", "status", "resolution", "statusCategory", "resolved",
             "resolved_date", "fix_versions", "created", "components", "links", "score",
             "shared_terms")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default=os.path.join(RESULTS_DIR, "candidates.json"))
    ap.add_argument("--out", dest="outfile",
                    default=os.path.join(RESULTS_DIR, "duplicate_candidates.json"))
    ap.add_argument("--limit", type=int, default=None, help="pilot cap, oldest-first")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--no-jev", action="store_true",
                    help="retrieve and rank only; skip the selection step")
    judge.add_arg(ap)
    args = ap.parse_args()

    data = json.load(open(args.infile))
    project = data.get("project", "XWIKI")
    candidates = data["candidates"]
    if args.limit:
        candidates = candidates[:args.limit]

    existing = json.load(open(args.outfile)) if os.path.exists(args.outfile) else {}
    todo = [c for c in candidates if c["key"] not in existing]
    print(f"{len(candidates)} candidates, {len(existing)} already enriched, "
          f"{len(todo)} to retrieve (pool={POOL_SIZE}, shortlist={SHORTLIST}).")

    # --- retrieval (JIRA, threaded) ---
    shortlists, lock, work = {}, threading.Lock(), queue.Queue()
    for c in todo:
        work.put(c)

    def retrieve():
        while True:
            try:
                entry = work.get_nowait()
            except queue.Empty:
                return
            try:
                ranked = rank(entry, search_pool(project, entry))[:SHORTLIST]
                with lock:
                    shortlists[entry["key"]] = [slim(h) for h in ranked]
                    if len(shortlists) % 25 == 0:
                        print(f"  ... retrieved {len(shortlists)}/{len(todo)}", flush=True)
            except Exception as e:  # noqa: BLE001 — one bad search must not sink the run
                with lock:
                    print(f"  [warn] {entry['key']}: retrieval failed: {str(e)[:120]}")
                    shortlists[entry["key"]] = []
            finally:
                work.task_done()

    threads = [threading.Thread(target=retrieve) for _ in range(min(args.workers, max(1, len(todo))))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    by_key = {c["key"]: c for c in candidates}
    out = dict(existing)
    for key, cands in shortlists.items():
        out[key] = {"candidates": cands, "pick": None}

    # --- selection (jev) ---
    if not args.no_jev:
        judge_name = judge.resolve(args.judge)
        askable = [by_key[k] for k, v in out.items()
                   if v.get("pick") is None and v.get("candidates")]
        print(f"Asking {judge_name} to select among candidates for {len(askable)} issues...")
        results, errors, usage = judge.ask_many(
            judge_name, askable,
            state_fn=questions.duplicate_state,
            questions_fn=lambda c: questions.duplicate_questions(out[c["key"]]["candidates"]),
        )
        for key, res in results.items():
            pick, probs, conf = jev.choice(res["answers"], "same_problem")
            out[key]["pick"] = {
                "target_issue": None if pick == questions.DUP_NONE else pick,
                "confidence": round(conf, 3),
                "probability": round(probs.get(pick, 0.0), 3),
                "is_solved_by": (jev.noul(res["answers"], "target_is_fix") or 0) >= 0.5,
                "meets_bar": (pick != questions.DUP_NONE and conf >= PICK_CONFIDENCE),
                # PICK_CONFIDENCE was measured on jev; triage.py decides per judge
                # (and per model) whether a pick may drive a close.
                "judge": res.get("model") or judge_name,
            }
        if errors:
            print(f"  {len(errors)} jev calls failed (re-run to retry)")
        print(f"  tokens: {usage['input_tokens']} in / {usage['output_tokens']} out")

    refreshed = backfill_targets(out)
    if refreshed:
        print(f"Backfilled fix date, fix versions and links for {refreshed} picked targets.")

    with open(args.outfile, "w") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)

    named = sum(1 for v in out.values() if (v.get("pick") or {}).get("target_issue"))
    barred = sum(1 for v in out.values() if (v.get("pick") or {}).get("meets_bar"))
    print(f"\nWrote {args.outfile}: {len(out)} issues, "
          f"{named} with a named target, {barred} above the {PICK_CONFIDENCE} confidence bar.")


if __name__ == "__main__":
    main()
