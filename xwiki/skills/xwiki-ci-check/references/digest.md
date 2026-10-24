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

## Rendered, then filled

**Routine only.** One short message: a headline, the status grid, a table of at most ~5 rows, and
the PrivateBin paste holding the detail. Everything under the grid is a **delta** against what the
last digest carried — the room is the ledger, each digest carrying its incident states in a marker
no client shows:

```bash
node <skill>/tools/matrix.mjs --last-state > previous.json                        # read-only
node <skill>/tools/ci-check.mjs --delta work-order.json --previous previous.json > delta.json
node <skill>/tools/ci-check.mjs --render-digest work-order.json --previous previous.json \
  --paste <the PrivateBin URL> > digest.md
```

The tool writes the shape, because a digest re-invented every morning drifts from the dashboard it
summarises: the grid pasted from `status.grid` (🔴 cannot be released as it stands, 🟠 red of any
other kind, 🟢, ⚪ no build), `new`, `changed` and `fixed` one row each with its age and its links (a `new` row whose test
Develocity saw failing before today is marked 🔁, not 🆕, and aged from that first failure),
one row per cause whatever its branch count, rows chosen as a break with an owner first, then a
break without one, then what moved, then what went green — **the line the dashboard can never show**
— with `same` and `beyondHorizon` collapsed to counts, except a release blocker that has not moved,
which keeps a ⏳ row every morning until it is fixed (`stuck`), however old; the row of every
`fixState.fromChat` incident kept whatever else is cut, and the full-snapshot line when the room
could not be read. Leave all of that as it is, and fill or delete the markers:

| Marker | What replaces it |
|---|---|
| `<!-- PASTE -->` | the paste URL, if `--paste` was not given; on a silent morning it lives in the run log alone |
| `<!-- DONE: <id> -->` | what this run did: `[commented](<comment URL>) on [<sha>](<url>) (<login>)`, `no owner found`, `[issue filed](<url>)`, `[commented on <KEY>](<url>)`, `fix in flight` once a candidate PR is confirmed, the `prove` result (`reproduced at <sha>`, `not reproduced`) — one clause; on a `commentedWith` row, the same comment as its carrier's; on a deep row nothing was written about, the owner the paste's *Next* names (`<who> → <what>`, one clause) — `no owner found` only when it names nobody, since the room reads the digest and the paste as one story |
| `<!-- STABILISE: … -->` | the row of the stabilisation PR §5 opened, or nothing |
| `<!-- SILENT: … -->` | see below |

- **`SILENT` means post nothing at all** — no digest, no green line, no "still 3 red". A morning
  that moved nothing, with nothing blocking a release, is a morning the room does not need to hear
  from: the correct outcome, not a missed run, and the terminal report says so. The paste and the
  commit comments still run.
- **A stabilisation PR is news, and it makes the morning non-silent.** The one thing here a
  dashboard could never print is a fix, so it gets its row — *"→ draft fix for `ImageIT#editImage`:
  forced race red 4/4 → green 4/4 on Chrome, XWIKI-24749"* — and nothing else about that flicker is
  repeated.
- **The security-only line is never in the digest.** `okf/processes/release.md` forbids naming it
  in a public artifact, and the room is one: `--render-digest` and `--delta` leave it out — its grid
  column, its rows, its `alsoOn` entries and its state — and name it in `delta.json`'s `withheld`,
  which is how `matrix.mjs --state` refuses a digest that names it after all. The paste and the
  terminal report are internal and keep it.
- **A name is a GitHub login, never an address**: a quality-gate row names *whose code* is under the
  failing condition from `sonar.culprits`, never *who broke it*, and `matrix.mjs` refuses a digest
  holding an email address.
- **A `fixState.fromChat` row is the routine's reading of the room going back into it.** Every other
  value suppresses on a fact; these suppress on a *sentence*, and the person who wrote it is the one
  reader who can say it was misread. Never collapse it into the `unchanged` count.
- **Cite the room where it explains an incident** — the tool adds the newest `chat` permalink to a
  row's *Done* cell. One clause, never a quotation. On a morning when nothing moved but the
  conversation, a row for that incident is still worth adding by hand.

Why the horizon is 7 days: feedback is only feedback while it is actionable; after a week it is
archaeology and the team already knows.

```bash
node <skill>/tools/matrix.mjs --file digest.md --state delta.json --write
```

**`--state delta.json` is not optional**: without it the digest carries no state forward and
tomorrow's run has nothing to compare against — so tomorrow says everything again.

A routine run adds to its terminal report the delta it measured — how many incidents were new,
changed, fixed and unchanged — and, on a silent morning, that the digest was withheld because
nothing moved.
