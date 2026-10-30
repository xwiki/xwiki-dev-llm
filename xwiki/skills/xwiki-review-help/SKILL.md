---
name: xwiki-review-help
description: Build a local, interactive HTML page that walks a maintainer through every user-facing change of a set of changes (open PRs, a branch, a batch of fixes before a release, security fixes before disclosure) - one card per change with before/after, screenshots that enlarge on click, who is affected and how likely, what admins must do, why, alternatives, a recommendation and the release-notes line - plus the open decisions, each with Accept/Change/Discuss and notes, exported as Markdown to paste back into the chat. Use when the developer asks to "help me review the changes / decide on the user-facing changes" of several PRs or a release as a page, or for "the HTML page like last time". Not a code review (use xwiki-review), not the release notes themselves (use xwiki-release-documentation), not a screenshot capture (use xwiki-capture-ui-change).
---

# Review help

## What it is for

The developer has to approve what a set of changes does **to users** before merging or releasing,
without reading every diff. The page puts each user-visible change on a card they can decide on,
and gives the decisions back to you as Markdown. You then apply them: amend PRs, file issues,
update release notes.

The page is a fixed template plus one data file. Copy the template; write only the data:

- `assets/review-guide.html`: copy it unchanged, renamed after the guide if you like.
- `assets/guide-data.example.js`: the data format, every field commented. Write yours as
  `guide-data.js` next to the page.

The skill directory is `${CLAUDE_PLUGIN_ROOT}/skills/xwiki-review-help` (Kimi Code:
`${KIMI_SKILL_DIR}`; opencode: `$XWIKI_LLM_HOME/xwiki/skills/xwiki-review-help`).

## Where it lives, and who may see it

- Put the page, its `guide-data.js` and an `img/` folder in the task's folder under the **work
  directory** of the org conventions, never in the repo and never in a session scratch directory:
  the developer reopens the page in later sessions, so copy the screenshots there too.
- **Security fixes, or anything not yet disclosed: the page stays a local file.** Its "why" fields
  explain what each change prevents. Never publish it (no hosted artifact, gist, PR, issue, chat
  upload) and show the badge (`confidential: true`). For non-sensitive changes, publish only when
  the developer asks.
- `storageKey` must be new for each guide: all `file://` pages share one browser storage, so two
  guides with the same key mix their choices.

## What goes on the page

- **One card per user-visible change, not per PR.** A PR can make several changes, and one change can
  span PRs. Internal refactorings with no effect for users, admins, API clients or extension
  developers get no card.
- **Every claim comes from the code**: the branch or PR diff, then the fix and review notes. When
  notes and code disagree, the code wins and you say so. Mark estimates with
  `<span class='guess'>guess</span>`, and say what was not verified (e.g. "not checked in a
  browser").
- **Tiers** decide what the developer reads closely. A: many installs notice it, or an admin must
  act. B: only unusual setups or API clients notice it. C: invisible in practice; the developer can
  accept these in bulk. Don't inflate a tier to look careful.
- **Before → after** describes concrete behaviour: the message shown, the status code, the page that
  breaks. For a visible change, add `shots`: the "after", plus the "before" for a fix of existing UI
  (xwiki-capture-ui-change produces it when the branch can't). The thumbnails stay small and
  enlarge on click.
- **The release-notes line must be safe to publish**: it describes the new behaviour, never why it
  changed. Leave it empty when nothing needs saying.
- **Decisions** are the choices the fixes or reviews made, or left open. Give the options with their
  cost, the reviewer's view, and your recommendation. Set `decided: true` when the change already
  implements it, so the developer only confirms it.
- `intro` and `outro` hold whatever else the developer needs to decide: the PRs and their merge
  order, a short primer of the feature, the release-notes lines collected in one place.

## Before handing it over

Check that `guide-data.js` parses (`node --check`). Then open the page in a browser (the
`agent-browser` skill) and check that it renders: the cards, the triage table, a screenshot that
enlarges. Open it for the developer (`open <page>` on macOS, `xdg-open` on Linux) and tell them its
absolute path. Ask them to export their decisions and paste them back.

When they paste the export, apply each CHANGE and DISCUSS item, and record the decisions in the
task's notes, so a later session doesn't ask again.
