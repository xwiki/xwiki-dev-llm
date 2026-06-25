---
name: increase-test-coverage
description: Guide for increasing the unit test coverage for an XWiki module.
---

1. Verify the build passes with ``mvn clean install -B -ntp -q -Pquality -Dxwiki.jacoco.instructionRatio=0.00``
2. Run ``mvn jacoco:report -B -ntp``
3. Compare the computed total instruction coverage ratio from ``./target/site/jacoco/index.html`` with ``xwiki.jacoco.instructionRatio`` property from ``pom.xml``
  * if greater, update ``pom.xml`` and stop
  * if lower:
    1. Analyze the JaCoCo report from ``./target/site/jacoco/``
    2. Identify clases with low test coverage; prioritize classes with local changes
    3. identify execution paths that are not covered by unit tests; prioritize main execution paths from changed code
    4. implement a single unit test, then go back to first step and iterate until you reach or exceed the expected coverage