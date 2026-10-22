# Writing and posting the commit comment

Read by `xwiki-ci-check` (SKILL.md §4) before writing any commit comment, in either mode — on an
incident carrying `commentable` or `provable`. The rules SKILL.md §4 states inline hold whatever this file says.
§ numbers are those of SKILL.md.

The target is **the commit on GitHub**, never the PR (merged and irrelevant) and never JIRA — with
one exception, the quality gate: there the issues were introduced in a squashed PR whose author and
reviewer are both still subscribed to it, and that review is where the gate would have been caught,
so `commentable` names the PR when the commit had one and the commit when it did not. Pass it with
`--pr <number>` instead of `--sha` (same tool, same marker, same "already said" check).

**At most one comment per commit per run.** When two incidents blame one commit — typically a gate
whose PR squashed into the commit a build break blames — the sweep gives `commentable` to one of
them, lists the others in its `covers`, and marks each of them `commentedWith` it; the target is
then the commit, which every incident's "already said" check reads. Write **one** body that names
every failure it answers, each with its own tier's wording, and post it once, on the carrier: the
tool adds one marker per incident it covers, and refuses a comment for a `commentedWith` one.

**The tier is the tool's candidate; the causal link is yours to establish.** `certain` and `likely`
come from mechanical matches (a file touched, a library named), and a match is not a cause. Read the
culprit's diff against what the failing test does and where it fails, and write **one sentence
naming the concrete link** — *"this commit changed `X`, which the failing step calls at `Y`"* —
which goes in the comment. If you cannot, there is no comment: the incident is *no owner found*, and
the paste says why the candidate was dropped. You may downgrade a tier this way.

## Proving a culprit the tool could not pick (`provable`)

File overlap is conservative: two commits touching one module is `ambiguous`, even when the failure
names lines only one of them wrote. A deep incident in that state carries `provable.suspects`, and
**finding which one did it is your job**, not a reason to stop. Pick among those suspects only —
never anyone outside the window, never on who pushed that day — and with one of three proofs, which
set the wording as a tier would:

| `--proof` | What you established | Wording |
|---|---|---|
| `reproduced` | the failure reproduces with the commit and not at its parent (or a bisect over the suspects lands on it) — cheap for a build break: one module's build | **state it**, as `certain` |
| `in-diff` | the file *and* line or symbol the evidence names are in this commit's diff, and in no other suspect's | **state it**, as `certain` |
| `diff-link` | a reading of the diff: what it changed is what the failing step uses | **ask**, as `likely` |

```bash
node <skill>/tools/commit-comment.mjs --work-order work-order.json --incident "<incident.id>" \
  --sha <suspect sha> --proof in-diff --why "<the one sentence linking the diff to the failure>" \
  --file body.md [--write]
```

**`provable.sameBuildAs`**: a build break whose own history holds no green build borrows the window of
the test that first failed in the same build of the same job — the break is the one cheap to
reproduce, so it carries the comment, and that test is in `covers`, answered by the same body. When
that test is `commentable` instead, the break is `commentedWith` it: name the break in that comment
only if your analysis links it to the same commit.

The tool refuses a sha that is not a suspect and a comment without `--proof` and `--why`, and prints
the proof under the body — the person it names sees what it rests on. When no proof holds, the
incident is *no owner found* and the paste says which suspects you ruled out and how.

**The same proofs raise the tool's own `likely` pick.** When the incident is `commentable` at
`likely` and you reproduced the failure at its commit and not at its parent, pass `--proof` and
`--why` with that commit's sha: the comment may then state the cause. A quality-gate comment stays
`likely` whatever is proven.

**And they replace it**: when the incident also carries `provable` with `instead` (its pick), a
`reproduced` or `in-diff` proof on another of its suspects moves the comment to that one.

The tool attributes nothing to a test with an open or closed flicker issue (`jira`, `jiraClosed`),
or to a `single env` failure that passes in some builds — unless it is now `systematic`: then treat
it as a breakage and say in the comment that the issue no longer describes the test.

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
tier — or the proof — is the whole of that difference, so never word a comment beyond it.

Keep the comment short and self-contained: what is failing (the test count, not forty names) and on
which branches (`alsoOn`), since when, the evidence line, the build URL, and what you are asking
for. Say nothing about being a bot — the tool appends that, and the line telling the reader they may
ignore a wrong attribution is not one to leave to the wording of the day. Then post it — this tool
and nothing else, because its marker is what makes tomorrow's run stay quiet:

```bash
node <skill>/tools/commit-comment.mjs --work-order work-order.json --incident "<incident.id>" \
  --sha <commentable.sha> --file body.md [--write]        # --pr <commentable.pr> for a gate
```

**Without `--write` it prints the comment and posts nothing** — that is the default, so the flag is
what a live routine adds and what a local run adds only after the developer has said yes. It
re-checks for a prior comment before posting and reports `not posted: already commented` as a
normal outcome, and `not posted: <why>` for a target the work order does not make `commentable`. A prior comment in a *different* state posts again — a flicker that has become a
systematic breakage is news.

The comment is the bot's, never a developer's (§0): a developer whose commit broke master must not
receive what looks like a personal reprimand from a colleague, and a wrong attribution must not be
wrong in someone's name.

Why a `primary: false` incident gets no comment of its own: treating four of them costs four of the
five deep slots to reach one conclusion, and comments four times on what is one person's one
mistake.