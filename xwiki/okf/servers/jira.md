---
title: JIRA (jira.xwiki.org) — access and issue-field conventions
stability: durable
summary: How to reach the self-hosted XWiki JIRA (jira-cli or REST), when an issue should be filed at
  all, the durable conventions for an issue's Component, Affects Version/s and Fix Version/s, and
  when to assign it. Version values themselves are volatile.
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

**A fix that turns out incomplete is finished under its own issue only while none of its Fix
Version/s is released**: reopen it and land the follow-up under its key, with the same backport labels
as the first PR. Once **any** of them is released (check each one's `released` flag live,
`GET /rest/api/2/issue/<KEY>?fields=fixVersions`, stable branches included), never reopen it; file a
new issue linked as `Related`. An issue's commits must never span released versions, or its Fix
Version stops saying where it was fixed (upstream rule "Don't reopen issues closed for a released
version"). The one exception is an issue closed without commits (Won't Fix, Duplicate, …), which may
be reopened. The Affects Version tell above misses this case, since the defect usually predates the
dev version.

A change with no effect on users or extension developers (refactoring, build-only work) needs no
issue; when one is filed anyway it takes the **`Development Issue Only`** component, which is excluded
from the release notes.

## Issue-field conventions (every issue type)

These field conventions are **durable**; the version *values* they resolve to are volatile (see
below). When filing/curating an issue — Bug, Improvement, New Feature **or Task** — set:

- **Component/s** — always set at least one (e.g. `REST`, `Rendering`, `Platform - …`). Required for
  triage; do not leave empty.
- **Affects Version/s** — always set, per [[versioning]].
- **Fix Version/s** — the version the fix ships in: normally the next release of the current dev
  version. Note the naming: JIRA version names use dashes (e.g. `18.7.0-rc-1`), whereas the source
  `@since` / `@Deprecated(since=…)` tag for the *same* release uses `18.7.0RC1` — see [[versioning]]
  for the tag format. Add the stable-branch fix versions too when the fix is backported.
- **Issue links** — link every related issue it names (the one that introduced the code involved, the
  one it follows up on, …) with a real JIRA link, by default **`Related`**; naming it in the
  description alone does not show up in either issue's links.

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

Joining a CI failure to its issue is done by the shared `xwiki/scripts/jira-flickers.mjs`, not by
a query of your own — the field has JQL quirks and a test can carry several issues, and that module
documents and handles both.

## The documentation fields

Two custom fields record where a fixed issue ended up documented, and they are independent of each
other:

- **"Documentation"** (`customfield_10270`) — the URL of the page documenting the change.
- **"Documentation in Release Notes"** (`customfield_10273`) — the URL of the release-note entry,
  or, for an extension not bundled in XWiki Standard, of its version page on extensions.xwiki.org
  ([[../processes/release-notes]]).

Both take an absolute URL (several are space-separated), or exactly **`N/A`** — no parenthetical, no
sentence, because `= "N/A"` is what makes "find every fixed issue nobody documented" a query. Never
write a release-note entry's anchor into them: it is derived from the entry title and breaks when
the entry is retitled. A `Documentation` URL does carry the anchor of the section documenting the
change when that is one section of a larger page. Filtering trap: `Documentation` does **not**
support the `!=` JQL operator (400 from the search API) — use `is EMPTY` / `is not EMPTY`. Each
field holds at most **255 characters**, a longer value being rejected with a 400, so a change
documented on more pages than fit names the primary ones there and the rest in a comment. The rest,
including how an entry is created, is in
[[../processes/release-notes]]; the procedure is the **`xwiki-release-documentation`** skill.

A security issue's GitHub security advisory is **not** documentation: it goes in a **web link**
titled `Security Advisory` (`POST /rest/api/2/issue/<KEY>/remotelink` with
`{"object": {"url": "<GHSA URL>", "title": "Security Advisory"}}`) — not in `Documentation`, a
comment, or a label such as "draft security advisory", which goes stale once the advisory is published.

## Starting work on an issue

**Assign the issue to the developer as soon as work on it starts** — before the fix is written, an
issue just filed included, on JIRA and OpenProject alike — so the team sees it is taken. One already
assigned to someone else is theirs: ask the developer instead of reassigning it. Asking you to work
on an issue is the developer's approval to assign it.

## Linking the pull request

OpenProject does not list a work package's GitHub PRs yet (its **GitHub** tab stays empty): comment
the PR's URL on the work package once the PR is opened (`notify=false`).

## Resolving / closing an issue

Choose the **resolution** that matches reality and **assign the issue to yourself** as you close it
(you are the one resolving/verifying it). The distinction that is easy to get wrong:

- **A change fixed it** → resolution **Fixed** (set the Fix Version/s where the project has them).
- **A change made for another issue fixed it** → **Solved By**, linked to that issue, with **its Fix
  Version/s**, so that querying JIRA by version finds it (e.g. a security issue fixed by a
  non-security change).
- **A commit lacking the issue's key fixed it** (e.g. `[Misc]`) → **released**: **Duplicate**, with a
  comment giving the commit URL; **unreleased**: comment that the key was omitted by mistake, and
  close it **Fixed** before the release, since it now carries committed code.
- **The reported problem no longer occurs, but no single change fixed it** — it was already
  implemented or fixed as a *side effect* of other work, so there is no commit to attribute — →
  resolution **Cannot Reproduce**, *not* Fixed (Fixed would falsely imply a dedicated fix and a Fix
  Version). Add a comment saying what now covers it (e.g. `XDOCKER-83`, ARM support that came with
  the image becoming multi-arch).
- **Won't Fix, Duplicate, Cannot Reproduce, Incomplete** → **no Fix Version/s**, or the issue shows
  up in that version's release notes.

### Fill the two documentation fields when closing

Closing an issue is also where its documentation is accounted for, so that release notes are built
progressively instead of being reconstructed on release day. Fill **both** fields (see *The
documentation fields* above), the release-note one for the version(s) in Fix Version/s, with **`N/A`**
in one that genuinely does not apply — never leave it empty.

- A bug fix gets a release-note entry only when it is **noteworthy** to someone deciding whether to
  upgrade — not merely because it is user-visible, which nearly every bug fix is. One that just
  restores the documented behaviour is `N/A`: the release note already lists it among the issues
  fixed. The full test is §4 of the `xwiki-release-documentation` skill.
- Documentation written **after** the issue closes — a separate doc task, a later session — leaves the
  documentation field unfillable at close time, and it is then the half that silently stays empty while
  the release-note field still gets its `N/A`. Filling it in is the **last step of the doc task**, over
  every issue that task documents.

Set the transition + resolution with `jira-cli` (`jira issue move {KEY} "Close Issue"`) or REST
(`POST /rest/api/2/issue/{KEY}/transitions` with
`{"transition":{"id":…},"fields":{"resolution":{"name":"Cannot Reproduce"}}}`). **List the issue's
available transitions first** (`GET …/transitions`) — transition names/ids vary per project and
workflow state, and a close may be gated behind an intermediate state.

## Bulk edits

Each edit emails the issue's watchers; `PUT /rest/api/2/issue/{KEY}?notifyUsers=false` skips that,
Closed issues included. **Ask the developer before making a bulk edit silent** — watchers may need
to see the change.

## Attachments (screenshots)

**A change with a visible result carries images of that result on the issue** — a new feature, an
improvement or a fix alike — **plus a "before" when it fixes existing UI**, a regression included.
A new feature has no "before" to show. The issue is what whoever writes the release note, or reopens
the bug years later, actually reads. This holds independently of any pull request: a fix committed
straight to `master` has no PR body to show it, and is exactly the case where the images are
otherwise never captured. Producing them is also the check that the change works — a test asserts
only what it was written to assert.

`jira-cli` has **no `attach` command** — attaching is REST-only, and Atlassian requires the
`X-Atlassian-Token: no-check` header on multipart uploads:

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" -H "X-Atlassian-Token: no-check" \
  -F "file=@shot.png" https://jira.xwiki.org/rest/api/2/issue/XWIKI-12345/attachments
```

The response gives the attachment's `content` URL
(`https://jira.xwiki.org/secure/attachment/<id>/<name>`), public for a public project and stable.
A **GitHub PR body** gets its own upload (`xwiki-pull-request`), and links this URL only when it
cannot.

## Wiki-markup gotchas (descriptions and comments)

Both descriptions and comments use the **JIRA wiki renderer**. Governing rule: **pick the right
container, escape only *active* markup — never over-escape, and never escape inside code blocks.**

- **Literals → monospace.** Anything that is not prose — an identifier, flag, path, command, or a
  snippet of any syntax (XWiki, Velocity, XML, shell) — goes in `{{…}}` (e.g. `{{JAVA_OPTS}}`,
  `{{$doc.display("x")}}`). **Exception: issue keys** — never monospace them (see below).
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
- **`{{…}}` is a style, not a raw container.** JIRA markup inside it still renders (`{{_foo_}}` comes
  out italic, `{{<!--x-->}}` with `x` struck through, `{{[x]}}` as a broken link), so backslash-escape
  it there (`{{\_foo\_}}`, `{{<!\-\-x\-\->}}`). Angle brackets survive (`{{<version>/solr/}}`). It must
  not be glued to a word character: `{{curl}}s` renders literally (add a space or reword).
- **A `{name}` placeholder is a macro call**, the classic case being a REST path template
  (`/wikis/{wiki}/spaces/{space}/…`): it breaks the `{{…}}` span *and* the list around it. Write
  `<wiki>`, which always survives; `\{wiki\}` works mid-span but not right before the closing `}}`.
- **A literal spanning lines goes in a `{code}`/`{noformat}` block** (raw).
- **An inline XWiki macro takes its braces as numeric entities:** `{{&#123;&#123;velocity&#125;&#125;}}`
  renders as monospace `{{velocity}}`. Backslashes do not work there, and unescaped braces end up
  outside the monospace.

**Preview before writing, verify after** — reading back the source you sent proves nothing. Before
any description or comment write, `POST /rest/api/1.0/render` with
`{"rendererType": "atlassian-wiki-renderer", "unrenderedMarkup": "…"}` returns the HTML and writes
nothing; afterwards, read it back rendered (`GET /rest/api/2/issue/{KEY}?expand=renderedFields`, or
`…/comment/{ID}?expand=renderedBody`): no stray backslashes in `<pre>`, no literal `{{`/`}}`, every
list item an `<li>`, and the intended monospace/links present.

**Editing a comment** (e.g. to fix a mis-rendered one) is REST-only — `jira-cli` cannot edit
comments: `PUT /rest/api/2/issue/{KEY}/comment/{ID}` with JSON `{"body": "…"}`.

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
- **Support strategy / which lines are supported LTS** → `curl` the `sources:` SupportStrategy page.
