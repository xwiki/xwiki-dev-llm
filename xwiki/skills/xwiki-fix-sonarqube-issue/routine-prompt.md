# The routine prompt

What the scheduled SonarCloud routine is given, and the environment it runs in. The routine lives in
a config box in the Claude web UI, which nobody else can read, review or restore — so it is recorded
here, where a change to it is a pull request. **If you edit one, edit the other in the same
sitting**, or this becomes a plausible-looking record of something that no longer exists.

The behaviour itself lives in the `xwiki-fix-sonarqube-issue` skill and in `okf/sonarqube/`, both
versioned and reviewed. Only what cannot live there is below.

**Schedule: 03:00 Europe/Paris, daily. Model: Opus 5.**

## The prompt

> ⚠️ The live routine still runs an earlier version of this. Paste this in.

```
Fix SonarQube issues in xwiki-platform, xwiki-commons and xwiki-rendering — all three already cloned locally — using the xwiki-fix-sonarqube-issue skill. Open a separate PR per repository, in the same session. Fix at least 30 issues this session where the fixes are safe; put the fixes you are unsure about in their own PR, so that the easy ones can be merged without waiting for the hard ones.

Memory — the xwikiorg-llm-bot/sonarcloud-routine-memory repo:
* Read sonarqube/learnings.md first, every run: it holds the always-load core and the Rule index. Then, for each rule you decide to fix this run, read that rule's detail file under sonarqube/rules/ as the Rule index points to it. Do not read the detail file of a rule you are not fixing.
* Record generic learnings only, each in the smallest file that owns it: a rule-specific gotcha in that rule's file under sonarqube/rules/, a cross-cutting technique or a build/PR/process fact in the matching section of sonarqube/learnings.md. Merge and trim in place — never append dated anecdotes — and re-synthesize only the files you changed, not the whole set. A new rule detail file gets its row in the Rule index table.
* Record in sonarqube/dropped-issues.md every issue you analysed and decided not to fix, whatever the reason, and skip those issues when analysing new ones.
* Commit and push on main.

Per-run overrides on top of the skill:
* Use llm-bot@xwiki.org (xwikiorg-llm-bot) as the commit author/co-author email.
* Once a PR is created, assign it to xwikiorg-llm-bot, and immediately lock it so that only collaborators can write comments, by issuing a PUT request to /repos/{owner}/{repo}/issues/{pull_number}/lock.
```

## Environment

### Variables

| Variable | What it is |
|---|---|
| `GH_TOKEN` | The bot's GitHub token. `gh` assigns and locks the pull requests with it, and pushes the memory repo. It is **not** what pushes a fix branch — see below. |
| `SONARQUBE_TOKEN` | The SonarCloud token for the `sonarqube` MCP server. `.mcp.json` declares it `${SONARQUBE_TOKEN}` with no default, so an unset token is a *missing* MCP server, not a degraded one. |

### Checkouts

`xwiki-platform`, `xwiki-commons`, `xwiki-rendering`, `xwiki-dev-llm`, and
`sonarcloud-routine-memory`.

### Network access

**Full**, not "trusted": trusted reaches none of the XWiki hosts, and fails the setup script itself
— the header of `routine-setup.sh` says how it fails.

### Setup script

`xwiki/scripts/routine-setup.sh`, pasted into the routine's setup field, and **shared with the
`xwiki-ci-check` routine**. A sandbox is new every run, so it installs everything past the
checkouts: `gh`, the plugin, JDK 17 and 21, `xmvn`, and an `~/.m2/settings.xml` pointing at XWiki's
Nexus. The JDKs and `xmvn` are what let one sandbox build any branch — `xwiki.java.version` is 17 up
to `stable-17.10.x` and 21 from `stable-18.4.x` on, and a build on a too-new JDK fails with JaCoCo's
`Unsupported class file major version`, which reads as a code problem and is not.

### How the PRs are opened

By the **Claude GitHub App** installed on the `xwiki` org: the author is `claude[bot]` and the head
branch (`claude/<slug>`) lives in the upstream repo itself. No fork, and no personal access token
pushes anything — the bot identity is carried by the commit author. `xwikiorg-llm-bot` has
`push: false` on all three repos, and that is correct rather than a misconfiguration.

## The memory repo

`xwikiorg-llm-bot/sonarcloud-routine-memory` (public, default branch `main`) — read before acting,
written back after, which is the whole of how the routine improves between runs. `GH_TOKEN` owns it,
so `push: true` and `admin: true`.

| Path | What it holds |
|---|---|
| `sonarqube/learnings.md` | The always-load core and the **Rule index** — read first, every run |
| `sonarqube/rules/<rule>.md` | One file per rule, read **only** for the rules being fixed this run |
| `sonarqube/dropped-issues.md` | Issues analysed and deliberately not fixed, so they are skipped next time |
| `sonarqube/pool-state.md` | The sweep's working state between runs |

The `sonarqube/` prefix is redundant against the repository name and stays anyway: flattening it
would rewrite the paths inside `learnings.md`'s Rule index and every cross-reference under `rules/`,
which is churn in the one place whose value is that it accumulates.

`xwiki-ci-check` needs no memory repo: every fact its next run relies on is recomputed from a
durable system — Jenkins, JIRA, and the comment left last time.
