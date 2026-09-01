---
name: xwiki-pull-request
description: Create a GitHub pull request for an XWiki repo (xwiki-platform, xwiki-commons, xwiki-rendering, xwiki-contrib). Use when opening a PR, writing a PR description, or preparing commits for a PR in an XWiki project.
---

# Creating an XWiki pull request

## Commit messages & PR title

- Reference the JIRA issue, and make the summary line **the issue's title, verbatim** rather than a
  description you compose: `XWIKI-NNNNN: <the JIRA issue title>` (use `XCOMMONS-NNNNN:` in
  xwiki-commons, `XRENDERING-NNNNN:` in xwiki-rendering). Put what the commit actually does in the
  body, as `*` bullets. See `okf/conventions/commit-messages.md`.
- For trivial changes that do not warrant a JIRA issue, prefix with `[Misc] <description>`.
  Do not create unnecessary JIRA issues
  (see https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices).
- Keep **one squashed commit per issue** — the backport automation only works with a single commit.
  Amending it means force-pushing: **always name the remote and the branch** (`git push
  --force-with-lease origin <branch>`). Where `push.default=matching` is set, a refspec-less force
  push rewrites *every* local branch that also exists on the remote, and the lease does not stop it.
- When the change was authored with AI assistance, add AI attribution: a `Co-Authored-By: Claude
  <model> <noreply@anthropic.com>` trailer on the commit and a "Generated with Claude Code" line in
  the PR body.

## PR description — always use the template

Fill `.github/pull_request_template.md` (at the repo root). Complete every section meaningfully:

- **Jira URL** — link the JIRA issue (omit only for `[Misc]` PRs).
- **Changes → Description** — the main changes.
- **Changes → Clarifications** — choices made, links to forum proposals / dependent issues.
- **Screenshots & Video** — whenever the change has a visible result, be it a new feature, an
  improvement or a fix, show it: a reviewer should be able to judge the result without building the
  branch. Add a "before" as well when the issue reports a regression. Put the same image on the JIRA
  issue, where it serves whoever reads the issue or writes the release note later —
  `okf/servers/jira.md` has the how, and its attachment URL is also what a PR body must reference,
  `gh` being unable to upload an image.
- **Executed Tests** — how the change was validated (the `mvn` commands run). Especially important
  for regression fixes.
- **Expected merging strategy** — `Prefers squash: Yes`; list backport branches if any.

## Labels, assignees, branches

- Add `backport stable-xxx` labels to trigger automated cherry-pick PRs onto release branches.
- Assign the committer who will do the final merge; ping reviewers for parts outside their
  expertise. Dependency-upgrade PR default assignees: webjar Maven → @mflorea,
  non-webjar Maven → @tmortagne, npm → @manuelleduc.
- Reserved branch names: `master`/`main`, `stable-xxx`. Cross-repo changes use a shared
  `feature-deploy-xxx` branch in each repo.

## Before opening

- Prove the build is green locally (see the `xwiki-build` skill).
- Create the PR with the `gh` CLI (e.g. `gh pr create`), using the template body.

## Check what the change adds to SonarCloud

**Run a SonarCloud PR analysis on any PR that changes Java, not only on a Sonar cleanup**, whenever a
`SONARQUBE_TOKEN` is available. It applies the same quality gate as the branch and is the *only*
pre-merge check for the rules computed server-side (`javabugs:*` dataflow findings never appear in a
local build or in the IDE). Run it after `gh pr create`, since it needs the PR number:

```bash
mvn -B -ntp -T 1C install -DskipTests   # compile only — no tests, no -Pquality, no coverage needed
mvn -B -ntp sonar:sonar -Dsonar.token=$SONARQUBE_TOKEN -Dsonar.pullrequest.key=<PR number> \
  -Dsonar.pullrequest.branch=<branch> -Dsonar.pullrequest.base=master
```

Then read the verdict — `qualitygates/project_status?projectKey=$SONARQUBE_PROJECT_KEY&pullRequest=<n>`
— and the findings — `issues/search?componentKeys=$SONARQUBE_PROJECT_KEY&pullRequest=<n>` — and fix
what it reports before asking for review. Two facts that make this safe and cheap: a PR analysis is
stored separately from the branch's, so it never affects `master`'s measures or issues, and on
xwiki-commons the whole thing takes ~2 minutes (a warm `-T 1C` compile of all modules is ~1 min).
Budget more in a bigger repo. Traps and the reasoning: `okf/sonarqube/verification.md`.
