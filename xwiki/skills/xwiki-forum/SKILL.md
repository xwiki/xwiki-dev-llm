---
name: xwiki-forum
description: Draft, post or edit a topic or reply on forum.xwiki.org — brainstorming, proposal, vote, vote result. Load it when you start drafting, not only when posting. To only search or read the forum, use the discourse MCP directly; to close a developer's own topics in their daily sweep, use xwiki-daily-close.
---

The forum is reached through the plugin's `discourse` MCP. Its write tools exist only when a forum
credential is set (see `okf/servers/index.md`); without one, give the developer the draft to paste.

## Category, tag and title

- **Category**: `Development` (id 13) for anything about developing XWiki or an extension, `Cristal`
  (id 18) for Cristal, `Help / Discuss` (id 8) for questions about *using* XWiki, scripting included.
- **Tag** — every topic that asks the developers for something carries the tag naming what:
  - `brainstorming` — an open question or idea, no decision asked yet;
  - `proposal` — a concrete change put up for the developers' agreement;
  - `vote` — a formal decision. Its rules (who votes, minimum duration, veto, posting the result)
    are on [Committership](https://dev.xwiki.org/xwiki/bin/view/Community/Committership#HVoting):
    read them there before drafting a vote rather than recalling them.
- **Title**: the subject alone. **Never a type prefix** (`[Brainstorming]`, `Proposal:`, `[VOTE]`):
  the tag already says it. Pass the tag in the tool's `tags` parameter.

## Body

- **Short**: the idea, why, what could go wrong, the options — bullets over paragraphs. End with the
  question you want answered (`WDYT?`).
- A vote states what is voted and when it closes.
- Nothing about an undisclosed vulnerability, ever: `okf/processes/security-policy.md`.

## Confirm, then post

It posts under the developer's account. Before any create or edit call, show these fields
**separately**, so a missing tag or a prefixed title is visible at a glance:

```
Category: Development
Tags:     brainstorming
Title:    Committing an AGENTS.md in our repos
Body:     <the full text>
```

Post only after an explicit yes, with exactly the approved fields, then give the topic URL. To fix
a topic already posted, `discourse_update_topic` changes its title, tags and category.
