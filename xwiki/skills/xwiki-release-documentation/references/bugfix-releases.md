# Bugfix releases

Read by `xwiki-release-documentation` (§1) when the version is a bugfix release (`X.Y.Z`, `Z > 0`)
or an issue in scope has one among its Fix Versions. An entry is **never** posted against a bugfix
version: its release-note page renders the `{{jira}}` list of fixed issues instead of the entries.

**That is a fact about the page, not about the issues.** A bugfix release is mostly bug fixes, which
§4 sends to `N/A` anyway — but **improvements do get slipped into one when they are what
fixes the bug, and an improvement needs its entry here as much as anywhere**. Every issue in one
is also fixed forward, so its Fix Version list names the `.0` or RC version too, and *that* is where
its entry goes and renders. The bugfix note is not left silent: its `{{jira}}` list covers the issue
by summary, and the feature note carries the prose.

So the triage row for a bugfix sweep carries the RC alongside the bugfix version, and its release
status with it — an entry against an **already-released** note is a retroactive edit and needs the
developer's say-so.

`verify:` both halves, which are cheap and settle any argument — `GET …/releasenotes/XWiki/<a
bugfix version>/changes` returns an empty list for every bugfix release; and the improvements and
new features shipped in recent bugfix releases (`issuetype in (Improvement, "New Feature") AND
fixVersion in (…)`) mostly hold an entry URL, every one of them pointing at the feature release's
note. **A field pointing at the bugfix note's `#HNewandNoteworthy…` anchor is not an entry** —
it is a link into the JIRA list, and `okf/servers/jira.md` forbids anchors in the field regardless.
