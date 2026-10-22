# Fix PRs: the tiers, the verification, the two identities

Read by `xwiki-ci-check` (SKILL.md §5) before preparing any fix PR, in either mode. The rules
SKILL.md §5 states inline — Tier C, verify and fail closed, `pull-request.mjs` only, the exit-3
lock rule — hold whatever this file says. § numbers are those of SKILL.md.

**What blocks a release comes first, always.** A compile break, a broken pom, a failing Sonar
quality gate, a test that now fails in *every* build: those make the build red for everyone and
hold up the next release, so the run's fixing effort goes there before anywhere else — a quality
gate through `xwiki-fix-sonarqube-issue` (§3), the rest through the tiers below. A flicker costs
whoever hit it a re-run and blocks nobody, so stabilising one is what this skill does on a morning
when none of that is open, never instead of it. `summary.stabilise.blockers` is that list.

| Tier | What | PR |
|---|---|---|
| **A — mechanical** | License headers, a Checkstyle violation the error localises exactly (line > 120 chars, unused import, whitespace, missing newline), a trivially broken compile after a rename | ready for review |
| **A — coverage** | A failing coverage check whose `blame.tier` is `certain` or `likely`, fixed by `okf/testing/strategy.md`'s coverage rule: a culprit that only removed covered code gets the ratio lowered to the achieved value; otherwise the missing unit tests (`xwiki-increase-test-coverage`), on master only — a stable branch never gets a test master lacks. Never edit an existing test | **draft** — the culprit judges which case it is, and any new test |
| **B — inferred** | A UI change renamed a selector and the page object still queries the old one; renamed or moved test resources | **draft** |
| **B — follows the culprit** | A *unit* test still expecting a value the culprit commit's own diff changed — see below | **draft** |
| **B — the fix itself** | The failure is the product (or the build) being wrong, and the fix is production code: code a new lint rule rejects, a null the culprit's diff lets through. The body states any behaviour change — `.then()` → `await` changes how a rejection propagates — and the culprit, assigned, is the one who judges it | **draft** if it changes behaviour, ready for review otherwise |
| **C — never** | Changing an assertion, an expected value or a timeout — except "follows the culprit" | — |

**Tier C is a safety rule, not a limit on capability.** A failing assertion is the hypothesis that
the product is wrong; "fixing" it by editing the expectation launders a real regression into a green
build. If the product is wrong, fix the product; if a fix seems to need an assertion change, that is
a comment to a human, not a PR.

**"Follows the culprit" is that comment, made answerable in one click.** A commit changes what a
method returns (an empty array instead of `null`, say) and a unit test still stubs or expects the
old value: a one-line fix, unless a caller treats the two differently and the line hides the
regression — which only the author knows. So the PR asks, and only when all of these hold:

- `blame.tier` is `certain` or `likely` — no culprit, no question to ask;
- it is a **unit** test — a functional test asserts what a user sees (`okf/testing/strategy.md`);
- the test change mirrors one line of the culprit's diff, quoted in the body, and nothing else;
- the body opens with: *"`<sha>` changed `<what>` from `<old>` to `<new>` and `<test>` still
  expects `<old>`. If intended, merge this; if not, close it — the bug is in `<sha>`."*

Verify before opening, always, and **fail closed** — if verification fails there is no PR, and the
attempted fix goes into the paste instead:

```bash
xmvn clean install -B -ntp -pl <module-path> -Plegacy,quality
```

Always `clean`, always `-Pquality` (`xwiki-build` owns these commands; `xmvn` picks the branch's
JDK). **The failing module is not the whole break when the culprit changed something shared** — a
lint rule, a Checkstyle setting, a parent pom: a build stops at its first failure, so the modules
after it were never checked. Build every module that consumes what the culprit changed, and fix
them in the same PR; on 2026-10-17 a fix verified on `xwiki-platform-node` alone merged, and the next
build failed on the same rule in `xwiki-platform-localization-webjar`.

**The functional tests are not run** — they take hours. So the PR must **assign the culprit
author** — the `commentable` culprit or the one a proof singled out (§4), and nobody when there is
neither — and say plainly, in its body, that the ITs were not run and the author should verify before
merging. Jenkins does not build PRs, so there is no free oracle: this verification is the only one.
Follow `xwiki-pull-request` for the commit message and the description.

**No fork is involved, and the bot opens the PR.** Two identities do two halves of the job:

- **The branch** is pushed into the upstream repo by the Claude GitHub App installed on the `xwiki`
  org, which can push a `claude/<slug>` branch to `xwiki/*` directly; the commit carries the bot
  as its **author**:

  ```bash
  git commit --author="XWiki LLM Bot <llm-bot@xwiki.org>" …
  ```
- **The PR** is opened by `xwikiorg-llm-bot` (`write` role on the repo, which locking needs), with
  this tool and nothing else:

  ```bash
  node <skill>/tools/pull-request.mjs --work-order work-order.json --kind fix --repo xwiki-platform \
    --head claude/<slug> --base master --title "<subject>" --file pr-body.md \
    --assignee <culprit login> [--draft] [--write]
  ```

  It labels the PR **`llm-agent`**, assigns `--assignee`, and locks it to collaborators. It also
  holds §5's brake: the PR's body carries the run (the work order's `generatedAt`), and a third
  `--kind fix` PR of one run — a quality-gate fix counts like any other — is refused with exit 4;
  put that pushed branch in the paste instead. Like
  every writer here it prints instead of posting without `--write`, and a re-run completes a
  half-done PR instead of opening a second one. **Never open a routine's PR with `gh` or the GitHub
  MCP server**: they act as the session's account — the developer who owns the routine — so the PR
  would read as that colleague's work. Without a working `GH_TOKEN_BOT`, open no PR and put the
  pushed branch in the paste.

**Answering on the bot's PR** — its red check, a review — goes through `pull-request.mjs --comment
<number> --repo <repo> --file comment.md --write`, which posts only on a PR the bot opened and reads
the author back. GitHub's `Quality / Analyze` check builds only the changed modules: on a webjar
that imports workspace packages from `xwiki-platform-node`, `tsc` fails on missing declarations
whatever the change. Say so once on the PR rather than re-running it.

**The lock is required, not cosmetic.** The routine runs with *Auto-fix PRs* turned on in its
config, so every comment on its PRs reaches a model that can push, and the lock limits who may write
one to collaborators. If the tool exits 3 (`NOT locked — …`), this session must not act on that PR,
and the tool prints what to do instead — auto-fix may already have subscribed the session to it.

**A fix PR from a local run is the developer's own PR**, opened under their own name by
`xwiki-pull-request` with their own credentials, because there is no App token on a laptop. That
asymmetry with the commit comment — which is the bot's, always, everywhere — is deliberate: a
comment lands unasked on someone else's commit and must never read as coming from a colleague,
whereas a PR is proposed work someone has to own, and the developer who said yes to it is that
someone. The body still says the fix was machine-generated and that the ITs were not run, and the
PR still carries the `llm-agent` label.
