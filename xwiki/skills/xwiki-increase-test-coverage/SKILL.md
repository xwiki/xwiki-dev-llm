---
name: xwiki-increase-test-coverage
description: Increase (and lock in) the unit-test coverage of an XWiki module. Run this automatically
  whenever unit tests are added or changed in a module — as part of that same change — as well as when
  explicitly asked to raise coverage. It recomputes the module's achieved JaCoCo instruction ratio and
  raises the module pom's xwiki.jacoco.instructionRatio when the ratio has grown, or guides adding the
  missing tests otherwise.
---

Run this from the module directory.

1. Verify the build passes with ``mvn clean install -B -ntp -q -Pquality -Dxwiki.jacoco.instructionRatio=0.00``
2. Run ``mvn jacoco:report -B -ntp``
3. Compare the computed total instruction coverage ratio from ``./target/site/jacoco/index.html`` with ``xwiki.jacoco.instructionRatio`` property from ``pom.xml``
  * If greater, update ``pom.xml`` and stop
  * If lower:
    1. Analyze the JaCoCo report from ``./target/site/jacoco/``
    2. Identify classes with low test coverage; prioritize classes with local changes
    3. Identify execution paths that are not covered by unit tests; prioritize main execution paths from changed code
    4. Implement a single unit test, then go back to first step and iterate until you reach or exceed the expected coverage