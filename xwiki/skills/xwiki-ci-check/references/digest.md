# The Matrix digest

Read by `xwiki-ci-check` (SKILL.md §6) before building the digest: in `--write` mode every morning,
a 0-incident one included, and in the routine's dry run, which prints it instead of posting. A local
run never posts one. § numbers are those of SKILL.md.

**The Matrix digest is never local, even if asked.** It is the one broadcast here: it lands in the
team's room with no addressee and no undo, and it is the *routine's* own output — a second digest
arriving at 14:00 from someone's laptop turns the room's record of CI into a record of who ran the
skill. Everything else this skill writes has a single addressee or a single owner, is marked as
machine-written, and is closed in a click.

**There is no ledger file.** A routine gets a fresh sandbox every morning, so a local state file
would be empty every morning. Every field of the work order (SKILL.md §2) is recomputed from a
durable system — Jenkins for the symptoms and the age, JIRA for the known flickers, **the Matrix
room** for what was said and for what the last digest carried, and **the comment left last time**
for "already notified". Running the skill twice, or by hand from another machine, changes nothing.

`node <skill>/tools/matrix.mjs --whoami` says which account will post, and is the cheap way to find
a dead token before the digest is due.

| Field | Meaning |
|---|---|
| `fixState.fromChat` | the answer is a *sentence* — said in the room or on the issue — not a commit, a PR or a timestamp. Suppresses the analysis and the writes like the others, but **never the digest line** (§6) |

**Routine only.** Post **one short message** to the Matrix room: a headline, the status grid, a
table of at most ~5 rows, and the PrivateBin paste holding the detail.

**One glance, then the delta.** A reader must see how red CI is before reading a word — otherwise
the dashboard's colours are faster, and they stop reading the digest. So the digest opens with the
one snapshot it carries, the **status grid**: a repo × branch table of 🔴 (cannot be released as it
stands — a build break, a failing gate, a test failing every run), 🟠 (red of any other kind) and 🟢,
⚪ for no build. It is `status.grid` from `--delta`, **pasted as is**: a colour chosen by hand drifts
from the dashboard it summarises. Everything under it is a **delta** — ask the room what the last
digest was, and say only what has moved since:

```bash
node <skill>/tools/matrix.mjs --last-state > previous.json                        # read-only
node <skill>/tools/ci-check.mjs --delta work-order.json --previous previous.json > delta.json
```

The room is the ledger — each digest carries its own incident states in a marker no client shows —
so this needs no state file and survives the sandbox being new every morning.

- **`silent: true` means post nothing at all** — no digest, no green line, no "still 3 red". A
  morning that moved nothing is a morning the room does not need to hear from. This is the correct
  outcome, not a missed run: say so in the terminal report, where it costs nobody anything. The
  paste and the commit comments are unaffected and still run — they cost the room nothing — and on a
  silent morning the paste URL lives in the run log alone.
- **A stabilisation PR is news, and it makes the morning non-silent.** The one thing here a
  dashboard could never print is a fix, so when §5 opened one it gets its own row — *"→ draft fix
  for `ImageIT#editImage`: forced race red 4/4 → green 4/4 on Chrome, XWIKI-24749"* — even on a
  morning where nothing else moved and the digest would otherwise be withheld. Nothing else about
  that flicker is repeated: it was already red yesterday, and the PR is the whole of the news.
- List `new`, `changed` and `fixed`, one table row each. **`fixed` is the line the dashboard can
  never show**: it says what went green, and it is the only place anyone learns that.
- Collapse `same` to a count, and `longStanding` (beyond the horizon) to `+N long-standing`.
- **A quality-gate row names what failed it and whose code is under it** — *"sonar gate red on
  master — reliability of new code is C: 1 blocker in `RepositoryManager.java`, 2 issues in
  `comments.js` (lcharpentier)"*. Take the names from `sonar.culprits` and nothing else, and let the
  line say *whose code*, never *who broke it*.
- **Where a row has a Develocity fact, it carries it, in one clause.** *"6/347 over 28d, Chrome
  only"* or *"first failed 2026-08-25, not in tonight's window"* is the other half of the answer to
  "the dashboard is faster": the dashboard has tonight's red square, and no dashboard has the 28-day
  rate, the configuration the failure concentrates in, or the day it started. Take the clause from
  `develocity` — never restate a p-value in your own words, and never put one on a row the field
  does not support.
- `previous.available: false` — the room could not be read — classifies **nothing**. Fall back to
  the state snapshot of every incident and **say so in the last line**: *"(could not read the last
  digest — this is a full snapshot)"*. A routine silenced by a failed read is indistinguishable from
  a green morning, which is the one way this may not fail.

```
🔴 CI 2026-09-18 — 1 new, 2 changed, 2 fixed · detail → https://bin.xwikisas.com/?abc#key (1 week)

| | master | 18.8.x | 18.4.x | 17.10.x | 16.10.x |
|---|:-:|:-:|:-:|:-:|:-:|
| platform | 🔴 | 🟢 | 🔴 | 🔴 | 🟠 |
| commons | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| rendering | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |

| | Branch | What | Age | Done |
|---|---|---|---|---|
| 🆕🔴 | platform/master | checkstyle break → [a1b2c3d](https://github.com/xwiki/xwiki-platform/commit/a1b2c3d) (jdoe) | 0d | [commented](https://github.com/xwiki/xwiki-platform/commit/a1b2c3d#commitcomment-1) |
| 🔄🔴 | platform/18.4.x+17.10.x | `AllIT#foo` flicker → systematic since #412 | 4d | no owner found |
| 🔄🟠 | platform/master | `ImageIT#editImage` | 1d | quiet: announced by jdoe before it broke |
| ✅ | commons/16.10.x | docker rate limit | — | green since #221 |
| ✅ | platform/master | `DocExtraTabsIT` | — | [discussed 09-17 17:34](https://matrix.to/#/!room/$event) (asmith), [XWIKI-25019](https://jira.xwiki.org/browse/XWIKI-25019) |

… 3 unchanged · +12 long-standing
```

The headline opens with `status.worst`, the grid's worst cell. The first cell of a row is `🆕`, `🔄`
or `✅` for new, changed and fixed, followed on the first two by the row's `dot` from `--delta` — the
same colours as the grid, so a 🔴 row is the reason for a 🔴 cell. `matrix.mjs` posts a pipe table as
an HTML table, which Element renders; the Markdown stays in the plain body a bridge relays. Keep a
cell to a clause: a table is scanned, and a wrapped cell is read.

Incidents with `beyondHorizon` are **aggregated into a single `+N long-standing` count**, never
listed — the grid still shows their colour. The rows are chosen, not rendered: a break with an owner
first, then a break without one, then what moved; the paste carries the rest. Every row names the
branch, what is broken, since when, and what was done about it (`commented`, `no owner found`,
`issue filed`, `tracked`, `likely fixed, unbuilt`, `fix in flight`, `backport candidate`). **Every
line still carries its age** — a `changed` incident that broke four days ago is not four days of
news.

Why the horizon is 7 days: feedback is only feedback while it is actionable; after a week it is
archaeology and the team already knows.

**One cause is one row**, whatever the branch count: incidents whose `primary` is `false` are the
same signature elsewhere, so their branches join the primary's row (`platform/18.4.x+17.10.x`) and
never take a row of their own. A `fixed-elsewhere` incident names the sha and what to do with it —
*platform/18.4.x `VersionIT` systematic (1d) — fixed on master by `a1b2c3d`, backport candidate*.

An incident whose `fixState` appeared today is `changed`, and it earns that row and nothing else —
it is the one row that stops a reader who has just pushed the fix, or opened the PR, from opening
the paste to find out whether the routine noticed.

**A `fixState.fromChat` incident always gets its row, whatever else is cut.** Every other value
suppresses on a fact — a commit, a PR, a timestamp — but these two suppress on a *sentence*, which
is softer, so the routine's reading of the room goes back into the room: *"`ImageIT#editImage` —
quiet, announced by jdoe before it broke"*. The person who wrote the sentence is reading that line
and is the one reader who can say it was misread. Never collapse it into the `unchanged` count.

**Cite the room where it explains an incident**, suppressed or not — *"`ConfigurableClassIT` —
discussed 09-17 17:34 (asmith), XWIKI-25019"*, with the matrix.to permalink from `chat`. One clause,
never a quotation: the link is there for anyone who wants the sentence. This is the half of the
digest the CI dashboard cannot compete with, because it joins what is red to what the team said
about it, and it is worth a line even on a morning when nothing moved but the conversation.

```bash
node <skill>/tools/matrix.mjs --file digest.md --state delta.json --write
```

**`--state delta.json` is not optional**: without it the digest carries no state forward and
tomorrow's run has nothing to compare against — so tomorrow says everything again.

A routine run adds to its terminal report the delta it measured — how many incidents were new,
changed, fixed and unchanged — and, on a silent morning, that the digest was withheld because
nothing moved.