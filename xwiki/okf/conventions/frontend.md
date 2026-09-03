---
title: Front-end conventions (JavaScript, HTML/CSS, accessibility)
stability: durable
summary: JavaScript must be AMD/RequireJS modules prefixed xwiki-, shipped as WebJars or JSX, never
  inline; server-side scripting must not be mixed into minified JavaScript; deprecated JavaScript APIs
  live in compatibility.js; CSS ships as a Skin Extension, LESS-typed to read colour-theme variables;
  XWiki commits to WCAG 2.2 level AA.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HFrontendDevelopmentPractices
  - https://www.xwiki.org/xwiki/bin/view/Documentation/DevGuide/Tutorials/SkinExtensionsTutorial/
---

# Front-end conventions

## JavaScript modules

- Write JavaScript as **AMD modules loaded by RequireJS**, with the module name prefixed `xwiki-`
  (e.g. `define('xwiki-diff', ['jquery', 'xwiki-events-bridge'], …)`) so it cannot clash with an
  external module.
- Store/load modules from a **WebJar** installable by the Extension Manager, a **JSX** (JavaScript
  Skin Extension, usually packaged in a XAR), or the skin via `$xwiki.getSkinFile(…)`. External
  JavaScript libraries are integrated **only** through WebJars.
- Inject the entry-point module either with `$xwiki.jsx.use(…)` server-side or by declaring it a
  dependency of another module. Set a JSX to **"On demand only"**, not "On this wiki".
- **No inline `<script>` and no inline handlers** (`onclick`, …): they break event handling and are
  often WCAG-invalid.
- Localize through the dedicated i18n module and its loader (see the `xwiki-translations` skill).
- Enable strict mode. Rewrite Prototype.js code to jQuery or plain JavaScript, and when touching
  non-AMD code convert it to AMD instead of mixing both styles in one file.
- Check the supported-browser list (plus MDN / caniuse) before using a newer API or syntax; the
  minifier may or may not down-level it.
- JavaScript modules should have unit-like automated tests, and pass the jsHint/ESLint limits, which
  mirror the Java ones: **max line length 120**, max 5 parameters, max depth 3, max 20 statements,
  max complexity 10, camelCase.

## Never mix server-side scripting into JavaScript

Especially in a WebJar: the Velocity is evaluated long after the JavaScript was minified, and the
minifier can rewrite the code in a way that breaks the embedded scripts. When it cannot be avoided,
separate the two halves with the documented wrapper:

```js
/*!
## Velocity code here.
#set ($paths = ...)
#[[*/
(function(paths, l10n) {
  "use strict";
  require(...);
}).apply(']]#', $jsontool.serialize([$paths, $l10n]));
```

## JavaScript backward compatibility

Applications built on XWiki use its JavaScript APIs, so a JavaScript object/method is deprecated with
the same care as a Java API: keep the old name working from **`compatibility.js`** (in the `xwiki`
folder of the skin resources), wrapping it so a call logs a deprecation warning naming the
replacement and the version. Before deprecating, check the old API is no longer used anywhere in the
XWiki Standard distribution — **XWiki Standard must keep working with `compatibility.js` absent**.

## HTML, CSS, accessibility

- HTML and CSS follow the HTML & CSS code style on the dev wiki; icons come from the XWiki icon set
  ([[naming]]).
- Ship CSS as a **Skin Extension** (`XWiki.StyleSheetExtension`, "On demand only", injected with
  `$xwiki.ssx.use(…)`) — the CSS counterpart of a JSX. To style from the colour theme, set the SSX's
  `contentType` to **LESS** and use the theme's LESS variables (`@xwiki-border-color`,
  `@xwiki-page-content-bg`, `@border-radius-base`, `@gray-lighter`, …). `$theme` is *not* bound in
  wiki-page Velocity, a Velocity-parsed (`parse=1`) SSX included, so reaching for it there fails
  silently: the stylesheet compiles and emits only whatever fallbacks were written around it.
- XWiki has committed to **WCAG 2.2 at level AA**. All features, new ones especially, must comply;
  the Accessibility Statement on xwiki.org tracks the current state.
- Three traps specific to markup emitted from a **wiki page or sheet** (whose rendering side is
  [[server-side-rendering]]):
  - A control inside `{{html}}` needs a programmatically associated name — a `<label for>` bound to
    the generated field id. A definition-list term (the `; label` / `: $doc.display(…)` idiom) is not
    one, and neither is prompt text put in the input's `value`: that also *submits* as data when the
    field is untouched, so use `placeholder`.
  - `[[image:…]]` takes its alt text from the attachment filename unless given one. Pass
    `||alt="…"`, and `alt=""` for an image that is decorative or a layout placeholder.
  - `col-xs-*` never stacks, so it is not a responsive layout, and a fixed pixel width on media in
    page content breaks SC 1.4.10 Reflow at 320px. Cap media with `max-width: 100%`.
