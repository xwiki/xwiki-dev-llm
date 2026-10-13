# Writing and posting the commit comment

Read by `xwiki-ci-check` (SKILL.md §4) before writing any commit comment, in either mode — once
SKILL.md §4's skip conditions have left an incident to comment on. The rules SKILL.md §4 states
inline hold whatever this file says. § numbers are those of SKILL.md.

The target is **the commit on GitHub**, never the PR (merged and irrelevant) and never JIRA — with
one exception, the quality gate: there the issues were introduced in a squashed PR whose author and
reviewer are both still subscribed to it, and that review is where the gate would have been caught,
so `sonar.target` names the PR when the commit had one and the commit when it did not. Pass it with
`--pr <number>` instead of `--sha` (same tool, same marker, same "already said" check).

**The tier is the tool's candidate; the causal link is yours to establish.** `certain` and `likely`
come from mechanical matches (a file touched, a library named), and a match is not a cause. Read the
culprit's diff against what the failing test does and where it fails, and write **one sentence
naming the concrete link** — *"this commit changed `X`, which the failing step calls at `Y`"* —
which goes in the comment. If you cannot, there is no comment: the incident is *no owner found*, and
the paste says why the candidate was dropped. You may downgrade a tier this way, never upgrade one.

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

The comment is the bot's, never a developer's (§0): a developer whose commit broke master must not
receive what looks like a personal reprimand from a colleague, and a wrong attribution must not be
wrong in someone's name.

Why a `primary: false` incident gets no comment of its own: treating four of them costs four of the
five deep slots to reach one conclusion, and comments four times on what is one person's one
mistake.