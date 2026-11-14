# Weekly KB batch routine

The prompt of the weekly scheduled Claude routine that grows the KB by one measured batch of the
dev.xwiki.org facts in `eval/backlog.json`. The routine's config says only "follow
`scripts/kb-batch-routine.md`", so this file *is* the prompt: changing what the routine does is a pull
request here. It is separate from `scripts/consolidation-routine.md` because a batch runs for about an
hour, costs tens of dollars and must fail on its own.

The procedure and its gate are `eval/README.md` → "KB batches"; this file adds only what an unattended
run needs on top. Where the two seem to disagree, follow the README and say so under `## Routine notes`.

## The task

You are in a checkout of `xwiki/xwiki-dev-llm` on `master`. Read `CLAUDE.md` and `eval/README.md`
first: their conventions bind every change. Never merge, approve or close a PR, never push to `master`,
never edit dev.xwiki.org or another repo, never change a version field. Edit no script, tool, test or
this file: a gap you hit in them goes under `## Routine notes`, written as the exact edit.

### 1. Environment

- xwiki-commons, xwiki-rendering and xwiki-platform are shallow clones next to this checkout: find
  them, assume no path. `run.mjs --code-dir` adds *every* directory of the one it is given, so give it
  one holding only those three (symlinks). The xwiki-dev-llm checkout must never be in it: the backlog
  there states the facts being measured. Delete any `CLAUDE.md`, `AGENTS.md` or `.claude/` in the clones
  first.
- Nested `claude -p` sessions run without an API key. A foreground shell command is stopped at 10
  minutes: run every `run.mjs`, `judge.mjs` and `gen-metadata.mjs` stage in the background with its
  output in a log, and wait for it to end. Both eval tools resume, so rerunning a stage after an
  interruption does only what is missing.
- Maven and Docker are not available: a fact is checked by reading the code in the clones.
- GitHub is reached over REST only, as in the consolidation routine's step 1.

### 2. Decide whether to run at all

- **A batch PR is open** (title starting `[Misc] Weekly KB batch:`): stop, open nothing. One
  unreviewed batch is the limit.
- List the other open PRs and their files (consolidation step 1): a `kb_target` one of them touches,
  or whose `_meta` sidecar or index entry it touches, is not picked this week.
- Read the batch PRs closed in the last 8 weeks, body and comments, inline ones included. Each fact of
  one closed unmerged was declined: this run's PR sets it `dropped`, "declined in <PR URL>" plus the
  committer's reason when given. It is never measured again.

### 3. Pick the batch

About eight `candidate` facts from the top of `backlog.json`, aimed at one or two `kb_target`s: the
first eligible entry's target, plus the next target when the first has fewer than four candidates.

### 4. Verify each fact before writing its question

- **Against the current page.** Read the page now and at the entry's `sources.version` (REST: the
  page's `history/<version>`; `kb-sources.mjs --diff` only diffs from a pin). When the cited section
  changed, take the fact as the current version states it, and that version from then on.
- **Against the code.** A page that contradicts the code is not a KB fact: `dropped`, with the class or
  file that shows it, and the page fix listed under `## For a committer`. A page that is partly wrong
  keeps the fact as the code states it, and its gold says so (README, "Gold checked against the code").
  Batch 1 had a stale page as gold: its fact scored 0 against a model that was right.
- **Against this repo.** A fact a KB topic or skill already states is `dropped`, "already in
  <file>#<section>". A claim that another file here is wrong is checked on `origin/master` before it is
  reported: batch 1 reported one that was already fixed.

### 5. Write the questions

As the README says, into `eval/questions/e-<slug>.json` (ids `e01`…): only that directory is hidden
from the sessions, so the file is there before any run. A first draft can aim at a side detail of its
excerpt instead of the fact (batch 1: two of fifteen): check that each question's key points are the
fact, and regenerate it on a tighter excerpt when they are not.

### 6. Baseline with the code, then write

- The README's baseline gate, plugin from `origin/master` by `git archive`, with the newest Opus by its
  full model id; use that same id for every group (e) run. `analyze.mjs --base <r1>,<r2>` marks the
  questions at 3 in both runs: those facts are `dropped`, "findable in the code (3, 3)".
- Write the survivors per the README's "Write" bullet and CLAUDE.md's rules: one home per fact, a budget
  raised only under its three tests, stated in the PR body. None survives: go to step 9.
- Run the checks of the consolidation routine's step 5 that apply (the `--lossless` one does not: a batch
  adds facts), with `recall.mjs` on groups (a) and (e), `origin/master` against your branch. A failure
  already on `origin/master` is not yours: name it.
- Give one fresh sub-agent the diff, the questions file and the verified page excerpts, not your
  reasoning, and ask it read-only for: a question not testing its fact, gold that the code contradicts,
  KB text copying upstream detail or stating a fact twice, a fact placed where its readers do not look.
  Apply or drop each finding, rerun the checks. One round, before the comparison is paid for.

### 7. Compare and gate

Exactly the README's "Compare" bullet: three runs per side, read with `analyze.mjs`. A missing or
ungraded record means rerunning that stage; `--allow-missing` is never used for the gate. A session that
still fails after two reruns leaves the gate unreadable: treat it as failed, saying why. Measure once:
KB text retuned against these questions and measured again is fitted to them, not better.

### 8. Cost

At most **$80** per run. Sessions record their cost (`analyze.mjs` sums it); judge and `gen-a.mjs` calls
do not, so count about $0.08 per Opus call. Batch 1, with seven survivors, cost about $10 for the
baseline and $33 for the comparison, of which the (a)+(d) half does not shrink with the batch. Before
each stage, add its projection to what is spent; over the cap, do not start it: shrink the batch first
when that is enough (before the baseline), otherwise stop there. A stage not run lands nothing.

### 9. Open the PR — or not

- **Gate passed:** branch `claude/kb-batch-<YYYY-MM-DD>` from `origin/master`, one commit with the author
  the routine's trigger gives, message:

  ```
  [Misc] Weekly KB batch: <the facts, in a few words>

  * <one line per file: what it gained, or the backlog/questions change>
  ```

  It carries the KB edits with their pins, sidecars, index and budget entries, the questions file, and
  the backlog status of every fact this run settled: `done` with its `<file>#<section>`, `dropped` with
  why. Push to `xwiki/xwiki-dev-llm` itself (no fork) and open the PR over REST, as the consolidation
  routine does. The body, short: the `analyze.mjs` tables of groups (e), (a) and (d) with the paired
  differences; the dropped facts and why; the model id and the three clones' commits; the cost (recorded
  plus estimated); `## For a committer` (upstream page fixes, findings elsewhere in the repo) and
  `## Routine notes` when there are any; the validator results in one line.
- **Gate failed, or a stage could not run:** no KB edit is proposed. When this run settled facts —
  declined, dropped in step 4 or 6, or written and failing the gate — open the same PR with only the
  backlog statuses, titled `[Misc] Weekly KB batch: backlog only, <why>`, its body the failing
  `analyze.mjs` output. A fact that failed the gate is `dropped` with its numbers ("no gain: (e) CI
  [x, y]" or "regressed (a) …"): a committer sets it back to `candidate`, with a placement hint, to
  retry it. Without this PR the next run, which picks from `backlog.json` alone, would pay to measure the
  same facts again. Nothing settled: open nothing.

### 10. Run log

End with what a committer reading the session needs, in this order: the PR URL or why there is none;
one row per picked fact — backlog id, outcome (landed in `<file>#<section>`, dropped and why, or not
reached), baseline and branch scores; the gate verdict with its numbers; the cost per stage and in total;
the model id and the clones' commits.
