---
title: Configuring a Docker functional test — option overrides, debugging, skips, HBM mappings, several users
stability: durable
summary: Which @UITest options a -Dxwiki.test.ui.* system property overrides and which it cannot reach,
  attaching a debugger to the wiki under test (suspended or not depending on the servlet engine), skipping
  a test on one browser (@IgnoreBrowser) or one engine (forbiddenEngines), why an extension's Hibernate
  mapping is never loaded unless its JAR is an extraJARs, and logging several users in at once.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/
provenance: official
last-confirmed: 2026-11-14
related: [testing/strategy.md, testing/running-docker-its.md, testing/flickers.md]
---

# Configuring a Docker functional test

What the `@UITest` framework does that its annotation does not show. How to write the test is
[[strategy]]; running it on a developer machine is [[running-docker-its]]. Where this file and the
Docker testing page disagree, this file follows the code of `xwiki-platform-test-docker` (master,
November 2026): the page names `forbiddenServletEngines` (the attribute is `forbiddenEngines`), says
system properties always win, and says `debug` suspends on every engine.

## A `-Dxwiki.test.ui.*` override that changes nothing

Each option is `@UITest(<option> = …)` or `-Dxwiki.test.ui.<option>=…`, but the system property
does not reach every option, and does not always win (`UITestTestConfigurationResolver`):

- **Scalars** (`browser`, `database`, `servletEngine`, the tags, `debug`, `offline`, `vnc`, …): the
  system property wins over the annotation.
- **Annotation only**, the property is never read: `extraJARs`, `resolveExtraJARs`, `sshPorts`,
  `forbiddenEngines`, `extensionOverrides`, `screenWidth`, `screenHeight`, `xwikiInstances`.
- **`profiles`, `servletEngineNetworkAliases`**: the comma-separated property is used only when the
  annotation leaves them empty — the annotation wins.
- **`properties`, `databaseCommands`**: merged key by key, as
  `-Dxwiki.test.ui.properties.<name>=…` and `-Dxwiki.test.ui.database.commands.<name>=…`; a property
  replaces the annotation's value for the same key only.
- `xwiki.test.ui.dependencies` (what to provision instead of the pom's dependencies) exists only as a
  system property.

## A breakpoint in the wiki's code: suspended start or not, depending on the engine

`debug=true` starts the wiki's JVM with a JDWP agent on port 5005, but the two engine families
differ (`XWikiExecutor`, `ServletContainerExecutor`):

- **`JETTY_STANDALONE` (default)** — the wiki runs on the host, started **suspended** on
  `localhost:5005` (5005 + instance index in a cluster): nothing happens until a debugger attaches,
  and the start timeout is raised to a day, so a forgotten attach looks like a hang, not a failure.
- **A containerised engine (`tomcat`, `jetty`)** — not suspended; container port 5005 is mapped to a
  random host port: find it with `docker ps`, then attach to `localhost:<port>`.

To step through server code while also driving the UI, the Docker testing page recommends a
containerised engine (`servletEngine = ServletEngine.TOMCAT`): under Jetty Standalone the breakpoint
leaves the page spinning until you step on. The browser itself is watched through the VNC URL the
run prints. Since 16.2, debug *logs* come from `verbose=true`, not from `debug`.

## Skipping a test on one browser or one servlet engine

- **One method, one browser**: `@IgnoreBrowser(value = "firefox", reason = "… XWIKI-nnnnn")`, plus an
  optional `version`. `value` and `version` are regexes matched against the running WebDriver's
  capabilities. Methods only (not classes), honoured by `@UITest` since 15.10.12, 16.4.1 and
  16.6.0RC1 (the annotation itself is older, from the JUnit 4 framework).
- **A class, one engine**: `@UITest(forbiddenEngines = {ServletEngine.X})`, annotation only. The
  check runs once, on the top-level class, with the configuration merged from every nested class: on a
  nested `*IT` it skips the **whole `AllIT`** on that engine, not just that class.

## An extension's Hibernate mapping is never loaded

A JAR contributing a Hibernate `.hbm.xml` cannot be installed as an extension (XWIKI-19932): only
mappings in JARs under `WEB-INF/lib` are read. A module carrying one, provisioned like any other test
dependency (as an extension), is therefore never mapped. It is the one routine case for `extraJARs`,
which [[strategy]] otherwise keeps as a last resort:

```java
@UITest(properties = { "xwikiDbHbmCommonExtraMappings=notification-filter-preferences.hbm.xml" },
    extraJARs = { "org.xwiki.platform:xwiki-platform-notifications-filters-default" })
```

Both halves are needed: `extraJARs` puts the JAR in `WEB-INF/lib`, the property adds the mapping
to the generated `hibernate.cfg.xml`. An `extraJARs` entry without a version takes the **current
pom's version**, wrong in a contrib extension whose version differs from the platform's;
`resolveExtraJARs = true` takes it from the pom's dependency tree instead, at the cost of time, and
a SNAPSHOT resolves to the latest *published* one.

## Several users logged in at once

One browser holds one session cookie per host, so a second user in the same browser needs XWiki
under a second host name (since 15.10.12, 16.4.1, 16.6.0RC1): declare it with
`@UITest(servletEngineNetworkAliases = ALIAS)` and inject `MultiUserTestUtils`:
`openNewBrowserTab(ALIAS)` opens a tab on that host, `switchToBrowserTab(handle)` and
`getFirstTabHandle()` move between users, `closeTabs()` closes all but the first.

Switch tabs only through it: `TestUtils` caches the host it builds URLs with and the CSRF form token,
and `MultiUserTestUtils` swaps both per tab. A bare `getDriver().switchTo().window(…)` leaves them on
the other user's host and token. A tab left in the background runs late:
[[flickers]] ("A background tab runs late").
