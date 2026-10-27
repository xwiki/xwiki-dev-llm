---
name: xwiki-pull-request
description: Create a GitHub pull request for an XWiki repo (xwiki-platform, xwiki-commons, xwiki-rendering, xwiki-contrib). Use when opening a PR, writing a PR description, or preparing commits for a PR in an XWiki project.
---

# Creating an XWiki pull request

## Commit messages & PR title

- Reference the JIRA issue, and make the summary line **the issue's title, verbatim** rather than a
  description you compose: `XWIKI-NNNNN: <the JIRA issue title>` (use `XCOMMONS-NNNNN:` in
  xwiki-commons, `XRENDERING-NNNNN:` in xwiki-rendering). Put what the commit actually does in the
  body, as `*` bullets. See `okf/conventions/commit-messages.md`. **Except security fixes**:
  `XWIKI-NNNNN: <neutral description>`, never the issue title (`okf/processes/security-policy.md`).
- A repo tracked on OpenProject (op.xwiki.org) uses the work package's project-based id instead —
  `DA-96: <the work package subject>`, never `OP#<n>` — and the PR body links
  `https://op.xwiki.org/work_packages/DA-96` (`xwiki-openproject` skill). Then comment the PR URL
  on the work package, which does not list its PRs (`okf/servers/jira.md`, "Linking the pull request").
- For trivial changes that do not warrant a JIRA issue, prefix with `[Misc] <description>`.
  Do not create unnecessary JIRA issues
  (see https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices).
- Keep **one squashed commit per issue** — the backport automation only works with a single commit.
  Amending it means force-pushing: **always name the remote and the branch** (`git push
  --force-with-lease origin <branch>`). Where `push.default=matching` is set, a refspec-less force
  push rewrites *every* local branch that also exists on the remote, and the lease does not stop it.
- **Backtick `@` tokens and `#123` in the commit body and the PR body** — a bare `@since` there
  notifies the GitHub account of that name, and a pushed message cannot be corrected. The summary
  line is exempt. Rule and exceptions:
  `okf/conventions/commit-messages.md`; the `check-commit-text` hook also blocks it.
- When the change was authored with AI assistance, add AI attribution: a `Co-Authored-By: Claude
  <model> <noreply@anthropic.com>` trailer on the commit and a "Generated with Claude Code" line in
  the PR body.

## PR description — always use the template

The template is **not in the repo you are working in** — the core repos (`xwiki-platform`,
`xwiki-commons`, `xwiki-rendering`) carry no `.github/pull_request_template.md`. GitHub applies the
org-level one, in the **`xwiki/.github`** repository, which `gh pr create --body-file` does not insert
for you, so fetch it and fill it yourself (check the repo first: a contrib repo may have its own):

```bash
gh api repos/xwiki/.github/contents/.github/pull_request_template.md -q .content | base64 -d
```

Keep its headings and their levels (`# Jira URL`, `# Changes` with `## Description` and
`## Clarifications`, `# Screenshots & Video`, `# Executed Tests`, `# Expected merging strategy`), and
complete every section meaningfully:

- **Jira URL** — link the JIRA issue (omit only for `[Misc]` PRs).
- **Changes → Description** — the main changes.
- **Changes → Clarifications** — choices made, links to forum proposals / dependent issues.
- **Screenshots & Video** — whenever the change has a visible result, show it: a reviewer should be
  able to judge the result without building the branch. The same images belong on the JIRA issue,
  which is where `okf/servers/jira.md` states the rule and the how.
  - Upload them with `gh pr create --attach <file>` (gh ≥ 2.99, push access to the repo): a body
    reference to the local path (`![after](after.png)`, relative to the `--body-file`) becomes the
    uploaded URL. A failed upload still creates the PR, exiting non-zero — check for the printed URL
    before retrying. Without push access (a fork) or that `gh`, link the JIRA attachment URL instead.
  - One screenshot of the result is the norm, and is all a new feature or a redesign needs.
  - Add a **"before"** when the change is a fix to *existing* UI, so the reader can see what was
    wrong. Usually you can just screenshot the bug on a running instance before applying the fix.
  - When the branch can **no longer produce** that "before" (the fix is already in the working
    tree), **propose** the `xwiki-capture-ui-change` skill and run it only on the user's explicit
    yes. If they decline, ship the "after" alone and say in the PR what the before looked like.
  - When the PR is **already merged**, attach the images to the JIRA issue and edit the merged PR
    body's Screenshots & Video section rather than commenting: an edit notifies nobody. Pass
    `gh pr edit --attach` the whole updated body as `--body-file`; without one it only appends.
- **Executed Tests** — how the change was validated: the `mvn` commands running its automated test
  (`okf/testing/strategy.md` says when one is needed), plus any manual check. Especially important
  for regression fixes.
- **Expected merging strategy** — `Prefers squash: Yes`, and the `Backport on branches:` bullet
  listing the branches (say so explicitly when there is none).

## Labels, assignees, branches

- Add `backport stable-xxx` labels to trigger automated cherry-pick PRs onto release branches.
- Only a PR opened by an **unattended LLM routine** (scheduled or CI, no developer in the session)
  carries the `llm-agent` label. Never add or propose it from an interactive session, even for an
  AI-written change: the AI attribution above already records that.
- Assign the committer who will do the final merge; ping reviewers for parts outside their
  expertise. Dependency-upgrade PR default assignees: webjar Maven → @mflorea,
  non-webjar Maven → @tmortagne, npm → @manuelleduc.
- Reserved branch names: `master`/`main`, `stable-xxx`. Cross-repo changes use a shared
  `feature-deploy-xxx` branch in each repo — keep it until every repo's PR is merged.
- Merge with `gh pr merge <url> --squash --delete-branch`: backports cherry-pick the merge commit,
  and GitHub retargets the PRs stacked on the deleted branch.

## Before opening

- Prove the build is green locally (see the `xwiki-build` skill).
- Create the PR with the `gh` CLI (e.g. `gh pr create`), using the template body.

## Check what the change adds to SonarCloud

A SonarCloud PR analysis is the *only* pre-merge check for server-side rules (`javabugs:*` never
appear locally): **every PR changing Java gets one; fix what it reports before asking for review.** In
xwiki-commons, -rendering and -platform the `Quality / Analyze` check runs it with Checkstyle and fails
on a Sonar issue in a changed line — wait for it (`gh pr checks <n> --watch`), never run it by hand. It
skips dependency bots; a fork by a non-member of the `xwiki` org gets Checkstyle only. Elsewhere
(contrib, outside forks), with a `SONARQUBE_TOKEN`, run it once the PR exists, from the
repository root on the whole reactor:

```bash
mvn -B -ntp -T 1C install -DskipTests   # compile only — no tests, no -Pquality, no coverage needed
mvn -B -ntp sonar:sonar -Dsonar.token=$SONARQUBE_TOKEN -Dsonar.pullrequest.key=<PR number> \
  -Dsonar.pullrequest.branch=<branch> -Dsonar.pullrequest.base=master -Dsonar.qualitygate.wait=true
```

It fails on a red gate; then read the findings —
`issues/search?componentKeys=$SONARQUBE_PROJECT_KEY&pullRequest=<n>`. It is safe and cheap: a PR analysis is
stored separately from the branch's, so it never affects `master`'s measures or issues, and on
xwiki-commons the whole thing takes ~2 minutes (a warm `-T 1C` compile of all modules is ~1 min).
Budget more in a bigger repo. Traps and the reasoning: `okf/sonarqube/verification.md`.
