---
title: Accepting a new third-party dependency
stability: durable
summary: The checklist a third-party project must pass before it can be added to an XWiki
  distribution — license (non-negotiable), longevity, release cadence, support responsiveness, active
  contributors, documentation, security; a VOTE can waive everything but the license. Also how a
  security upgrade is backported: to the first fixed version of each stable branch's line.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HAddinganewDependency
provenance: official
last-confirmed: 2026-09-01
related: [conventions/commit-messages.md, servers/jira.md, processes/release.md]
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

Whether an upgrade is backported, and where, is in [[release]]: one fixing a vulnerability in an
artifact XWiki ships is a security fix, backported like any security bug. When it is:

- Read the release notes of **every** version crossed. Only a CVE, a GHSA or an entry upstream labels
  as a vulnerability counts, and only in a version the branch actually uses; a fix that merely looks
  security-relevant is reported as such, never called a security fix. Give the release-note link
  when proposing the backport.
- A CVE fixed in the dependency's *own* dependencies is irrelevant when XWiki manages those versions
  itself.
- Per branch, target the **first fixed version of the line it uses** (a patch release of its minor),
  not master's version, reusing the master commit (`cherry-pick -x`, adapted to that version).
- The flavor's functional tests run a CVE scan (`ExtensionSecurityScanIT`, `ExtensionSecurityTest`
  on older branches) that fails the build of any branch shipping a vulnerable version whose CVE is
  still "to review". Such a CVE is either fixed by the upgrade, or marked reviewed on the
  [Security Reviews](https://extensions.xwiki.org/xwiki/bin/view/Extension/Extension/Security/Code/Reviews)
  page when it does not affect XWiki.
