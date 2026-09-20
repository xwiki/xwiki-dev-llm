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
- **Backport targets are the LTS branches.** Two LTS lines are maintained in parallel: the
  Intermediate LTS `N.4.x` (branched end of May) and the Cycle LTS `N.10.x` (branched end of
  November) — with master on `18.9`, `18.4.x` and `17.10.x`. Derive them from the root `pom.xml`
  version rather than memorising them.
- **The recent stable branches are not routine backport targets.** A new stable ships every month,
  so an ordinary fix rides the next release instead of paying for an extra one — a release is
  expensive and the wait is under a month. Backport to one only **on demand**: a mistake bad
  enough that a freshly released stable needs a bugfix release now.
- The LTS line **older** than the maintained two takes **security fixes only** — a "Critical"
  vulnerability, CVSS >= 7 per [[security-policy]] — never an ordinary bug fix, however small; with
  master on `18.x` that is `16.10.x`. A repo offering a `backport stable-<old>.x` GitHub label does
  not make that branch a routine target. **Never name that line in a public artifact** — a PR body,
  a JIRA issue or fix version, a commit message, a forum post — not even to explain why it is
  excluded: naming it implies a support commitment that does not exist. List the targets and stop.
- Released artifacts and snapshots are published to **nexus.xwiki.org** (see [[index]] in
  `servers/`); the Extension Manager consumes them.
- xwiki-contrib extensions follow their **own** release + documentation process, including a release
  blog post — use the `xwiki-contrib-release-blog-post` skill for that step.

## Volatile — follow the pointer, do not cache

- The **detailed release steps** → https://dev.xwiki.org/xwiki/bin/view/Community/ReleaseProcess
- **Current release plans / dates** → https://dev.xwiki.org/xwiki/bin/view/ReleasePlans/
- **The current dev version** → read the repo's root `pom.xml` (see [[versioning]]).
- **Role holders** (release manager of the cycle, etc.) → the dev wiki; these rotate.
