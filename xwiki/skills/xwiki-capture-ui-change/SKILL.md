---
name: xwiki-capture-ui-change
description: Capture the "before" screenshot of a fix to existing XWiki UI when the branch can no longer produce it (the fix is already in the working tree) - on the released version's Docker image, or by building and deploying the pre-fix code on a local instance - and shoot the same fixture in both states. Costs minutes to tens of minutes, so propose it and run it only with the user's explicit approval. Not for a new feature or a redesign (there is no "before"), nor when the bug can still be shot on a running instance before applying the fix. For deploying an extension without a comparison use xwiki-deploy-extension; for Maven commands use xwiki-build; for the PR/JIRA screenshot conventions use xwiki-pull-request.
---

# Capture an XWiki UI change

## What this is for, and when not to use it

The deliverable is **the "before" screenshot** — the state your branch can no longer produce,
because the fix is already in the working tree. Everything else here exists to reach that state
safely. The "after" is trivial; you can shoot it at any time.

When the bug can still be shot — on a running instance, before applying the fix — do that
instead: it needs none of the setup below. And do **not** run this for a new feature or a redesign:
there is no "before" to capture, and a "before" panel next to the "after" reads as a regression that
never happened. Take an ordinary screenshot of the result and follow `xwiki-pull-request`'s
"Screenshots & Video" rule.

**Ask the user before starting.** This costs a released-version Docker instance (a few minutes),
or else a Maven build (minutes to tens of minutes) and two instance restarts, plus a bespoke capture
script either way. Say what it will cost and get an explicit yes.
The two file-copy paths below are the exception — seconds, no build — but still confirm.

## Never write to git in the repo under comparison

This skill only ever *reads* git state. It must never run `git commit`, `git add`, `git push`,
`git checkout <branch>` or `--amend` against the repo the user is working in. The jar route of
step 3 covers both cases without committing: `REF=WORKTREE` builds the working tree exactly as it
sits, uncommitted changes and all, and any commit-ish (`HEAD` included) is built in a throwaway
worktree removed afterwards. If the fix is not committed yet, that is **not** a reason to commit
it — the "after" is `WORKTREE` and the "before" is `HEAD`. An agent following an earlier draft of
this procedure amended the user's own commit trying to "make the before/after refs work".

## Environment, for every route below

```bash
# This skill's directory. Kimi Code: ${KIMI_SKILL_DIR}. opencode:
# $XWIKI_LLM_HOME/xwiki/skills/xwiki-capture-ui-change.
export XWIKI_CAPTURE_SKILL="${CLAUDE_PLUGIN_ROOT}/skills/xwiki-capture-ui-change"
# Run from the checkout holding the fix: REPO and the jar route's module paths resolve against it.
# The work directory of the org conventions, under that repo. Test distributions are reused across
# tickets, so they sit beside the per-ticket directories; this ticket's screenshots and capture
# script go in its own.
REPO="$(basename "$(git rev-parse --show-toplevel)")"
WORK="$(node "$XWIKI_CAPTURE_SKILL/../../scripts/state-dir.mjs")/$REPO"
INSTANCES="$WORK/test-instances"
INSTANCE_DIR="$INSTANCES/<ticket>-test/xwiki-platform-distribution-flavor-jetty-hsqldb-<version>"
export CAPTURE_DIR="$WORK/$(date +%F)-<ticket>-capture"; mkdir -p "$CAPTURE_DIR"
export XWIKI_BASE_URL="${XWIKI_BASE_URL:-http://localhost:8080/xwiki}"   # the branch's instance
# Browser: the agent-browser skill, in one session for the whole capture. Shots go through
# xwiki-doc-writing's docshot.sh, which reads AB_SESSION and SHOTS.
export AB_SESSION=capture SHOTS="$CAPTURE_DIR"
DOCSHOT="$XWIKI_CAPTURE_SKILL/../xwiki-doc-writing/tools/docshot.sh"
agent-browser --session capture set viewport 1440 900 1
agent-browser --session capture set headers \
  "{\"Authorization\": \"Basic $(printf Admin:admin | base64)\"}"
```

Tell the developer the `$CAPTURE_DIR` path once, so they know where the screenshots are.

## Cheapest first: is the "before" already released?

When the bug is in a release — the issue's Affects Version says so — shoot the "before" on that
release's official Docker image: no module build, no jar swap, no distribution to copy, about three
minutes once the image is pulled. Steps 0-4 are for the rest: a bug that exists only in unreleased
code (a regression on the branch the fix targets), or a released UI that differs from the branch's
around the fixture enough that the two shots stop being comparable. The "after" is shot on your
branch's instance either way: one already running the fix (step 3's assertion shows it), else
steps 0-3 deploy `WORKTREE` into step 0's instance.

When that is the route, open `references/released-image.md` before the first `docker run`: it
sets up the "before" instance at `$BEFORE_URL`, bound to `127.0.0.1` only since it runs with a
well-known `superadmin` password, and step 4 removes its containers.

## 0. An instance to reuse

Prerequisites: a prebuilt XWiki jetty+hsqldb distribution (building one takes 30-60+ minutes, so
copy an existing one: a previous one under `$INSTANCES`, or the `.zip` a distribution build left in
the repo's `xwiki-platform-distribution-flavor-jetty-hsqldb/target/`, unzipped under `$INSTANCES`
since the next `mvn clean` wipes `target/`), and the `agent-browser` skill. Check before starting,
not three steps in:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN   # something already running?
ls "$INSTANCES"                    # something to copy?
agent-browser --version            # else load its skill to install
```

The jar route stops and restarts the instance it deploys into, so check *whose* instance is on the
port first. **Never stop an XWiki instance this session did not start** — the rule `xwiki-build`
states for Docker ITs applies here unchanged. If nothing is listening, start one and wait for it
(~40s); a capture against a half-started Jetty fails in confusing ways. `setsid` takes the JVM out
of the shell's session, without which a tool harness waits on the server for as long as it lives;
it is Linux-only, and on macOS a plain `nohup … &` is enough:

```bash
DETACH=$(command -v setsid || true)
(cd "$INSTANCE_DIR" && $DETACH nohup ./start_xwiki.sh < /dev/null > xwiki-start.log 2>&1 &)
UP=""
for i in $(seq 1 60); do
  curl -sf -o /dev/null "$XWIKI_BASE_URL/bin/view/Main/WebHome" && { UP=1; break; }
  sleep 2
done
[ -n "$UP" ] && echo up || echo "not up after 2min, check $INSTANCE_DIR/xwiki-start.log"
```

Stop it with `(cd "$INSTANCE_DIR" && ./stop_xwiki.sh)`. Every path here needs a running instance,
including the file-copy ones. An instance you started is yours to stop; one you found is not.

## 1. Pick the deploy path from the module's packaging

```bash
grep -m1 '<packaging>' path/to/module/pom.xml
```

| Packaging | Path | Build? Restart? |
| --- | --- | --- |
| `jar`, `webjar`, or absent | the jar route of step 3, `references/jar-route.md` — builds at a ref, swaps the jar in `WEB-INF/lib` | yes, both |
| `xar` | follow **`xwiki-deploy-extension`** (REST job API); its uninstall-then-reinstall step is what the second state hits | build only |
| static CSS/JS under `webapps/xwiki/resources/` | `sync-static-resource.sh --backup-dir "$CAPTURE_DIR/original"` | neither |
| `pom` resources-only (skin `.vm`/`.less`) | the same, plus `--target-root skins` | neither |

A webjar's assets are **minified at build time**, so despite being "just JS and CSS" it needs Maven
and cannot take the file-copy shortcut. For the two file-copy paths the copied file is read off disk
on the next page load — a before/after costs seconds, so never reach for a module build when the
change is only in files like those. A skin `.less` is the exception: XWiki caches its compiled CSS
in memory, so each copy needs `$services.lesscss.clearCache()` (programming rights) or a restart. When unsure of the root, locate the file:
`find "$INSTANCE_DIR"/webapps/xwiki -name previewactions.vm`.

**Version matching** only matters for the jar and xar paths: a jar built against a different
`${project.version}` can break at runtime, and the Extension Manager refuses outright. A `.vm` or a
stylesheet is served as-is, so an 18.7.0 instance happily renders a template from an 18.8.0 branch.
Do not spend 30-60 minutes copying a version-matched distribution for a file copy. If the xar route
hits `InstallException: Dependency [...] is not compatible with core extension feature [...]`, the
instance has drifted from the branch's version: use a version-matched distribution.

**A translation key is not a static file.** When the fix also adds a key to a `.properties` bundle
(e.g. `ApplicationResources.properties`, inside an oldcore jar) and its text is visible, the
file-copy paths alone shoot a raw key or a blank label, which reads as a bug in the fix: deploy the
bundle's module by the jar route as well.

One change can span several rows (a xar module *and* a war module's CSS). Run each script per
piece, against the same instance.

## 2. Pick the fixture: a real page that already shows the change

Grep for the CSS class, macro or plugin the change touches rather than inventing a scenario:

```bash
grep -rln "btn-group-last" --include=*.vm --include=*.less
```

Do **not** drive a feature's whole wizard — AppWithinMinutes' drag-and-drop class editor, say —
unless the workflow itself is what changed. That is where the flakiness lives.

*Sub-case:* when the change is one PropertyClass's `displayEdit()`/`displayView()` output, find a
class the distribution already ships with a property of that type, and open a page holding one of
its objects in the object editor (`?editor=object`) or in inline edit mode:

```bash
grep -rl --include='*.xml' '<classType>com.xpn.xwiki.objects.classes.NumberClass</classType>' \
  xwiki-platform-core | grep /src/main/resources/
```

**Dump the fixture's container before writing any selector** — assuming one exists is the fastest
way to shoot the wrong thing, and the edit page of a broken wiki and of a working one have
different DOMs:

```bash
agent-browser --session capture open "$XWIKI_BASE_URL/bin/view/Main/WebHome"
agent-browser --session capture eval "document.querySelector('#globalsearch').outerHTML"
```

## 3. Deploy and capture one state

Run this once per state, with the deploy route the table in step 1 picked.

**The jar route:** open `references/jar-route.md` before the first build, and follow it for each
state. Two of its rules guard what outlives the capture: build with `package`, never `install`,
which would publish the pre-fix jar into the shared `~/.m2` as the current SNAPSHOT; and back up
each deployed jar under `$CAPTURE_DIR/original/` before its first swap, since step 4 restores it.

**Reopen the browser between the two states** (`agent-browser --session capture close`, then the
environment block's `set viewport` and `set headers`): XWiki serves a webjar's files with a
one-year `Expires`, so the same session can render the second state with the first one's JS/CSS.

**Then assert the change from the capture script.** A swap can land the wrong bytes, and the page
may render the same even when it landed the right ones; the file-copy paths have nothing to check
the deploy with at all. Log the exact property under comparison in both states, just before
shooting:

```bash
agent-browser --session capture eval "(() => {
  const el = document.querySelector('#backtoedit input[name=action_saveandcontinue]');
  return el.className + ' ' + getComputedStyle(el).borderTopRightRadius; })()"
# before "btn btn-default 0px"
# after  "btn btn-default btn-group-last 7px"
```

Two lines like that are the proof the states differ, they cost no vision tokens, and they are
stronger evidence than a screenshot pair that merely *looks* different. **Address the element by
name, never by position** — a positional selector is the classic way to read a value that never
changes, which looks exactly like a failed deploy (`references/gotchas.md`).

On the file-copy paths also grep the instance, since `sync-static-resource.sh` prints `synced`
unconditionally: `grep -c btn-group-last "$INSTANCE_DIR"/webapps/xwiki/skins/flamingo/previewactions.vm`.

Then shoot, with `docshot.sh` and no red box: that is a plain crop of an `x,y,w,h` viewport region,
saved at its own width with no resampling. Compute the region **once**, in the first state, and
reuse it for the second — the **same crop in both states**, at the same viewport, is what lets a
reader compare them. Try each selector in turn, so a fix that adds a wrapper does not break one
state's selector, and pad towards the chrome:

```bash
REGION=$(agent-browser --session capture eval "(() => {
  for (const s of ['.new-wrapper', '.old-bare-element']) {
    const e = document.querySelector(s);
    if (!e) continue;
    const r = e.getBoundingClientRect(), p = {t: 120, r: 8, b: 8, l: 260};
    return [r.left - p.l, r.top - p.t, r.width + p.l + p.r, r.height + p.t + p.b]
      .map(v => Math.max(0, Math.round(v))).join(',');
  }
  throw new Error('no selector matched'); })()" | tr -d '"')
[ -n "$REGION" ] || echo "no region: the eval failed, and \$( | tr) hides its status"
STATE=before   # or after
"$DOCSHOT" "$STATE" "$(cut -d, -f3 <<<"$REGION")" "$REGION"   # -> $CAPTURE_DIR/$STATE.png
```

Include enough recognizable chrome (a page title, a toolbar, a panel header) that a reader
unfamiliar with the feature can tell where they are looking; a crop tight enough to show only the
changed pixels proves *what* changed but not *where*. Widen the padding until the nearest landmark
is inside the region. The region is in viewport pixels, so never scroll to reach the element:
enlarge the viewport instead (`xwiki-doc-writing`'s `tools/README.md` has why).

The session is logged in through the `Authorization` header the environment block set: a local
instance accepts HTTP Basic credentials on `/bin/` pages as well as on REST, so no login form is
involved. `set credentials` would not do: it answers a 401 challenge, and a guest-readable page
never sends one. Any page or object the fixture has to create beforehand is a REST write, per
`xwiki-rest-api`.

## 4. Run both states, then restore

Step 3 runs twice: **after** (`WORKTREE` → `$CAPTURE_DIR/after.png`), then **before**
(`<fix-commit>~1`, or `HEAD` when the fix is uncommitted → `$CAPTURE_DIR/before.png`). On the
released-image route the "before" is steps 2-3 alone, against `$BEFORE_URL`.

Then **restore** — do not skip it: put back what the instance had before the first swap, so the
instance you leave behind is the one you found. The jar and file-copy paths backed up every file
they overwrote, so restoring is one copy, no build — plus step 0's restart when a jar was swapped:
`cp -R "$CAPTURE_DIR/original/." "$INSTANCE_DIR/"`. A file the fix *added* has no backup: delete
it. The xar route has no restore: tell the user which version of the extension the instance keeps.
On the released-image route, remove its containers (the last line of
`references/released-image.md`).

**The assertion log lines are the authority**, and they need nothing installed. If they are
identical, stop: the cause is a deploy that did not land or a selector on the wrong node, not a
screenshot problem.

Counting the differing pixels is an optional cross-check, worth running only where ImageMagick is
already available. It is deliberately not a prerequisite of this skill. Never substitute `md5sum`
for it: a live instance's screenshots are not byte-reproducible, so it reports spurious differences
and proves nothing when it matches.

```bash
command -v compare >/dev/null && compare -metric AE "$CAPTURE_DIR"/{before,after}.png null: 2>&1
```

If you do measure, there is no useful absolute threshold; capture the *same* state twice and
measure that pair to get your noise floor. **A zero count is not automatically a bug** — plenty of
worthwhile fixes are semantic (a `<button>` becoming an `<a href>`, an `aria-label` appearing).
If the assertions differ and the pixels do not, the *fixture* is the problem: find an interaction
state where the two diverge — keyboard focus is the reliable one — and say so in the caption rather
than implying a visual regression that was never there.

## 5. Deliver: attach to the JIRA issue, reference from the PR body

The images go on the **JIRA issue** first, then the PR body links them from there. `gh` cannot
upload an image, so the JIRA attachment URL is what the PR references — see `okf/servers/jira.md`
(under the plugin root, `$XWIKI_CAPTURE_SKILL/../..`) for the REST call (jira-cli has no `attach` command; Atlassian needs `X-Atlassian-Token: no-check`)
and `xwiki-pull-request` for the PR-body convention. When each state is legible on its own, post
them at native resolution, side by side:

```markdown
| Before | After |
| --- | --- |
| ![before](https://jira.xwiki.org/secure/attachment/<id>/before.png) | ![after](…/after.png) |
```

When the point is a pixel comparison (a radius, a 2px shift, a colour), post **one composite**
instead: both states juxtaposed in a single image, so one click zooms the two together rather than
leaving the reader to arrange two tabs.
Build it as `references/composite-image.md` says, and attach it in place of the pair.

Either way, add one line of prose saying what to look at, and name the fixture so a reader can
reproduce it. Do not publish an Artifact unless asked.

## Further reading

`references/gotchas.md` — failure modes that each cost real time to discover once: fixtures,
selectors and crops, builds and deployment. Read it before debugging a fixture that "should work",
a selector that reads the same in both states, or a swap that seems to do nothing.
