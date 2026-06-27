---
title: Check binary and semantic compatibility, but not source compatibility
stability: durable
status: accepted
summary: Revapi gates public-API changes on binary/semantic compatibility only; source
  incompatibility is intentionally not enforced because it is too strict for normal API evolution.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HBackwardCompatibility
---

# Check binary and semantic compatibility, but not source compatibility

## Context

XWiki has many downstream applications and extensions built on its public Java APIs, so breaking
those APIs is costly for the ecosystem. The project uses the Revapi Maven plugin (in the `quality`
profile) to detect incompatible public-API changes and fail the build. Revapi can check binary,
semantic, and source compatibility.

## Decision

Enforce **binary** and **semantic** compatibility, but deliberately **not source** compatibility.

## Consequences

- Downstream binaries keep linking and behaving correctly across upgrades (binary + semantic safety).
- Developers retain freedom to make source-only changes that do not break compiled callers — the
  motivating example is adding missing generics to a return type, which is a source-level change but
  not a binary/semantic break. Enforcing source compatibility would block such reasonable edits and
  force noise in the Revapi ignore configuration.
- New public API can still be introduced as not-yet-stable via `@Unstable`, and interfaces are
  evolved with default methods rather than new interfaces — see
  [[backward-compatibility]] in `okf/conventions/`.
