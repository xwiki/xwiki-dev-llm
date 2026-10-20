"""The jev question bank for XWiki BFD triage, and the state each question sees.

Every question here earned its place in the backtest (`eval/`): the AUC column in
`eval/RESULTS.md` says how well each one separates the outcomes a committer actually
chose on 360 historically-resolved XWiki bugs. Questions that scored ~0.5 (no signal)
were removed rather than left in as decoration — except where a question is used to
*draft the comment* rather than to decide, which is marked below.

Design notes, from https://docs.typesafe.ai/concepts/how-to-build-with-system-one:
- One narrow judgment per question. The composite decision is made in code
  (`triage.py`), so thresholds and weights can be retuned without touching prompts.
- Every question about one issue goes in a single request: they run in parallel and
  cost only their own tokens, so a speculative question is nearly free.
- Backticked paths (`issue.description`) point the model at a field of the state.
"""

# Curated grounding, mirroring grounding/rewrites.md. Kept in the state (not the
# questions) because it is evidence, not instruction.
XWIKI_CONTEXT = (
    "XWiki is a Java wiki platform, first released in 2004; the current line is 17.x "
    "(2025). Subsystems removed or rewritten from scratch since 2010, whose original "
    "code paths no longer exist: the GWT WYSIWYG editor (replaced by CKEditor, default "
    "from 8.2); the OpenOffice-based office importer (replaced by a LibreOffice server "
    "plus jodconverter); the old LiveTable (replaced by Live Data from 12.x); the "
    "Watchlist (replaced by Notifications in 9.x); the old Panels/Colibri skins (replaced "
    "by Flamingo); the GWT-based Annotations UI; XEclipse; and much of the 'Old Core' "
    "XWikiDocument/XWikiContext API surface (superseded by the Model / DocumentReference "
    "APIs). Only the maintained LTS and latest lines receive fixes; every release older "
    "than roughly two years is end-of-life, which is true of nearly every old report and "
    "so is never on its own a reason to close one."
)

# --- the bank -------------------------------------------------------------

TRIAGE_QUESTIONS = {
    # The strongest single signal in the backtest: AUC 0.81 for "this one got fixed"
    # and, inverted, for "this one was closed without a fix". The per-option
    # probabilities are what triage.py thresholds on.
    "committer_action": {
        "type": "choice",
        "instructions": (
            "An XWiki committer is triaging `issue` on a backlog-cleanup day, years after "
            "it was reported. Which outcome would they choose?"
        ),
        "criteria": {
            "fix": "A real, current, tractable defect — keep it open and fix it.",
            "duplicate_or_superseded": "The same problem is already tracked elsewhere, or was already solved by other work.",
            "cannot_reproduce": "Plausible when reported, but nobody could reproduce it today from what the report gives.",
            "invalid": "Not a defect: expected behaviour, the reporter's own configuration or misuse, or out of scope.",
            "wont_fix": "A real limitation, but deliberately not worth fixing.",
        },
    },
    # AUC 0.75 for "closed without a fix". Drives the Invalid draft.
    "is_expected_behaviour": {
        "type": "noul",
        "instructions": (
            "The behaviour described in `issue` is actually correct, by design, or caused "
            "by the reporter's own configuration or misuse, rather than a defect."
        ),
        "criteria": {
            "true": "Works as designed, a misunderstanding, a user or configuration error, or an unsupported use.",
            "false": "A genuine product defect.",
        },
    },
    # AUC 0.75 for Cannot Reproduce, 0.71 for "closed without a fix".
    "environment_bound": {
        "type": "noul",
        "instructions": (
            "The problem in `issue` is bound to a specific external environment version "
            "that XWiki no longer targets — an old browser, database, JDBC driver, Java, "
            "servlet container, or office suite."
        ),
        "criteria": {
            "true": "It only happens on that named old environment.",
            "false": "Environment-independent, or the named environment is still current.",
        },
    },
    # AUC 0.75 for Cannot Reproduce, 0.68 for Won't Fix.
    "niche_edge_case": {
        "type": "noul",
        "instructions": (
            "`issue` affects such a narrow or unusual situation that a maintainer would "
            "reasonably decide a fix is not worth the effort."
        ),
        "criteria": {
            "true": "A rare combination of options, a deprecated workflow, or a cosmetic detail few users hit.",
            "false": "Something a typical user would hit on a normal path.",
        },
    },
    # AUC 0.62 for "closed without a fix". The citation for an Inactive close.
    "targets_removed_subsystem": {
        "type": "noul",
        "instructions": (
            "Using `xwiki_context`, the code or feature `issue` is about belongs to a "
            "subsystem XWiki has since removed or rewritten from scratch, so the reported "
            "code path no longer exists."
        ),
        "criteria": {
            "true": "The issue sits squarely inside one of the named removed or rewritten subsystems.",
            "false": "The area still exists in current XWiki, or the match is only vaguely related.",
        },
    },
    # AUC 0.64 for "gets fixed". Used as a guard on every close proposal.
    "still_applies_today": {
        "type": "noul",
        "instructions": (
            "If a user ran the latest XWiki release today, the problem in `issue` would "
            "most likely still occur."
        ),
        "criteria": {
            "true": "Nothing in the report suggests the cause has gone away.",
            "false": "The area was rewritten, the environment is obsolete, or the described cause could not exist today.",
        },
    },
    # AUC 0.66 for Won't Fix, 0.62 for "closed without a fix".
    "evidence_already_addressed": {
        "type": "noul",
        "instructions": (
            "The text of `issue` or its `comments` states that the problem was already "
            "fixed, superseded by other work, or made moot."
        ),
        "criteria": {
            "true": "Someone says it is fixed or obsolete, or points at other work that covers it.",
            "false": "No such statement; the thread just stops, or is still debating.",
        },
    },
    # AUC 0.61 for Won't Fix. An unfinished design debate is a human's call, so this
    # pushes an issue out of the auto-close lane and into the escalate lane.
    "unresolved_debate": {
        "type": "noul",
        "instructions": (
            "`comments` show maintainers disagreeing, or an unfinished design discussion, "
            "about what the right behaviour should be."
        ),
        "criteria": {
            "true": "Competing proposals, or an explicit open question left hanging.",
            "false": "No comments, agreement, or purely factual notes.",
        },
    },
    # The two that rank the quick-wins list rather than any close.
    "fix_effort": {
        "type": "score",
        "instructions": (
            "How much engineering work would fixing `issue` take for someone who already "
            "knows the XWiki codebase?"
        ),
        "criteria": [
            "Trivial: a one-line, label, template or configuration change.",
            "Small: a contained change inside one class, plus a test.",
            "Medium: coordinated changes across several classes or one whole component.",
            "Large: design work, an API change, or a subsystem rewrite.",
        ],
    },
    "impact": {
        "type": "score",
        "instructions": "How bad is the consequence for a user who hits the problem in `issue`?",
        "criteria": [
            "Cosmetic or an inconvenience; nothing is lost and work continues.",
            "A feature is degraded but a workaround exists.",
            "A feature is unusable and there is no workaround.",
            "Data loss, a security exposure, or the wiki cannot be used at all.",
        ],
    },
    # Not a decision signal (AUC ~0.4 against the historical label — XWiki's "Cannot
    # Reproduce" means "we tried and could not", not "no steps given"). Kept because the
    # drafted Cannot Reproduce / Incomplete comment must say which detail is missing.
    "has_repro_steps": {
        "type": "noul",
        "instructions": (
            "`issue.description` gives concrete, followable reproduction steps — specific "
            "actions, inputs, or a sample — that a developer could execute today without "
            "asking the reporter anything."
        ),
        "criteria": {
            "true": "Explicit steps, a URL, a code or document sample, or a stack trace tied to an action.",
            "false": "A vague narrative, a symptom with no steps, or steps that reference material never attached.",
        },
    },
}


def triage_state(issue, max_comments=12):
    """The state for the triage questions: the issue as a triager would see it."""
    state = {
        "issue": {
            "key": issue.get("key"),
            "summary": issue.get("summary"),
            "description": (issue.get("description") or "")[:6000],
            "components": issue.get("components") or [],
            "affects_versions": issue.get("affects_versions") or [],
            "reported": (issue.get("created") or "")[:10],
            "age_years": round((issue.get("created_age_days") or 0) / 365.25, 1),
            "status": issue.get("status"),
            "votes": (issue.get("signals") or {}).get("votes", 0),
            "watchers": (issue.get("signals") or {}).get("watchers", 0),
        },
        "xwiki_context": XWIKI_CONTEXT,
    }
    comments = issue.get("comment_bodies") or []
    if comments:
        state["comments"] = comments[:max_comments]
    return state


# --- duplicate selection --------------------------------------------------
# Retrieval finds candidates; jev picks among them. In the backtest jev picked the
# committer's own duplicate target 15/18 times (83%) whenever that target was in the
# candidate list — so the candidate list, not the judgment, is the bottleneck.

DUP_NONE = "none"


def duplicate_questions(candidates):
    """Build the Choice over this issue's retrieved candidates, plus `none`.

    The model can only choose a key that was retrieved, which is what makes an invented
    target impossible by construction rather than by a rule the judge has to obey.
    """
    criteria = {}
    for c in candidates:
        state = c.get("resolution") or c.get("status") or "unresolved"
        comps = ", ".join(c.get("components") or []) or "no component"
        criteria[c["key"]] = (
            f"{c.get('summary')} "
            f"[{state}, reported {(c.get('created') or '')[:10]}, {comps}]"
        )
    criteria[DUP_NONE] = (
        "None of the listed issues reports the same problem as `issue`. Choose this "
        "unless one of them is genuinely the same defect."
    )
    return {
        "same_problem": {
            "type": "choice",
            "instructions": (
                "Which of these existing XWiki issues reports the SAME underlying problem "
                "as `issue` — the same defect with the same cause, not merely something in "
                "the same feature area?"
            ),
            "criteria": criteria,
        },
        "target_is_fix": {
            "type": "noul",
            "instructions": (
                "The issue chosen for `same_problem` is a *more specific* piece of work "
                "whose fix would have resolved `issue`, rather than simply another report "
                "of the same bug."
            ),
            "criteria": {
                "true": "It is the work that fixed the problem — `issue` was solved by it.",
                "false": "It is another report of the same bug, or nothing was chosen.",
            },
        },
    }


def duplicate_state(issue):
    return {
        "issue": {
            "key": issue.get("key"),
            "summary": issue.get("summary"),
            "description": (issue.get("description") or "")[:3000],
            "components": issue.get("components") or [],
            "reported": (issue.get("created") or "")[:10],
        },
    }
