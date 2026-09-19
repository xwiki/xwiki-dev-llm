# Setup

Everything here is **optional**: the plugin works with nothing configured. Set up only what you want
Claude to reach — JIRA, the forum, Develocity, SonarCloud, xwiki.org.

Set the variables in your shell profile, or per repo with [direnv](https://direnv.net) in a
git-ignored `.envrc`.

## Required environment variables

| Variable                | Used by   | Notes                                              |
|-------------------------|-----------|----------------------------------------------------|
| `XWIKI_LLM_HOME`        | opencode  | Absolute path to your `xwiki-dev-llm` checkout. **opencode only** (Claude Code and Kimi Code resolve paths themselves). |
| `XWIKI_LLM_ORGS`        | Claude Code, Kimi Code | Extra GitHub orgs, comma- or whitespace-separated (e.g. `acme-corp,acme-labs`), whose repos should also get the org conventions injected. Optional — `xwiki` and `xwiki-contrib` always match. Not used by opencode, which has no remote scoping. |
| `XWIKI_LLM_WORK`        | all hosts | Absolute path to the work directory for plans, handoffs, drafts and other cross-session state. Optional — defaults to `$XDG_STATE_HOME/xwiki-llm/work` on Linux/macOS, falling back to `~/.local/state/xwiki-llm/work` when `XDG_STATE_HOME` is unset (as it is by default on macOS); and to `%LOCALAPPDATA%\xwiki-llm\work` on Windows, falling back to `%USERPROFILE%\AppData\Local\xwiki-llm\work` when `LOCALAPPDATA` is unset. |
| `SONARQUBE_TOKEN`       | sonarqube, `xwiki-ci-check` | Your personal SonarCloud token (same for all repos). The CI check reads it directly too — a failing quality gate is the one CI incident whose cause is not in the Jenkins log, so the sweep asks SonarCloud which condition failed and which new-code issues are under it, and names their authors in the report. Without it the gate is still reported, without its cause. |
| `SONARQUBE_PROJECT_KEY` | sonarqube | The SonarCloud project key — **differs per repo**. Optional: leave it unset in repos that have no SonarCloud project. |
| `DEVELOCITY_MCP_ACCESS_KEY` | develocity | Your community.develocity.cloud access key, **bare** (no `community.develocity.cloud=` prefix). Optional — without it the build-scan MCP is not loaded. See "Develocity access" below. |
| `XWIKI_DEV_TOOLS`       | `xwiki-ci-check` | Absolute path to a [`xwiki-dev-tools`](https://github.com/xwiki/xwiki-dev-tools) checkout (or directly to its `bash/dv-test-history`), whose Develocity analyser the CI check reads a failing test's history from. Optional — without it a checkout sitting next to your other XWiki repos is used, and failing that one is cloned into `$XDG_STATE_HOME/xwiki-llm/xwiki-dev-tools`. Needs `python3` (no packages to install) and the Develocity key above. |
| `JIRA_API_TOKEN`        | `xwiki-jira` (jira-cli / REST) | Your jira.xwiki.org personal access token. Optional — only needed to act on JIRA issues. See "JIRA access" below. |
| `OPENPROJECT_API_TOKEN` | `xwiki-openproject` | An op.xwiki.org API token (**My account → Access tokens**). Optional — without it every OpenProject call returns `401`. |
| `JIRA_AUTH_TYPE`        | jira-cli  | Set to `bearer` (PAT auth) for the self-hosted XWiki JIRA.       |
| `DISCOURSE_API_KEY`     | discourse | A forum.xwiki.org **admin** API key. Optional — without it the forum MCP is read-only. See "Forum write access" below. |
| `DISCOURSE_API_USERNAME`| discourse | The forum username the admin API key acts as (e.g. your own). Required together with `DISCOURSE_API_KEY`. |
| `DISCOURSE_USER_API_KEY` + `DISCOURSE_USER_API_CLIENT_ID` | discourse | Alternative to the admin key: a forum **user** API key, which any account can hold. |
| `GH_TOKEN_BOT`          | `xwiki-ci-check` | The **bot** GitHub account's token, used for the commit comments and nothing else. Reads (commit/compare, existing comments) fall back to `GITHUB_TOKEN` / `GH_TOKEN`, since a read has no identity; **writing has no fallback** — `commit-comment.mjs` posts with this variable or refuses, so running the skill locally can never comment under your own name. **Issue a classic token with `public_repo`** (the `xwiki` org also rejects a fine-grained token whose lifetime exceeds 366 days, with a 403 on every request including plain reads). It is *not* what opens a fix PR: the bot has no push access to `xwiki/*`, and the PR is pushed by the Claude GitHub App installed on the org, as it is for the SonarQube routine. |
| `MATRIX_USER_BOT`, `MATRIX_PASSWORD_BOT` | `xwiki-ci-check` | The bot's Matrix account, for the daily digest. **Prefer these over a token:** matrix.org issues short-lived access tokens (the `mat_` ones) that a client refreshes continuously, so one copied out of Element is dead within minutes and a 06:00 routine finds it expired every morning. `matrix.mjs` logs in per run instead, on a fixed device, and joins the room if it is not in it. |
| `MATRIX_TOKEN_BOT`      | `xwiki-ci-check` | An access token, as an alternative — honoured when the homeserver still accepts it (Synapse's own tokens do not expire), and fallen back from to the password when it does not. Without either, the digest is printed instead of posted. |
| `MATRIX_HOMESERVER`, `MATRIX_ROOM` | `xwiki-ci-check` | Optional — default to `https://matrix.org` (where the bot's *account* is) and `#xwiki:matrix.xwiki.com` (where the *room* is, whatever the account's server). A `#alias` is resolved to the internal room id automatically; an alias with no `:server` part gets the homeserver's, which is why the default is fully qualified. |
| `JIRA_TOKEN_BOT`        | `xwiki-ci-check` | The bot's jira.xwiki.org token, for auto-filed flicker issues. The `xwiki-jira` skill reads `JIRA_API_TOKEN`, so the routine exports it from this one — keeping the bot's credential distinct from the developer's on the same machine. |
| `XWIKI_CI_PASTE_URL`    | `xwiki-ci-check` | The PrivateBin instance the digest's detail is pasted to. Optional — defaults to `https://bin.xwikisas.com/`. |

Up to plugin version 1.5.0 the work root was `~/.xwiki-llm/work` on every OS. If you still have files
there, move them to the new root — each session reminds you while any remain — or point
`XWIKI_LLM_WORK` at the old path.

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

## Develocity access (for the `develocity` MCP server and `dv-test-history`)

[community.develocity.cloud](https://community.develocity.cloud) is the Develocity instance that
stores the build scans of every CI build and provides the remote build cache. It is Gradle's free
instance for open-source projects, shared with other projects, so XWiki's data is scoped by the
project ID `xwiki` (set in each repo's `.mvn/develocity.xml`). Its MCP server exposes that data —
exception details and stack traces for a failed build, test outcomes and flaky-test history, build
timings and cache hit rates, and diffs between two builds — so you can investigate a CI failure
without leaving the terminal. The same key feeds `dv-test-history`, the analyser `xwiki-ci-check`
reads a failing test's 28-day history from (see `XWIKI_DEV_TOOLS` above).

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

`dv-test-history` takes either: the bare variable as it stands, and the host-scoped one with the
host prefix stripped for the server being queried.

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
