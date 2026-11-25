# agent-browser on XWiki: traps

What made testers lose time, or report a working feature as broken, when driving XWiki with the
`agent-browser` CLI.

- **Keystroke-driven features need real key events.** Text inserted with `fill` never fires
  CKEditor's autocompletion triggers (`#`, `@` mentions, `/` commands), and testers saw the same with
  `keyboard type`: the feature looks broken. Type those with `press`, one key at a time.
- **The wiki editor's textarea is hidden behind the code editor**: click into the editor and use
  `keyboard inserttext`, not `fill #content`. Typing while nothing has the focus triggers XWiki's
  keyboard shortcuts.
- **CKEditor macro dialog**: select the macro and press Enter.
- **"Save & View" is often below the fold**: scroll to it or use its selector.
- **Prefer refs from `snapshot -i`** to `find text/role … click`, which can match the wrong element.
  A whole XWiki page's snapshot is large: scope it to the part under test (`-s "#xwikicontent"`,
  `-s .modal`) and add `-c`.
- **One tab per session**: the network log is per tab.
- **Switch users with sessions**, not by logging out (the logout link needs a form token).
- **Screenshot paths must be absolute**: relative ones resolve against the agent-browser daemon's
  directory. Prefer viewport or element screenshots: a full-page shot of a tall page can repeat its
  top, and may come out blank.
- **Wrap long calls in `timeout`**: agent-browser can hang for minutes on a page that keeps loading.
- **After a version switch, `close` the session and log in again**: there is no cache-bypassing
  reload, and the JS and CSS skin extensions are cached.

## Layout probe

```bash
agent-browser eval "[...document.querySelectorAll('body *')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible').slice(0,20).map(e => e.tagName + '.' + e.className)"
```

It only finds candidates: confirm on the screenshot.

## axe-core

Download it once into the run directory instead of fetching it on every page, then inject it through
stdin (it is too big for one command-line argument on Linux):

```bash
curl -s -o <run>/axe.min.js https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js
agent-browser --session <s> eval --stdin < <run>/axe.min.js
agent-browser --session <s> eval "axe.run({runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}).then(r => JSON.stringify(r.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target.join(' '))}))))"
```
