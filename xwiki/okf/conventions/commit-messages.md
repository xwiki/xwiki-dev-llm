---
title: Commit message convention
stability: durable
summary: The summary line is the JIRA key followed by the issue's title verbatim, with what this
  particular commit does listed as bullets in the body; or [Misc] when there is no issue.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/IssueTracker/JIRA/#HRule%3AAlwaysputaJIRAissuereferenceincommitmessages
  - https://dev.xwiki.org/xwiki/bin/view/Community/DevelopmentPractices
---

# Commit message convention

The documented format is:

```
<JIRA ID, e.g. XWIKI-1000>: <JIRA issue description>
 * <details>
 ...
 * <details>
```

- **The text after the key is the issue's *title*, reproduced verbatim — not a summary you write for
  the commit.** This is the part most often got wrong, because `XWIKI-12345: <summary>` reads like an
  invitation to compose a new sentence. Copy the title so that JIRA, the generated release notes and
  the commit log all say the same thing. Use the repo's own project key — `XCOMMONS-…`,
  `XRENDERING-…`, or the contrib extension's key.
- **What *this* commit does belongs in the body**, as `*` bullets. That is what distinguishes several
  commits sharing one issue — an umbrella issue for a campaign, or a change split across repos or
  modules — since their summary lines are by definition identical.
- Corollary: the title is reused verbatim on every commit referencing the issue, so **it must read
  well as a commit summary**. Word it with that in mind (JIRA's own "use nice user-friendly titles"
  rule pushes the same way), and do not reword it casually afterwards.
- Use **`[Misc]`** when there is genuinely no issue. The dev wiki scopes this to trivial things —
  "adding a small javadoc, renaming a single variable, cosmetic changes, ignore files". The test for
  whether an issue is required is *"is my change going to affect any user or any extension developer
  in any way?"*; if yes, an issue is mandatory. A batch refactoring that changes runtime behaviour
  across many files therefore needs an issue, referenced from every commit of the campaign — not
  `[Misc]`.
- **Dependency upgrades split on the same test:** a dependency that only ever reaches developers —
  a `devDependencies`/`peerDependencies` entry, a build or test-scoped Maven dependency — is
  `[Misc]`; one that ships to users (declared in `dependencies`, or a runtime Maven dependency)
  needs an issue. Check where the dependency is actually declared before choosing: a shared version
  catalog (pnpm `catalog:`, a `pom.xml` property) hides that distinction, and the same artifact can
  be dev-only in one module and runtime in another — one runtime declaration is enough to require
  the issue.

Issue tracker is https://jira.xwiki.org (NOT GitHub Issues); see [[jira]] for access and the
issue-field conventions. For the full PR/commit flow (one squashed commit per issue, PR description,
backports) use the `xwiki-pull-request` skill.

**Security fixes are the exception:** until an issue is officially disclosed, the public commit
message must be **obfuscated** — describe the mechanical change, never that it closes a vulnerability
or how it was exploitable. This overrides the copy-the-title rule, since the title would leak the
nature of the issue. See [[security-policy]].
