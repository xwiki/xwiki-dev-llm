---
name: xwiki-fix-deprecation
description: Replace every call to a deprecated XWiki Java API with its replacement across xwiki-commons, xwiki-rendering and xwiki-platform — Java code and tests, but also Velocity templates, wiki pages (XAR), Groovy and JavaScript — then, once nothing calls it any more, retire the API to its -legacy module. When no API is named, propose easy candidates first. Use when asked to fix, remove or clean up deprecated usages, get rid of deprecation warnings, stop using a deprecated method/class, or retire a deprecated API. For the move to legacy itself use xwiki-legacy; for Maven commands use xwiki-build; before touching tests load xwiki-test-guidelines; for editing wiki pages use xwiki-xar-pages; for the issue use xwiki-jira and for the PR xwiki-pull-request.
---

# Fix a deprecation

A deprecated API is retired in two steps (the `backward-compatibility` OKF topic): first **every XWiki
caller moves to the replacement**, then the API itself **moves to its `-legacy` module**. This skill
does the first step and hands the second to `xwiki-legacy`. *Every* caller means every language: a
Velocity template or a wiki page calling the deprecated API is migrated like a Java class.

xwiki-commons, xwiki-rendering and xwiki-platform are released together, so a caller in any of them
counts. Work where the callers are; the API may be declared in another repo.

The tools below live in this skill's `tools/` directory (in Claude Code
`${CLAUDE_PLUGIN_ROOT}/skills/xwiki-fix-deprecation/tools/`, in Kimi Code `${KIMI_SKILL_DIR}/tools/`, in
opencode `$XWIKI_LLM_HOME/xwiki/skills/xwiki-fix-deprecation/tools/`). Both are plain Node, no install.

## 1. Choose the API

**Named by the developer** — go to step 2.

**Not named** — propose candidates, run from the repo whose deprecations you want to retire:

```bash
node <tools>/find-candidates.mjs --limit 30 [--module <path substring>] [--json <work-dir>/candidates.json]
```

It lists the repo's deprecated main-code APIs, easiest first, with the callers it finds by name in the
three sibling checkouts (`--repos` to point elsewhere). APIs nothing calls any more come first — they
only need the move of step 6; `--min-callers 1` shows the ones needing a migration. Counts are **upper
bounds**: a zero is reliable, a small count is not proof (a common name collects homonyms; the notes
say when callers do not even name the declaring class). Present about ten to the developer as a table
— API, since, Java / test / script callers, replacement, notes — and let them pick. Prefer, in order:

- **a named replacement**, or a deprecated **no-op** ("not taken into account anymore") whose callers
  just drop the call;
- **`legacy weaver exists`**: the later move needs no new legacy module, no pom or WAR change;
- few callers, old `since`; **script callers** cost more than Java ones (step 4 says why).

Set aside, even at zero callers: a **component** type (its role hint is the contract, not the Java type);
anything whose `@deprecated` text gives no replacement and is not a no-op — ask the developer what
replaces it.

## 2. Understand the replacement before touching a caller

Read the `@deprecated` Javadoc **and both implementations**. Migrating is only mechanical when they are
equivalent; the usual gaps are:

- implicit context (current wiki, user, locale, `XWikiContext`) vs. an explicit argument;
- string vs. reference arguments: a string was resolved relative to *something* — resolve it the same
  way (same resolver, same default reference) before calling the reference-based replacement;
- `null` handling, return value on "not found", checked vs. unchecked exceptions;
- side effects the old method had (saving, caching, firing an event) that the new one does not.

When they are not equivalent, adapt each caller to keep its behaviour, or stop and ask.

## 3. List every caller

**Compile, don't grep, for the exact list.** XWiki builds compile with `-Xlint:all` and
`showDeprecation`, so the build log names every call, resolved by type:

```bash
mvn clean test-compile -B -ntp -Plegacy -pl <modules> > <work-dir>/build.log 2>&1
node <tools>/deprecation-warnings.mjs <work-dir>/build.log [--api <Class#member>]
```

The modules are those `find-candidates` (or a grep) found callers in. Then grep for what javac does not
see — each of these is a caller to migrate too:

- calls from the **same top-level class**, and from code that is itself **`@Deprecated`**;
- **overrides and implementations** of the deprecated member (they break when it is removed);
- reflection or string references to the name;
- **scripts**: Velocity `$obj.method(` and getters read as properties (`$obj.fooBar` for
  `getFooBar()`/`isFooBar()`), Groovy, JavaScript — in templates (`*.vm`), skin files and wiki pages
  (`src/main/resources/**/*.xml`, content and objects alike). A script usually reaches the API through
  a wrapper — `$xwiki`, `$doc`, `$xcontext` (`com.xpn.xwiki.api.*`) or `$services.<hint>` — so grep the
  wrapper's deprecated member too, not only the core class's.

Callers inside **`-legacy` modules** are legacy code: leave them.

## 4. Migrate the callers

### Java

- Replace each call, keeping the behaviour (step 2); remove the imports that become unused. Touch nothing
  else.
- **Tests that stub or verify the deprecated method** (`when(mock.oldMethod())`, `verify(...).oldMethod()`)
  must move to the new method too: once the caller changed, the old stub no longer matches, and the test
  fails — or, worse, passes without testing anything. A replacement that is a different component needs
  its own `@MockComponent`. Load `xwiki-test-guidelines` before editing any test.
- Tests exercising the deprecated API *itself* follow it to the legacy module in step 6.

### Velocity, Groovy, wiki pages, JavaScript

- **Scripts see the script API, not the Java class.** Velocity reaches `com.xpn.xwiki.api.*` wrappers and
  script services; the replacement must be callable from there, with arguments a script can build (a
  reference from `$services.model.resolveDocument(...)`, not a Java constructor). When the replacement is
  not exposed to scripts, stop and ask: exposing it is new API, not a migration.
- **Velocity fails silently.** A method it cannot resolve — misspelled, or given a `String` where the
  replacement takes a reference — is not an error: the call is printed as-is or yields nothing. Match the
  replacement's signature exactly, and prove the result in step 5.
- Keep the call's surroundings: its escaping (`$escapetool.xml(...)`), its `#set`/`$NULL` handling, the
  rights it runs with (Groovy needs programming right; do not move code between the two).
- Edit wiki pages with the `xwiki-xar-pages` conventions (`mvn xar:format`, page version untouched,
  content XML-escaped in the `.xml`).

## 5. Verify

Build every module you touched, plus any `-legacy` module weaving one of them, with the quality checks
(`xwiki-build` has the details):

```bash
mvn clean verify -B -ntp -Plegacy,quality -fae -pl <touched modules>,<their legacy weavers>
```

- Use **`verify`, not `install`**: `install` writes your modified SNAPSHOTs into the shared `~/.m2`,
  where every other checkout on the machine then picks them up.
- Re-run `deprecation-warnings.mjs` on this log: the migrated API must be gone from it.
- **Scripts are not compiled, so the build proves nothing about them.** Run what renders them: the
  module's `*PageTest` unit tests, and the Docker functional tests covering the page or template when
  they exist (`xwiki-build`). With neither, deploy the module (`xwiki-deploy-extension`) and look at the
  rendered page, before and after — say in the PR which of these you did.
- Grep the callers again (step 3): none may be left, in any language.

## 6. Retire the API when no caller is left

Only when steps 3–5 leave **no** caller in any of the three repos, in any language (legacy code aside):

- **`internal` package**: not API — delete it.
- **Public API**: move it with the **`xwiki-legacy`** skill. It re-adds the API in the legacy module, so
  existing extensions keep working, with **no Revapi ignore** (the only exception needs the developer's
  explicit approval — see that skill).

When a caller cannot be migrated (its replacement is not exposed to scripts, say), stop after step 5 and
report it: the move waits. When the API lives in another repo than its callers, the caller PRs are merged
first, then the move is a PR in the declaring repo.

## 7. Issue and PR

- Neither the caller migration nor the move to legacy changes anything for users or extensions (the
  legacy modules ship by default), so **no JIRA issue is needed**: `[Misc]` is fine. An issue is always
  acceptable too — then component **Development Issues only** (`okf/servers/jira.md`), and the commit
  summary is its title, verbatim.
- One PR per API — or per group of related members of one class — so each stays reviewable. No backport:
  deprecation cleanup is for `master` only.
- Open it with `xwiki-pull-request`; in "Executed Tests", list the `mvn` commands, state that the
  deprecation warnings for the API are gone, and how each migrated script was checked.
