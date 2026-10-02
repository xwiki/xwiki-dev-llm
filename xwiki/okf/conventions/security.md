---
title: Secure-coding conventions (escaping, untrusted input, right checks)
stability: durable
summary: How to escape user input and other untrusted values for each output context, why
  translation values are untrusted, which right each scripting language requires, the context-author
  and pass-the-entity right-check rules and saving as author in script services, displaying rather
  than parsing XObject properties, safe XML parsing, and never interpolating identifiers or
  references into queries and include/display targets.
sources:
  - https://www.xwiki.org/xwiki/bin/view/Documentation/DevGuide/Security/
  - https://www.xwiki.org/xwiki/bin/view/Documentation/DevGuide/Scripting/
---

# Secure-coding conventions

The Security Dev Guide is the source of truth and evolves — fetch it when in doubt. This file holds
the durable rules a developer must apply when writing scripts, Velocity templates, wiki pages and
script services.

## Everything from a user — and every translation — is untrusted

Any value an attacker can influence can carry an injection. Unescaped output leads either to **XSS**
(in an HTML context) or to **XWiki-syntax injection** (when the output is re-parsed, e.g. a Velocity
macro with parsing enabled). XWiki-syntax injection almost always lets an attacker execute macros
with the script author's rights — frequently Programming Right — i.e. arbitrary code execution. The
location of the injection does not matter: by including the closing syntax, user input can break out
of a parameter, an HTML macro, or a verbatim block. Nested-script-macro protection is **not** a
defence (it is bypassable, e.g. inside an async macro).

**Translation values are untrusted too.** A translation can contain `{{groovy}}`, `{{html}}`, etc.
A USER-scope translation needs only Script Right to register, but if it is later rendered in a
request handled for a user with Admin/Programming Right, the injected macro runs with *those* rights
— turning Script Right into a path to Admin/Programming Right. Always escape translation values for
the syntax of the context they are inserted into. (See the `xwiki-translations` skill for the
word-order and escaping mechanics.)

## Escaping mechanisms — pick the one matching the output context

- **HTML output:** `$escapetool.xml($content)`. Also escapes `{`, so it prevents closing an HTML
  macro through user input. Sufficient for text that is simply displayed.
- **HTML attribute:** `$escapetool.xml`, **not** `$escapetool.html`, which leaves the single quote.
- **XWiki syntax:** `$services.rendering.escape($content, 'xwiki/2.1')`.
- **JavaScript string:** `$escapetool.javascript` (or `$escapetool.json` for a JSON value) —
  `$escapetool.xml` leaves the backslash. No tool supports a JS **template literal**: never insert a
  value into one.
- **Query:** never `$escapetool.sql` — bind the value (see *Structural interpolation* below).
- **Velocity:** never `#evaluate` a value a user can control — no escaping makes it safe.
- **HTML attributes with special meaning** (e.g. a link/button `href`/`target`): escaping alone is
  **not** enough — a fully escaped value can still be a `javascript:` URL that runs on click. Use
  `$services.html.isAttributeSafe($htmlElement, $attributeName, $attributeValue)` to check the value
  against the HTML-cleaning configuration (it rejects script URLs). In XWiki syntax all attributes
  are validated automatically; in HTML macros (with script right) and Velocity templates they are
  **not**, so you must check them yourself.

Always test that the escaping actually protects (try to break out of the context you escaped for).

## Structural interpolation — bind covers values, never identifiers or references

Escaping and `bindValue` protect the *data* in a query and the *value* of a reference. They do
nothing for the *structural* parts, which are a separate, easy-to-miss injection class:

- **Query strings.** Bind every value with a `:named` parameter — never concatenate one in. But the
  parts a parameter cannot stand in for — the class/space/page identifiers in an XWQL/HQL `from`,
  `doc.object(...)`, `where doc.space = …`, an `order by` column — have no escaper and must be
  **literal constants in the source**. `"from doc.object(${space}.Code.EntryClass)"` is an injection
  even when every value in the same query is bound: whoever controls `$space` controls the query, and
  it runs with the script author's rights, unfiltered by document view rights.
- **Entity references.** The `reference` of `{{include}}` / `{{display}}`, and any class reference
  passed to `getObject` / `newObject` / `getDocument`, choose *which* document is read or executed.
  Built from a variable, they let whoever controls it redirect the choice; write the reference
  literally. (`{{include}}` itself still checks the *current user's* view right on the target, so it
  will not show a page the viewer cannot see — but the script-execution author and the query case
  above are not gated that way.)

If a variable genuinely must sit in a structural slot, it has to be **proven trusted at that point** —
pinned to an allow-list or a strict `matches('[a-zA-Z0-9_-]+')`-style guard with a safe fallback,
never merely "it holds a safe value today".

**Know which document a `$doc`-derived value is.** `$xcontext.macro.doc` (and `$wikimacro.doc`) is
the page where the macro is *defined* — trusted, the install location; `$doc` is the page being
*rendered*, i.e. whatever page invoked the macro, so caller-chosen. A structural slot fed from `$doc`
is fed by the caller; one fed from the macro's own document is not. Neither replaces writing the
identifier literally.

## Only Velocity runs on Script Right — every other language also needs Programming Right

Writing any script requires **Script Right**; every scripting language **other than Velocity**
(Groovy, Python, Ruby…) *additionally* requires **Programming Right** of the script author. The one
exception is Groovy with the Secure Groovy Customizer enabled (`groovy.compilationCustomizers`,
empty and therefore off by default), where Script Right suffices and the customizer sandboxes the
code instead.

The trap: a **script service is callable with Script Right alone**, so putting an operation there
exposes it behind a *lower* bar than a Groovy macro — which is why the context-author checks below
matter, and why "the caller could have written Groovy anyway" is never a valid justification.

## Right checks in script services — check the context *author*, not only the user

Code exposed as a script service must check the rights of the context **author** (who wrote the
script) in addition to the context **user** (who triggers it). The practical way is to check Script
or Programming Right with a *contextual* authorization manager (it accounts for dropped permissions).
Every right check done for the context user should be duplicated for the context author, so a script
cannot perform a dangerous action (or disclose sensitive data) simply because a higher-privileged
user accessed the document — this prevents CSRF-style escalation. If permissions have been dropped,
the author cannot be trusted: do nothing dangerous and disclose nothing sensitive. A service that
acts or discloses without further checks must require **Programming Right** of the context author.

**Always pass the entity** — the defaults answer a different question than they seem to:

- `hasAccess(Right.ADMIN)` with no entity (also `$xwiki.hasAdminRights()`, `$hasAdmin`) checks the
  *current document*, so a mere **space** admin passes. For wiki admin pass the wiki —
  `hasAccess(Right.ADMIN, new WikiReference(wikiId))` — or use `$xwiki.hasWikiAdminRights()`.
- For Script and Programming Right the entity decides *whose* rights: `hasAccess(Right.SCRIPT,
  reference)` checks the content author of the document at `reference`, not the running script's
  author. No entity checks the running script's author; for a given user on a given entity use
  `AuthorizationManager#hasAccess(right, user, entity)`.

**Programming Right exists only on the main wiki**: a subwiki admin has Script Right, never
Programming Right. Do not require it for what subwiki admins must be able to do; do require it for
what they must not.

**Saving a document.** A script service — or any API a script can call — must never save with the
*current user* as author when the calling script's author lacks Programming Right: a script that a
more privileged user merely views would store content in their name, which then runs with their
rights. `Document#save()` already falls back to the script's author in that case — reuse it or apply
the same check.

**Serializing an author.** The `document` `UserReferenceSerializer<DocumentReference>` resolves a
`null` user reference to the **current user**, so passing an author that may be missing makes it
whoever the code runs for. Check for `null` (and for `GuestUserReference.INSTANCE`, which it
serializes to `null`) before calling it, and use a `null` `DocumentReference`, i.e. guest, for both.

## Rendering an XObject property — display it, never parse its raw value

`$doc.display('property', $object)` runs the property with the rights of its document's effective
metadata author. `$object.getValue('property')` inserted into content that is parsed as XWiki syntax
or evaluated as Velocity runs it with the rights of the *rendering* page's author instead. Despite its
name, `$object.get('property')` returns the **displayed** property: read or compare the value with
`getValue`.

## Parsing XML — use the XML Module helpers

Never create a parser (`XMLInputFactory`, `DocumentBuilderFactory`, `SAXParserFactory`, …) yourself:
use `StAXUtils.getXMLStreamReader(...)` or `XMLUtils.parse(...)` (xwiki-commons-xml), already
configured not to load external DTDs and entities. An own parser must disable DTDs and external
entities explicitly — `XMLConstants.FEATURE_SECURE_PROCESSING` is not enough with every
implementation.

## HTML cleaning is not escaping; sanitization is configurable

**The HTML macro's cleaning (`clean="true"`, the default) is not escaping.** When the content author
has Script Right — always the case for HTML a Velocity script produces — cleaning only makes the HTML
valid; it keeps scripts and event handlers. Escape every inserted value, even inside `{{html}}`.

The HTML element/attribute sanitizer (in `xwiki-commons-xml`) backs the cleaning configuration. Its
allow-lists, forbidden tags/attributes, allowed-URI regexp and per-element attribute restrictions
(e.g. `name` restricted to `a`/`map` to mitigate DOM clobbering) are configured via
`xml.htmlElementSanitizer.*` properties. Widening an allow-list is a deliberate admin choice; the
secure defaults must not be weakened in code.

## Related

- [[security-policy]] — severity scoring (CVSS 4) and the non-public-disclosure rule for security fixes.
- [[code-comments]] — never put a live vulnerability description in a code comment.
