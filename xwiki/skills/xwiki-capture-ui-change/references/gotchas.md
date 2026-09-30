# Gotchas

Companion to `../SKILL.md`. Each of these cost real time to discover once.

Keep captures cheap: crop before you Read rather than saving a `fullPage` shot to see what
rendered. Where a `console.log` of the class name or computed style answers the question, it is
both cheaper and better evidence than a picture.

## Fixtures

- The object editor's "WebHome 0:" row expands by clicking its **text**, not a caret icon by index
  - there are two nested `.toggle-collapsable` elements, class-group and object, and clicking the
  outer one collapses everything instead.
- Chromium's native `<input type="number">` refuses non-numeric keystrokes at the DOM level, so
  typing "aaa" leaves the field empty rather than filled-then-rejected. That is the correct "after"
  screenshot for a reject-invalid-input fix, not a broken script.
- **A selector matching is not proof the element is usable.** Two ways this bites: a control can be
  wired up but off by default behind a keyboard shortcut (annotation highlights need `Alt+A`,
  because `AnnotationConfig`'s `displayed` defaults to `0`), and an element can exist in the DOM
  while unrendered inside a lazy-loaded tab pane (Comments, Attachments, History), where
  `getBoundingClientRect()` comes back all-zero. Check the rect or `offsetParent !== null`, and
  check a component's config defaults and `shortcut.add(...)` keys, before concluding the fixture
  is broken.

- **Opening an edit URL locks the page** for that user. A later capture of the same page as another
  user shoots the "This page is currently locked by …" warning instead of the editor. Shoot both
  states as the same user, or cancel the edit (`bin/cancel/<Space>/<Page>`) before switching.

## Selectors, crops and diffs

- **Why positional selectors bite in the skin templates.** `#editActionButton` emits a hidden
  `<input name="xaction">` after each submit button, so `#backtoedit .btn-group`'s four children
  are `action_save`, `xaction`, `action_saveandcontinue`, `xaction` - `:last-child` is a hidden
  input whose class and computed style never change, so asserting on it reads as a failed deploy
  when the deploy was fine. Its first argument is the *label* key and its second the *action*, so
  the button labelled "Save" is `action_saveandcontinue`, and "Save & View" is `action_save`.
- **Context-band anchoring, both failure directions.** `maxHeight` holds the element's bottom edge.
  In Preview mode the action bar sits *below* the previewed content, so a band anchored at the top
  of the content column drops the buttons and yields two identical context shots. A suggestion row
  at the top of a panel is the mirror case - the header bar and search field are above it, so
  bottom-anchoring cuts the wrong end off and asymmetric padding is the better tool.
- **Pixel-diff magnitudes, measured.** `compare -metric AE` on a corner-radius fix in a small button
  crop: 155. On a restyled suggestion row: 3097. A file against itself: 0. The count scales with
  crop size and with how much changed, so treat those as illustrations, not thresholds, and get a
  noise floor by measuring two captures of the same state.

## Builds, jars and deployment

- `mvn install` on `xwiki-platform-legacy-oldcore` can fail with "Component registered several
  times" in `target/classes/META-INF/components.txt` after worktree builds that reuse the same
  `target/`. Use `mvn clean install` for that module.
- **The assertion lines guard against more than a deploy bug.** The deployed code reflects whatever
  is on disk when the build runs, so if the checked-out commit changes underneath you mid-build -
  the user switching branches in their IDE - the swap "succeeds" and lands the wrong code. `git log
  -1` afterwards will not tell you what was on disk at build time.
- A branch rebased since it was opened can sit on a newer `${project.version}` than a cached test
  instance. That breaks the Extension Manager's install job for xar modules (`InstallException:
  Dependency [...] is not compatible with core extension feature [...]`), and so the
  `xwiki-deploy-extension` route SKILL.md sends you to; the fix is a version-matched distribution.
- A stale pre-built `.min.css`/`.min.js` sibling is served in preference to the raw file whenever a
  template loads it via `$xwiki.get('ssfx').use('path/to/foo.css', true)`, so overwriting only the
  raw file has zero visible effect. `sync-static-resource.sh` refreshes both.
- After a restart, `start_xwiki.sh` appears in `pstree` as a *child* of the `java` process it
  launched, with a `sleep` grandchild. Benign: it forks a lock-file watcher, then `exec`s into
  `java`, replacing its own PID. Not an auto-restart loop; do not chase it.
