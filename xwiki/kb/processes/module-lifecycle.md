---
title: Module lifecycle — extracting, merging in, retiring, top-level extensions
stability: durable
summary: Code moved between XWiki repos must keep its git history (git subtree split/add); extracting
  to xwiki-contrib also means contrib parent + xwiki.extension.features + same version; retiring means
  a VOTE and the Attic (unsupported); top-level extensions are VOTEd per case.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices#HExtractingoutamodule
---

# Module lifecycle

Moving code between repositories must **keep the git history** — use `git subtree`, never a
copy-paste commit.

## Extracting a module out (to xwiki-contrib or the Attic)

Create the target repo, then from the **root** of the source repo (example: `xwiki-platform-blog` →
`xwiki-contrib/application-blog`):

```
git subtree split -P xwiki-platform-core/xwiki-platform-blog -b split
git push git@github.com:xwiki-contrib/application-blog.git split:master
git branch -D split
```

then remove the code from the source repo and commit.

When the target is **xwiki-contrib**, also:

- rename groupId / artifactIds / directories;
- use `org.xwiki.contrib:parent-*` as the parent, at the **LTS** version (e.g. `13.10` while `13.10.x`
  is the LTS branch);
- declare the `xwiki.extension.features` EM property in the poms so the old extension id keeps
  resolving;
- **keep the same version** (e.g. `14.7-SNAPSHOT`) to signal this is not a new extension — the
  extension then chooses its own release cadence from there, only ever increasing;
- update the extension id on the extensions.xwiki.org page and mention the move in its Compatibility
  section;
- follow the rest of the contrib best practices (new JIRA project, top-level pom changes, README).

## Merging a module in

```
git subtree add --prefix xwiki-platform-core/xwiki-platform-ckeditor \
  git@github.com:xwiki-contrib/application-ckeditor.git master
```

(the prefix is the module's new location in the target hierarchy), then adapt the code to the XWiki
Standard coding style, integrate it into the module hierarchy and push the branch. Test the build on an
environment close to the release machine — a missing command-line tool is the classic late surprise.

## Retiring a module (the XWiki Attic)

VOTE on the forum first. Once agreed: move the whole GitHub repo if the repo is what is being retired,
otherwise extract the module out as above; retire its JIRA project; and mark the extensions.xwiki.org
page with a warning plus a Compatibility note. **Anything in the Attic is no longer supported.**

## Top-level extensions (own repo in the `xwiki` org, own release cycle)

Extracted from xwiki-contrib or xwiki-platform so they can be released independently, and **VOTEd case
by case**. A candidate needs: a named Release Manager, several releases already done, its e.x.o pages,
compliance with our coding/test practices, at least one integration or functional test, and the
agreement of its main contributors. Each gets a git repo named `xwiki-<short project name>`, its own
JIRA project (category "XWiki Extensions"), a CI job, and groupId + Java package
`org.xwiki.<short project name>` — the short name is part of the VOTE. An extension that stops working
or whose quality degrades can be VOTEd back to xwiki-contrib.
