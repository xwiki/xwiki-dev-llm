---
name: xwiki-security-advisory
description: Draft the content of a GitHub Security Advisory for an XWiki vulnerability, following the official template published on the XWiki Security Policy page (dev.xwiki.org). Use when asked to write/prepare/draft a security advisory, given a security-restricted JIRA issue key (e.g. XWIKI-1234) that needs a GHSA draft, or asked to fill in Impact/CVSS/Patches/Workarounds/References for a vulnerability. Always re-fetches the live template and the live JIRA issue rather than reusing a cached copy of the template or the wording of a past advisory. For the disclosure rules (obfuscated commits, restricted JIRA issues, the private-fork merge recipe) use xwiki-knowledge (okf/processes/security-policy.md); for reading/updating the JIRA issue itself use xwiki-jira; for the eventual fix's PR/commit conventions use xwiki-pull-request.
---

# XWiki security advisory drafting

Produces the markdown body + metadata for a GitHub Security Advisory (GHSA) draft on an
`xwiki`/`xwiki-contrib` repo, from a security-restricted JIRA issue. This skill only **drafts**
content — creating the actual advisory on GitHub, inviting collaborators, or publishing/disclosing
it are separate, explicitly-confirmed actions (see Step 6).

## Before you start — confidentiality

The vulnerability is not public. Everything this skill produces or reads is confidential until
disclosure ([[security-policy]] in the OKF owns the full rule):

- **Never** write the draft into the repo, a commit, a PR, a public issue/comment, or a public chat.
- Save the draft only under the session's **work directory** (per the org-wide "Work files"
  convention), clearly marked confidential — never under a repo path.
- Don't paste the vulnerability description into anything that isn't either the private GitHub
  advisory draft or a local work file.

## No proof of concept in the advisory

The advisory describes the vulnerability without enabling its reproduction: which feature or
endpoint is affected, the general attack vector, the requirements (rights, configuration) and the
impact — but **no PoC**: no exploit request, URL, page to target, payload, parameter values or
step-by-step reproduction, even when the JIRA issue has them (they stay in JIRA, where they're needed
for the fix). General about the mechanism, but **exact about the requirements**: name each right or
setting the attacker needs (e.g. "edit right on any page and comment right on a page whose author
has programming right") and say which of them the standard rights give everyone, so an admin with
non-standard rights can tell whether their wiki is affected. Scanners automatically import published advisories and try the reproduction steps they
contain. The Security Policy requires this since October 2026: a warning in its "Security Advisory
template and information" section, and a `/!\ Don't provide reproduction steps. /!\` line under the
template's `### Impact` — a reminder for the author, not part of the advisory, so leave it out of
the draft (Step 2 has the live wording).

**This is a change from past practice**: many published XWiki advisories contain a PoC or the exact
request to reproduce the vulnerability (e.g. GHSA-57q2-6cp4-9mq3 gives the URL to call). Don't take
past advisories as an example for the Impact section's level of detail — Step 3 uses them only for
the wording of the CVSS comments.

## Step 1 — Fetch the source JIRA issue

Security issues carry a restricted **Security Level** (e.g. "Confidential"), so `fields.security` is
set and the issue is invisible to a token/account outside the security group. Fetch the full issue
over REST (not `jira-cli`, which doesn't surface custom fields well) to get every field at once:

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" \
  "https://jira.xwiki.org/rest/api/2/issue/<KEY>" -o /tmp/issue.json
```

From the response's `fields`, collect:

- `summary`, `description` (the vulnerability write-up, in JIRA wiki markup — usually has an
  `h2. Impact` / `h2. PoC` structure — lift the impact from it, never the PoC), `security` (confirms it's
  restricted), `priority`, `versions` (Affects), `fixVersions`, `reporter`. An empty `security`
  means the issue is public: either it was disclosed, and the check below finds its published
  advisory, or it was filed public, and the policy's checklist ("Verify that the Confidential level
  is set") comes first — tell the user before drafting.
- The **CVSS vector** (`customfield_11870`, e.g. `CVSS:4.0/…`) and its numeric **score**
  (`customfield_11871`); both fields are described in `okf/processes/security-policy.md`.
- A `customfield_*` holding a `devSummaryJson`/pull-request bean can reveal whether a fix PR/commit
  already exists — useful for the Patches/References sections once a fix lands (remember: the fix
  commit message keeps the JIRA key but replaces the issue title with a neutral summary, per
  [[commit-messages]], so don't search it for the title's words).

**If the fetch fails** — no `JIRA_API_TOKEN` set, a network/auth error, or a 404 (which for a
restricted issue usually means the account behind the token isn't in the security group, not that
the key is wrong) — say so, then **ask the user directly** for whatever Step 4's mapping table needs
instead of guessing or stalling on the fetch. Ask specifically for: the title/summary; the
vulnerability description (impact, affected component, how to reproduce); affected version(s) and
fix version(s) if already decided; the reporter's name and whether they've agreed to be credited; and
a CVSS vector/score if one has already been agreed on. Draft with whatever they provide, and mark
anything still missing as an explicit `[TBD]` in the draft rather than inventing a value for it.

### Check that no advisory exists yet

The JIRA web link can be missing (XWIKI-23438 has none, yet GHSA-53gx-j3p6-2rw9 covers it), so
check both places:

```bash
curl -s -H "Authorization: Bearer $JIRA_API_TOKEN" "https://jira.xwiki.org/rest/api/2/issue/<KEY>/remotelink" \
  | jq '.[].object | select(.title == "Security Advisory") | .url'
gh api --paginate "repos/<owner>/<repo>/security-advisories?per_page=100" \
  --jq '.[] | select((.description // "") | test("<KEY>\\b")) | {ghsa_id, state, html_url}'
```

GitHub lists drafts only to an organization owner or a collaborator on them, so an empty result
from another account rules out published advisories only. When one exists, stop and show it to the
user: the job becomes reviewing or editing it (`references/github-advisory.md`), never a second one.

## Step 2 — Fetch the live advisory template and scoring guidance

The template lives on the **XWiki Security Policy** page (`dev.xwiki.org`, space
`Community.SecurityPolicy`). Read it fresh every time — it is community-maintained and can change;
never reuse a copy embedded in a previous conversation, this skill, or another advisory as the
source of truth. It's a public page, reachable over REST **without a token**:

```bash
curl -s "https://dev.xwiki.org/xwiki/rest/wikis/dev/spaces/Community/spaces/SecurityPolicy/pages/WebHome" \
  -H "Accept: application/json"
```

Take the `content` field (xwiki/2.1 syntax). Three parts of it matter:

- The **`= What's the process to handle security issues? =`** section is the committer checklist the
  whole job is measured against — it carries steps that live nowhere else, in particular the
  Security Advisory Application import and the CVE request of Step 6. Read it, don't stop at the two
  sections below.

- The **`= Security Advisory template and information =`** section holds the literal markdown
  template, inside a `{{code language="markdown"}} … {{/code}}` block — copy its section structure
  (`### Impact`, `#### CVSS Score Computation Details` table, `### Patches`, `### Workarounds`,
  `### References`, `### For more information`, `### Attribution`) verbatim; don't invent, drop, or
  reorder sections.
- The **`= Severity =`** section above it has the CVSS banding and the per-metric best practices.
  Take every value from it, never from this skill or from generic CVSS instinct — the policy
  constrains more metrics than a calculator's defaults suggest: Attack Vector, the mapping from
  XWiki rights to Privileges Required, the cap that a right required to exploit puts on the impacts,
  and the impact defaults fixed per vulnerability class (XSS and SSRF each have one, covering the
  subsequent system as well as the vulnerable one). Use these to justify each row of the CVSS table
  with a one-line comment, the way past advisories do. `okf/processes/security-policy.md` has the
  traps to watch for when reading them.

If the page has moved (404), rediscover it instead of guessing a new path:

```bash
curl -s -G "https://dev.xwiki.org/xwiki/rest/wikis/dev/query" \
  --data-urlencode "q=title:'XWiki Security Policy'" --data-urlencode "type=solr"
```

## Step 3 — Look at published advisories for CVSS comment wording

Step 2's guidance gives the *policy* behind each metric, but a good one-line comment for a CVSS table
row is a matter of precedent, not policy. Pull a few **already-published** XWiki advisories — never a
still-private/draft one — whose vector is close to the one at hand, and read how they worded that
row's comment:

```bash
gh api --paginate "repos/<owner>/<repo>/security-advisories?state=published&per_page=100" --jq \
  '.[] | {ghsa_id, summary, cvss: (.cvss_severities.cvss_v4.vector_string // .cvss.vector_string)}'
gh api repos/<owner>/<repo>/security-advisories/<ghsa_id> --jq '.description'
```

(`.cvss` holds only a CVSS 3 vector.) Precedents that comment each metric are rare: the published
advisories give the vector alone, except GHSA-5446-j3r6-h5xp (`xwiki-contrib/application-activitypub`,
the template's table) and GHSA-jm43-hrq7-r7w6 (`xwiki-platform`, a "CVSS explanation" list). Find
others with `select(.description | test("CVSS Score Computation|Attack vector:"; "i"))`; without a
close one, write each comment from Step 2's guidance alone.

Match the **register** — tight and mechanism-specific, one sentence per row (e.g. "Reachable by a
guest, who does not need an account." rather than a generic "Low privileges needed") — not the
literal wording. This is wording inspiration only: the advisory's **section structure** still comes
exclusively from the live template fetched in Step 2, never from a past advisory's layout, and
past advisories are no example for the Impact section's level of detail (many contain a PoC, see
"No proof of concept in the advisory") nor for the version ranges (see
`references/affected-products.md`).

## Step 4 — Draft the advisory

Fill the template using the mapping below — from the JIRA fields fetched in Step 1, or from the
user's direct answers when that fetch failed. Leave nothing as a silent placeholder: flag anything
still missing to the user instead of guessing it.

**One advisory for several issues.** A vulnerability is sometimes filed as several JIRA issues, a
second one "for advisory packaging" (e.g. a separate impact of the same attack). They get **one**
advisory: its Impact describes each of them, its References list every issue, its affected products
cover the modules of all of them, and it carries a single CVSS score, the highest. Each issue keeps
the vector of its own impact in JIRA and gets the advisory link (Step 6).

| Advisory field | Source |
|---|---|
| Title | JIRA `summary` |
| Impact prose | JIRA `description`'s explanation, rewritten as affected feature + attack vector + requirements + impact + affected versions, in your own words — **without the PoC** (see "No proof of concept in the advisory") and not a verbatim copy-paste of internal notes |
| CVSS table | The vector found in Step 1, valued per the Step 2 scoring guidance, worded per the Step 3 precedent for the *comment* column |
| Affected package(s) / vulnerable version range | The module(s) touched, and `versions` (Affects), verified against the code history → GitHub's version-range syntax — see "Affected products (packages) and version ranges" below — the checks are in `references/affected-products.md`, which also covers updating JIRA when they differ |
| Patches | `fixVersions`: "has been patched in…" once the fix is committed on every branch, released or not (the advisory is only published after the releases); "will be fixed in…" before that. While `fixVersions` is still empty, take each maintained branch's next release from its root `pom.xml` (`okf/conventions/versioning.md`), and mark them as to be confirmed |
| Workarounds | From the JIRA description if a mitigation is mentioned, else "no known workaround other than upgrading" |
| References | The JIRA issue URL, plus the fix commit's SHA/URL — use an explicit placeholder such as `[commit SHA once merged]` until the fix actually lands, matching the Patches row above |
| Credit / Attribution | `reporter`, or a named security researcher from the description — **ask the user to confirm the reporter consents to be credited** before naming them, and note that a non-committer reporter needs adding as a collaborator on the draft. Credit type (GitHub's definitions): `finder` for the person who discovered the vulnerability, also when they reported it themselves; `reporter` only for someone who passed on a finding that isn't theirs. Also link their account in the Attribution section: `[@login](https://github.com/login)` |

CWE: pick the closest match from https://cwe.mitre.org/data/index.html — this is a per-vulnerability
judgment call, not something to default without reasoning about the actual flaw (e.g. broken access
control against a user-controlled identifier is usually CWE-639, missing authorization generally is
CWE-862, XSS is CWE-79, etc.). Check the entry's **Vulnerability Mapping** "Usage" on its MITRE page:
`ALLOWED` or `ALLOWED-WITH-REVIEW` only. Content executed with the wrong author's rights is CWE-270,
not the discouraged CWE-269.

### Affected products (packages) and version ranges

Every advisory needs them, and they are where past advisories went wrong, so **before writing any
affected product or range, open `references/affected-products.md`** and work through all of it.
Never copy the ranges of a past XWiki advisory. The file covers these checks, and the draft records
the outcome of each one, "none" included:

- the leaf module(s) holding the vulnerable code, under the `maven` ecosystem;
- a legacy counterpart weaving that module in (the `legacy-` infix, confirmed in its pom);
- each module's history over the affected range (renames, splits, merges);
- modules repackaging it (an `artifactItem`, an assembly `<dependencySet>`, a webjar);
- variants of the vulnerable code that the fix did not touch;
- the first affected release, from the release tags containing the introducing commit;
- one band per fixed branch, both bounds set, one patched version per band;
- the Maven version format and the operator syntax GitHub and OSV accept;
- JIRA brought in line with the verified versions, vector, score and priority.

## Step 5 — Save the draft

Write the full draft — both the metadata (title, CVSS vector/score, CWE, affected versions, credits)
and the markdown body for the GitHub advisory's description field — to a file under the work
directory, e.g. `<work>/<repo>/<date>-<JIRA-KEY>-security-advisory/advisory-draft.md`, headed with a
**CONFIDENTIAL, do not commit or post publicly** banner. Show it to the user in the conversation too.

End by listing what remains after the draft, even when the user does not go on to Step 6: create
the GitHub advisory, add the Security team, link it on the JIRA issue(s), import it into the
Security Advisory Application once the fix is merged (that import is what triggers the disclosure
reminders), and request the CVE.

## Step 6 — Creating the real draft advisory on GitHub (only when asked)

Creating the advisory is visible to every organization owner at once, so it happens only when the
user asks for it, and only after re-running Step 1's check that no advisory exists yet. Then open `references/github-advisory.md` and follow it: the create request, the
Security team as collaborator, editing a draft others may have changed, the JIRA link, the Security
Advisory Application import and the CVE request. Two rules hold whatever the user asks:

- No fix is merged through the advisory's temporary private fork in the GitHub UI, which would put
  the JIRA title in the commit log; the manual merge recipe is in `okf/processes/security-policy.md`.
- Nothing is published before both the embargo date and a CVE ID.

## Troubleshooting

- **No CVSS vector in `customfield_11870`** → it may not have been scored yet; compute it with the
  user using the Step 2 guidance and the official calculator (https://www.first.org/cvss/v4.0/)
  rather than guessing a score.
