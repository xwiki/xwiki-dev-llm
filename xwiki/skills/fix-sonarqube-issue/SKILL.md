---
name: fix-sonarqube-issue
description: Find and fix a single open SonarCloud (SonarQube) issue in the current XWiki repo, then open a PR and mark the issue Accepted. Use when asked to fix/clear/triage a SonarQube issue, reduce SonarCloud findings, or run a "fix one Sonar issue" pass. For the build commands it relies on use xwiki-build; for PR/commit conventions use xwiki-pull-request.
---

# Fix one SonarCloud (SonarQube) issue

Finds one open issue via the SonarCloud REST API, fixes it, opens a PR, and marks the issue
*Accepted*. Works in whatever XWiki / xwiki-contrib repo the session runs in. Requires the
`SONARQUBE_TOKEN` and per-repo `SONARQUBE_PROJECT_KEY` env vars (see the plugin README). The
SonarCloud organization is `xwiki`. The repo you are working in is the local clone — read files from
the working copy, never fetch them over a remote API.

## Finding an issue (most token-expensive phase — keep it cheap)

The cost here is almost entirely file reads while evaluating candidates. Rules:

* **Delegate triage to an `Explore` subagent.** It lists candidates, reads local snippets, rejects
  unsuitable ones, and returns ONLY the chosen issue key + the ~15-line snippet + its file path.
  Rejected candidates' file content stays in the subagent and never reaches the main thread — this
  is the single biggest token lever.
* **Read locally and narrowly.** Use the `Read` tool on the working copy with `offset`/`limit` to
  read only ~15 lines around the flagged line (the issue gives `line` and `textRange`). Never read a
  whole file to evaluate a candidate; never fetch file contents over a GitHub/remote API.
* **Discover cheaply before listing bodies.** First get the rule distribution without issue bodies:
  `curl -s -u "$SONARQUBE_TOKEN:" "https://sonarcloud.io/api/issues/search?organization=xwiki&componentKeys=$SONARQUBE_PROJECT_KEY&issueStatuses=OPEN&severities=BLOCKER,CRITICAL&facets=rules&ps=1"`
* **Target an allowlist of mechanical, low-risk, usually-isolated rules first** (clean
  single-line/single-block fixes), e.g. `java:S5361` (replaceAll→replace), `java:S1481`/`java:S1854`
  (dead code), `java:S2093` (try-with-resources), `java:S1192` (define a constant), `java:S2147`
  (collapse catch). Query them explicitly with `&rules=java:S5361,java:S1481,...`.
* **Avoid (denylist) slow/risky/many-per-file rules**, e.g. `java:S3776` (cognitive complexity —
  usually >15 min), `java:S1186` (empty-method stubs), `java:S3252`/`java:S1845` (often
  backward-compat/API, repeated across a file). Skip any issue whose file has a class-level
  `@SuppressWarnings` covering that rule, or that the team deliberately left (explanatory comment).
* **Always trim the JSON.** Some rules attach huge `flows`/`locations` arrays. Pipe every
  `issues/search` response through `jq`/`python3` and keep only `key,rule,component,line,message,effort`.
  Never dump a raw response into context.
* **Stop at the first viable candidate.** Pull a small batch (`ps=5`), read only the top candidate's
  snippet, and accept it unless the snippet disqualifies it (public API / backward-compat risk,
  >15 min effort, file-level suppression). Do not pre-read multiple candidates.

## Rules

* Start with BLOCKER, then CRITICAL, then lower. Example (use `ps=5`):
  `curl -s -u "$SONARQUBE_TOKEN:" "https://sonarcloud.io/api/issues/search?organization=xwiki&componentKeys=$SONARQUBE_PROJECT_KEY&issueStatuses=OPEN&severities=BLOCKER,CRITICAL&ps=5&p=1"`
* Skip any issue that already has an open agent PR. Fetch the list once, up front, with
  `gh pr list --search "is:pr label:llm-agent is:open"` before triaging.
* Never break backward compatibility.
* Do **not** suppress/ignore the issue to clear it. If a fix is hard or would take more than ~15
  minutes, drop it and pick another.
* Verify the modified Maven modules build (use the **xwiki-build** skill).
* Use Apache Commons helpers only when they genuinely reduce boilerplate.
* One PR per issue; the PR's commits must be relevant only to that issue.
* Open the PR with `gh`. For commit/PR conventions use the **xwiki-pull-request** skill; SonarQube
  fixes normally have no JIRA issue, so use `[Misc] <description>` and mention SonarQube in it:
  ```
  [Misc] <short description of the problem; mention SonarQube>
  * <optional detail bullets>
  ```
* Add the `llm-agent` label to the PR.
* Include a link to the SonarCloud issue in the PR description.
* **Security issues:** do not reveal what was fixed (commit logs are public and could expose a
  vulnerability) — keep the description cryptic.
* After the PR is open, mark the issue *Accepted* with a comment linking the PR:
  ```bash
  curl -s -u "$SONARQUBE_TOKEN:" -X POST "https://sonarcloud.io/api/issues/add_comment" \
    --data-urlencode "issue=$ISSUE_KEY" --data-urlencode "text=$MESSAGE"
  curl -s -u "$SONARQUBE_TOKEN:" -X POST "https://sonarcloud.io/api/issues/do_transition" \
    --data-urlencode "issue=$ISSUE_KEY" --data-urlencode "transition=accept"
  ```
  (The `sonarqube` MCP server's `change_sonar_issue_status` is an alternative to the transition call.)
