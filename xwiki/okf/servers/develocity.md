---
title: Develocity (community.develocity.cloud) — a test's failure history across CI builds
stability: durable
summary: Analyse a test's failures across CI builds with `dv-test-history` (xwiki-dev-tools) rather
  than the `develocity` MCP — what its report groups and breaks down, keeping its size out of context,
  finding candidates with `--recent-failures`, and why a `flaky` outcome is a plain failure in XWiki.
sources:
  - https://github.com/xwiki/xwiki-dev-tools/blob/master/bash/dv-test-history
---

# Develocity: a test's failure history

Jenkins shows one run of a test, from the few builds it retains ([[jenkins]]); Develocity holds every
execution across builds, branches and configurations. Server map and MCP: [[index]]; the access key
(the MCP's and `dv-test-history`'s are the same) is set up in the plugin's `docs/setup.md`.

## One test: `dv-test-history`

- For "is this test flickering or broken, in which configurations, since when, fixed again?" prefer
  [`dv-test-history`](https://github.com/xwiki/xwiki-dev-tools/blob/master/bash/dv-test-history)
  (`bash/` in `xwiki/xwiki-dev-tools`, on the `PATH` when installed — not every developer has it)
  over the `develocity` MCP: one run replaces dozens of MCP calls, and per-build scan data is cached
  so a re-run is cheap. Without it, fall back to the MCP.
- Target: `'Container#testCase'`, a container alone (every test case at once — handy for an
  `AllIT$Nested…IT`), or a `/scans/tests` URL copied from the Develocity UI. 28 days by default;
  options in `--help`.
- Failures are grouped by message and stack trace **normalised** so that one failure groups across
  branches and browsers: hashes, session ids, hosts, temp paths, versions, timestamps and source line
  numbers are replaced, exception-building frames and the driver-specific wording of a
  `StaleElementReferenceException` ignored. Each group still names the exact `Class.method:line`, and
  is broken down by tag combination (branch / browser / database / servlet container), by single tag
  and over time. A build without a browser tag counts as Firefox.
- Each group links the screenshot and `.flv` video Jenkins archived for its most recent occurrences
  (`--artifacts`, different browsers first). Jenkins discards old builds' artifacts, so a failure
  that stopped weeks ago usually has none left; `--artifacts 0` skips Jenkins.
- The report for one busy test is tens of KB and costs on the order of a hundred Develocity requests.
  Write it with `-o <file>`, read its header and `## Key findings` (rate, enriched configurations,
  change points, the clean runs needed to call it fixed, one line per failure group), then only the
  group you need; don't loop it over many tests.

## Finding candidates: `--recent-failures [HOURS]`

Lists every test that failed in the window (default 24 h) across XWiki builds, with its rate,
branches and browsers, whether it is `new` or `known` (against `--baseline-days`, default 14; `0`
saves a request per container), and ready-to-run commands for the most interesting ones. Trap: the
baseline column covers the preceding days, `fails`/`flaky`/`runs` only the window — only the two
percentages are comparable.

## A `flaky` outcome is a failure

Develocity documents `flaky` as "failed, then passed on retry within the same build", but XWiki
retries no test: such an execution ran once and failed, and Develocity only classified it as flaky
from cross-build statistics. Count it as a failure everywhere; never read it as "passed in the end".

## Related

- `xwiki-fix-flickering-docker-test` — fixing a flicker once its history is known.
- `xwiki-release-test-triage` — a whole branch's failures at once; `xwiki-ci-check` wraps the tool
  as `tools/dv-test-history.mjs`, which locates a checkout and prints only the key findings.
