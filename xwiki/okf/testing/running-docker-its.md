---
title: Running Docker functional tests on a developer machine
stability: durable
summary: How the browser container reaches XWiki under each servlet engine and why that makes the two
  configurations exercise different networking, which engine to pick for the local loop and when the
  containerised one is mandatory, the setup-failure symptom table (a beforeAll failure is never
  evidence about your change), and what several agents sharing one machine contend for.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/
---

# Running Docker functional tests on a developer machine

Declarative companion to `strategy.md`, which owns how to *write* a functional test. This file is
about *running* `-Pdocker,integration-tests` on a machine that is not a clean CI agent. The commands
live in the `xwiki-build` skill.

## The browser is always a container; what changes is how it reaches XWiki

`@UITest` runs the browser in a container in every configuration. The `servletEngine` decides how
that container reaches the wiki, and the two mechanisms fail in different ways:

- **`JETTY_STANDALONE` (the framework default)** — XWiki runs on the **host**, and the framework
  gives the browser container an `/etc/hosts` entry mapping the servlet engine's network aliases to
  `host-gateway` (`BrowserContainerExecutor`, logged as `Mapping servlet engine network aliases [..]
  to [..]`). No name resolution goes through Docker's embedded DNS. It binds host ports 8080/8079,
  and `start_xwiki.sh` spawns the wiki's JVM using `java` from `PATH`.
- **A containerised engine (`tomcat`, `jetty`, `wildfly`)** — the servlet container joins a
  user-defined testcontainers network under the alias `xwikiweb`, and the browser container resolves
  that alias through Docker's embedded DNS. Nothing binds a fixed host port; testcontainers maps
  random ones.

**So the two configurations exercise different networking**, and that is the whole reason to care
which one you ran. A test, a page object or a fixture that assumes a host name, a port, or a path on
the host filesystem can be green on one and broken on the other — and the containerised shape is the
one the CI configuration matrix exercises. A defect of that kind found only by CI costs a full
pipeline round trip.

- **Local iteration loop** — the default engine, whenever nothing else owns :8080. It is the
  fastest, and structurally it cannot fail on container-to-container DNS.
- **The containerised engine is mandatory** before treating a green local run as CI-safe, and
  whenever the change touches how the test reaches the wiki at all: URLs, ports, host names, files
  shared with the container, uploads, downloads, LibreOffice, or anything reading a host path.

**verify:** which configurations CI actually runs is volatile — read the repo's `Jenkinsfile` (the
`xwikiBuild` `profiles`/`properties`) and the Docker testing page above, rather than assuming a
matrix.

## A setup failure is never evidence about your change

`RuntimeException: Error setting up the XWiki testing environment` is raised from `beforeAll`: **no
test method ran**, so the run says nothing about the code under test. The same is true of every line
below. Repair the machine and re-run; do not start debugging the change.

| Log line | What it actually is |
|---|---|
| `Failed to install Extension(s) … Response status code [401]` | another XWiki owns host :8080, and the framework provisioned its extensions into *that* wiki |
| `Failed to start XWiki in [120] seconds, last error code [-1]` | `start_xwiki.sh` found a too-old `java` on `PATH` (an `UnsupportedClassVersionError` buried in the log), or :8080 is taken |
| `Could not start container … standalone-firefox … TimeoutException` | the Docker daemon is starved; the browser missed its wait strategy |
| `Reached error page: about:neterror?e=dnsNotFound&u=http://xwikiweb:8080/…` | containerised engine only — the browser cannot resolve the `xwikiweb` alias. Daemon under load, or a stale/broken testcontainers network |
| `SocketException: Connection reset` while provisioning extensions | the servlet container was still booting when provisioning started; daemon starved |

`JETTY_STANDALONE` needs the right JDK **on `PATH`**, not only in `JAVA_HOME`, because the wiki's JVM
is spawned by a shell script.

## What several agents on one machine contend for

Docker ITs are a machine-wide resource, and nothing in Maven or testcontainers serialises them. Three
distinct collisions, in the order they bite:

- **Host port 8080 is global.** Only one `JETTY_STANDALONE` run can exist at a time, and it also
  collides with the wiki the developer keeps running. The second run does not fail cleanly: it
  provisions into the first one's wiki and reports a `401`.
- **The daemon has a finite budget.** Each run holds a servlet engine, a browser container of a
  couple of gigabytes, and a ryuk. A few concurrent runs starve it, and starvation never announces
  itself as such — it surfaces as the setup failures in the table above. Long-lived containers that
  are nobody's test (MCP servers, leftovers from killed runs) count against the same budget.
- **`~/.m2` is shared.** Two `mvn install` of the same SNAPSHOT from different worktrees interleave,
  so a run can install the artifact another agent has just written. Serialising the whole Maven
  invocation, not merely the failsafe phase, is what removes this one. Related: an extension whose
  version has not changed is *not* re-imported, so a test database that survives a run serves the
  previous run's pages.

The practical rule is to cap concurrent runs rather than forbid them — the `xwiki-build` skill has
the wrapper that does it, defaulting to 2.
