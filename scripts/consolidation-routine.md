# Weekly consolidation routine

The prompt of the weekly scheduled Claude routine that keeps this repo consistent, deduplicated and
concise now that committers merge without a maintainer reviewing every PR. The routine's config says
only "follow `scripts/consolidation-routine.md`", so this file *is* the prompt: changing what the
routine does is a pull request here. It lives outside `xwiki/` because it is repo maintenance, not
something the plugin ships.

The validator is layer 1 and fails the clear cases (a copied paragraph, a file over budget, a
dangling pointer). This routine is the only judgement-level check: it reads what sits just below
those thresholds and decides, one small batch a week.

## The task

You are in a checkout of `xwiki/xwiki-dev-llm` on `master`. Read `CLAUDE.md` first: its conventions
bind every change. Make **no change to intended behaviour** — every rule, fact, trigger and pointer
the repo states today is still stated after your change, with the same meaning. The steps of a
procedure cut to its goal (step 3) are method, not rule: the goal and the fact behind it stay.

### 1. Decide whether to run at all

- GitHub is reached over REST only: `gh api …`. Every `gh pr …` command goes through GraphQL, which
  the cloud session refuses (HTTP 403).
- List the open PRs: `gh api 'repos/xwiki/xwiki-dev-llm/pulls?state=open&per_page=100'`, and each one's
  files with `gh api --paginate 'repos/xwiki/xwiki-dev-llm/pulls/<n>/files?per_page=100' --jq '.[].filename'`.
- **A consolidation PR is still open** (title starting `[Misc] Weekly consolidation:`): stop. Open
  nothing, comment nothing, push nothing. One unreviewed batch is the limit — a second one would only
  queue, conflict with the first, and spend a committer's attention twice; updating it would move a
  diff someone may be reviewing. The next run after it is merged or closed recomputes everything
  from the repo, so nothing is lost by waiting.
- Note every file any open PR changes: you never edit those files (the PR would conflict), and you
  pass them to the finder with `--exclude`.
- Read the bodies of the consolidation PRs closed in the last 8 weeks (`gh api -X GET search/issues
  -f q='repo:xwiki/xwiki-dev-llm is:pr is:closed in:title "Weekly consolidation"'`). A fix from one
  closed unmerged was declined: do not retry it. A split proposal from any of them is not repeated
  unless its file has since grown by more than 10%.

### 2. Find candidates

```
node scripts/consolidation-candidates.mjs --exclude <files of open PRs, comma-separated>
```

It lists near-duplicate paragraphs (25–50% shared, below the validator's 50%), files at ≥95% of
their size budget, similar skill descriptions, one-way skill pointers, OKF text restated in skills,
orphan OKF topics and `references/` files, and split candidates. **It narrows, it does not decide**:
open both sides of every candidate you consider and judge whether they really state the same rule.
These overlaps are intended and stay:

- two passages sharing phrasing that state *different* rules for different contexts;
- a one-line guardrail in a `SKILL.md` that its own `references/` file elaborates — the rule must
  hold even when the reference is not opened (the pattern of the earlier splits);
- the same practice in two skills that never load together (e.g. "pipe REST output through `jq`" in
  the JIRA and the OpenProject references), and a file's one-line boilerplate header;
- a skill that already points to the topic in another form ("see `xwiki-knowledge` → versioning")
  although `okf-restated` says "does not cite it".

### 3. Pick this week's batch

At most **5 fixes**, one coherent theme where possible, highest value first: a rule stated twice
with drifting wording beats a rule stated twice identically, which beats wording that is merely long.
A fix is one of:

- **Move a rule to its one home and point to it.** The home is the narrowest file every reader of
  the rule already opens: an OKF topic for an XWiki fact, the skill for a procedure step,
  `xwiki-org.md` only for what must be obeyed without opening anything. The other place keeps a
  pointer naming the file (and the section, when the file is long) — never a summary of the rule.
- **Tighten wording** — same facts, fewer words. No new facts, no softened or hardened "must".
- **Cut a procedure to its goal** — replace steps the model would get right unaided (ordinary git,
  shell or Maven mechanics) with what must hold and the non-obvious fact behind it. Keep the steps of
  a fragile or irreversible operation and any convention the model cannot infer.
- **Complete a one-way pointer** between two skills a model could confuse, restating from the other
  side the boundary the existing pointer already draws.
- **Lower a size budget** in `scripts/size-budgets.json` to the new size plus about 10%, when that
  is below the current entry. Never raise one.

Never: change a version field; edit a manifest, `.mcp.json`, a hook, a `.mjs`/`.js`/`.sh` script, a
validator threshold or this file; rename or delete a skill, OKF topic or `references/` file; change a
skill's `name`; change what a description routes to; add a "changed on…" note — records state
current facts, not history. A skill description is edited only to complete a pointer.

### 4. Split candidates: propose, never perform

A split moves a large share of a file, and the earlier ones (PRs 257, 259–263) each needed a lossless
check and old-vs-new trial runs, so it is a committer's change, not part of this batch. Take at most
**2** split candidates, highest value first, that survive these questions:

- Is the file near the 20,000-byte `SKILL.md` cap or far above the 12,000-byte OKF default, or
  growing fast (`growth4w`)?
- **Skill:** which `##` sections only one branch of a run, one mode or one sub-agent reads? Those
  move to `references/`, handed over by path; `SKILL.md` keeps the decision flow.
- **OKF topic:** do its sections belong to different topics of `okf/index.md`
  (`foreignSections`), or do different skills each read only one part (`sectionReaders`)?
- **Global fit:** does the content belong in an *existing* OKF topic or reference file? Reuse it
  before creating a file — but not one whose readers differ (a topic on *running* tests is not the
  home of rules for *writing* them), and not where `foreignSections` merely echoes a deliberate
  rules-vs-storage split. Check a new name against its siblings, and list what must follow: the
  `okf/index.md` entry (≤240 bytes each); the topic name in the OKF map of
  `xwiki/instructions/xwiki-org.md`, whose remaining byte headroom you state (the finder's
  `budget-pressure` shows it); the skill pointers; the README row; and any open PR on those files.

For each, write in the PR body: the file and why; each target file and which sections move there;
which skills or sub-agents read each part; and the check a committer runs — move the text by script,
then `node scripts/consolidation-candidates.mjs --lossless` (every removed sentence must be found
elsewhere) and both validators, then one trial run of each affected skill, old vs new.

### 5. Make the changes and verify them

- Branch `claude/weekly-consolidation-<YYYY-MM-DD>`. Keep each file's line endings and its existing
  wrap width; never re-wrap text you did not change.
- After editing, run all three, and fix or drop a fix until all pass:
  - `node scripts/consolidation-candidates.mjs --lossless` — for every sentence it prints, either
    show where its fact is stated now (file and the sentence there; a script's comments count) or
    restore it. A pointer-only replacement is always printed, since the wording at the home differs:
    check each fact of the removed sentence, not the sentence. A fact stated nowhere else is a
    dropped rule: undo that fix.
  - `node scripts/validate.mjs`
  - `claude plugin validate ./xwiki`
- Re-read each diff hunk against the rule it touched: same trigger, same scope, same strength.

### 6. Open the PR — or not

- **No fix survived:** open nothing. Split proposals alone do not justify a PR: a PR must carry a
  change; a proposal file in the repo would be planning, which the repo does not keep; GitHub issues
  are not used (the project tracks work in JIRA). Print the proposals to the run log instead — the
  finder recomputes them from the repo next week, so they come back with the next fix.
- **Otherwise** one commit, author `--author="XWiki LLM Bot <llm-bot@xwiki.org>"`, message:

  ```
  [Misc] Weekly consolidation: <what the batch does, in a few words>

  * <one line per fix: the file(s) and what moved or tightened>
  ```

  One `*` bullet per fix, each on one line, never hard-wrapped. Push the branch to `xwiki/xwiki-dev-llm`
  itself (the Claude GitHub App pushes; there is no fork) and open the PR with the same title over
  REST: `gh api repos/xwiki/xwiki-dev-llm/pulls -f title=… -f head=<branch> -f base=master -F body=@<file>`.
  The body, short and stating current facts:

  - a table: fix | files | why it changes no behaviour (where the rule's one home is now, and that
    `--lossless` finds every removed sentence);
  - `## Split proposals`, when there are any (step 4);
  - the validator results in one line.

Never merge, approve or close a PR, and never push to `master`.
