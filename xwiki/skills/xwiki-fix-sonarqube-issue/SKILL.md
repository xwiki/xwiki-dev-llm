---
name: xwiki-fix-sonarqube-issue
description: Find and fix open SonarCloud (SonarQube) issues in the current XWiki repo and open a PR. Use when asked to fix/clear/triage a SonarQube issue, reduce SonarCloud findings, or run a "fix one Sonar issue" pass. Per-rule fix correctness and drop conditions live in the OKF under okf/sonarqube/ — load the family file for the rule being fixed. For the build commands it relies on use xwiki-build; for PR/commit conventions use xwiki-pull-request.
---

# Fix a SonarCloud (SonarQube) issue

Finds open issues via the SonarCloud REST API, fixes them and opens a PR.
Works in whatever XWiki / xwiki-contrib repo the session runs in. Requires the
`SONARQUBE_TOKEN` and per-repo `SONARQUBE_PROJECT_KEY` env vars (see the plugin README). The
SonarCloud organization is `xwiki`. The repo you are working in is the local clone — read files from
the working copy, never fetch them over a remote API.

## Know the rule before you fix it

**The quality of the fix is decided by knowing which sites to DROP**, and that knowledge is
rule-specific. It lives in the OKF at `okf/sonarqube/` (resolve from this skill's directory as
`../../okf/sonarqube/`; in Claude Code `${CLAUDE_PLUGIN_ROOT}/okf/sonarqube/`, in Kimi Code
`${KIMI_SKILL_DIR}/../../okf/sonarqube/`, in opencode `$XWIKI_LLM_HOME/xwiki/okf/sonarqube/`).

1. **Always read `okf/sonarqube/index.md` first** — the rule → family-file map, the rules never worth
   fixing, and the drop conditions that apply to every rule.
2. **Then read only the one family file** for the rule you commit to fixing. Do not read the others.
3. Read `okf/sonarqube/verification.md` before building.
4. **When the rule is about a CONVENTION rather than a code shape, the knowledge lives in
   `okf/conventions/`, not in `okf/sonarqube/`** — and the index entry will say so. Logging rules
   (`S2629`, `S2589` on log guards, anything about what to pass a logger) are owned by
   `okf/conventions/logging.md`; follow the pointer before deciding the fix.

A fix applied without its family file is how a batch ships an infinite recursion (S3878), a dead
reflective callback (S1185), or an NPE on a `null` enum key (S1640) — all of which compile cleanly.
A fix applied without the *convention* file is how a batch "removes a redundant `toString()`" from a
log call and silently changes what gets written into the job log.

## Finding an issue (most token-expensive phase — keep it cheap)

The cost here is almost entirely file reads while evaluating candidates. Rules:

* **Discover cheaply before listing bodies.** First get the rule distribution without issue bodies:
  `curl -s -u "$SONARQUBE_TOKEN:" "https://sonarcloud.io/api/issues/search?organization=xwiki&componentKeys=$SONARQUBE_PROJECT_KEY&issueStatuses=OPEN&severities=BLOCKER,CRITICAL&facets=rules&ps=1"`
  For an exact per-rule count read the response `total` from a `&rules=java:SXXXX&ps=1` query, not a
  facet value.
* **Pick a rule from `okf/sonarqube/index.md`**, safest family first, and query it explicitly with
  `&rules=java:SXXXX`. Start with BLOCKER, then CRITICAL, then lower — but this is guidance, not a
  gate: a clean MAJOR fix beats forcing a risky higher-severity one, and the mechanical
  BLOCKER/CRITICAL pool is frequently exhausted.
* **Delegate triage to an `Explore` subagent** when you must read and reject several candidates. It
  lists candidates, reads local snippets, rejects unsuitable ones, and returns ONLY the chosen issue
  key + the ~15-line snippet + its file path. Rejected candidates' file content stays in the subagent
  and never reaches the main thread — this is the single biggest token lever. For a single mechanical
  candidate, an inline `Read` with `offset`/`limit` is cheaper than spawning one.
* **Read locally and narrowly.** Use `Read` on the working copy with `offset`/`limit` for ~15 lines
  around the flagged line (the issue gives `line` and `textRange`). Never read a whole file to
  evaluate a candidate; never fetch file contents over a GitHub/remote API.
* **Component key = `groupId:artifactId:path`, which has TWO colons.** The file path is
  `component.split(':')[-1]` — splitting on the first colon is wrong and every file open then fails.
  Collect issue keys by a substring of the full component **path**
  (`.../xwiki-platform-chart-macro/...`), not a guessed short module name, which silently returns 0.
* **Always trim the JSON.** Some rules attach huge `flows`/`locations` arrays. Pipe every
  `issues/search` response through `jq`/`python3` and keep only `key,rule,component,line,message,effort`.
  Never dump a raw response into context.
* **Skip issues that already have an open agent PR.** Fetch the list once, up front, with
  `gh pr list --search "is:pr label:llm-agent is:open"`. Scope the off-limits check by **(rule +
  module)**, not rule alone — a per-module PR only claims the files it touched. But a **same-file** open
  PR is off-limits even for a different rule, because a concurrent edit risks a merge conflict.
* **Ask what else the lines you are about to rewrite already carry.** One query per candidate file —
  `"…/issues/search?componentKeys=<the issue's full component>&resolved=false&ps=100"` — then compare
  with the lines your edit touches. A rewrite SonarCloud cannot match re-dates those findings into the
  new-code period and can turn the `master` quality gate red although you introduced nothing (see
  `okf/sonarqube/verification.md`). Fix them in the same PR, or pick another site.
* **Stop at the first viable candidate.** Pull a small batch (`ps=5`), read only the top candidate's
  snippet, and accept it unless the snippet disqualifies it. Do not pre-read multiple candidates.

## Applying the fix safely

The failure mode to design against is a **silent** mis-edit: a wrong mechanical fix usually still
compiles, so the build will not catch it.

* **Apply a many-file batch in ONE assert-guarded script, not dozens of `Edit` calls.** For each
  `(file, old, new)` triple, assert `content.count(old) == 1` **first** — that catches a stale,
  drifted or ambiguous target — and write **nothing** if any assertion fails. Validate every edit
  (occurrence count + resulting line lengths) before writing anything: if an assertion fires mid-loop,
  some files are already written.
* This scales to **structural** rules (brace surgery, multi-line blocks) — make each `old` a verbatim
  multi-line block asserted to occur exactly once. That beats delegating, because the assertions *are*
  the verification. Dump the snippets once (`±6` lines around every flagged line, grouped per module),
  write the script, dry-run it printing `- old` / `+ new` per site, then re-run with a write flag.
* **`Edit`'s `replace_all` matches only the exact indentation you typed** and silently leaves the same
  pattern at other depths — prefer the script, and grep for the residual pattern after any batch
  replace.
* **Verify the checkout is at the scanned commit before trusting line numbers.** Compare
  `api/project_analyses/search?project=…&ps=1` → `analyses[0].date` against `git log -1 --format=%ci`.
  If the checkout is *ahead*, line numbers have drifted and a line-keyed `old` will silently not match
  — locate each site by the code pattern or by the Sonar `message` (which names the method, field or
  constant) instead.
* **For a regex-expressible rule, locate sites by per-file MATCH COUNT rather than line numbers.**
  Per flagged file, count pattern matches in the working copy and compare with that file's issue count.
  Equal ⇒ transform every match, whatever the drift. Unequal ⇒ inspect only those few files. Assert
  per file and assert the total against the project `total`. This is the most robust anti-drift
  technique and needs no snippet reads.
* **Track how many issues each edit resolves.** One edit often clears several keys (a triple-nested
  `if`, an `instanceof` line with several casts, a class-level test-visibility flag), so assert the
  sum against the Sonar `total` and build the accept list **by key**, not by edit count.
* **Two issues on the SAME line** → combine them into one edit. Two edits both keyed to the original
  full line will not both land: the second's stored `old` goes stale once the first applies.
* **Sonar attributes a multi-line statement's issue to the STATEMENT-START line**, which can be
  several lines above the flagged token. If a line-keyed `old` is not found there, grep the file for
  the actual token.
* **Check line length on the CHANGED lines only.** A whole-file check aborts on pre-existing >120
  lines, which exist even in `src/main` because Checkstyle excludes those files.
* **Deleting code orphans its imports.** Remove the now-unused import, but only if the type's **simple
  name** is absent from the final content, matched with a **word boundary** — a plain substring test
  sees `Logger` inside `LoggerFactory`.
* **If you do delegate** (site counts beyond what you can hold), use parallel general-purpose
  subagents — not `Explore`, which cannot edit — over **disjoint** files. **Never trust a subagent's
  self-reported "converted"**: it routinely reports, with a plausible rationale, editing a file it
  never touched, and a missed site still compiles. Afterwards, cross-check the exact expected file set
  against `git diff --name-only`, apply the missed sites yourself, and re-grep the pre-fix pattern
  across changed files — only intentional keeps should remain.

## Rules

* Never break backward compatibility.
* Do **not** suppress or ignore an issue merely to clear it. If a fix is hard or would take more than
  ~15 minutes, drop it and pick another. When an issue is a genuine **false positive**, the right
  resolution is `@SuppressWarnings("java:SXXXX")` plus a `//` comment saying why — in the code, not
  just *Accepted* in SonarCloud. The convention is in `okf/conventions/code-style.md`.
* Use Apache Commons helpers only when they genuinely reduce boilerplate.
* **Verify the modified modules build with their tests running** — never `-DskipTests`, always
  `-Plegacy,quality`. See `okf/sonarqube/verification.md` and the **xwiki-build** skill.
* One PR per rule family; the PR's commits must be relevant only to the issues it fixes.
* Open the PR with `gh`. For commit/PR conventions use the **xwiki-pull-request** skill; SonarQube
  fixes normally have no JIRA issue, so use `[Misc] <description>` and mention SonarQube in it:
  ```
  [Misc] <short description of the problem; mention SonarQube>
  * <optional detail bullets>
  ```
* Add the `llm-agent` label to the PR.
* Include a link to the SonarCloud issue in the PR description, and note any module you excluded from
  the change (and why) — see `okf/sonarqube/verification.md`.
* **Security issues:** do not reveal what was fixed (commit logs are public and could expose a
  vulnerability) — keep the description cryptic.

## Handling a reviewer objection

A reviewer saying "this feels wrong" about a **mechanical** rule usually means the rule is a bad fit
for that *kind* of code, not that the transformation is broken. Verify the mechanism so the record is
accurate, then judge whether the objection is about **intent clarity** — if it is, it stands even when
the change is provably behaviour-preserving. Withdraw rather than argue: reply with the clarification
and close the PR.

Then **do not stop at closing it**. Ship the `@SuppressWarnings` + rationale version as its own PR,
and narrow the rule's entry in `okf/sonarqube/` to the code shape that provoked the objection — do
not blanket-denylist a rule that is fine elsewhere.

## Closing the issues

**Never transition an issue the PR fixes.** SonarCloud closes it as FIXED on its own at the next
branch analysis after the merge — a `@SuppressWarnings` fix included, since the rule then stops
raising it. *Accepted* means "won't fix": on a fixed issue it buys nothing, and hides a real defect
from the quality gate if the PR never lands. Turning a red gate green before the merge is the
developer's call — ask.

Transition only a finding the code keeps as it is — `falsepositive` for one that is wrong,
`accept` for one that is real but deliberately not worth fixing — with a comment saying why:

```bash
curl -s -u "$SONARQUBE_TOKEN:" -X POST "https://sonarcloud.io/api/issues/add_comment" \
  --data-urlencode "issue=$ISSUE_KEY" --data-urlencode "text=$MESSAGE"
curl -s -u "$SONARQUBE_TOKEN:" -X POST "https://sonarcloud.io/api/issues/do_transition" \
  --data-urlencode "issue=$ISSUE_KEY" --data-urlencode "transition=accept"
```

(The `sonarqube` MCP server's `change_sonar_issue_status` is an alternative to the transition call.)

For many issues: each one costs ~2 requests, so a 20+ issue loop will blow a short command timeout —
run it in the background and make it idempotent by re-querying which keys are still OPEN.
`do_transition`'s response does **not** reliably contain an `issues` key (indexing into it raises,
even though the transition applied) — confirm separately with `issues/search?issues=<keys>` and
re-POST for any straggler.

## Capturing what you learn

A durable, generic fact about **when a rule's fix is wrong in XWiki** belongs in `okf/sonarqube/` —
offer to add it via the `xwiki-knowledge` EXTEND flow (a reviewed PR, never a silent write). Volatile
facts — how many issues a rule has, which module they cluster in, which pools are drained — do **not**
belong there; they are stale within days.
