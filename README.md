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

**Line-ending guard (optional).** Symlink the plugin into an opencode plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
ln -s "$XWIKI_LLM_HOME/xwiki/opencode/plugins/xwiki-line-endings.js" ~/.config/opencode/plugins/xwiki-line-endings.js
```

> **Note — no git-remote scoping in opencode.** In Claude Code the org conventions are injected only
> inside `xwiki/*` / `xwiki-contrib/*` repos (a remote-scoped `SessionStart` hook). opencode has no
> equivalent hook, so with the *global* config the conventions load in every repo. Use the
> *per-project* config if you need them scoped to XWiki repos only.

## What the `xwiki` plugin provides

- **Org-wide conventions** (`xwiki/instructions/xwiki-org.md`) — the shared "CLAUDE.md for all
  repos". In Claude Code and Kimi Code it is injected into every session by a `SessionStart` hook
  (`xwiki/scripts/inject-org-instructions.mjs`), **scoped by git remote** so it only applies inside
  `xwiki/*` and `xwiki-contrib/*` repos (never in personal projects). The hook is written in Node
  (which ships with Claude Code), so it works on Windows, macOS and Linux without a bash or `jq`
  dependency. In opencode it is loaded via the `instructions` config entry (not remote-scoped — see
  the opencode install note above).
- **A single work directory** — every file a task needs but the repo must not hold (plan and
  handoff files, extracted source, drafts, notes, screenshots) goes under one root instead of being
  scattered over the repo, the system temp directory and your home directory. The default is
  `~/.xwiki-llm/work`, overridable with `XWIKI_LLM_WORK`; each piece of work gets its own
  `<work>/<repo>/<YYYY-MM-DD>-<slug>/` directory, so it is findable later and removable in one
  command. Nothing is created up front — a session that writes no work file leaves no trace — and
  the `SessionStart` hook appends the resolved absolute path to the injected conventions so the
  model does not have to guess it. Files that only matter until the end of the current session stay
  in the host's own session scratch directory.
- **Docker IT slot limiter** (`xwiki/scripts/xwiki-it-slot.mjs`) — a wrapper that caps how many
  XWiki functional-test runs (`-Pdocker,integration-tests`) execute at once on one machine, two by
  default (`--max N`, or `XWIKI_LLM_IT_SLOTS`). Such a run holds a servlet engine, a browser
  container of a couple of gigabytes and a ryuk, and writes SNAPSHOT artifacts into the shared
  `~/.m2`; several agents launching one at the same time starve the Docker daemon, and starvation
  surfaces as a failure in `beforeAll` that reads like a product bug rather than as an
  out-of-resources error. Wrap the whole Maven invocation —
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/xwiki-it-slot.mjs" -- mvn verify …` — and later runs queue
  instead of colliding; `--status` shows who holds what, the slot is released however the command
  ends, and one whose holder died is reclaimed. Not a hook: the `xwiki-build` skill tells Claude to
  use it, so it costs nothing in sessions that run no functional test.
- **Line-ending guard** (`xwiki/scripts/check-line-endings.mjs`) — a `PostToolUse` hook on
  `Write`/`Edit` that checks every file written against the explicit `eol` declared by the repo's
  `.gitattributes` (via `git check-attr`). On a CRLF/LF mismatch it fails with a clear message so
  Claude Code rewrites the file with the right endings, preventing spurious whole-file diffs. It
  enforces this deterministically and at near-zero token cost — it only emits output on an actual
  violation, and stays silent when no `eol` is declared (so it never mis-fires on Windows
  `core.autocrlf` working trees). Also Node-based for cross-platform support. In Kimi Code the same
  warning is emitted, but because `PostToolUse` hooks are observation-only there, the model must
  act on the warning itself. In opencode the same check runs as a plugin
  (`xwiki/opencode/plugins/xwiki-line-endings.js`, a `tool.execute.after` hook reusing the same
  logic).
- **MCP servers** (`xwiki/.mcp.json` for Claude; mirrored in `kimi.plugin.json` and `opencode.jsonc`):
  - `discourse` — forum.xwiki.org. Search/read topics and posts with no credentials. Set
    `DISCOURSE_API_KEY` + `DISCOURSE_API_USERNAME` (or the user-key pair) and the same server also
    gets write tools, so Claude can post and reply on the forum — see "Forum write access" below.
  - `develocity` — community.develocity.cloud, the Develocity instance holding XWiki's build
    scans: failure details, test outcomes, build-cache effectiveness. It is a remote server
    (streamable HTTP), so nothing runs locally; the Develocity access key is read from
    `DEVELOCITY_MCP_ACCESS_KEY`. Optional: with the variable unset, Claude Code and Kimi Code
    simply skip the server.
  - `sonarqube` — SonarCloud code-quality analysis (Docker). Reads `SONARQUBE_TOKEN` and the
    repo-specific `SONARQUBE_PROJECT_KEY` from the environment; no secrets are committed.
    `SONARQUBE_PROJECT_KEY` is optional (it defaults to empty), so repos that have no SonarCloud
    project do not fail to load the server.
- **OKF — knowledge base** (`xwiki/okf/`) — a curated, LLM-oriented corpus of XWiki *declarative*
  knowledge: conventions (`conventions/`), architecture (`architecture/`), the dev-server ecosystem
  (`servers/`), testing strategy (`testing/`), SonarQube rule-fix correctness (`sonarqube/` — split
  per rule family so a fix loads only the one it needs) and release process (`processes/`). It complements the
  skills (which hold task *procedures*): the OKF holds *facts*. A slimmed map of it is injected via
  `xwiki-org.md`; `okf/index.md` is the full map. Durable facts are stored inline; **volatile facts
  (versions, build/issue status, role holders) are stored as a "where to look + how to verify"
  pointer, never as a cached value**, so the corpus does not go stale silently. New knowledge is
  added only through a reviewed PR — the `xwiki-knowledge` skill governs reading and extending it.
- **Skills** (`xwiki/skills/`):
  - `xwiki-knowledge` — read and extend the OKF knowledge base (declarative XWiki knowledge).
  - `xwiki-build` — canonical Maven build/test commands.
  - `xwiki-pull-request` — conventions for creating a PR (template, commit format, squash/backport).
  - `xwiki-review` — multi-angle XWiki-aware review of a PR, a commit range or the working tree: one
    specialist reviewer per angle (conventions, architecture, backward compatibility, defensive
    conventions, performance, tests, accessibility, i18n/UX, documentation, data & migration, spec
    conformance), each finding confidence-scored and dropped below the bar before anything is posted.
    **Explicit invocation only** — it is not used for a plain "review this" (that stays a normal,
    cheap review); ask for it by name (`/xwiki-review`) when you want the expensive full pass.
  - `xwiki-jira` — view/search/create/update/transition issues on jira.xwiki.org (jira-cli or REST).
  - `xwiki-test-guidelines` — testing best practices and the XWiki test frameworks.
  - `xwiki-javadoc` — write clear, useful Javadoc following the XWiki Java Code Style and Oracle conventions.
  - `xwiki-convert-tests` — convert unit tests to JUnit5/Mockito.
  - `xwiki-convert-tests-docker` — convert functional IT tests to the Docker `@UITest` framework.
  - `xwiki-increase-test-coverage` — raise and lock in a module's unit-test coverage (JaCoCo instruction ratio).
  - `xwiki-legacy` — move a deprecated public API out of a main module into its `-legacy` companion (migrate callers, remove, re-add via a plain class or an AspectJ aspect, Revapi ignore).
  - `xwiki-fix-flickering-docker-test` — fix a flickering Docker-based functional test.
  - `xwiki-deploy-extension` — deploy a XAR/JAR extension to a running XWiki instance.
  - `xwiki-rest-api` — read/write a running XWiki over REST: get page content & xobjects, update pages & object properties, create pages (with xobjects), Solr search.
  - `xwiki-xar-pages` — edit extension wiki pages (XAR XML): the `xar:format` / `xar:verify` conventions.
  - `xwiki-translations` — externalize and render i18n strings safely.
  - `xwiki-doc-writing` — write, update or review a page of xwiki.org documentation per the XWiki Documentation Guide (Diataxis).
  - `xwiki-doc-convert` — convert old documentation (the `Documentation` space or the Extensions wiki) into the new `/documentation` tree, as a resumable plan of one-session tasks (also used to resume a conversion already under way).
  - `xwiki-contrib-release-blog-post` — create the "<Extension> Extension <version> Released" announcement on the xwiki.org Blog for an xwiki-contrib extension.
  - `xwiki-fix-sonarqube-issue` — find and fix SonarCloud issues and open a PR; the
    per-rule fix correctness and drop conditions it applies live in `xwiki/okf/sonarqube/`.
  - `xwiki-backport` — backport any change to an older branch: cherry-pick `-x`, adapt to the branch (module pom versions, Java level, style/API), verify, open the PR.
  - `xwiki-backport-testneeded` — backport `testneeded`-labelled tests to supported stable branches, adjust `@since` across branches, open the PRs (builds on `xwiki-backport`).

## Required environment variables

| Variable                | Used by   | Notes                                              |
|-------------------------|-----------|----------------------------------------------------|
| `XWIKI_LLM_HOME`        | opencode  | Absolute path to your `xwiki-dev-llm` checkout. **opencode only** (Claude Code and Kimi Code resolve paths themselves). |
| `XWIKI_LLM_WORK`        | all hosts | Absolute path to the work directory for plans, handoffs, drafts and other cross-session state. Optional — defaults to `~/.xwiki-llm/work`. |
| `SONARQUBE_TOKEN`       | sonarqube | Your personal SonarCloud token (same for all repos). |
| `SONARQUBE_PROJECT_KEY` | sonarqube | The SonarCloud project key — **differs per repo**. Optional: leave it unset in repos that have no SonarCloud project. |
| `DEVELOCITY_MCP_ACCESS_KEY` | develocity | Your community.develocity.cloud access key, **bare** (no `community.develocity.cloud=` prefix). Optional — without it the build-scan MCP is not loaded. See "Develocity access" below. |
| `JIRA_API_TOKEN`        | `xwiki-jira` (jira-cli / REST) | Your jira.xwiki.org personal access token. Optional — only needed to act on JIRA issues. See "JIRA access" below. |
| `JIRA_AUTH_TYPE`        | jira-cli  | Set to `bearer` (PAT auth) for the self-hosted XWiki JIRA.       |
| `DISCOURSE_API_KEY`     | discourse | A forum.xwiki.org **admin** API key. Optional — without it the forum MCP is read-only. See "Forum write access" below. |
| `DISCOURSE_API_USERNAME`| discourse | The forum username the admin API key acts as (e.g. your own). Required together with `DISCOURSE_API_KEY`. |
| `DISCOURSE_USER_API_KEY` + `DISCOURSE_USER_API_CLIENT_ID` | discourse | Alternative to the admin key: a forum **user** API key, which any account can hold. |

### Setting `SONARQUBE_PROJECT_KEY` per repo

The project key is specific to each repository, so set it per checkout. The recommended way is
[direnv](https://direnv.net): drop an `.envrc` in each repo (it loads automatically when you `cd`
in, and unloads when you leave). Add `.envrc` to your **global** gitignore so it's never committed:

```bash
# ~/dev/xwiki/xwiki-platform/.envrc
export SONARQUBE_TOKEN="<your-sonarcloud-token>"   # or set once in your shell profile
export SONARQUBE_PROJECT_KEY="org.xwiki.platform:xwiki-platform"
```

```bash
# ~/dev/xwiki/xwiki-commons/.envrc
export SONARQUBE_PROJECT_KEY="org.xwiki.commons:xwiki-commons"
```

Then run `direnv allow` in each repo once. Without direnv, just `export` the vars in your shell
before launching Claude Code from that repo.

Find a repo's exact key on its SonarCloud project page (**Project Information → Project Key**) at
https://sonarcloud.io/organizations/xwiki/projects.

## Forum write access (for the `discourse` MCP server)

The `discourse` server always provides search and read of [forum.xwiki.org](https://forum.xwiki.org)
without any credential. Posting — replying to a topic, creating one, drafting a proposal — needs one,
because the underlying server registers its write tools only when it is authenticated. This is
**optional**: leave the variables unset and everything keeps working read-only.

Two kinds of credential work, whichever you can get:

- **Admin API key** (forum admins only) — create it at
  https://forum.xwiki.org/admin/api/keys with *User Level: Single User* pointing at your own account,
  and scope it to what you actually want Claude to do (the *Granular* scope, e.g. only
  `posts#create`, is a good default — the server's write tools cover topics, posts, PMs, categories
  and users, and the key is what bounds them). Then:

  ```bash
  export DISCOURSE_API_KEY="<the-key>"
  export DISCOURSE_API_USERNAME="<your-forum-username>"
  ```

- **User API key** (any account) — generated through Discourse's
  [user-api-key flow](https://meta.discourse.org/t/user-api-keys-specification/48536), which yields a
  key plus a client id:

  ```bash
  export DISCOURSE_USER_API_KEY="<the-key>"
  export DISCOURSE_USER_API_CLIENT_ID="<the-client-id>"
  ```

Set them in your shell profile, or per project with [direnv](https://direnv.net) as described above.
Never commit them: the launcher (`xwiki/scripts/start-discourse-mcp.mjs`) passes the credential to
the server in a temporary `0600` profile file, so it stays out of the process list, but keeping it
out of git is on you. Anything Claude posts goes out under the account the key acts as, so it should
confirm the exact text with you before posting.

If the forum refuses the credential (revoked, expired, wrong username), the launcher says so on
stderr and starts the server read-only, rather than letting it fail to start and take the search and
read tools down with it.

## Develocity access (for the `develocity` MCP server)

[community.develocity.cloud](https://community.develocity.cloud) is the Develocity instance that
stores the build scans of every CI build and provides the remote build cache. It is Gradle's free
instance for open-source projects, shared with other projects, so XWiki's data is scoped by the
project ID `xwiki` (set in each repo's `.mvn/develocity.xml`). Its MCP server exposes that data —
exception details and stack traces for a failed build, test outcomes and flaky-test history, build
timings and cache hit rates, and diffs between two builds — so you can investigate a CI failure
without leaving the terminal.

This is **optional**, and unlike the other servers it needs a credential just to list its tools: the
access key is validated on *every* request. So leave `DEVELOCITY_MCP_ACCESS_KEY` unset if you don't have a
key — Claude Code and Kimi Code then skip the server instead of erroring on each session.

To set it up, sign in to https://community.develocity.cloud, open **Settings → Access keys**
(https://community.develocity.cloud/settings/access-keys), generate a key, and export it:

```bash
export DEVELOCITY_MCP_ACCESS_KEY="<the-access-key>"
```

**Why not `DEVELOCITY_ACCESS_KEY`?** There is only one kind of Develocity credential — the access
key you just created — but that name is already taken by the Maven and Gradle Develocity
extensions, which require the value to be host-scoped:
`DEVELOCITY_ACCESS_KEY=community.develocity.cloud=<key>`
(the host prefix exists so the key can't be sent to a server it wasn't issued for). An HTTP
`Authorization: Bearer` header needs the bare key instead, so one variable cannot serve both. The
separate name lets you keep both, with the same key in each:

```bash
export DEVELOCITY_ACCESS_KEY="community.develocity.cloud=<the-access-key>"  # Maven/Gradle build
export DEVELOCITY_MCP_ACCESS_KEY="<the-access-key>"                         # this plugin's MCP server
```

The key's Develocity user needs the *Access build data via the API and MCP* permission (included in
the default Developer role).

## JIRA access (for the `xwiki-jira` skill)

The `xwiki-jira` skill lets Claude view, search, create, update and transition issues on
[jira.xwiki.org](https://jira.xwiki.org). This is **optional** — set it up only if you want Claude to
operate on JIRA. Two backends; the skill auto-detects which is available.

### Recommended: install `jira-cli`

[`jira-cli`](https://github.com/ankitpokhrel/jira-cli) gives the richest experience. XWiki's JIRA is
a **self-hosted (Server/Data Center)** instance authenticated with a **personal access token (PAT)**:

1. Install it — e.g. `brew install ankitpokhrel/jira-cli/jira-cli` (see the
   [installation guide](https://github.com/ankitpokhrel/jira-cli/wiki/Installation) for Nix, Docker, etc.).
2. Create a PAT in your JIRA profile (**Profile → Personal Access Tokens**) and export it, plus the
   bearer auth type, in your shell profile (or a git-ignored `.envrc` as above):
   ```bash
   export JIRA_API_TOKEN="<your-jira-personal-access-token>"
   export JIRA_AUTH_TYPE="bearer"
   ```
3. Run `jira init` and choose:
   - installation type **Local** (on-premise, not Cloud),
   - server **`https://jira.xwiki.org`**,
   - authentication type **bearer** (PAT),
   - your login (JIRA username / email) and a default project (e.g. `XWIKI`).

### Fallback: REST API only

If you don't install `jira-cli`, the skill falls back to the JIRA REST API using the **same**
`JIRA_API_TOKEN` as a bearer token — just export it:

```bash
export JIRA_API_TOKEN="<your-jira-personal-access-token>"
```

The token is read from the environment and never committed. Issue-field conventions (Component,
Affects/Fix Version) are documented once in `xwiki/okf/servers/jira.md`.

## xwiki.org credentials (for the documentation skills)

**Optional.** The documentation skills write to xwiki.org over REST; put your xwiki.org credentials in
**`~/.xwiki-credentials`** (`chmod 600`) and they are found instead of asked for. Two lines, no quotes
and no `export` — the file is sourced:

```
XWIKI_USER=MyUserName
XWIKI_PASSWORD=<your-xwiki.org-password>
```

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
