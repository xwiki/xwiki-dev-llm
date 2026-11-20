---
title: Accepting a new third-party dependency
stability: durable
summary: The checklist a third-party project must pass before it can be added to an XWiki
  distribution — license (non-negotiable), longevity, release cadence, support responsiveness, active
  contributors, documentation, security; a VOTE can waive everything but the license. Also when an
  upgrade is backported: only for a security fix of a shipped JAR, to the first fixed version of
  each stable branch's line.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HAddinganewDependency
provenance: official
last-confirmed: 2026-09-01
related: [conventions/commit-messages.md, servers/jira.md]
applies-to: ["**/pom.xml", "**/package.json"]
applies-when:
  - '<groupId>(?!org\.xwiki\b|\$\{|org\.apache\.maven\.plugins<|org\.codehaus\.mojo<|org\.junit\b|org\.mockito<|org\.hamcrest<|org\.testcontainers<|org\.seleniumhq\b|org\.openclover<)[^<]+</groupId>'
  - '^\s*"(?!version"|name"|node"|pnpm"|npm")(?:@(?!xwiki/)[\w.-]+/)?[\w.-]+"\s*:\s*"(?:[\^~]|\d|npm:)'
---

# Accepting a new third-party dependency

Before adding a dependency to an XWiki distribution, check the project against **all** of:

- **License** compatible with XWiki's LGPL 2.1 and OSI-approved — *non-negotiable*.
- **Longevity** > 2 years, and versions numbered properly.
- **Release cadence** several times a year (once a year is acceptable only with a > 3-year track
  record of it).
- **Support**: questions actually get answered, usually within a month.
- **Active contributors**, not a one-person effort: **≥ 3** when the dependency provides an important
  feature (ideally not all from the same company), **≥ 1** for a secondary feature.
- **Documentation** exists.
- **No known important, unhandled security issue.**

If a criterion fails (or is doubtful) and there is no alternative, a **VOTE** can grant an exception
for that dependency — except for the license criterion.

Upgrading dependencies is a separate flow: upgrade PRs (including Renovate's) have per-ecosystem
default assignees — see the `xwiki-pull-request` skill.

## Upgrading a JavaScript dependency

The branch pins its own toolchain: `pnpm.version` and `node.version` are properties of the
**xwiki-commons parent pom**, and the build runs pnpm through that pin, not the one on your `PATH`.
Regenerate the lockfile with **that** version (`npx pnpm@<pnpm.version> install --lockfile-only`) —
a newer pnpm resolves peers differently and produces a lockfile the build then rewrites. Then run
`pnpm dedupe --lockfile-only` with the same version, so the upgrade does not leave duplicated
versions behind; expect it to touch entries unrelated to the dependency you bumped.

Whether the bump is `[Misc]` or needs an issue, and what that issue's description holds, are in
[[commit-messages]] and [[jira]].

## Backporting a dependency upgrade

An upgrade is backported to the maintained stable branches when it fixes a **security issue**, and
otherwise stays on master. Read the release notes of **every** version crossed: only a CVE, a GHSA
or an entry upstream itself labels as a vulnerability counts — a fix that merely looks
security-relevant is reported as such and left to the developer to judge, never called a security
fix in the PR or the issue. Check that the CVE belongs to a version actually crossed.

- **What decides is the shipped JAR**, as a scanner sees it: the advisory's affected package must be
  an artifact XWiki ships, at the version a branch uses. Whether XWiki reaches the vulnerable code
  does not matter. A CVE fixed in the dependency's *own* dependencies is irrelevant when XWiki
  manages those versions itself.
- **Every branch using an affected version** gets it, the security-only LTS included, unless the
  upgrade is incompatible with that branch. An upgrade carrying big compatibility changes (removed
  APIs, split artifacts) is weighed case by case with the developer.
- **Per branch, the first fixed version of the line it uses** (a patch release of its minor), not
  master's version. Only the dependency moves, plus the transitive runtime upgrades it strictly
  requires, and only those **known to be safe** on a stable branch: that is a judgement per
  library — a bugfix or minor upgrade of a library following semantic versioning usually is, a
  major one usually is not — so when in doubt, ask a committer who knows it. Such an upgrade reuses
  its master commit (cherry-pick `-x`, adapted to the version the branch needs) under its own issue.
- Propose the backports, with the release-note link of the security fix, before doing them, and add
  the stable Fix Versions to the issue.
