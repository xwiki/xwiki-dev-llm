---
title: Server-side rendering conventions (Velocity in wiki pages, sheets and templates)
stability: durable
summary: Rules for code that runs on the server inside a wiki page, sheet or template and produces
  wiki syntax or HTML. Blocks in generated wiki syntax are separated by blank lines, which Velocity's
  space gobbling and the document display API silently remove.
sources:
  - https://www.xwiki.org/xwiki/bin/view/Documentation/UserGuide/Features/XWikiSyntax/
  - https://velocity.apache.org/engine/2.3/user-guide.html
---

# Server-side rendering in wiki pages

## Blocks in generated wiki syntax are separated by blank lines

Two things eat those blank lines without a word:

- Velocity (XWiki sets `bc` space gobbling) drops the newline ending a line that **ends with a
  directive** or a macro call, so `$doc.display(…)#if ($x)$y#end` emits no line break at all. Close
  such a line with a reference, computing the conditional part into a variable beforehand.
- `$doc.display('field', 'view', $object)` on a wiki TextArea returns the rendered field as a
  **single-line** `{{html clean="false" wiki="false"}}…{{/html}}` carrying no trailing newline, unlike
  the raw property value it replaces, which was multi-line.

A missing separator nests a paragraph inside another — invisible until the HTML is read — and makes a
standalone-only macro such as `{{gallery}}` fail with *"is a standalone macro and it cannot be used
inline"*. Only rendering the page catches either: a page test asserting the element it is about passes
whichever way the blocks came out.

## Only a line ending with content needs a closing `##`

Conversely, as the `indent` filter strips indentation, inline output split across lines needs `##`
only on lines ending with text or a reference.

Related, in their own layers: escaping a value before it reaches generated syntax is [[security]];
the accessibility of the markup a page emits, and the colour-theme variables an SSX can read, are
[[frontend]].
