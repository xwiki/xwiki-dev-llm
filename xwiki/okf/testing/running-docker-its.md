---
title: Running Docker functional tests on a developer machine
stability: durable
summary: How the browser container reaches XWiki under each servlet engine and why that makes the two
  configurations exercise different networking, which engine to pick for the local loop and when the
  containerised one is mandatory, the setup-failure symptom table (a beforeAll failure is never
  evidence about your change), why runs leak containers and networks when ryuk cannot reach the
  daemon, and what several agents sharing one machine contend for.
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
| `NullPointerException: networkMode was not specified` starting `standalone-firefox`, or `all predefined address pools have been fully subnetted` | the daemon has no address pool left for a new network: earlier runs leaked their testcontainers networks (see below) |
| `Can't find descriptor for the component …` or `Failed to initialize mandatory document` at startup, then a `500` while provisioning | the WAR mixes SNAPSHOT jars built before and after a recent commit of the branch (see below) |

`JETTY_STANDALONE` needs the right JDK **on `PATH`**, not only in `JAVA_HOME`, because the wiki's JVM
is spawned by a shell script.

### Mixed SNAPSHOT jars after the branch moved

Every module of the test WAR you did not `install` yourself comes from the last Nexus deploy, which
lags the branch (the same mechanism as Environment Tests in [[jenkins]]). When a commit since that
deploy changed several modules together, the WAR can mix jars from before and after it, and XWiki
fails at startup. `install` from the branch the modules touched by the commits since the jars' date
(`git log origin/<branch> --since=<date>`), plus `xwiki-platform-web-war` when templates changed; the
profiles the test framework modules need are in `xwiki-build`.

## Leftover containers and networks: ryuk has to reach the daemon

The framework never stops the browser container or removes the run's network itself: testcontainers
starts a `testcontainers/ryuk` container per test JVM, and ryuk removes everything labelled with that
JVM's session once the JVM is gone. When ryuk cannot do it, nothing else does, and each run leaves
its browser container (a couple of gigabytes, still running) and its network behind. The networks are
what breaks first: each one holds an address pool, and once the pools are exhausted every run dies in
`beforeAll` with the `networkMode` / `address pools` lines of the table above.

The known cause is the ryuk image of **testcontainers 1.17 and older**, still used by builds on old
XWiki parents (contrib extensions especially): the 0.3.x images speak Docker API 1.29, which recent
daemons refuse — ryuk logs `client version 1.29 is too old` and removes nothing. Later ryuk images
negotiate the API version. The fix is per machine and applies to every testcontainers version, since
the protocol between testcontainers and ryuk has not changed across them:

```properties
# ~/.testcontainers.properties (or TESTCONTAINERS_RYUK_CONTAINER_IMAGE in the environment);
# take the ryuk image of the latest testcontainers release
ryuk.container.image=testcontainers/ryuk:<version>
```

The `xwiki-it-slot.mjs` wrapper (`xwiki-build` skill) applies such an image when the daemon refuses
the old ryuk and nothing is configured, and warns when leftover networks have piled up. It removes
nothing: the old ryuk container carries no session label, so from outside a leftover cannot be told
apart from a resource of another run still in progress. With no Docker functional test running, the
leftovers go with:

```bash
docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)
docker network prune -f --filter label=org.testcontainers=true
```

**verify:** `docker version --format '{{.Server.MinAPIVersion}}'` gives the oldest API the daemon
accepts; the ryuk image a testcontainers version uses by default is the `testcontainers/ryuk:` string
in its jar (`unzip -p testcontainers-<v>.jar 'org/testcontainers/utility/*.class' | strings | grep
testcontainers/ryuk:`).

## What several agents on one machine contend for

Docker ITs are a machine-wide resource, and nothing in Maven or testcontainers serialises them. Three
distinct collisions, in the order they bite:

- **Host port 8080 is global.** Only one `JETTY_STANDALONE` run can exist at a time, and it also
  collides with the wiki the developer keeps running. The second run does not fail cleanly: it
  provisions into the first one's wiki and reports a `401`.
- **The daemon has a finite budget.** Each run holds a servlet engine, a browser container of a
  couple of gigabytes, and a ryuk. A few concurrent runs starve it, and starvation never announces
  itself as such — it surfaces as the setup failures in the table above. Long-lived containers that
  are nobody's test (MCP servers, leftovers from killed runs or from a ryuk that cannot reach the
  daemon) count against the same budget.
- **`~/.m2` is shared.** Two `mvn install` of the same SNAPSHOT from different worktrees interleave,
  so a run can install the artifact another agent has just written. Serialising the whole Maven
  invocation, not merely the failsafe phase, is what removes this one. Related: an extension whose
  version has not changed is *not* re-imported, so a test database that survives a run serves the
  previous run's pages.

The practical rule is to cap concurrent runs rather than forbid them — the `xwiki-build` skill has
the wrapper that does it, defaulting to 2.
