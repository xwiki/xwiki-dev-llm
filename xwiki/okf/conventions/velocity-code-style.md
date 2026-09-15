---
title: Velocity code style
stability: durable
summary: Formatting, naming, the $discard idiom for unused return values, macro parameter rules and
  comment rules for Velocity in templates, skin resources and wiki pages.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/VelocityCodeStyle
---

# Velocity code style

Applies to `.vm` templates, skin resources and Velocity inside wiki pages. The 120-character limit
and the `##` license header come from [[code-style]].

## Capture unused return values in `$discard`

```velocity
#set ($discard = $response.setStatus(405))
```

A bare `$obj.method()` whose result is not meant to be rendered leaks the return value, or an empty
line, into the output. `$discard` is reserved for this: never read it or reuse the name, since the
next such call overwrites it.

## Formatting

- **2 spaces** per indentation level; `=` surrounded by spaces; macro arguments comma-separated.
- **A space between a directive name and its `(`** — `#set (`, `#if (`, `#foreach (` — but **not**
  for a macro call: `#myMacro($var)`. The trap is that several XWiki builtins are macros, not
  directives, so they take no space: `#template('startpage.vm')`, `#error(…)`.

## Naming and references

- **camelCase** for variable and macro names.
- **Single quotes** for strings needing no interpolation — Velocity then skips parsing them.
- Shorthand `$variable`; the formal `${variable}` only where required for correct parsing.
- **Since 15.10RC1**, a macro not intended as an API is prefixed with an underscore, and an API macro
  documents its parameters and its since version. Macros predating 15.10 count as APIs by default and
  can only be renamed after a vote.

## A macro declares the variables it writes

A macro that modifies an existing variable, or returns a value through a new one, takes that variable
as a **parameter** — otherwise the call site cannot see what the macro changes.

## Comments

- Start with an uppercase letter; a full sentence ends with a dot.
- A multi-line comment is **several `##` lines**, never `#* … *#`.
- A larger script opens with a `##` block saying what the code does.
- The generic [[code-comments]] policy applies here too.

## Related — the Velocity rules that live in another topic

- [[server-side-rendering]] — space gobbling, and the blank lines that separate generated blocks.
- [[script-services]] — calling a script service: `#try()` rather than a `getLastError()` check.
- [[translations]] — rendering a translation, and escaping its parameters.
- [[security]] — escaping a value before it reaches the output.
- [[frontend]] — Velocity mixed into JavaScript, and the minifier trap.
- [[code-style]] — the Java and build-level equivalent.
