# The routine prompt

What the scheduled Claude routine is given, and nothing more. It names the skill and the mode; all
behaviour lives in `SKILL.md` and `tools/`, which are versioned, validated and reviewed. **Changing
what the routine does is a pull request to `xwiki-dev-llm`, not an edit to an unreviewed routine
config** — and going live changes one word.

**Schedule: 06:00 Europe/Paris, daily.** After the overnight builds finish (a platform build takes
3.4–6.5 h) and before anyone starts work. Monday's run covers the weekend on its own; the 7-day
blame horizon already handles the backlog that accumulates over one.

**Model: Opus 5** for the dry-run period, to establish what a good diagnosis looks like. Only then
try a cheaper model and compare the two runs' logs side by side — choosing cheap up front means
never knowing whether a weak diagnosis was the model or the design.

## Dry run (start here, and stay here for a few days)

```
Run the xwiki-ci-check skill. Dry run: write nothing anywhere — print the digest, the paste body,
and every commit comment, JIRA issue and pull request you would have created, in full, to stdout.
There is nobody to answer a question, so do not ask one: treat every write as declined.
```

Omitting `--write` is already enough — the skill's default mode writes nothing and every writer tool
under `tools/` is a no-op without its own `--write`. The wording above says it out loud so that the
log of a soak run is readable as a rehearsal, and so that the one-word difference from the live
prompt is visible to whoever edits the routine next.

Read the run logs for a few days. You are looking for: is the blame right? is the wording of a
`likely` comment actually asking rather than accusing? would any of those PRs have been wrong?

## Live

```
Run the xwiki-ci-check skill with --write.

Personal overrides on top of the skill:
* Any commit you make carries the bot as its author: --author="XWiki LLM Bot <llm-bot@xwiki.org>".
* Once a fix PR is created, assign it to the culprit author and lock it to collaborators with a PUT
  to /repos/{owner}/{repo}/issues/{pull_number}/lock.
```

## Environment the routine needs

- **Bot credentials** (never a developer's account), in the routine's secret store:
  - `GH_TOKEN_BOT` — a **classic** token with `public_repo`. It posts the commit comments and
    nothing else. Do not expect it to push: `xwikiorg-llm-bot` has `push: false` on all three repos,
    which is correct and not a misconfiguration (see the PR note below).
  - `JIRA_TOKEN_BOT` — the skill maps it onto `JIRA_API_TOKEN` when invoking `xwiki-jira`, so the
    developer's own JIRA credential is never the one filing.
  - `MATRIX_USER_BOT` + `MATRIX_PASSWORD_BOT` — **the password, not `MATRIX_TOKEN_BOT`.** matrix.org
    issues short-lived `mat_` tokens, so a token in a secret store is expired before the first run;
    `matrix.mjs` logs in per run on a fixed device instead.
  - Optional, all defaulted: `MATRIX_HOMESERVER` (`https://matrix.org`),
    `MATRIX_ROOM` (`#xwiki:matrix.xwiki.com`), `XWIKI_CI_PASTE_URL` (`https://bin.xwikisas.com/`).
- **Checkouts** of `xwiki-commons`, `xwiki-rendering`, `xwiki-platform` and `xwiki-dev-llm`, which
  are what the fix PRs of §5 are written and verified in. Without them the skill fails closed: no
  PR, which is the safe outcome but is still an outcome to know about.
- **The setup script: `xwiki/scripts/routine-setup.sh`**, pasted into the routine's setup field. A
  sandbox is new every run, so everything past the checkouts is installed there every time — `gh`,
  the plugin itself, JDK 17 and 21, `xmvn`, and an `~/.m2/settings.xml` pointing at XWiki's Nexus.
  It is shared with the SonarCloud routine; keep it that way rather than letting two copies drift.
  **`xmvn` and the two JDKs are what make one sandbox able to verify a fix on any branch**: it reads
  `xwiki.java.version` from the pom and exports the matching `JAVA_HOME`, the maintained branches
  wanting 17 up to stable-17.10.x and 21 from stable-18.4.x on, and a build on a too-new JDK fails
  in ways that read as code problems and are not.
- **The Claude GitHub App**, installed on the `xwiki` org — that, and not `GH_TOKEN_BOT`, is what
  pushes a fix branch and opens the PR, exactly as it does for the SonarQube routine. The branch
  lives in the upstream repo (`claude/<slug>`); there is no fork anywhere in this design.
- The `xwiki` plugin loaded, so the skill and the shared `scripts/` are present.

Without the bot credentials the skill does that channel in rehearsal and says so; it never falls back
to a personal account.

## Running it by hand

A developer can run `/xwiki-ci-check` on their own machine at any time — before a release, or when
something looks wrong at 11am. That run is the skill's **default mode**: it sweeps and analyses,
never posts to Matrix, and asks one question before each of the four writes it may make (the paste, a
commit comment, a flicker issue, a fix PR). It needs no bot credential to be useful: the sweep, the
analysis and the paste all work with nothing configured. Scope it when the question is
narrow — `--repos xwiki-platform --branch master`.
