---
name: xwiki-increase-test-coverage
description: Increase (and lock in) the unit-test coverage of an XWiki module. Run this automatically
  whenever unit tests are added or changed in a module — as part of that same change — as well as when
  explicitly asked to raise coverage. It recomputes the module's achieved JaCoCo instruction ratio and
  raises the module pom's xwiki.jacoco.instructionRatio when the ratio has grown, or guides adding the
  missing tests otherwise.
---

Run this from the module directory, on the JDK the branch targets — on a too-new JDK the JaCoCo agent
aborts and produces no coverage at all (see the ``xwiki-build`` skill).

1. Verify the build passes with ``mvn clean install -B -ntp -q -Pquality -Dxwiki.jacoco.instructionRatio=0.00``
2. Run ``mvn jacoco:report -B -ntp``
3. Compare the computed total instruction coverage ratio from ``./target/site/jacoco/index.html`` with ``xwiki.jacoco.instructionRatio`` property from ``pom.xml``
  * If greater, update ``pom.xml`` and stop
  * If lower only because the change removed covered code, lower ``pom.xml`` instead (``okf/testing/strategy.md``) and stop
  * If lower otherwise:
    1. Analyze the JaCoCo report from ``./target/site/jacoco/``
    2. Identify classes with low test coverage; prioritize classes with local changes
    3. Identify execution paths that are not covered by unit tests; prioritize main execution paths from changed code
    4. Implement a single unit test of a behaviour worth protecting (``okf/testing/test-value.md``), then go back to first step and iterate until you reach or exceed the expected coverage
  * A test written only to raise the ratio — on trivial code, or replaying calls with mocks — is never the answer: when the remaining gap is such code, say so to the developer