---
name: xwiki-review
description: "EXPLICIT INVOCATION ONLY — never load this skill for a plain review request. A deliberately expensive multi-angle, XWiki-aware review of a change set (pull request, commit range, or working tree): it fans out one specialist reviewer per angle (conventions, architecture, backward compatibility, security, performance, tests, accessibility, i18n/UX, documentation, data & migration, spec conformance) — the security angle either quick (the public secure-coding conventions) or, when the private xwiki-security-review skill is available, full, at the developer's choice — puts every finding through an independent skeptic, drops the ones that do not survive, and posts one grouped comment. Use ONLY when the user names it — `/xwiki-review`, \"run xwiki-review\", \"do the multi-angle/full/deep review\" — or when a CI routine invokes it by name. Do NOT use it for \"review this PR\", \"review my changes\", \"review the working tree\" or any other unqualified review request: those are answered directly, without this skill, because it costs far more tokens and time than a normal review. For opening the PR itself use xwiki-pull-request; for the conventions it enforces use xwiki-knowledge; for Sonar findings use xwiki-fix-sonarqube-issue."
---

# XWiki multi-angle review

**This skill is opt-in.** It is never the answer to a plain "review this" — a normal review is done
directly, without it. It runs only when the developer asks for it by name (`/xwiki-review`, "run
xwiki-review", "the full multi-angle review") or when a CI routine invokes it. It spawns eleven
reviewers over the same diff, so it costs an order of magnitude more tokens and wall-clock than a
single-pass review; that price only buys something when the developer has decided they want it.

A review that is *XWiki-aware*: every finding must trace to a rule this project actually holds —
an OKF file, a skill, a `CLAUDE.md`, or a code fact — never to generic best-practice folklore.

The value is not "an LLM read the diff". It is that eleven narrow reviewers each read the diff
through one lens they know deeply, and that everything they say is filtered hard before a human
sees it. **A review nobody trusts is worse than no review**, so the whole protocol is built around
suppressing false positives.

## 0. Inputs

The caller supplies one of:

- `PR <number>` — review `gh pr diff <number>`, base = merge-base with the target branch.
- `COMMITS <sha>..<sha>` — review that range (used by the daily sweep over direct pushes).
- nothing — review the working tree against `HEAD` (local pre-PR use).

Also resolve, once, up front:

- `REPO`, the head SHA (`git rev-parse HEAD`, full 40 chars — needed for permalinks).
- The JIRA key(s) in the commit subjects (`XWIKI-`, `XCOMMONS-`, `XRENDERING-`, contrib keys).
- The list of changed files, with their extensions and modules.
- The **security depth**, `quick` or `full`, decided before any work starts so the run never stalls
  on it later:
  - **`quick`** — the defensive-conventions angle of §4, grounded in `okf/conventions/security.md`
    alone. The only depth when a CI routine invokes this skill, or when the session has no
    `xwiki-security-review` skill (the private `xwiki-security` plugin) — then do not ask.
  - **`full`** — run `xwiki-security-review` on the same change set in place of that angle (§4b).
    Only offered when that skill is available and a developer is at the keyboard: ask whether they
    want the full security review — it proves each finding on a disposable local instance and
    costs far more time — or the quick one.

## 1. Eligibility gate — the deterministic checks first

These are shell checks: run them in the orchestrator before spending a model call. Stop
immediately — post nothing — if any holds:

- The PR is closed, merged or a draft (`gh pr view --json state,isDraft`).
- A review comment from this routine already exists **for the current head SHA**.
- The diff exceeds the sanity ceiling (default 3000 changed lines across more than 150 files, from
  `git diff --shortstat`) — post a single line saying the change was too large to review
  automatically, and stop.
- The author is Renovate or Dependabot and the diff is only version bumps.

One judgement call is left, and it is the only model call in this step: decide from the diff alone
whether the change carries human judgement worth reviewing. A `mvn license:format` header-only
diff, pure `xar:format` reformatting, an l10n translation sync, or a trivially safe change (a typo
in a comment, a single `@since` fix) all stop the routine here.

## 2. Context pack — assembled in code, once, shared by every reviewer

Every item below comes from `git`, `gh`, the poms or the JIRA API, so assemble it with commands
rather than a model call. Every reviewer receives exactly this and nothing else, so that eleven
agents do not each re-derive it:

- The diff, and the commit subjects/bodies.
- The **paths** (not contents) of every `CLAUDE.md` that applies: repo root plus any in the
  directories touched.
- The JIRA issue title and description for each key found (via the `xwiki-jira` skill) — the
  conventions angle needs both to judge the commit messages against
  `okf/conventions/commit-messages.md`.
- For each touched module: whether it is `-legacy`, `oldcore`, a `xar`-packaging module, a
  `-test-docker` module, or frontend (`.js`/`.vue`/`.less`/`.vm`).
- The `xwiki.jacoco.instructionRatio` currently declared in each touched module's pom.

## 3. Routing — pick the angles that apply

Do not run all eleven on every change. Route from the changed-file profile:

| Angle | Runs when | Grounded in |
|---|---|---|
| **Conventions** | any source file | `okf/conventions/code-style.md`, `code-comments.md`, `commit-messages.md`, `logging.md` |
| **Architecture** | any `.java` | `okf/architecture/component-system.md`, `macro-refactoring.md` |
| **Backward compatibility** | any `.java` outside test/legacy dirs | `okf/conventions/backward-compatibility.md`, `versioning.md` |
| **Defensive conventions** | always — at `full` depth, replaced by §4b | `okf/conventions/security.md` |
| **Performance** | always | `okf/conventions/performance.md` |
| **Tests** | always (a change with no test is itself the finding) | `okf/testing/strategy.md`, `xwiki-test-guidelines` |
| **Accessibility** | `.vm`, `.html`, `.vue`, `.js`, `.less`, `.css`, UI `.xml` | `okf/conventions/frontend.md` (it names the committed WCAG level) |
| **i18n & UX** | any user-facing string, `.properties`, `.vm`, `.xml` sheets | `xwiki-translations` |
| **Documentation** | new/changed public API, or user-visible behaviour | `okf/conventions/documentation.md`, `xwiki-javadoc` |
| **Data & migration** | `*.hbm.xml`, `R*XWIKI*.java`, Solr schema, store code; an XClass definition, a generated page name or a wiki-page migration | `okf/architecture/solr-search.md`, `wiki-application-data.md` |
| **Spec conformance** | a JIRA key was found | the JIRA issue itself |

Announce the routing decision in one line before fanning out, so a human can see what was and was
not looked at. **Never silently skip an angle** — if you drop one, say so.

## 4. Fan out — one agent per angle, in parallel

All selected angles run **concurrently**, each in its own agent so they cannot contaminate each
other's context. Give each agent the context pack, its angle's name, the resolved OKF path below and
the absolute paths of two files next to this skill: `references/reviewer-contract.md` (the bar every
reviewer meets, how to read its sources, what it must never write) and `references/briefs.md` (one
section per angle: what to load and what to look at). It reads the contract and **only its own
brief**. **Read the contract yourself before fanning out**: its "Never write the word" list binds
your own narration, the comment and every log from here on.

The rules an angle enforces live in the OKF and in the other skills, and are never restated here or
in the briefs: the skeptic of §5 drops any finding whose cited file does not say what was claimed,
so a stale paraphrase would not produce wrong findings — it would silence the angle.

The OKF ships inside this plugin at `okf/` — resolve it from this skill's directory as `../../okf/`
(in Claude Code `${CLAUDE_PLUGIN_ROOT}/okf/`, in Kimi Code `${KIMI_SKILL_DIR}/../../okf/`, in
opencode `$XWIKI_LLM_HOME/xwiki/okf/`), and give every agent the resolved absolute path.

### 4b. Full security depth — delegate to `xwiki-security-review`

At `full` depth the defensive-conventions angle does not run: `xwiki-security-review` does its work
and more, loading the same `okf/conventions/security.md` plus the private mechanism knowledge base.
Invoke it on the same change set (PR, range or working tree) as the other angles, concurrently with
them, and let it follow its own procedure and gate unchanged.

Its output **never joins this pipeline**: not §5's skeptics (it refutes and proves its own
findings), not §6's comment, not any log. It stays in that skill's report in the work directory and
in the terminal; §6's comment leaves the angle out of both its run and its skipped lists. Should
the developer then ask to tell the author about one of its findings, that skill's gate says how —
phrased as §6b prescribes, as one more finding of the comment.

## 5. Verification — every finding is challenged before it survives

Collect every finding from every angle. Deduplicate: when two angles report the same line, keep the
one whose rule citation is more specific and merge the reasoning.

Then, for each surviving finding **in parallel**, run an independent skeptic that is given the
finding, the diff, the `CLAUDE.md` paths, the resolved OKF path and the absolute path of
`references/skeptic.md`, which holds its instructions. It returns one verdict — `false`,
`unverified`, `nitpick`, `confirmed` or `certain` — after opening the cited file to check the rule
actually says what the finding claims.

**Keep `confirmed` and `certain`; drop the rest.** If nothing survives, say so — that is a good
review, not a failed one.

## 6. Post

Re-run the eligibility gate from step 1 (the PR may have been merged or closed while you worked),
and check the comment against the Write / Never-write list in `references/reviewer-contract.md` (§6b
says why it binds the comment). Then post **one** comment. Never split a review across many comments; never post inline comments
for anything below `major`.

The comment opens with this disclaimer, verbatim, always:

> **Automated review — generated by Claude Code.** It can be wrong. Treat every point below as a
> question, not a verdict: verify the claim against the code before acting on it, and dismiss
> anything that does not hold.

Then:

```
### Automated review

Reviewed <N> files across <angles run>. Found <M> issues.

**Blockers**
1. <one-sentence claim> — <rule cited, linked>
   <permalink>

**Major**
2. ...

**Minor**
3. ...

<Angles that were skipped, and why.>

<sub>Was this useful? React 👍 or 👎 — the reactions are read back monthly to tune the reviewer.</sub>
```

Rules for the comment body:

- Brief. No emojis in the findings themselves. No praise section, no summary of what the PR does —
  the author knows.
- Every finding links to the code with a **full-SHA permalink** covering at least one line of
  context either side: `https://github.com/<repo>/blob/<full-40-char-sha>/<path>#L<start>-L<end>`.
  Compute the SHA up front (step 0); a `$(git rev-parse HEAD)` inside the URL will not render.
- Every rule citation is a link too — to the OKF file, the skill, or the `CLAUDE.md` line.
- Use `gh` for all GitHub interaction. Never push, never edit files, never re-run the build.

### 6b. Never write the word

Load `okf/processes/security-policy.md`. Its non-disclosure rule is the constraint this section
exists to satisfy; what follows is only its consequence for *review output*, which the policy does
not itself cover. This repo is public, and so is more than the comment:

> **GitHub Actions logs on a public repository are public.** Everything the run prints — the
> narration, an agent's returned text, a job summary — is world-readable at a stable URL and stays
> in the log archive. Reasoning that never reaches the comment is published anyway.

There is therefore no safe place in this pipeline to *say* that something is a vulnerability. The
resolution is not to hide the finding but to **never form it as one**. The defensive-conventions
angle checks mechanisms, not attacks, so no stage of the pipeline — reviewer, skeptic, comment,
log — ever holds a sentence worth suppressing. This is why that angle's framing in its brief is a
hard constraint and not a stylistic preference.

Concretely: write the missing mechanism, never the problem it guards against — the Write / Never
write list is in `references/reviewer-contract.md`, read before step 4.

A finding phrased this way is indistinguishable from any other convention finding, which is exactly
the goal: it is actionable for the author, and it signals nothing to anyone reading over their
shoulder. It is the same device the policy already prescribes for a security fix's commit message —
say what changed mechanically, never that it closes a hole.

**Out of scope, deliberately.** This routine does not hunt for novel vulnerabilities — the kind that
require reasoning about reachability and attacker capability, which cannot be phrased mechanically
and therefore cannot run here at all. That work stays with humans, on the security list, and with
committers running the `full` depth (§4b) locally, where nothing is published. The routine covers
the conventions; it does not replace a security review, and it must never be described as one — nor
may the comment say, or hint, that a `full` review ran.


## 7. Feed what you learned back

Whenever a reviewer wanted to flag something real but found **no rule in the OKF, a skill or a
`CLAUDE.md` to cite**, record it as a *candidate convention*: one line, what the rule would say and
the example that prompted it. These are not posted on the PR. They are batched and offered to a
human through the `xwiki-knowledge` EXTEND flow — which is how the reviewer gets sharper over time
instead of repeating the same unfounded opinions.
