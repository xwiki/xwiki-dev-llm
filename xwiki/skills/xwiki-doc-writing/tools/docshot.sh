#!/bin/bash
# docshot.sh <out-name> <target-width> <VIEWPORT|capture-selector|x,y,w,h> [box-selector]
#
# Captures a documentation screenshot from a running `agent-browser` session, draws the red box the
# Documentation Guide requires, and delivers exactly <target-width> px (960 = `extra`, 650 = `large`,
# 350 = `medium`, 150 = `small` — `size` is mandatory in the `documentation` space, so the capture
# width is what decides sharpness).
#
#   AB_SESSION=doc SHOTS=shots ./docshot.sh applications-panel 650 0,0,650,300 '.panel li.selected'
#   AB_SESSION=doc SHOTS=shots ./docshot.sh find-button 960 239,60,960,282 'input[value="Find"]'
#
# Set the viewport before calling, at devicePixelRatio 1, wide enough that the region is not against
# an edge:  agent-browser --session doc set viewport 1440 900 1
#
# The third argument says WHAT to capture, and `x,y,w,h` (viewport pixels) is the one to reach for:
# a step's screenshot shows the element plus the nearest landmark that locates it, which is almost
# never a whole window nor a single element (see okf/conventions/documentation.md). Give the region
# the target width and it is saved unresampled — a wider region is downscaled, and a narrower one is
# refused rather than upscaled into blur. There is no `--clip` in the CLI and macOS `sips -c` crops
# from the centre, so the region is captured by screenshotting a transparent clip element.
#
# The box clears the element it marks by an equal margin on all four sides, so it reads as centred on
# it and never touches the content. That margin is GAP px (default 6), and it is worth overriding for
# a target whose own box already carries the clearance: a row of a densely stacked list — a panel
# entry, a menu item — is a line box whose leading holds the glyphs well inside it, and adding to
# that puts the border through the row above and below, which touch it. GAP=0 there.
#
#   AB_SESSION=doc SHOTS=shots GAP=0 ./docshot.sh applications-panel 650 0,0,650,300 '.panel a.entry'
#
# The box is an overlay appended to <body>, NOT a CSS outline on the target: an outline (and a
# box-shadow) is clipped by any ancestor with `overflow: hidden` — XWiki's `.xwikipanelcontents` is
# one — which silently yields a box missing an edge. Body-level positioning escapes that. The script
# then fails rather than shooting if a box falls outside what is being captured, since the capture
# itself would cut it. A selector matching several elements gets one box each; prefix it with
# `union:` for a single box around them all (a list of links, say).
# The script then runs `checkredbox.py` on the shot itself, proving the saved PNG holds a closed
# rectangle, so a capture reports its own verdict and there is never a reason to open the PNG to
# find out whether it worked. CHECK=0 skips that.
set -e

SESSION="${AB_SESSION:-doc}"
GAP="${GAP:-6}"
DIR="${SHOTS:-shots}"
mkdir -p "$DIR"
OUT="$DIR/$1.png"
WIDTH="$2"
CAPTURE="$3"
BOX="$4"

REGION=""
if [[ "$CAPTURE" =~ ^[0-9]+,[0-9]+,[0-9]+,[0-9]+$ ]]; then
  REGION="$CAPTURE"
  IFS=, read -r RX RY RW RH <<< "$REGION"
  if [ "$RW" -lt "$WIDTH" ]; then
    echo "region is ${RW}px wide but the target is ${WIDTH}px — widen the region or pick a smaller \`size\`" >&2
    exit 1
  fi
else
  RX=0; RY=0; RW=0; RH=0
fi

UNION=0
case "$BOX" in
  union:*) UNION=1; BOX="${BOX#union:}" ;;
esac

# One pass: clear the previous overlays, draw the box, then add the clip element the region is
# captured through. The box has to exist before the screenshot; the clip element is removed after it.
agent-browser --session "$SESSION" eval --stdin >/dev/null <<JS
(() => {
  document.querySelectorAll('[data-doc-box],[data-doc-clip]').forEach(e => e.remove());
  const region = '$REGION' ? {left: $RX, top: $RY, right: $RX + $RW, bottom: $RY + $RH}
                           : {left: 0, top: 0, right: innerWidth, bottom: innerHeight};
  // The box clears the element by GAP on all four sides. boxSizing is set rather than assumed:
  // under the border-box that Bootstrap applies to every element, the width below is the outer
  // width, and geometry written for content-box would sit half a border off-centre — a gap on the
  // left and top and the border painted over the content on the right and bottom.
  const GAP = $GAP, BORDER = 3, OFF = GAP + BORDER;
  const draw = r => {
    const box = document.createElement('div');
    box.setAttribute('data-doc-box', '1');
    Object.assign(box.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      left: (r.left + scrollX - OFF) + 'px',
      top: (r.top + scrollY - OFF) + 'px',
      width: (r.right - r.left + 2 * OFF) + 'px',
      height: (r.bottom - r.top + 2 * OFF) + 'px',
      border: BORDER + 'px solid rgb(255, 0, 0)',
      borderRadius: '2px',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    document.body.appendChild(box);
    const b = box.getBoundingClientRect();
    return (b.left < region.left || b.top < region.top || b.right > region.right
      || b.bottom > region.bottom) ? 1 : 0;
  };
  let clipped = 0;
  if ('$BOX') {
    const els = [...document.querySelectorAll('$BOX')];
    if (!els.length) throw new Error('box selector matched nothing: $BOX');
    const rs = els.map(e => e.getBoundingClientRect());
    if ($UNION) {
      clipped += draw({
        left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)),
        right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)),
      });
    } else {
      rs.forEach(r => { clipped += draw(r); });
    }
    if (clipped) {
      throw new Error(clipped + ' box(es) fall outside the captured area — enlarge it or scroll');
    }
  }
  if ('$REGION') {
    const clip = document.createElement('div');
    clip.setAttribute('data-doc-clip', '1');
    Object.assign(clip.style, {
      position: 'absolute', left: ($RX + scrollX) + 'px', top: ($RY + scrollY) + 'px',
      width: '${RW}px', height: '${RH}px', pointerEvents: 'none', zIndex: '2147483647',
    });
    document.body.appendChild(clip);
  }
  return 'ok';
})()
JS

if [ -n "$REGION" ]; then
  agent-browser --session "$SESSION" screenshot '[data-doc-clip]' "$OUT" >/dev/null
  agent-browser --session "$SESSION" \
    eval "document.querySelectorAll('[data-doc-clip]').forEach(e => e.remove()); 'ok'" >/dev/null
elif [ "$CAPTURE" = "VIEWPORT" ]; then
  agent-browser --session "$SESSION" screenshot "$OUT" >/dev/null
else
  agent-browser --session "$SESSION" screenshot "$CAPTURE" "$OUT" >/dev/null
fi

# `sips` ships with macOS; there is no PIL or ImageMagick to assume. A region given at the target
# width is already there, and resampling it would only soften it.
if [ "$RW" != "$WIDTH" ]; then
  sips --resampleWidth "$WIDTH" "$OUT" >/dev/null
fi
sips -g pixelWidth -g pixelHeight "$OUT" | tr '\n' ' '
echo "-> $OUT"

# Check the box here rather than leaving it to the caller. Whether the box survived the capture is a
# mechanical question, and the alternative — opening the PNG to judge it — costs a turn per attempt
# and leaves a full-size image in context for the rest of the session, which is what turns a
# screenshot into a shoot/look/adjust loop. `CHECK=0` skips it (a shot with no box has nothing to
# prove, and is skipped automatically).
if [ -n "$BOX" ] && [ "${CHECK:-1}" != "0" ]; then
  SHOTS="$DIR" AB_SESSION="$SESSION" python3 "$(dirname "$0")/checkredbox.py" "$1"
fi
