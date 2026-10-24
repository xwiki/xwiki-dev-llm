---
name: xwiki-review
description: "EXPLICIT INVOCATION ONLY — never load this skill for a plain review request. A deliberately expensive, XWiki-aware review of a change set (pull request, commit range, or working tree): a few senior-reviewer agents — correctness, design, tests, history of the touched code and its past reviews, conventions, and defensive conventions — each reading the code around the change with both general engineering judgement and XWiki's knowledge base, then an independent verifier per finding that re-checks it against the code, and one grouped comment. The defensive-conventions pass is either quick (the public secure-coding conventions) or, when the private xwiki-security-review skill is available, full, at the developer's choice. Use ONLY when the user names it — `/xwiki-review`, \"run xwiki-review\", \"do the deep/full review\" — or when a CI routine invokes it by name. Do NOT use it for \"review this PR\", \"review my changes\", \"review the working tree\" or any other unqualified review request: those are answered directly, without this skill, because it costs far more tokens and time than a normal review. For opening the PR itself use xwiki-pull-request; for the conventions it enforces use xwiki-knowledge; for Sonar findings use xwiki-fix-sonarqube-issue."
---

# XWiki review

**This skill is opt-in**, never the answer to a plain "review this": it runs only when named
(`/xwiki-review`, "run xwiki-review") or invoked by a CI routine. It costs several times a
single-pass review.

What it must do better than a single pass: find the problems a strong XWiki committer would find —
bugs, a better existing tool or place for new code, tests that prove nothing, a point the project's
reviewers have raised before — **and** apply XWiki's written conventions, without the noise. Each
reviewer therefore brings general engineering judgement *and* XWiki's knowledge; neither limits the
other. Every finding is then re-checked against the code by someone who did not write it, because
**a review nobody trusts is worse than no review**.

## 0. Inputs

The caller supplies one of:

- `PR <number>` — the checkout must be at the PR's head (`gh pr checkout`).
- `COMMITS <base>..<head>` — that range (the daily sweep over direct pushes).
- nothing — the working tree against `HEAD`, untracked files included (local pre-PR use).

The review goes to a PR comment, a commit comment on the range's last commit, or — for the working
tree — the terminal only (§4).

Decide the **security depth** before any work starts, so the run never stalls on it later:

- **`quick`** — the Defensive conventions reviewer (§2). The only depth when a CI routine invokes
  this skill, or when the session has no `xwiki-security-review` skill (the private `xwiki-security`
  plugin) — then do not ask.
- **`full`** — run `xwiki-security-review` on the same change set in its place (§2b). Only offered
  when that skill is available and a developer is at the keyboard: ask whether they want the full
  security review — it proves each finding on a disposable local instance and costs far more time —
  or the quick one.

## 1. Context pack and gate — in code, once

From the checkout, write the pack into a new directory under the work directory:

```bash
node <skill>/tools/pack.mjs --out <dir> [--pr <n> | --range <base>..<head>]
```

It writes `pack.md` (commits, changed files and their module profile, applicable `CLAUDE.md` files,
the JIRA issues), `diff.patch` and `prior-reviews.md` (what committers said on earlier pull requests
touching the same files), and prints the gate. **If `stop` is set, stop** — post nothing, except that
a change too large to review gets a one-line comment saying so.

One judgement call is left, from the diff alone: stop if the change carries no human judgement worth
reviewing — `mvn license:format` or `xar:format` output, a translation sync, a typo in a comment, a
single `@since` fix.

## 2. Reviewers — in parallel, one agent each

| Reviewer | Runs when |
|---|---|
| **Correctness** | the change touches code (anything but docs or translations) |
| **Design** | the change adds or reshapes code |
| **Tests** | the change touches code or tests |
| **History** | always |
| **Conventions** | always |
| **Defensive conventions** | always — at `full` depth, replaced by §2b |

Say in one line which ran and which did not, and why. Give each agent its role name, the pack
directory, the plugin's absolute root (in Claude Code `${CLAUDE_PLUGIN_ROOT}`, in Kimi Code
`${KIMI_SKILL_DIR}/../..`, in opencode `$XWIKI_LLM_HOME/xwiki`; the OKF is its `okf/`) and the absolute
path of `references/reviewers.md`, which it reads — the shared part and its own role only. Run every
reviewer and verifier **on the session's model**: Correctness and Design are where a weaker model
loses most. They are read-only: never edit, build, push or post.

**Read `references/reviewers.md`'s "Never write the word" yourself before fanning out**, and load
`okf/processes/security-policy.md`: that section binds your own narration, the comment and every log
from here on (§5 says why).

### 2b. Full security depth — delegate to `xwiki-security-review`

At `full` depth the Defensive conventions reviewer does not run: `xwiki-security-review` does its
work and more. Invoke it on the same change set, concurrently with the reviewers, and let it follow
its own procedure and gate unchanged.

Its output **never joins this pipeline**: not §3's verifiers (it proves its own findings), not §4's
comment, not any log. It stays in that skill's report in the work directory and in the terminal;
§4's comment leaves the role out of both its run and its skipped lists. Should the developer then ask
to tell the author about one of its findings, that skill's gate says how — phrased as §5 prescribes,
as one more finding of the comment.

## 3. Verify — every finding, independently

Merge findings that make the same point about the same code, keeping the best evidence and the most
specific source. Then run one verifier per finding, **in parallel**, each given the finding, the pack
directory, the plugin root and the absolute path of `references/verifier.md`, which holds its
instructions. Keep the findings it returns as `keep`, at the severity it gives; drop the rest.

## 4. Post

Re-run `pack.mjs` (the PR may have been merged or closed, or reviewed by another run, while you
worked; `stop` must still be unset), and check the comment against "Never write the word" in
`references/reviewers.md`. Then post **one** comment — on the PR for `PR`, as a commit comment on the
range's last commit for `COMMITS` (`gh api repos/<repo>/commits/<sha>/comments`). For the working
tree post nothing: print the same body in the terminal, without the marker, citing code as
`path:line`. Never split a review across several comments.

The comment's first line is the marker `<!-- xwiki-review sha=<full-head-sha> -->` (invisible once
rendered, and what `pack.mjs` looks for); then this disclaimer, verbatim, always:

> **Automated review — generated by Claude Code.** It can be wrong. Treat every point below as a
> question, not a verdict: verify the claim against the code before acting on it, and dismiss
> anything that does not hold.

Then:

```
### Automated review

Reviewed <N> files: <reviewers run>. <M> issue(s), <S> suggestion(s), <K> nit(s).

**Blockers**
1. <one-sentence claim> <why, one sentence>. <what to do instead> — <source, linked>
   <permalink>

**Major** / **Minor**  (same shape)

**Suggestions — not blocking, take or leave**
4. ...

<details><summary>Nits</summary>

5. ...
</details>

<Reviewers that did not run, and why.>
```

Rules for the body:

- Brief. No emojis in the findings, no praise, no summary of what the change does.
- At most three suggestions and five nits — the ones a committer is likeliest to act on.
- Every finding links the code with a **full-SHA permalink** covering a line of context either side:
  `https://github.com/<repo>/blob/<full-40-char-sha>/<path>#L<start>-L<end>` (the head from the gate
  output; a `$(git rev-parse HEAD)` inside the URL will not render).
- A source is a link: an OKF file or skill of this plugin to
  `https://github.com/xwiki/xwiki-dev-llm/blob/v<version>/xwiki/<path>` (`<version>` from
  `xwiki/.claude-plugin/plugin.json`), a past review to its PR. "Engineering judgement" needs no link.
- Leave out a heading with nothing under it; write `1 issue`, not `1 issues`. With nothing kept the
  comment is the marker, the disclaimer and the `Reviewed …` line — post it anyway: the marker is what
  stops a re-trigger from re-running the whole review.
- Use `gh` for all GitHub interaction.

## 5. Why "Never write the word"

`okf/processes/security-policy.md` holds the non-disclosure rule; what follows is only its
consequence for *review output*, which the policy does not itself cover. This repo is public, and so
is more than the comment:

> **GitHub Actions logs on a public repository are public.** Everything the run prints — the
> narration, an agent's returned text, a job summary — is world-readable at a stable URL and stays
> in the log archive. Reasoning that never reaches the comment is published anyway.

There is therefore no safe place in this pipeline to *say* that something is a vulnerability. The
resolution is not to hide the finding but to **never form it as one**: the Defensive conventions
reviewer checks mechanisms, not attacks, so no stage — reviewer, verifier, comment, log — ever holds a
sentence worth suppressing. A finding phrased that way reads like any other convention finding —
actionable for the author, signalling nothing to anyone reading over their shoulder: the device the
policy prescribes for a security fix's commit message.

**Out of scope, deliberately.** This routine does not hunt for novel vulnerabilities, which need
reasoning about reachability and attacker capability that cannot be phrased mechanically. That work
stays with humans, on the security list, and with committers running the `full` depth locally, where
nothing is published. The routine must never be described as a security review — nor may the comment
say, or hint, that a `full` review ran.

## 6. Feed what you learned back

Reviewers return *candidate conventions* — something that should hold for every change and that no
OKF topic says. They are not posted: batch them and offer them to a human through the
`xwiki-knowledge` EXTEND flow, which is how the review gets sharper instead of repeating unwritten
opinions.
