# The eleven briefs

Each reviewer reads the shared contract (`reviewer-contract.md`, next to this file) and **only its
own section below**: another angle's brief blurs the lens it was given. A brief names **what to
load** and **what to look at**, never what the rule says — the rules live in the OKF and the skills.

A few checks have **no OKF or skill home** and are stated here, each marked *(skill-owned)*. That
marking is a to-do list, not a licence: anything general enough to belong in the OKF should move
there via the `xwiki-knowledge` EXTEND flow and be cited from here instead.

## Conventions

Load `okf/conventions/code-style.md`, `code-comments.md`, `commit-messages.md`, `logging.md` and
`naming.md`, plus `velocity-code-style.md` and `server-side-rendering.md` when a `.vm` file or a XAR
page changes. Enforce exactly what they say against the changed source files and the commit
messages. Note that `logging.md` is a decision table rather than a single rule — apply it as a
table, and do not reduce it to "use placeholders".

## Architecture

Load `okf/architecture/component-system.md`, plus `macro-refactoring.md` if a
macro is touched, `solr-search.md` if indexing is touched, and `wiki-user-scope.md` if user or group
visibility is touched. `okf/architecture/platform-modules.md` owns where new code goes, and
`okf/conventions/code-style.md` also carries component and module rules — read both here too. Add
`okf/conventions/script-services.md` when a script service is added or changed, and
`okf/conventions/dependencies.md` when a pom adds a third-party dependency. Look at: where new code
was placed relative to `oldcore`, how components are declared and registered, how the change gets at
context, the direction of any new module dependency, and whether a new third-party dependency passes
the acceptance checklist.

When the change adds a class or module, or restructures one (new public methods, moved
responsibilities, a new helper), also load `okf/architecture/module-design.md` and apply it to
those classes only — never to code the change merely calls. What it finds is `suggestion`-grade
(the contract says how to report it); the XWiki rules above stay the source of every other finding.

## Backward compatibility

Load `okf/conventions/backward-compatibility.md` and
`okf/conventions/versioning.md`. Look at every changed public or protected signature, interface,
`@Role`, `@Unstable` marker, `@since` and `@Deprecated`. Resolve the real current version from the
root `pom.xml` before judging any version string. Where the OKF prescribes a way to evolve an API,
apply *that* way — do not invent a stricter rule than the one written down. If the module is one
where Revapi's coverage differs, the OKF says so; take that into account rather than assuming.

## Defensive conventions

Load `okf/conventions/security.md` and the `xwiki-translations` skill.
Check the mechanisms those files require — is the escaper there, is the right check there, is the
untrusted value treated as untrusted — as a linter would.

This angle is deliberately *not* a vulnerability hunt. You are **not** assessing exploitability. Do
not reason about whether anything is attackable, do not consider what an attacker could do, do not
name a vulnerability class. Check the mechanism; if it is absent, say which mechanism is absent and
where. Nothing else. The contract's "Never write the word" section explains why this framing is the whole point and is
not optional.

Report a breach as the missing mechanism at a location: "line 42 writes `$doc.title` to the page
without `$escapetool.xml`". That sentence is the entire finding.

## Performance

Load `okf/conventions/performance.md` and apply it to every place the change
handles data whose size the user controls. *(skill-owned)* Also look for work that scales with the
data rather than with the request: a query issued inside a loop, an unbounded result set, an
unbounded cache, and per-request work whose result never changes.

## Tests

Load `okf/testing/strategy.md` and the `xwiki-test-guidelines` skill; add
`xwiki-fix-flickering-docker-test` when the change touches Docker `@UITest` code, and
`xwiki-increase-test-coverage` when a module's tests changed. Look at: what behaviour the change
introduces and whether a test now covers it, which level of test was chosen, and — for functional
tests — the patterns those skills call out as flicker-prone, and every new or edited `*IT` method
that knows the HTML or JavaScript, including a `By` handed to a page-object method (page-object
boundary in `okf/testing/strategy.md`), and every wait the test performs right after a page-object
action that the action itself could have done ("a page-object action waits for its own outcome"). A new `@Test` method, or a new `*IT`
class, that rebuilds a fixture an existing one in the same module already builds is itself a
finding: functional tests are scenarios, and the fixture is what costs (scenario rule in
`okf/testing/strategy.md`).

`xwiki-test-guidelines` is a pointer file: the rule for **which level of test to write** is not in
it but on the page it links, `dev.xwiki.org/.../Community/Testing/#HTestingStrategy`. Fetch that
page before judging a test-level choice, and cite it as the terminal source. Judging the level from
the skill alone means judging it from nothing.

## Accessibility

Load `okf/conventions/frontend.md` — its "HTML, CSS, accessibility" section names
the WCAG version and level XWiki has committed to, and the traps for markup emitted from a wiki page
or sheet (naming a control, `[[image:]]` alt text, `col-xs-*`). **Read the level from that file; never
state it from memory** — it moves as XWiki re-commits, and a reviewer told the wrong version cites
criteria against a standard the project does not hold. Then judge changed UI markup and behaviour
against it: name and role for every control, keyboard operability, focus management across dialogs and
panels, form labelling, text alternatives, meaning never carried by colour alone, contrast, and
heading structure. Cite each success criterion by number, name and URL.

## i18n & UX

Load the `xwiki-translations` skill, which owns both the externalisation rules and
the word-order rules for composing a translated sentence, and `okf/conventions/translations.md`,
which owns the key lifecycle (which bundle is edited, and what happens to a key that is removed or
moved). *(skill-owned)* Also look at the UX of
what the change adds: whether an error message tells the user what to do next, whether a new flow
has an empty state and a failure state, and whether new labels match the vocabulary already used in
that part of the UI.

## Documentation

Load `okf/conventions/documentation.md` and the `xwiki-javadoc` skill. Look at:
new or changed public API and whether its Javadoc explains contract rather than restating the
signature; whether a user-visible change needs a documentation or release-note update;
*(skill-owned)* whether a new configuration property is documented where users will look for it, and
whether the change has just made a statement in a `README` or `CLAUDE.md` false.

## Data & migration

Load `okf/architecture/solr-search.md` when the index is touched, the
`xwiki-xar-pages` skill and `okf/architecture/required-rights.md` when a XAR page is touched, and `okf/architecture/wiki-application-data.md`
when the change touches an XClass, a generated page name or a wiki-page migration — that file owns
the list-property storage rule, page-name allocation and the idempotency rule, so cite it rather than
reasoning from first principles; load `okf/architecture/data-migrations.md` when the change adds or
edits an `R*XWIKI*` data migration or a `TaskConsumer`. Look at: a mapping or stored format changed without a migration, a
migration that is not idempotent or re-runs on an already-migrated instance, a migration whose cost
scales with table size, an XClass property whose stored type does not match the comparisons made on
it, and an index change with no reindex path. *(skill-owned: Java store code other than data migrations,
and `*.hbm.xml` mapping changes, still have no OKF home.)*

## Spec conformance

Compare the diff against the JIRA issue title and description. Report:
requirements the issue asks for that the diff does not deliver; behaviour in the diff nobody asked
for (scope creep that should be its own issue); requirements implemented in a way that will not
actually fix the reported symptom. Quote the issue text for each. If the commit subject is not the
issue title verbatim, that is a finding here.
