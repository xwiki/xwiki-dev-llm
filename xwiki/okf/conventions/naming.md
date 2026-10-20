---
title: Naming conventions (Maven, npm, configuration properties, UIXPs, skins, icons)
stability: durable
summary: How XWiki names Maven groupIds/artifactIds and their qualifiers (and the directories that
  mirror them), npm packages, xwiki.properties configuration properties, UI Extension Points and
  Extensions, skins (bird names) and icons.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices
---

# Naming conventions

## Maven coordinates, directories, Java packages

- **groupId** — `org.xwiki.<short project name>`: `org.xwiki.commons`, `org.xwiki.rendering`,
  `org.xwiki.platform`. A top-level extension with its own repo uses `org.xwiki.<short project name>`
  too; xwiki-contrib extensions use `org.xwiki.contrib`.
- **artifactId** — `xwiki-<short project name>-<module name>-<qualifiers>`, e.g.
  `xwiki-platform-watchlist-ui`.
- **Directory name = the artifactId** (this is why paths get long on Windows).
- **Singular form** in artifactIds and directories: `xwiki-platform-flamingo-theme`, *not* `-themes`;
  children reuse the parent's prefix (`xwiki-platform-flamingo-theme-test`).
- **Java package** follows the groupId: `org.xwiki.<short project name>`.
- **Two display names per pom**: `<name>` is `<Project> - <Module>`, the parent's included
  (`Prism.js - Parent POM`), so the reactor listing aligns; the `xwiki.extension.name` property is the
  Extension Manager and extensions.xwiki.org name (`Prism.js Macro`), the parent's naming the Project
  page. It is inherited: set it in the parent pom and override it in every extension module.

Qualifier meanings:

| Qualifier | Module contains |
|---|---|
| `-api` | the module's API |
| `-ui` | wiki pages, i.e. produces a XAR |
| `-webjar` | the final JavaScript bundle of one business domain — not meant to be imported by other modules (e.g. `xwiki-platform-livedata-webjar`) |
| `-node-*` | code from `xwiki-platform-node` published as a public npm package, so an app reuses it instead of the browser loading it twice |
| `-test` | the functional-test parent pom |
| `-test-pageobjects` | the Page Objects |
| `-test-tests` | non-docker functional tests |
| `-test-docker` | docker-based functional tests |

## npm packages

- **Private** (the default): `name` = the parent Maven module, `version` = `0.0.0`, `private` = `true`.
- **Public** (only under `xwiki-platform-node`): `name` = `@xwiki/platform-<business domain>-<qualifiers>`
  (same logic as artifactIds), `version` = the parent module's version (updated automatically at
  release time), and no `private` field.

## Configuration properties

- New properties go in **`xwiki.properties`**. `xwiki.cfg` serves the old core only and takes no new
  property.
- Pattern: `<module>.<propertyName>` (e.g. `rendering.linkLabelFormat`), or
  `<module>.<submodule>.<propertyName>` (e.g. `rendering.macro.velocity.filter`), with the property
  name itself in camelCase. `xwiki.properties` contains older properties that break this rule — do
  not take them as precedent.

## UI Extension Points (UIXP) and UI Extensions (UIX)

- **UIXP id** — `<groupId>.<moduleName>.<uixpQualifier>`, where groupId and module are lower-case and
  dot-separated (reusing the Maven ones where the UIXP is declared) and the qualifier is a single
  camelCase identifier. Example: `org.xwiki.platform.user.profile.menu`.
- **UIX id** — the UIXP it contributes to, optionally suffixed `.<uixQualifier>`, used only to
  disambiguate (UIX declared in the same module as the UIXP, or several UIXs in one module). Example:
  `org.xwiki.platform.user.profile.menu.userMembership`.

## Skins and icons

- Official XWiki skins are named after **birds** (Colibri, Flamingo, …). Any new skin must use a bird
  name; propose it on the forum.
- Icons used in content must come from the **XWiki icon set**; new icons follow the icon naming
  conventions on the dev wiki.
