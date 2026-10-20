"""Client for TypeSafe's System One API (the `jev` model) — https://docs.typesafe.ai.

Standard library only, matching the rest of this repo. jev returns *typed, calibrated
judgments* (a probability per option), not prose: that is exactly what this pipeline
needs, because a probability can be thresholded and the threshold can be tuned against
the backtest in `eval/`. jev never writes anything anywhere; it only scores.

Auth: a TypeSafe API key from the environment (TYPESAFE_TOKEN, falling back to
TYPESAFE_API_KEY). The key is a secret: it is only ever placed in the Authorization
header, never printed or logged.
"""

import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"

# Every question in one request is evaluated in parallel and costs only its own tokens,
# so the pipeline asks its whole question bank at once rather than one call per question.
# See https://docs.typesafe.ai/patterns/fan-out.
DEFAULT_WORKERS = 8


def token():
    tok = os.environ.get("TYPESAFE_TOKEN") or os.environ.get("TYPESAFE_API_KEY")
    if not tok:
        raise SystemExit(
            "No TypeSafe API key in environment. Export TYPESAFE_TOKEN (or "
            "TYPESAFE_API_KEY) with your typesafe.ai key.")
    return tok


def ask(state, questions, model=MODEL, retries=5, timeout=120):
    """Send one state + a map of typed questions; return the parsed response body."""
    body = json.dumps({"state": state, "model": model, "questions": questions}).encode()
    delay = 1.0
    for attempt in range(retries):
        req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
            "Authorization": f"Bearer {token()}",
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode("utf-8", "replace")
            # 429/529/5xx are transient; 4xx are deterministic and must not be retried.
            if e.code in (429, 529) or e.code >= 500:
                if attempt == retries - 1:
                    raise RuntimeError(f"jev HTTP {e.code} after {retries} tries: {detail}")
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"jev HTTP {e.code}: {detail}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == retries - 1:
                raise RuntimeError(f"jev unreachable after {retries} tries: {e}")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def ask_many(items, state_fn, questions_fn, workers=DEFAULT_WORKERS, on_progress=None):
    """Score many items concurrently.

    items       : the things to score (each must have a "key").
    state_fn    : item -> jev state.
    questions_fn: item -> jev question map (may differ per item, e.g. duplicate options).

    Returns (results, errors): results is {key: {"answers": ..., "usage": ...}},
    errors is a list of (key, message). One item failing never aborts the run — the
    pipeline is resumable and a missing score simply means the issue is not proposed.
    """
    work = queue.Queue()
    for item in items:
        work.put(item)
    results, errors, usage = {}, [], {"input_tokens": 0, "output_tokens": 0}
    lock = threading.Lock()

    def worker():
        while True:
            try:
                item = work.get_nowait()
            except queue.Empty:
                return
            try:
                resp = ask(state_fn(item), questions_fn(item))
                with lock:
                    results[item["key"]] = {
                        "answers": resp.get("answers", {}),
                        "model": resp.get("model"),
                    }
                    for k in usage:
                        usage[k] += (resp.get("usage") or {}).get(k, 0)
                    if on_progress:
                        on_progress(len(results) + len(errors), len(items))
            except Exception as e:  # noqa: BLE001 — one bad issue must not sink the run
                with lock:
                    errors.append((item["key"], str(e)[:200]))
            finally:
                work.task_done()

    threads = [threading.Thread(target=worker) for _ in range(min(workers, max(1, len(items))))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, errors, usage


# --- answer accessors -----------------------------------------------------
# jev answers are typed; these keep the rest of the pipeline from reaching into the
# response shape by hand.

def noul(answers, qid, default=None):
    a = (answers or {}).get(qid)
    return a.get("noul") if a else default


def score(answers, qid, default=None):
    a = (answers or {}).get(qid)
    return a.get("score") if a else default


def choice(answers, qid):
    """Return (chosen_option, probabilities, confidence)."""
    a = (answers or {}).get(qid)
    if not a:
        return None, {}, 0.0
    return a.get("choice"), a.get("probabilities") or {}, a.get("confidence") or 0.0


def prob(answers, qid, option, default=0.0):
    _, probs, _ = choice(answers, qid)
    return probs.get(option, default)
