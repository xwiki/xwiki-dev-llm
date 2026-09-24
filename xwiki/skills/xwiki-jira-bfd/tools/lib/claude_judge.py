"""A jev-compatible judge backed by Claude, for developers without a TypeSafe key.

It answers the same question bank (`lib/questions.py`) and returns answers in jev's exact
shape — `choice` with per-option probabilities, `noul`, `score` with a per-level
distribution — so everything downstream (`triage.py`, the backtest) is unchanged.

What it does NOT inherit is jev's calibration. Claude's stated probabilities are its own
estimate, not a calibrated output, so every threshold measured for jev is invalid here.
`triage.JUDGES` holds the bars measured for each judge; a judge with none proposes no
closes at all (see eval/RESULTS.md).

It runs through the `claude` CLI in print mode — the one Claude access every Claude Code
user already has, whether through a subscription or an API key — with no tools, no MCP
servers, no settings and a minimal system prompt, so a call costs its own tokens and not
Claude Code's context. Standard library only, like the rest of the repo; no credential
passes through this code.
"""

import json
import os
import queue
import shutil
import subprocess
import threading
import time

MODEL = os.environ.get("CLAUDE_JUDGE_MODEL", "sonnet")
DEFAULT_WORKERS = 6
TIMEOUT = 300

SYSTEM_PROMPT = (
    "You are a careful, calibrated classifier for an issue tracker. You receive a JSON "
    "`state` and a list of typed questions about it. Answer every question with "
    "probabilities, never prose. Be calibrated: an option you give 0.9 should be right "
    "nine times out of ten. Use the whole range, and give real weight to alternatives "
    "when the evidence is thin — most old bug reports are ambiguous. Judge only from the "
    "state: do not assume facts that are not in it."
)


def available():
    return shutil.which("claude") is not None


def _schema(questions):
    """A JSON schema that only admits the options each question offers. A duplicate pick
    can therefore only name a retrieved key — the same guarantee jev's Choice gives."""
    props = {}
    for qid, q in questions.items():
        if q["type"] == "choice":
            opts = list(q["criteria"])
            props[qid] = {"type": "object", "additionalProperties": False, "required": opts,
                          "properties": {o: {"type": "number", "minimum": 0, "maximum": 1}
                                         for o in opts}}
        elif q["type"] == "noul":
            props[qid] = {"type": "number", "minimum": 0, "maximum": 1}
        elif q["type"] == "score":
            levels = [str(i) for i in range(len(q["criteria"]))]
            props[qid] = {"type": "object", "additionalProperties": False, "required": levels,
                          "properties": {l: {"type": "number", "minimum": 0, "maximum": 1}
                                         for l in levels}}
    return {"type": "object", "additionalProperties": False, "required": list(props),
            "properties": props}


def _prompt(state, questions):
    lines = ["STATE:", json.dumps(state, ensure_ascii=False, indent=1), "", "QUESTIONS:"]
    for qid, q in questions.items():
        lines.append(f"\n## {qid} ({q['type']})\n{q['instructions']}")
        if q["type"] == "choice":
            lines.append("Give a probability for each option; they should sum to 1.")
            lines += [f"- {k}: {v}" for k, v in q["criteria"].items()]
        elif q["type"] == "noul":
            lines.append("Give the probability that this statement is true.")
            lines += [f"- true: {q['criteria']['true']}",
                      f"- false: {q['criteria']['false']}"]
        elif q["type"] == "score":
            lines.append("Give a probability for each level; they should sum to 1.")
            lines += [f"- {i}: {c}" for i, c in enumerate(q["criteria"])]
    return "\n".join(lines)


def _normalise(d):
    total = sum(max(0.0, float(v)) for v in d.values())
    if total <= 0:
        return {k: 1 / len(d) for k in d}
    return {k: max(0.0, float(v)) / total for k, v in d.items()}


def to_answers(raw, questions):
    """Claude's structured output → jev's answer shapes (pure, unit-tested)."""
    answers = {}
    for qid, q in questions.items():
        v = raw.get(qid)
        if v is None:
            continue
        if q["type"] == "choice":
            probs = _normalise({o: v.get(o, 0.0) for o in q["criteria"]})
            best = max(probs, key=probs.get)
            answers[qid] = {"type": "choice", "choice": best, "confidence": probs[best],
                            "probabilities": {k: round(p, 3) for k, p in probs.items()}}
        elif q["type"] == "noul":
            answers[qid] = {"type": "noul", "noul": round(min(1.0, max(0.0, float(v))), 3)}
        elif q["type"] == "score":
            probs = _normalise({str(i): v.get(str(i), 0.0) for i in range(len(q["criteria"]))})
            answers[qid] = {"type": "score",
                            "score": round(sum(int(k) * p for k, p in probs.items()), 2),
                            "confidence": round(max(probs.values()), 3),
                            "probabilities": {k: round(p, 3) for k, p in probs.items()}}
    return answers


def ask(state, questions, model=MODEL, retries=3):
    cmd = ["claude", "-p", "--output-format", "json", "--model", model,
           "--no-session-persistence", "--tools", "", "--strict-mcp-config",
           "--setting-sources", "", "--disable-slash-commands",
           "--exclude-dynamic-system-prompt-sections",
           "--system-prompt", SYSTEM_PROMPT,
           "--json-schema", json.dumps(_schema(questions))]
    delay = 2.0
    for attempt in range(retries):
        try:
            proc = subprocess.run(cmd, input=_prompt(state, questions), capture_output=True,
                                  text=True, timeout=TIMEOUT)
            out = json.loads(proc.stdout or "{}")
            if out.get("is_error") or not isinstance(out.get("structured_output"), dict):
                raise RuntimeError((out.get("result") or proc.stderr or "no output")[:200])
            usage = out.get("usage") or {}
            # The canonical model that answered, not the alias asked for: "sonnet" moves
            # to newer models over time, and a measured bar belongs to one model.
            canonical = next(iter(out.get("modelUsage") or {}), model)
            return {
                "answers": to_answers(out["structured_output"], questions),
                "model": f"claude:{canonical}",
                "usage": {"input_tokens": usage.get("input_tokens", 0)
                          + usage.get("cache_read_input_tokens", 0)
                          + usage.get("cache_creation_input_tokens", 0),
                          "output_tokens": usage.get("output_tokens", 0),
                          "cost_usd": out.get("total_cost_usd", 0.0)},
            }
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            if attempt == retries - 1:
                raise RuntimeError(f"claude judge failed after {retries} tries: {e}")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def ask_many(items, state_fn, questions_fn, workers=DEFAULT_WORKERS, on_progress=None):
    """Same contract as jev.ask_many: (results, errors, usage)."""
    work = queue.Queue()
    for item in items:
        work.put(item)
    results, errors = {}, []
    usage = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
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
                    results[item["key"]] = {"answers": resp["answers"], "model": resp["model"]}
                    for k in usage:
                        usage[k] += resp["usage"].get(k, 0)
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
