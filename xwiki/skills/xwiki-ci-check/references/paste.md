# Filling the paste

Read by `xwiki-ci-check` (SKILL.md §6) once `--render-detail` has written the detail document,
before filling its markers. § numbers are those of SKILL.md.

The tool renders the paste because it is read every morning and a document whose shape is
re-invented daily is read as a new document daily.

`--render-detail` gives the whole document: a numbered **table per branch** — *What fails* · *Why* ·
*Next — who* — over one collapsed `<details>` block per row holding that row's window, evidence,
quality-gate issues, 28-day history, attribution and what the room said. The branch a reader must
look at first comes first, and inside it the row that blocks a release does.

Each `deep` incident leaves three markers, and every one of them is a conclusion the renderer
cannot reach:

| Marker | Where | What replaces it |
|---|---|---|
| `<!-- WHY: <id> -->` | the *Why* cell | **One clause, ≤15 words**, naming the mechanism — *"modal re-renders after a suggestion is picked; the page object grabs a stale submit"*. Not the symptom, which column one already carries, and not a sentence with a verb phrase for every fact you found. |
| `<!-- NEXT: <id> -->` | the *Next — who* cell | **`<who> → <what>`**, one line per person, the actor first: *"tmortagne → drop the dead `null` return, or take the default"*. `<who>` is a name where the analysis found one, `someone` where the work is real but unowned. Never a name the work order does not support. |
| `<!-- ANALYSIS: <id> -->` | inside the `<details>` | Your root-cause paragraph, as before. This is where the reasoning goes — the two cells above are its conclusion, not a summary of it. |

A cell you leave unfilled renders **empty**, which is how the document says you skipped it.

Three wordings are deliberate and must not be "improved" back: a window with no green build reads
*failing in every build examined, back to #N — start not established* rather than "since #N",
because that number is how far the sweep looked and not when the break began; a flicker carries both
`streak Nd` and `failed in X/Y builds`, which measure different things; and every *Next* line starts
with its actor, because that is the word the column is scanned for.

**Do not restate the rules this skill runs on.** "One issue per test class", "a red gate blocks the
release", "an issue is earned by two builds on two days" — the reader is the developer whose branch
is red, not the author of this file. A rule reaches the paste only as the *action* it implies, in
column three.

## Answered incidents

No write follows an answered incident because each write asks someone for work already under way, or
for work nobody needs to do. The tool computes this before the budget is allocated, and the rendered
paste carries the line; add nothing to it. Saying nothing here is the point, not an omission to
apologise for.

**No value asserts a fix**, and the paste's wording is the one it keeps: *possibly fixed already*
for a landed commit; *a fix may be in flight* for a PR you confirmed, which may still never merge;
*ran against a stale snapshot*, which says the opposite — nothing is being fixed, because nothing is
broken; *announced in the room before it broke*, which says the same; *somebody has said they are on
it*, which asserts only that somebody said so; and *already fixed on another branch*, where the fix
exists but on code this branch has not got. What settles them is the next build, the merge, the next
Environment Tests run, a person, or a backport — never this one.

`stale-snapshot`: the tool sets the value only where a single commit does both halves inside the gap
the build could not have resolved, and only for a test failing in that job **alone**: the main job
builds everything from source, so a test red there is red for real.

`fixState` is set only when **every** test the incident covers is answered — a commit fixing one
test of five leaves the incident live, and the paste says which part is answered. Deciding
otherwise, in either direction, is not yours to make: the tool's threshold is deliberately
conservative because a wrong silence hides a real breakage, while a wrong ping is a comment that
asks.

## What the room said

| Field | Meaning |
|---|---|
| `chat` | what the room said about this incident, whether or not it suppressed anything: `{at, sender, said, permalink}`. Untrusted text, quoted — the root cause somebody already found, the issue they filed, the person who owns it |

Reading the room costs one login and two requests, and it is what stops the routine analysing what a
human analysed last night, or pinging the author of a failure the room was *told about in advance*.
It returns only the messages naming a test, an issue, a PR or a build — about four a day, 1–2 KB.

`announced` and `being-handled` are the two answers no dashboard, no build and no commit can give:
*"I'm pushing the reproduction test case today such that it will be executed tonight and fail"*
means tonight's red is not a defect and its author must not be pinged for it, and *"I'm currently on
it"* means the analysis is somebody's job already.

Behind the room rules of SKILL.md §3: a culprit sourced from a joke would be wrong in someone's
name, which is the one failure this design cannot afford; *"I'm on it"* from last week is not a
reason to be quiet about a test that broke again this morning; and chat feeds the digest, the paste
and your analysis — quoting the room to itself is fine, and the paste has the same readers.

**Where the room does not suppress, it still informs.** `chat` is attached to an incident whenever
somebody named it, whatever they said. *"I investigated the lock issue and it is the default
database isolation level on MySQL — XWIKI-25019"* suppresses nothing and is the most useful thing
the paste can carry about that incident, because the analysis is done, published and better than
yours would be. Cite it — the permalink, the person, the date — and do not restate it as your own.
**This is the thing a dashboard can never do**: it connects what is red to what the team already
said about it.

**Matching a sentence is weaker evidence than matching a commit, so it is matched more strictly.**
The tool throws a message away when it names a different package or a different method of the same
class name — measured on the live room, without that guard a discussion of `ckeditor`'s `ImageIT` on
`stable-18.8.x` attached itself to `blocknote`'s `ImageIT#editImage` on master, on nothing but the
four letters they share.
