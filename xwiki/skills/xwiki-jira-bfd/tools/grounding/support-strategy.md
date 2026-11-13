# XWiki support strategy (grounding)

Source of truth (verify, do not cache the numbers):
https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/

Durable facts:

- XWiki development runs in yearly **cycles** `N.0 → N.10`. At most two **LTS** lines are
  supported: the Cycle LTS `N.10.x` of the last completed cycle and, mid-year, the Intermediate
  LTS `N.4.x` of the in-progress cycle (replaced by that cycle's `N.10.x`).
- Only those LTS lines and the in-progress dev line are actively supported. Every other
  feature line is **EOL** (end-of-life).

Consequence for this campaign (from NEW-BFD-STRATEGY.md):

> For a >5yr bug, "affects-version is EOL" is nearly universal and does **not** discriminate.

So EOL status is necessary context but is **not**, on its own, a valid dead-reason. The real
judgment is the content assessment against `rewrites.md` (mirrored into the judge's state as
`lib/questions.XWIKI_CONTEXT`). How many released lines have shipped since the bug's affected
version strengthens a concrete dead-reason but does not by itself prove one.
