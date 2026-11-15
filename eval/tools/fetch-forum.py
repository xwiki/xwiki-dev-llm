"""Fetches the question post and the accepted answer of sampled solved forum topics (anonymous, rate-limited).

Usage: python3 -I fetch-forum.py <solved-candidates.json> <per-category> <out threads.json>
"""
import html, json, random, re, sys, time, urllib.error, urllib.request

cand_file, per_cat, out_file = sys.argv[1], int(sys.argv[2]), sys.argv[3]

def get(path):
    for i in range(8):
        try:
            req = urllib.request.Request("https://forum.xwiki.org" + path,
                                         headers={"Accept": "application/json", "User-Agent": "xwiki-dev-llm-eval"})
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(min(int(e.headers.get("Retry-After") or 10 * (i + 1)), 90))
    raise RuntimeError("rate limited: " + path)

def text(cooked):
    t = re.sub(r"<pre[^>]*><code[^>]*>", "\n```\n", cooked)
    t = re.sub(r"</code></pre>", "\n```\n", t)
    t = re.sub(r"<br\s*/?>|</p>|</li>|</h\d>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(t)).strip()

# Proposals and votes are decisions, not questions: group (b) wants a developer's real question.
decision = re.compile(r"\[?(proposal|vote|brainstorm|announce|release)|\bproposal\b", re.I)
cands = [c for c in json.load(open(cand_file)) if not decision.search(c["title"])]
rng = random.Random(20261103)
picked = []
for cat in ("dev", "discuss"):
    pool = [c for c in cands if c["cat"] == cat]
    rng.shuffle(pool)
    picked += pool[:per_cat]

out = []
for n, c in enumerate(picked, 1):
    try:
        t = get(f"/t/{c['id']}.json")
        posts = {p["post_number"]: p for p in t["post_stream"]["posts"]}
        # Newer Discourse returns a list (`accepted_answers`); older a single `accepted_answer`.
        acc = (t.get("accepted_answers") or [None])[0] or t.get("accepted_answer") or {}
        pn = acc.get("post_number") or next((p["post_number"] for p in posts.values() if p.get("accepted_answer")), None)
        if not pn:
            continue
        if pn not in posts:
            sid = t["post_stream"]["stream"][pn - 1] if pn - 1 < len(t["post_stream"]["stream"]) else None
            if sid is None:
                continue
            posts[pn] = get(f"/posts/{sid}.json")
            time.sleep(4)
        q = posts.get(1)
        if not q:
            continue
        out.append({"topic": c["id"], "cat": c["cat"], "title": t["title"], "created": t["created_at"],
                    "url": f"https://forum.xwiki.org/t/{c['id']}",
                    "question": text(q["cooked"])[:6000],
                    "answer_post": pn, "answer": text(posts[pn]["cooked"])[:6000]})
    except Exception as e:  # one bad topic must not lose the batch
        print("skip", c["id"], e, file=sys.stderr)
    print(f"{n}/{len(picked)}", file=sys.stderr)
    time.sleep(4)
    json.dump(out, open(out_file, "w"), indent=1)
print(len(out), "threads", file=sys.stderr)
