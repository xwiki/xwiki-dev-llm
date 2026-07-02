---
title: <short decision title, e.g. "Check binary but not source compatibility">
stability: durable
status: accepted          # proposed | accepted | superseded | deprecated
summary: <one line: the decision and its core reason>
sources:                  # REQUIRED and REAL — see the grounding rule below
  - <dev-wiki / design.xwiki.org / forum URL, or "session: <committer> stated <what>, <date>">
supersedes:               # slug of an ADR this replaces, or omit
superseded-by:            # slug of the ADR that replaces this one, or omit
---

# <decision title>

## Context
<The forces at play: the problem, constraints, and what made a decision necessary. Grounded only.>

## Decision
<What was decided. State it as the durable position the project holds.>

## Consequences
<What this enables and what it costs — including the trade-offs accepted. Grounded only.>

<!--
GROUNDING RULE (this is what keeps ADRs trustworthy):
An ADR is written ONLY when the rationale is grounded in a real, citable source — a dev-wiki or
design.xwiki.org page, a forum thread, or an explicit committer statement in the current session,
recorded in `sources:`. NEVER invent context or consequences the LLM was not told. If the *why* is
not grounded, do not write an ADR: record the *what* as a convention instead, or open the ADR with
status `proposed` and a `sources:` note flagging that a human must supply the rationale.
Filenames are descriptive slugs (NOT sequential 0001- numbers) to avoid PR-collision on the number.
-->
