# xwiki-dev-llm

Shared LLM configuration for XWiki developers, distributed as a
[Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces),
a [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html) plugin,
and an [opencode](https://opencode.ai) config.

The goal is consistency across developers, sharing the work of others, and simple onboarding —
generic enough to work for **every** XWiki developer (no committed secrets, no personal paths). It
was designed in the forum thread
[Organizing our LLM configs for all our repos](https://forum.xwiki.org/t/organizing-our-llm-configs-for-all-our-repos/18551).

The Claude marketplace manifest lives at the repo root (`.claude-plugin/marketplace.json`), the
Kimi plugin manifest lives at `kimi.plugin.json`, the opencode config lives at `opencode.jsonc`,
and the shared plugin content lives under [`xwiki/`](xwiki).

- [Install](#install) — [Claude Code](#claude-code) · [Kimi Code](#kimi-code) · [opencode](#opencode)
- [What you get](#what-you-get) — [Always on](#always-on--no-invocation) · [Skills](#when-you-ask--skills) · [What the skills use](#what-the-skills-use)
- [Setup](#setup) — credentials and environment variables
- [Validate](#validate) — what to run after a change
- [Versioning and releases](#versioning-and-releases)
- [Contributing](#contributing)

## Install

### Claude Code

```
/plugin marketplace add https://github.com/xwiki/xwiki-dev-llm
/plugin install xwiki@xwiki-dev-llm
```

For local development against a checkout:

```
/plugin marketplace add /path/to/xwiki-dev-llm
/plugin install xwiki@xwiki-dev-llm
```

### Kimi Code

```
/plugins install https://github.com/xwiki/xwiki-dev-llm
/reload
```

For local development against a checkout:

```
/plugins install /path/to/xwiki-dev-llm
/reload
```

### opencode

opencode has no plugin marketplace, so it reads this repo from a local checkout. Clone it once and
point `XWIKI_LLM_HOME` at it (the `opencode.jsonc` config resolves every path through that variable,
so the file stays portable — no personal paths):

```bash
git clone https://github.com/xwiki/xwiki-dev-llm ~/dev/xwiki/xwiki-dev-llm
# in your shell profile (~/.zshrc, ~/.bashrc, …):
export XWIKI_LLM_HOME="$HOME/dev/xwiki/xwiki-dev-llm"
```

**Skills.** opencode only discovers skills in fixed directories, so symlink this checkout's skills
into your opencode config once (a single link — the skills and their OKF stay in the checkout):

```bash
mkdir -p ~/.config/opencode
ln -s "$XWIKI_LLM_HOME/xwiki/skills" ~/.config/opencode/skills
```

**Config (MCP servers + org conventions).** Choose one:

- *Global (install once, applies everywhere).* Point opencode at the shipped config:
  ```bash
  export OPENCODE_CONFIG="$XWIKI_LLM_HOME/opencode.jsonc"
  ```
  Or merge the `mcp` and `instructions` entries from `opencode.jsonc` into your
  `~/.config/opencode/opencode.json`.
- *Per project.* Copy `opencode.jsonc` to `opencode.json` in an XWiki repo (it needs no editing —
  it reads `XWIKI_LLM_HOME`). This scopes the config to that repo only.

**Guard plugins (optional).** Symlink them into an opencode plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
ln -s "$XWIKI_LLM_HOME/xwiki/opencode/plugins/xwiki-line-endings.js" ~/.config/opencode/plugins/xwiki-line-endings.js
ln -s "$XWIKI_LLM_HOME/xwiki/opencode/plugins/xwiki-commit-text.js" ~/.config/opencode/plugins/xwiki-commit-text.js
```

> **Note — no git-remote scoping in opencode.** In Claude Code the org conventions are injected only
> inside `xwiki/*` / `xwiki-contrib/*` repos — and any org listed in `XWIKI_LLM_ORGS` — via a
> remote-scoped `SessionStart` hook. opencode has no
> equivalent hook, so with the *global* config the conventions load in every repo. Use the
> *per-project* config if you need them scoped to XWiki repos only.

## What you get

### Always on — no invocation

| What | When it fires | Tune with |
|---|---|---|
| **Org conventions** (`xwiki/instructions/xwiki-org.md`) — the shared "CLAUDE.md for all repos": build commands, commit format, code conventions, `@since` rules | Every session, in `xwiki/*` and `xwiki-contrib/*` repos only (scoped by git remote) | `XWIKI_LLM_ORGS` to add your own orgs. No scoping in opencode — see the install note above |
| **Work directory** — plans, handoffs, drafts and notes go to one root instead of the repo, `/tmp` and your home | The first time a task needs a file that must outlive the session | `XWIKI_LLM_WORK` ([defaults](docs/setup.md)) |
| **Line-ending guard** (`xwiki/scripts/check-line-endings.mjs`) — blocks a write whose endings contradict the repo's `.gitattributes`, so no spurious whole-file diffs | Every `Write`/`Edit`; silent unless violated | — |
| **Commit/PR text guard** (`xwiki/scripts/check-commit-text.mjs`) — blocks a message body holding a bare `@name` or `#123`, which GitHub turns into a mention of a stranger or the wrong issue | Every `git commit`, `gh pr create`/`edit`; summary line exempt | — |

A pushed commit message cannot be fixed without rewriting a shared branch, and a CRLF diff hides the
real change — which is why those two are hooks and not conventions. Both are Node (no bash, no `jq`),
observation-only under Kimi Code, and available to opencode as plugins.

### When you ask — skills

⚠ = **explicit invocation only**: named or nothing, because it is expensive or it writes.
**Needs** is what must be set for the skill to do its job — [how to set it](docs/setup.md); a `—`
means it needs nothing.

**Build & test**

| Skill | What it does | Needs | Example |
|---|---|---|---|
| [`xwiki-build`](xwiki/skills/xwiki-build/) | Maven commands: the right JDK, profiles, single module, single test | — | "run `EditIT` in `xwiki-platform-flamingo-skin-test`" |
| [`xwiki-test-guidelines`](xwiki/skills/xwiki-test-guidelines/) | The rules and frameworks for writing a test — loads itself before any test change, down to one `@Test` | — | "add a test for this" |
| [`xwiki-convert-tests`](xwiki/skills/xwiki-convert-tests/) | Convert unit tests to JUnit 5 + Mockito | — | "convert this test class to JUnit 5" |
| [`xwiki-convert-tests-docker`](xwiki/skills/xwiki-convert-tests-docker/) | Convert functional ITs to the Docker `@UITest` framework | — | "convert these ITs to `@UITest`" |
| [`xwiki-increase-test-coverage`](xwiki/skills/xwiki-increase-test-coverage/) | Recompute a module's JaCoCo ratio and raise the pom's floor | — | "bump the coverage ratio for this module" |
| [`xwiki-fix-flickering-docker-test`](xwiki/skills/xwiki-fix-flickering-docker-test/) | Diagnose and fix a flicker, then prove it with a pass rate | Docker | "fix the `NotificationsIT` flicker" |

**Code & APIs**

| Skill | What it does | Needs | Example |
|---|---|---|---|
| [`xwiki-knowledge`](xwiki/skills/xwiki-knowledge/) | Answer "what is the rule here?" from the OKF, and extend it by PR | — | "what's our policy on comments in code?" |
| [`xwiki-javadoc`](xwiki/skills/xwiki-javadoc/) | Write Javadoc per the XWiki code style | — | "javadoc this class" |
| [`xwiki-legacy`](xwiki/skills/xwiki-legacy/) | Move a deprecated API to its `-legacy` module: migrate callers, remove, re-add, Revapi | — | "retire `XWikiRightService`" |
| [`xwiki-translations`](xwiki/skills/xwiki-translations/) | Externalize and render i18n strings safely (escaping, word order) | — | "externalize these strings" |
| [`xwiki-xar-pages`](xwiki/skills/xwiki-xar-pages/) | Edit extension wiki pages in a XAR (`xar:format` / `xar:verify` conventions) | — | "add a page to this XAR" |

**Issues, PRs & review**

| Skill | What it does | Needs | Example |
|---|---|---|---|
| [`xwiki-jira`](xwiki/skills/xwiki-jira/) | View, search, create, update and transition jira.xwiki.org issues | `JIRA_API_TOKEN` | "file a bug for this in XWIKI" |
| [`xwiki-jira-bfd`](xwiki/skills/xwiki-jira-bfd/) | Prepare a Bug Fixing Day: score the old backlog, propose closes and quick wins, apply only the approved closes (you run the apply) | `JIRA_API_TOKEN`; `TYPESAFE_TOKEN`, or the `claude` CLI as the judge | "prepare the BFD on the 5-year-old XWIKI bugs" |
| [`xwiki-pull-request`](xwiki/skills/xwiki-pull-request/) | Commit format, PR template, squash and backport conventions | `gh` login | "open a PR for this branch" |
| [`xwiki-review`](xwiki/skills/xwiki-review/) ⚠ | One specialist reviewer per angle, each finding challenged before it is posted | `gh` login | `/xwiki-review PR 6453` |
| [`xwiki-backport`](xwiki/skills/xwiki-backport/) | Cherry-pick to an older branch and *adapt* it (poms, Java level, `@since`, API drift) | `gh` login | "backport this to stable-18.8.x" |
| [`xwiki-backport-testneeded`](xwiki/skills/xwiki-backport-testneeded/) | The `testneeded` sweep: backport one issue's test to every supported branch | `gh` login, `JIRA_API_TOKEN` | "backport the test of XWIKI-24710" |
| [`xwiki-security-advisory`](xwiki/skills/xwiki-security-advisory/) | Draft a GitHub Security Advisory from a security-restricted issue | `JIRA_API_TOKEN` | "draft the advisory for XWIKI-25001" |
| [`xwiki-openproject`](xwiki/skills/xwiki-openproject/) | Work packages on op.xwiki.org (**not** the issue tracker) | `OPENPROJECT_API_TOKEN` | "what's on my OpenProject list?" |

**CI & quality**

| Skill | What it does | Needs | Example |
|---|---|---|---|
| [`xwiki-release-test-triage`](xwiki/skills/xwiki-release-test-triage/) | Reads CI and reports: known flicker, unknown flicker or real breakage — does it block the release? Never writes | — | "is master green?" |
| [`xwiki-ci-check`](xwiki/skills/xwiki-ci-check/) ⚠ | The daily sweep that *acts*: attributes each failure, comments on the culprit commit, opens fix PRs, files flicker issues, posts the digest | to analyse, nothing — but a red quality gate keeps its cause only with `SONARQUBE_TOKEN`, and a failing test its history only with a [Develocity key](docs/setup.md); the **bot** tokens to write (`GH_TOKEN_BOT`, `JIRA_TOKEN_BOT`, `MATRIX_*`) | `/xwiki-ci-check xwiki-platform, master only` |
| [`xwiki-fix-sonarqube-issue`](xwiki/skills/xwiki-fix-sonarqube-issue/) | Fix a SonarCloud finding correctly (per-rule traps live in `okf/sonarqube/`) and open the PR | `SONARQUBE_TOKEN`, `SONARQUBE_PROJECT_KEY` | "fix a Sonar issue in this repo" |

**Documentation** — all of these write to xwiki.org, so they read your credentials from `~/.xwiki-credentials`.

| Skill | What it does | Needs | Example |
|---|---|---|---|
| [`xwiki-doc-writing`](xwiki/skills/xwiki-doc-writing/) | Write, update or review an xwiki.org page per the Documentation Guide (Diataxis) | `~/.xwiki-credentials` | "document this feature" |
| [`xwiki-doc-convert`](xwiki/skills/xwiki-doc-convert/) | Migrate an old page into the new `/documentation` tree, as a resumable plan | `~/.xwiki-credentials` | "convert the Skin Extensions page" |
| [`xwiki-release-documentation`](xwiki/skills/xwiki-release-documentation/) ⚠ | Audit a release's fixed issues: what needs a page, what needs a release note, then write both and fill the JIRA fields | `~/.xwiki-credentials`, `JIRA_API_TOKEN` | `/xwiki-release-documentation 18.8.0` |
| [`xwiki-contrib-release-blog-post`](xwiki/skills/xwiki-contrib-release-blog-post/) | The "<Extension> Extension X.Y Released" blog post on xwiki.org | `~/.xwiki-credentials` | "announce the Jira extension 9.2 release" |
| [`xwiki-presentation`](xwiki/skills/xwiki-presentation/) | Build a `.pptx` deck in the XWiki look, then PDF/PNG/Keynote | LibreOffice, [Python deps](xwiki/skills/xwiki-presentation/tools/requirements.txt) | "build a deck on XWiki 18.x for FOSDEM" |

**Running wiki**

| Skill | What it does | Needs | Example |
|---|---|---|---|
| [`xwiki-rest-api`](xwiki/skills/xwiki-rest-api/) | Read and write a live instance over REST: pages, xobjects, Solr search | the instance's login (`~/.xwiki-credentials` for xwiki.org) | "what's in the sandbox page?" |
| [`xwiki-deploy-extension`](xwiki/skills/xwiki-deploy-extension/) | Install a built XAR/JAR into a running XWiki via the job REST API | the instance's login | "deploy this XAR to localhost:8080" |

### What the skills use

| | |
|---|---|
| **OKF** (`xwiki/okf/`) | XWiki's declarative knowledge — conventions, architecture, servers, testing, SonarQube rule correctness, processes. Durable facts inline; volatile ones (versions, build status) stored as "where to look and how to verify", never cached. Extended only through a reviewed PR. |
| **`discourse` MCP** | forum.xwiki.org: search and read with no credential, post with one ([setup](docs/setup.md#forum-write-access-for-the-discourse-mcp-server)) |
| **`develocity` MCP** | community.develocity.cloud: build scans, test outcomes, flaky history, cache hit rates ([setup](docs/setup.md#develocity-access-for-the-develocity-mcp-server-and-dv-test-history)) |
| **`sonarqube` MCP** | SonarCloud issues and quality gates, per repo ([setup](docs/setup.md)) |
| **IT slot limiter** (`xwiki/scripts/xwiki-it-slot.mjs`) | Caps concurrent Docker IT runs on one machine (2 by default). Several agents starting one at once starve the Docker daemon, and starvation surfaces as a `beforeAll` failure that reads like a product bug |
| **Repeat-run oracle** (`xwiki/scripts/xwiki-it-repeat.mjs`) | Runs one functional test N times on one configuration and reports the pass **rate** — a flicker is a probability, and "it passed" is not evidence that a fix worked. Keeps each failing repetition's report, screenshot and video |

## Setup

Optional, all of it — see **[docs/setup.md](docs/setup.md)** for the environment variables and the
credentials for JIRA, the forum, Develocity, SonarCloud and xwiki.org.

## Validate

```
claude plugin validate ./xwiki   # manifest schema
node scripts/validate.mjs        # repo consistency (skill inventory, version untouched + in sync, OKF map)
```

`scripts/validate.mjs` also runs automatically in CI (GitHub Actions) on every push and pull request.

## Versioning and releases

Claude Code (and Kimi, and opencode) picks up a plugin change only when the version *increases*, and
that version is written in five places across the three host manifests. **Pull requests never touch
it.** They used to, and the result was that every open PR conflicted with every other one on those
same five lines — a conflict that was never about either change. `scripts/validate.mjs` now fails any
branch whose version differs from the base branch's.

The release is cut on `master` instead, by `scripts/release.mjs`, which
[GitHub Actions runs automatically](.github/workflows/release.yml) on every push to `master` that
touches `xwiki/`. It sets all five fields, commits `[Misc] Release X.Y.Z` and tags `vX.Y.Z`; the tag
is how the following run knows what has already shipped. To see what would happen without changing
anything:

```
node scripts/release.mjs --dry-run
```

**Which segment moves is derived from the change, not asked for:**

- **minor** — the capability *inventory* changed: a skill, an MCP server, a hook or an opencode
  plugin was added or removed.
- **patch** — anything else under `xwiki/` (OKF, skill and instruction wording).
- **major** — never derived; it has to be asked for explicitly.

Two ways to override it. For a change whose significance the file list cannot show, add a trailer to
a commit message — unlike a version field, two branches can never conflict on one:

```
Release-Bump: minor
```

Or run the `release` workflow by hand from the Actions tab (`workflow_dispatch`) and choose the
segment. Note that automatic releases need `master` to accept a push from `github-actions[bot]`; if
`master` is protected, either allow the bot to bypass it or run `node scripts/release.mjs --push`
locally instead.

## Contributing

Keep committed content **minimal and generic** — no personal paths, machine state, or secrets — and
review the conventions and skills periodically. Issues and changes are discussed on the
[XWiki forum](https://forum.xwiki.org/) and tracked in [JIRA](https://jira.xwiki.org/).
