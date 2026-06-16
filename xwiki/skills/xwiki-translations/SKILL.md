---
name: xwiki-translations
description: How to externalize and render translations in XWiki sheets, templates and wiki pages, safely (escaping/security) and correctly for i18n (word order). Use when adding/changing user-facing strings in .xml wiki pages, .vm templates, Translations documents, or *.properties resource bundles.
---

# Writing and rendering XWiki translations

Use this skill whenever you add, change, or externalize user-facing text in XWiki sheets/pages
(`.xml`), templates (`.vm`), `Translations` wiki documents, or JAR resource bundles
(`ApplicationResources*.properties`). It covers both i18n correctness and the security rules that
MUST be followed.

## Where translation values live

- **Wiki documents:** a page holding an `XWiki.TranslationDocumentClass` object (e.g.
  `XYZ.Translations`), `plain/1.0` syntax, body is `key=value` lines. Add keys only to the default
  (English) document; localized variants (`Translations.fr.xml`, …) are produced by translators —
  do not edit them in a feature change.
- **JAR resource bundles:** `src/main/resources/.../ApplicationResources.properties` (+ `_fr`, …).

Reuse an existing key when the exact same text already exists; otherwise add a new key following the
module's prefix convention.

## How to render in Velocity

```velocity
$services.localization.render('some.key')                       ## default syntax: plain/1.0
$services.localization.render('some.key', [$param0, $param1])    ## MessageFormat parameters {0},{1}
$services.localization.render('some.key', 'xhtml/1.0', [$p])     ## render to a specific syntax
$services.localization.render([$dynamicKey, 'fallback.key'])     ## try keys until one is found
```

`MessageFormat` runs **only when parameters are passed**. So a literal apostrophe must be doubled
(`''`) **only** in keys that have `{N}` parameters; keys without parameters keep a single `'`.

In the `{{translation}}` macro form (`{{translation key="some.key"/}}`), execution is isolated (script
macros in the value never run). It supports inline mode, so it can be placed inside markup you build —
including a link label: `[[{{translation key="some.key"/}}>>$target]]`. Translation values must not
contain wiki markup (see below).

## SECURITY — the rules that must be followed

A translation value is, in the end, interpreted as wiki (or HTML) syntax: the string returned by
`$services.localization.render(...)` is re-parsed by the surrounding `{{velocity}}` output. **Treat
every translation value as untrusted**, for two reasons:

- **Privilege escalation.** A translation value can contain script macros (`{{groovy}}`, `{{html}}`,
  `{{velocity}}`, …). Registering a translation that affects other users requires elevated rights
  (`GLOBAL` → Programming Right, `WIKI` → Wiki Admin Right), but a `USER`-scope translation only needs
  **Script right** — and that is still dangerous: a Script-right user can register such a translation,
  and if it is then rendered in a request handled for a user who has Admin or Programming rights, the
  injected macro executes with *those* rights. So Script right becomes a path to Admin/Programming
  right.
- **Broken display.** A translation value may legitimately contain characters that are wiki syntax or
  HTML (`*`, `[[`, `<`, `{{`, …). Unless escaped, they break the rendering of the translation.

### Rule 1 — in a wiki markup context, ALWAYS use the `{{translation}}` macro

In wiki content (sheets, wiki pages, any `.vm`/velocity output that becomes wiki syntax) use the
macro. It is the **safest** (the value is rendered in an isolated context — script macros in it do NOT
execute) and the **most performant** option. It supports inline mode, so it fits labels, headings and
table cells:

```
{{translation key="myapp.section.title"/}}
= {{translation key="myapp.section.title"/}} =
|(% class="label" %){{translation key="myapp.label"/}}(%%)|...
```

Pass parameters by the **name** of the variable holding them, so the macro escapes them for you:

```
{{velocity}}
#set ($txparameters = [$userinput, 42])
{{translation key="myapp.intro" scriptParameters="txparameters"/}}
{{/velocity}}
```

From inside a `{{velocity}}` block, the `#wikiTranslation($key $parameters)` Velocity helper
(17.10.10+, 18.4.1+, 18.5.0RC1+) emits that macro for you and wires up the `scriptParameters`
plumbing — pass `$parameters` as a list, or omit it for a plain key:

```velocity
#wikiTranslation('myapp.section.title')
#wikiTranslation('myapp.intro' [$userinput, 42])
```

Never write `$services.rendering.escape($services.localization.render('myapp.key'), 'xwiki/2.1')` in a
wiki context — use the macro/helper instead (it is safer and more performant).

### Rule 2 — only when the macro can't be used, render + escape for the TARGET syntax

The macro is unavailable only in non-wiki output (HTML attributes, JavaScript, a string compared in
code). There, use `$services.localization.render(...)` and escape for the **actual target**:

```velocity
## HTML context
<a href="...">$escapetool.xml($services.localization.render('myapp.icon.linkText'))</a>
```

Inside wiki markup (including link labels) you stay with the macro — `[[{{translation
key="myapp.linkLabel"/}}>>$target]]` — not `render(...)`.

### Rule 3 — always escape untrusted DATA passed as parameters

Document/object values, request parameters and user input are untrusted. With the macro, pass them via
`scriptParameters` (escaped for you). With `render(...)`, escape them for the target; inside a link
label data is parsed twice, so escape it twice
(`$services.rendering.escape($services.rendering.escape($data, 'xwiki/2.1'), 'xwiki/2.1')`).

### Rule 4 — don't put renderable wiki markup inside a translation value

It will (and should) be escaped, so it won't render. To wrap translated text in a link or other
markup, build the markup in your (trusted) code and put the macro inside it, keeping the label a single
translatable key — e.g. a link is `[[{{translation key="myapp.linkLabel"/}}>>$target]]`.

### Rule 5 — inline links the macro can't produce: fall back to the script service

Neither the `{{translation}}` macro nor `#wikiTranslation` can render a link that sits **in the middle**
of a translated sentence (the macro escapes parameters, so a link passed as a parameter would not
render). For that case only, keep the whole sentence in one key with positional `{0}…{1}` placeholders
for the markup boundaries, build the markup in trusted sheet code, and render with the script service:

```velocity
## value (no markup, just placeholders):  myapp.help=… {0}attach the new version{1} …
$services.localization.render('myapp.help', ['[[', "&gt;&gt;path:$xwiki.getURL($doc.fullName, 'view', 'viewer=attachments')]]"])
```

Escape any untrusted **data** placed inside the markup parameters. Be aware the value is rendered as
syntax here (the markup must reach the parser), so reserve this for the genuine inline-link case.

## Examples (xwiki/2.1 sheet)

```
## Label / heading / message — the translation macro (inline works)
{{translation key="ext.repository.type"/}}
= {{translation key="ext.repository.description"/}} =

## Message with untrusted data — pass data by variable name via scriptParameters (or #wikiTranslation)
{{velocity}}
#set ($params = ["$id $version"])
{{translation key="ext.dependencies.intro" scriptParameters="params"/}}
{{/velocity}}

## Link label — the macro lives inside the link you build
[[{{translation key="ext.attach.linkLabel"/}}>>path:$xwiki.getURL($doc.fullName, 'view', 'viewer=attachments')]]

## Inline link the macro can't produce — script service with markup-boundary params (Rule 5)
$services.localization.render('ext.attach.help', ['[[', "&gt;&gt;path:$xwiki.getURL($doc.fullName, 'view', 'viewer=attachments')]]"])

## HTML context inside {{html}} — escape with escapetool.xml
<a href="...">$escapetool.xml($services.localization.render('ext.icon.linkText'))</a>
```

## Page tests (`@since` PageTest)

`LocalizationSetup` mocks the localization service and the translation bundle, so `{{translation
key="x"/}}` and `render(key)` both render the key `x` (not the real value), and `render(key, [p])`
renders `key [p0, p1]`. Add `TranslationMacro.class` to the test `@ComponentList` (and the
`xwiki-platform-localization-macro` test dependency) when the sheet uses the macro. When a test must
verify a rendered link or its escaping, build the link markup in the **sheet** (so the test can see
it), not inside the translation value.

**`scriptParameters` gotcha:** `{{translation … scriptParameters="var"/}}` goes through
`ScriptMacroTools.getScriptValue`, which requires the current author to have **SCRIPT right** and reads
the variable from the script context. In a `PageTest` this is not set up by default, so the parameters
come back empty and the rendered message loses them. If a data-bearing translation must stay testable
with the standard page-test harness, render it with `$services.localization.render('key', [escaped
data])` (the documented fallback) rather than the macro.

## After editing

- Build the module and confirm the XAR `verify` passes (well-formed pages) and checkstyle is clean.
- Verify on a running XWiki: labels/headings render, links work, and switching the UI language falls
  back to English (no raw `some.key` shown), proving the text goes through localization.

## References

- Localization scripting: https://extensions.xwiki.org/xwiki/bin/view/Extension/Localization/Scripting/
- Security best practices: https://www.xwiki.org/xwiki/bin/view/Documentation/DevGuide/Security/
- L10N conventions: https://dev.xwiki.org/xwiki/bin/view/Community/L10N/Conventions/
- Mass-escaping effort / rationale: XWIKI-19749
