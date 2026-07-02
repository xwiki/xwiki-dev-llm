---
title: Security severity & disclosure process
stability: durable
summary: How XWiki rates security issues (CVSS 4) and the rule that a vulnerability is never revealed
  publicly until disclosure — obfuscated commit messages and restricted JIRA security issues.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/SecurityPolicy/
verify: |
  The CVSS thresholds and the privileges-required mapping can be refined by the community — do not
  quote the numbers below as gospel. Re-read the Security Policy page (the `sources:` URL) when the
  exact scoring matters.
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

## Severity scoring — CVSS 4 (volatile thresholds — verify)

Severity is computed with a CVSS 4 calculator. As policy *structure* (re-verify the exact numbers):

- **Critical** vs **Major** is split by the CVSS score (Critical at the higher band); a committer may
  raise to Critical below the threshold for high system impact or another strong argument, and an
  actively-exploited issue may be classed **Blocker**.
- **Privileges Required** maps CVSS's discrete scale to XWiki's continuum of rights:
  *None* = doable by Guest (incl. Guest with Comment right); *Low* = a registered user with standard
  rights; *High* = needs more than standard rights (e.g. Script right on 14.10+, space admin, wiki
  Delete). "Standard rights" means the bundled XWiki Standard scheme.
- For an **XSS** vulnerability, Confidentiality and Integrity impact are both set to **High**.

## Related

- [[security]] — the secure-coding conventions (escaping, untrusted input, right checks) that prevent
  these issues in the first place.
- [[commit-messages]] — the normal commit convention; security fixes are the obfuscated exception.