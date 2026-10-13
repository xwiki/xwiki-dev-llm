---
name: xwiki-daily-close
description: "EXPLICIT INVOCATION ONLY. A developer's daily push to close work they already have open — their GitHub pull requests, their JIRA issues and the forum topics they started: finds what is ready or one step from done, ranks it with stats and trend, and offers each merge, issue close or forum conclusion for a yes. Use ONLY when named — `/xwiki-daily-close`, \"run my daily close\", optionally narrowed to gh, jira or forum. Do NOT use it for \"what PRs do I have open?\", \"is XWIKI-123 fixed?\" or any single-item question: answer those directly, or with xwiki-jira for an issue."
---

# Daily close

Each day, move the developer's **already open** work towards done. Not new work, not triage of
other people's backlog.

**Ask before each write, one at a time** — a merge, a close or a forum post is public and hard to
take back, and "ready" is only the rules' opinion. The routine-PRs item is the one batch: the
developer approves the listed PRs together.

## 0. The script

`daily-close.mjs` gathers the data and applies every rule code can decide; you answer only the
questions it leaves, then it ranks. Never re-implement its rules or re-query what it gathered — if
its output looks wrong, fix the script. Each item's `blockers` explain its verdict.

It is at `${CLAUDE_PLUGIN_ROOT}/scripts/daily-close.mjs` (Kimi Code `${KIMI_SKILL_DIR}/../../scripts/`,
opencode `$XWIKI_LLM_HOME/xwiki/scripts/`); below, `dc` means `node <that path>`. It prints where its
files are.

Credentials: GitHub through the `gh` login; JIRA through `JIRA_API_TOKEN`, else anonymously with a
`jira` username in the config; the forum through `DISCOURSE_API_KEY` + `DISCOURSE_API_USERNAME` to
write — without them, forum actions become drafts to paste.

## 1. Collect

```
dc collect                 # or --only gh|jira|forum: no budget, no history; later commands take the same --only
```

It takes a few minutes (GitHub's search API allows 30 requests a minute). On `skipped forum: no
forum username`, ask once and run `dc config forum=<username>` (likewise `github=`, `jira=`). An
`ERROR` line means that category is **missing** from the report — say so, never present it as empty.

## 2. Judge what code cannot

```
dc pending                 # items waiting for a judgement
dc show <itemId>           # one item: facts, questions, evidence
```

Read each item with `show`, one at a time (a run is hundreds of KB), and answer into the answers
file `pending` names — a JSON object keyed by item id:

- `cls` — `ready`, `close` or `not-close`, to change the script's verdict. Only `ready` and `close`
  are offered, so set `close` whenever there is a concrete step for the developer.
- `action` — the next step in a few words ("close the PR: surli says it is obsolete").
- `note` — what the developer must know before saying yes; also where you say you are unsure.
- `solutionPost` — forum only, the post to mark as the solution.
- `waiting: false` — someone commented after the developer, but nobody is waiting (an
  acknowledgement, or a PR its author parked).

By kind:

- **Pull request**: does the other person's comment ask something, ask to close the PR instead of
  merging it, or only acknowledge? Is each open review thread addressed, or what is left?
- **Issue** marked ready: map each branch's `pomVersion` to its unreleased JIRA version for the Fix
  Versions. A bug missing from a maintained branch it affects is a backport to do: `close`.
- **Forum topic**: the item's question defines the buckets; READY → `ready` with `solutionPost`,
  CLOSE-a/b/c → `close` with the action, NOT-CLOSE → `not-close`. Count votes given in words
  ("yes", "lgtm") — `votes` only sees `+1`/`-1`. For CLOSE-a, draft the conclusion in
  `runs/<date>-drafts/<topicId>.md`: the outcome and who voted, the decided points, next steps only
  if the thread names them (never invent a JIRA key), and the attribution line of
  okf/servers/index.md.

## 3. Rank and show

```
dc rank                    # --budget N / --others-budget N for one run (defaults 10 and 5)
```

It groups linked items into units (a PR and its issue, a PR stack in merge order, a forum topic
and the PRs it unblocks) and ranks them in two buckets with their own budgets — **your work** and
**others' work waiting on you** — someone waiting first, then ready, then oldest. Stale items are
only counted; bot PRs assigned to the developer are one routine item. Show the report as it is.

## 4. Offer

Walk both lists in order, your work first:

| Step | How |
|---|---|
| Merge a PR | `gh pr merge <url> --squash --delete-branch` (xwiki-pull-request). In a stack, follow the listed order and re-check the next one is still mergeable. |
| Close a JIRA issue | Through xwiki-jira: resolution Fixed, the Fix Versions from §2. |
| Missing backport | Hand over to xwiki-backport. |
| Mark a forum post solved | `dc accept <topicId> <postNumber>` |
| Post a forum conclusion | Show the draft, apply the developer's edits, post it with the discourse MCP, then `dc accept` it. |
| Reply, or request a review | Draft it (with the attribution line), show it, post it. |

After each write, `dc done <itemId> <action>` — the next report counts them. A "no" or "later" is
not re-offered in the same run.
