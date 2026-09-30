---
name: xwiki-capture-ui-change
description: Capture the "before" screenshot of an XWiki UI change - the one the branch can no longer produce - by running the released version's Docker image, or else building and deploying the pre-fix code on a local instance, then screenshotting the same fixture in both states. EXPENSIVE (minutes for the Docker image, a module build and two instance restarts otherwise) and NARROW — use it only for a fix to EXISTING UI whose visual difference is too subtle to see without the two states side by side (a corner radius, a spacing or alignment shift, a colour, a wrong icon). Do NOT use it for a new feature, a redesign, or any change a reader can see in a single screenshot - those need no "before" and are shown with an ordinary screenshot. Requires explicit user approval before running. For deploying an extension without a comparison use xwiki-deploy-extension; for Maven commands use xwiki-build; for the PR/JIRA screenshot conventions use xwiki-pull-request.
---

# Capture an XWiki UI change

## What this is for, and when not to use it

The deliverable is **the "before" screenshot** — the state your branch can no longer produce,
because the fix is already in the working tree. Everything else here exists to reach that state
safely. The "after" is trivial; you can shoot it at any time.

That is worth the setup below only when **the difference is too subtle to see without both states
in front of you**: a corner radius, a 2px alignment shift, a colour, a
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

**Ask the user before starting.** This costs a released-version Docker instance (a few minutes),
or else a Maven build (minutes to tens of minutes) and two instance restarts, plus a bespoke capture
script either way. Say what it will cost and get an explicit yes.
The two file-copy paths below are the exception — seconds, no build — but still confirm.

## Never write to git in the repo under comparison

This skill only ever *reads* git state. It must never run `git commit`, `git add`, `git push`,
`git checkout <branch>` or `--amend` against the repo the user is working in. The jar route of
step 3 covers both cases without committing: `HEAD` builds the working tree exactly as it sits,
uncommitted changes and all, and any other commit-ish is built in a throwaway worktree removed
afterwards. If the fix is not committed yet, that is **not** a reason to commit it — use `HEAD`
for the "after". An agent following an earlier draft of this procedure amended the user's own
commit trying to "make the before/after refs work".

## Environment, for every route below

```bash
# This skill's directory. Kimi Code: ${KIMI_SKILL_DIR}. opencode:
# $XWIKI_LLM_HOME/xwiki/skills/xwiki-capture-ui-change.
export XWIKI_CAPTURE_SKILL="${CLAUDE_PLUGIN_ROOT}/skills/xwiki-capture-ui-change"
# The work directory of the org conventions, under the repo holding the fix. Test distributions are
# reused across tickets, so they sit beside the per-ticket directories; this ticket's screenshots
# and capture script go in its own.
REPO="$(basename "$(git rev-parse --show-toplevel)")"
WORK="$(node "$XWIKI_CAPTURE_SKILL/../../scripts/state-dir.mjs")/$REPO"
INSTANCES="$WORK/test-instances"
INSTANCE_DIR="$INSTANCES/<ticket>-test/xwiki-platform-distribution-<flavor>-<version>"
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
branch's instance either way.

```bash
V=18.7.0   # the latest release the bug affects
docker network create xwiki-before
docker run -d --name xwiki-before-db --net xwiki-before -e MYSQL_ROOT_PASSWORD=xwiki \
  -e MYSQL_DATABASE=xwiki mysql:8.4 --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_bin --explicit-defaults-for-timestamp=1
docker run -d --name xwiki-before --net xwiki-before -p 127.0.0.1:8089:8080 \
  -e DB_HOST=xwiki-before-db \
  -e DB_USER=root -e DB_PASSWORD=xwiki -e DB_DATABASE=xwiki "xwiki:$V-mysql-tomcat"
```

Pick a host port nothing listens on (8089 here), and keep it bound to `127.0.0.1`: the instance
runs with a well-known `superadmin` password. Four things about the image are not obvious:

- **XWiki connects as the database root user.** A `MYSQL_USER` account lacks the `PROCESS`
  privilege XWiki's schema migration needs, and a first start that fails on it leaves a
  half-created schema behind: recreate both containers rather than restarting one.
- **It serves XWiki at the root context:** `http://localhost:8089`, with no `/xwiki`. Keep that
  in its own `BEFORE_URL`; `XWIKI_BASE_URL` stays the branch's instance, which step 0 waits on.
- **It starts as an empty wiki** that sends every request, REST included, to the Distribution
  Wizard. Skip the wizard: enable `superadmin`, turn off the wizard's automatic start, restart, and
  install the flavor as `superadmin:system` with `xwiki-deploy-extension`'s `installjobrequest.xml`,
  filled with extension `org.xwiki.platform:xwiki-platform-distribution-flavor-mainwiki` and
  version `$V` (its namespace `wiki:xwiki` is already right). The job downloads from
  extensions.xwiki.org and takes a couple of minutes.
- **The wizard also creates `XWiki.Admin`**, and the flavor's pages name it as their author.
  Skipped, it does not exist, so every script those pages hold fails to render ("the execution of
  the [velocity] script macro is not allowed … check the rights of its last author"). Create it
  with admin and programming rights, after which `Admin:admin` works here as on the branch's
  instance and `superadmin` is only needed for this setup.

```bash
docker exec xwiki-before sh -c 'W=/usr/local/tomcat/webapps/ROOT/WEB-INF
  sed -i "s/^# xwiki.superadminpassword=system/xwiki.superadminpassword=system/" $W/xwiki.cfg
  echo distribution.automaticStartOnMainWiki=false >> $W/xwiki.properties'
docker restart xwiki-before
BEFORE_URL=http://localhost:8089
UP=""
for i in $(seq 1 60); do
  curl -sf -o /dev/null -u superadmin:system "$BEFORE_URL/rest/wikis/xwiki" && { UP=1; break; }
  sleep 3
done
[ -n "$UP" ] || echo "not up after 3min, check: docker logs xwiki-before"
curl -s -u superadmin:system -X PUT -H "Content-Type: text/xml" \
  --upload-file installjobrequest.xml "$BEFORE_URL/rest/jobs?jobType=install&async=false" \
  | grep -o '<state>[^<]*</state>'   # expect FINISHED
P="$BEFORE_URL/rest/wikis/xwiki/spaces/XWiki/pages"
X=(-s -o /dev/null -w '%{http_code}\n' -u superadmin:system -H "Content-Type: application/xml")
curl "${X[@]}" -X PUT "$P/Admin" --data '<page xmlns="http://www.xwiki.org"><title>Admin</title>
  <content>{{include reference="XWiki.XWikiUserSheet"/}}</content></page>'
curl "${X[@]}" -X POST "$P/Admin/objects" --data '<object xmlns="http://www.xwiki.org">
  <className>XWiki.XWikiUsers</className><property name="first_name"><value>Admin</value></property>
  <property name="password"><value>admin</value></property>
  <property name="active"><value>1</value></property></object>'
curl "${X[@]}" -X POST "$P/XWikiPreferences/objects" --data '<object xmlns="http://www.xwiki.org">
  <className>XWiki.XWikiGlobalRights</className>
  <property name="users"><value>XWiki.Admin</value></property>
  <property name="levels"><value>admin,programming</value></property>
  <property name="allow"><value>1</value></property></object>'   # each: 201
```

Then pick the fixture (step 2) and shoot it as step 3 does, against `$BEFORE_URL`. Remove the
containers when done: `docker rm -f xwiki-before xwiki-before-db && docker network rm xwiki-before`.

## 0. An instance to reuse

Prerequisites: a prebuilt XWiki jetty+hsqldb distribution (building one takes 30-60+ minutes, so
copy an existing one), and the `agent-browser` skill. Check before starting, not three steps in:

```bash
pgrep -af 'STOP.KEY=xwiki'; lsof -nP -iTCP:8080 -sTCP:LISTEN   # something already running?
ls "$INSTANCES"                                                 # something to copy?
agent-browser --version                                         # else load its skill to install
```

The jar route stops and restarts the instance it deploys into, so check *whose* instance is on the
port first. **Never stop an XWiki instance this session did not start** — the rule `xwiki-build`
states for Docker ITs applies here unchanged. If nothing is listening, start one and wait for it
(~40s); a capture against a half-started Jetty fails in confusing ways. `setsid` takes the JVM out
of the shell's session, without which a tool harness waits on the server for as long as it lives
(it is Linux-only; on macOS a plain `nohup … &` is enough):

```bash
(cd "$INSTANCE_DIR" && setsid nohup ./start_xwiki.sh < /dev/null > xwiki-start.log 2>&1 &)
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
| `jar`, `webjar`, or absent | the jar route of step 3 — builds at a ref, swaps the jar in `WEB-INF/lib` | yes, both |
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
hits `InstallException: Dependency [...] is not compatible with core extension feature [...]`, the
instance has drifted from the branch's version: use a version-matched distribution.

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

**The jar route** is three steps other skills already own, for `REF=HEAD` or any commit-ish:

1. **Build** at `REF` — the working tree itself for `HEAD`, otherwise a throwaway worktree, as
   `xwiki-backport` makes one. Build per `xwiki-build`: `xmvn` for the JDK the branch targets
   (these are old commits, the likeliest to target an older Java), and a `-legacy` module that
   weaves the changed one rebuilt too, since its woven jar is what ships. Use `package`, never
   `install`: an `install` of the "before" publishes the pre-fix jar into the shared `~/.m2` as the
   current SNAPSHOT. A first build can outlast a tool harness's per-command ceiling, so run it in
   the background and wait on its output.
2. **Swap** the jar, per `xwiki-deploy-extension` step 0: a core extension is replaced in place in
   `WEB-INF/lib`, under its own file name. No file of that name there means the module does not
   ship as that jar — find the one holding the changed class before going further.
3. **Restart** the instance, with step 0's stop and start, then remove the worktree.

```bash
MODULE=xwiki-platform-core/.../xwiki-platform-index-tree-webjar   # relative to the repo root
SRC=.; [ "$REF" = HEAD ] || { SRC="$WORK/ref-worktree"; git worktree add --detach "$SRC" "$REF"; }
(cd "$SRC/$MODULE" && xmvn package -B -ntp -DskipTests)      # mvn where xmvn is not installed
cp "$SRC/$MODULE"/target/<artifactId>-<version>.jar "$INSTANCE_DIR"/webapps/xwiki/WEB-INF/lib/
(cd "$INSTANCE_DIR" && ./stop_xwiki.sh)   # then step 0's start and wait
[ "$SRC" = . ] || git worktree remove --force "$SRC"
```

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
changes, which looks exactly like a failed deploy (`references/gotchas.md`). On the file-copy paths
also grep the instance, since `sync-static-resource.sh` prints `synced` unconditionally:
`grep -c btn-group-last "$INSTANCE_DIR"/webapps/xwiki/skins/flamingo/previewactions.vm`.

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
"$DOCSHOT" "$state" "$(cut -d, -f3 <<<"$REGION")" "$REGION"   # -> $CAPTURE_DIR/$state.png
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

Step 3 runs three times: **after** (`HEAD` → `$CAPTURE_DIR/after.png`), **before**
(`<fix-commit>~1` → `$CAPTURE_DIR/before.png`), then **restore** (`HEAD` again, so the instance you
leave behind matches the branch — do not skip this). If the fix is not committed, use `HEAD` for
both and ask the user to commit first, per the git-safety rule above.

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
