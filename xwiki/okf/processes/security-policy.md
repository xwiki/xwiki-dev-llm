---
title: Security severity & disclosure process
stability: durable
summary: How XWiki rates security issues (CVSS 4) and the rule that a vulnerability is never revealed
  publicly until disclosure — obfuscated commit messages and restricted JIRA security issues.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/SecurityPolicy/
verify: |
  Every CVSS metric value and the Critical/Major threshold are set by policy and can be refined by
  the community. Do not score from this file: read the Security Policy's "Best practices for
  computing CVSS" section (linked in the scoring section) and take each metric from it. What is kept
  below is XWiki's *interpretation* — how its rights map onto the scale, and the traps — not values.
---

# Security severity & disclosure process

The Security Policy page is the source of truth. This file captures the durable shape of the process
plus the one rule that must never be broken when committing.

## Do not disclose a vulnerability publicly until it is disclosed (durable rule)

XWiki repos are public, so a fix can be a zero-day signpost. Until the issue is officially disclosed:

- **Never describe the vulnerability in anything public** — commit messages, PR titles/descriptions,
  GitHub issues/comments, public forum/chat. Use an **obfuscated** commit message that says *what*
  changed mechanically, not *that it closes a security hole* or *how it was exploitable*.
- Track the real issue as a **JIRA issue with a restricted security level** (visible only to the
  security group), not as a public ticket. Security discussion happens on the
  committer-private/security mailing list (see [[index]] in `servers/`).
- Code comments must never carry a live exploit description either — see [[code-comments]].

This is why a security fix's public commit looks deliberately mundane.

## Merging a non-committer's security pull request

Such a PR lives in the **temporary private fork** of the GitHub security advisory, and it is **not
merged through the GitHub UI** — the UI gives too little control over the merge message (which must
stay obfuscated, per the rule above). Do it by hand:

```
git remote add ghsa-xxxx-xxxx-xxxx git@github.com:xwiki/xwiki-platform-ghsa-xxxx-xxxx-xxxx.git
git fetch ghsa-xxxx-xxxx-xxxx
git merge --squash ghsa-xxxx-xxxx-xxxx/<branch>
# adjust what needs adjusting (e.g. @since tags), then:
git commit --author="Contributor Name <contributor@example.org>"   # credit the contributor
git push
git remote remove ghsa-xxxx-xxxx-xxxx
```

The squash commit's message defaults to every original message concatenated — replace it with one
clean (obfuscated) message. Finish with **"Delete temporary private fork"** on the GitHub advisory.

## Severity scoring — CVSS 4 (read the source before scoring)

XWiki **fixes several metric values by policy**, and they do not match a calculator's defaults or
generic CVSS instinct. So never score from memory: read
[Best practices for computing CVSS](https://dev.xwiki.org/xwiki/bin/view/Community/SecurityPolicy/#HBestpracticesforcomputingCVSS)
first and take **every** metric from it, then compute with a CVSS 4 calculator. What follows is only
which metrics are constrained and where the traps are — never a substitute for that read. The
per-metric values themselves are not cached here, nor in the `xwiki-security-advisory` skill's
Step 2, which reads the same section live.

- **Attack Vector** is fixed by policy for every XWiki vulnerability — take it from the source
  rather than reasoning about the exploit path.
- **Privileges Required** maps CVSS's discrete scale to XWiki's continuum of rights:
  *None* = doable by Guest (incl. Guest with Comment right); *Low* = a registered user with standard
  rights; *High* = needs more than standard rights (e.g. Script right on 14.10+, space admin, wiki
  Delete). "Standard rights" means the bundled XWiki Standard scheme.
- Some **vulnerability classes fix their impact metrics outright** (XSS and SSRF both do), on the
  subsequent system as well as the vulnerable one. The trap: asserting high *subsequent* impact
  claims the finding is code execution rather than XSS, so it has to be established, never assumed.
- A **right required to exploit** can cap the impacts (Script right does). The trap: the caveat is
  about the right the attack *needs*, not the right it *yields* — escalating from a right that is
  already powerful is not scored as critical.
- **Attack Complexity**, **Attack Requirements** and **User Interaction** have no XWiki best practice
  — use the official CVSS definitions. Merely *viewing* a page is **passive** interaction, not none.
- **Critical** vs **Major** is split by the CVSS score (Critical at the higher band); a committer may
  raise to Critical below the threshold for high system impact or another strong argument, and an
  actively-exploited issue may be classed **Blocker**.

## Related

- [[security]] — the secure-coding conventions (escaping, untrusted input, right checks) that prevent
  these issues in the first place.
- [[commit-messages]] — the normal commit convention; security fixes are the obfuscated exception.