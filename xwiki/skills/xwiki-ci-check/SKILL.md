---
name: xwiki-ci-check
description: "EXPLICIT INVOCATION ONLY — never load this skill to answer a question about CI. The daily acting sweep of ci.xwiki.org: it turns what is red on the maintained branches into incidents, attributes each to the commit that caused it, comments on that commit, opens PRs for mechanical fixes, files flicker issues that have proven themselves, and posts a digest to Matrix. It WRITES to GitHub, JIRA and Matrix, so it acts only with an explicit --write and is otherwise a local run that analyses to stdout and asks before each write. Run daily by a scheduled routine with --write; also usable at any time by a developer on their own machine, where it never touches Matrix or JIRA and offers the paste, the commit comment and the fix PR one at a time. Use ONLY when named — `/xwiki-ci-check`, \"run the CI check\", or a scheduled routine invoking it by name. Do NOT use it for \"what's the CI status?\", \"is master green?\", \"why is this test failing?\" or any other read-only CI question: those are xwiki-release-test-triage, which reports and asks and never acts. To fix one flicker use xwiki-fix-flickering-docker-test, to file an issue use xwiki-jira, to open a PR use xwiki-pull-request, for Maven commands use xwiki-build, for Sonar findings use xwiki-fix-sonarqube-issue."
---

# The daily CI check

Run before the developers start work: sweep the CI jobs of the maintained branches, and for what is
red, **give one person one actionable message** — not a list of symptoms to a room.

**This skill acts.** It comments on commits, files JIRA issues and opens pull requests, under a bot
identity. Three things keep that safe, and none of them may be skipped:

1. It runs **only when named**. A question about CI (`is master green?`, `why did this fail?`) is
   answered by `xwiki-release-test-triage`, which is read-only.
2. **Writes are off unless the invocation says `--write`**, and that is structural, not a promise:
   every writer tool under `tools/` is a no-op without a `--write` of its own, so a forgotten flag
   prints instead of posting. This matters because the bot credentials live in a developer's shell
   profile as well as in the routine's secret store.
3. **Nothing is written about an incident older than the blame horizon** (7 days). Feedback is only
   feedback while it is actionable; after a week it is archaeology and the team already knows.

## 0. Mode

Two things run this skill, and they may write different things.

| | **Local** — a developer, any time | **Routine** — the daily 06:00 run |
|---|---|---|
| Invocation | `/xwiki-ci-check`, no flag | `--write` |
| The analysis, to the terminal | always | always |
| PrivateBin paste | **ask** | yes |
| Commit comment (§4) | **ask** | yes |
| Fix PR (§5) | **ask** | yes |
| JIRA flicker issue (§5) | **ask** | yes |
| Matrix digest (§6) | **never** | yes |

**Local is the default — anything that is not `--write` is a local run**, whatever machine it is on.
Say which mode you are in as the first line of your output, every time, and in local mode name the
two channels that are closed, so nobody waits for a digest that was never going to be posted.

**In local mode, ask once per write, and take silence for no.** One question naming exactly what
would be written and where — *post the detail to PrivateBin?*, *comment on `a1b2c3d` (tmortagne)?*,
*file the `NotificationsSettingsIT` flicker issue?*, *open the checkstyle fix PR?* — never a blanket
"shall I write things?". Ask only when there is a developer to answer: a non-interactive run without
`--write` writes nothing at all, which is what makes the dry-run soak of the routine safe to
schedule.

A locally-filed flicker issue **cannot duplicate tomorrow's routine**: the routine files only a
`proven` flicker whose `jira` is null, and that field comes from a live JIRA lookup, so the issue
filed today is what makes tomorrow's run stay quiet. The §5 thresholds hold locally in full — the
evidence bar and one issue per `flickerGroup` are what make an auto-filer tolerable, and a developer
saying yes is not a reason to file on weaker evidence than a routine would.

**The Matrix digest is never local, even if asked.** It is the one broadcast here: it lands in the
team's room with no addressee and no undo, and it is the *routine's* own output — a second digest
arriving at 14:00 from someone's laptop turns the room's record of CI into a record of who ran the
skill. Everything else this skill writes has a single addressee or a single owner, is marked as
machine-written, and is closed in a click.

Local mode needs **no bot credential** for the sweep, the analysis or the paste (PrivateBin is
anonymous and carries no identity), so a developer with nothing configured gets a complete run. A
local *comment* still needs `GH_TOKEN_BOT`; without it, skip that offer and say so. A local *issue*
is filed as the bot when `JIRA_TOKEN_BOT` is set and **as the developer otherwise** — unlike a
comment, an auto-filed flicker issue is unassigned and addressed at nobody, so a personal name on it
is an authorship, not an accusation, and the developer who said yes is a fair author.

In `--write` mode, confirm the bot identity before the first write: `GH_TOKEN_BOT`, `JIRA_TOKEN_BOT`
and the Matrix credential (`MATRIX_USER_BOT` + `MATRIX_PASSWORD_BOT`, or `MATRIX_TOKEN_BOT`) must
all be set, and they are the **bot's**, never a developer's. `node <skill>/tools/matrix.mjs --whoami`
says which account will post, and is the cheap way to find a dead token before the digest is due. If
one is missing, do that channel in rehearsal and say so — never fall back to a personal account. A
developer whose commit broke master must not receive what looks like a personal reprimand from a
colleague, and a wrong attribution must not be wrong in someone's name. `commit-comment.mjs`
enforces this itself: it reads `GH_TOKEN_BOT` and no other variable.

Before invoking `xwiki-jira` to file a flicker issue, export the bot credential into the variable
that skill reads — `JIRA_API_TOKEN="$JIRA_TOKEN_BOT" JIRA_AUTH_TYPE=bearer` — so the issue is filed
by the bot even on a machine where the developer's own JIRA token is configured.

A local run is usually about one thing, so scope the sweep when the developer named one:
`ci-check.mjs --repos xwiki-platform --branch master` is a few seconds and a handful of incidents
instead of twenty jobs.

## 1. Sweep (one command, zero tokens)

```bash
node <skill>/tools/ci-check.mjs > work-order.json        # --pretty to eyeball it, --full to debug
```

It discovers the jobs from Jenkins (`master` + every `stable-*` of Commons, Rendering and Platform,
plus Platform's Environment Tests matrix; `feature-*` excluded), classifies every red build, builds
the incidents, ages them, attributes them and checks what was already said. It is **read-only by
construction** and deterministic, so all of that costs nothing.

Read `summary` first. **If `summary.incidents` is 0, you are done**: post the one-line green digest
(§6), no paste, and stop. A green morning must cost one tool call and one line.

## 2. What the work order contains

An **incident** is a `(repo, branch, signature)` — one distinct *cause*, spanning days and spanning
the N tests it breaks. One commit that breaks forty tests is **one** incident and gets **one**
comment; the script groups tests that started failing in the same build, because those broke
together.

| Field | Meaning |
|---|---|
| `class` / `kind` | 1 `test-breakage`/`flicker`, 2 `build-break`/`unclassified`, 3 `infra`, 4 `timeout`, 5 `absence` |
| `state` | `systematic`, `intermittent`, `single env`, `first seen`, the infra pattern, `absent` |
| `ageDays`, `ageIsLowerBound` | days since the first bad build; `≥` when the history ran out first |
| `beyondHorizon` | older than 7 days ⇒ **no write of any kind**, digest only |
| `blame.tier` | `certain` \| `likely` \| `ambiguous` \| `none` \| `unknown` |
| `fixState` | something already answers this incident — `fix-unbuilt` a commit CI has not built yet, `fix-in-flight` an open PR, `stale-snapshot` the job ran new test code against older jars, `fixed-elsewhere` the same failure is green again on another branch ⇒ **one line, no analysis, no write** |
| `silent` | this exact incident, in this exact state, was already commented on ⇒ say nothing |
| `deep` | inside the per-run budget: root-cause it. Everything else is reported, not analysed |
| `evidence`, `blame.suspects` | present **only** on `deep` incidents — the others are deliberately one line each |
| `jira` | the open flicker issue, if the test already has one |
| `failedIn` | how often it failed over the whole window (`2/8 builds, 1/4 envs`) — `ageDays` is only the current streak, which is why a *proven* flicker can read `0d` |
| `alsoOn` / `crossBranch` | the other branches the same signature is red on (`crossBranch: 'also-red'`) — one cause, not one incident per branch |
| `primary` | `false` ⇒ this is that same cause seen on another branch: it is named on the primary's line and gets **no analysis, no comment and no entry of its own** |
| `flickerGroup` | proven, unfiled flickers of one test class, on any branch, carry the same value: **one** issue per value (§5) |

**There is no ledger file.** A routine gets a fresh sandbox every morning, so a local state file
would be empty every morning. Every field above is recomputed from a durable system — Jenkins for
the symptoms and the age, JIRA for the known flickers, and **the comment left last time** for
"already notified". Running the skill twice, or by hand from another machine, changes nothing.

## 3. Deep treatment (the budget)

Treat only the incidents marked `deep` — at most 5, chosen by severity. That is a **ceiling, not a
target**; below the line, an incident is reported in the paste without analysis, which is a correct
outcome, not a failure.

**An incident with a `fixState` is never `deep`, and gets one line and no paragraph.** Something
already answers it — a commit sits on the branch that CI has not built yet (`fix-unbuilt`), an open
PR names the failing test (`fix-in-flight`), the job ran new test code against older production
jars (`stale-snapshot`), or the same failure is green again on another maintained branch
(`fixed-elsewhere`) — so root-causing it argues with people who have moved on, or with a test
that was never broken, and **no write of any kind follows** — no commit comment, no fix PR, no
flicker issue — because each of them asks someone for work already under way, or for work nobody
needs to do. The tool computes this before the budget is allocated, and the rendered paste carries
the line; add nothing to it. Saying nothing here is the point, not an omission to apologise for.

**No value asserts a fix**, and the paste's wording is the one it keeps: *possibly fixed already* for
a landed commit; *a fix may be in flight* for a PR, which may equally be a rewrite that touches the
test and may never merge; *ran against a stale snapshot* for the third, which says the opposite —
nothing is being fixed, because nothing is broken; and *already fixed on another branch* for the
fourth, where the fix exists but on code this branch has not got. What settles them is the next
build, the merge, the next Environment Tests run, or a backport — never this one.

**`fixed-elsewhere` is a backport candidate, and that is all it is.** The same signature was red on
another maintained branch and is green there now, and the tool names the commit that did it — the
one fact nobody reading three branches' dashboards side by side at 06:00 was ever going to notice.
Hand that sha to **`xwiki-backport`**, and **never open the backport here**: it needs the adaptation
to the older branch and the verification that skill exists for, and what this pass is worth is the
noticing. Verify before backporting, because a signature also goes green when the test is *deleted*
on that branch — for a test the tool excludes that by construction (it must still have *run* there,
having failed and then passed in two consecutive builds each way), for a build break it cannot.

**The same signature on several branches is one cause, and gets one treatment.** `primary` marks the
incident that carries it — master where master is in the group, otherwise the newest maintained
branch — and every other branch is named on its line, with its own regression window, and is
analysed nowhere. Treating four of them costs four of the five deep slots to reach one conclusion,
and comments four times on what is one person's one mistake.

**`stale-snapshot` is the Environment Tests trap**, and it earns a value of its own because it is the
one case where the *job* is what is wrong: that job builds only the test modules it was given and
takes the rest of its WAR from the last snapshot deployed to Nexus, so a commit carrying a test *and*
the production code that test needs is red there until the next deployment — with stack-trace line
numbers read from the *old* file, which is what makes it look like a defect in the new test.
`okf/servers/jenkins.md` has the trap and how to confirm one by hand. The tool sets the value only
where a single commit does both halves inside the gap the build could not have resolved, and only for
a test failing in that job **alone**: the main job builds everything from source, so a test red there
is red for real.

The field is set only when **every** test the incident covers is answered — a commit fixing one test
of five leaves the incident live, and the paste says which part is answered. Deciding otherwise, in
either direction, is not yours to make: the tool's threshold is deliberately conservative because a
wrong silence hides a real breakage, while a wrong ping is a comment that asks.

For each one:

- **Read only what the script gives you.** `evidence` holds the matched error lines *and the lines
  that continue them* — a Maven failure puts its headline on one line and the module, the dependency
  and the two versions on the next few, so read the whole block before concluding anything.
  `blame.suspects` is one line per candidate commit, each marked with why the script thought it
  relevant (`relevant: <file>`, `names <library>`). **Never fetch a build's `consoleText`** — a platform build's log is
  **~80 MB**, and the script has already read the failing *stage's* own log, which is the cheap way
  in. If you genuinely need more, take the narrowest thing there is: the build's `testReport` for one
  test, or an archived screenshot (`okf/servers/jenkins.md`).
- **`develocity` MCP: only for a class 1 incident whose `state` is `single env`.** That is the one
  verdict Jenkins' own data cannot settle. Every other use costs tokens for nothing.
- **Sonar quality-gate failures (`sonar-gate:failed`): report, never fix.** Per-rule fix correctness
  lives in `okf/sonarqube/` and belongs to `xwiki-fix-sonarqube-issue`; a gate failure is rarely one
  commit's fault, so the blame would be weak anyway.
- **`unclassified` is a legitimate verdict.** Report the error lines and say the cause is unknown.
  Do not invent one. So is `timeout` — a stage that ran out of time is out of scope for v1: report
  which stage, and stop there.

## 4. Comment on the culprit — and match the wording to the tier

The target is **the commit on GitHub**, never the PR (merged and irrelevant) and never JIRA. Skip
entirely when `fixState` is set, when `primary` is `false` — the same cause is commented on the
branch that carries it, and the comment names the others — when `silent` is true, when
`beyondHorizon` is true, or when
`blame.tier` is `ambiguous`, `none` or `unknown` — an ambiguous incident is listed in the paste and the digest says *no owner
found*. Never guess an author.

The tool already refuses to attribute an incident that has an **open flicker issue** (`jira`) and is
not `systematic`: the team has judged that test to flicker, so pinging whoever last touched the area
blames them for a fault known not to be theirs. When such a test *has* become `systematic`, the
evidence outranks the issue — treat it as a breakage and say in the comment that the issue no longer
describes the test.

| `blame.tier` | What the comment may do |
|---|---|
| `certain` | **State it.** "This commit is the only one in the window that touched `Foo.java`, and the build breaks at `Foo.java:120`." |
| `likely` | **Ask, do not assert.** "master has been failing since build #412; this looks like it may come from this commit — could you check?" |

`blame.reason` says what the tier rests on, and the comment must not claim more than it. The
weakest of them reads *the only commit in the window whose subject names `<library>`* — that is the
commit message, not an observation of the build, so such a comment **quotes the evidence lines and
asks**, and never says the commit broke anything. It is still worth sending: a dependency bump is
the one break whose author can confirm or dismiss it in a minute.

A system that asserts wrongly is switched off after one mistake; a system that asks is forgiven. The
tier is the whole of that difference, so never upgrade the wording.

Keep the comment short and self-contained: what is failing (the test count, not forty names), since
when, the evidence line, the build URL, and what you are asking for. Say nothing about being a bot —
the tool appends that, and the line telling the reader they may ignore a wrong attribution is not
one to leave to the wording of the day. Then post it — this tool and
nothing else, because its marker is what makes tomorrow's run stay quiet:

```bash
node <skill>/tools/commit-comment.mjs --repo xwiki-platform --sha <sha> \
  --incident "<incident.id>" --state "<incident.state>" --file body.md [--write]
```

**Without `--write` it prints the comment and posts nothing** — that is the default, so the flag is
what a live routine adds and what a local run adds only after the developer has said yes. It
re-checks for a prior comment before posting and reports `not posted: already commented` as a
normal outcome. A prior comment in a *different* state posts again — a flicker that has become a
systematic breakage is news.

## 5. Optional writes, each with its own brake

### Fix PRs — at most 2 per run

| Tier | What | PR |
|---|---|---|
| **A — mechanical** | License headers, a Checkstyle violation the error localises exactly (line > 120 chars, unused import, whitespace, missing newline), a trivially broken compile after a rename | ready for review |
| **B — inferred** | A UI change renamed a selector and the page object still queries the old one; renamed or moved test resources | **draft** |
| **C — never** | Changing an assertion, an expected value, a timeout, or any production logic | — |

**Tier C is a safety rule, not a limit on capability.** A failing assertion is the hypothesis that
the product is wrong; "fixing" it by editing the expectation launders a real regression into a green
build. If a fix seems to need an assertion change, that is a comment to a human, not a PR.

Verify before opening, always, and **fail closed** — if verification fails there is no PR, and the
attempted fix goes into the paste instead:

```bash
xmvn clean install -B -ntp -pl <module-path> -Plegacy,quality
```

Always `clean`, always `-Pquality` (`xwiki-build` owns these commands; `xmvn` picks the branch's
JDK). **The functional tests are not run** — they take hours. So the PR must **assign the culprit
author** and say plainly, in its body, that the ITs were not run and the author should verify before
merging. Jenkins does not build PRs, so there is no free oracle: this verification is the only one.
Follow `xwiki-pull-request` for the commit message and the description.

**No fork is involved.** The routine pushes its branch into the upstream repo itself, the way the
existing SonarQube routine does: it runs under the Claude GitHub App installed on the `xwiki` org,
and that App can push a `claude/<slug>` branch to `xwiki/*` directly. The bot's own PAT cannot —
`xwikiorg-llm-bot` has `push: false` on all three repos — and takes no part in a PR at all; it is
the commit-comment credential and nothing else. The bot identity is carried by the **commit
author** instead:

```bash
git commit --author="XWiki LLM Bot <llm-bot@xwiki.org>" …
```

**A fix PR from a local run is the developer's own PR**, opened under their own name by
`xwiki-pull-request` with their own credentials, because there is no App token on a laptop. That
asymmetry with the commit comment — which is the bot's, always, everywhere — is deliberate: a
comment lands unasked on someone else's commit and must never read as coming from a colleague,
whereas a PR is proposed work someone has to own, and the developer who said yes to it is that
someone. The body still says the fix was machine-generated and that the ITs were not run.

### Flicker issues — file on evidence, not on sight

File one **only when `kind` is `flicker` and `proven` is true** (failed in ≥ 2 distinct builds across
≥ 2 distinct days) **and `jira` is null**. Below that threshold it is a candidate listed in the
paste: a failure seen once is not a flicker, it is an event — and that is exactly the shape of a
Docker or GitHub blip. The evidence threshold *is* the confirmation step, made structural, because a
routine running at 06:00 has nobody to ask.

**One issue per `flickerGroup`, never one per incident.** Several methods of one test class that
started failing in the same build broke together, and the same test failing on three branches is one
flaky test: filing an issue each is how an auto-filer is switched off in its first week. So:

- every incident sharing a `flickerGroup` value goes into **one** issue, and its `alsoOn` branches
  are named in that issue rather than filed again;
- the **summary names the test class and every method** — `NotificationsSettingsIT flickers on
  16.10.x: notificationFiltersDefaultValues, globalAndOtherUserSettings, watchAndRename`. This is
  not cosmetic: `scripts/jira-flickers.mjs` joins a CI failure to its issue by the "Flickering Test"
  field first and by *class + method in the summary* second, so a method missing from both is a
  method tomorrow's run files an issue for again;
- the **"Flickering Test" field holds one test** — the first of the group — and the description
  lists every affected test id verbatim, plus every branch.

Use `xwiki-jira`, with the flicker fields from `okf/servers/jira.md` (the `flickering` label **and**
the "Flickering Test" custom field, holding the test exactly as CI reports it). In a local run, file
one only after the developer has said yes to it by name (§0). Auto-filed issues are
**unassigned** — a flicker usually has no culprit, and a wrong auto-assignment discredits the whole
system.

If the flicker matches a **closed** issue: **comment on it and leave it closed**, and flag it in the
digest. Reopening overrides someone's triage decision; filing a duplicate is worse than both.

## 6. Digest and paste

### The paste — rendered, then annotated

**Do not write the paste from scratch.** The tool renders it, because it is read every morning and a
document whose shape is re-invented daily is read as a new document daily:

```bash
node <skill>/tools/ci-check.mjs --render-detail work-order.json > detail.md   # add --live when writing
```

That gives the whole document — counts, the green repos, every incident in a fixed order with its
age, its regression window, its evidence, its suspects, the flicker groups, what was *not* written
and why — and leaves one `<!-- ANALYSIS: <incident id> -->` line per `deep` incident. **Replace each
of those lines with your root-cause paragraph, and change nothing else.** If a fix failed
verification (§5), add it under the incident it belongs to.

Two wordings in it are deliberate and must not be "improved" back: a window with no green build
reads *failing in every build examined, back to #N — start not established* rather than "since #N",
because that number is how far the sweep looked and not when the break began; and a flicker carries
both `streak Nd` and `failed in X/Y builds`, which measure different things.

In a **local run the detail document is the deliverable** — print it, or its incidents at least, and
then ask whether to paste it. There is no digest to write, so the paste question is the last one.

### The digest

**Routine only.** Post **one short message** to the Matrix room, capped at ~5 lines, pointing at the PrivateBin paste
holding that detail. The digest is a **state snapshot**, not an event stream, so repeating yesterday's
lines is correct — which is why **every line carries its age**. A green morning is one line and no
paste.

```
🔴 CI 2026-09-12 — 2 new, 3 ongoing
• platform/master   checkstyle break → a1b2c3d (jdoe) — commented
• platform/18.4.x+17.10.x  AllIT#foo systematic since #412 (4d) — NEW, no owner found
• commons/16.10.x   docker rate limit — infra, day 3
• platform/master   DocExtraTabsIT systematic (0d) — likely fixed in 9dd4f149, unbuilt
  … 2 more (flickers, tracked) · +12 long-standing
→ https://bin.xwikisas.com/?abc#key (1 week)
```

Incidents with `beyondHorizon` are **aggregated into a single `+N long-standing` count**, never
listed. `NEW` means `ageDays` is 0 — there is no ledger, so it is the only thing that can mean it.
The digest lines are chosen, not rendered: pick what a developer can act on today — a break with an
owner first, then a break without one, then what has changed state — and let the paste carry the
rest. Every line names the branch, what is broken, since when, and what was done about it
(`commented`, `no owner found`, `issue filed`, `tracked`, `likely fixed, unbuilt`, `fix in flight`,
`backport candidate`).

**One cause is one line**, whatever the branch count: incidents whose `primary` is `false` are the
same signature elsewhere, so their branches join the primary's line (`platform/18.4.x+17.10.x`) and
never take a line of their own. A `fixed-elsewhere` incident names the sha and what to do with it —
*platform/18.4.x `VersionIT` systematic (1d) — fixed on master by `a1b2c3d`, backport candidate*.

An incident with a `fixState` earns a digest line and nothing else — it is the one line that stops a
reader who has just pushed the fix, or opened the PR, from opening the paste to find out whether the
routine noticed.

```bash
node <skill>/tools/privatebin.mjs --file detail.md --expire 1week --write   # prints the URL, key included
node <skill>/tools/matrix.mjs --file digest.md --write
```

Both print instead of posting when `--write` is absent, so the paste of a local run carries it only
once the developer has agreed, and the Matrix line is never run locally at all.

**1 week, not the 1-day default** — a Friday digest must still resolve on Monday. The URL is the only
copy of the key: put it in the digest before doing anything else with it. There is no "never" expiry
on that instance.

## 7. Report

Finish with, in the terminal: the mode, the counts (`red jobs`, `incidents`, `deep-treated`,
`beyond horizon`), what was written where (with URLs), and what was deliberately *not* written and
why — silent duplicates, ambiguous blame, beyond-horizon, budget. The "what I did not do" half is
the one that tells a reader whether the brakes are working.

A local run adds to that half what the mode itself withheld: the digest it did not post, and
anything the developer declined. Those are not failures and must not be reported as warnings — they
are the mode working.

## Related

- `xwiki-release-test-triage` — the read-only counterpart, and the right answer to every question
  about CI state. It reports and asks; this skill acts. Both share `scripts/jenkins.mjs`.
- `xwiki-fix-flickering-docker-test` — to actually stabilise a flicker this skill only filed.
- `xwiki-backport` — where a `fixed-elsewhere` commit goes; this skill notices it and never lands it.
- `xwiki-build` (Maven, `xmvn`, the IT slot limiter), `xwiki-pull-request` (the PR),
  `xwiki-jira` (the issue), `xwiki-fix-sonarqube-issue` (a quality-gate failure).
- `okf/servers/jenkins.md` — the CI traps the tooling encodes; `okf/servers/jira.md` — the flicker
  fields; `okf/testing/strategy.md` — what a functional test is allowed to assert.
