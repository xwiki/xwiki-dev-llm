---
title: The XWiki component system
stability: durable
summary: XWiki's dependency-injection model — roles (@Role interfaces), implementations (@Component),
  registration via META-INF/components.txt, injection with @Inject/@Named, and lookup hints. Also
  covers choosing AbstractEventListener vs. AbstractLocalEventListener for cluster/remote-event behavior.
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

## Never grow `xwiki-platform-oldcore`

`oldcore` is what XWiki was before the split into domain modules, and the strategy is to keep
*extracting* code out of it. So: **do not add new code to oldcore** — put it in the relevant domain
module, or a new one. A new module may depend on oldcore (the reverse would be a cycle); when oldcore
turns out to need the new module, the oldcore code that uses it moves out instead. The end state is
oldcore holding only the old Model, until the New Model replaces it and oldcore disappears.

## Event listeners: local-only vs. cluster-wide

An `org.xwiki.observation.EventListener` (typically via `AbstractEventListener`) runs for **every**
occurrence of its event, including one that happened on another node of a cluster and was replicated
remotely. When the listener's action must run only for the node where the event actually originated —
because remote nodes will already reach the same effect independently (e.g. through their own copy of
replicated data), or because running it again elsewhere would duplicate/misfire a side effect — extend
`AbstractLocalEventListener` (`xwiki-platform-observation-remote`) instead and implement
`processLocalEvent(Event, Object, Object)`; it silently drops remote-originated events for you. When it
is not obvious which behavior an action needs, ask rather than defaulting to `AbstractEventListener`.

## Monitoring: expose it as a JMX MBean

All XWiki monitoring APIs are implemented and exposed as **JMX MBeans**. Register them with XWiki's
`JMXBeanRegistration` component (`this.jmxRegistration.registerMBean(mbean, "type=…,domain=…,name=…")`),
never directly — and **unregister**: registration typically goes in the component's
`Initializable#initialize()` and unregistration in `Disposable#dispose()`.

## Where to go deeper

The component tutorial on the dev wiki and the Component Module page on extensions.xwiki.org are the
authoritative references — fetch them when you need the full API (events, component lifecycle,
composable/initializable interfaces, component overrides and priorities).
