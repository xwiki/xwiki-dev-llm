---
title: JIRA (jira.xwiki.org) — access and issue-field conventions
stability: durable
summary: How to reach the self-hosted XWiki JIRA (jira-cli or REST), when an issue should be filed at
  all, and the durable conventions for an issue's Component, Affects Version/s and Fix Version/s.
  Version values themselves are volatile.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/IssueTracker/JIRA/
  - https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/
  - https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/
---

# JIRA (`jira.xwiki.org`)

`https://jira.xwiki.org` is XWiki's issue tracker (NOT GitHub Issues) — a **self-hosted Atlassian
JIRA** (Server/Data Center, not Cloud). There is **no MCP** for it. Two access paths, both driven by
the **`xwiki-jira`** skill (that skill owns the *procedure*; this file owns the *facts*):

- **REST API** — required for writing any description or comment, since `jira-cli` mangles text
  bodies; also the only path for attachments, comment edits and type changes. Uses `JIRA_API_TOKEN`
  as a bearer token:
  `curl -H "Authorization: Bearer $JIRA_API_TOKEN" https://jira.xwiki.org/rest/api/2/…`.
- **`jira-cli`** — convenient for reads, searches, field and status changes
  (`jira issue view/list/move …`). Setup is in the plugin README (on-premise install:
  `JIRA_API_TOKEN` = your JIRA personal access token, `JIRA_AUTH_TYPE=bearer`, then `jira init` →
  installation type *Local*, server `https://jira.xwiki.org`, auth type *bearer*).

## Project keys

Each repo has its own key: `XWIKI` (Platform), `XCOMMONS` (Commons), `XRENDERING` (Rendering); other
`xwiki`-org repos have their own keys too (e.g. `XDOCKER` for the `xwiki/xwiki-docker` image); and
each xwiki-contrib extension has a per-extension key. Always reference an issue by its key
(`XWIKI-12345`); the commit that fixes it carries that key as its prefix (see [[commit-messages]]).

## Whether to file an issue at all

**A defect in code that the version under development introduced does not get its own issue** —
reopen the issue that introduced it and fix it under that key (an already-merged PR does not change
this; a second PR on the same key is the expected shape). Filing a new one splits one unreleased
change across two release-note entries and leaves an "Affects Version" that names a version nobody
can have hit the bug in. **That impossible Affects Version is the tell**: if the only honest value is
the unreleased dev version, you are in this case — the exception being a genuinely pre-existing defect
that the new work merely brought to light, which is its own issue with an Affects Version naming a
*released* version.

A change with no effect on users or extension developers (refactoring, build-only work) needs no
issue; when one is filed anyway it takes the **`Development Issue Only`** component, which is excluded
from the release notes.

## Issue-field conventions (creating a Bug)

These field conventions are **durable**; the version *values* they resolve to are volatile (see
below). When filing/curating a bug, set:

- **Component/s** — always set at least one (e.g. `REST`, `Rendering`, `Platform - …`). Required for
  triage; do not leave empty.
- **Affects Version/s** — the **oldest** released version in which the bug is present. When the buggy
  code is ancient and pinning the exact oldest release is impractical/too slow, fall back to the
  **last (most recent) XWiki LTS version that the issue affects**. **Never** just use the latest
  released version — that understates the range and defeats backport triage.
- **Fix Version/s** — the version the fix ships in: normally the next release of the current dev
  version. Note the naming: JIRA version names use dashes (e.g. `18.7.0-rc-1`), whereas the source
  `@since` / `@Deprecated(since=…)` tag for the *same* release uses `18.7.0RC1` — see [[versioning]]
  for the tag format. Add the stable-branch fix versions too when the fix is backported.

These conventions target the core projects (`XWIKI`, `XCOMMONS`, `XRENDERING`). **Some projects
configure fewer fields** — e.g. `XDOCKER` has **no Component/s, no Affects Version/s and no Fix
Version/s** at all, so there is nothing to set there; do not treat their absence as a mistake to
correct. Check what the project actually exposes before insisting on a field.

Write the **description in JIRA wiki markup** (`h2.`, `{{monospace}}`, `*bold*`, `* bullet`) and make
it explain the **user-visible problem**, not just the code change — but mind the markup gotchas below.

## Dependency-upgrade issues

A dependency upgrade that ships to users needs its own issue (the `[Misc]` split is in
[[commit-messages]]): summary `Upgrade to <dependency> <version>`, component **Dependency Upgrades**.
The description is the **raw release-note URLs of every version being crossed** — one line each, from
the version after the one currently declared up to the target — not just the target's; skipping the
intermediates hides the changes actually being pulled in. Keep them as bare URLs, which means setting
the description over REST: `jira-cli` runs a body through its Markdown converter and rewrites a plain
URL as `[url|url]`.

## Flickering tests

A test that fails intermittently gets its own issue, and two things make it findable later:

- the **`flickering` label**, which is what the "Flickering tests" filter
  (https://jira.xwiki.org/issues/?filter=14240, linked from every Release Plan) selects; and
- the **"Flickering Test" field** (`customfield_10870`), holding the fully-qualified test as
  `org.xwiki.search.test.ui.AllIT$NestedSolrSearchIT#searchExclusions` — the exact form CI reports,
  so tooling can join a CI failure to its issue instead of guessing from the summary. Fill it in.

**Querying that field from JQL has two traps**, so the shared lookup
(`xwiki/scripts/jira-flickers.mjs`) avoids it entirely — it fetches the flicker issues and matches
the field in memory. If you do write the JQL by hand:

- **`=` is rejected** outright: *"The operator '=' is not supported by the 'Flickering Test' field."*
  Only `~`, `is EMPTY` and `is not EMPTY` work.
- **`~` matches tokens, not substrings**, and the tokeniser splits on `$`. So
  `"Flickering Test" ~ "RecycleBinIT"` returns **nothing** while
  `"Flickering Test" ~ "NestedRecycleBinIT"` returns the issue. Searching by the plain class name
  silently finds no issue for a test that has one — which, in an auto-filer, is how a duplicate gets
  created.

Also note a test may have **several** closed issues over the years. Order by key descending and take
the newest: the oldest one's fix versions describe a fix that shipped long ago and say nothing about
whether the *current* recurrence has been fixed on your branch.

## The documentation fields

Two custom fields record where a fixed issue ended up documented, and they are independent of each
other:

- **"Documentation"** (`customfield_10270`) — the URL of the page documenting the change.
- **"Documentation in Release Notes"** (`customfield_10273`) — the URL of the release-note entry, or
  `N/A` for an extension that is not bundled in XWiki Standard, which has no per-issue entry to point
  at ([[../processes/release-notes]]).

Both take an absolute URL (several are space-separated), or exactly **`N/A`** — no parenthetical,
no sentence, because `= "N/A"` is what makes "find every fixed issue nobody documented" a query.
Never write an anchor into them: it is derived from the entry title and breaks when the entry is
retitled. Filtering trap: `Documentation` does **not** support the `!=` JQL operator (400 from the
search API) — use `is EMPTY` / `is not EMPTY`. Each field holds at most **255 characters**, a longer
value being rejected with a 400, so a change documented on more pages than fit names the primary
ones there and the rest in a comment. The rest, including how an entry is created, is in
[[../processes/release-notes]]; the procedure is the **`xwiki-release-documentation`** skill.

## Resolving / closing an issue

Choose the **resolution** that matches reality and **assign the issue to yourself** as you close it
(you are the one resolving/verifying it). The distinction that is easy to get wrong:

- **A change fixed it** → resolution **Fixed** (set the Fix Version/s where the project has them).
- **The reported problem no longer occurs, but no single change fixed it** — it was already
  implemented or fixed as a *side effect* of other work, so there is no commit to attribute — →
  resolution **Cannot Reproduce**, *not* Fixed (Fixed would falsely imply a dedicated fix and a Fix
  Version). Add a comment saying why it can no longer be reproduced (what now covers it). Example:
  `XDOCKER-83` ("Support for ARM architectures") was closed **Cannot Reproduce** once the image had
  become multi-arch as a side effect of other work, with no ARM-specific fix to point at.

### Fill the two documentation fields when closing

Closing an issue is also where its documentation is accounted for, so that release notes are built
progressively instead of being reconstructed on release day. Fill **both** JIRA fields on the issue:
the **documentation** field (the xwiki.org reference page documenting it) and the **release note**
field (for the version(s) in Fix Version/s).

- Put the literal string **`N/A`** in a field that genuinely does not apply — never leave it empty:
  emptiness is what a JQL query looks for to find undocumented issues.
- A bug fix with **no** user- or developer-visible impact is the `N/A` case. But a bug fix that changes
  the user experience **still needs a release-note entry**.
- Documentation written **after** the issue closes — a separate doc task, a later session — leaves the
  documentation field unfillable at close time, and it is then the half that silently stays empty while
  the release-note field still gets its `N/A`. Filling it in is the **last step of the doc task**, over
  every issue that task documents.

Set the transition + resolution with `jira-cli` (`jira issue move {KEY} "Close Issue"`) or REST
(`POST /rest/api/2/issue/{KEY}/transitions` with
`{"transition":{"id":…},"fields":{"resolution":{"name":"Cannot Reproduce"}}}`). **List the issue's
available transitions first** (`GET …/transitions`) — transition names/ids vary per project and
workflow state, and a close may be gated behind an intermediate state.

## Attachments (screenshots)

**A change with a visible result carries its before/after images on the issue** — a new feature, an
improvement or a fix alike, and a "before" whenever the issue reports a regression. The issue is what
whoever writes the release note, or reopens the bug years later, actually reads. This holds
independently of any pull request: a fix committed straight to `master` has no PR body to show it, and
is exactly the case where the images are otherwise never captured. Producing them is also the check
that the change works — a test asserts only what it was written to assert.

`jira-cli` has **no `attach` command** — attaching is REST-only, and Atlassian requires the
`X-Atlassian-Token: no-check` header on multipart uploads:

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" -H "X-Atlassian-Token: no-check" \
  -F "file=@shot.png" https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345/attachments
```

The response gives the attachment's `content` URL
(`https://jira.xwiki.org/secure/attachment/<id>/<name>`), public for a public project and stable.
That URL is also how an image reaches a **GitHub PR body**, which can only reference an already
hosted one since `gh` cannot upload: attach to the issue first, then link it from the PR.

## Wiki-markup gotchas (descriptions and comments)

Both descriptions and comments use the **JIRA wiki renderer**. Governing rule: **pick the right
container, escape only *active* markup — never over-escape, and never escape inside code blocks.**

- **Literals → monospace.** Wrap identifiers, flags, filenames and short commands in `{{…}}` (e.g.
  `{{JAVA_OPTS}}`, `{{-e JAVA_OPTS="-Dhttp.proxyHost=…"}}`). It reads as code and removes any need to
  escape the punctuation inside — the preferred style, cleaner than backslash-escaping. **Exception:
  issue keys** — never monospace them (see below).
- **Do not over-escape prose.** Most punctuation is already literal: `-`, `(`, `)`, `.`, `/`, `:`, and
  an underscore **inside a word** (`JAVA_OPTS` renders fine — `_italic_` only triggers at word
  boundaries). A backslash is only needed to stop *active* markup: line-leading `*`/`#`/`-` (lists),
  `*bold*`, `_italic_`, `+ins+`, `[link]`, `{macro}`, `|` in tables.
- **Issue keys → plain, never decorated.** Write a key as bare text (`XWIKI-123`) so JIRA auto-links
  it. Both **backslash-escaping** (`XWIKI\-123`) and **monospacing** (`{{XWIKI-123}}`) suppress the
  auto-link — the monospace case is the easy mistake, since the "literals → monospace" rule otherwise
  encourages wrapping identifiers.
- **Never escape inside `{code}` / `{noformat}` blocks.** Their content is literal, so a backslash
  added to "escape" markup renders as a **visible backslash** (`\- JAVA\_OPTS=…` shows the `\-`/`\_`).
  Put the **raw** snippet in the block; escaping is a *prose* concern only.
- **`{{monospace}}` specifics.** It preserves angle brackets (`{{<version>/solr/}}` → `<version>/solr/`),
  so short `<…>` tokens are fine inline — but it must not be glued to an adjacent word character:
  `{{curl}}s` fails to parse and renders literally as `{{curl}}s` (add a space or reword). For
  multi-line commands or `sed`/XML/YAML, use a `{code}`/`{noformat}` block (raw), as good descriptions do.

**Editing a comment** (e.g. to fix a mis-rendered one) is REST-only — `jira-cli` cannot edit
comments: `PUT /rest/api/2/issue/{KEY}/comment/{ID}` with JSON `{"body": "…"}`. **Verify** afterwards
via `GET …/comment/{ID}?expand=renderedBody`: no stray backslashes in `<pre>`, no literal `{{…}}`, and
the intended monospace/links present — don't trust the source you sent.

## Identifying the current LTS (for the Affects-Version fallback)

XWiki dev runs in yearly **cycles** `X.0 → X.10`; the final **`X.10`** line of the **last completed**
cycle is the current LTS (the in-progress cycle's `.10` does not exist yet), and the previous cycle's
`X.10` typically still gets overlap patches. So while dev is on `18.x`, the current LTS is the
`17.10` line. This mapping is **volatile** — verify, do not cache the number.

## Verifying the volatile values

- **Current dev version** (drives Fix Version) → read the repo root `pom.xml` `<version>`, or SNAPSHOT
  jar names under `~/.m2` / nexus (see [[index]] and [[versioning]]).
- **Which JIRA version names exist / are released** →
  `GET https://jira.xwiki.org/rest/api/2/project/XWIKI/versions` (each entry has `released` and
  `releaseDate`); the latest released feature line and the current LTS are read from there.
- **Support strategy / which lines are supported LTS** → WebFetch the `sources:` SupportStrategy page.
