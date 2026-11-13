---
name: xwiki-knowledge
description: Search and extend XWiki declarative knowledge held in this plugin's knowledge base (KB, the kb/ directory) — conventions (code style, comments, commit format, versioning, backward compatibility), architecture (the component system), the dev-server ecosystem (JIRA, CI, Nexus, SonarCloud, forum), and release process. Use when a question is about how XWiki works or what its rules are rather than performing a task, or when you have learned a durable, generic XWiki fact worth saving for future sessions. For performing a task use the specific skill instead — building (xwiki-build), tests (xwiki-test-guidelines, xwiki-convert-tests, xwiki-convert-tests-docker), PRs (xwiki-pull-request), Sonar (xwiki-fix-sonarqube-issue), docs (xwiki-doc-writing, xwiki-doc-convert), translations (xwiki-translations), deploy (xwiki-deploy-extension).
---

# Using and extending the XWiki KB

The **KB** (the `kb/` directory) is the curated, LLM-oriented knowledge base of XWiki
*declarative* knowledge: facts, conventions, architecture, the server ecosystem, process orientation
and ADRs. Procedures live in the other `xwiki-*` skills. Resolve paths from this skill's directory:
the KB is `../../kb/` and its search engine `../../scripts/kb-search.mjs` (Claude Code
`${CLAUDE_PLUGIN_ROOT}/…`, Kimi Code `${KIMI_SKILL_DIR}/../../…`, opencode `$XWIKI_LLM_HOME/xwiki/…`).

## READ — answering a knowledge question

1. **Search, don't browse.** Hooks may already have given you pointers; otherwise run
   `node <kb-search.mjs> "<query>"` with **2–3 reformulations** (the developer's words, the XWiki
   term, the symptom). Each hit is `[tag] file#Section — Title: first line`, plus `related:` files;
   follow a `related:` pointer when the hit is close but not it. `--version X` drops entries whose
   `versions:` excludes the branch's version. `kb/index.md` is no longer the entry point.
2. **Read only the named `## Section`** of the file, not the whole file.
3. **Respect the tag and the frontmatter:**
   - `[rule]` (`stability: durable`) → the inline content is the answer; use it directly.
   - `[volatile]` → **never quote a value written in the file**; follow its `verify:` recipe instead.
     Typical recipes: read the repo root `pom.xml` `<version>` for the current dev version; query the
     `sonarqube` MCP for quality/issues; use the `discourse` MCP for forum content; `curl` the
     listed dev-wiki `sources:` for anything else that changes.
   - `[ADR]` → an accepted decision; `[proposed: under discussion]` → **not a rule**, say so.
4. The dev wiki (dev.xwiki.org) is the upstream source of truth. When a detail is missing or a file
   says the guide is evolving, **fetch the `sources:` URL and prefer it** over the KB summary.

## EXTEND — saving new knowledge (self-improvement)

New knowledge enters the KB **only through a reviewed git PR**. This plugin ships to every XWiki
developer's machine, so never write session-specific or personal content into it, and never commit
straight to a shared file outside a PR.

When a session establishes a fact worth keeping, run the **gate checklist** before writing anything:

- [ ] **Durable** — is it a stable rule/architecture/process fact, not a transient value? (Transient
      values like the current version belong as a *pointer + verify recipe*, never a cached value.)
- [ ] **Generic** — true for XWiki developers in general, with no personal paths, machine state,
      credentials, or secrets. De-personalise it.
- [ ] **Not already present** — search the KB with `kb-search` (and the relevant skills) first; if it exists, improve
      that entry instead of adding a duplicate. A fact has exactly one home.
- [ ] **Right home** — a convention/architecture/process *fact* → the matching `kb/` subdirectory;
      an *architectural decision* (a choice made between options, with rationale) → an **ADR** in
      `kb/decisions/` (see below); a task procedure → a skill, not the KB; a trap that a **shared
      script already handles correctly** → that script's header, where it is read exactly when it
      matters, leaving at most a routing line in the KB ("use `<script>`, not a query of your own").
      Two copies drift, and the prose one is the copy that goes stale.
- [ ] **Minimal** — the KB is read into context, so **every line costs tokens in every session that
      loads the file**. Write the rule plus the non-obvious trap and stop: no restating it in other
      words, no example the reader does not need, no rationale beyond the clause that makes it stick.
      When the new fact touches an existing bullet, **edit that bullet or cross-reference it** rather
      than stating the fact in two sections. Re-read your diff and cut whatever can go without losing
      a rule or a trap.
- [ ] **Priced against the file's readers** — a topic file's cost is paid by every session that opens
      it for *any* reason, so the test is "does someone doing the ordinary thing this file is for
      need this?", not "is it about this topic?". `kb/servers/jira.md` is opened to file a bug: the
      JQL quirks of one CI lookup failed that test and belonged next to the code that hits them.
- [ ] **Nothing extra in the always-on file** — `instructions/xwiki-org.md` is injected into *every*
      session of every XWiki repo, so a line there is paid for by every task that never needed it.
      It lists no topic: the KB is found by search. Never copy a rule, a trap or an example into
      it — a skill's own `description` is already always visible. The one
      exception is a rule that must be obeyed *without* opening the KB file: promote it to a real
      bullet in the section it belongs to (folding it into the bullet it qualifies), and only when it
      bears on nearly every session.

Then:

1. Create/edit the KB file under the correct subdirectory, with frontmatter:
   `title`, `stability` (`durable`|`volatile`), `summary`, and `sources:` (the dev-wiki URL(s) it
   derives from). An XWiki dev best practice cites **only official dev.xwiki.org pages**, in `sources:`
   and in the body — never a devs-list or forum thread, even the one where it was decided; that history
   goes in the PR description. For volatile facts add a `verify:` line and store the recipe, not the value.
   Cross-link related entries with `[[name]]` (the target file's basename without extension).
   The search and pointer hooks also read `last-confirmed` (date; breaks near-ties), `related`
   (topics shown beside a hit) and, when the rule concerns certain files, `applies-to` (path globs)
   and `applies-when` (regexes over added text); copy their form from a sibling topic.
2. **Update `kb/index.md`** — the topic line (`node scripts/validate.mjs` checks every topic is
   listed). Then, in this repo, **regenerate the topic's search sidecar** (`kb/_meta/`) with
   `node scripts/kb-pipeline/gen-metadata.mjs`: a sidecar whose topic body changed is ignored, so
   the topic is found less well until it is regenerated.
3. **Leave what you touched shorter than you found it.** Cut what has gone stale, what your new
   entry now says better, and what is stated twice — a knowledge base that only ever grows stops
   being read. List those cuts in the PR so they get reviewed alongside the addition.
4. **Never touch the plugin version.** Five manifests carry it, so a PR that bumps it conflicts with
   every other open PR over something that was never the change — `node scripts/validate.mjs` fails
   the branch for it. The bump happens on `master` after the merge, in `scripts/release.mjs` (run
   automatically by the `release` workflow), which derives the segment: a KB or skill content edit
   is a **patch**, a skill/MCP server/hook/opencode plugin added or removed is a **minor**. When a
   change needs a bigger bump than its file list can show, say so with a `Release-Bump: minor` (or
   `major`) trailer in the commit message — trailers never conflict.
5. Open a PR using the `xwiki-pull-request` skill's conventions (JIRA/`[Misc]` prefix, squashed
   commit, AI-attribution trailers). The change is reviewed like code before it ships.

### Recording an ADR (architectural decision)

When you encounter an **architectural decision** — a choice made between alternatives, with a
rationale (e.g. "use default methods, not new interfaces, to evolve an API") — capture it as an ADR
in `kb/decisions/`, copying `kb/decisions/_template.md` (trimmed MADR: context / decision /
consequences, plus a `status` of proposed|accepted|superseded|deprecated). Filenames are
descriptive slugs, **not** sequential `0001-` numbers (those collide across PRs).

**Grounding rule — this is mandatory and is what keeps ADRs trustworthy:** only write the context
and consequences if they are grounded in a **real, citable source** recorded in `sources:` — a
dev-wiki or design.xwiki.org page, a forum thread, or an explicit committer statement in the current
session. **Never invent rationale the LLM was not told.** If the *why* is not grounded:

- record only the *what* as a normal convention/architecture entry, OR
- open the ADR with `status: proposed` and a `sources:` note that a human must supply the rationale.

Superseding instead of deleting: when a decision changes, set the old ADR's `status: superseded` and
`superseded-by:`, and add `supersedes:` on the new one — decisions are historical, they don't vanish.

## When to offer capture (closing the loop each session)

Self-improvement only happens if learnings flow back. Run the capture check whenever **either**:

- **(a)** the task *relied on or fetched* a durable, generic XWiki fact — a convention, policy,
  architecture point, or a dev-wiki / xwiki.org doc page — that **a KB search does not find,
  or that contradicts it**. *Absence is itself the signal; the fact need not be new to you.* In
  particular, **if you fetch an authoritative XWiki doc page to perform a task and the KB lacks its
  topic, offer to capture it.** A whole topic area you needed but the KB lacks is a strong signal.
- **(b)** the developer **corrects** you on an XWiki convention, architecture point, or an existing
  KB/skill statement.

On either, **proactively ask** whether to capture, then run the EXTEND flow above on a yes. The org
instructions (always injected) carry this directive too, so the prompt is well-timed at task
completion. Note the common miss: a task that *consumes* established knowledge to produce an output
can still surface a KB gap — judge novelty against the **KB**, not against what you already know.

Run it through the gate **before** asking, and **stay silent** when it fails — do not pester:

- Trivial session, or nothing durable/generic/non-obvious emerged → say nothing.
- Personal, secret, machine-specific, or session-specific detail → never; it must not ship.
- Already covered in the KB or a skill → at most propose *improving* that entry, not a duplicate.

Shared XWiki knowledge belongs in the KB (PR-reviewed, ships to the whole team) — never in a
private/per-machine LLM memory. That is the point of capturing it here.

## What does NOT belong in the KB

- Step-by-step task procedures → an `xwiki-*` skill.
- Anything personal, secret, machine-specific, or session-specific.
- Cached volatile values (versions, dates, current role holders, build/issue status) — store a
  pointer + verify recipe instead.
