---
name: xwiki-fix-flickering-docker-test
description: Guide for fixing a flickering Docker-based functional test for an XWiki module.
---

**Read first, before editing any test:** the rules the steps below depend on are not repeated here — `okf/testing/strategy.md` for the **page-object boundary** (the fix goes in a page object, never as a `getDriver()` call in the test class) and the don't-pay-the-timeout rule, and `okf/testing/running-docker-its.md` for the JDK-on-`PATH` and :8080 prerequisites that otherwise surface as "Failed to start XWiki in [N] seconds".

When the flicker was seen on CI (ci.xwiki.org), start with the ``develocity`` MCP rather than with Jenkins: it holds the test method's failure history across builds (how often it fails, since when) and the stack trace and output of each failed run, which is what you try to reproduce below. There is no Develocity data for `xwiki-contrib` repos, so for those go to Jenkins (`okf/servers/jenkins.md`) and fetch the failing method's archived screenshot **and video** — running the video through scene detection localises the failure to the frame, which beats reasoning from the stack trace.

## Measure the rate, before and after — `xwiki-it-repeat.mjs`

A flicker is a probability, so "it passed" proves nothing and `@RepeatedTest(value = 10, failureThreshold = 1)` proves little more: it stops at the first failure, which is a boolean. The evidence that a fix worked is a **pass rate before and a pass rate after**, on the configuration the failure actually prefers.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/xwiki-it-repeat.mjs" --module <path-to-*-test-docker> \
  --test TestClass#testMethod --runs 20 --browser chrome --label before
```

(In Kimi Code the script is under `${KIMI_SKILL_DIR}/../../scripts/`, in opencode under `$XWIKI_LLM_HOME/xwiki/scripts/`.)

It runs the test N times on one configuration, counts **executions** rather than Maven runs, keeps each failing run's Failsafe report, screenshot and video under `run-NN/`, and writes `report.json` plus a `summary.md` table ready to paste into a pull request. `--baseline <before>/report.json` on the second measurement prints both rates and the delta. It takes one Docker IT slot for the whole session, so it queues behind other agents instead of starving the daemon.

Three things it does that a hand-run loop does not:

- **A run that died in `beforeAll` is excluded from the rate**, not counted as a failure — a starved daemon is a fact about the machine (`okf/testing/running-docker-its.md`), and averaging it in is how an oracle starts lying. Setup errors and timeouts are reported separately.
- **It edits nothing.** No `@RepeatedTest` to add and no source change to remember to revert before the pull request.
- **It states what a clean series does not prove.** Zero failures in 20 executions bounds the failure rate below ~15%, not at zero, so a flicker that failed 1 run in 12 needs far more runs than the 10 that feel convincing. Develocity (`dv-test-history`) gives the number of clean runs this particular test needs.

**`--mode reuse` (the default) provisions the wiki once and re-runs the test against it** with `xwiki.test.ui.servletEngine=external`, which is ten times faster per repetition. `ServletEngine.EXTERNAL` is hardcoded to `localhost:8080`, so it only works with the default `jetty_standalone` engine and needs that port free; the database is whatever the provisioning run started, and its container stays alive for the session. Repetitions share one wiki, so state accumulates across them — when the suspicion is that the test depends on a fresh wiki, use `--mode fresh`, which pays a full `-Pdocker,integration-tests` build per repetition and works with any servlet engine.

**Ask the developer before launching it on their own machine.** Twenty repetitions is tens of minutes during which port 8080 and a slice of the Docker daemon are taken. In a routine, launch it without asking — but only after the priorities below.

**It needs no display.** The browser is a container in every configuration, so a headless routine runs it exactly like CI does; what it does need is a Docker daemon, the branch's JDK on `PATH` (`jetty_standalone` spawns the wiki's JVM with `java` from `PATH`, not from `JAVA_HOME`) and port 8080 free.

**Flickers are not what blocks a release.** A compile break, a broken pom, a failing quality gate — those stop the build and stop the release; a flicker costs a re-run. So in a routine that has a budget for one fix, the flicker is the last candidate, after the things that make the build red for everyone.

## Fixing one

1. Build the modified Maven projects, excluding those with ``-docker`` and ``-tests`` suffix.
2. Check if there is an XWiki instance already running on port 8080, in which case ask for confirmation to stop it. (`xwiki-it-repeat.mjs` refuses to start rather than provisioning into somebody else's wiki, which is the `401` trap.)
3. Measure the flicker as above, on Firefox and on the configuration Develocity names — the failing runs' artifacts and the rate are what you reason from.
4. Analyze the logs to understand the failure.
5. Start the XWiki test instance in the background with ``./target/hsqldb_embedded-default-default-jetty_standalone-default-firefox/jetty/start_xwiki.sh``, run **from its own directory** (its paths are relative). Reusing the provisioned instance this way is what makes a single iteration take seconds instead of minutes, so do it while iterating on a fix — measuring is the oracle's job, iterating is this one's. Stop it with ``./stop_xwiki.sh`` there.
6. Run the test on Chrome as well, against the running XWiki test instance, to check if the failure is the same:

  ```
  mvn compiler:testCompile failsafe:integration-test -B -ntp -Dxwiki.test.ui.servletEngine=external -Dit.test=TestClass#testMethod -Dxwiki.test.ui.browser=chrome
  ```

  ``failsafe:integration-test`` does not recompile test sources, so without ``compiler:testCompile`` this silently re-runs the previously compiled test.

7. Identify the failure reason then update the test and/or the used page objects in order to fix the flickering. **The change belongs in a page object** whenever it drives the UI — per the page-object boundary above, and because a fix in the page object also fixes every other test using it.
8. Validate the fix by measuring again with `--label after --baseline <before>/report.json`, on both Firefox and Chrome. Quote the two rates wherever the fix is proposed; a fix whose "after" rate is not visibly better than its "before" rate has not been shown to work.
9. If the fix requires changes outside the ``-docker`` and ``-pageobjects`` projects then go to step 1 (to recreate the XWiki test instance); otherwise:
  * Rebuild the modified ``-pageobjects`` projects
  * Compile the test code with ``mvn compiler:testCompile -B -ntp``
  * Run the flickering test method against the running XWiki test instance like in step 6 and iterate
10. Stop the XWiki test instance at the end.
