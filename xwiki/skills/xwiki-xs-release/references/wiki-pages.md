# Pages updated at the end of a release

Each one is edited by others too: re-read it right before writing, match the existing text byte for
byte (some lines carry non-breaking spaces) and read it back.

- **Versions page** (www `Download.Versions`): a Velocity list of
  `[version, date (yyyy-MM-dd), type, release notes reference, bullets]`. An RC appends a
  `development` entry after the `stable` one (`'18.9.0-rc-1'`, the RN reference
  `xwiki:ReleaseNotes.Data.XWiki.18\.9\.0RC1.WebHome`, three short user-facing bullets); a final
  replaces it with its `stable` entry. `bin/get/Download/Versions` returns the parsed list as JSON:
  check the new entry is there.
- **Blog post** (www `Blog`): the **Create a new post** form of the blog home takes the *page name*
  `xwiki-<short>-released`, with the short version of the plan and release notes pages, not the
  JIRA one (`xwiki-18.9.0RC1-released`, never `xwiki-18.9.0-rc-1-released`); then, in the
  editor, the title (`XWiki 18.9.0 Release Candidate 1 released`), the content and the summary (the
  "extract"), and the categories the help gives for the kind of release (an RC: **Releases** only).
  The content is the help's text around the release notes summary; the summary is the same as one
  paragraph. Both editors are CKEditor: switch them to **Source** and write the source textarea of
  each instance, not the hidden form fields, which the editor overwrites on save. Read
  `Blog.BlogPostClass` back over REST (`published` tells whether it is out).
- **Roadmap** (www `Roadmaps.WebHome`): the RC line is under the month's roadmap, in its
  `== Dates ==` section (`* 18.9.0RC1: 19th of October 2026`), not in the cycle list at the top,
  which only has the finals. Append ` (/)`; when the release slipped, strike the planned date
  (`--19th of October 2026--`) and write the actual one before the tick.
- **Release-manager list** (dev `ReleasePlans.WebHome`, "Next Release Managers"): the release
  manager moves their line to the bottom, as `<user> - Not defined yet`. The next two of the list
  are the ones to ping.
- **Plan release date** (`ReleasePlanClass.releaseDate`, format `dd/MM/yyyy`): the date the git
  tags were created, which may differ from the planned one.
