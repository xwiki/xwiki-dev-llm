---
title: Required rights on a page an extension ships (analyzer blind spots, XAR version, reading them back)
stability: durable
summary: Enforcing required rights caps what a page's author may do, so a level that is too low
  silently disables the page's function rather than failing loudly. Holds the three things the UI and
  the docs do not tell you — the analyzer has no analyzer for some privileged objects and
  under-reports them (wiki macros are the live case), a page carrying the element must declare XAR
  document version 1.6, and how to read the enforced rights back in a test. For pages shipped in a
  XAR; the admin-facing mechanism is on xwiki.org.
sources:
  - https://www.xwiki.org/xwiki/bin/view/documentation/xs/admin/rights/required-rights/
  - https://www.xwiki.org/xwiki/bin/view/documentation/xs/admin/rights/required-rights/enforce/
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Include%20Macro
---

# Required rights on a page an extension ships

Enforcing (`<enforceRequiredRights>true</enforceRequiredRights>` plus an `XWiki.RequiredRightClass`
object) does two things: it denies edit to users who lack the declared right, and it denies Script,
wiki Admin and Programming right to the page's content **unless declared**. That second half is a
cap on the *author*, which is why an under-declared level does not fail loudly — the page simply
stops being able to do what it does.

## The analyzer is a recommendation, and it is blind to some privileged objects

XWiki's required-rights analyzer computes what the page's *content* needs. An object whose mere
**registration** is a privileged act needs the right that registration costs, and the analyzer only
knows that for the objects someone wrote an analyzer for. There is one analyzer per object type
(`RequiredRightAnalyzer<BaseObject>`, hinted by class name); an object type with none falls through
to `DefaultObjectRequiredRightAnalyzer`, which reads the object's wiki-content properties and stops.

- Covered: `UIExtensionRequiredRightsAnalyzer` maps a UI extension's `scope` to wiki admin;
  `TranslationDocumentObjectRequiredRightAnalyzer` does the same for a wiki-scoped bundle.
- **Not covered: `XWiki.WikiMacroClass`.** The only analyzer that module ships is for
  `WikiMacroParameterClass`. So a wiki macro is reported as `script` from its body's Velocity, while
  `DefaultWikiMacroFactory.isAllowed` demands, **of the macro document's author**, `Right.ADMIN` at
  `EntityType.WIKI` when visibility is *Current Wiki* and `Right.PROGRAM` when it is *Global*.
  Declaring `script` on a wiki-visible macro page leaves the macro **unregistered**: every page using
  it renders `Unknown macro: <id>`, with nothing in the analysis to hint at it.

So when a page carries an object of a type with no analyzer, derive the level from what the platform
checks at registration, not from what the analyzer reports, and say in a comment why the two differ.
**A page like this cannot be validated on a running wiki that already has it installed** — macros,
UI extensions, bundles and listeners register on save and at startup, so a re-install over a live
wiki keeps serving the already-registered component. Only a fresh install (a Docker IT) is evidence.

## A page carrying the element must declare XAR document version 1.6

`enforceRequiredRights` was added in XAR document model **1.6** (`XarDocumentModel.VERSION_CURRENT`),
so the page's root element must be `<xwikidoc version="1.6" …>`. **Trap:** the XAR filter maps
elements by name and does not gate parsing on the declared version, so a page left at `1.2` parses,
enforces, and passes `xar:format` and `xar:verify` while claiming a format version that does not
contain the tag it uses. Nothing warns; it has to be got right by hand.

## Enforcement reaches further than the page — and less far than it looks

- **Every document an enforcing page's script saves is forced to enforce too**, capped at the rights
  that page declares (`com.xpn.xwiki.api.Document.checkRequiredRightsForSaving`). A page that creates
  content from a template therefore imposes its own ceiling on the created page, so a template whose
  content needs Script right stops working once the creating page enforces less than that.
- It does **not** unconditionally cap an include chain: `{{include}}`'s `author="target"` executes the
  included page's content with that page's own author instead of the including page's.

## Reading the enforced rights back in a test

Assert what the platform will enforce, not the shape of the XML. In a `PageTest`, inject
`DocumentRequiredRightsManager` and `loadPage` the page — **declare nothing on `@ComponentList`**:
`MockitoOldcore` already mocks the manager with a stub that delegates to the real
`DocumentRequiredRightsReader`, which `PageComponentList` already provides. Only the cache is mocked
away, so the assertion still exercises the real object-to-right mapping.

**Trap:** naming `DefaultDocumentRequiredRightsManager` on `@ComponentList` *replaces* that working
mock with the real implementation, which then fails to instantiate — `Can't find descriptor for the
component with type [SimpleDocumentCache]`. Adding `DefaultSimpleDocumentCache` to satisfy it works,
but is three declarations bought to undo the first one.

`getRequiredRights(reference)` returns an `Optional<DocumentRequiredRights>`, a record of `enforce()`
plus a set of `DocumentRequiredRight(Right, EntityType)` — so an expectation reads as
`(Right.ADMIN, EntityType.WIKI)` rather than as the string `"wiki_admin"`.

## Related

- [[security]] — the right each scripting language needs, and context-author right checks.
- [[wiki-application-data]] — other traps in a page-and-XClass application's own data.
