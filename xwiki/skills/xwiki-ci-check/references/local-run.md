# A local run

Read by `xwiki-ci-check` (SKILL.md §0) at the start of every run without `--write`. The ask-once
rule of SKILL.md §0 holds whatever this file says. § numbers are those of SKILL.md.

The one question names the write: *post the detail to PrivateBin?*, *comment on `a1b2c3d` (jdoe)?*,
*file the `NotificationsSettingsIT` flicker issue?*, *open the checkstyle fix PR?*

Local mode needs **no bot credential** for the sweep, the analysis or the paste (PrivateBin is
anonymous and carries no identity), so a developer with nothing configured gets a complete run. A
local *comment* still needs `GH_TOKEN_BOT`; without it, skip that offer and say so.

A local run is usually about one thing, so scope the sweep when the developer named one:
`ci-check.mjs --repos xwiki-platform --branch master` is a few seconds and a handful of incidents
instead of twenty jobs.

In a **local run the detail document is the deliverable** — print it, or its incidents at least, and
then ask whether to paste it. There is no digest to write, so the paste question is the last one.

`privatebin.mjs` prints instead of posting when `--write` is absent, so the paste of a local run
carries it only once the developer has agreed.

Why the `--write` brake is structural: the bot credentials live in a developer's shell profile as
well as in the routine's secret store.

A local run adds to the report's "not written" half what the mode itself withheld: the digest it did
not post, and anything the developer declined.