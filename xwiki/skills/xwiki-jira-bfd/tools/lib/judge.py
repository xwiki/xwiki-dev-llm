"""Which model answers the question bank: jev when a TypeSafe key is set, else Claude.

    BFD_JUDGE=jev|claude     force a judge (default: jev if a key is set, else claude)

Both return answers in jev's shape, so the accessors in `jev` (prob, noul, score, choice)
read either. The judge's name is recorded next to every score, because thresholds are
measured per judge: `triage.JUDGES` decides what each one is allowed to propose.
"""

import os

import claude_judge
import jev

JUDGES = ("jev", "claude")


def has_jev_key():
    return bool(os.environ.get("TYPESAFE_TOKEN") or os.environ.get("TYPESAFE_API_KEY"))


def default():
    return "jev" if has_jev_key() else "claude"


def resolve(name=None):
    name = name or os.environ.get("BFD_JUDGE") or default()
    if name not in JUDGES:
        raise SystemExit(f"Unknown judge {name!r}; expected one of {', '.join(JUDGES)}.")
    if name == "jev" and not has_jev_key():
        raise SystemExit("Judge 'jev' needs TYPESAFE_TOKEN (or TYPESAFE_API_KEY).")
    if name == "claude" and not claude_judge.available():
        raise SystemExit("Judge 'claude' needs the `claude` CLI on PATH.")
    return name


def ask_many(name, items, state_fn, questions_fn, workers=None, on_progress=None):
    backend = jev if name == "jev" else claude_judge
    return backend.ask_many(items, state_fn, questions_fn,
                            workers=workers or backend.DEFAULT_WORKERS,
                            on_progress=on_progress)


def add_arg(ap):
    ap.add_argument("--judge", choices=JUDGES, default=None,
                    help="jev (calibrated, needs TYPESAFE_TOKEN) or claude (the `claude` "
                         "CLI). Default: $BFD_JUDGE, else jev if a key is set, else claude.")
