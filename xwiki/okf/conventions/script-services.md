---
title: Script service conventions (errors, arguments)
stability: durable
summary: A new script service throws instead of returning null and stashing the error, callers handle
  it with #try(), existing null-returning signatures must not be changed, and the Method Arguments
  Uberspector means a service never needs bean-factory methods.
sources:
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Script%20Module/#HBestPractices
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Velocity%20Module
---

# Script service conventions

## Errors: throw, do not stash

A **new** script service method **throws**. The older convention — catch, return `null`, and set an
xcontext property the caller reads back with `getLastError()` — predates the `#try()` directive and
is no longer the best practice.

Callers that want to handle the exception use `#try()`; callers that do not need do nothing, since
the Macro Transformation or the template catches it and displays it.

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
than fixed on an existing service (`okf/sonarqube/index.md`).

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
