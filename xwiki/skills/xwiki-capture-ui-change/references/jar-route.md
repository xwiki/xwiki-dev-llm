# The jar route

Read by `xwiki-capture-ui-change` when its step 1 picked the jar route (a `jar` or `webjar` module,
or a translation bundle inside one), before the first build; step 3 runs it once per state. Step
numbers are those of that skill's `SKILL.md`; `$WORK`, `$CAPTURE_DIR`, `$INSTANCE_DIR` and
`$XWIKI_CAPTURE_SKILL` come from its environment block, and the backups under
`$CAPTURE_DIR/original/` made here are what its step 4 restores, one per jar. A fix spanning
several jar modules builds each in one worktree, then swaps them in one call, which restarts once.

**The jar route** is three steps, for `REF=WORKTREE` or any commit-ish:

1. **Build** at `REF` — the working tree itself for `WORKTREE`, otherwise a throwaway worktree, as
   `xwiki-backport` makes one. Build per `xwiki-build`: `xmvn` for the JDK the branch targets
   (these are old commits, the likeliest to target an older Java), and a `-legacy` module that
   weaves the changed one rebuilt too, since its woven jar is what ships. Use `package`, never
   `install`: an `install` of the "before" publishes the pre-fix jar into the shared `~/.m2` as the
   current SNAPSHOT. A first build can outlast a tool harness's per-command ceiling, so run it in
   the background and wait on its output.
2. **Swap and restart** with `tools/swap-jar.sh` (`--help` for its options). Per
   `xwiki-deploy-extension` step 0, it replaces each core extension in place in `WEB-INF/lib`,
   under the file name already there, backs each deployed jar up once, never over an existing
   backup, then restarts the instance once with step 0's stop and start. It refuses a module with
   no jar of that artifactId in `WEB-INF/lib`: the module does not ship as that jar — find the one
   holding the changed class before going further.
3. **Remove** the worktree.

```bash
MODULES=(xwiki-platform-core/.../xwiki-platform-index-tree-webjar)   # relative to the repo root
SRC=.; [ "$REF" = WORKTREE ] || { SRC="$WORK/ref-worktree"; git worktree add --detach "$SRC" "$REF"; }
for M in "${MODULES[@]}"; do (cd "$SRC/$M" && xmvn package -B -ntp -DskipTests); done   # or mvn
"$XWIKI_CAPTURE_SKILL/tools/swap-jar.sh" "${MODULES[@]/#/$SRC/}"   # step 4 restores its backups
[ "$SRC" = . ] || git worktree remove --force "$SRC"
```

The restart also empties the in-memory cache of LESS that XWiki compiles at request time (a
webjar's `.less` served with `evaluate=true`): no flush is needed after a swap. The browser's cache
is another matter, which `SKILL.md` step 3 covers.
