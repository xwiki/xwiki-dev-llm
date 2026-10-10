---
title: Diagnosing a flickering functional test — evidence, Selenium traps, forcing the race
stability: durable
summary: Reading a failed docker test's video, the Selenium, browser and setup mechanics most
  flickers turn out to be, forcing a race to confirm a hypothesis and prove a fix, and the realtime
  WYSIWYG debug dump.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting/
---

# Diagnosing a flickering functional test

The procedure (evidence, hypothesis, experiment, fix) is the `xwiki-fix-flickering-docker-test`
skill; the failure history across builds is [[develocity]]; the rules a fix must respect are
[[strategy]]. This file is what to look at, and what the cause usually turns out to be.

## Reading the video

A failed docker test archives a `.png` and an `.flv` recording of the whole test (where: [[jenkins]];
`dv-test-history` links both per failure group).

- **Detect scene changes before extracting any image.** A recording ends in a long, nearly still tail
  (the element-lookup timeout plus teardown), so "the last N seconds" shows only the frozen failure
  page. Find the last changes, then look just before them; `0.02` misses subtle page changes:

  ```bash
  ffmpeg -i fail.flv -vf "select='gt(scene,0.01)',showinfo" -f null - 2>&1 | grep -o 'pts_time:[0-9.]*' | tail -20
  ```
- One contact sheet of that window beats dumping frames:
  `ffmpeg -ss <t> -i fail.flv -t <dur> -vf "fps=10,crop=W:H:X:Y,drawtext=text='%{n}':…,tile=CxR" -frames:v 1 sheet.png`.
- **The cursor does not move**: the drivers synthesise clicks, so its position is not where Selenium
  clicked. Compare element geometry across frames instead.

## Causes that look like something else

- **A passing browser can be a harness artifact.** `WebElement.click()` sends mousedown and mouseup
  in the same millisecond; when the mousedown moves the element (a blur closing an inline editor, a
  re-flowing table), the mouseup still lands on it, while a real user holding the button ~150 ms loses
  the click. Before calling a failure browser-specific, re-run the green browser with
  `createActions().clickAndHold(el).pause(Duration.ofMillis(200)).release().perform()` and log
  `el.getRect()` around it. Switch such a variant with an environment variable: failsafe does not
  forward arbitrary `-D` properties to the forked test JVM.
- **An implicit wait does not survive a navigation.** A `findElement` issued while a click's
  navigation is in flight keeps polling the old document and fails after the full timeout with the
  element on screen; raising the timeout changes nothing. A click can also cause **several**
  navigations (a page that redirects from its own JavaScript once ready), so a page-reload wait only
  proves that *one* finished. After a navigating click, use a `waitUntil…` helper
  (`waitUntilElementIsVisible`): it issues a fresh command per poll, each bound to the current
  document.
- **A scripted form submit races the next `driver.get()`.** A button whose handler calls
  `form.submit()` returns before the POST; the next `get()` either is overridden by the POST's result
  page or cancels the action. Symptom: the screenshot shows the result page of an earlier action. Fix:
  `addPageNotYetReloadedMarker()` before the click, `waitUntilPageIsReloaded()` after it, in the page
  object.
- **A synthetic click's `pageY` differs per browser.** A JavaScript `element.click()` has
  `clientX/clientY = 0`, but Chrome reports `pageY = scrollY` where Firefox reports 0, so a
  "not pointer-initiated" guard `pageX === 0 && pageY === 0` fails on a scrolled page in Chrome only.
  The product fix is `event.detail === 0` (or the client coordinates).
- **A JSX listener can register after its widget is ready.** JSX code runs inside `require([...], cb)`
  and `xwiki-l10n!` alone costs a server round trip, while a widget bootstrapped on DOM ready (e.g.
  `.xtree`) can fire its `ready` event before `cb` runs. Nothing orders the two.
- **A background tab runs late.** Browsers throttle timers in inactive tabs: Firefox delayed each
  timer-driven step 1–3 s, 4–6 s when the tab was busy, and can suspend the tab. A multi-user test
  that switches to tab B and waits there for work tab A still has pending (an upload queued through a
  jQuery `Deferred`, a realtime push) times out though nothing is stuck, and the dump taken after the
  timeout shows A's work unfinished or just finished. It passes locally, where A finishes before it is
  hidden; it shows up when CI is slow. Signs: a browser-side log shows A's `document.visibilityState`
  `hidden` during the wait, and the gap drops to milliseconds once A is reactivated. Fix in the page
  object: `RealtimeRichTextAreaElement#repeatedWait` (short waits, switching to each tab in between)
  — every realtime wait must go through it. A separate window instead of a tab avoids the throttling
  but changes focus, so the caret can land elsewhere.
- **The wiki was already broken when the test started.** Less common, but it happens: a server-side
  race during provisioning or extension installation leaves a bad state that no error reports, and
  whichever test later needs it fails. In XWIKI-24997, an XClass saved while another document was
  loading got cached as non-existing or outdated under MySQL/MariaDB's `REPEATABLE READ`, so a sheet
  or an administration section later rendered without its fields — behind XWIKI-24720 and other
  flickers, all on MySQL/MariaDB only. Signs: the failure keeps to one database (or one servlet
  container); the screenshot shows the page fully loaded but missing content, not an
  intermediate state; and other tests in the same build and configuration failed alongside it. No
  delay in the test or page object changes such a failure: look at what the setup wrote
  concurrently, and in the XWiki server log of the run.
- **The browser changed, not the code.** The browser image tag defaults to `latest`
  (`xwiki.test.ui.browserTag`) and is force-pulled on every run, so a Selenium image release changes
  the browser on every branch within hours. A failure appearing on all branches at once in one
  browser: compare its onset with `last_pushed` of
  `https://hub.docker.com/v2/repositories/selenium/standalone-<browser>/tags/latest`, resolve the
  digest to a version through the tags sharing it, and A/B locally by pinning the previous tag with
  `-Dxwiki.test.ui.browserTag=<tag>`. Exonerate a suspect commit with the revision Jenkins really
  built ([[jenkins]]), not with the branches that exist.

## Forcing the race

A flake rate of a few percent takes days of CI to confirm, and local timing rarely matches CI's, so
make the race deterministic with a temporary patch: the unchanged code then fails every time with the
CI symptom (the control, confirming the hypothesis), the fix passes, and the patch is reverted.

- **Several races hide behind one flicker**, and the local distribution often differs from CI's:
  group failing repetitions by the line of the deepest test frame before fixing "the" cause.
- A race that needs CI's latency often never reproduces locally: insert a temporary `Thread.sleep`
  where CI is slower rather than hunting for it.
- Background tab: delay the server step the hidden tab waits for, and keep that tab busy with
  `setInterval(() => { const end = Date.now() + 40; while (Date.now() < end) {} }, 100)` through
  `executeScript`, which stretches the throttling.
- Scripted submit: just before the click, defer it —
  `form.submit = function() { setTimeout(() => HTMLFormElement.prototype.submit.call(form), 100); };`
  through `executeScript` (jQuery's `.submit()` calls the element's own `submit`).
- JSX vs. widget: wrap the JSX tail from the widget lookup onwards in a function and run it only after
  the widget is ready (`$t.one('ready.jstree', () => setTimeout(tail, 0))`). Defer only that section
  — an `async` callback that awaits at the top also delays the earlier handlers, and the test then
  fails on an unrelated interaction.

## Realtime WYSIWYG: `REALTIME_DEBUG`

On every failure of a realtime WYSIWYG IT, `RealtimeTestDebugger` logs each browser window's console
and `JSON.stringify(window.REALTIME_DEBUG)` — the full sync timeline (`Push local content:`,
`Received remote content:`, saved/restored selections, `Failed to rebase:`). It is in the Jenkins
**console log**, not an artifact: stream `consoleText` through `grep -a RealtimeTestDebugger`, never
into context ([[jenkins]]), and bound the match by the `(*) Starting test [<name>]` /
`(*) Stopping test [<name>]` lines, since one log holds several configurations. Its entries carry no
timestamps (the console logs do: cross-reference them), and the browser log buffer is per WebDriver
session, so the first window printed drains it.

**The browser console is Chrome-only.** The debugger reads it through Selenium's legacy logging API
(`driver.manage().logs().get(LogType.BROWSER)`), which geckodriver does not implement: a Firefox run
logs `Failed to get browser console logs` instead and keeps only the `REALTIME_DEBUG` dump. The
docker test framework enables that log on Chrome for every test (`Browser.java`), but nothing else
reads it, so CI records no console for any other test; a temporary patch can read it in a local
Chrome run.

- **A browser-side timeline in any browser:** push entries (with `Date.now()`, not
  `performance.now()`, which counts from each tab's own start) into a `window` array from a
  temporary patch and read it back through `executeScript`: wall-clock times merge with the other
  tabs, the server log and the test log into one timeline.
- **The console log contains stray `\r`:** line numbers from `grep -n` do not match a reader that
  splits on `\r`.
