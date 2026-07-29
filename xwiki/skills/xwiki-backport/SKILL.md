---
name: xwiki-backport
description: Backport any change (bug fix, feature, refactor, or test) to an older branch of an XWiki repo (xwiki-platform / xwiki-commons / xwiki-rendering / xwiki-contrib). Cherry-pick `-x` the source commit(s) into a worktree, ADAPT the result to the older branch (module pom versions, Java level, `@since` tags, style/API divergence), verify it compiles against that branch, and push / open a PR. Use whenever a commit that exists on one branch needs to be applied to an older/maintenance branch. For the `testneeded`-labelled test sweep use xwiki-backport-testneeded (which builds on this skill); for Maven commands use xwiki-build; for PR/commit conventions use xwiki-pull-request; for the versioning/`@since` conventions (the format and what carries `@since`) use xwiki-knowledge.
---

Apply a change that exists on one branch (the **source** — often `master`, but it can be any newer
branch) to an **older branch**, **adapt it to that branch**, verify it compiles, and push / open a PR.

Related skills: **xwiki-backport-testneeded** (the `testneeded` sweep + `@since` layer — it delegates
the mechanics here), **xwiki-build** (Maven), **xwiki-pull-request** (PR/commit conventions),
**xwiki-knowledge** (versioning / `@since` in the OKF).

> A cherry-pick copies file bytes **verbatim**. That is exactly why backports break: the source
> content assumes the source branch's module versions, Java level, and surrounding code. §3 (Adapt to
> the branch) is the heart of this skill — do not skip it even when the cherry-pick applied cleanly.

## 1. Establish the inputs first

- **What to backport:** an explicit list of commit SHAs, or a JIRA issue key (`XWIKI-nnnnn`, also
  `XCOMMONS-`/`XRENDERING-` in their own repos) — find its commits with
  `git log <source-branch> --oneline --grep=<KEY>`. An issue often has **several** commits (initial
  change + follow-up fixes); take **all** of them.
- **The target branch(es).** Usually the user names them. If you need to *derive* whether a branch
  needs the change (e.g. from an issue's JIRA `fixVersions`): it needs branch **B** only if the change
  landed **after** B was cut **and** is **not** already released on B's line. (Do not hardcode which
  branches are supported — that changes every release; ask or infer from the last patch release of
  each active line.)
- **The target branch's version**, read from its root `pom.xml` `<version>` (e.g.
  `17.10.10-SNAPSHOT`). Needed for the pom-version check (§3.A) and the `@since` adjustment (§3.D).
- **The target branch's Java level.** It depends on the XWiki version and differs across lines (newer
  lines use newer JDKs). Do NOT hardcode — resolve it from the version via the Java Support Strategy
  (linked from the org instructions / `dev.xwiki.org`), or read the branch's effective build config.
  Needed for the Java-compatibility check (§3.B); have the matching JDK installed to verify.

## 2. Cherry-pick oldest-first, in an isolated worktree

Work in a dedicated git worktree so the current checkout is undisturbed. Cherry-pick the commit(s)
**oldest-first** with `-x` (records the source SHA in the message):

```
git worktree add <path> origin/<target-branch>
git checkout -B backport/<target-branch>/XWIKI-nnnnn origin/<target-branch>
git cherry-pick -x <sha>...        # oldest-first; resolve conflicts per §4.C
```

**Dry-run first when unsure:** attempt the cherry-pick in a throwaway worktree and record CLEAN vs
CONFLICT (and the conflicting files) before committing to the work. Note that `git cherry-pick`'s
conflict list does **not** distinguish a content conflict from a **modify/delete** conflict — the
latter means the file/module does not exist on the target branch (a structural blocker, §4.C).

The `backport/<target-branch>/XWIKI-nnnnn` name mirrors the auto-backport bot's
`backport/<target-branch>/pr-<n>` scheme.

## 3. Adapt to the branch — the part that actually matters

Run **all four** checks below after every cherry-pick, clean or conflicted.

### 3.A — Module pom versions (MANDATORY, fires even on a clean cherry-pick)

When a commit **adds a new module** (or any new `pom.xml`), the cherry-pick brings that pom in
verbatim with the **source branch's** `<parent><version>` (e.g. `18.5.0-SNAPSHOT`). There is no
conflict — the directory is new — so a conflict-only review misses it. **Always** sweep:

```
# every pom the backport touched, plus a full sweep for the source version string on the branch:
git grep -n "<SOURCE-VERSION>-SNAPSHOT" -- '**/pom.xml'
```

Set each such `<parent><version>` (and any hardcoded dependency version) to the **target branch**
version (`17.10.10-SNAPSHOT`, `18.4.3-SNAPSHOT`, …).

**Why this breaks the build (and why it's insidious):** a mis-versioned module builds as a
`<source-version>-SNAPSHOT` artifact inside the target reactor, so it resolves its siblings (e.g.
`xwiki-platform-test-docker:${project.version}`) from the **remote repository** — a snapshot that
**freezes** the moment that source line version-bumps to its next dev version — instead of the
reactor's fresh build for this branch. Any symbol added to that sibling *after* the freeze then fails
with `cannot find symbol`. The failure is **latent**: each backport PR can pass CI in isolation, and
the branch build breaks only later, when some module first references a post-freeze symbol (this is
exactly how a merged batch of backports can leave a green-looking branch that no longer builds).

### 3.B — Java-language / API level

A newer source branch targets a newer JDK than an older target branch, so cherry-picked code may use
APIs the target's Java level does not have. It compiles on the source (green source CI) and fails
**only** on the older branch. Determine the target's Java level (§1) and scan the cherry-picked code
for newer-than-target APIs, downgrading them to the branch-supported equivalent.

Classic offender — **Java 21 `SequencedCollection`** methods on a `List`/`Collection`, absent on
Java 17:
- `list.getFirst()` → `list.get(0)`
- `list.getLast()`  → `list.get(list.size() - 1)`
- `list.reversed()`, `list.addFirst(...)`, `list.removeLast()` → the pre-21 idiom.

```
git grep -nE "\.(getFirst|getLast|reversed|addFirst|addLast|removeFirst|removeLast)\(" -- '**/*.java'
```

⚠ Filter by the **receiver's type**: the same method names exist (and are fine) on `Deque`,
`LinkedList`, `Comparator.reversed()`, and JAX-RS `MultivaluedMap`/headers — those predate Java 21.
Only `List`/`Collection` receivers are the Java-21 additions to change. A method reference like
`ping.getDate().getFirst()` on a **domain** type is also fine. When in doubt, the compile in §5 is
the arbiter.

### 3.C — Conflict resolution (when the cherry-pick does conflict)

- **Test-suite aggregators (`AllIT.java`) / `@Nested` class lists:** add the new class alongside the
  existing entries, but do NOT pull in sibling classes that exist only on the source branch (e.g. a
  `NestedEditingIT extends EditingIT` when `EditingIT` isn't on the target) — that breaks compilation.
- **A raw conflict can span code from OTHER issues.** A literal "keep both sides" can pull in helper
  methods/overloads the target doesn't have. Add **only** what this commit introduces, and verify
  every API it calls actually exists on the target branch.
- **Style divergence** (target uses `Arrays.asList(...).stream()` where the source switched to
  `Stream.of(...)`, etc.): keep the target branch's style, apply only the commit's semantic change.
- **Structural blocker → abort, don't force.** If the change depends on a whole module/file that is
  new on the source and absent on the target (surfaces as a **modify/delete** conflict), backporting
  it drags that infrastructure onto the older branch. That is a maintainer decision: abort that
  branch, report exactly what's missing (and any prerequisite issue that would have to be backported
  first), and leave it for manual handling.
- **A backport that reproduces the original commit's `--stat` (files/insertions) is a strong
  correctness signal.**
- **Independent backport PRs touching the same file on the same branch** will conflict at merge time
  (the second to merge needs a rebase). Flag it; it's expected.

### 3.D — `@since` tags (fires whenever the change carries `@since`)

If any cherry-picked commit adds new public API — or an `@Deprecated(since = "…")` — carrying an
`@since` tag, that tag lists the versions in which the API becomes available. Backporting makes it
available in the **target branch's next release** too, so the tag must be adjusted. `@since` is
Javadoc, so it does **not** surface as a compile error (§5 won't catch it) — this is a review check.
Backporting **adds** `@since` lines, it never replaces the existing ones. Two things to verify:

- **The target branch's line is present.** Add `@since <target-next-release>` (three numeric
  segments, e.g. `17.10.10`, `18.4.3` — the version this target branch will next release, §1) —
  unless it is already there.
- **The source branch you cherry-picked from also carries it.** The `@since` block must be
  **identical on every branch the code lives on**, the source/master included. So the version line(s)
  you added here must also exist on the source branch (and on every other branch that received the
  backport); if the source's block is missing a line, fix it there too (a separate `@since` commit /
  PR on the source branch) — otherwise the branches drift.

Decide the lines **empirically**, one per version-line, **ascending** by version number: inspect what
each branch already carries (`git show origin/<branch>:<path>` for the file) and add only the missing
lines. **Never invent an `@since`** where the source code did not already have one.

For the exact format and *which elements* carry `@since` (reusable classes/members — `internal` ones
and test tools such as page objects and test frameworks included — versus the tests themselves, which
carry none), see the versioning convention via **xwiki-knowledge**.

## 4. When a backport branch goes stale (base moved under it)

If the target base advanced after you branched (another PR merged and touched the same files), do
**not** hand-resolve a rebase of your already-adapted commits — that replays stale hand-edits against
a moved base. Instead: **reset the branch to `origin/<target-branch>` and re-`cherry-pick -x` the
original source commit(s)**, then re-apply any layered edits (pom versions §3.A, `@since`, …). Cleaner
and more faithful. If the source commit itself still conflicts (genuine overlap), resolve to match the
source's final state, adapting only to the target branch's existing style/APIs (§3.C).

## 5. Verify

Compiling the changed modules **with the target branch's JDK** catches both §3.A and §3.B (both
surface as compile errors) — do this before pushing:

```
# from the changed module dir, with JAVA_HOME set to the target branch's JDK:
mvn -B -ntp -Plegacy -DskipTests test-compile
```

- To exercise §3.A honestly you must first **rebuild the sibling artifact from the branch** (e.g.
  `mvn install -DskipTests` in the changed `*-test-docker` / `*-pageobjects` module), because the
  cached/remote snapshot may predate the symbol you rely on. Then compiling the dependent module
  proves it resolves the reactor build, not the stale snapshot.
- **Page-object gotcha:** building only a leaf `*-test-docker` module fails to compile a backported
  test when the sibling `*-test-pageobjects` (holding a newly-added page-object API) is pulled as a
  *published* dependency without the new class. First `install` the changed page-object module(s) from
  the branch (or build from the reactor root with `-pl <module> -am`). CI builds the full reactor so it
  doesn't hit this.
- **CI on each PR is authoritative** for functional runs on real infrastructure. To run a Docker IT
  locally as a demo, use the `xwiki/build` DockerHub image (github.com/xwiki/xwiki-docker-build),
  mounting the docker socket (Docker-out-of-Docker) and your `~/.m2`:
  ```
  docker run --rm [--platform linux/amd64] \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v <worktree-on-backport-branch>:/root/xwiki-platform -v $HOME/.m2:/root/.m2 \
    --entrypoint /bin/bash xwiki/build -c "cd /root/xwiki-platform/<test-docker-module> && \
      /home/hudsonagent/maven/bin/mvn -B -ntp verify -Plegacy,integration-tests,docker \
        -Dit.test=<TheIT> -Dxwiki.checkstyle.skip=true -Dxwiki.surefire.captureconsole.skip=true \
        -Dxwiki.revapi.skip=true -Dxwiki.enforcer.skip=true -Dxwiki.license.skip=true"
  ```
  Caveats: the image is **amd64-only** — on Apple silicon it runs under emulation and spins up more
  emulated containers per test, so runs are slow/flaky. A common local failure is Docker-out-of-Docker
  networking (Testcontainers `Could not connect to Ryuk`): the test compiles and is discovered, then
  the *environment* fails to come up — infra, not a backport defect. Prefer CI; use the local run only
  to prove the code compiles and the test is picked up. If a test itself flickers, see
  **xwiki-fix-flickering-docker-test**.

## 6. Push / open the PR

```
git push origin backport/<target-branch>/XWIKI-nnnnn
gh pr create --repo <org>/<repo> --base <target-branch> --head backport/<target-branch>/XWIKI-nnnnn \
  --assignee <you> --title "[<target-branch>] XWIKI-nnnnn: <original summary>" \
  --body "<what/why + cherry-picked SHAs>"
```

(When the target branch's build is already broken and the user asks to push directly rather than via a
PR, commit on the branch and `git push origin HEAD:<target-branch>` — still run every §3 check and §5
verify first. Follow xwiki-pull-request for commit-message conventions.)

## Notes
- Do the work in an isolated git worktree so it doesn't disturb the current checkout.
- Checkpoint progress (branch decision, PR numbers, which §3 fixes were applied) if the run is long,
  so a session reset / rate-limit pause can resume cleanly.
