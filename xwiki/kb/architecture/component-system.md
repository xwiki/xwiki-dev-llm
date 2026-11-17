---
title: The XWiki component system
stability: durable
summary: XWiki's dependency-injection model — exact role-type matching for generic roles,
  hand-maintained META-INF/components.txt registration, instantiation strategy, the oldcore rule,
  event listeners and JMX monitoring.
sources:
  - https://www.xwiki.org/xwiki/bin/view/Documentation/DevGuide/Tutorials/WritingComponents/
  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Component+Module
provenance: official
last-confirmed: 2026-09-12
related: [architecture/platform-modules.md, architecture/module-design.md, conventions/code-style.md]
applies-to: ["**/META-INF/components.txt", "**/src/main/java/**/*.java"]
applies-when:
  - '^\s*@(?:Component|Role|InstantiationStrategy)\b'
  - '\bextends\s+Abstract(?:Local)?EventListener\b'
  - '^(?:\d+:)?[a-z]\w*(?:\.\w+)*\.[A-Z]\w*\s*$'
---

# The XWiki component system

XWiki is built on its own lightweight dependency-injection container. New code should be written as
**components** rather than passing context objects around. This is the single most important
architectural convention for back-end XWiki code.

## The core concepts

- **Role** — an interface annotated `@Role` (in `org.xwiki.component.annotation`). The role is the
  contract other code depends on. A role can be parameterized by a generic type, and lookups match
  the registered role type exactly: inject `Provider<SomeRole<String>>` for a role registered
  parameterized, a raw `Provider<SomeRole>` only for one registered raw (`@Component(roles = …)`).
- **Registration** — implementations are listed in `META-INF/components.txt` (one fully-qualified
  class name per line), maintained by hand: nothing generates it. The build's Spoon checks fail a
  `@Component` class missing from it (unless `staticRegistration = false`), an entry listed twice or
  without its class, and a file not ending with a newline.

## Instantiation strategy

Components are **singletons by default**. For a fresh instance per lookup, annotate the
implementation with `@InstantiationStrategy(ComponentInstantiationStrategy.PER_LOOKUP)`.

## Never grow `xwiki-platform-oldcore`

`oldcore` is what XWiki was before the split into domain modules, and the strategy is to keep
*extracting* code out of it. So: **do not add new code to oldcore** — put it in the relevant domain
module, or a new one. A new module may depend on oldcore (the reverse would be a cycle); when oldcore
turns out to need the new module, the oldcore code that uses it moves out instead. The end state is
oldcore holding only the old Model, until the New Model replaces it and oldcore disappears.

## Event listeners: local-only vs. cluster-wide

`AbstractEventListener` fires for every occurrence of its events, **including ones replicated from
another cluster node**. When the action must run only where the event originated — remote nodes reach
the same effect on their own, or re-running it there duplicates a side effect — extend
`AbstractLocalEventListener` (`xwiki-platform-observation-remote`, so it adds that dependency) and
implement `processLocalEvent` instead. Ask when the right choice is not obvious.

## Monitoring: expose it as a JMX MBean

All XWiki monitoring APIs are implemented and exposed as **JMX MBeans**. Register them with XWiki's
`JMXBeanRegistration` component (`this.jmxRegistration.registerMBean(mbean, "type=…,domain=…,name=…")`),
never directly — and **unregister**: registration typically goes in the component's
`Initializable#initialize()` and unregistration in `Disposable#dispose()`.

## Where to go deeper

The component tutorial on the dev wiki and the Component Module page on extensions.xwiki.org are the
authoritative references — fetch them when you need the full API (events, component lifecycle,
composable/initializable interfaces, component overrides and priorities).
