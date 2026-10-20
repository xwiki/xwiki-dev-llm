# The release's JIRA filter and dashboard

Both are named after the final version even for its RC ("Issues fixed in XWiki 18.9.0", dashboard
"XWiki 18.9.0"), and both are **viewable by anyone on the web and editable by `xwiki-committers`**.

## Filter (REST)

Copy the JQL of the previous release's filter, bumped to the new version — at the time of writing:

```
component != "Development Issues only" AND project in (XCOMMONS, XRENDERING, XWIKI)
AND fixVersion in (X.Y.0-rc-1, X.Y.0)
```

adding `AND fixVersion not in (…)` for the bugfix releases of the previous cycle, if any. Create it
with `POST /rest/api/2/filter`, then share it with `POST /rest/api/2/filter/<id>/permission`:
`{"type": "global"}` **first**, then
`{"type": "group", "groupname": "xwiki-committers", "view": true, "edit": true}` — adding the global
share after the group one dropped the group share. Read `/filter/<id>/permission` back.

## Dashboard (browser)

JIRA Server has no REST API to create or copy a dashboard, so it goes through the UI of a logged-in
browser:

1. Find the previous dashboard id: the `selectPageId=` of the dashboard link in the previous
   release's release notes.
2. `/secure/AddPortalPage!default.jspa?clonePageId=<id>`: set the name, delete the default
   "logged-in users" viewer share, add **Anyone on the web**, add the editors group
   **xwiki-committers** (each with its own **Add** button), submit.
3. Repoint the copied gadgets at the new filter without the UI, from a page of the logged-in
   session: `GET /rest/dashboards/1.0/<dashboard>.json` lists the gadgets and their preferences;
   for each one, `PUT /rest/dashboards/1.0/<dashboard>/gadget/<gadget>/prefs` with
   `{"up_<pref>": "<value>"}` and the header `X-Atlassian-Token: no-check`, replacing the old filter
   id wherever it appears (`filterId`, `projectOrFilterId`, and `id` for the pie charts, whose
   `type` is `filter`) and the old filter name in `name`.
4. Check the sharing in the dashboard's row of `/secure/ConfigurePortalPages.jspa?view=my`, and that
   the dashboard shows the filter's issue count.

A browser tool may refuse to return a script result containing URLs with query strings (the filter
and gadget JSON carry some): print ids and counts only.

Then put the dashboard link in the release notes:
`[[Full list of issues fixed and Dashboard for X.Y.0>>https://jira.xwiki.org/secure/Dashboard.jspa?selectPageId=<id>]]`.
