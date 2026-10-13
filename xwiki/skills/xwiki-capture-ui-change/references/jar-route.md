# The jar route

Read by `xwiki-capture-ui-change` when its step 1 picked the jar route (a `jar` or `webjar` module,
or a translation bundle inside one), before the first build; step 3 runs it once per state. Step
numbers are those of that skill's `SKILL.md`; `$WORK`, `$CAPTURE_DIR` and `$INSTANCE_DIR` come from
its environment block, and the backups under `$CAPTURE_DIR/original/` made here are what its step 4
restores, one per jar. A fix spanning several jar modules runs the block's build, backup and `cp` lines
once per module, in one worktree, then restarts once.

**The jar route** is three steps other skills already own, for `REF=WORKTREE` or any commit-ish:

1. **Build** at `REF` — the working tree itself for `WORKTREE`, otherwise a throwaway worktree, as
   `xwiki-backport` makes one. Build per `xwiki-build`: `xmvn` for the JDK the branch targets
   (these are old commits, the likeliest to target an older Java), and a `-legacy` module that
   weaves the changed one rebuilt too, since its woven jar is what ships. Use `package`, never
   `install`: an `install` of the "before" publishes the pre-fix jar into the shared `~/.m2` as the
   current SNAPSHOT. A first build can outlast a tool harness's per-command ceiling, so run it in
   the background and wait on its output.
2. **Swap** the jar, per `xwiki-deploy-extension` step 0: a core extension is replaced in place in
   `WEB-INF/lib`, under the file name already there: the instance's version can differ from the
   branch's, and copying under the built name would add a second jar rather than replace the first.
   No jar of that artifactId there means the module does not ship as that jar — find the one
   holding the changed class before going further.
3. **Restart** the instance, with step 0's stop and start, then remove the worktree.

```bash
MODULE=xwiki-platform-core/.../xwiki-platform-index-tree-webjar   # relative to the repo root
SRC=.; [ "$REF" = WORKTREE ] || { SRC="$WORK/ref-worktree"; git worktree add --detach "$SRC" "$REF"; }
(cd "$SRC/$MODULE" && xmvn package -B -ntp -DskipTests)      # mvn where xmvn is not installed
LIB="$INSTANCE_DIR"/webapps/xwiki/WEB-INF/lib; DEPLOYED=$(ls "$LIB"/<artifactId>-[0-9]*.jar)
ORIG="$CAPTURE_DIR/original/webapps/xwiki/WEB-INF/lib"; mkdir -p "$ORIG"
[ -e "$ORIG/${DEPLOYED##*/}" ] || cp "$DEPLOYED" "$ORIG/"   # step 4 restores it
cp "$SRC/$MODULE"/target/<artifactId>-<version>.jar "$DEPLOYED"
(cd "$INSTANCE_DIR" && ./stop_xwiki.sh)   # then step 0's start and wait
[ "$SRC" = . ] || git worktree remove --force "$SRC"
```

The restart also empties the in-memory cache of LESS that XWiki compiles at request time (a
webjar's `.less` served with `evaluate=true`): no flush is needed after a swap. The browser's cache
is another matter, which `SKILL.md` step 3 covers.
