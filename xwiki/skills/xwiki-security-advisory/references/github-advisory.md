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
  `{"collaborating_teams": ["security"]}`.
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
  backport lands on another branch or the version ranges change. The embargo dates are computed by the
  release process itself, once every fixed version is released. The app lives on xwiki.org and needs
  the `XWikiSecurityGroup` membership, so this is the user's action, not something to do for them:
  remind them of it, with the link, rather than treating the GHSA draft as the end of the job.
- **Request the CVE once the advisory is completed and announced**, without waiting for the
  release: a CVE ID can take a while to arrive and publication is blocked without one. Only the
  embargo and publication need the release.
- Publishing/disclosing the advisory (making it public) happens only once the embargo date is
  reached **and** a CVE ID has been received — never publish opportunistically.
