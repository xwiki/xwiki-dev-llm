---
title: Script service conventions (package, errors, arguments)
stability: durable
summary: A script service is API in a non-internal `script` package; a new one throws (callers use
  #try()), an existing signature never changes, and it needs no bean-factory methods.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle/JavaCodeStyle/
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Script%20Module/#HBestPractices
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Velocity%20Module
provenance: official
last-confirmed: 2026-09-15
related: [conventions/security.md, conventions/backward-compatibility.md, conventions/velocity-code-style.md, conventions/server-side-rendering.md]
applies-to: ["**/*ScriptService.java"]
---

# Script service conventions

## Package: `script`, never `internal`

A script service is **API**: it goes in a non-internal `org.xwiki.<module>.script` package, so Revapi
checks it and it is in the Javadoc. The build fails on one in an `internal` package unless its name
ends with `InternalScriptService`. The rule is about the package, not the Maven module: it may sit in
an `-api`, `-script` or `-default` module.

## Errors: throw, do not stash

A **new** script service method **throws**, rather than returning `null` with an error read back via
`getLastError()` (the pre-`#try()` convention). Callers that care use `#try()`; others do nothing, the
Macro Transformation or the template displays the exception.

```velocity
#try('creationException')
  #set ($discard = $services.myapp.create($thing))
#end
#if ($creationException)
  {{error}}...{{/error}}
#end
```

`#try()` exists since 6.3M1; naming the variable holding the exception — `#try("myexception")`,
default `$exception` — since 8.3M2, 7.4.5 and 8.1.2. The `$discard` above is the Velocity idiom for a
return value that must not reach the output ([[velocity-code-style]]).

**Existing** script APIs keep their signature: changing a method that returns `null` into one that
throws breaks backward compatibility. Add a new signature, deprecate the old one and move it to
legacy — see [[backward-compatibility]]. This is also why the `S2447` Sonar rule is dropped rather
than fixed on an existing service (`kb/sonarqube/index.md`).

## Arguments: no bean factories

Velocity does not need a `createFooObject()` method on the service to build a parameter. When the
passed arguments do not match a signature, the **Method Arguments Uberspector** converts them with
the Properties module, so registering a `Converter<Foo>` (extend `AbstractConverter`, populate with
`BeanManager`) lets a script pass a **map literal** straight to a method taking `Foo`:

```velocity
$services.myapp.create({'product': 'XWiki', 'version': '18.0', 'title': 'Foo'})
```

Use `@PropertyMandatory` / `@PropertyDescription` on the bean properties: the Properties module then
produces the "missing mandatory property" errors for free.

## Rights

A script service is reachable with the Script Right alone, so every right check it performs for the
context **user** must be duplicated for the context **author** — see [[security]].
