---
title: Jenkins CI (ci.xwiki.org) — REST API access and reading a build
stability: durable
summary: How to query ci.xwiki.org programmatically via the Jenkins remote-access API (`/api/json` +
  `tree=`) instead of scraping the web UI, the Cloudflare User-Agent trap, and the durable traps when
  interpreting a build result, a test-case `age`, and a docker-test failure. Build numbers, results
  and versions are volatile — always fetch them.
sources:
  - https://ci.xwiki.org/api/
  - https://www.jenkins.io/doc/book/using/remote-access-api/
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HServers
---

# Jenkins CI (`ci.xwiki.org`)

`https://ci.xwiki.org` is XWiki's Jenkins, building every `xwiki/*` and `xwiki-contrib/*` repo on
source change. There is **no MCP**. Read access is **anonymous — no token needed**.

Do **not** scrape the HTML UI: every job/build page is also available as structured JSON through the
Jenkins remote-access API, which is far cheaper and unambiguous. Self-documenting index:
https://ci.xwiki.org/api/ (append `/api/` to *any* Jenkins URL for that object's API doc).

## The Cloudflare User-Agent trap

ci.xwiki.org is fronted by Cloudflare like the rest of the farm, so the **User-Agent rule in
[[index]] applies to `/api/` too** — issue the request as plain `curl`. Generic HTML-fetching tooling
that sends a browser UA (or a headless browser) gets the `Just a moment...` challenge page instead of
the JSON; that is a Cloudflare block, not an auth problem, so credentials do not help.

## URL shape

Multibranch pipelines nest one `job/` segment per level, so a build is:

```
https://ci.xwiki.org/job/<Folder>/job/<repo>/job/<branch>/<buildNumber>/
# e.g. /job/XWiki%20Contrib/job/jira/job/master/278/
```

Folder names containing spaces must be percent-encoded (`XWiki%20Contrib`). When passing a `tree=`
expression through a shell, encode its brackets and braces as well — `%5B` `%5D` `%7B` `%7D` — so the
shell and Jenkins agree on where the expression ends.

## Endpoints worth knowing

Always add a `tree=` filter to select only the fields needed; an unfiltered `/api/json` on a build is
large and mostly plugin noise. `{0,20}` ranges a list.

| Question | Request (relative to the URLs above) |
|---|---|
| Recent builds + results + test counts | `<branch>/api/json?tree=builds[number,result,timestamp,actions[failCount,skipCount,totalCount]]{0,20}` |
| One build's status | `<build>/api/json?tree=number,result,building,duration,fullDisplayName` |
| Failing tests, with messages | `<build>/testReport/api/json?tree=suites[cases[className,name,status,age,failedSince,errorDetails,errorStackTrace]]` |
| What changed in the build | `<build>/api/json?tree=changeSets[items[commitId,msg,author[fullName]]]` |
| Exact commit built | `<build>/api/json?tree=actions[lastBuiltRevision[SHA1,branch[name]]]` |
| Archived files (screenshots, videos, reports) | `<build>/api/json?tree=artifacts[relativePath]`, then fetch `<build>/artifact/<relativePath>` |
| Raw build log | `<build>/consoleText` (**not** JSON) |

The JUnit summary is not a top-level field: it is the `actions[]` entry whose `_class` is
`hudson.tasks.junit.TestResultAction` (`failCount`, `skipCount`, `totalCount`). Filter the array for
the entry that actually has those keys rather than indexing by position.

`consoleText` is plain text and routinely **~1 MB** for a docker-test build. Never read it whole —
`grep` it for the specific thing being checked, and keep the pattern narrow (a broad pattern matched
against Testcontainers' image dumps produces megabytes of noise).

## The two functional-test jobs

Platform's functional tests run in **two** jobs, against different environments, and a release is
gated on both:

| Job | Runs |
|---|---|
| `job/XWiki/job/<repo>/job/<branch>` | the main build of each repo of the release train (Commons, Rendering, Platform) — one environment, HSQLDB |
| `job/XWiki%20Environment%20Tests/job/xwiki-platform/job/<branch>` | Platform only, a matrix of ~4 environments (MySQL / MariaDB / PostgreSQL / Oracle, each with its own servlet engine, store and browser) |

Consequences when reading their `testReport`:

- **A test can be green in one job purely because it never ran there.** Tests guarded by
  `assumeTrue` (a database-specific one, say) report `SKIPPED` in the environments that do not match,
  so a `PASSED`/absent result is not evidence of health — count the environments that actually ran it.
- **Environment Tests reports every test once per environment**, so a single broken test appears N
  times. Deduplicate on `className` + `name`, and take the environment from the *suite's*
  `enclosingBlockNames` (its last entry, up to `" - Docker tests"`) — it appears nowhere else.
- **`initializationError` and `executionError` are not test methods.** They are a whole class failing
  to set up, or the build's forbidden-log-content assertion. They hide every test of that module.

## Traps when interpreting a build

- **`result` distinguishes *how* it broke.** `UNSTABLE` = the build ran and **tests failed**;
  `FAILURE` = it broke outside the tests (compilation, quality gate, a post-build step). A `FAILURE`
  build can therefore still report `failCount: 0` with all tests green.
- **A test case's `age` / `failedSince` counts only builds that produced test results**, so it is not
  a reliable "first failure". When consecutive `FAILURE` builds precede an `UNSTABLE` one, `age: 1`
  and `failedSince: <this build>` appear even though those earlier builds ran the same tests fine.
  Confirm a regression window by reading the preceding builds' own test summaries.
- **`changeSets` can be empty** even for a build that picked up new commits. Get the truth from
  `lastBuiltRevision` and diff that SHA against the previous build's — picking the right one of the
  two, per the next trap.
- **Every build carries *two* `lastBuiltRevision` actions**, because every job checks out the shared
  `xwiki-jenkins-pipeline` library alongside the project it builds. **Select on the remote URL** —
  ask for `actions[remoteUrls,lastBuiltRevision[SHA1]]` and keep the action whose `remoteUrls` names
  the repo. Selecting on the *branch* name instead returns the library's revision, because the
  library is itself built from `master`: reading a `master` build then yields the same constant SHA
  for every build of every repo, and no error. The shared client in `scripts/jenkins.mjs`
  (`buildRevision()`) does this correctly — use it rather than re-deriving the query.

## Diagnosing a functional (docker) test failure

Docker/Selenium tests archive, **per failing test method**, a screenshot and a video under
`…/target/<db>-<servlet>-<browser>/screenshots/<config>-<FQCN>-<method>.png` (plus `.flv`). List them
via the `artifacts` endpoint and look at the `.png` first — it usually shows in one glance what the
page really looked like, which is faster than reasoning from the stack trace.

When a functional test starts failing **with no source change**, suspect the *resolved dependency
versions* rather than the test: XWiki functional tests run against `${platform.version}`, which is
inherited from the `org.xwiki.contrib:parent-platform` parent, so **changing the parent version
silently changes the whole XWiki version (and every bundled UI XAR) the tests run against**. Compare
the two builds' logs:

```
curl -s <build>/consoleText | grep -aoE "org/xwiki/platform/[a-z0-9-]+/[0-9][0-9a-zA-Z.-]*/" | sort -u
```

A change there (e.g. `14.10.20` → `14.10`) explains UI-element-not-found failures on its own, since
an older platform ships an older editor/UI whose markup the page objects and selectors no longer
match. See [[versioning]] for why the version itself must always be read, never remembered.

## Related

- Build **scans** (timings, cache hits, failure details from Develocity) live on
  community.develocity.cloud and are queryable through the `develocity` MCP — richer than the
  Jenkins REST API for *why* a build failed, where Jenkins is the authority on *whether* it did.
  See [[index]] for the server map.
- Quality-gate failures are a Sonar concern, not a Jenkins one: use the `sonarqube` MCP and the
  `xwiki-fix-sonarqube-issue` skill.
- A test that fails intermittently rather than deterministically is a flicker: Jenkins only shows
  the one run, so take its history across builds from the `develocity` MCP, then use the
  `xwiki-fix-flickering-docker-test` skill.
- To triage a whole branch's failures at once — flickers vs. real breakages, before a release — use
  the `xwiki-release-test-triage` skill, which automates the correlation described above.
