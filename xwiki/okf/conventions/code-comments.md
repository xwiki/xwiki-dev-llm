---
title: Code comment policy
stability: durable
summary: A comment explains the code as it is now and stands on its own once its links are dead;
  never justify code by its history, and give an issue's ID and title when referencing one.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/CodeStyle
  - https://dev.xwiki.org/xwiki/bin/view/Community/VelocityCodeStyle
---

# Code comment policy

Applies to every language in the code base — Java, JavaScript, Velocity, XML, shell, `.properties`.

Write comments about the code **as it is now**, explaining the real reason for it — the use case,
requirement, constraint, or edge case being handled — stated inline, so the comment still explains
the code when everything it points to is gone.

- **Never justify code by a previous, old, or removed implementation, or by the change itself**
  ("like the previous X did", "as it was before", "to keep the old behavior", "changed because…").
  A future reader has no knowledge of that history, and the reference becomes misleading once the
  old code is gone. Change history belongs in the **commit message**, which keeps its JIRA prefix —
  see [[commit-messages]].
- **A link never carries the explanation.** Referencing the issue a comment is about — JIRA, GitHub,
  a forum thread — is *optional* and acceptable **in addition** to the self-contained reason, never
  instead of it: an issue title states the symptom, which is not why the code does what it does. When
  a reference is given, write the issue's **ID and its title**, so that much survives the link
  rotting or the tracker being decommissioned:

  ```java
  // The parser keeps the newline that closes a macro block and the serializer emits its own, so a
  // page saved twice grows a blank line. Drop it here until the parser stops producing it.
  // More details: XWIKI-12345 "Blank line added when saving a page twice".
  ```
