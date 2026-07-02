---
name: xwiki-knowledge
description: Find and extend XWiki declarative knowledge held in the OKF knowledge base under this plugin's okf/ directory — conventions (code style, comments, commit format, versioning, backward compatibility), architecture (the component system), the dev-server ecosystem (JIRA, CI, Nexus, SonarCloud, forum), and release process. Use when a question is about how XWiki works or what its rules are rather than performing a task, or when you have learned a durable, generic XWiki fact worth saving for future sessions. For performing a task use the specific skill instead — building (xwiki-build), tests (xwiki-test-guidelines, xwiki-convert-tests, xwiki-convert-tests-docker), PRs (xwiki-pull-request), Sonar (xwiki-fix-sonarqube-issue), docs (xwiki-documentation), translations (xwiki-translations), deploy (xwiki-deploy-extension).
---

# Using and extending the XWiki OKF

The **OKF** is the curated, LLM-oriented knowledge base of XWiki *declarative* knowledge. It lives
in this plugin at `okf/` (resolve it from this skill's directory: `../../okf/`, i.e.
`${CLAUDE_PLUGIN_ROOT}/okf/`). Procedures live in the other `xwiki-*` skills; the OKF holds facts,
conventions, architecture, the server ecosystem and process orientation.

The map of everything in the OKF is `okf/index.md` — a slimmed copy is injected into every XWiki
session via `instructions/xwiki-org.md`, so you usually already know the topic list.

## READ — answering a knowledge question

1. **Locate the topic** in `okf/index.md`, then **Read the specific file** (e.g.
   `okf/conventions/backward-compatibility.md`).
2. **Respect the `stability:` frontmatter:**
   - `durable` → the inline content is the answer; use it directly.
   - `volatile` → **never quote a value written in the file**; follow its `verify:` recipe instead.
     Typical recipes: read the repo root `pom.xml` `<version>` for the current dev version; query the
     `sonarqube` MCP for quality/issues; use the `discourse` MCP for forum content; WebFetch the
     listed dev-wiki `sources:` for anything else that changes.
3. The dev wiki (dev.xwiki.org) is the upstream source of truth. When a detail is missing or a file
   says the guide is evolving, **fetch the `sources:` URL and prefer it** over the OKF summary.
4. **Optional accelerator:** if context-mode is installed, index a fetched page once and search it
   for repeated lookups. The OKF must never *depend* on context-mode — plain Read + WebFetch always
   works.

## EXTEND — saving new knowledge (self-improvement)

New knowledge enters the OKF **only through a reviewed git PR**. This plugin ships to every XWiki
developer's machine, so never write session-specific or personal content into it, and never commit
straight to a shared file outside a PR.

When a session establishes a fact worth keeping, run the **gate checklist** before writing anything:

- [ ] **Durable** — is it a stable rule/architecture/process fact, not a transient value? (Transient
      values like the current version belong as a *pointer + verify recipe*, never a cached value.)
- [ ] **Generic** — true for XWiki developers in general, with no personal paths, machine state,
      credentials, or secrets. De-personalise it.
- [ ] **Not already present** — search `okf/` (and the relevant skills) first; if it exists, improve
      that entry instead of adding a duplicate. A fact has exactly one home.
- [ ] **Right home** — a convention/architecture/process *fact* → the matching `okf/` subdirectory;
      an *architectural decision* (a choice made between options, with rationale) → an **ADR** in
      `okf/decisions/` (see below); a task procedure → a skill, not the OKF.

Then:

1. Create/edit the OKF file under the correct subdirectory, with frontmatter:
   `title`, `stability` (`durable`|`volatile`), `summary`, and `sources:` (the dev-wiki URL(s) it
   derives from). For volatile facts add a `verify:` line and store the recipe, not the value.
   Cross-link related entries with `[[name]]` (the target file's basename without extension).
2. **Update `okf/index.md`** (add the topic line) **and the mirrored map in
   `instructions/xwiki-org.md`** so the always-on map stays in sync.
3. **Bump the plugin version** so installed plugins actually pull the update — Claude Code updates a
   plugin only when its version *increases*. Increment all three synced fields
   (`.claude-plugin/marketplace.json` `metadata.version` + the `xwiki` plugin entry's `version`, and
   `xwiki/.claude-plugin/plugin.json`); **patch** for an OKF content edit. `node scripts/validate.mjs`
   verifies they stay in sync.
4. Open a PR using the `xwiki-pull-request` skill's conventions (JIRA/`[Misc]` prefix, squashed
   commit, no AI-attribution trailers). The change is reviewed like code before it ships.

### Recording an ADR (architectural decision)

When you encounter an **architectural decision** — a choice made between alternatives, with a
rationale (e.g. "use default methods, not new interfaces, to evolve an API") — capture it as an ADR
in `okf/decisions/`, copying `okf/decisions/_template.md` (trimmed MADR: context / decision /
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
  architecture point, or a dev-wiki / xwiki.org doc page — whose topic is **absent from the OKF map,
  or contradicts it**. *Absence is itself the signal; the fact need not be new to you.* In
  particular, **if you WebFetch an authoritative XWiki doc page to perform a task and its topic isn't
  in the OKF map, offer to capture it.** A whole topic area you needed but the map lacks is a strong
  signal.
- **(b)** the developer **corrects** you on an XWiki convention, architecture point, or an existing
  OKF/skill statement.

On either, **proactively ask** whether to capture, then run the EXTEND flow above on a yes. The org
instructions (always injected) carry this directive too, so the prompt is well-timed at task
completion. Note the common miss: a task that *consumes* established knowledge to produce an output
can still surface an OKF gap — judge novelty against the **OKF**, not against what you already know.

Run it through the gate **before** asking, and **stay silent** when it fails — do not pester:

- Trivial session, or nothing durable/generic/non-obvious emerged → say nothing.
- Personal, secret, machine-specific, or session-specific detail → never; it must not ship.
- Already covered in the OKF or a skill → at most propose *improving* that entry, not a duplicate.

Shared XWiki knowledge belongs in the OKF (PR-reviewed, ships to the whole team) — never in a
private/per-machine LLM memory. That is the point of capturing it here.

## What does NOT belong in the OKF

- Step-by-step task procedures → an `xwiki-*` skill.
- Anything personal, secret, machine-specific, or session-specific.
- Cached volatile values (versions, dates, current role holders, build/issue status) — store a
  pointer + verify recipe instead.
