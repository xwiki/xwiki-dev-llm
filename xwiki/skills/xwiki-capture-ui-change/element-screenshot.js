// Reusable Playwright helper for the "cropping when before/after markup differs" case (see
// SKILL.md): a fix can add/remove a wrapper element around what you're screenshotting, so a
// single hard-coded selector exists in one state and not the other, and screenshotting a
// shared parent (e.g. a whole tree, not just one row) easily bleeds in sibling content whose
// size differs between states. This tries each selector in order and clips to whichever one
// is actually present, computed via its own getBoundingClientRect() plus a little padding.
//
// Usage from a per-ticket script:
//   const { screenshotElement } = require(process.env.XWIKI_CAPTURE_SKILL + '/element-screenshot');
// where XWIKI_CAPTURE_SKILL points at this skill's directory (SKILL.md, step 0, exports it).
//   await screenshotElement(page, ['.new-wrapper', '.old-bare-element'], outPath);
//
// If you see a sliver of an adjacent element in the output, that's crop overshoot, not a bug
// in the fix - tighten `pad` (or `bottomPad`/`topPad`/etc. individually) a few px at a time.
//
// opts.maxHeight caps the clip height while keeping the matched element's BOTTOM edge in frame,
// which is how you take the wider "context" shot SKILL.md step 3 asks for: a band of the page
// ending just below the element, rather than the element's own box. Padding alone cannot do this
// - it only ever grows the box outwards from the element - so without the cap a context shot has
// to be hand-rolled with page.screenshot({clip}).
//   await screenshotElement(page, ['#backtoedit'], ctxPath, {pad: 0, topPad: 260, maxHeight: 260});
async function screenshotElement(page, selectors, outPath, opts = {}) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const pad = opts.pad ?? 4;
  const topPad = opts.topPad ?? pad;
  const rightPad = opts.rightPad ?? pad;
  const bottomPad = opts.bottomPad ?? pad;
  const leftPad = opts.leftPad ?? pad;

  const box = await page.evaluate((sels) => {
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, matched: sel };
      }
    }
    return null;
  }, list);

  if (!box) {
    throw new Error(`screenshotElement: none of the selectors matched: ${list.join(', ')}`);
  }

  let y = Math.max(0, box.y - topPad);
  let height = box.height + topPad + bottomPad;
  if (opts.maxHeight && height > opts.maxHeight) {
    // Keep the element's bottom edge: a context band is read upwards from what changed.
    const bottom = y + height;
    height = opts.maxHeight;
    y = Math.max(0, bottom - height);
  }

  await page.screenshot({
    path: outPath,
    clip: {
      x: Math.max(0, box.x - leftPad),
      y,
      width: box.width + leftPad + rightPad,
      height
    }
  });

  return box.matched;
}

module.exports = { screenshotElement };
