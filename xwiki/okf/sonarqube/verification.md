---
title: Verifying a SonarQube fix
stability: durable
summary: What makes a SonarCloud fix verified rather than merely compiling — the tests must run, the
  quality profile is mandatory, why removing covered instructions always lowers a JaCoCo ratio, and
  how to tell your failure from a pre-existing one.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Building/
---

# Verifying a SonarQube fix

A Sonar fix that compiles is not a verified fix. Three gates decide whether it is correct, and all
three run only under the right profiles. The Maven commands themselves are the **`xwiki-build`**
skill; this file is the Sonar-specific reasoning about *which* gate a given fix is likely to trip and
what to do about it.

## Run the tests — never skip them

**Never `-DskipTests` or `-DskipITs` when verifying a Sonar fix.** Even a mechanical fix can change
runtime behaviour, and the edited modules' unit tests are what reveal a regression the compiler
cannot see. Several rules in this corpus break at runtime only:

- [[modernization-rules]] — an `EnumMap` conversion NPEs on a `null` key; a `StringBuilder` passed to
  a mock-verified call fails an argument-equality check.
- [[dead-code-rules]] — a removed reflective callback simply stops firing.

If a test fails because of your change, fix the change — or drop the issue and pick another. Never
skip tests to go green.

## `-Plegacy,quality` is mandatory

Build every affected module in one reactor with **both** profiles: `-Plegacy` to include the
`-legacy-*` modules, and `-Pquality` because that is where the gates live. See the `xwiki-build`
skill for the command and the profile table.

**`-Pquality` is not optional for a Sonar fix specifically**, because the `jacoco:check` goal that
enforces each module's pinned `xwiki.jacoco.instructionRatio` runs only there — as do Revapi and the
Enforcer. A fix that removes code can drop a module below its ratio and **fail in CI even though the
local `install` was green**. That failure is invisible without `-Pquality`.

## Removing covered instructions always lowers the ratio

This is arithmetic, not a defect in your edit. If a module has `c` covered instructions out of `t`
total and your fix removes `k` instructions that were **covered**, the new ratio is `(c - k) / (t - k)`,
which is strictly less than `c / t` whenever `c < t`. So **any module pinned just above its threshold
will fail** when you remove covered code — dead-code removals, simplifications, and the `CHECKCAST`
that an S6201 pattern-match eliminates.

**The resolution is to drop the offending module from the change, not to fix its coverage and never to
lower the pinned ratio.** Revert that module's files, take it out of the reactor, note the exclusion in
the pull request description, and ship the rest. Writing tests purely to offset a mechanical cleanup is
out of scope for a Sonar fix; if the module genuinely needs coverage, that is the
`xwiki-increase-test-coverage` skill's job as its own change.

Small modules with few sites are where this bites; large modules absorb it.

## Reactor semantics when something fails

- **A module failing mid-reactor skips every module after it.** The modules listed `SUCCESS` before it
  are genuinely verified; the rest were never built at all. After dropping the failing module, re-run a
  reactor containing the **skipped** ones — do not assume the first run covered them.
- **A wide reactor failing on one module for a reason unrelated to your edit → drop that module, keep
  the rest.** Because build order means a leaf failing last cannot taint the modules built before it,
  every other `SUCCESS` in the summary stands and no rebuild is needed.

**Telling a pre-existing failure from your own** takes one step: if `git diff --name-only` does not
list the flagged class, it is not yours — confirm with `git log -1 -- <that class's file>`, which will
show an unrelated recent commit. Two recurring shapes:

- Revapi `java.method.visibilityReduced` on `<init>()` of classes you never touched, typically in
  `xwiki-platform-legacy-oldcore` — the legacy re-export debt described in [[dead-code-rules]].
- Revapi `java.annotation.removed` fallout from an in-flight migration on master (for instance the
  `javax` → JSpecify `@Nullable` work).

Do not try to fix an unrelated failure as part of a Sonar fix — that is a separate change.

## The quality gate measures NEW code — and a rewrite re-dates old findings

The gate that fails CI looks only at a rolling new-code period (30 days), so a mechanical fix can fail
it without introducing any defect: **rewriting a line that carries another open finding re-dates that
finding.** SonarCloud matches an issue by line and code hash; a rewrite it cannot match closes the old
issue as FIXED and raises an identical one dated today. A finding that sat outside the new-code period
for years is suddenly inside it, and one re-dated RELIABILITY/BLOCKER is enough to take New Reliability
Rating to C and turn the gate red. Ask what else a region carries *before* rewriting it (recipe in the
`xwiki-fix-sonarqube-issue` skill), and fix or avoid those lines. A PR analysis surfaces a re-dated
finding only when the rewrite also broke issue matching at PR level — measured both ways — so the
pre-flight check stays worth doing even with PR analysis in place.

**`javabugs:*` findings are computed server-side, during the SonarCloud analysis** — neither the local
scanner nor the IDE reports them, so no local build proves one gone. **A PR analysis does, before
merge**, and it runs the same rules and gate as the branch: measured on xwiki-commons, a direct *and* an
interprocedural null dereference were both reported and took the PR gate to ERROR. The recipe is in the
`xwiki-pull-request` skill — no tests, no `-Pquality` and no coverage, which holds as long as the gate's
`new_coverage` condition stays disabled (`qualitygates/project_status` shows the conditions, and also
names the red one). Before believing *or* dismissing such a finding, read the analyzer's own path:
`&additionalFields=_all` on `issues/search` returns `flows[].locations[]`, whose `msg` chain states
every assumption it made ("Assuming this condition to be false"). Print `startLine` + `msg` only — the
raw arrays are huge.

## Related

- [[index]] — rule map, denylist, universal drop conditions.
- [[strategy]] — XWiki's testing conventions and the coverage policy.
- [[backward-compatibility]] — what Revapi treats as breaking.
- [[code-style]] — the 120-column rule Checkstyle enforces in `quality`.
