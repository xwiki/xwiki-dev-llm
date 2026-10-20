---
name: xwiki-xs-release
description: Help the release manager perform an XWiki Standard release (xwiki-commons, xwiki-rendering and xwiki-platform together, e.g. 18.9.0RC1) by driving its Release Plan on dev.xwiki.org — create the plan, run the release-day checks before the build, prepare and review the release notes, create the JIRA filter and dashboard, update the Versions page, Roadmap, blog post and release-manager list, clean up the previous stable branch, draft the announcements, and tick each step done. The build on the release machine stays with the release manager. Use when asked to do, continue or check the status of an XWiki release or one of its Release Plan steps. Not for an xwiki-contrib extension (use xwiki-contrib-release). For the CI step it hands off to xwiki-release-test-triage, for missing issue documentation to xwiki-release-documentation, for JIRA calls to xwiki-jira.
---

# XWiki Standard release

The source of truth is the **Release Plan** of the version,
`https://dev.xwiki.org/xwiki/bin/view/ReleasePlans/ReleasePlan<short>` (`<short>`: `18.9.0RC1`,
`18.9.0`, `18.4.8`), and its help page **ReleasePlanHelp**: read both live at every session, since
the release managers edit them. This skill adds what they leave implicit. It was written from an RC
release: for a final or bugfix release, follow the plan's extra steps from the help and tell the
developer which ones this skill does not cover yet.

## Working rules

- **Read the plan first to know where the release stands**: the page content is a Velocity template
  whose items carry `(x)` (to do), `(/)` (done) or `(!)` (skipped, with the reason). Items inside
  `#if ($isFinal)`, `#if ($isFirstLTS)`… are not rendered for this version: ignore them. The
  computed queries (JQL with the previous release date, version strings) are only in the rendered
  page: take them from the `href`s of `bin/view/…?xpage=plain` rather than re-implementing the
  Velocity.
- **Reads are free; every write needs a yes**, step by step: JIRA, the wikis, GitHub, Jenkins. A
  confirmation covers what it names, not the next step.
- **Tick only what is actually done**, by you or by the developer, then read the page back. Before
  writing a page, re-read it and check its `version` is the one you read: the release manager edits
  the same pages in parallel.
- **The release machine is the release manager's**: logging on, identity, the build
  (`maven-release.sh`, about two hours), the translations/contributors/compatibility reports it
  publishes, cleaning up the identity. Help with their questions — when releasing `X.Y.0-rc-1`,
  "next SNAPSHOT version?" is `X.Y.0-SNAPSHOT`, for `X.Y.Z` it is `X.Y.(Z+1)-SNAPSHOT` — and use
  the time to prepare the later steps.
- **Security issues are restricted**: report counts and scores, never their titles, in anything
  that leaves the session.
- Access to dev.xwiki.org (the `dev` subwiki), www.xwiki.org and their REST API, the User-Agent and
  `~/.xwiki-credentials`: `okf/servers/index.md`. JIRA: `xwiki-jira`.

## Creating the plan

The **Create Release Plan** form of `ReleasePlans.WebHome` takes the version in JIRA form
(`18.10.0-rc-1`) and opens `ReleasePlans.ReleasePlan<short>` from `ReleasePlanTemplate`; fill the
release manager and the planned date (`ReleasePlanClass`, date format `dd/MM/yyyy`).

## Release day, before the build

The RC is built from the `stable-X.Y.x` branches created the Wednesday before (a plan section of
its own). The checks, all read-only:

- **CI**: hand off to `xwiki-release-test-triage` on `stable-X.Y.x` of the three repos (a background
  agent: it takes a while).
- **`xwiki.compatibility.previous.version`** in the xwiki-commons root POM of the release branch
  equals the latest *final* release, bugfix releases of the previous cycle included. While there,
  check that every active Revapi ignore in the three repos has a `<criticality>`: one without it
  shows up as an empty "Unknown Criticality" violation in the release notes.
- **Open issues with commits** (the plan's JQL): what ships is the whole cycle,
  `git log stable-X.(Y-1).x..stable-X.Y.x` in each repo, subjects *and* bodies — not
  `compare master...stable-X.Y.x`, which only shows what was cherry-picked after the branch. A
  candidate with no commit in that range only has PR or feature-branch commits: a false positive.
  Also check that every issue key in that range is closed with the version as Fix Version, or it is
  missing from the release notes.
- **The next version exists** in XCOMMONS, XRENDERING and XWIKI (for an RC, `X.Y.0`); creating a
  missing one is a write.
- **No open issue for the version and no open Blocker** (the plan's JQL).

## During and after the build

- **Release notes page**: `xwiki:ReleaseNotes.Data.XWiki.<short>` on www.xwiki.org, a nested page
  (`…/spaces/<short>/pages/WebHome` over REST). Fill the template placeholders: the summary (below),
  the dashboard link, `<version - 1>` (the previous final). Entries come from the Release Notes
  Application (`okf/processes/release-notes.md`, which holds the rules an entry is reviewed
  against).
- **Summary**: one paragraph, the user-visible highlights first (an administrator or technical item
  such as clustering does not belong there), then "For developers, …", then
  `This release contains security fixes, with the [[highest severity being N/10>>doc:dev:Community.SecurityPolicy.WebHome||anchor="HSeverity"]].`
  The highest severity is the max of JIRA's **CVSS Score** field over the `labels = security`
  issues of the version, cross-checked with the repository security advisories. An unscored one is
  usually solved by another issue (its "Solved By" link) or not confidential at all.
- **Missing documentation**: draft a Matrix message pinging the assignees (mentions below), or
  hand off to `xwiki-release-documentation` when the developer asks for it.
- **Review the release notes only once the documentation is filled**: those fields bring new
  entries. Then check the rendered page: no leftover `<…>` placeholder, no render error, the
  API Breakages section (it lists `highlight` and `documented` ignores only, so "No breakage!" is
  normal with `allowed` ones), Moved Modules filled or removed (`<module>` changes in the POMs of
  the cycle), the summary still matching the entries.
- **Filter and dashboard**: `references/jira-dashboard.md`.

## Publishing and cleaning up

- **Versions page, blog post, Roadmap, release-manager list, plan date**: their formats and traps
  are in `references/wiki-pages.md`. The release manager may want to publish the blog post
  themselves: create it unpublished unless told otherwise.
- **Previous stable branch** (an RC only): delete `stable-X.(Y-1).x` — never an LTS branch — in
  the three repos, after recording each tip SHA and checking no open PR targets it, then its four
  Jenkins branch jobs (`XWiki/xwiki-{commons,rendering,platform}` and
  `XWiki Environment Tests/xwiki-platform`), then its unreleased JIRA versions. From a logged-in
  ci.xwiki.org page, `POST …/job/<branch>/doDelete` with the crumb of `/crumbIssuer/api/json` avoids
  the confirmation dialog; the platform job takes a minute to go, so poll for its 404.
- **Announcements**, drafted for the release manager to post:
  - **Mastodon** (the xwikiorg account): `#XWiki <short> has been #released! Check it out: <RN URL>`
    then the summary without links. The limit is 500 characters, each URL counting 23: the full
    summary does not fit, so condense it and count before handing it over.
  - **Matrix**: ping the next two release managers of the list, and post an `[ANN] XWiki <short>
    has been released!` message (summary, release notes and blog URLs; for an RC, a call to test it
    before the final's date). Mentions follow `okf/servers/index.md`.
