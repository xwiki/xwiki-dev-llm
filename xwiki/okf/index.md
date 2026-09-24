---
title: XWiki OKF — index / map
stability: durable
summary: Entry map of the XWiki LLM knowledge base. Lists every topic with a one-line summary and
  says how to read and how to extend the corpus.
---

# XWiki OKF — index / map

The **OKF** is the curated, LLM-oriented knowledge base for developing XWiki platform code and
xwiki-contrib extensions. It holds **declarative** knowledge (conventions, architecture, the dev
server ecosystem, processes). **Procedures** ("how to do task X") live in the `xwiki-*` skills, not
here. A slimmed copy of this map is injected into every XWiki session via
`instructions/xwiki-org.md`; this file is the navigable, full version.

## How to use the OKF (READ)

1. Find the relevant topic in the map below and **Read that file**.
2. Check the file's `stability:` frontmatter:
   - `durable` → the inline content is the answer.
   - `volatile` → **do not trust any value written here**; follow the `verify:` recipe (read
     `pom.xml`, use the `sonarqube`/`discourse` MCP, or WebFetch the listed dev-wiki source).
3. For repeated lookups of the same external page in a session, index it once with context-mode (if
   installed) and search — but the OKF never *requires* context-mode.

The full how-to-read-and-extend protocol is the `xwiki-knowledge` skill.

## Topics

An entry says what a topic is and when to open it instead of its neighbour; the rules themselves are
in the topic file. Read the entry to choose, then read the file — never act on the entry alone.

### conventions/
- **code-style** — the source-level rules for Java and build files: line length, license headers,
  comment formatting, javax→jakarta, `-legacy` modules.
- **velocity-code-style** — the same for `.vm` templates, skin resources and wiki-page Velocity,
  including the `$discard` capture that stops a bare call leaking into the output; also indexes the
  Velocity rules the topics below hold.
- **code-comments** — what a comment must say, in every language: history, and referencing an issue.
- **naming** — what to call a Maven artifact, an npm package, a property, a UIX id, a skin, an icon.
- **frontend** — client-side code: JavaScript modules and WebJars, CSS as a skin extension, JS
  backward compatibility, accessibility.
- **server-side-rendering** — what a wiki page, sheet or template emits: space gobbling and
  `$doc.display` silently eat the blank lines between generated blocks, nesting a paragraph or
  failing a macro with *"cannot be used inline"*.
- **translations** — the lifecycle of a translation key: which file a bundle lives in, the
  l10n/Weblate registration a *new* one needs, which locale committers maintain, deprecating and
  renaming.
- **dependencies** — the checklist a third-party project must pass before a distribution depends on
  it; and upgrading a JavaScript one, whose lockfile the build's pinned pnpm rewrites.
- **commit-messages** — the format of a commit summary and body, and when `[Misc]` is allowed.
- **versioning** — which version string `@since` and `@Deprecated(since=…)` take.
- **backward-compatibility** — what a public API may change, what Revapi checks, the `@Unstable`
  lifecycle, and evolving an interface with default methods.
- **security** — writing scripts, templates and queries safely: escaping, untrusted input, the rights
  a script runs with, injection.
- **script-services** — how a script service reports an error (it throws, the caller uses `#try()`;
  it does not return `null` for a `getLastError()` read-back) and takes arguments, and why an
  existing signature cannot change.
- **performance** — the memory rule for user-sized data: stream it, never buffer it.
- **logging** — what to pass a log call and at which level, and why an explicit `toString()` is
  usually deliberate.
- **documentation** — writing a page in the xwiki.org documentation tree: Diataxis type, naming,
  structure, style, visuals, versioning, linking. Applied by `xwiki-doc-writing` / `xwiki-doc-convert`.
- **documentation-migration** — a migration only: what becomes of the *original* page once its content
  has moved, and when the migrated tree may be published.
- **page-deletion** — read before deleting any xwiki.org page, whatever the reason: its backlinks are
  fixed first, and the deletion wizard repoints less than it appears to.
- **documentation-mechanics** — the storage behind such a page (xobjects, quality checker,
  navigation order): editing one programmatically, its wordless red banner, or a
  `DocumentationClass` sweep that silently skipped landing pages.

### architecture/
- **component-system** — declaring, injecting and instantiating components, and the two kinds of event
  listener.
- **platform-modules** — how xwiki-platform is laid out and which module new code belongs in: the
  tools/core/distribution split, the modules worth knowing by name, and what
  `xwiki.extension.features` advertises.
- **macro-refactoring** — how a macro's references are rewritten when what they point at is renamed,
  and why one held in a macro *parameter* is left pointing at the old name.
- **wiki-application-data** — data held by an XClass + wiki-page application: why a range filter on a
  list property compares lexicographically, entry naming, migrations.
- **required-rights** — declaring the rights a page shipped by an extension needs: under-declaring
  disables the page silently instead of failing — a wiki macro goes unregistered and its users
  render `Unknown macro: <id>`.
- **wiki-user-scope** — why a subwiki offers only main-wiki users and groups: where its user scope is
  stored (not on the descriptor) and what it defaults to.
- **solr-search** — XWiki's Solr backend, and what running it against a remote Solr requires.

### testing/
- **strategy** — the kinds of test XWiki has, how they are named, and the rules a test must satisfy.
  Procedures live in the test skills.
- **running-docker-its** — running the Docker functional tests on a developer machine: container
  networking, setup failures, what parallel runs contend for. Commands in `xwiki-build`.

### sonarqube/
Which SonarCloud fixes are *correct* in XWiki, and — the question that actually matters — which look
mechanical but silently break something. Read `sonarqube/index.md`, then **only** the one family file
for the rule being fixed. Pool sizes are deliberately absent (volatile — query the rule facet).
Applied by `xwiki-fix-sonarqube-issue`, which owns the *procedure*.
- **index** (`sonarqube/index.md`) — which family file holds a rule, the rules never worth fixing, and
  the drop conditions that apply to every rule.
- **syntax-rules** — the pure syntax and annotation rules.
- **simplification-rules** — the behaviour-preserving rewrites.
- **modernization-rules** — the language and API modernizations.
- **dead-code-rules** — removing unused code: the family with the most false positives.
- **constant-and-resource-rules** — constants, resources and exceptions.
- **test-code-rules** — the rules that fire only in test code.
- **verification** — what makes a Sonar fix verified rather than merely compiled.

### servers/
- **index** (`servers/index.md`) — the xwiki.org servers, how to reach each, and the traps of reading
  and writing over REST.
- **jira** — working with jira.xwiki.org: whether to file at all, the issue fields, resolving,
  attachments, wiki markup.
- **jenkins** — querying ci.xwiki.org over its REST API, and how to read a result without drawing the
  wrong conclusion.

### processes/
- **release** — how the three repos are versioned and released together, and which branches a fix may
  still reach.
- **security-policy** — scoring a vulnerability, keeping it private until disclosure, and merging its
  fix.
- **module-lifecycle** — moving a module between repos with its history, and retiring one.
- **release-notes** — how a release note is stored and created, and which releases owe one. Applied by
  `xwiki-release-documentation`.

### decisions/ (ADRs)
Architectural Decision Records — the *why* behind durable choices (context, decision, consequences),
each grounded in a cited source. `_template.md` holds the format and the grounding rule.
- **check-binary-not-source-compatibility** — why Revapi stays silent on a change that breaks a
  caller's *source*: binary and semantic compatibility are enforced, source compatibility is not.

## Related skills (procedures, not knowledge)

`xwiki-build`, `xwiki-pull-request`, `xwiki-javadoc`, `xwiki-test-guidelines`, `xwiki-convert-tests`,
`xwiki-convert-tests-docker`, `xwiki-fix-flickering-docker-test`, `xwiki-increase-test-coverage`,
`xwiki-legacy`, `xwiki-deploy-extension`, `xwiki-rest-api`, `xwiki-xar-pages`, `xwiki-doc-writing`, `xwiki-doc-convert`, `xwiki-translations`,
`xwiki-contrib-release-blog-post`, `xwiki-fix-sonarqube-issue`, `xwiki-backport`,
`xwiki-backport-testneeded`, `xwiki-jira`, `xwiki-jira-bfd`, `xwiki-security-advisory`, `xwiki-openproject`,
`xwiki-release-test-triage`, `xwiki-ci-check`, `xwiki-release-documentation`, `xwiki-review`,
`xwiki-presentation`.

## How to extend the OKF (EXTEND)

New knowledge enters **only through a reviewed git PR** — never silent local writes. Use the
`xwiki-knowledge` skill, which runs the gate checklist (durable? generic/de-personalised? not a
secret or machine-specific detail? not already present?) and drafts a correctly-formatted entry.
When you add a topic, **update this map and the mirror in `instructions/xwiki-org.md`**.
