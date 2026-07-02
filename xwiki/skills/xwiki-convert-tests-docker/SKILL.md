---
name: xwiki-convert-tests-docker
description: Convert XWiki functional IT tests from the JUnit4 legacy framework (xwiki-platform-test-ui) to the JUnit5 Docker-based framework (@UITest). Covers module setup, @UITest configuration, WAR composition, repository setup, and common pitfalls.
---

# Converting XWiki functional IT tests to the Docker framework

Use this skill when converting existing tests that use the JUnit4 legacy functional test framework (based on `AbstractAuthenticatedTest`, `getUtil()`, `getRepositoryTestUtils()`, etc. from `xwiki-platform-test-ui`) to JUnit5 Docker-based tests using `@UITest`.

For converting unit tests (JUnit4/JMock → JUnit5/Mockito), use the `xwiki-convert-tests` skill instead.

## Module structure

Create a new Maven module alongside the existing test module (e.g. `xwiki-platform-extension-test-docker`):

```
src/
  test/
    it/org/xwiki/<feature>/test/docker/
      AllIT.java       ← test suite entry point
      FeatureIT.java   ← test class
    resources/
      packagefile/     ← any test resource files (XAR packages, etc.)
    webapp/            ← optional: files overlaid onto the test WAR (see "Overriding WAR files")
```

### AllIT.java

`AllIT` is the single entry point: it carries `@UITest` and aggregates every test class as a JUnit5
`@Nested` inner class, so XWiki is started **once** and shared across all of them.

```java
package org.xwiki.<feature>.test.docker;

import org.junit.jupiter.api.Nested;
import org.xwiki.test.docker.junit5.UITest;

@UITest
class AllIT
{
    @Nested
    class NestedFeatureIT extends FeatureIT
    {
    }
    // Add one @Nested class per *IT test class.
}
```

The `xwiki-commons` parent pom sets the failsafe `<includes>` default to `**/AllIT.java`, so only
`AllIT` runs — every test class must be reachable as a `@Nested` class from it.

**Where does the `@UITest` configuration go?** When a test class needs `@UITest` parameters
(`extraJARs`, `properties`, …), put them on the **test class's own `@UITest`**, and leave a bare
`@UITest` on `AllIT` — e.g. `xwiki-platform-extension-test-docker` (`ExtensionIT` holds the config,
`AllIT` is bare). A test class that needs no configuration can be left **without** any `@UITest` of
its own (e.g. `xwiki-platform-rest-test-docker`, whose pom documents that the nested classes are not
`@UITest`-annotated). Either way it must not be run standalone — only `AllIT` is executed.

### pom.xml key elements

```xml
<packaging>jar</packaging>

<dependencies>
  <!-- The feature's page objects module -->
  <dependency>
    <groupId>org.xwiki.platform</groupId>
    <artifactId>xwiki-platform-<feature>-test-pageobjects</artifactId>
    <version>${project.version}</version>
    <scope>test</scope>
  </dependency>
  <!-- Docker test framework -->
  <dependency>
    <groupId>org.xwiki.platform</groupId>
    <artifactId>xwiki-platform-test-docker</artifactId>
    <version>${project.version}</version>
    <scope>test</scope>
  </dependency>
</dependencies>

<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-failsafe-plugin</artifactId>
    </plugin>
  </plugins>
</build>
```

### Activating from the parent pom.xml

Add a `docker` profile to the parent test module's `pom.xml`:

```xml
<profiles>
  <profile>
    <id>docker</id>
    <modules>
      <module>xwiki-platform-<feature>-test-docker</module>
    </modules>
  </profile>
</profiles>
```

## @UITest annotation

The `@UITest` annotation on the IT class configures the Docker test environment:

> **Prefer pom dependencies over `extraJARs`.** The feature modules a test needs should be declared
> as normal (runtime) dependencies in the test pom — the framework installs them as runtime
> extensions (see "The minimal WAR" below). Reach for `extraJARs` only as a last resort, for JARs
> that must be physically present in `WEB-INF/lib` at WAR **startup** (e.g. a repository factory or
> index provider needed during bootstrap, before extensions are installed). The example below is
> exactly that last-resort case.

```java
@UITest(
    extraJARs = {
        // Last resort: these are needed in WEB-INF/lib at WAR startup, before runtime extension
        // installation, so they can't be provided as ordinary pom dependencies (which install as
        // extensions). Everything else belongs in the pom as a runtime dependency instead.
        "org.xwiki.commons:xwiki-commons-extension-repository-xwiki",
        "org.xwiki.platform:xwiki-platform-extension-index"
    },
    properties = {
        // Append properties to xwiki.properties (does NOT replace defaults).
        // Use this to configure extension repositories, feature flags, etc.
        "xwikiPropertiesAdditionalProperties=extension.core.resolve=false\n"
            + "extension.repositories = self:xwiki:http://localhost:8080/xwiki/rest"
    }
)
class FeatureIT { ... }
```

### Key @UITest parameters

| Parameter | Purpose |
|-----------|---------|
| `extraJARs` | JARs added to WEB-INF/lib. **Last resort** — only for components that must be present at WAR startup, before runtime extension installation (e.g. repository factories, index providers). For everything else, declare a pom dependency instead. Format: `"groupId:artifactId"` |
| `properties` | Entries added to `TestConfiguration`. `xwikiPropertiesAdditionalProperties` appends lines to `xwiki.properties` |
| `offline` | When `true`, configures Maven in offline mode; only `maven-local` repository is set in `xwiki.properties` |
| `xwikiExtensionRepositories` | REPLACES the full extension repository list. Prefer `xwikiPropertiesAdditionalProperties` to APPEND repositories instead |

### Repository configuration pattern

To use BOTH the local Maven repo AND the XWiki self-hosted repo (for test extensions served via REST), use `xwikiPropertiesAdditionalProperties` to append the self repo. Apache Commons Configuration2 accumulates duplicate `extension.repositories` keys into a list:

```
# Generated by offline=true:
extension.repositories = maven-local:maven:file:///~/.m2/repository

# Appended via xwikiPropertiesAdditionalProperties:
extension.repositories = self:xwiki:http://localhost:8080/xwiki/rest
```

**Why not `xwikiExtensionRepositories`?** It's not in `KNOWN_LIST_KEYS` so it replaces rather than appends. `xwikiPropertiesAdditionalProperties` always appends.

## The minimal WAR

`WARBuilder` builds a minimal WAR from `xwiki-platform-minimaldependencies`. What this means:

- **Included in `WEB-INF/lib`**: only the core components in `minimaldependencies` (and their
  transitive deps) plus any `extraJARs` from `@UITest`.
- **NOT bundled in the WAR**: the test module's own dependencies. Instead, `ExtensionInstaller`
  reads the test pom's non-`test`-scope `jar`/`xar` dependencies and installs each as a **runtime
  extension** into the running XWiki — **skipping any artifact already bundled in the minimal WAR**
  (`ExtensionInstaller.getProjectExtensionIds()`). So declaring an already-bundled dependency is
  harmless (it's auto-skipped), and declaring a missing one gets it installed correctly. This is why
  the deps-first rule above works: just declare the feature modules under test as runtime
  dependencies.

**Migrating from a packager-based `-tests` module:** don't blindly carry over its runtime deps. Keep
only what the feature actually needs at runtime; drop infrastructure deps the minimal WAR already
provides (e.g. `xwiki-platform-search-solr-embedded` for a test that does no search).

Common `extraJARs` (the last-resort, startup-time case) needed for extension-related tests:
- `org.xwiki.commons:xwiki-commons-extension-repository-xwiki` — provides `XWikiExtensionRepositoryFactory` for the `xwiki:` repository type. Without it: startup error "Unsupported repository type [xwiki]".
- `org.xwiki.platform:xwiki-platform-extension-index` — Solr-backed extension search. Without it: `NullPointerException` in Solr client, keyword searches return 0 results.

## WAR file composition

The `WARBuilder` assembles the test WAR by:
1. Unpacking all WAR dependencies from `minimaldependencies` (including `xwiki-platform-web-war`)
2. Adding JARs to `WEB-INF/lib`
3. Overlaying files from `src/test/webapp/` in the test module

### Overriding WAR files

To override a template or resource in the test WAR, place the file under `src/test/webapp/` with the same relative path as in the deployed WAR:

```
src/test/webapp/templates/my_template.vm  →  webapps/xwiki/templates/my_template.vm
```

This is the clean way to test against modified templates without rebuilding the entire distribution.

### Rebuilding after template changes

When you modify a template in `xwiki-platform-web-templates`, you must also rebuild `xwiki-platform-web-war` for the change to appear in the Docker test WAR:

```bash
mvn clean install -B -ntp -pl xwiki-platform-core/xwiki-platform-web/xwiki-platform-web-templates \
    -DskipTests
mvn clean install -B -ntp -pl xwiki-platform-core/xwiki-platform-web/xwiki-platform-web-war \
    -DskipTests
```

The Docker test's `mvn clean verify` then picks up the updated `xwiki-platform-web-war` JAR from the local Maven repo.

## Test class structure

```java
@UITest(...)
class FeatureIT
{
    // Static fields shared across all tests in this class
    private static RepositoryTestUtils repositoryTestUtils;
    private static ExtensionTestUtils extensionTestUtils;

    @BeforeAll
    static void beforeAll(TestUtils setup) throws Exception
    {
        setup.loginAsSuperAdmin();
        setup.recacheSecretToken();
        setup.setDefaultCredentials(TestUtils.SUPER_ADMIN_CREDENTIALS);

        repositoryTestUtils = new RepositoryTestUtils(setup, new RepositoryUtils(), new SolrTestUtils(setup));
        repositoryTestUtils.init(); // generates test extension files
        extensionTestUtils = new ExtensionTestUtils(setup);
    }

    @BeforeEach
    void setUp(TestUtils setup) throws Exception
    {
        setup.loginAsSuperAdmin();
        // Cleanup state from previous test
        extensionTestUtils.uninstall("my-extension");
        repositoryTestUtils.deleteExtension("my-extension");
        repositoryTestUtils.waitUntilReady();

        // Verify clean state
        ExtensionsSearchResult result = setup.rest().getResource("repository/search", ...);
        assertEquals(0, result.getTotalHits());
    }

    @Test
    @Order(1)
    void testSomething(TestUtils setup) throws Exception
    {
        // ...
    }
}
```

Key differences from JUnit4:
- `TestUtils setup` is injected as a method parameter, not accessed via `getUtil()`
- `@BeforeAll` static methods also receive `TestUtils` as a parameter
- `@Order` controls test execution order (important: tests often depend on previous state)
- No base class to extend

## Translating JUnit4 → JUnit5 test patterns

### Accessing utilities

| JUnit4 | JUnit5 Docker |
|--------|---------------|
| `getUtil()` | `setup` (injected parameter) |
| `getRepositoryTestUtils()` | `repositoryTestUtils` (static field, initialized in `@BeforeAll`) |
| `getExtensionTestUtils()` | `extensionTestUtils` (static field) |

### Extension test utilities

```java
// Installing an extension programmatically (bypassing UI)
extensionTestUtils.install(new ExtensionId("my-extension", "1.0"));

// Uninstalling
extensionTestUtils.uninstall("my-extension");

// Wait for Solr index to be ready after adding test extensions
repositoryTestUtils.waitUntilReady();
```

### Adding test extensions to the XWiki repository

```java
TestExtension extension = repositoryTestUtils.getTestExtension(
    new ExtensionId("alice-xar-extension", "1.3"), "xar");
// Optionally override the auto-set name (defaults to artifact ID):
extension.setName("Alice Wiki Macro");
repositoryTestUtils.addExtension(extension);
```

`TestExtension` constructor sets name to `id.getId()` (the artifact ID string). Override with `setName()` when tests assert on the display name.

## Page objects: known differences from JUnit4

### ExtensionProgressPane.getJobLogLabel()

As of commit `891f2b563011` (XWIKI-24145), the log collapse toggle changed from `<label>` to `<button>`. The XPath in `ExtensionProgressPane.getJobLogLabel()` must use `/button`:

```java
// Correct for current codebase:
String xpath = "//*[@class = 'log']/parent::dd/preceding-sibling::dt[last()]/button";
```

### Collapse-toggle buttons must have type="button"

Any `<button class="collapse-toggle">` inside an extension `<form class="extension-item">` **must** have `type="button"`. Without it, the button defaults to `type="submit"` and clicking it submits the extension form, causing a DOM replacement and `StaleElementReferenceException` in tests that access elements after the click.

Template: `job_macros.vm`, macro `displayJobStatusLog`:
```velocity
<button type="button" class="btn btn-default btn-xs collapse-toggle...">
```

### Core extension names in minimal WAR

The minimal Docker WAR contains a different set of core extensions than a full XWiki installation. For example, it contains `org.apache.groovy:groovy` (name: "Apache Groovy") as the groovy runtime, not `xwiki-platform-groovy` or `xwiki-commons-groovy`. Adjust assertions accordingly:

```java
// Full XWiki: > 1 groovy extensions (XWiki wrappers + groovy itself)
// Minimal Docker WAR: only 1 groovy-related extension
assertTrue(searchResults.getDisplayedResultsCount() >= 1);
```

## Running the tests

```bash
# Full run including Docker functional tests
mvn clean verify -B -ntp \
    -pl xwiki-platform-core/xwiki-platform-<feature>/xwiki-platform-<feature>-test/xwiki-platform-<feature>-test-docker \
    -Pintegration-tests,docker \
    -Dxwiki.checkstyle.skip=true \
    -Dxwiki.surefire.captureconsole.skip=true \
    -Dxwiki.revapi.skip=true
```

The `docker` profile is needed to activate the test module (see parent pom.xml configuration above).

Results in: `target/failsafe-reports/TEST-*.xml`

Screenshots on failure in: `target/screenshots/` or in the test output directory named after the test configuration.

### Verify the DOOD use case (Maven build itself running inside a Docker container)

The default `mvn clean verify` runs above execute the Maven build on the **host** with XWiki on the
default Jetty Standalone engine. That does not need to be repeated separately — instead, validate
the converted test with the **DOOD (Docker-out-of-Docker)** setup, which exercises everything more
thoroughly in one run. The CI agents run the whole build *inside* the `xwiki/build` Docker image, and
that build then spawns the test's servlet-engine / database / browser containers as **siblings on the
host Docker daemon**. This is enabled by bind-mounting the host's Docker socket into the build
container (`-v /var/run/docker.sock:/var/run/docker.sock`), so the Docker client inside the container
talks to the host daemon. Running this setup (e.g. on Tomcat) surfaces issues that only appear when
the build itself is containerized (paths, socket access, container-to-container networking) as well as
those from XWiki running inside a container (the local Maven repo must be reached over `http://`
rather than `file://`).

Reference (don't duplicate): the full, up-to-date instructions and per-flag explanations live in the
[xwiki-docker-build "Local usage" doc](https://github.com/xwiki/xwiki-docker-build/tree/master/build#local-usage).
Salient points:

- The prebuilt `xwiki/build` image (on DockerHub) bundles the required build tools: Java 17, the
  latest Maven, a Docker client, Firefox, and a VNC server.
- The essential mount is the Docker socket — that is what makes DOOD work. Also bind-mount your local
  Maven repo (`-v $HOME/.m2:/root/.m2:delegated`) to avoid re-downloading dependencies, and the
  module source (e.g. ``-v `pwd`:/root/`basename \`pwd\``:delegated``) to build your local changes.
- Functional tests need a display, so start a VNC server inside the container and export `DISPLAY`
  (the doc also covers forwarding the display to a Mac/Linux host via XQuartz/X11).

Minimal interactive shell inside the build container, then run the test as usual from there:

```bash
# On the host: get a shell inside the xwiki/build container with the Docker socket mounted (DOOD).
docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock \
    -v $HOME/.m2:/root/.m2:delegated \
    -v "$(pwd)":/root/"$(basename "$(pwd)")":delegated \
    --entrypoint "/bin/bash" xwiki/build

# Inside the container: start a display, then run the Docker test (Tomcat shown for the DOOD path).
vncserver :1 -geometry 1280x960 -localhost -nolisten tcp && export DISPLAY=:1
cd /root/<module-dir>
mvn clean verify -B -ntp \
    -pl xwiki-platform-core/xwiki-platform-<feature>/xwiki-platform-<feature>-test/xwiki-platform-<feature>-test-docker \
    -Pintegration-tests,docker \
    -Dxwiki.test.ui.servletEngine=tomcat \
    -Dxwiki.checkstyle.skip=true \
    -Dxwiki.surefire.captureconsole.skip=true \
    -Dxwiki.revapi.skip=true
```

## Post-conversion checklist

1. Verify test count matches original JUnit4 suite (no tests accidentally dropped).
2. Assert the same things as the original tests — do not silently weaken assertions.
3. Run `mvn clean verify` with the `docker` profile and confirm 0 failures, 0 errors.
4. Verify the DOOD use case by running the build itself inside the `xwiki/build` container (Docker socket mounted, e.g. on Tomcat) — this matches how CI runs it and validates everything in one run. See "Verify the DOOD use case" above.
5. Check that `@Order` values cover the expected dependency chain between tests.
6. Confirm `@BeforeEach` cleanup uninstalls/deletes all state that tests create, so tests are independent.