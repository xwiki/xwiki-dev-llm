---
name: fix-flickering-docker-test
description: Guide for fixing a flickering Docker-based functional test for an XWiki module.
---

1. Build the modified Maven projects, excluding those with ``-docker`` and ``-tests`` suffix.
2. Replace the ``@Test`` annotation with ``@org.junit.jupiter.api.RepeatedTest(value = 10, failureThreshold = 1)`` only for the flickering test method.
3. Check if there is an XWiki instance already running on port 8080, in which case ask for confirmation to stop it.
4. Try to reproduce the flickering on Firefox with ``mvn clean install -B -ntp -Dit.test=TestClass#testMethod -Dxwiki.test.ui.browser=firefox``; this creates a new XWiki test instance
5. Analyze the logs to understand the failure.
6. Start the XWiki test instance in the background with ``./target/hsqldb_embedded-default-default-jetty_standalone-default-firefox/jetty/start_xwiki.sh``
7. Run the repeated test on Chrome as well, against the running XWiki test instance, to check if the failure is the same:

  ```
  mvn failsafe:integration-test -B -ntp -Dxwiki.test.ui.servletEngine=external -Dit.test=TestClass#testMethod -Dxwiki.test.ui.browser=chrome
  ```

8. Identify the failure reason then update the test and/or the used page objects in order to fix the flickering.
9. Always validate the fix by running the flickering test at least 10 times on both Firefox and Chrome.
10. If the fix requires changes outside the ``-docker`` and ``-pageobjects`` projects then go to step 1 (to recreate the XWiki test instance); otherwise:
  * Rebuild the modified ``-pageobjects`` projects
  * Compile the test code with ``mvn compiler:testCompile -B -ntp``
  * Run the flickering test method against the running XWiki test instance like in step 7 and iterate
11. Stop the XWiki test instance at the end.