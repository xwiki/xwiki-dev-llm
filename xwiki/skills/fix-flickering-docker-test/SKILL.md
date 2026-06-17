---
name: fix-flickering-docker-test
description: Guide for fixing a flickering Docker-based functional test for an XWiki module.
---

1. Build the modified Maven projects, excluding those with ``-docker`` and ``-tests`` suffix
2. Replace the ``@Test`` annotation with ``@org.junit.jupiter.api.RepeatedTest(value = 10, failureThreshold = 1)`` only for the flickering test method
3. Try to reproduce the flickering on Firefox using ``mvn clean install -Dit.test=TestClass#testMethod``; this creates a new XWiki test instance
4. Analyze the logs to understand the failure
5. Start the XWiki test instance in the background with ``./target/hsqldb_embedded-default-default-jetty_standalone-default-firefox/jetty/start_xwiki.sh``
6. Run the repeated test on Chrome as well, against the running XWiki test instance, to check if the failure is the same:

  ```
  mvn failsafe:integration-test -Dxwiki.test.ui.servletEngine=external -Dit.test=TestClass#testMethod -Dxwiki.test.ui.browser=chrome
  ```

7. Identify the failure reason then update the test and/or the used page objects in order to fix the flickering
8. Always validate the fix by running the flickering test at least 10 times on both Firefox and Chrome
9. If the fix requires changes outside the ``-docker`` and ``-pageobjects`` projects then go to step 1 (to recreate the XWiki test instance); otherwise:
  * Rebuild the modified ``-pageobjects`` projects
  * Compile the test code with ``mvn compiler:testCompile``
  * Run the flickering test method against the running XWiki test instance like in step 6 and iterate