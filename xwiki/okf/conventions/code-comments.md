---
title: Code comment policy
stability: durable
summary: Comment about the code as it is now and state the real reason inline; never justify code by
  its history or point to transient external resources (JIRA/forum/PR URLs).
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle
---

# Code comment policy

Write comments about the code **as it is now**, explaining the real reason for it — the use case,
requirement, constraint, or edge case being handled — stated inline so the comment is
self-contained. Do **not**:

- **Justify code by referring to a previous, old, or removed implementation, or to the change
  itself** ("like the previous X did", "as it was before", "to keep the old behavior", "changed
  because…"). A future reader has no knowledge of that history, and the reference becomes misleading
  once the old code is gone.
- **Point to transient external resources** — JIRA issue keys, forum/mailing-list links, PR or
  commit URLs, etc. They rot over time and disappear entirely if the project ever switches tools,
  leaving a dangling reference.

Put the actual reasoning in the comment itself. Change history and issue references belong in the
**commit message** (which keeps its JIRA prefix — see [[commit-messages]]), not in the code.
