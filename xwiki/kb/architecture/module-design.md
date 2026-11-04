---
title: Module design — a review lens for the classes a change adds or reshapes
stability: durable
summary: A general design lens, not an XWiki rule — interface depth, the deletion test, locality,
  real versus hypothetical seams, and leaks across a seam — applied only to what a change adds or
  restructures; what it finds is a suggestion, never a blocking finding.
sources:
  - John Ousterhout, "A Philosophy of Software Design" (deep and shallow modules)
  - Michael Feathers, "Working Effectively with Legacy Code" (seams)
  - https://github.com/mattpocock/skills (codebase-design skill, MIT) — the ideas, reworded here
---

# Module design

XWiki has no written rule on how deep a class should be or where a piece of logic belongs, yet
committers raise such points in review, and authors act on them. This file is the lens behind them.
It is **not** an XWiki convention: a point resting on it alone is a suggestion the author may
decline, never a blocking finding.

## Scope: only what the change adds or reshapes

Apply it to a class, method or module the change **creates or restructures** (new public methods,
moved responsibilities, a new helper). Never to code the change only calls, and never as a proposal
to refactor the surrounding module: "while you are here, redesign X" is out of scope.

## The questions

- **Depth.** What must a caller know to use it — signature, preconditions, call order,
  configuration, failure modes — against what it hides? A class whose methods each forward to one
  call, or whose callers must assemble its inputs from someone else's internals, is shallow: it adds
  a name to learn and hides nothing.
- **Deletion test.** Imagine the new class gone and its body inlined at the callers. If the
  complexity disappears, it was a pass-through; if the same logic would reappear at several call
  sites, it earns its place. A class that only *moves* complexity one hop away fails.
- **Locality.** Logic belongs with the data or object it interrogates and with the code that changes
  together with it. Logic that only reads another object's state, placed far from that object, is
  found by nobody who later changes that state.
- **Seams.** An interface, extension point or configuration hook with one implementation is a
  hypothetical seam; with two (production and test count) it is real. Question a new seam nothing
  varies across — and, the other way round, a new mechanism built to work around behaviour that an
  existing seam (a configuration property, a component hint) already lets you change.
- **Leaks.** Does the new interface expose how it works — internal types, shared mutable state, an
  order of calls the caller must respect? Mutable static state in particular ties every caller to one
  hidden lifecycle.

## Turning it into a review point

Name the class and line, the question it fails, and the concrete alternative that already exists in
the codebase (where the logic would live, the seam that would be used). A point that cannot name
that alternative is speculation — leave it out. A shape is never a problem by itself (an all-static
class, a small class): it is one only when one of the questions above fails for it.
