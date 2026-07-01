---
title: Macro reference refactoring and backlinks
stability: durable
summary: The org.xwiki.rendering.macro.MacroRefactoring role (keyed by macro id) lets a macro control
  how its references are rewritten when a page/attachment is renamed or moved, and which references it
  exposes for backlinks. DefaultMacroRefactoring is a content-only fallback that never touches macro
  parameters.
sources:
  - https://rendering.xwiki.org/xwiki/bin/view/Main/ExtendingMacro#HBacklinksandlinksrefactoringinmacros
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-rendering/xwiki-platform-rendering-xwiki/src/main/java/org/xwiki/rendering/macro/MacroRefactoring.java
---

# Macro reference refactoring and backlinks

When a document or attachment is renamed or moved, XWiki updates the references pointing to it. For
references living **inside macros**, this is driven by the `MacroRefactoring` component
(`org.xwiki.rendering.macro.MacroRefactoring`, a `@Role`). It also drives **backlink** creation by
extracting the references a macro uses.

## Keyed by macro id

`MacroRefactoring` is looked up by **hint = the macro id**. To refactor references for macro `foo`,
register a `@Component @Singleton @Named("foo")` implementing `MacroRefactoring` (in
`components.txt`, like any component — see [[component-system]]). This works for both Java macros and
wiki macros: the id is what matters, not how the macro is implemented.

## The methods

- `replaceReference(...)` — overloads for a renamed **`DocumentReference`** and a renamed
  **`AttachmentReference`** (plus `relative`). Each returns `Optional<MacroBlock>`: the updated
  macro block when the reference matched and was rewritten, or `Optional.empty()` when nothing
  changed. A typical implementation reads a reference parameter, resolves it to an absolute entity
  reference, compares it to the source, and on a match clones the block and writes back the
  (compact-)serialized target.
- `extractReferences(MacroBlock)` — returns the `ResourceReference`s the macro uses (in its
  parameters and/or content), so they can become backlinks.

The interface evolves via **default methods** (see [[backward-compatibility]]): the newer overloads
taking a `Map<EntityReference, EntityReference> updatedEntities` are `default` and delegate to the
simpler overloads, so an implementation only overrides what it needs.

## The DefaultMacroRefactoring fallback (content only)

When no macro-specific implementation exists for a macro id, the `default`-hint
`DefaultMacroRefactoring` applies. It only rewrites references found in the macro's **content**
(macros whose content type is wiki/`LIST_BLOCK_TYPE`): it parses the content and refactors the
link/image references inside it. It does **not** look at macro **parameters**.

Consequence: a macro that stores a reference in a **parameter** (e.g. an `{{image reference="…"/}}`
or `{{include reference="…"/}}`) will *not* have that parameter refactored by the default, and must
provide its own `MacroRefactoring` keyed by its macro id to do so.

Since XWiki 13.4.3+/13.7+, links inside wiki-macro **content** are automatically extracted for
backlinks and automatically refactored on rename/move — no custom component needed for that case.

## Where to go deeper

The "Backlinks and links refactoring in macros" section of the Writing-a-Macro tutorial and the
`MacroRefactoring` interface Javadoc (both in `sources:`) are authoritative. Good concrete
implementations to copy: `IncludeMacroRefactoring` (parameter-based) and `DefaultMacroRefactoring`
(content-based) in xwiki-platform.
