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
- **commit-messages** — JIRA-key prefix (`XWIKI-12345:`) or `[Misc]`.
- **versioning** — `@since`/`@Deprecated(since=…)` use `<X.Y.0>RC1`; current version is volatile.
- **backward-compatibility** — Revapi, the `@Unstable` lifecycle, evolve interfaces via default methods.

### architecture/
- **component-system** — `@Role`/`@Component`/`components.txt`, `@Inject`/`@Named` hints, instantiation.

### testing/
- **strategy** — test kinds & naming, no-stdout rule, lightest-base rule, coverage, framework locations.

### servers/
- **index** — the xwiki.org server ecosystem (JIRA, CI, Nexus, SonarCloud, forum, …) and how to
  access/verify each (MCP vs. WebFetch).

### processes/
- **release** — how XWiki versions/releases (Commons+Rendering+Platform together); detailed steps are
  volatile pointers to the dev wiki.

### decisions/ (ADRs)
Architectural Decision Records — the *why* behind durable choices (context, decision, consequences),
each grounded in a cited source. `_template.md` holds the format and the grounding rule.
- **check-binary-not-source-compatibility** — why Revapi enforces binary/semantic but not source
  compatibility.

## Related skills (procedures, not knowledge)

`xwiki-build`, `xwiki-pull-request`, `xwiki-test-guidelines`, `xwiki-convert-tests`,
`xwiki-convert-tests-docker`, `xwiki-fix-flickering-docker-test`, `xwiki-increase-test-coverage`,
`xwiki-deploy-extension`, `xwiki-documentation`, `xwiki-translations`,
`xwiki-contrib-release-blog-post`, `xwiki-fix-sonarqube-issue`.

## How to extend the OKF (EXTEND)

New knowledge enters **only through a reviewed git PR** — never silent local writes. Use the
`xwiki-knowledge` skill, which runs the gate checklist (durable? generic/de-personalised? not a
secret or machine-specific detail? not already present?) and drafts a correctly-formatted entry.
When you add a topic, **update this map and the mirror in `instructions/xwiki-org.md`**.
