# Creating the advisory on GitHub, and what follows

Read by `xwiki-security-advisory` at its Step 6, once the user has asked for the advisory to be
created. Step numbers are those of that skill's `SKILL.md`.

Drafting the text is safe to do proactively; actually creating the GitHub Security Advisory is a
repo-visible action (visible to all org owners immediately) and must be explicitly requested, not
assumed. When the user asks for that step:

- Create it via `gh api repos/<owner>/<repo>/security-advisories --method POST --input <payload.json>`
  (build the JSON with `jq`: `vulnerabilities` and `credits` are arrays of objects, which `-f`
  can't express) or point the user to the GitHub UI flow linked from the template section (both
  are described in
  https://docs.github.com/en/code-security/security-advisories/repository-security-advisories/creating-a-repository-security-advisory).
  Without credentials (e.g. in a container), write a small script the user reviews and runs on
  their machine: the values as variables at the top, a dry run printing the payload by default.
- Add the organization's **Security** GitHub team (`XWiki/Security` in `xwiki`) as a collaborator on
  the draft — the policy page calls this out explicitly as an easy thing to forget. Its slug is
  **`security`** in both the `xwiki` and `xwiki-contrib` organizations. The create request rejects
  `collaborating_teams` ("not a permitted key", HTTP 422), so set it with a second request on the
  created advisory:
  `gh api repos/<owner>/<repo>/security-advisories/<ghsa_id> --method PATCH --input -` with
  `{"collaborating_teams": ["security"]}`. A credited researcher outside that team is added the same
  way, in `collaborating_users`, so they can see the draft — also when their consent only arrives
  after the advisory exists: then fill the credit and the `### Attribution` section, add them as a
  collaborator, and tell them on the JIRA issue.
- **Read the advisory before changing it.** Others can edit a draft in the GitHub UI, and a PATCH of
  the `description` replaces the whole text. Fetch the current version, compare it with what you sent,
  and merge their changes into yours rather than overwriting them.
- Link the advisory on each JIRA issue as a `Security Advisory` web link, as `okf/servers/jira.md`
  ("The documentation fields") describes.
- Do **not** merge any fix through the advisory's temporary private fork via the GitHub UI — that
  leaks the JIRA title into the commit log. Use the manual merge recipe in
  [[security-policy]] (`okf/processes/security-policy.md`) instead.
- **Import the advisory into the Security Advisory Application on xwiki.org** — the step that is
  easiest to forget, because the app is what fires the disclosure reminders; skip it and nothing
  ever reminds anyone to disclose. Import from
  https://www.xwiki.org/xwiki/bin/view/SecurityAdvisoryApplication/Code/SingleAdvisoryImportPage as
  soon as the fix is merged — it **need not be released**, nor the CVE requested; the app's daily
  automatic import would only pick it up later — then check the imported data, set the state to
  **completed**, and then to **announced** — the latter notifies everyone subscribed to new
  advisories. Re-import the same way whenever the advisory is edited afterwards, e.g. once a
  backport lands on another branch or the version ranges change. Remind the user of it, with the
  link, rather than treating the GHSA draft as the end of the job; do it for them only when asked:
  - The import page needs wiki admin rights (SPAPP-35). It and the advisory sheet's status buttons
    are `/bin/` pages, which ignore Basic auth (`okf/servers/index.md`): use the user's logged-in
    browser. "Mark announced" only appears once the advisory is completed.
  - Check the import over REST: the page `SecurityAdvisoryApplication.SecurityEntries.<GHSA ID>`
    (read it by name: `/query` takes Solr only), its `SecurityAdvisoryApplicationClass` object and
    one `SecurityAdvisoryImpactedPackageClass` per package, ranges in Maven syntax.
  - A manual import leaves the embargo date empty: a daily job computes it for **announced**
    advisories, from the patched versions' release date in the product's release notes. A product
    without any (every contrib extension) gets the day that job first finds the artifact released
    (SPAPP-38). A re-import keeps the status but recomputes a hand-edited embargo date (SPAPP-36).
- **Request the CVE once the advisory is completed and announced**, without waiting for the
  release: a CVE ID can take a while to arrive and publication is blocked without one. Only the
  embargo and publication need the release.
- Publishing/disclosing the advisory (making it public) happens only once the embargo date is
  reached **and** a CVE ID has been received — never publish opportunistically. A vulnerability
  that is already public (an issue filed public, a public report) follows this same process: no
  shorter embargo, no earlier publication.
