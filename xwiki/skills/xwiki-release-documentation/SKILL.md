---
name: xwiki-release-documentation
description: "EXPLICIT INVOCATION ONLY. Audit the documentation of fixed XWiki issues — for a whole release (every issue the developer fixed in a Fix Version) or for one named issue — and close the gaps: decide, from the actual diff, whether the change needs a documentation page and/or a release-note entry, write them, and fill the issue's `Documentation` and `Documentation in Release Notes` JIRA fields with the resulting URLs. Release-note entries are created through the Release Notes Application REST endpoints. Use ONLY when the developer names it — `/xwiki-release-documentation`, \"document my fixed issues for 18.8.0\", \"run the release documentation sweep\", \"document XWIKI-24710 for the release\". Do NOT use it for \"write docs for this\" or \"document this page\" — those are xwiki-doc-writing. For the prose of a page use xwiki-doc-writing; to migrate an old page use xwiki-doc-convert; for JIRA reads/writes use xwiki-jira; for wiki reads/writes use xwiki-rest-api; for a contrib extension release announcement use xwiki-contrib-release-blog-post."
---

# XWiki release documentation

**This skill is opt-in.** It is never the answer to "document this" — that is `xwiki-doc-writing`.
It runs only when the developer names it, because it reads the full diff of every issue in scope,
writes to xwiki.org and writes back to JIRA.

What it produces, per fixed issue: a **documentation verdict** and a **release-note verdict**, each
either a URL or `N/A`, each *proven* from the change itself, and each written into the issue's JIRA
field once the artefact it points at actually exists.

The declarative half — the release-note data model, the REST contract and the entry conventions —
is `okf/processes/release-notes.md`. **Read it before running this skill**; this file is the
procedure and does not restate it. The two JIRA field ids and the rules for their values are in
`okf/servers/jira.md`, and the xwiki.org REST access rules (Cloudflare User-Agent, `/xwiki/rest`,
`~/.xwiki-credentials`) in `okf/servers/index.md`.

Resolve `okf/` from this skill's directory as `../../okf/`; in Claude Code
`${CLAUDE_PLUGIN_ROOT}/okf/`, in Kimi Code `${KIMI_SKILL_DIR}/../../okf/`, in opencode
`$XWIKI_LLM_HOME/xwiki/okf/`.

## 0. Two modes

```
SWEEP    /xwiki-release-documentation 18.8.0
         "document my fixed issues for 18.8.0"
         → every issue the developer fixed in that Fix Version

SINGLE   /xwiki-release-documentation XWIKI-24710
         "document XWIKI-24710 for the release"
         → that one issue, whatever its assignee
```

They are the same procedure over a different issue set. SINGLE skips the triage-table approval of
§4 (there is one row; show it and get the same approval inline) and keeps every gate of §5 and the
verification of §7. Everything else — the evidence rigor, the `N/A` proof, the field rules — is
identical. A sweep that turns out to hold one issue is still a sweep.

## 1. Resolve the inputs

**The issue set.**

- SWEEP: `fixVersion = <version> AND assignee = currentUser() AND resolution = Fixed`.
  A version-scoped query naturally crosses `XWIKI`, `XCOMMONS` and `XRENDERING` — that is expected.
  Any *other* project key in the result is **reported, not processed**.
  The developer may widen the query (another assignee, `resolution in (Fixed, Done)`) if they say
  so; do not widen it on your own.
- SINGLE: the issue key given. Of its Fix Versions, the version is the one that is not a bugfix
  release, if any (bugfix ones are for `references/bugfix-releases.md`, below); if several remain, ask. An
  issue not resolved `Fixed` is said so, and run only if the developer says to — SWEEP's widening.

**The version.** Accept any spelling — `18.8.0`, `18.8.0RC1`, `18.8.0-rc-1` — and resolve it to the
one JIRA version name:

```
GET https://jira.xwiki.org/rest/api/2/project/XWIKI/versions
```

(The three core projects each carry their own version objects under the same name, and JQL matches
a Fix Version by name across them, so resolving against `XWIKI` is enough.)

**If more than one version matches what was typed, list the matches and ask. Never guess** —
`18.8.0` and `18.8.0-rc-1` are different release notes, and picking the wrong one puts the entries
where nobody will read them.

The Fix Version is also the version the entries are stored against: for a `.0` cycle that is the RC
(`18.8.0-rc-1`), and the final release note aggregates them. Do not "helpfully" retarget to the
final version.

**The release note.** One call says whether it exists and, if so, the page it lives in:

```
GET https://www.xwiki.org/xwiki/rest/wikis/xwiki/releasenotes?product=XWiki
```

Match on the `version` field (the long dashed form). Missing is the normal case for a cycle in
progress — see §6.2.

**A bugfix release stores no entries of its own.** For an `X.Y.Z` with `Z > 0` the release-note page
renders `{{jira}}` — the list of issues fixed, queried from JIRA — *instead of*
`{{releasenotechanges/}}` (the page branches on this itself, and `okf/processes/release-notes.md`
says so). An entry posted against that version is stored and never rendered, so **never post one
there**. Say this at triage rather than discovering it afterwards.

Read `references/bugfix-releases.md` before triage **whenever the version is a bugfix release or
an issue in scope has one among its Fix Versions**: it says where such an issue's entry goes instead.

**The clones.** `xwiki-platform`, `xwiki-commons` and `xwiki-rendering` are needed to read diffs.
Discover them as siblings of the working directory; ask once if any is absent. **Never hardcode a
path** — this plugin ships to other developers' machines. Record what was found in the plan file.

**The code ref**, per repo:

```
ref = the release tag        (xwiki-platform-18.8.0-rc-1)  if it exists
    | origin/master                                        for the cycle in progress
    | origin/stable-X.Y.x                                  for a bugfix line

commits(KEY) = git log --grep=<KEY> <previous-release-tag>..<ref>
```

`git log --all --grep=KEY` is **not** a usable commit set: it returns the master commit, the
backports to every stable branch, the topic branch and the PR-merge duplicate — eight commits for
one fix. The range above drops all of that.

`<previous-release-tag>` is the release before the version on its line: the previous cycle's RC for
a master cycle (`xwiki-platform-18.8.0-rc-1` for `18.9.0-rc-1`), the RC for a `.0` final, `X.Y.(Z-1)`
for a bugfix. Release tags sit on `stable-X.Y.x`, so none is an ancestor of master; that is expected,
since `A..B` excludes by reachability — do not substitute a merge-base.

State the known limitation in the report: for a version that has not been released there is no tag,
so the claims below are verified against a moving `origin/master` and can drift before release.

**The plan file**, created now and updated as work completes:

```
<work>/<repo>/<YYYY-MM-DD>-<ShortVersion>-release-documentation/plan.md
```

(`<work>` is the work directory named in the org instructions.) It holds the resolved version, the
clone paths, the ref per repo, and one section per issue with its verdicts, its evidence and its
state. It is one file per version, whatever the mode: a SINGLE run adds its issue's section to it.
**The run is resumable from this file**: re-invoked, re-read the version's existing one (whatever
its date) and continue rather than redoing what is marked done. Tell the developer the path once.

## 2. Ground rules

These are the bar the developer set, and they are what makes the output worth trusting.

- **Read the full diff of every issue — including the ones heading for `N/A`.** An `N/A` verdict is
  a claim that nothing user-visible or API-visible changed. It has to be *proven* from the diff, not
  assumed from the issue type.
- **Every factual claim** written into a page or an entry — a signature, a property name, a default
  value, a configuration key, a syntax, a UI label — traces to `file:line` **at the code ref**. If
  it cannot be traced, it does not get written.
- **The verifier is not the writer.** Prose is checked by a fresh subagent that did not write it,
  against the source. A claim that contradicts the source is rewritten; a claim that cannot be
  verified is **dropped**, not softened.
- **An existing field value is re-derived, never trusted.** The developer's instruction: *even if a
  field says `N/A`, do not trust it — check whether that is correct.* This is a full audit, not a
  gap-filler. Any disagreement between an existing value and the verdict becomes a flagged row.
- **Nothing non-empty is overwritten without the developer's say-so** (§5).

## 3. Phase 1 — evidence

One **read-only subagent per issue** (or per proposed group), in parallel. Give each the absolute
path of `references/evidence-brief.md` as its instructions, plus the issue key, the repo, the ref and
the commit range. It returns the structured verdict that file defines — never the diff itself.

Check each documentation verdict against the question it turns on: **does any page make a claim this
change makes wrong?** A subject search alone cannot answer it; the brief has the evidence agent search
the identifiers the diff touches too.

## 4. Triage

Default by issue type, **overridden by the evidence**. The two verdicts are independent — "no
documentation page fits this" does not cancel the release-note entry.

```
Bug           → N/A , N/A     unless the change is noteworthy (below) → RN entry
Improvement   → doc? , RN
New Feature   → doc  , RN
Task          → N/A , N/A     unless it changes a dev practice → dev.xwiki.org doc, RN N/A
```

**The test is noteworthiness, not visibility.** An entry is for a change a reader deciding whether
to upgrade wants to know about; documentation is for a change that alters what a page says. **A pure
bug fix that changes nothing documented is not worth an entry** — it merely restores the behaviour
the documentation already describes, and the release note lists it among the issues fixed anyway.
"User-visible behaviour changed" is too weak a trigger: nearly every bug fix changes user-visible
behaviour, that being what made it a bug.

`verify:` the bar the project actually applies, in the main session, once per run, before arguing a
Bug over it — of the fixed issues of a cycle carrying a non-empty `Documentation in Release Notes`,
count how few hold a URL rather than `N/A` (a value not starting `https://` counts as `N/A`, such
as `N/A (internal class)`), and how few of those are Bugs rather than Improvement / New Feature:

```
GET /rest/api/2/search?jql=project in (XWIKI,XCOMMONS,XRENDERING)
    AND "Documentation in Release Notes" is not EMPTY AND resolution = Fixed
    AND fixVersion in ("<the RCs of a recent cycle>")&fields=key,issuetype,customfield_10273
```

**Grouping** is proposed here, both directions, and approved by the developer:

- *N issues → 1 entry* when they are one story to a reader (four issues that together made the build
  reproducible). Every issue in the group gets the **same** entry URL.
- *1 issue → N entries* when one fix delivered two unrelated user-visible things. Both URLs,
  space-separated.

Show the table and **get approval before anything is written**:

```
issue          type         doc verdict                      rn verdict     flags
XWIKI-24710    Improvement  update  documentation/…/LiveData  entry          —
XWIKI-24762    Bug          N/A (internal refactor, proven)   entry          field says N/A
XCOMMONS-3752  Task         N/A                               N/A            —
```

## 5. Gates

- **Creating a documentation page has two gates.** Placement is a different decision from prose:

  ```
  GATE 1  Diataxis type · audience · parent location · page name · title   → approve
  GATE 2  the prose                                                        → approve
  ```

  Updating an existing page keeps the single content gate.

- **Category and importance are always put to the developer**, per entry. Category because the
  existing vocabulary must win over the JIRA component spelling and a new value must be proposed
  rather than invented — the drift, and the recipe that harvests the vocabulary actually in use,
  are in the OKF; importance because a non-zero one is an editorial claim and must be justified in
  the plan. `audience` and `screenshots` are derived without asking — except a UI-visible change
  with no documentation page, whose missing screenshot is **flagged**, never substituted (OKF).

- **Existing state** — never silently overwritten:

  ```
  field = N/A, verdict = needs an entry     → FLAG, propose  N/A → <url>
  field = <url>, the URL 404s               → FLAG broken link
  field = <url> that covers the change      → OK, leave it alone
  an entry already covers the change        → reuse and link it, never duplicate
  a doc page already covers the change      → no edit
  ```

- **Creating a missing release note is confirmed explicitly** (§6.2).

## 6. Phase 2 — execute, one issue at a time

Resumable: each issue is marked done in the plan file as its last step completes. **Writes happen in
the main session, never in a subagent.**

### 6.1 Documentation

Route by where the subject is already documented. **Update in place wherever the page lives; create
only in the new tree.**

```
page in the new /documentation tree     → update            (xwiki-doc-writing)
page in the OLD /Documentation space    → update in place + flag migration candidate
page on extensions.xwiki.org            → update in place + flag migration candidate
page on dev.xwiki.org                   → update in place   (narrower mandate, below)
page on rendering.xwiki.org             → update in place
nothing covers it                       → create, in /documentation only
```

**Migration is never a side effect.** A legacy page that ought to move into the new tree is
*recorded* as a candidate for a later `xwiki-doc-convert` run — converting it inside a
documentation sweep buries a large refactor inside an unrelated change.

**dev.xwiki.org has no written conventions** — no skill and no OKF file governs writing there. Edit
it under a narrower mandate: **additive only** (extend a section, never restructure), mirror the
page's own structure and voice, and do **not** apply Diataxis re-typing. The claim-verification pass
of §2 still applies in full. Record in the report that dev.xwiki.org's conventions are unwritten, as
an `xwiki-knowledge` EXTEND candidate.

Everything else about the prose — Diataxis type, titles, page structure fields, style, versioning —
is `xwiki-doc-writing`'s. Delegate to it rather than restating it.

**A UI-visible change gets its screenshot here, not in §6.2** — it is produced for the
documentation page and the entry reuses that exact image (OKF), which is why this step runs first.

### 6.2 The release-note entry

All writes go through the **Release Notes Application REST endpoints**; the contract, the
representations and the traps are in `okf/processes/release-notes.md`. Never create an entry page by
generic page creation: an entry needs two objects and an `Entry###` number allocated without racing
another author.

1. **List what is already there** before writing anything — the endpoint does not deduplicate, so a
   re-run without this step doubles every entry:

   ```
   GET /xwiki/rest/wikis/xwiki/releasenotes/XWiki/<version>/changes?limit=200
   ```

   An entry that already covers the change is reused, not duplicated (§5).

2. **If the release note does not exist**, say so, show exactly what will be created, and create it
   **only on confirmation** — the call, a racing `409` and what is left to the release manager are in
   `references/entry-writes.md`.

3. **Post the entry**:

   ```
   POST /xwiki/rest/wikis/xwiki/releasenotes/XWiki/<version>/changes
   {"title": …, "summary": …, "audience": …, "importance": …, "category": …}
   ```

   What goes in each field — the user-facing `title`, the shape of `summary`, why `description` is
   omitted, no JIRA key in an entry, the `low`/`medium`/`high` spelling — is the OKF's **Writing an
   entry**. Two things are procedural and belong here:

   - **Read the URL back out of the response**, never construct it from an assumed entry number:
     the response carries the stored value, and `reference` is the page actually allocated.
   - **Screenshots come after the entry exists**: post it without `screenshots`, copy the image
     file onto the page named by `reference`, then set `screenshots`. Never link the documentation
     page's attachment, and never pre-create the entry page. Read `references/entry-writes.md` for
     the calls before the first entry with a screenshot.

### 6.3 The JIRA fields

Only once the artefacts exist. `Documentation` = `customfield_10270`, `Documentation in Release
Notes` = `customfield_10273`; write them over REST (`xwiki-jira`). Their values follow
`okf/servers/jira.md`: absolute URLs, space-separated when there are several, exactly bare **`N/A`**
when there is nothing, never an anchor.

Bare `N/A` **changes current team habit** — `N/A (internal class)` is on real issues — and is
deliberate. Where a reason is worth keeping, it goes in the run report and, if it matters beyond
the run, a JIRA comment; never into the field.

## 7. Verification and the report

A final pass **re-reads every page and field touched** and confirms every URL resolves. Then:

```
XWIKI-24710    doc ✓   entry ✓   jira ✓
XWIKI-24762    doc –   entry ✓   jira ✓
XCOMMONS-3752  doc ✓   entry ✗ 403   → jira NOT touched

verify pass              : 14 URLs, 14 resolve
flagged                  : 3   (listed, with what disagreed)
migration candidates     : 2   (for a later xwiki-doc-convert run)
left for release manager : intro paragraph, Revapi object
code ref caveat          : verified against origin/master (18.8.0-rc-1 is not tagged yet)
```

## 8. Failure policy

Per-issue transaction. A failure **stops that issue**, records the error and exactly what had
already been written, and the run moves to the next one. The invariant that must not break:

> **JIRA is never pointed at a URL that was not created.**

So the order within an issue is always: write the artefact → read its URL back from the response →
write the field. A partially-done issue stays marked partial in the plan file, with what remains.

## 9. Scope

Core only: `XWIKI`, `XCOMMONS`, `XRENDERING`, `product = XWiki` — plus any other product the
Release Notes Application on xwiki.org holds (`Cristal`, `ActivityPub Application`), for which
everything above works, **product and release-note location being parameters, not constants**.

**An extension not bundled in XWiki Standard is out of scope, and owes no release-note entry at
all**: its fixed issues take `Documentation in Release Notes = N/A`, and nothing is owed until the
version is released. Why, and the `verify:`, are in `okf/processes/release-notes.md` ("Extensions not
bundled in XWiki Standard"). The documentation half (§6.1) still applies to such a change, so a
SINGLE run over one of its issues is a documentation-only run.
