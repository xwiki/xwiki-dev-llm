# XWiki support strategy (grounding)

Source of truth (verify, do not cache the numbers):
https://dev.xwiki.org/xwiki/bin/view/Community/SupportStrategy/

Durable facts:

- XWiki development runs in yearly **cycles** `X.0 → X.10`. The final **`X.10`** line of the
  **last completed** cycle is the current **LTS**; the previous cycle's `X.10` typically
  still receives overlap patches for a while.
- Only the current LTS line and the in-progress dev line are actively supported. Every
  older feature line is **EOL** (end-of-life).

Consequence for this campaign (from NEW-BFD-STRATEGY.md):

> For a >5yr bug, "affects-version is EOL" is nearly universal and does **not** discriminate.

So EOL status is necessary context but is **not**, on its own, a valid dead-reason. The real
judgment is the content assessment against `rewrites.md` (mirrored into the judge's state as
`lib/questions.XWIKI_CONTEXT`). How many released lines have shipped since the bug's affected
version strengthens a concrete dead-reason but does not by itself prove one.
