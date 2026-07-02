---
title: The XWiki component system
stability: durable
summary: XWiki's dependency-injection model — roles (@Role interfaces), implementations (@Component),
  registration via META-INF/components.txt, injection with @Inject/@Named, and lookup hints.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/ComponentsTutorial
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Component+Module
---

# The XWiki component system

XWiki is built on its own lightweight dependency-injection container. New code should be written as
**components** rather than passing context objects around. This is the single most important
architectural convention for back-end XWiki code.

## The core concepts

- **Role** — an interface annotated `@Role` (in `org.xwiki.component.annotation`). The role is the
  contract other code depends on. A role can be parameterized by a generic type.
- **Implementation** — a class annotated `@Component` that implements a role. It is registered so
  the container can instantiate and inject it.
- **Registration** — implementations are listed in `META-INF/components.txt` (one fully-qualified
  class name per line). The build can generate this automatically when the
  `component-maven-plugin` is configured; otherwise it is maintained by hand.
- **Injection** — depend on a role with `@Inject` on a field. Prefer the `jakarta.inject.*`
  annotations (`@Inject`, `@Named`, `Provider`) in new code; see [[code-style]] for the
  javax→jakarta migration.

## Hints (multiple implementations of a role)

When several implementations share a role, each declares a **hint** via `@Named("hint")` on the
component, and consumers select one with `@Inject @Named("hint")`. A component with no explicit
hint has the `"default"` hint.

## Instantiation strategy

Components are **singletons by default**. For a fresh instance per lookup, annotate the
implementation with `@InstantiationStrategy(ComponentInstantiationStrategy.PER_LOOKUP)`.

## Programmatic lookup

When injection is not possible (e.g. you need a component chosen at runtime), inject a
`ComponentManager` and look the component up by role + hint. Prefer field injection wherever the
dependency is known at development time.

## Where to go deeper

The component tutorial on the dev wiki and the Component Module page on extensions.xwiki.org are the
authoritative references — fetch them when you need the full API (events, component lifecycle,
composable/initializable interfaces, component overrides and priorities).
