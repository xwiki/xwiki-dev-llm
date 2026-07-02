---
title: Commit message convention
stability: durable
summary: Prefix the summary with the repo's JIRA issue key, or [Misc] when there is no issue.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices
---

# Commit message convention

- Prefix the summary with the **JIRA issue key** when there is one: `XWIKI-12345: <summary>`. Use
  the repo's own project key — `XCOMMONS-…`, `XRENDERING-…`, or the contrib extension's key.
- Use **`[Misc]`** as the prefix for changes that have no associated issue.

Issue tracker is https://jira.xwiki.org (NOT GitHub Issues). For the full PR/commit flow (one
squashed commit per issue, PR description, backports) use the `xwiki-pull-request` skill.

**Security fixes are the exception:** until an issue is officially disclosed, the public commit
message must be **obfuscated** — describe the mechanical change, never that it closes a vulnerability
or how it was exploitable. See [[security-policy]].
