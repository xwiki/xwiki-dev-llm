---
name: xwiki-capture-ui-change
description: Capture the "before" screenshot of an XWiki UI change - the one the branch can no longer produce - by building and deploying the pre-fix code on a local instance, then screenshotting the same fixture in both states. EXPENSIVE (a module build and two instance restarts) and NARROW: use it only for a fix to EXISTING UI whose visual difference is too subtle to see without the two states side by side (a corner radius, a spacing or alignment shift, a colour, a wrong icon). Do NOT use it for a new feature, a redesign, or any change a reader can see in a single screenshot - those need no "before" and are shown with an ordinary screenshot. Requires explicit user approval before running. For deploying an extension without a comparison use xwiki-deploy-extension; for Maven commands use xwiki-build; for the PR/JIRA screenshot conventions use xwiki-pull-request.
---

# Capture an XWiki UI change

## What this is for, and when not to use it

The deliverable is **the "before" screenshot** — the state your branch can no longer produce,
because the fix is already in the working tree. Everything else here exists to reach that state
safely. The "after" is trivial; you can shoot it at any time.

That is worth a module build and two instance restarts only when **the difference is too subtle to
see without both states in front of you**: a corner radius, a 2px alignment shift, a colour, a
wrong icon, a spacing regression. That is the CSS/usability work this pays off on.

Do **not** run it for:

- **a new feature** — there is no "before" to capture, and a red "before" panel next to a green
  "after" reads as a regression that never happened;
- **a redesign or a substantial improvement** — a single "after" screenshot already shows the
  reader what changed;
- **anything visible at a glance** — if one screenshot communicates it, one screenshot is the
  right answer.

In all three cases take an ordinary screenshot of the result and follow `xwiki-pull-request`'s
"Screenshots & Video" rule. Do not reach for this skill.

**Ask the user before starting.** This costs a Maven build (minutes to tens of minutes), two
instance restarts, and a bespoke capture script. Say what it will cost and get an explicit yes.
The two file-copy paths below are the exception — seconds, no build — but still confirm.

## Never write to git in the repo under comparison

This skill only ever *reads* git state. It must never run `git commit`, `git add`, `git push`,
`git checkout <branch>` or `--amend` against the repo the user is working in. The setup scripts
cover both cases without committing: pass `HEAD` to build the working tree exactly as it sits,
uncommitted changes and all, or a commit-ish to build it in their own throwaway sparse worktree
(auto-cleaned). If the fix is not committed yet, that is **not** a reason to commit it — use `HEAD`
for the "after". An agent following an earlier draft of this procedure amended the user's own
commit trying to "make the before/after refs work".

## 0. Environment, and an instance to reuse

```bash
# This skill's directory. Kimi Code: ${KIMI_SKILL_DIR}. opencode:
# $XWIKI_LLM_HOME/xwiki/skills/xwiki-capture-ui-change.
export XWIKI_CAPTURE_SKILL="${CLAUDE_PLUGIN_ROOT}/skills/xwiki-capture-ui-change"
# Test distributions, kept outside any checkout so instance logs and swapped jars never show up as
# untracked files. Every script and snippet reads the URL vars, so set them even at their defaults.
XWIKI_TEST_DEFAULT="${XDG_DATA_HOME:-$HOME/.local/share}/xwiki-test-instances"
export XWIKI_TEST_INSTANCES_DIR="${XWIKI_TEST_INSTANCES_DIR:-$XWIKI_TEST_DEFAULT}"
export XWIKI_BASE_URL="${XWIKI_BASE_URL:-http://localhost:8080/xwiki}"
export XWIKI_ADMIN_USER="${XWIKI_ADMIN_USER:-Admin}"
export XWIKI_ADMIN_PASS="${XWIKI_ADMIN_PASS:-admin}"
```

Prerequisites: a prebuilt XWiki jetty+hsqldb distribution (building one takes 30-60+ minutes, so
copy an existing one), and Playwright with Chromium. Check before starting, not three steps in:

```bash
pgrep -af 'STOP.KEY=xwiki'; lsof -nP -iTCP:8080 -sTCP:LISTEN   # something already running?
ls "$XWIKI_TEST_INSTANCES_DIR"                                  # something to copy?
ls ~/.cache/ms-playwright   # else npm i playwright && npx playwright install chromium
```

`setup-instance.sh` stops and restarts the instance it deploys into, so check *whose* instance is
on the port first. **Never stop an XWiki instance this session did not start** — the rule
`xwiki-build` states for Docker ITs applies here unchanged. If nothing is listening, start one and
wait for it (~40s); a capture against a half-started Jetty fails in confusing ways:

```bash
(cd "$INSTANCE_DIR" && ./start_xwiki.sh > "$INSTANCE_DIR/xwiki-start.log" 2>&1 &)
UP=""
for i in $(seq 1 60); do
  curl -sf -o /dev/null "$XWIKI_BASE_URL/bin/view/Main/WebHome" && { UP=1; break; }
  sleep 2
done
[ -n "$UP" ] && echo up || echo "not up after 2min, check $INSTANCE_DIR/xwiki-start.log"
```

Every path here needs a running instance, including the file-copy ones. An instance you started is
yours to stop; one you found is not.

## 1. Pick the deploy path from the module's packaging

```bash
grep -m1 '<packaging>' path/to/module/pom.xml
```

| Packaging | Path | Build? Restart? |
| --- | --- | --- |
| `jar`, `webjar`, or absent | `setup-instance.sh` — builds at a ref, swaps the jar in `WEB-INF/lib` | yes, both |
| `xar` | follow **`xwiki-deploy-extension`** (REST job API); its uninstall-then-reinstall step is what the second state hits | build only |
| static CSS/JS under `webapps/xwiki/resources/` | `sync-static-resource.sh` | neither |
| `pom` resources-only (skin `.vm`/`.less`) | `sync-static-resource.sh --target-root skins` | neither |

A webjar's assets are **minified at build time**, so despite being "just JS and CSS" it needs Maven
and cannot take the file-copy shortcut. For the two file-copy paths the copied file is read off disk
on the next page load — a before/after costs seconds, so never reach for a module build when the
change is only in files like those. When unsure of the root, locate the file:
`find "$INSTANCE_DIR"/webapps/xwiki -name previewactions.vm`.

**Version matching** only matters for the jar and xar paths: a jar built against a different
`${project.version}` can break at runtime, and the Extension Manager refuses outright. A `.vm` or a
stylesheet is served as-is, so an 18.7.0 instance happily renders a template from an 18.8.0 branch.
Do not spend 30-60 minutes copying a version-matched distribution for a file copy. If the xar route
hits `InstallException: Dependency [...] is not compatible with core extension feature [...]`, fall
back to `setup-xar-instance.sh`, which pushes the XAR through the Import page instead.

One change can span several rows (a xar module *and* a war module's CSS). Run each script per
piece, against the same instance.

## 2. Pick the fixture: a real page that already shows the change

Grep for the CSS class, macro or plugin the change touches rather than inventing a scenario:

```bash
grep -rln "btn-group-last" --include=*.vm --include=*.less
```

Do **not** drive a feature's whole wizard — AppWithinMinutes' drag-and-drop class editor, say —
unless the workflow itself is what changed. That is where the flakiness lives.

*Sub-case:* when the change is one PropertyClass's `displayEdit()`/`displayView()` output there is
no existing page to find; `setup-class-object.js <space> <prop> <propTypeFQCN>` creates the class
and object via action URLs, far more reliably than the class editor. Use a fresh space name per
state so a stale page can never be mistaken for the other one.

**Dump the fixture's container before writing any selector** — assuming one exists is the fastest
way to burn a 30-second Playwright timeout:

```js
console.log(await page.evaluate(() => document.querySelector('#globalsearch').outerHTML));
```

## 3. Deploy and capture one state

Run this once per state. Which script comes from the table in step 1.

```bash
"$XWIKI_CAPTURE_SKILL"/setup-instance.sh \
  --verify 'tree-webjar:META-INF/resources/webjars/*/finder.js:xwiki-icon' \
  "$XWIKI_TEST_INSTANCES_DIR"/<ticket>-test/xwiki-platform-distribution-*-<version> \
  xwiki-platform-core/.../xwiki-platform-index-tree-webjar HEAD
```

**Always pass `--verify jarHint:pathInJar:pattern`** so a wrong or failed swap fails loudly instead
of leaving a stale jar deployed. Run any script with `--help` for its full flags.

A first-time module build can exceed the 10-minute ceiling most tool harnesses put on one command,
so launch it detached and wait on its log rather than in the foreground:

```bash
nohup "$XWIKI_CAPTURE_SKILL"/setup-instance.sh ... > /dev/null 2>&1 &
for i in $(seq 1 240); do
  grep -qE "instance is up|WARNING: instance did not|VERIFY FAILED|ERROR|FAILED|FAILURE" \
    "$INSTANCE_DIR/setup-instance.log" 2>/dev/null && break
  sleep 5
done
tail -5 "$INSTANCE_DIR/setup-instance.log"   # which marker it hit, or nothing if it died early
```

**Then assert the change from the capture script too.** `--verify` proves the right *bytes* were
deployed; it cannot prove the page renders differently, and the file-copy paths have no `--verify`
at all. Log the exact property under comparison in both states, just before shooting:

```js
const info = await page.evaluate(() => {
  const el = document.querySelector('#backtoedit input[name="action_saveandcontinue"]');
  return { cls: el.className, radius: getComputedStyle(el).borderTopRightRadius };
});
console.log(state, JSON.stringify(info));
// before {"cls":"btn btn-default","radius":"0px"}
// after  {"cls":"btn btn-default btn-group-last","radius":"7px"}
```

Two lines like that are the proof the states differ, they cost no vision tokens, and they are
stronger evidence than a screenshot pair that merely *looks* different. **Address the element by
name, never by position** — a positional selector is the classic way to read a value that never
changes, which looks exactly like a failed deploy (`references/gotchas.md`). On the file-copy paths
also grep the instance, since `sync-static-resource.sh` prints `synced` unconditionally:
`grep -c btn-group-last "$INSTANCE"/webapps/xwiki/skins/flamingo/previewactions.vm`.

Then shoot. Crop to the element, trying each selector in turn, so a fix that adds a wrapper does
not break one state's selector:

```js
const { screenshotElement } = require(process.env.XWIKI_CAPTURE_SKILL + '/element-screenshot');
await screenshotElement(page, ['.new-wrapper', '.old-bare-element'], `${state}.png`);
```

Take the **same crop in both states**, at the same viewport — that is what lets a reader compare
them. Include enough recognizable chrome (a page title, a toolbar, a panel header) that a reader
unfamiliar with the feature can tell where they are looking; a crop tight enough to show only the
changed pixels proves *what* changed but not *where*. Where the element alone is too tight, widen
the crop until the nearest landmark is inside it, or add asymmetric padding towards the chrome
(`{leftPad: 260, topPad: 120}`); `maxHeight` caps the clip while holding the element's bottom edge
in frame, for when the landmarks sit above it.

For a fixture needing a logged-in session, use the `xwiki-login` helper — `curl` fails CSRF checks
on form POSTs even with a scraped `form_token`, while a real browser session reads the token live
off the rendered page:

```js
const { login } = require(process.env.XWIKI_CAPTURE_SKILL + '/xwiki-login');
await login(page);   // reads XWIKI_BASE_URL, XWIKI_ADMIN_USER, XWIKI_ADMIN_PASS
```

## 4. Run both states, then restore

Step 3 runs three times: **after** (`HEAD` → `after.png`), **before** (`<fix-commit>~1` →
`before.png`), then **restore** (`HEAD` again, so the instance you leave behind matches the
branch — do not skip this). If the fix is not committed, use `HEAD` for both and ask the user to
commit first, per the git-safety rule above.

**The assertion log lines are the authority**, and they need nothing installed. If they are
identical, stop: the cause is a deploy that did not land or a selector on the wrong node, not a
screenshot problem.

Counting the differing pixels is an optional cross-check, worth running only where ImageMagick is
already available. It is deliberately not a prerequisite of this skill. Never substitute `md5sum`
for it: a live instance's screenshots are not byte-reproducible, so it reports spurious differences
and proves nothing when it matches.

```bash
command -v compare >/dev/null && compare -metric AE before.png after.png null: 2>&1
```

If you do measure, there is no useful absolute threshold; capture the *same* state twice and
measure that pair to get your noise floor. **A zero count is not automatically a bug** — plenty of
worthwhile fixes are semantic (a `<button>` becoming an `<a href>`, an `aria-label` appearing).
If the assertions differ
and the pixels do not, the *fixture* is the problem: find an interaction state where the two
diverge — keyboard focus is the reliable one — and say so in the caption rather than implying a
visual regression that was never there.

## 5. Deliver: attach to the JIRA issue, reference from the PR body

The two PNGs go on the **JIRA issue** first, then the PR body links them from there. `gh` cannot
upload an image, so the JIRA attachment URL is what the PR references — see `okf/servers/jira.md`
for the REST call (jira-cli has no `attach` command; Atlassian needs `X-Atlassian-Token: no-check`)
and `xwiki-pull-request` for the PR-body convention. Post them at native resolution, side by side:

```markdown
| Before | After |
| --- | --- |
| ![before](https://jira.xwiki.org/secure/attachment/<id>/before.png) | ![after](…/after.png) |
```

Do not stitch them into one composite image: the reader's client scales a wide composite down to
the comment column, which softens exactly the subtle detail the capture existed to show, while two
separate images render at native size and each opens full-size on click. Add one line of prose
saying what to look at, and name the fixture so a reader can reproduce it. Do not publish an
Artifact unless asked.

## Further reading

`references/gotchas.md` — failure modes that each cost real time to discover once: fixtures,
selectors and crops, builds and deployment. Read it before debugging a fixture that "should work",
a selector that reads the same in both states, or a swap that seems to do nothing.
