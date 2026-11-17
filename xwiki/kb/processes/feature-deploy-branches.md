---
title: Cross-repository feature branches (feature-deploy-*)
stability: durable
summary: How the CI versions the feature-deploy-* branches of a change spanning several repositories,
  why the poms keep the standard version, and how to build such branches locally without polluting
  the standard snapshots of ~/.m2.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices
provenance: official
last-confirmed: 2026-11-17
related: [processes/release.md, conventions/versioning.md, servers/jenkins.md]
---

# Cross-repository feature branches (feature-deploy-*)

A change spanning several repositories lives on a branch named `feature-deploy-<name>`, with the
**same name in each downstream repository**, since each repository's CI build triggers the next one's.

## The CI sets the branch version

- The CI build of a `feature-deploy-*` branch (`vars/xwikiBuild.groovy` in xwiki-jenkins-pipeline)
  rewrites the version before building: `<X.Y.Z>-<branch>-SNAPSHOT` for the project, its node packages
  and the `commons.version`/`platform.version` properties. The parent moves to that version **only if
  it was deployed** upstream, otherwise the branch builds against master's snapshots. The artifacts go
  to nexus-snapshots without colliding with master's.
- So the poms of the branch keep the **standard version** (`X.Y.Z-SNAPSHOT`): a branch version stored
  in them gets the branch name appended a second time.

## Building the branches locally

Installing them under the standard version mixes them into `~/.m2` with the master snapshots every
other local build resolves. Switch first, from the root of each repository, with xwiki-dev-tools'
`xbranch-set-version.sh -av X.Y.Z-SNAPSHOT`, and restore with `xbranch-reset-version.sh` before
recording the change.

- `-a` replaces the version in every pom textually, parent included: always use it in the repository
  without parent, and whenever the parent has to move too — without it the script goes through Maven,
  which first has to resolve the not-yet-built branch parent.
- `-v` takes the current **standard** version, sparing a slower and more fragile Maven evaluation.
