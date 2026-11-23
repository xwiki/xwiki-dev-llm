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
  - https://github.com/xwiki/xwiki-docker#contribute
provenance: official
last-confirmed: 2026-11-23
related: [conventions/versioning.md, conventions/backward-compatibility.md, processes/security-policy.md, processes/release-notes.md]
---

# Release and versioning process (outline)

This is a durable orientation, not a step-by-step runbook. The runbook on the dev wiki is the source
of truth and changes over time — fetch it when actually releasing.

## Durable facts

- **Commons, Rendering and Platform release together** with the **same version number**.
- Version numbering and the milestone/RC/final cadence are defined in **Versioning and Release
  Practices** (see [[versioning]]).
- **Backport targets are the LTS branches.** Two LTS lines are maintained in parallel: the
  Intermediate LTS `N.4.x` (branched end of May) and the Cycle LTS `N.10.x` (branched end of
  November) — with master on `N.9`, `N.4.x` and `(N-1).10.x`. Derive them from the root `pom.xml`
  version rather than memorising them.
- **What may be backported** ([rules](https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/#HWhattoBackport)):
  bugs only — `Blocker`s and Critical security fixes must be, others at the committer's discretion.
  Anything else needs a forum proposal or vote, except test/build or JDBC driver upgrades, an
  upgrade a backported fix needs, and tooling changes, which go to every LTS branch that can take
  them (bringing only runtime upgrades known safe).
- **The recent stable branches are not routine backport targets.** A new stable ships every month,
  so an ordinary fix rides the next release instead of paying for an extra one — a release is
  expensive and the wait is under a month. Backport to one only **on demand**: a mistake bad
  enough that a freshly released stable needs a bugfix release now.
- The LTS line **older** than the maintained two takes **security fixes only** — a "Critical"
  vulnerability, CVSS >= 7 per [[security-policy]] — never an ordinary bug fix; with
  master on `N.x` that is `(N-2).10.x`. A repo offering a `backport stable-<old>.x` GitHub label does
  not make that branch a routine target. **Never name that line in a public artifact** — a PR body,
  a JIRA issue or fix version, a commit message, a forum post — not even to explain why it is
  excluded: naming it implies a support commitment that does not exist. List the targets and stop.
- Released artifacts and snapshots are published to **nexus.xwiki.org** (see [[index]] in
  `servers/`); the Extension Manager consumes them.
- The **official Docker images** ([xwiki/xwiki-docker](https://github.com/xwiki/xwiki-docker#contribute))
  ship with XWiki: a change goes out when the official tags are next updated for an XWiki release,
  in that version's release notes. Released tags are not rebuilt, except ASAP (no announcement
  needed) for a broken image or an important bugfix decided case by case among the committers.
- xwiki-contrib extensions follow their **own** release + documentation process — use the
  `xwiki-contrib-release` skill, which hands the release blog post off to
  `xwiki-contrib-release-blog-post`.

## Volatile — follow the pointer, do not cache

- The **detailed release steps** → https://dev.xwiki.org/xwiki/bin/view/Community/ReleaseProcess;
  performing them through the version's Release Plan → the `xwiki-xs-release` skill.
- **Current release plans / dates** → https://dev.xwiki.org/xwiki/bin/view/ReleasePlans/
- **The current dev version** → read the repo's root `pom.xml` (see [[versioning]]).
- **Role holders** (release managers, who rotate) → the same Release Plans page: its "Next Release
  Managers" section, and the "Release Managers" column of each plan.
