---
title: Release and versioning process (outline)
stability: durable
summary: How XWiki versions and releases its projects at a high level. The detailed steps and any
  current dates/plans/owners are volatile — follow the dev-wiki pointers.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/ReleaseProcess
  - https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/
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
- Released artifacts and snapshots are published to **nexus.xwiki.org** (see [[index]] in
  `servers/`); the Extension Manager consumes them.
- xwiki-contrib extensions follow their **own** release + documentation process, including a release
  blog post — use the `xwiki-contrib-release-blog-post` skill for that step.

## Volatile — follow the pointer, do not cache

- The **detailed release steps** → https://dev.xwiki.org/xwiki/bin/view/Community/ReleaseProcess
- **Current release plans / dates** → https://dev.xwiki.org/xwiki/bin/view/ReleasePlans/
- **The current dev version** → read the repo's root `pom.xml` (see [[versioning]]).
- **Role holders** (release manager of the cycle, etc.) → the dev wiki; these rotate.
