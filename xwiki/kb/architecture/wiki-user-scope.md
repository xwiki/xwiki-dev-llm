---
title: Subwiki user scope (local vs global users and groups)
stability: durable
summary: A wiki's user scope (LOCAL_ONLY / GLOBAL_ONLY / LOCAL_AND_GLOBAL) decides whether local
  (subwiki) users/groups, global (main wiki) ones, or both are visible in that wiki. It is stored as
  the userScope field of a WikiManager.WikiUserClass object on the WikiManager.WikiUserConfiguration
  document INSIDE the subwiki itself (not on the main-wiki descriptor), and defaults to GLOBAL_ONLY
  when the object is absent.
sources:
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-wiki/xwiki-platform-wiki-user/xwiki-platform-wiki-user-default/src/main/java/org/xwiki/wiki/user/internal/DefaultWikiUserConfigurationHelper.java
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-wiki/xwiki-platform-wiki-user/xwiki-platform-wiki-user-api/src/main/java/org/xwiki/wiki/user/WikiUserConfiguration.java
  - https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-rest/xwiki-platform-rest-server/src/main/java/org/xwiki/rest/internal/resources/classes/AbstractUsersAndGroupsClassPropertyValuesProvider.java
---

# Subwiki user scope (local vs global users and groups)

Each wiki has a **user scope** — the `org.xwiki.wiki.user.UserScope` enum — with three values:

- `LOCAL_ONLY` — only users/groups defined in the wiki itself are available.
- `GLOBAL_ONLY` — only users/groups from the main wiki are available.
- `LOCAL_AND_GLOBAL` — both are available ("Both global and local users are available in the wiki").

The scope drives components that list users/groups. For example the REST class-property value
providers behind the user/group pickers (`UsersClassPropertyValuesProvider`,
`GroupsClassPropertyValuesProvider`, sharing `AbstractUsersAndGroupsClassPropertyValuesProvider`)
switch on `wikiUserManager.getUserScope(wikiId)`: for `LOCAL_AND_GLOBAL` they merge local and global
results, so an App Within Minutes User/Group picker on such a subwiki suggests both local and global
entries.

## Where the scope is stored — and the non-obvious default

The scope is **not** stored on the wiki descriptor (`XWiki.XWikiServer<Wikiname>` in the main wiki).
It lives inside the subwiki, in the `userScope` field of a `WikiManager.WikiUserClass` object on the
document **`WikiManager.WikiUserConfiguration`** of that subwiki
(`DefaultWikiUserConfigurationHelper` reads `new DocumentReference(wikiId, "WikiManager",
"WikiUserConfiguration")`).

Defaulting is asymmetric and easy to get wrong:

- If the `WikiUserConfiguration` document has **no** `WikiUserClass` object, `WikiUserConfiguration`
  falls back to **`GLOBAL_ONLY`** — a freshly created subwiki therefore shows only global
  users/groups until the scope is set explicitly.
- If the object exists but the `userScope` field is empty/unparseable, the helper falls back to
  `LOCAL_AND_GLOBAL` instead.

To set the scope programmatically use `WikiUserManager#setUserScope(wikiId, scope)` (script service:
`$services.wiki.user.setUserScope(wikiId, 'LOCAL_AND_GLOBAL')`). In a functional test, the equivalent
is to create/update that object in the subwiki, e.g. update object 0 of `WikiManager.WikiUserClass`
on `WikiManager.WikiUserConfiguration` with `userScope=local_and_global` (the stored value is the
lower-cased enum name). Targeting the main-wiki descriptor instead has no effect.
