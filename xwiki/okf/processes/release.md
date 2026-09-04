---
title: Release and versioning process (outline)
stability: durable
summary: How XWiki versions and releases its projects at a high level, and which stable branches a
  fix may be backported to. The detailed steps and any current dates/plans/owners are volatile —
  follow the dev-wiki pointers.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/ReleaseProcess
  - https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/
  - https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/
  - https://dev.xwiki.org/xwiki/bin/view/Community/SecurityPolicy/
---

# Release and versioning process (outline)

This is a durable orientation, not a step-by-step runbook. The runbook on the dev wiki is the source
of truth and changes over time — fetch it when actually releasing.

## Durable facts

- **Commons, Rendering and Platform release together** with the **same version number**. Treat them
  as one coordinated release train.
- Version numbering and the milestone/RC/final cadence are defined in **Versioning and Release
  Practices** (the same page that backs the `@since`/`@Unstable` rules — see [[versioning]] and
  [[backward-compatibility]]).
- **Backport targets follow the cycle.** Ordinary fixes go to the maintained stable branches of the
  current cycle and the previous one. The branch **two cycles back** (current major − 2) takes
  **security fixes only** — a "Critical" vulnerability, CVSS >= 7 per [[security-policy]] — never an
  ordinary bug fix, however small. Derive that branch from the root `pom.xml` version rather than
  memorising it: with master on `18.x` the security-only line is `16.10.x`, and it becomes `17.10.x`
  once master reaches `19.x`. A repo offering a `backport stable-<old>.x` GitHub label does not make
  that branch a routine target.
- Released artifacts and snapshots are published to **nexus.xwiki.org** (see [[index]] in
  `servers/`); the Extension Manager consumes them.
- xwiki-contrib extensions follow their **own** release + documentation process, including a release
  blog post — use the `xwiki-contrib-release-blog-post` skill for that step.

## Volatile — follow the pointer, do not cache

- The **detailed release steps** → https://dev.xwiki.org/xwiki/bin/view/Community/ReleaseProcess
- **Current release plans / dates** → https://dev.xwiki.org/xwiki/bin/view/ReleasePlans/
- **The current dev version** → read the repo's root `pom.xml` (see [[versioning]]).
- **Role holders** (release manager of the cycle, etc.) → the dev wiki; these rotate.
