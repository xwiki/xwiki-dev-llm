# Affected products (packages) and version ranges

Read by `xwiki-security-advisory` before it writes any affected product or range (Step 4). Every
advisory needs all of it. "Step 2" and the other step numbers are those of that skill's `SKILL.md`.

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
  `git tag --contains <sha> | grep -E '^xwiki-platform-[0-9.]+(-(milestone|rc)-[0-9]+)?$' | sed -E 's/-(milestone|rc)/~\1/' | sort -V | sed 's/~/-/' | head`
  (the `~` sorts `16.0.0-rc-1` before `16.0.0`; a plain `sort -V` puts it after). It also catches
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
  when the advisory's differ from the issue's (fields in `okf/processes/security-policy.md`), and for
  the **Priority**, which the policy derives from the score (Step 2's "Severity" section). Without write access
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
