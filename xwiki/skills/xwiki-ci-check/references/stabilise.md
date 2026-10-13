# The flicker-stabilisation draft PR

Read by `xwiki-ci-check` (SKILL.md §5) when `summary.stabilise` names an incident, before invoking
`xwiki-fix-flickering-docker-test` for it — in a local run, once the developer has said yes to
starting. § numbers are those of SKILL.md.

| Field | Meaning |
|---|---|
| `stabilise` | the **one** flicker this run may try to fix (§5), and it carries its evidence and its `develocity` history whether or not it won a deep slot. `summary.stabilise` holds it, or the reason there is none — most often that something release-blocking is open |

**What blocks a release comes first, and this is where that ordering is enforced.** A compile break,
a broken pom, a failing quality gate or a test that now fails in *every* build is red for everyone
and no re-run clears it; a flicker costs whoever hit it a re-run and blocks nobody. So the sweep
offers a stabilisation candidate **only on a morning with none of the first open** — `stabilise` on
exactly one incident — and otherwise `summary.stabilise.skipped` names what held it back. The pick
is the tool's, and it is not yours to override: never stabilise a flake while a break is open, and
never promote a second candidate because the first looked hard.

The candidate is a flicker that is `proven`, already **filed** (it has a `jira`), answered by
nothing (`fixState` null), inside the horizon, and not `systematic` — and, among those, the one that
fails most often: it costs the most re-runs, and its recent failures are the ones whose screenshot,
video and logs Jenkins still holds.

Then, and only for that one, run `xwiki-fix-flickering-docker-test`, which owns the procedure:
evidence, a hypothesis from the test and production code, an experiment that forces the race, the
fix. Whether to also measure an unforced local rate is that skill's call, not a gate here.

1. **Evidence comes from the work order.** `develocity` carries the history, the failure group, the
   configurations it concentrates in and the archived screenshot and video; reproduce on the
   incident's own branch, with the browser, database and servlet container the failure concentrates
   in.
2. **Bound the loop.** At most three hypotheses, each with its experiment. A routine has nobody to
   say "enough", and a fourth guess on the same evidence is rarely better than the third.
3. **The fix stays clear of Tier C's assertions, expected values and timeouts** — those hide a
   flicker rather than fix it. A confirmed race in **production code** is the exception to Tier C's
   last line: the experiment is the proof Tier C otherwise lacks, so the draft fixes it there and
   says so first in its body. Such a fix is a **product bug** and needs its own JIRA issue, which
   this routine **does not file**: the PR body says a committer must file it before merging, and
   carries the bug description the skill's step 4 asks for. The comment on the flicker issue that
   names the PR repeats it.
4. **Open the PR on proof, and only on proof** — the skill's step 3 red with the CI symptom, then
   its step 4 green, unforced included. A hypothesis confirmed **only in isolation** is weaker proof
   but still proof: the draft is opened, and says so in its first line. No confirmed hypothesis, or
   a fix the experiment does not turn green, means **no PR**: the evidence, each hypothesis and what
   its experiment showed go as a comment **on the flicker issue**, where the next attempt — this
   routine's or a developer's — starts from them instead of from zero. That comment is where the
   routine asks the question the skill would ask a developer: it names the hypothesis it considers
   most likely, why, and what would confirm it.

The PR is **draft**, **unassigned** (a flicker usually has no culprit, and a wrong auto-assignment
discredits the whole system), opened by the bot like any other — `pull-request.mjs --draft` with no
`--assignee` — and its subject is the issue's key and its title verbatim, per
`xwiki-pull-request`. Its body carries, and a reviewer should not have to ask for any of it:

- the **mechanism** in two or three sentences — what races with what, and why it fails on the
  configurations it does and spares the others;
- the **experiment**: the temporary patch that forces the race, inline, so a reviewer can re-run it
  (or, for a reliable local reproduction, the command and configuration; for an isolated one, the
  test), what it makes happen and why that is reachable without it, and the runs as a table —
  unchanged code *red n/m with the CI symptom*, fixed code *green*, each with its count and the
  configuration it ran on, plus the fixed code unforced green when the experiment was forced or
  isolated;
- the **Develocity breakdown** from `develocity` — the 28-day rate, the day the failure started, the
  configuration it concentrates in with its p-value, and the build scan — quoted, never reworded;
- plainly that the local runs **do not reproduce CI's timing** and that **the ITs were not run in
  CI**: Jenkins does not build PRs, so CI after the merge is the final confirmation, and
  `develocity` says how many clean runs it takes;
- a link to the flicker issue, and one comment **on that issue** naming the PR — a draft PR assigned
  to nobody is otherwise invisible to the person who owns the flicker.

This PR does not consume the two mechanical fix-PR slots of §5: it is different work, at a different
price, and both together are still at most three PRs from one run. On a laptop it is the one write
to **ask about before starting** rather than after — the experiments hold port 8080 and a slice of
the Docker daemon for up to an hour — and, like every other PR from a local run, it is opened
under the developer's own name.

Related:

- `xwiki-fix-flickering-docker-test` — how a flicker is actually stabilised: the evidence, the
  hypothesis and the forced experiment the draft PR of §5 is opened on.
  This skill decides *which* flicker and *when*; that one does the work.
