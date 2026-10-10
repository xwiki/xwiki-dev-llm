---
name: xwiki-fix-flickering-docker-test
description: Investigate and fix a flickering (intermittently failing) Docker functional test (`@UITest`) in an XWiki repo — evidence from CI first, then a hypothesis from the test and production code, confirmed by a targeted experiment before any fix is written. Use when asked to investigate, fix or stabilise a flaky or flickering IT. To find or triage what is failing on CI use xwiki-release-test-triage; for test-writing rules use xwiki-test-guidelines.
---

**Read first, before editing any test:** the rules the steps below depend on are not repeated here — `okf/testing/strategy.md` for the **page-object boundary** (the fix goes in a page object, never as a `getDriver()` call in the test class) and the don't-pay-the-timeout rule, and `okf/testing/running-docker-its.md` for the JDK-on-`PATH` and :8080 prerequisites that otherwise surface as "Failed to start XWiki in [N] seconds". `okf/testing/flickers.md` has how to read the failure's video, the Selenium and browser mechanics most flickers turn out to be, and how to force a race.

A flicker is investigated like any other bug: **evidence → hypothesis → experiment → fix**, looping back to the hypothesis whenever an experiment disagrees with it. Re-running the unchanged test until it fails locally rarely works — local timing seldom matches CI's — so the experiment *forces* the interleaving the hypothesis names instead of waiting for it. A flicker is understood when an experiment turns the test **red with the CI symptom** on demand — forced, or unforced when the flicker happens to reproduce reliably locally — and fixed when the same experiment turns **green** with the fix.

Keep the evidence, each hypothesis and each experiment's outcome in a notes file in the work directory: a hypothesis that failed is evidence for the next one, and the investigation often spans sessions.

## 1. Evidence

Gather it all before running anything locally. Done when you can state, for each distinct failure: the symptom (exception, failing step), the rate, the configurations it hits **and the ones it spares**, since when it fails, and what the browser showed at that moment.

- **History.** When the flicker was seen on CI, start with Develocity rather than Jenkins — `dv-test-history` when installed, the `develocity` MCP otherwise (`okf/servers/develocity.md`). There is no Develocity data for `xwiki-contrib` repos: go to Jenkins (`okf/servers/jenkins.md`).
- **Failure groups.** Each group is a separate symptom until shown otherwise. Map every stack line number to the source of the branch that failing build ran (`git show origin/<branch>:<file>`) — line numbers differ between branches, so groups that look different are often one step, and one line can be two steps.
- **Configurations.** The asymmetry is the strongest clue: a failure on Chrome only, on one database, or on one servlet container says which mechanism differs. Note the sample size of the spared configuration — "never on Firefox in 600 runs" is evidence, "never on Oracle in 4" is not.
- **Onset.** A change point names a window: the commits in it on the test, its page objects and the production code it drives — and a browser image release (`okf/testing/flickers.md`).
- **Screenshot, then video.** What page was on screen versus what the test expected is usually the single most informative fact. Detect the video's scene changes before extracting any frame (`okf/testing/flickers.md`).
- **Logs.** The test output and the XWiki server log of the failing run, and for realtime WYSIWYG tests the `REALTIME_DEBUG` dump (`okf/testing/flickers.md`).

## 2. Hypothesis

Read the failing step's test code, every page-object method it calls, and the production code those drive — the JavaScript handlers, the templates, the Java — following the step until you know what went wrong — usually two things racing within the test, sometimes a state the wiki was already in when the test started. Then write the hypothesis down as a mechanism: *A happens before B because C*, plus its **prediction** — what delaying or reordering which operation will produce.

Done when the hypothesis explains **every** piece of evidence: the symptom and the failing line, the configurations it hits and spares, the rough rate, the screenshot. Evidence it does not explain stays in the notes as open — it is usually a second cause or a wrong hypothesis, and several failure groups can need several hypotheses.

- Check the causes catalogued in `okf/testing/flickers.md`; most flickers are one of them.
- Look for a sibling method that already handles the same situation: a page object where `showMinorEdits()` waits for the reload and `deleteRangeVersions()` does not has its answer in the next method.
- Before settling on a race inside the test, rule out a wiki already broken by a server-side race during setup (`okf/testing/flickers.md` has the signs); the experiment then targets the setup and the server rather than the test's own steps.
- A flicker can be a real product bug that users hit too — a race in production code, not in the test. Say so when it is: step 4 has what that changes.

Present the evidence, the hypothesis and the planned experiment to the developer before launching Docker runs: each costs minutes and holds port 8080.

## 3. Experiment

Make the hypothesised interleaving happen on demand, then run the test with **the code unchanged**: this is the control.

- **Delays** where CI is slower: a temporary `Thread.sleep` in the test or page object, a deferred browser action through `executeScript` (`okf/testing/flickers.md` has the recipes), or a sleep or `setTimeout` in the production code itself.
- **Logging** with timestamps in the page object and the production code — the server log, and on the browser side a `window` array read back through `executeScript`, since the console is readable only on Chrome (`okf/testing/flickers.md`) — to observe the actual order of the two operations, when the order rather than the outcome is in doubt.
- **An isolated test**: a unit test of the component that reproduces the race without a browser is faster to iterate on and may become the regression test.
- **The environment**: a pinned browser tag (`-Dxwiki.test.ui.browserTag=<tag>`), another browser, another database.

**A reliable local reproduction is an experiment too.** When the unchanged test already fails with the CI symptom in a large share of local runs — 10 of 15, say — those runs are the control, and nothing needs forcing. Count the failures by symptom (by the deepest test frame, `okf/testing/flickers.md`): the CI one must be among them, and the others are further races of the same flicker that the fix has to account for. The failing runs' own screenshots, videos and logs feed the hypothesis, which still decides where the fix goes.

Mark every temporary change `// TEMP` and save it as a patch, so it can be reverted and re-applied for the fix's run. A forced race fails nearly every time, so a few repetitions are enough — a temporary `@RepeatedTest(N)`, with the test first deleting what it creates (pages, users) so a repetition starts clean.

Read the outcome against the prediction:

- **Red with the CI symptom** — same exception, same step, same screen: the hypothesis is confirmed. Go to 4.
- **Red with another symptom** — the experiment may have produced the other outcome of the same race, which confirms the mechanism when the hypothesis predicts it; otherwise the experiment broke something else. Decide which, in the notes.
- **Red only in isolation** — a unit test or a stripped-down reproduction goes red as predicted, but no experiment on the full test does. That is **weaker evidence**: it shows the mechanism exists, not that it is what fails on CI. It still beats having none, so it can carry a fix — go to 4, and name the evidence for what it is wherever the fix is proposed.
- **Green** — the hypothesis is wrong, or the experiment missed the window. Record what it rules out and return to 2 with that evidence.

**When the proof runs out, ask.** A hypothesis you consider likely but cannot confirm — the experiments stayed green, or none can reach the window — goes to the developer rather than being dropped or fixed silently: the evidence, the hypothesis and why it is likely, each experiment and its outcome, and the options you see — a fix on the evidence there is, a different experiment, diagnostic logging and unforced repetitions (see the rate section below), or stopping with a comment on the flicker issue. Then follow their choice.

## 4. Fix and verify

Fix the cause the experiment confirmed — in a page object when the test drives the UI faster than the page allows (per the page-object boundary, which also fixes every other test using it), in production code when the race is a product bug. Then:

1. **The experiment with the fix** is green — the full test's, or the isolated one's when that is all that went red. A forced experiment takes the same repetitions that were red in 3. An unforced reproduction takes enough that its local failure rate *p* would almost surely have shown: at least 5/*p* runs (8 for 10 of 15, 15 for 1 in 3), all green — zero failures in *n* runs only bounds the rate below ~3/*n*, not at zero.
   - Still red with the CI symptom: the fix does not address the confirmed cause — back to 2.
   - With the fix in place, red with **another** symptom, such as a timeout: treat it as a second cause, not as noise from the forcing. Measure it — the wait against its timeout, a timeline of both sides — before blaming the forcing.
2. **Revert every `// TEMP` change** and run the test unforced on Firefox and Chrome: it still passes. The diff now contains only the fix.
3. **A production-code fix is a bug fix with its own JIRA issue**, separate from the flicker's, and its commit goes under that issue's key. Describe the bug as a user would meet it — the action, the condition that makes the race likely (a slow network or server, a quick second click), what they then see — and the versions it affects; that description is what the issue needs. Filing it is the developer's call: offer it (`xwiki-jira`) rather than filing it on your own.
4. **Report** the runs as a table — control red, fixed green, unforced green, with the configuration and repetition count of each, and whether the red was the full test or an isolated reproduction — and plainly that the local runs do not reproduce CI's timing, so CI is the final confirmation; `dv-test-history` gives the number of clean runs needed to call it fixed.

## Running the test locally

1. Build the modified Maven projects, excluding those with ``-docker`` and ``-tests`` suffix.
2. Check if there is an XWiki instance already running on port 8080, in which case ask for confirmation to stop it.
3. Run the test once through the normal Docker build to provision the instance, then start it in the background with ``./target/hsqldb_embedded-default-default-jetty_standalone-default-firefox/jetty/start_xwiki.sh``, run **from its own directory** (its paths are relative). Reusing the provisioned instance makes an iteration take seconds instead of minutes. Stop it with ``./stop_xwiki.sh`` there, at the end.
4. Run the test against it, on the browser the failure prefers:

  ```
  mvn compiler:testCompile failsafe:integration-test -B -ntp -Dxwiki.test.ui.servletEngine=external -Dit.test=TestClass#testMethod -Dxwiki.test.ui.browser=chrome
  ```

  ``failsafe:integration-test`` does not recompile test sources, so without ``compiler:testCompile`` this silently re-runs the previously compiled test.
5. After a change outside the ``-docker`` and ``-pageobjects`` projects, go back to 1 to recreate the instance; after a page-object change, rebuild the ``-pageobjects`` project and repeat 4.

## Measuring a rate — `xwiki-it-repeat.mjs`

Running the unchanged test many times is a way to gather evidence, not to prove a fix: it only pays off when the flicker fails locally without forcing, and most do not. Whether to try it is a judgement call:

- **The CI rate.** A test failing 1 in 10 on CI has a fair chance of failing in 20 local repetitions; one failing 1 in 100 almost none.
- **No hypothesis yet.** When the CI evidence does not point at a mechanism, a local failure brings its own screenshot, video and logs.
- **More evidence needed.** When forming a hypothesis needs data CI does not record, add the logging and repeat until a run fails with it.

A local rate high enough to be a reliable reproduction is proof like a forced experiment (step 3); a low one is supporting evidence, quoted with its execution counts.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/xwiki-it-repeat.mjs" --module <path-to-*-test-docker> \
  --test TestClass#testMethod --runs 20 --browser firefox --label before
```

(In Kimi Code the script is under `${KIMI_SKILL_DIR}/../../scripts/`, in opencode under `$XWIKI_LLM_HOME/xwiki/scripts/`.) It keeps each failing repetition's Failsafe report, screenshot and video under `run-NN/`, writes a `report.json` and a `summary.md` table to quote on the issue or the pull request, and takes one Docker IT slot for the whole session. `--baseline <before>/report.json` on the second measurement prints both rates and the delta. It refuses to start when something already holds port 8080, rather than provisioning into somebody else's wiki (the `401` trap).

- **A setup error is not a failure.** A repetition that died in `beforeAll` never ran the test, so it is listed on its own line and left out of the rate — see the symptom table in `okf/testing/running-docker-its.md`. Same for one that hit the timeout.
- **How many repetitions.** The rule is step 4.1's: 20 clean executions bound the rate below ~15%, so ten prove almost nothing about a test that fails 1 in 12. `dv-test-history` gives the number of clean CI runs this particular test needs.
- **`--mode reuse`, the default,** provisions the wiki once and re-runs the test against it, which is ten times faster per repetition; it needs the default `jetty_standalone` engine and port 8080 free. Repetitions then share one wiki, so when the suspicion is that the test depends on a fresh one, use `--mode fresh` — a full `-Pdocker,integration-tests` build per repetition, with any servlet engine.

Ask before launching it, as for any Docker run (step 2): twenty repetitions take around half an hour.
