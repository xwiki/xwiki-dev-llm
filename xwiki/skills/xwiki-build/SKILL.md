---
name: xwiki-build
description: Build and test XWiki Maven modules. Use when building XWiki, running its tests, or when the user mentions mvn, a build, a failing test, or a specific XWiki module.
---

# Building and testing XWiki

XWiki is a multi-module Maven project. Almost every build needs the `legacy` profile.

**Always pass `-B -ntp`** (batch mode + no-transfer-progress) on every `mvn` invocation. This
removes all interactive prompts and the download/progress lines that otherwise flood the output —
keep it on the commands below and on any new `mvn` command you run.

**Always start with `clean`** (`mvn clean <goal>`). XWiki builds leave generated artifacts and
per-module state behind, and stale `target/` (and locally-installed SNAPSHOTs) cause confusing,
hard-to-diagnose failures.

## Run `xmvn` rather than `mvn` when it is available

Every command below is written `mvn`; run it as `xmvn` whenever `command -v xmvn` finds one. `xmvn`
ships with [`xwiki-dev-tools`](https://github.com/xwiki/xwiki-dev-tools) (`bash/xmvn`) and is a
drop-in wrapper: it reads `xwiki.java.version` from the pom in the current directory (falling back to
deducing it from the XWiki version in that pom), exports the matching `JAVA_HOME`, then runs `mvn`
with the arguments you passed. Run it from the directory holding the pom — with no `pom.xml` there it
just delegates to `mvn` unchanged.

Prefer it over selecting the JDK yourself: it is one command instead of a version lookup followed by
an explicit `JAVA_HOME`, and it cannot pick the wrong JDK for the branch. It costs a little
wall-clock time (an extra `help:evaluate` before the real build), which is a good trade.

Without `xmvn`, do not trust the machine default JDK — get the version the branch targets from the
root pom and point `JAVA_HOME` at that JDK:

```bash
mvn -N -B -ntp -q -DforceStdout help:evaluate -Dexpression=xwiki.java.version   # e.g. 11
JAVA_HOME=<path to a JDK of that version> mvn clean install -B -ntp -Plegacy
```

This matters because building an older branch with a too-new JDK fails in ways that read as code or
configuration problems and are neither: JaCoCo aborts instrumenting with `Unsupported class file
major version NN` (its bundled ASM cannot read the JDK's own classes, so *every* `-Pquality` build
fails), and the Spoon plugin fails with `could not add URL to system classloader`. Which Java version
each XWiki version needs is in the Java support strategy (linked from the org-wide conventions).

**`sonar:sonar` has a JDK floor of its own**, higher than the level the branch's code targets on the
older lines: the scanner refuses to run on too old a JDK. `xmvn` handles this — when it finds a sonar
goal in the arguments (the `sonar:sonar` shortcut or the fully qualified
`…:sonar-maven-plugin:<version>:sonar` form) it raises the Java version to the scanner's minimum — so
running the analysis through `xmvn` is one more thing you do not have to remember. If you do select
the JDK by hand, apply that floor yourself. Both `xmvn` and CI (`xwiki-jenkins-pipeline`'s
`vars/configureJavaTool.groovy`) hold the current value; read it from one of them rather than trusting
a number here, since it moves with the pinned `sonar-maven-plugin` version.

## Full build (fast, unit tests only — no integration tests)

```bash
mvn clean install -B -ntp -Plegacy \
  -Dxwiki.checkstyle.skip=true -Dxwiki.surefire.captureconsole.skip=true \
  -Dxwiki.revapi.skip=true
```

Without the `integration-tests` profile, `*IT.java` tests don't run. To include integration tests,
add `-Pintegration-tests` (and `-Pdocker` for the Docker-based ITs). `-DskipITs` skips ITs while
keeping unit tests; `-DskipTests` skips all tests.

> **These skip flags are for speed only.** They disable Checkstyle, API compatibility checks, and
> console-capture validation to make the full multi-module build faster. Do NOT carry them over to
> single-module builds when you need to validate code quality (e.g., before committing).

## Build a single module

```bash
mvn clean install -B -ntp -pl <module-path> -Plegacy
```

For example in xwiki-platform: `-pl xwiki-platform-core/xwiki-platform-<module>`.

This command runs Checkstyle, API compat (Revapi) and the other default checks, and is the correct
way to validate code quality before committing. Do not add the skip flags from the full build recipe
here unless you explicitly want to bypass those checks. It does **not**, however, run the JaCoCo
test-coverage check — add `-Pquality` for that (see Notes); do so whenever the change touches
production code.

## Validate **every** module the change touched

A change that spans many modules (a cross-cutting sweep, a refactoring) is only verified for the
modules you actually ran the checks on. Build them all in one reactor rather than picking a
representative few:

```bash
mvn clean install -B -ntp -Plegacy,quality -fae -pl <comma-separated module paths>
```

`-fae` (fail-at-end) keeps going so one broken module doesn't hide the state of the rest. Derive the
list mechanically from the diff (`git show --name-only`, then walk up to the nearest `pom.xml`) —
not from memory of what you edited.

Two ways `-pl` rejects a path with *"Could not find the selected project in the reactor"* even when
the path is correct: the module is only activated by a profile (`*-test-docker` modules need
`-Pdocker,integration-tests`), or it is not in the root reactor at all (`xwiki-platform-distribution/**`
builds from its own `pom.xml`). Add the profiles, or build that module from its own tree.

## Checkstyle alone — `mvn checkstyle:check` is NOT the check CI runs

A single-module `install`/`verify` runs the real Checkstyle. When you want Checkstyle feedback on its
own — it needs no compilation, so it is seconds per module instead of minutes — you must name the
**execution**, not the bare goal:

```bash
mvn -B -ntp checkstyle:check@default checkstyle:check@test -pl <module-path>
```

> **`mvn checkstyle:check` (no `@…`) silently checks almost nothing.** A goal invoked from the
> command line takes the *plugin-level* `<configuration>`, and in the XWiki parent POM that sets
> `configLocation=checkstyle-blocker.xml` — a handful of blocker rules. The real rulesets live in the
> plugin's **executions**: `default` → `checkstyle.xml` over `src/main/java` (the one CI reports as
> "N errors reported by Checkstyle X with checkstyle.xml ruleset"), `test` → `checkstyle-test.xml`
> over `src/test/java`, `blocker` → `checkstyle-blocker.xml`. So a bare `checkstyle:check` prints
> `You have 0 Checkstyle violations` / `BUILD SUCCESS` on code that fails CI: a green run of it is
> evidence of nothing, and reporting it as "Checkstyle passes" is wrong.

## Also rebuild any legacy module that weaves the changed module

Some modules are wrapped by a `-legacy` module that re-adds deprecated/removed APIs by weaving the
original module's bytecode with AspectJ. That legacy module compiles and tests against your changed
code, so a change that builds fine on its own can still break the legacy module.

A legacy module wraps your module when its `pom.xml` configures `aspectj-maven-plugin` with a
`<weaveDependency>` whose `<artifactId>` is the module you changed. For example, a change to
`xwiki-platform-oldcore` must also be validated by rebuilding `xwiki-platform-legacy-oldcore`:

```bash
grep -rl '<weaveDependency>' --include=pom.xml   # find legacy modules and inspect their weaveDependency artifactIds
```

When such a legacy module exists, build it too (single-module build, all checks on) to confirm it
still compiles and its tests still pass:

```bash
mvn clean install -B -ntp -pl <legacy-module-path> -Plegacy
```

## Run tests

```bash
# All unit tests in a module
mvn test -B -ntp -pl <module-path>

# A single test class
mvn test -B -ntp -pl <module-path> -Dtest=MyTestClass

# A single test method
mvn test -B -ntp -pl <module-path> -Dtest=MyTestClass#myMethod

# Integration tests
mvn verify -B -ntp -pl <module-path> -Pintegration-tests
```

### Docker ITs: never stop an XWiki instance you did not start

`@UITest` defaults to `JETTY_STANDALONE`, which runs XWiki on the **host** and binds ports 8080/8079.
When something already listens there — typically an XWiki the developer is running — the test's Jetty
silently fails to bind, the test drives that instance instead, and `beforeAll` dies with
`Failed to install Extension(s) … Response status code [401]`.

Check the port first (`lsof -nP -iTCP:8080 -sTCP:LISTEN`). Stop the instance only when **this session
started it**; otherwise leave it running and move the whole stack into Docker instead:

```bash
mvn verify -B -ntp -pl <module-path> -Pdocker,integration-tests \
  -Dxwiki.test.ui.servletEngine=tomcat -Dxwiki.test.ui.database=postgresql
```

## Common profiles

Standardized across all XWiki projects — see
https://dev.xwiki.org/xwiki/bin/view/Community/Building/#HUsingProfiles for the full list and
definitions.

| Profile             | Purpose                                                              |
|---------------------|---------------------------------------------------------------------|
| `legacy`            | Includes backward-compatibility (`-legacy`) modules; almost always needed |
| `integration-tests` | Activates integration-test (`*IT.java`) execution via Failsafe       |
| `docker`            | Runs the Docker-based integration tests (requires Docker installed); used together with `integration-tests` |
| `quality`           | Checkstyle + Revapi + Enforcer checks, **plus the JaCoCo coverage check** (see Notes) |

## Notes

- The `legacy` profile activates backward-compatibility shim modules and is almost always required.
- Skip flags worth knowing: `-Dxwiki.checkstyle.skip=true` (Checkstyle),
  `-Dxwiki.revapi.skip=true` (API compat), `-Dxwiki.surefire.captureconsole.skip=true`
  (stdout capture check).
- Checkstyle and Revapi run in the `verify` phase (not `test`), so `mvn test` won't catch them —
  use `mvn clean verify` or `install` to validate.
- **The JaCoCo test-coverage check runs ONLY under `-Pquality`.** The `jacoco:check` goal that
  enforces each module's `xwiki.jacoco.instructionRatio` minimum is bound inside the `quality`
  profile in the parent POM — a plain `mvn clean install` (even a single-module one) never runs it.
  So **any code change must be verified with `-Pquality`** to confirm it didn't drop the module below
  its pinned coverage ratio, e.g. `mvn clean install -B -ntp -pl <module-path> -Plegacy,quality`.
  Because each module pins the ratio to its *achieved* coverage (locked in by the
  `xwiki-increase-test-coverage` skill), there is almost no slack: removing or simplifying code —
  including a mechanical SonarQube fix — can shift the covered/total instruction ratio and fail the
  check. This failure is invisible without `-Pquality` and only surfaces in CI (which builds with it).

## Reading a multi-module reactor result

- **Always run `mvn` from the repo root.** A `-pl <relative-path>` build launched from anywhere else
  fails fast with "Could not find the selected project in the reactor" — that is a path error, not a
  code error. Relaunch from the root.
- **A module failing mid-reactor SKIPS every module after it.** The modules marked `SUCCESS` before it
  in the summary are genuinely verified; the ones after were never built. After fixing or dropping the
  failing module, re-run a reactor containing the **skipped** ones — the first run did not cover them.
- **A failure unrelated to your change → drop that module, keep the rest.** Build order means a leaf
  failing last cannot taint the modules built before it, so every other `SUCCESS` stands and those
  modules need no rebuild. To tell whether a failure is yours: if `git diff --name-only` does not list
  the flagged class, it is not — confirm with `git log -1 -- <that class's file>`, which will point at
  an unrelated recent commit. A pre-existing red module on master (a Revapi failure left by an
  in-flight migration, say) fails your reactor without being your fault.
- `-am` (also-make) is only needed when a `X.Y.0-SNAPSHOT` sibling is genuinely unpublished. A
  "Could not find artifact" for a sibling is a resolution error, not a code error; otherwise SNAPSHOT
  siblings resolve from `~/.m2` or the XWiki remote repositories, and adding `-am` needlessly slows a
  `-Pquality` build by rebuilding the upstream tree.
