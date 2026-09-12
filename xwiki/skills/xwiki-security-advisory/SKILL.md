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
  `h2. Impact` / `h2. PoC` structure you can lift from directly), `security` (confirms it's
  restricted), `priority`, `versions` (Affects), `fixVersions`, `reporter`.
- Scan `customfield_*` values for a **CVSS vector string** (starts `CVSS:4.0/…` or `CVSS:3.1/…`) and
  its paired numeric score — instances number these fields differently, so grep for the shape, don't
  hardcode a field id.
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

Take the `content` field (xwiki/2.1 syntax). Two parts of it matter:

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

Match the **register** — tight and mechanism-specific, one sentence per row (e.g. "Reachable by a
guest, who does not need an account." rather than a generic "Low privileges needed") — not the
literal wording. This is wording inspiration only: the advisory's **section structure** still comes
exclusively from the live template fetched in Step 2, never from a past advisory's layout.

## Step 4 — Draft the advisory

Fill the template using the mapping below — from the JIRA fields fetched in Step 1, or from the
user's direct answers when that fetch failed. Leave nothing as a silent placeholder: flag anything
still missing to the user instead of guessing it.

| Advisory field | Source |
|---|---|
| Title | JIRA `summary` |
| Impact prose | JIRA `description`'s explanation/PoC, rewritten as impact + affected versions, in your own words — not a verbatim copy-paste of internal notes |
| CVSS table | The vector found in Step 1, valued per the Step 2 scoring guidance, worded per the Step 3 precedent for the *comment* column |
| Affected package(s) / vulnerable version range | The module(s) touched, and `versions` (Affects) → GitHub's version-range syntax — see "Affected products (packages) and version ranges" below |
| Patches | `fixVersions` if the fix isn't released yet ("will be fixed in…"); the actual released versions + patch commit once it is |
| Workarounds | From the JIRA description if a mitigation is mentioned, else "no known workaround other than upgrading" |
| References | The JIRA issue URL, plus the fix commit's SHA/URL — use an explicit placeholder such as `[commit SHA once merged]` until the fix actually lands, matching the Patches row below |
| Credit / Attribution | `reporter`, or a named security researcher from the description — **ask the user to confirm the reporter consents to be credited** before naming them, and note that a non-committer reporter needs adding as a collaborator on the draft |

CWE: pick the closest match from https://cwe.mitre.org/data/index.html — this is a per-vulnerability
judgment call, not something to default without reasoning about the actual flaw (e.g. broken access
control against a user-controlled identifier is usually CWE-639, missing authorization generally is
CWE-862, XSS is CWE-79, etc.).

### Affected products (packages) and version ranges

Follow GitHub's guide
(https://docs.github.com/en/enterprise-cloud@latest/code-security/tutorials/fix-reported-vulnerabilities/write-security-advisories)
together with the pattern every already-published XWiki advisory uses (check a couple with `gh api
repos/<owner>/<repo>/security-advisories/<ghsa_id> --jq '.vulnerabilities'`, same as in Step 3):

- **Ecosystem:** `maven`. **Package name:** the leaf module's `groupId:artifactId` that actually
  carries the vulnerable code — never an umbrella/parent artifact. Examples from past advisories:
  `org.xwiki.platform:xwiki-platform-oldcore`, `org.xwiki.platform:xwiki-platform-office-viewer`,
  `org.xwiki.platform:xwiki-platform-repository-rest-server`. More than one module affected → one
  **Affected product** entry per module, not a single combined one.
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
  `xwiki-platform-oldcore` with `xwiki-platform-legacy-oldcore` over identical ranges.
- **Vulnerable version range:** XWiki advisories are consistently a single open-ended lower bound,
  `>= <oldest known affected version>`, with **no upper bound** — the flaw is present in every
  release up to the fix. Only add an upper bound if the vulnerable code path was independently
  removed or replaced before the security fix landed.
- **Patched version(s):** list **every maintained branch's fix version** on the same entry — XWiki
  backports a security fix to all currently supported branches at once, so one Affected product
  typically carries several patched versions (one per branch), not just the newest.
- **Version string format:** the dashed dev-version notation, e.g. `18.7.0-rc-1`, never the
  JIRA/`@since`-style `18.7.0RC1` — GitHub's comparator treats a hyphenated suffix as a prerelease
  (`2.0.0-a` sorts *before* `2.0.0`), so getting this wrong silently breaks the range.
- **Operator syntax:** a space between the operator and the version (`>= 1.0.0`, not `>=1.0.0`); a
  comma **and** a space between the two bounds of one range (`>= 1.0.0, <= 2.0.0`); `<=` when the
  named version is itself the patched one, `<` when it's the first *unpatched* one — this is exactly
  the OSV exclusive-upper-bound trap the live template already flags in Step 2 (you cannot write
  `< 17.10.9` unless `17.10.9` is also a patched version — write `<= 17.10.8` instead). A single
  field cannot express a disjoint range (e.g. two separate vulnerable bands): use two Affected
  product entries for the same package instead of trying to combine them.

## Step 5 — Save the draft

Write the full draft — both the metadata (title, CVSS vector/score, CWE, affected versions, credits)
and the markdown body for the GitHub advisory's description field — to a file under the work
directory, e.g. `<work>/<repo>/<date>-<JIRA-KEY>-security-advisory/advisory-draft.md`, headed with a
**CONFIDENTIAL, do not commit or post publicly** banner. Show it to the user in the conversation too.

## Step 6 — Creating the real draft advisory on GitHub (only when asked)

Drafting the text is safe to do proactively; actually creating the GitHub Security Advisory is a
repo-visible action (visible to all org owners immediately) and must be explicitly requested, not
assumed. When the user asks for that step:

- Create it via `gh api repos/<owner>/<repo>/security-advisories -X POST -f ...` or point the user to
  the GitHub UI flow linked from the template section (both are described in
  https://docs.github.com/en/code-security/security-advisories/repository-security-advisories/creating-a-repository-security-advisory).
- Add the **`XWiki/Security`** GitHub team as a collaborator on the draft — the policy page calls
  this out explicitly as an easy thing to forget.
- Add a link to the draft advisory back on the JIRA issue (a normal comment/field edit — safe since
  the issue is already restricted).
- Do **not** merge any fix through the advisory's temporary private fork via the GitHub UI — that
  leaks the JIRA title into the commit log. Use the manual merge recipe in
  [[security-policy]] (`okf/processes/security-policy.md`) instead.
- Publishing/disclosing the advisory (making it public) happens only once the embargo date is
  reached **and** a CVE ID has been received — never publish opportunistically.

## Troubleshooting

- **JIRA fetch fails** (missing token, network/auth error, or 404) → don't block: ask the user
  directly for the missing fields (see Step 1) and draft from their answers. A 404 on a restricted
  issue usually means the account can't see it, not that the key is wrong.
- **No CVSS vector found in `customfield_*`** → it may not have been scored yet; compute it with the
  user using the Step 2 guidance and the official calculator (https://www.first.org/cvss/v4.0/)
  rather than guessing a score.
- **Fix not merged yet** → say so in the Patches section ("will be fixed in …") and put the
  `[commit SHA once merged]` placeholder in References, instead of inventing a commit; come back and
  fill in the real SHA/URL once it lands.
