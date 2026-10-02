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
impact — but **no PoC**: no exploit request, URL, payload, parameter values or step-by-step
reproduction, even when the JIRA issue has them (they stay in JIRA, where they're needed for the
fix). Scanners automatically import published advisories and try the reproduction steps they
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
  restricted), `priority`, `versions` (Affects), `fixVersions`, `reporter`.
- The **CVSS vector** (`customfield_11870`, e.g. `CVSS:4.0/…`) and its numeric **score**
  (`customfield_11871`); `okf/servers/jira.md` has the facts about both fields.
- A `customfield_*` holding a `devSummaryJson`/pull-request bean can reveal whether a fix PR/commit
  already exists — useful for the Patches/References sections once a fix lands (remember: the fix
  commit message will be **obfuscated**, per [[security-policy]], so don't expect the JIRA key in it).

**If the fetch fails** — no `JIRA_API_TOKEN` set, a network/auth error, or a 404 (which for a
restricted issue usually means the account behind the token isn't in the security group, not that
the key is wrong) — say so, then **ask the user directly** for whatever Step 4's mapping table needs
instead of guessing or stalling on the fetch. Ask specifically for: the title/summary; the
vulnerability description (impact, affected component, how to reproduce); affected version(s) and
fix version(s) if already decided; the reporter's name and whether they've agreed to be credited; and
a CVSS vector/score if one has already been agreed on. Draft with whatever they provide, and mark
anything still missing as an explicit `[TBD]` in the draft rather than inventing a value for it.

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
gh api repos/<owner>/<repo>/security-advisories --jq \
  '.[] | select(.state=="published") | {ghsa_id, summary, cvss: .cvss.vector_string}'
gh api repos/<owner>/<repo>/security-advisories/<ghsa_id> --jq '.description'
```

Only the more recent advisories have a CVSS table: older ones give the vector alone, so pick the
precedents among those that have one.

Match the **register** — tight and mechanism-specific, one sentence per row (e.g. "Reachable by a
guest, who does not need an account." rather than a generic "Low privileges needed") — not the
literal wording. This is wording inspiration only: the advisory's **section structure** still comes
exclusively from the live template fetched in Step 2, never from a past advisory's layout, and
past advisories are no example for the Impact section's level of detail (many contain a PoC, see
"No proof of concept in the advisory") nor for the version ranges (see "Affected products").

## Step 4 — Draft the advisory

Fill the template using the mapping below — from the JIRA fields fetched in Step 1, or from the
user's direct answers when that fetch failed. Leave nothing as a silent placeholder: flag anything
still missing to the user instead of guessing it.

**One advisory for several issues.** A vulnerability is sometimes filed as several JIRA issues, a
second one "for advisory packaging" (e.g. a separate impact of the same attack). They get **one**
advisory: its Impact describes each of them, its References list every issue, its affected products
cover the modules of all of them, and it carries a single CVSS score, the highest. Each issue keeps
the vector of its own impact in JIRA (`okf/servers/jira.md`) and gets the advisory link (Step 6).

**Don't hard-wrap the description.** GitHub renders every newline of an advisory description as a
line break, as it does in issue and pull request bodies, so a paragraph wrapped at 120 characters
shows up broken in the middle of its sentences. Write each paragraph, list item and table row on a
single line; only blank lines, headings, list items and table rows start a new line.

| Advisory field | Source |
|---|---|
| Title | JIRA `summary` |
| Impact prose | JIRA `description`'s explanation, rewritten as affected feature + attack vector + requirements + impact + affected versions, in your own words — **without the PoC** (see "No proof of concept in the advisory") and not a verbatim copy-paste of internal notes |
| CVSS table | The vector found in Step 1, valued per the Step 2 scoring guidance, worded per the Step 3 precedent for the *comment* column |
| Affected package(s) / vulnerable version range | The module(s) touched, and `versions` (Affects), verified against the code history → GitHub's version-range syntax — see "Affected products (packages) and version ranges" below, which also covers updating JIRA when they differ |
| Patches | `fixVersions` if the fix isn't released yet ("will be fixed in…"); the actual released versions + patch commit once it is |
| Workarounds | From the JIRA description if a mitigation is mentioned, else "no known workaround other than upgrading" |
| References | The JIRA issue URL, plus the fix commit's SHA/URL — use an explicit placeholder such as `[commit SHA once merged]` until the fix actually lands, matching the Patches row below |
| Credit / Attribution | `reporter`, or a named security researcher from the description — **ask the user to confirm the reporter consents to be credited** before naming them, and note that a non-committer reporter needs adding as a collaborator on the draft. Credit type (GitHub's definitions): `finder` for the person who discovered the vulnerability, also when they reported it themselves; `reporter` only for someone who passed on a finding that isn't theirs. The credits field isn't shown in the description, so also name their GitHub account in the Attribution section, as a link: `[@login](https://github.com/login)` |

CWE: pick the closest match from https://cwe.mitre.org/data/index.html — this is a per-vulnerability
judgment call, not something to default without reasoning about the actual flaw (e.g. broken access
control against a user-controlled identifier is usually CWE-639, missing authorization generally is
CWE-862, XSS is CWE-79, etc.).

### Affected products (packages) and version ranges

Follow GitHub's best practices
(https://docs.github.com/en/code-security/tutorials/fix-reported-vulnerabilities/write-security-advisories)
— fetch the page when in doubt, `https://docs.github.com/api/article/body?pathname=/en/code-security/tutorials/fix-reported-vulnerabilities/write-security-advisories`
returns it as Markdown. Ranges following that syntax let GitHub import the advisory into the
GitHub Advisory Database as "GitHub-reviewed" without asking for more information, and let
Dependabot alert exactly the affected users. Its own reference example is an XWiki advisory,
[GHSA-wcg9-pgqv-xm5v](https://github.com/advisories/GHSA-wcg9-pgqv-xm5v): follow its shape.

**Don't copy the ranges of past XWiki advisories.** Many were written by hand as a single
open-ended range (`> 1.9M1`) with a comma-separated list of every fix version, and GitHub's curators
rewrote them into per-branch bands when importing them into the Advisory Database — compare the
repository advisory of GHSA-22q5-9phm-744v (`> 1.9M1` / `15.10.14,16.4.6,16.10.0-rc-1`) with its
global advisory (three bands, one fix each). To check a precedent, read the *global* advisory
(`curl -s https://api.github.com/advisories/<ghsa_id> | jq '.vulnerabilities'`, no token needed),
not the repository one.

- **Ecosystem:** `maven`. **Package name:** the leaf module's `groupId:artifactId` that actually
  carries the vulnerable code — never an umbrella/parent artifact. Examples from past advisories:
  `org.xwiki.platform:xwiki-platform-oldcore`, `org.xwiki.platform:xwiki-platform-office-viewer`,
  `org.xwiki.platform:xwiki-platform-repository-rest-server`. More than one module affected → one
  set of **Affected product** entries per module, not a single combined one.
- **Legacy counterpart:** when the vulnerable module has a backward-compatibility module that also
  ships the vulnerable code, list it as its own **Affected product**, mirroring the main module's
  ranges and patched versions one-for-one. These modules live under
  `xwiki-platform-core/xwiki-platform-legacy/` and insert `legacy-` as an *infix* — the counterpart
  of `xwiki-platform-oldcore` is `xwiki-platform-legacy-oldcore`, not `xwiki-platform-oldcore-legacy`.
  It matters because the legacy artifact AspectJ-weaves the wrapped module's classes into itself
  (`weaveDependencies` in its pom, with the wrapped module at `provided` scope), so it carries its
  own copy of the vulnerable bytecode: an instance running the legacy jar is vulnerable, and a
  scanner matching only the main artifact would report it as clean. Confirm it actually wraps the
  vulnerable module rather than assuming from the name —
  `grep -A5 weaveDependencies xwiki-platform-core/xwiki-platform-legacy/<legacy-module>/pom.xml` —
  and skip it when the legacy module only re-exports unrelated deprecated APIs. Published precedent:
  GHSA-57q2-6cp4-9mq3, GHSA-r38m-cgpg-qj69 and GHSA-3738-p9x3-mv9r all pair
  `xwiki-platform-oldcore` with `xwiki-platform-legacy-oldcore` over identical ranges. When there is
  no counterpart, say so to the user, so that it's visible the check was made.
- **One band per fix:** one **Affected product** entry per branch that receives the fix, each with a
  lower *and* an upper bound — a field cannot hold several ranges. The oldest band starts at the
  first affected release, each following band at the first release of the branch after the
  previous fix (`>= 17.0.0-rc-1`, `>= 18.5.0-rc-1`, …), and each band ends at its own fix:

  | Vulnerable version range | Patched version |
  |---|---|
  | `>= 5.4.2, < 16.10.19` | `16.10.19` |
  | `>= 17.0.0-rc-1, < 17.10.14` | `17.10.14` |
  | `>= 18.0.0-rc-1, < 18.4.6` | `18.4.6` |
  | `>= 18.5.0-rc-1, < 18.9.0-rc-1` | `18.9.0-rc-1` |

  The releases *between* two bands (16.10.19 and later 16.10.x, …) are patched, so they're the gaps
  between the bands, not part of any band. Never leave the newest band without an upper bound: GitHub
  advises against a range with only a lower bound, because users of the fixed version keep getting
  Dependabot alerts. A vulnerability affecting only a prerelease gets `= <version>`, like
  `= 16.0.0-rc-1` → `16.0.0` in GHSA-wcg9-pgqv-xm5v (`=` matches only that exact version).
- **Patched version:** exactly **one version per band, the band's own upper bound** — the global
  advisory only keeps a single "first patched version" per band, which is what Dependabot suggests
  upgrading to. Don't list the fixes of the other branches: the other bands already express them.
  GitHub also rejects a patched version lower than the band's highest vulnerable version.
- **First affected release:** verify JIRA's "Affects Version/s" instead of taking it as is. Find the commit(s) that
  introduced the vulnerable code and take the lowest release tag that contains them —
  `git tag --contains <sha> | grep -E '^xwiki-platform-[0-9]' | sort -V | head` — which also catches
  backports to an older branch (XWIKI-24737: the code came with 6.0-milestone-1, but a backport put
  it in 5.4.2 already). When the attack also depends on something else (a bundled library version,
  another feature), check that it works in that release too, and tell the user when the attack
  differs in the older releases (e.g. only a weaker variant).
- **Module history:** check that each affected package existed under that `artifactId` over the
  whole affected range, since modules get renamed, split and merged: look for its `pom.xml` in the
  tag of the first affected release (`git ls-tree -r --name-only <tag> | grep '/<artifactId>/pom.xml$'`)
  and follow the vulnerable file back (`git log --follow --name-status -- <file>`). When the code
  lived in another module before, add **Affected product** entries for the old `artifactId` too,
  covering the releases up to the move, e.g. `>= 3.1-milestone-2, < 13.4-rc-1` → `13.4-rc-1`; and
  start the new module's first band at the release that introduced it. Example: templates of
  `xwiki-platform-web-templates` were in the WAR `xwiki-platform-web` until 13.4-rc-1 split it into
  `xwiki-platform-web-templates` and `xwiki-platform-web-war` (and in `xwiki-web-standard` before
  3.1-milestone-1) — GHSA-gr82-8fj2-ggc3 and GHSA-93gh-jgjj-r929 list both. Counterexample:
  GHSA-wf3x-jccf-5g5g lists only `xwiki-platform-web-war` from 4.2-milestone-3, so scanners miss
  every release before 13.4-rc-1, which shipped the code as `xwiki-platform-web`. Don't dig into
  ancient history: releases that old have more severe known vulnerabilities anyway, so going back
  further than a few years' worth of renames is rarely worth it — but a recent rename matters.
- **Repackaging modules:** some modules embed a copy of another module's artifact through a
  `maven-dependency-plugin` `<artifactItem>` (unpack/copy) — e.g. `xwiki-platform-web-war` unpacks
  `xwiki-platform-web-templates` into the WAR — so an installation can run the vulnerable code
  while only the repackaging artifact is visible. Find them with
  `rg -l --glob pom.xml '<artifactId>VULNERABLE_ARTIFACT_ID</artifactId>' | xargs grep -l artifactItem`,
  confirm the `<artifactItem>` really names the vulnerable module, and list the repackaging module
  as its own **Affected product** with the same bands (like a legacy counterpart; mind its own module
  history). The same applies to webjars bundling JavaScript built by `xwiki-platform-node`.
- **Keep JIRA in sync:** when the verified first affected release differs from JIRA's "Affects
  Version/s", or the patched versions from its "Fix Version/s", update the issue with the verified
  values (xwiki-jira skill; the field conventions are in `okf/servers/jira.md`), so that JIRA, the
  advisory and the Security Advisory Application agree. The same goes for the CVSS vector and score
  when the advisory's differ from the issue's (fields in `okf/servers/jira.md`). Without write access
  to JIRA (e.g. no token), tell the user exactly which values to set on which issue instead of
  leaving it silently out of sync.
  Optionally, also link the issue(s) that introduced the vulnerable code: the commits found for the
  first affected release name them.
- **Version string format:** the actual Maven version, as in the release tag — `18.7.0-rc-1`, never
  the `@since`-style `18.7.0RC1`. JIRA version names use the same syntax as Maven, so they can be
  used as is. Releases before 16.0 have no `.0` patch segment in
  milestones and release candidates (`15.0-rc-1`, `6.0-milestone-1`). GitHub's comparator treats a
  hyphenated suffix as a prerelease (`2.0.0-a` sorts *before* `2.0.0`) and compares it
  alphabetically, so a wrong format silently breaks the range. Up to 8.3, a branch's first
  release is its first milestone (`milestone` sorts before `rc`), so `>= 6.0-rc-1` would exclude
  6.0-milestone-1 and 6.0-milestone-2; take the lower bound from the tags.
- **Operator syntax:** only `>=` for lower bounds — `>` isn't supported by OSV and a global advisory
  only allows it as `> 0`; a single space between the operator and the version (`>= 1.0.0`); a comma
  and a space between the two bounds (`>= 1.0.0, < 2.0.0`); no leading or trailing spaces. For the
  upper bound, `< n` only when `n` is not vulnerable, i.e. is the patched version — otherwise
  `<= n` with the last vulnerable version (the OSV trap the live template flags in Step 2: you
  cannot write `< 17.10.9` unless `17.10.9` is the patched version).

## Step 5 — Save the draft

Write the full draft — both the metadata (title, CVSS vector/score, CWE, affected versions, credits)
and the markdown body for the GitHub advisory's description field — to a file under the work
directory, e.g. `<work>/<repo>/<date>-<JIRA-KEY>-security-advisory/advisory-draft.md`, headed with a
**CONFIDENTIAL, do not commit or post publicly** banner. Show it to the user in the conversation too.

## Step 6 — Creating the real draft advisory on GitHub (only when asked)

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
- Add a link to the draft advisory back on the JIRA issue(s) (a normal comment/field edit — safe since
  the issue is already restricted).
- Do **not** merge any fix through the advisory's temporary private fork via the GitHub UI — that
  leaks the JIRA title into the commit log. Use the manual merge recipe in
  [[security-policy]] (`okf/processes/security-policy.md`) instead.
- **Import the advisory into the Security Advisory Application on xwiki.org** — the step that is
  easiest to forget and the one with a deadline attached, because it is what computes the embargo
  duration and fires the disclosure reminders; skip it and nothing ever reminds anyone to disclose.
  Import from https://www.xwiki.org/xwiki/bin/view/SecurityAdvisoryApplication/Code/SingleAdvisoryImportPage
  once the GHSA content is final, then check the imported data, set the state to **completed**, and
  then to **announced** — the latter notifies everyone subscribed to new advisories. Re-import the
  same way whenever the advisory is edited afterwards. The app lives on xwiki.org and needs the
  `XWikiSecurityGroup` membership, so this is the user's action, not something to do for them:
  remind them of it, with the link, rather than treating the GHSA draft as the end of the job.
- **Request the CVE early.** A CVE ID can take a while to arrive and publication is blocked without
  one, so it is requested well before the embargo date is reached — not at disclosure time.
- Publishing/disclosing the advisory (making it public) happens only once the embargo date is
  reached **and** a CVE ID has been received — never publish opportunistically.

## Troubleshooting

- **JIRA fetch fails** (missing token, network/auth error, or 404) → don't block: ask the user
  directly for the missing fields (see Step 1) and draft from their answers. A 404 on a restricted
  issue usually means the account can't see it, not that the key is wrong.
- **No CVSS vector in `customfield_11870`** → it may not have been scored yet; compute it with the
  user using the Step 2 guidance and the official calculator (https://www.first.org/cvss/v4.0/)
  rather than guessing a score.
- **Fix not merged yet** → say so in the Patches section ("will be fixed in …") and put the
  `[commit SHA once merged]` placeholder in References, instead of inventing a commit; come back and
  fill in the real SHA/URL once it lands.
