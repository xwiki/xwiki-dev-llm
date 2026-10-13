---
name: xwiki-legacy
description: Move a deprecated public XWiki API out of a main module into its backward-compatibility
  `-legacy` module, so the main artifact drops the dead API while the legacy artifact re-adds it for
  existing extensions. Use when asked to remove/retire a deprecated class, interface, method or field,
  to "move an API to legacy", to clean up a module's deprecated surface, or whenever you deprecate an
  API and want the old one gone from the main jar. Covers removing the API, re-adding it via a plain
  legacy class or an AspectJ aspect, the Revapi setup, the coverage/pom fallout, and banning the main
  artifact in the WAR legacy dependencies. To find and migrate the callers first, or to pick which
  deprecation to retire, use xwiki-fix-deprecation. For the build/verify commands use xwiki-build; for the
  `@since`/`@Deprecated(since)` version string use xwiki-knowledge; for the PR use xwiki-pull-request.
---

# Moving a deprecated API to a `-legacy` module

XWiki keeps binary/semantic backward compatibility (enforced by Revapi — see the
`backward-compatibility` OKF topic). A deprecated **public** API therefore cannot simply be deleted:
it is **removed from the main module** and **re-added by that module's `-legacy` companion**, which
weaves the main artifact with AspectJ and re-exports it under the same
`xwiki.extension.features`. Existing extensions that still call the old API keep working by depending
on the legacy jar; the main jar is clean.

Do this only for a **public** API that nothing calls any more (step 1). Purely `internal` classes are
not API — just delete them, no legacy needed.

## 1. No caller left first

Confirm the API is deprecated with a documented replacement (`@deprecated … use {@link …}`), and that
**no caller is left** in xwiki-commons, xwiki-rendering or xwiki-platform (released together), in any
language: finding and migrating them is the `xwiki-fix-deprecation` skill.

## 2. Remove the API from the main module

Delete the declaration (and, for an interface method, its implementations). Keep the replacement.
Fix any `@see`/`{@link}` references that pointed at the removed member.

## 3. Re-add it in the `-legacy` module

Pick the pattern by API shape. Study the sibling that already does it (`xwiki-commons-legacy-job`
for whole types, `xwiki-commons-legacy-velocity` / `xwiki-commons-legacy-component` for aspects).

- **Whole type** (class / interface / enum): move the `.java` file verbatim into the legacy module
  under the same package (see `xwiki-commons-legacy-job` → `JobManager`). Nothing else needed beyond
  the module being a weaver (step 4) — a re-added top-level type does not even require an aspect.

- **Instance method / field on a concrete class**: add an AspectJ **inter-type declaration** in a
  `src/main/aspect/…/<Class>CompatibilityAspect.aj`, delegating to the replacement, e.g.

  ```java
  public privileged aspect JSONToolCompatibilityAspect
  {
      @Deprecated
      public Object JSONTool.parse(String json)
      {
          return fromString(json);
      }
  }
  ```

- **Interface method**: an ITD cannot add an abstract method to an interface's implementors, so use a
  companion interface carrying the method as a **default** method, plus a `declare parents` aspect
  that makes the woven interface extend it:

  ```java
  // CompatiblePropertyDescriptor.java  (plain source in the legacy module)
  public interface CompatiblePropertyDescriptor
  {
      @Deprecated
      default Field getFied()
      {
          return ((PropertyDescriptor) this).getField();   // delegate to the replacement
      }
  }

  // PropertyDescriptorCompatibilityAspect.aj
  public aspect PropertyDescriptorCompatibilityAspect
  {
      declare parents : PropertyDescriptor implements CompatiblePropertyDescriptor;
  }
  ```

  After weaving, `PropertyDescriptor extends CompatiblePropertyDescriptor`, so every implementation
  inherits the default `getFied()` — no per-class ITD required. (The older `-legacy-component` code
  predates default methods and instead pairs an abstract `Compatibility*` interface with a per-class
  ITD aspect; prefer the default-method form in new code.)

Three traps the legacy module's build rejects:

- A **compile-time constant** (`static final` primitive/`String`) cannot be an ITD field: AspectJ emits
  it non-`final`, set from `<clinit>` (`java.field.noLongerConstant`). Declare it in a
  `Compatibility<Class>Constants` interface in the legacy module and add
  `declare parents : <Class> implements Compatibility<Class>Constants;` — interface fields are real
  constants, and `<Class>.NAME` still resolves.
- Any public member on a **`Serializable` class without an explicit `serialVersionUID`** fails AspectJ
  (`Xlint:needsSerialVersionUIDField`, an error in XWiki builds). Add
  `private static final long serialVersionUID = 1L;` to the *main* class, as elsewhere in the codebase.
- An ITD on a **subclass** placed in its own aspect can fail with "must implement abstract inter-type
  declaration" when the subclass inherits an ITD implementation from another aspect: `ajc` gets the
  sources in file-system listing order, so it may check the subclass first. Green on CI, red on some
  machines. Put the subclass ITDs in the aspect of the class that carries the inherited ITDs (see
  `ListClassCompatibiityAspect` in `xwiki-platform-legacy-oldcore`).

Give new legacy types/aspects `@since <next-version>RC1` (see xwiki-knowledge for the version
string) and keep the original `@deprecated since …` line.

## 4. Make the legacy module a weaver (if it wasn't already)

A legacy module that only **added** classes (no `<weaveDependency>`) becomes a **replacement** of the
main artifact the moment it must modify an existing type. Mirror `xwiki-commons-legacy-velocity`'s
`pom.xml`:

- Properties: `xwiki.extension.features = <groupId>:<main-artifactId>` and an `xwiki.extension.name`.
- In the **main** module's pom, `<xwiki.revapi.skip>true</xwiki.revapi.skip>` with the comment
  `Skipping revapi since <legacy-artifactId> wraps this module and runs checks on it` — Revapi moves to
  the legacy module, which checks the woven jar (see `xwiki-platform-refactoring-api`).
- Dependencies: the main module as `<type>pom</type>` (trigger, no jar) **and** again as
  `<scope>provided</scope>` (build order + weaving source); add `org.aspectj:aspectjrt`.
- `aspectj-maven-plugin` with a `<weaveDependency>` naming the main artifact.
- `maven-jar-plugin` excluding `**/builddef.lst`.
- `maven-surefire-plugin` `classpathDependencyExcludes` for the main jar (and
  `xwiki-commons-component-api` jar) so tests run against the woven jar only.
- If the main module ships a `META-INF/components.txt`, a `maven-antrun-plugin` step (phase
  `process-classes`) that **concats the legacy module's own `components.txt` onto the woven one**
  (`append="true"`). The woven jar must end up with *all* component lines (main + legacy). Verify:
  `wc -l target/classes/META-INF/components.txt` and check for no duplicates.
- If the module runs Spoon, set the `ComponentAnnotationProcessor` `skipForeignDeclarations=true`
  (the merged `components.txt` references classes that come from the woven dependency).

## 5. No Revapi ignore

A move to legacy adds **no** `<revapi.differences>` entry: the main module skips Revapi (step 4) and the
legacy module's Revapi compares the woven jar with its previous release. A Revapi error on the legacy
module means the re-add is not faithful — fix the re-add. The one exception, a downstream consumer
failing (step 8), is in the `backward-compatibility` OKF topic.

## 6. Fix the legacy module's coverage ratio

Once the legacy module weaves the whole main artifact, its jar now bundles the (untested-here) main
classes, so its JaCoCo instruction ratio drops sharply. Lower `xwiki.jacoco.instructionRatio` to the
new achieved value with a comment explaining the module re-exports the main artifact (as
`xwiki-commons-legacy-velocity` does). Use the `xwiki-increase-test-coverage` skill to compute it.

## 7. Ban the main artifact in the WAR (only when the module *became* a weaver in step 4)

A weaving legacy module's jar is a full *replacement* of the main jar, so packaging **both** in the
WAR under the `legacy` profile is a conflict (duplicate, woven-vs-clean classes). If step 4 turned a
previously non-weaving legacy module into a weaver — i.e. the main artifact was **not** banned before
— you must update
`xwiki-platform-distribution/xwiki-platform-distribution-war-legacydependencies/pom.xml` in the
**xwiki-platform** repo (released together with commons/rendering):

- **Ban** the main artifact in the `maven-enforcer-plugin` `bannedDependencies` rule:
  `<exclude>org.xwiki.commons:xwiki-commons-<name>:*:jar:*</exclude>` — this fails the build if the
  clean jar ever comes back, and
- **Exclude** the main artifact from the `xwiki-platform-distribution-war-dependencies` dependency
  (and from any other legacy dependency that pulls it in transitively — the enforcer tells you where).

Model it on the existing `xwiki-commons-velocity` / `xwiki-commons-component-*` entries, which are
wrapped commons modules handled exactly this way. (A legacy module that was *already* a weaver — and
thus already banned — needs nothing here.)

## 8. Build and verify

Build the main module **and** the legacy weaver with all checks — this is exactly the case the
`xwiki-build` skill covers ("also rebuild any legacy module that weaves the changed module"):

```bash
mvn clean install -B -ntp -Pquality,legacy \
  -pl <main-module-path>,<legacy-module-path>
```

`-Pquality` is mandatory: it runs Revapi **and** the JaCoCo check (confirms the lowered ratio). Then
sanity-check the outcome with `javap` on the woven legacy classes: the main jar must no longer expose
the API, and the legacy jar must re-add it.

A module depending on the **clean** main jar whose own API reaches the changed class still sees the
member as removed. When the moved API sits on such a class, check one of those consumers:

```bash
cd <a module depending on the main artifact> && mvn compile revapi:check -B -ntp -Pquality
```

Only if it fails, show the developer the reported break and get their explicit approval, then add the
`allowed` ignore the OKF topic describes and re-run it to prove the `<old>` signature matches.

Open the PR with the `xwiki-pull-request` conventions (`[Misc]` prefix when there is no JIRA issue).
