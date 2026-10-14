# Filing, or commenting on, a flicker issue

Read by `xwiki-ci-check` (SKILL.md §5) before filing a flicker issue or commenting on one. § numbers
are those of SKILL.md.

File one **only when the incident carries a `flickerGroup`** — which the tool sets for a `flicker`
that is `proven` (failed in ≥ 2 distinct builds across ≥ 2 distinct days), has no `jira`, is not
answered whole by a `fixState` — filing an issue is a write, and §3's rule is that an answered
incident earns none — and carries its cause (`primary` is not `false`): a peer under a primary that
fails every build belongs to a test that is broken, not flaky, and the breakage is what gets
reported and commented on. Everything else is listed in the paste under "Flickers not filed", with the
reason on its line: a failure seen once is not a flicker, it is an event — and that is exactly the
shape of a Docker or GitHub blip. The evidence threshold *is* the confirmation step, made
structural, because a routine running at 06:00 has nobody to ask.

**One issue per `flickerGroup`, never one per incident.** Several methods of one test class that
started failing in the same build broke together, and the same test failing on three branches is one
flaky test: filing an issue each is how an auto-filer is switched off in its first week. So:

- every incident sharing a `flickerGroup` value goes into **one** issue, and its `alsoOn` branches
  are named in that issue rather than filed again;
- the **summary names the test class and every method** — `NotificationsSettingsIT flickers on
  16.10.x: notificationFiltersDefaultValues, globalAndOtherUserSettings, watchAndRename`. This is
  not cosmetic: `scripts/jira-flickers.mjs` joins a CI failure to its issue by the "Flickering Test"
  field first and by *class + method in the summary* second, so a method missing from both is a
  method tomorrow's run files an issue for again;
- the **"Flickering Test" field holds one test** — the first of the group — and the description
  lists every affected test id verbatim, plus every branch.

Before invoking `xwiki-jira`, export the bot credential into the variable that skill reads —
`JIRA_API_TOKEN="$JIRA_TOKEN_BOT" JIRA_AUTH_TYPE=bearer` — so the issue (or the comment) is the
bot's even on a machine where the developer's own JIRA token is configured.

Use `xwiki-jira`, with the flicker fields from `okf/servers/jira.md` (the `flickering` label **and**
the "Flickering Test" custom field, holding the test exactly as CI reports it). In a local run, file
one only after the developer has said yes to it by name (§0). Auto-filed issues are
**unassigned** — a flicker usually has no culprit, and a wrong auto-assignment discredits the whole
system.

If the flicker matches a **closed** issue — `jiraClosed` is set, and the tool has already withheld
the `flickerGroup` for exactly this reason: **comment on it and leave it closed** (not on the line
`references/fix-signals.md` keeps out of public artifacts), and flag it in the digest. Reopening overrides someone's triage decision; filing a duplicate is worse than both.
That holds even when a Fix Version is still unreleased (`jiraClosed.unreleased`), the one case
`okf/servers/jira.md` lets the issue be reopened: the comment says so, and a human decides.

A locally-filed flicker issue **cannot duplicate tomorrow's routine**: the routine files only a
`proven` flicker whose `jira` is null, and that field comes from a live JIRA lookup, so the issue
filed today is what makes tomorrow's run stay quiet. These thresholds hold locally in full — the
evidence bar and one issue per `flickerGroup` are what make an auto-filer tolerable, and a developer
saying yes is not a reason to file on weaker evidence than a routine would.

A local *issue* is filed as the bot when `JIRA_TOKEN_BOT` is set and **as the developer otherwise**
— unlike a comment, an auto-filed flicker issue is unassigned and addressed at nobody, so a personal
name on it is an authorship, not an accusation, and the developer who said yes is a fair author.