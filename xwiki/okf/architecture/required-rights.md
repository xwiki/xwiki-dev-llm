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
- **`XWiki.WikiMacroClass` was not covered** up to 18.6 — the only analyzer that module ships is for
  `WikiMacroParameterClass`, so a wiki macro was reported as `script` from its body's Velocity while
  `DefaultWikiMacroFactory.isAllowed` demands, **of the macro document's author**, `Right.ADMIN` at
  `EntityType.WIKI` when visibility is *Current Wiki* and `Right.PROGRAM` when it is *Global*.
  Declaring `script` on a wiki-visible macro page left the macro **unregistered**: every page using
  it rendered `Unknown macro: <id>`, with nothing in the analysis to hint at it. Tracked as
  **XWIKI-24822** and expected to be fixed, so **check whether your version has the analyzer before
  overriding its recommendation** — grep the wikimacro-store module's `META-INF/components.txt`.
  It is kept here as the worked example of the general rule, which outlives the specific gap.

So when a page carries an object whose registration is privileged and whose type has no analyzer,
derive the level from what the platform checks at registration, not from what the analyzer reports,
and say in a comment why the two differ.
**A page like this cannot be validated on a running wiki that already has it installed** — macros,
UI extensions, bundles and listeners register on save and at startup, so a re-install over a live
wiki keeps serving the already-registered component. Only a fresh install (a Docker IT) is evidence.

## A page carrying the element must declare XAR document version 1.6

`enforceRequiredRights` was added in XAR document model **1.6** (`XarDocumentModel.VERSION_CURRENT`),
so the page's root element must be `<xwikidoc version="1.6" …>`. **Trap:** the XAR filter maps
elements by name and does not gate parsing on the declared version, so a page left at `1.2` parses,
enforces, and passes `xar:format` and `xar:verify` while claiming a format version that does not
contain the tag it uses. Nothing warns; it has to be got right by hand.

## Enforcement is per-document, and reaches further only through a script save

- Required rights are read for **one** document, the current `sdoc`
  (`DefaultContextualAuthorizationManager#checkPreAccess` → `DefaultDocumentAuthorizationManager`).
  Nothing intersects one page's declaration with another's, so an enforcing page **never caps** what
  a page it `{{include}}`s or a wiki macro it calls may do: both run with their own page as `sdoc`.
  A page enforcing with an empty set can include a page whose Velocity still executes.
- What does reach further is a **script** save: `com.xpn.xwiki.api.Document#save`
  (`checkRequiredRightsForSaving`) forces the saved document to enforce too, capped at the saving
  page's declared rights, when the context author lacks Programming Right. A page creating content
  from a template thus imposes its ceiling on the created page. `XWiki#saveDocument`, which a Java
  component calls, does not — moving a save into a component removes the propagation.
- A **title** written in Velocity is evaluated only when the document's *content author* holds Script
  right on it (`AbstractDocumentTitleDisplayer#displayTitle`), which enforcing with an empty set
  denies: the title is then displayed as raw source.

## Reading the enforced rights back in a test

Assert what the platform will enforce, not the shape of the XML. In a `PageTest`, inject
`DocumentRequiredRightsManager` and declare **nothing** on `@ComponentList`: `MockitoOldcore`
registers a stub delegating to the real `DocumentRequiredRightsReader` (in `PageComponentList`).
Naming `DefaultDocumentRequiredRightsManager` replaces that stub and fails on its missing
`SimpleDocumentCache`. `getRequiredRights(reference)` returns an `Optional<DocumentRequiredRights>`, a record of
`enforce()` plus a set of `DocumentRequiredRight(Right, EntityType)` — so an expectation reads as
`(Right.ADMIN, EntityType.WIKI)` rather than as the string `"wiki_admin"`.

## Related

- [[security]] — the right each scripting language needs, and context-author right checks.
- [[wiki-application-data]] — other traps in a page-and-XClass application's own data.
