---
name: xwiki-fix-flickering-docker-test
description: Guide for fixing a flickering Docker-based functional test for an XWiki module.
---

**Read first, before editing any test:** the rules the steps below depend on are not repeated here — `okf/testing/strategy.md` for the **page-object boundary** (the fix goes in a page object, never as a `getDriver()` call in the test class) and the don't-pay-the-timeout rule, and `okf/testing/running-docker-its.md` for the JDK-on-`PATH` and :8080 prerequisites that otherwise surface as "Failed to start XWiki in [N] seconds".

When the flicker was seen on CI (ci.xwiki.org), start with the ``develocity`` MCP rather than with Jenkins: it holds the test method's failure history across builds (how often it fails, since when) and the stack trace and output of each failed run, which is what you try to reproduce below. There is no Develocity data for `xwiki-contrib` repos, so for those go to Jenkins (`okf/servers/jenkins.md`) and fetch the failing method's archived screenshot **and video** — running the video through scene detection localises the failure to the frame, which beats reasoning from the stack trace.

## Measure the rate, before and after — `xwiki-it-repeat.mjs`

A flicker is a probability: "it passed" proves nothing, and `@RepeatedTest(value = 10, failureThreshold = 1)` proves little more, since it stops at the first failure. Measure a **pass rate before the fix and after it**, on the configuration the failure prefers.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/xwiki-it-repeat.mjs" --module <path-to-*-test-docker> \
  --test TestClass#testMethod --runs 20 --browser firefox --label before
```

(In Kimi Code the script is under `${KIMI_SKILL_DIR}/../../scripts/`, in opencode under `$XWIKI_LLM_HOME/xwiki/scripts/`.) It keeps each failing repetition's Failsafe report, screenshot and video under `run-NN/`, writes a `report.json` and a `summary.md` table to quote on the issue or the pull request, and takes one Docker IT slot for the whole session. `--baseline <before>/report.json` on the second measurement prints both rates and the delta.

- **A setup error is not a failure.** A repetition that died in `beforeAll` never ran the test, so it is listed on its own line and left out of the rate — see the symptom table in `okf/testing/running-docker-its.md`. Same for one that hit the timeout.
- **How many repetitions.** Zero failures in 20 executions bounds the failure rate below ~15%, not at zero, so ten prove almost nothing about a test that fails 1 in 12. Develocity's `dv-test-history` gives the number of clean runs this particular test needs.
- **`--mode reuse`, the default,** provisions the wiki once and re-runs the test against it, which is ten times faster per repetition; it needs the default `jetty_standalone` engine and port 8080 free. Repetitions then share one wiki, so when the suspicion is that the test depends on a fresh one, use `--mode fresh` — a full `-Pdocker,integration-tests` build per repetition, with any servlet engine.
- **It edits nothing**, so there is no `@RepeatedTest` to add and to remember to revert.

**Ask the developer before launching it on their machine:** twenty repetitions hold port 8080 and a slice of the Docker daemon for around half an hour. It needs no display — the browser is a container — but it does need a Docker daemon, that port, and the branch's JDK on `PATH`.

## Fixing one

1. Build the modified Maven projects, excluding those with ``-docker`` and ``-tests`` suffix.
2. Check if there is an XWiki instance already running on port 8080, in which case ask for confirmation to stop it. (`xwiki-it-repeat.mjs` refuses to start rather than provisioning into somebody else's wiki, which is the `401` trap.)
3. Measure the flicker as above, on Firefox and on the configuration Develocity names — the failing runs' artifacts and the rate are what you reason from.
4. Analyze the logs to understand the failure.
5. Start the XWiki test instance in the background with ``./target/hsqldb_embedded-default-default-jetty_standalone-default-firefox/jetty/start_xwiki.sh``, run **from its own directory** (its paths are relative). Reusing the provisioned instance this way is what makes a single iteration take seconds instead of minutes, so do it before iterating on a fix. Stop it with ``./stop_xwiki.sh`` there.
6. Run the test on Chrome as well, against the running XWiki test instance, to check if the failure is the same:

  ```
  mvn compiler:testCompile failsafe:integration-test -B -ntp -Dxwiki.test.ui.servletEngine=external -Dit.test=TestClass#testMethod -Dxwiki.test.ui.browser=chrome
  ```

  ``failsafe:integration-test`` does not recompile test sources, so without ``compiler:testCompile`` this silently re-runs the previously compiled test.

7. Identify the failure reason then update the test and/or the used page objects in order to fix the flickering. **The change belongs in a page object** whenever it drives the UI — per the page-object boundary above, and because a fix in the page object also fixes every other test using it.
8. Validate the fix by measuring again with `--label after --baseline <before>/report.json`, on both Firefox and Chrome. Quote the two rates wherever the fix is proposed: a fix whose "after" rate is no better than its "before" rate has not been shown to work.
9. If the fix requires changes outside the ``-docker`` and ``-pageobjects`` projects then go to step 1 (to recreate the XWiki test instance); otherwise:
  * Rebuild the modified ``-pageobjects`` projects
  * Compile the test code with ``mvn compiler:testCompile -B -ntp``
  * Run the flickering test method against the running XWiki test instance like in step 6 and iterate
10. Stop the XWiki test instance at the end.
