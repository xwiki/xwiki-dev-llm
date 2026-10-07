---
name: xwiki-contrib-release
description: Release an xwiki-contrib extension (groupId org.xwiki.contrib) end to end — preflight, `mvn release:prepare`/`release:perform` to nexus.xwiki.org, the issue-tracker version (JIRA or OpenProject), the extensions.xwiki.org import and release notes, then the hand-off to the announcement. Use when asked to release or publish a version of a contrib extension ("release v1.15 of the doc app"). Not for xwiki-commons/rendering/platform releases. For the blog post use xwiki-contrib-release-blog-post; for Maven/JDK use xwiki-build; for tracker calls use xwiki-jira or xwiki-openproject.
---

# Release an xwiki-contrib extension

Source of truth: the **Release the project**, *Recovering from a failed Release* and *Publishing on
extensions.xwiki.org* sections of https://contrib.xwiki.org/xwiki/bin/view/Main/WebHome#HReleasetheproject.
Prefer it when this skill looks outdated; the skill adds the gotchas it does not spell out.

A Nexus release can never be removed and the push lands on `master`. Being asked to release a named
version is the go-ahead for steps 2–7; when a preflight check fails, stop and report.

## 1. Preflight

Read from the root `pom.xml`: the `<version>` (must be `X.Y-SNAPSHOT` for the version asked), the
tracker (`xwiki.issueManagement.system`: `jira`, the contrib-parent default, or `openproject`), and the
`<parent>` XWiki version (it sets the JDK, see xwiki-build). Then all of these must hold:

1. **`HEAD` is clean and equal to `origin/master`** (fetch first). If `master` is checked out in
   another worktree, git won't check it out again: release from a branch sitting exactly on
   `origin/master`, with `-DpushChanges=false`, and push by hand (step 3).
2. **Every issue of the version is closed** (JIRA Fix Version / OpenProject version). Otherwise list
   the open ones and ask whether to move them.
3. **The build is green**: CI on the `HEAD` commit, or while it's pending a local
   `mvn clean verify -Pquality -B -ntp` (`release:prepare` skips tests).
4. **`~/.m2/settings.xml` has the `xwiki-staging` server and a GPG setup** (`gpg.keyname`,
   `gpg.passphrase`). Check with `grep -c`, **never print the secrets**. Missing: point the developer
   at the contrib guide (Nexus account, GPG key) and stop. With the automatic JIRA release
   (`xwiki.release.jira.skip` false), the JIRA credentials of
   https://github.com/xwiki-contrib/parent#enable-automatic-jira-release are needed too.

## 2. Prepare

```
mvn release:prepare -B -ntp -Pintegration-tests,docker -Darguments="-DskipTests" -DskipTests
```

- Keep `-Pintegration-tests,docker` and `-Darguments` even without functional tests, or some modules
  are left with wrong versions. `-B` takes the defaults: release `X.Y`, tag `<artifactId>-X.Y`, next
  `X.(Y+1)-SNAPSHOT`.
- Not on `master`: add `-DpushChanges=false`. Otherwise the plugin pushes the current branch's name
  instead of `master`.
- An unrelated enforcer failure: `-Dxwiki.enforcer.skip=true` inside `-Darguments`, and report it.

Expect two `[maven-release-plugin]` commits, with the tag on the first.

## 3. Push (with `-DpushChanges=false` only)

`release:perform` checks the tag out of the remote. Re-check that `origin/master` hasn't moved, then
`git push origin HEAD:master` and `git push origin <tag>`. If it moved, roll back (step 8) and restart.

## 4. Perform

```
mvn release:perform -B -ntp -Pintegration-tests,docker -Darguments="-DskipTests -Pintegration-tests,docker" -DskipTests
```

Run it in the background with the output in a log: it's long. The contrib parent closes and
releases the staging repository itself (`Remote staging repositories released.`). Check that each
artifact's
`https://nexus.xwiki.org/nexus/content/groups/public/<groupId path>/<artifactId>/X.Y/<artifactId>-X.Y.<pom|jar|xar>`
returns 200. If the pom turns the automatic release off, the staging repository stays open. Closing,
testing and releasing it is the developer's call: never release it on their behalf.

## 5. Tracker version

- **JIRA**: create `X.(Y+1)`. Without the automatic JIRA release, also release `X.Y`.
- **OpenProject**: `PATCH /api/v3/versions/<id>` `{"status":"closed"}`, then `POST /api/v3/versions`
  for `X.(Y+1)`, with the same `sharing` as the previous versions.

## 6. extensions.xwiki.org import

A nightly job imports new versions. Don't wait for it, because step 7 writes to the version page the
import creates:

- **Multi-module project** (a Project page with an `ExtensionCode.ProjectClass`; Solr
  `property.ExtensionCode.ProjectClass.id_string:<groupId>*` on the extensions wiki): click its
  **"Update project"** button. That re-imports the Project **and all its module pages**.
- **Standalone extension**: open
  `https://extensions.xwiki.org/xwiki/bin/view/ExtensionCode/ImportExtension?importExtension=true&extensionId=<groupId>%3A<artifactId>&repositoryId=maven-xwiki`.
  For a first release, also check the new page's name, authors and "Installable with the Extension
  Manager".
- **Never give a Project id to `importExtension`**: it only matches `ExtensionClass` ids, so it creates
  a duplicate page named after the pom `<name>`, and every later "Update project" goes to that page.
  If it happens, delete the duplicate (its `Versions/<version>` child first) and update again.
- **Use the developer's logged-in browser** (claude-in-chrome). These `/bin/` URLs reject Basic auth
  (`okf/servers/index.md`), and a scripted form login answers 401. From that tab, `fetch()` and REST writes
  (with the `XWiki-Form-Token` header from `<html data-xwiki-form-token>`) work.

Verify that `lastVersion` is `X.Y` on the `ProjectClass`/`ExtensionClass` object, and that
`Extension/<Space>/Versions/X.Y/` exists.

## 7. Release notes

They live in the `notes` property of the version object (`okf/processes/release-notes.md`): the
Project's `ExtensionCode.ProjectVersionClass` for a multi-module project, otherwise the
`ExtensionCode.ExtensionVersionClass`.

- **JIRA**: the import fills `notes` with a `{{jira}}` macro. Just check that it's there.
- **OpenProject**: `notes` stays empty, so copy the version's work packages in, matching the
  previous versions' `notes`: Bugs, then Improvements, then New Features, each by id, one line each:
  `* [[<Type> #<id>>>url:https://op.xwiki.org/work_packages/<id>]]<subject>`. Escape macro calls
  in subjects (`{{image}}` → `~{~{image}}`). `PUT` it as `text/plain` on
  `…/objects/<class>/0/properties/notes`, read it back, and check that the Versions table renders it
  without errors.
  Then `PATCH` every work package of the version so its **Release Notes Documentation** custom field
  (find its `customFieldN` key in the work package schema) is the version page URL
  (`okf/processes/release-notes.md`), and read them back.

## 8. Recovering from a failed release

- Prepare failed: `mvn release:rollback`, then delete the tag (`git tag --delete <tag>`, and
  `git push origin :<tag>` if it was pushed): the rollback doesn't. Without `release.properties`,
  revert the two release commits by hand.
- Perform failed after uploading: have someone with Nexus rights drop the staging repository. A
  version that reached the public repository can't be re-released: release `X.Y.1`.

## 9. Hand off and report

Draft the announcement from the release notes, show it to the developer, and create it with
**xwiki-contrib-release-blog-post**. Report the tag, the Nexus check, the tracker changes, the
extensions.xwiki.org state and release notes, and what the developer still owes. That covers saving
the blog post, plus the extension-page documentation: "General Compatibility" if the parent was
raised, "Tested On" (append only), and docs for new features (xwiki-doc-writing).
