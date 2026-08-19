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

### conventions/
- **code-style** — line length (120), LGPL headers, component system, javax→jakarta, `-legacy` rules.
- **code-comments** — comment about the code as-is; never reference history or transient links.
- **naming** — Maven groupId/artifactId (+ the `-api`/`-ui`/`-webjar`/`-node-*`/`-test*` qualifier
  meanings, directory = artifactId, singular form), npm package rules (private vs. public
  `@xwiki/platform-*`), `xwiki.properties` property naming, UIXP/UIX ids, skins (bird names), icons.
- **frontend** — JavaScript as AMD/RequireJS modules prefixed `xwiki-`, shipped as WebJars/JSX
  ("On demand only"), never inline; the minifier trap when Velocity is mixed into JavaScript and the
  wrapper that separates them; deprecating a JS API via `compatibility.js`; WCAG 2.2 AA.
- **translations** — the key lifecycle: only en_US is committer-maintained (US spelling), where a
  bundle lives and the l10n.xwiki.org + Weblate-script registration a new one needs, deprecating a key
  in the `#@deprecatedstart` section, renaming with `#@deprecated`, and why keys are never moved.
- **dependencies** — the checklist a third-party project must pass to enter a distribution (license is
  non-negotiable, longevity, cadence, support, ≥3/≥1 active contributors, docs, security) + the VOTE
  waiver.
- **commit-messages** — summary = JIRA key + the issue's title *verbatim*, details as `*` bullets in
  the body; `[Misc]` only when there is genuinely no issue.
- **versioning** — `@since`/`@Deprecated(since=…)` use `<X.Y.0>RC1`; current version is volatile.
- **backward-compatibility** — Revapi (incl. where it does *not* look), the `@Unstable` lifecycle,
  evolve interfaces via default methods.
- **security** — escaping APIs, untrusted user input & translations, only Velocity runs on Script
  Right (every other language also needs Programming Right, but a script service does not),
  context-author right checks in script services, configurable HTML sanitizer.
- **performance** — prefer streaming over buffering; never load an unbounded payload (attachment,
  body, upload, export, query result) fully into memory.
- **logging** — a log argument is an **object**: it is captured in the `LogEvent`, XStream-serialized
  into the job log and rendered later by type. So an explicit `toString()` is usually deliberate and
  must not be "cleaned up" — with the decision table for when to pass the object (references,
  extension ids, enums) and when to force the String (arbitrary sources, live resources, builders,
  requests, a masked `toString()`, a `Class` from an extension jar), and the `java:S2629` exemptions.
- **documentation** — xwiki.org documentation rules: Diataxis types & audiences, title/page-name
  rules (incl. title case), per-type content rules — including the **result step** that must close a
  How-to/Tutorial **with a screenshot**, a **screenshot on most steps** of a UI procedure, and the
  **topic page** being an Explanation linking to its Extensions-wiki page,
  and **show, don't only tell** (aim for screenshots on User/Administrator pages, code
  examples on Developer ones, an architecture or concept diagram on an Explanation — plus when not to
  force a visual), how much belongs on one page (a How-to is one procedure with a
  one-paragraph intro; one fact, one page; **keep verbosity low** since readers skim, and a **hub page
  routes rather than narrates** — it links every page it introduces — plus how duplication is actually
  detected, by comparing pages rather than
  writing each carefully), page-structure xobject fields with the exact semantics of
  Highlights / More / Related, style (incl. **never hard-wrapping prose** — one paragraph is one
  unbroken line, on xwiki.org pages and forum.xwiki.org posts alike; 120 chars is a Java-source rule),
  attachment/image/video rules (kebab-case names, `{{image}}` +
  `alt`, **`size` mandatory and `width` forbidden in the `documentation` space**, which fixes the width a
  screenshot must be captured at, **`webm` videos displayed with `{{embed}}`, never linked**, Gallery,
  PlantUML `bluegray`), location, version perspective and the `{{version}}` macro (incl. **documenting a
  feature before its release**, badged `since`), the XWiki syntax traps that silently mis-render
  (`image:`, `--`, anchors, URLs in headings), **a renamed heading losing the anchor id its old
  text generated unless `{{id name=…}}` declares it**, **linking a farm subwiki by URL instead of
  `doc:<wiki>:<ref>` plus the nine cases where an absolute xwiki.org URL *is* correct — and why a `url:`
  prefix is not one of them**, and navigation-order pinning. The live Documentation
  Guide is the evolving source of truth. Applied by `xwiki-doc-writing` and `xwiki-doc-convert`.
- **documentation-migration** — the last step of a *migration* only, split out of the above so an
  ordinary authoring task need not load it: handling the **original** page once its content has moved
  — repointing an old `Documentation`-space page (keeping the anchors), stripping the prose from an
  e.x.o extension page without deleting it (**every** xproperty that holds prose, not just
  `description`) and wiring its "Documentation" button via the `ExtensionLD` URL, **deleting its
  leftover attachments** (the one place the never-delete-an-attachment rule is inverted), and
  **triaging its backlinks** (which to repoint, which to leave). Applied by `xwiki-doc-convert`.
- **page-deletion** — the rule that applies to **deleting any page on xwiki.org**, whatever the reason
  (migrated page, duplicate, obsolete extension/blog page, or an intermediate page you created
  yourself): **list and fix the backlinks before deleting**, since the breakage lands on *other* pages
  that nothing names for you. What the deletion wizard does repoint (**only** with a "New target" +
  "Update links", plus the `XWiki.RedirectClass` redirect option) and what it never does — a REST
  `DELETE`, absolute-URL links, macro parameters without `MacroRefactoring`, xproperty-stored
  references; how to get the backlink list (Information tab → Backlinks, farm-wide) and why it must be
  completed with a farm-wide search; the triage table; and how to recover from a premature delete via
  the trash. Applied by `xwiki-doc-writing` / `xwiki-doc-convert` / `xwiki-rest-api` and by any task
  that removes a wiki page.
- **documentation-mechanics** — the storage side of the above, for editing xwiki.org pages
  programmatically or diagnosing a warning banner: the `DocApp` xobjects (structure fields,
  Technical ID, quality-checker violations), **the separate `LandingPageClass` that landing pages carry
  instead of `DocumentationClass` — which makes any sweep selecting on `DocumentationClass` skip every
  landing page silently**, how to read the checker's real findings instead of guessing
  at the red banner — **and why listing the violation objects is not enough, since some findings appear
  only as an inline error box in the rendered page** — how navigation order is pinned on the parent
  space's `WebPreferences` page (and why it must be verified through the Document Tree service), and the
  hidden-fragment pattern behind
  `{{display}}`. The generic REST calls live in the `xwiki-rest-api` skill.

### architecture/
- **component-system** — `@Role`/`@Component`/`components.txt`, `@Inject`/`@Named` hints, instantiation.
- **macro-refactoring** — `MacroRefactoring` role (keyed by macro id) rewrites a macro's references on
  rename/move and extracts them for backlinks; `DefaultMacroRefactoring` is content-only (ignores parameters).
- **wiki-user-scope** — a subwiki's user scope (local/global/both) is stored on its own
  `WikiManager.WikiUserConfiguration` doc (not the descriptor) and defaults to `GLOBAL_ONLY` when absent.
- **solr-search** — XWiki's Solr backend: embedded by default, externalisable to a remote/standalone
  Solr which needs several pre-created cores (`search`, `extension_index`, `ratings`, `events`, named
  `xwiki_<core>_<solrMajor>`); configured via `solr.type=remote` + `solr.remote.baseURL`; the search
  core needs Solr's `analysis-extras` module.

### testing/
- **strategy** — test kinds & naming, no-stdout rule, lightest-base rule, `@Order` source-ordering rule, the page-object boundary (no `getDriver()` in a test), don't-pay-the-timeout rule, reading a PRChecker log line, coverage, framework locations.

### sonarqube/
Which SonarCloud fixes are *correct* in XWiki, and — the question that actually matters — which look
mechanical but silently break something. Read `sonarqube/index.md`, then **only** the one family file
for the rule being fixed. Pool sizes are deliberately absent (volatile — query the rule facet).
Applied by `xwiki-fix-sonarqube-issue`, which owns the *procedure*.
- **index** (`sonarqube/index.md`) — rule → family-file map; the rules never worth fixing (incl. the
  XWiki idioms Sonar misreads: `S2447` null-from-a-script-service, `S1215` `$xwiki.gc()`, `S2065`
  XStream-honoured `transient`); and the drop conditions common to every rule (120 chars, Revapi,
  JaCoCo, an explanatory comment, an existing suppression, the ~15-minute ceiling).
- **syntax-rules** — S1116 S1124 S1128 S1161 S1197 S1611 S3878 S7476. Holds S3878's
  **infinite-recursion trap** (spreading `new Object[]{…}` re-binds to a same-name fixed-arity
  overload — often the enclosing method, the whole commons `logging-*` SLF4J family).
- **simplification-rules** — S1066 S1125 S1126 S1155 S1488 S1602 S1612 S1858 S2130 S2864 S3706 S7158.
  S1612's method-ref-needs-the-type-imported build-breaker; S7158 fires on `String` receivers too;
  S1066's outer-`else` and comment-between-the-`if`s drops plus the brace-balance check.
- **modernization-rules** — S1604 S1640 S1643 S6126 S6201 S6204/S6211. The big ones: S6201's
  flow-scoping shapes and one-issue-per-cast; **S6204's escape analysis** (`.toList()` is
  unmodifiable — trace to the outermost public/`ScriptService` method, since Velocity callers are
  untraceable; the sibling-branch safe signal; the defensive-copy setter) and its `Collectors`
  orphaned-import build-breaker; S1640's `EnumMap` **null-key runtime break**; S1643's prepend and
  StringBuilder-vs-mock-equality traps; S6126's text-block byte-identity rules.
- **dead-code-rules** — S1068 S1118 S1144 S1185 S1481 S1854. The highest false-positive family:
  **`XWikiPluginManager.initPlugin()` reflective `getDeclaredMethods()` dispatch** makes every
  `com.xpn.xwiki.plugin.*` super-only override load-bearing (S1185); `.hbm.xml`-mapped accessors
  (S1144); S1118's `FinalClass` follow-on, Revapi `visibilityReduced` and the `-legacy` re-export;
  removal cascades.
- **constant-and-resource-rules** — S1143+S1163 S1192 S2093 S2119 S2147 S3626 S5361. S1192's
  reviewer preferences (parameterized SLF4J over a constant, the owning `*DocumentInitializer`
  constant, `@since` on a widened field) and forward-reference gotcha; **S2093 in XWiki is usually a
  state *restore*, not a close** — that batch is near-100% drops.
- **test-code-rules** — S3415 S5785 S5786 S8924. **S5785 must not be applied inside
  `equals()`/`hashCode()` contract tests** (reviewer-rejected — suppress instead) and receiver-first /
  never-flip-operands; S3415's default-drop on asymmetric `equals`; S5786's cross-module test-jar check.
- **verification** — what makes a Sonar fix *verified*: never skip the tests, `-Plegacy,quality` is
  mandatory, why removing covered instructions **always** lowers a JaCoCo ratio `(c−k)/(t−k) < c/t`
  (so drop the module, never the pinned ratio), and how to tell your reactor failure from a
  pre-existing one.

### servers/
- **index** — the xwiki.org server ecosystem (JIRA, CI, Nexus, SonarCloud, forum, …) and how to
  access/verify each (MCP vs. WebFetch); plus writing via REST (only `/rest` honors Basic auth, the
  `XWiki-Form-Token` CSRF header, and the `extensions` subwiki id) and the `~/.xwiki-credentials`
  convention (never printed, only sourced).
- **jira** — accessing jira.xwiki.org (jira-cli or REST), the durable issue-field conventions
  (Component, Affects Version = oldest affected/else last LTS, Fix Version); values are volatile;
  resolving/closing (Fixed vs. Cannot Reproduce for already-covered issues, assign to yourself); and
  wiki-markup gotchas (wrap literals in `{{…}}`, don't over-escape prose, never escape inside `{code}`).
- **jenkins** — querying ci.xwiki.org through the Jenkins REST API (`/api/json?tree=…`, anonymous
  read) instead of scraping the UI: the multibranch URL shape, the endpoints for builds / failing
  tests / changesets / built SHA / artifacts / `consoleText`, and the **Cloudflare trap where a
  spoofed browser User-Agent gets a 403 while plain `curl` gets 200**. Plus the traps in reading a
  result: `FAILURE` (broke outside the tests) vs `UNSTABLE` (tests failed), why a test case's
  `age`/`failedSince` is not a reliable first-failure, empty `changeSets`, and diagnosing a docker-test
  failure from its archived screenshot — including a UI failure with no source change caused by
  `parent-platform` moving `${platform.version}`.

### processes/
- **release** — how XWiki versions/releases (Commons+Rendering+Platform together); detailed steps are
  volatile pointers to the dev wiki.
- **security-policy** — CVSS-4 severity scoring (volatile; verify) and the durable rule never to
  reveal a vulnerability publicly until disclosure (obfuscated commits, restricted JIRA issues); plus
  merging a non-committer's security PR by hand from the advisory's private fork, never via the UI.
- **module-lifecycle** — moving code between repos with its history: `git subtree split` to extract
  (and what changes when the target is xwiki-contrib — contrib parent at the LTS version,
  `xwiki.extension.features`, same version), `git subtree add` to merge in, retiring to the
  (unsupported) Attic, and the top-level-extension criteria.

### decisions/ (ADRs)
Architectural Decision Records — the *why* behind durable choices (context, decision, consequences),
each grounded in a cited source. `_template.md` holds the format and the grounding rule.
- **check-binary-not-source-compatibility** — why Revapi enforces binary/semantic but not source
  compatibility.

## Related skills (procedures, not knowledge)

`xwiki-build`, `xwiki-pull-request`, `xwiki-javadoc`, `xwiki-test-guidelines`, `xwiki-convert-tests`,
`xwiki-convert-tests-docker`, `xwiki-fix-flickering-docker-test`, `xwiki-increase-test-coverage`,
`xwiki-legacy`, `xwiki-deploy-extension`, `xwiki-rest-api`, `xwiki-xar-pages`, `xwiki-doc-writing`, `xwiki-doc-convert`, `xwiki-translations`,
`xwiki-contrib-release-blog-post`, `xwiki-fix-sonarqube-issue`, `xwiki-backport`,
`xwiki-backport-testneeded`, `xwiki-jira`, `xwiki-review`.

## How to extend the OKF (EXTEND)

New knowledge enters **only through a reviewed git PR** — never silent local writes. Use the
`xwiki-knowledge` skill, which runs the gate checklist (durable? generic/de-personalised? not a
secret or machine-specific detail? not already present?) and drafts a correctly-formatted entry.
When you add a topic, **update this map and the mirror in `instructions/xwiki-org.md`**.
