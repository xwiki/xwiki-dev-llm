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

- Before building a `feature-deploy-*` branch, the CI (`vars/xwikiBuild.groovy` in
  xwiki-jenkins-pipeline) rewrites the version to `<X.Y.Z>-<branch>-SNAPSHOT` and deploys it to
  nexus-snapshots. The parent moves to that version only if the upstream branch deployed it;
  otherwise master's snapshots are used.
- So the poms keep the standard `X.Y.Z-SNAPSHOT`: a stored branch version gets the branch name
  appended twice.

## Building the branches locally

Installed under the standard version, they mix into `~/.m2` with master's snapshots. From the root of
each repository, switch with xwiki-dev-tools' `xbranch-set-version.sh -v X.Y.Z-SNAPSHOT` and restore
with `xbranch-reset-version.sh` before recording the change. Add `-a` when the parent's branch exists
too: it rewrites every pom textually, parent included (xwiki-commons always takes that path).
