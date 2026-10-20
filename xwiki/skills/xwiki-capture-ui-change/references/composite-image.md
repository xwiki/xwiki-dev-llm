# The composite image

Read by `xwiki-capture-ui-change` at its step 5, when the point of the fix is a pixel comparison (a
radius, a 2px shift, a colour) and the two states go to JIRA as one composite instead of a pair.
`$CAPTURE_DIR`, `$DOCSHOT` and the browser session come from that skill's environment block.

Build it in the same browser session, with each panel at its
natural size — no width rule, so neither state is resampled:

```bash
cat > "$CAPTURE_DIR/composite.html" <<'HTML'
<body style="margin:0;background:#fff;font:600 14px sans-serif">
<div id="c" style="display:inline-flex;gap:16px;padding:8px">
  <figure style="margin:0">Before<br><img src="before.png"></figure>
  <figure style="margin:0">After<br><img src="after.png"></figure>
</div></body>
HTML
agent-browser --session capture set viewport 3000 2000 1   # wide enough for both panels
agent-browser --session capture open "file://$CAPTURE_DIR/composite.html"
REGION=$(agent-browser --session capture eval "(() => { const r = document.querySelector('#c')
  .getBoundingClientRect(); return [0, 0, Math.ceil(r.width), Math.ceil(r.height)].join(','); })()" \
  | tr -d '"')
"$DOCSHOT" composite "$(cut -d, -f3 <<<"$REGION")" "$REGION"   # -> $CAPTURE_DIR/composite.png
```
