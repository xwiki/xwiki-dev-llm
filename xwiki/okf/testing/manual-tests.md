---
title: Manual tests on test.xwiki.org — data model and automation status
stability: durable
summary: Where a manual test's steps, results and automation status are stored on test.xwiki.org, how
  to find a release's runs, and which of the two automation flags to trust.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/ManualTestStrategy
  - https://github.com/xwiki-contrib/application-testreporting
---

# Manual tests on test.xwiki.org

test.xwiki.org (wiki id `test`) runs the Test Reporting Application. It holds the manual tests run at
each release, grouped in one space per area (`Web Tests`, `Administration Tests`, …). Reach it like
any XWiki-run site ([[index]]). How a manual test gets reviewed for automation, and what the JIRA
issue for it carries: the "Manual tests migration strategy" section of the Manual Test Strategy page.

- **A test** is a page with a `QA.TestClass` object. The steps are the page content; the object holds
  `expectedResult`, `userType`, `wikiType` and `deprecated` (a test dropped instead of automated).
- **A run** is a `QA.ExecutionClass` object (`product`, `browser`, `database`, `servletContainer`,
  `java`, `distribution`, `passed`, `user`, `date`, `jira`). It is not stored on the test page but on
  `TestReportingExecutions.<test page full name><major version>`, so one page holds every run of
  that test for one major version. `product` is a page reference whose dots are escaped, so a
  release's runs are Solr `property.QA.ExecutionClass.product_string:"QA.XWiki 18\\.4\\.5"`.

## Automation status

- **The current record is a `QA.AutomatedTestStatusClass` object** on the test page: `status`
  (`Automated`, `Not Automatable`, `Needs Automated Test`), `jira` (the issue for automating it),
  `tests` (GitHub links to the automated tests) and `notes`. The test sheet shows only this.
- **`QA.TestClass.automated` (yes/no) is the legacy flag.** The two disagree on many tests, in both
  directions, and most tests have no status object at all.
- So neither flag proves a test is *not* automated: search the code for an existing test before
  writing one. Once it is automated, fill the status object — and the legacy flag, which the upstream
  page still asks for.
