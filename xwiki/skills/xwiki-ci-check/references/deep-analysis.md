# Deep analysis: the Develocity history and the build scan

Read by `xwiki-ci-check` (SKILL.md §3) before root-causing a `deep` class 1 incident, which
carries `develocity`, and before a second attempt on a class 2 build break whose stage log came
back `unclassified`. Nothing here writes; § numbers are those of SKILL.md.

| Field | Meaning |
|---|---|
| `develocity` | on a `deep` class-1 incident: 28 days of that test's executions everywhere it runs — `failures`/`runs` and `failRate`, `firstSeen` (when it *started*, as against `ageDays`), the failure group this incident is, the configurations it concentrates in with their rates, the analyser's own `findings` with their p-values, build scans, any archived screenshot/video, and `report`, the full report already on disk. Absent when Develocity is unreachable — `summary.develocity` says why |
| `ageDays` | A `deep` test breakage is walked back to its last green over everything Jenkins retains (`--blame-history`) |

- **A class 1 incident arrives with its Develocity history already in it.** Jenkins retains eight
  builds of one branch; Develocity holds every execution of that test for 28 days, across every
  branch, browser, database and servlet container, grouped by what actually failed — and the sweep
  reads it for you, once per deep class 1 incident, into `develocity`. **Reason from that field,
  not from the stage log**, and report its numbers rather than inferring your own: they carry
  p-values, and a rephrased p-value is a hedge turned into a claim.

  On `AllIT$NestedImageIT#editImage` the sweep's own count says `1/7 builds, 1/4 envs`; `develocity`
  says 6 failures in **347** executions, every one of them on **Chrome** (p=0.0008), first seen on
  2026-08-25, with ~30 consecutive clean runs needed before a fix could be claimed. That is the
  difference between naming a red square and knowing what to do about it — and it is also what makes
  the age honest: `ageDays` is the streak in the builds Jenkins still has, `develocity.firstSeen` is
  the day the failure started. **A failure older than the regression window was not caused by a
  commit inside it**, however well that commit's files overlap; say so, and let the blame stand as
  the weak evidence it is.

  `develocity.report` is the full report, already written to disk by that same run: read its
  `### F<n>` section (`sed`/`awk`) for the representative stack — deeper than the sweep's single
  evidence line, it names the page object and not just the selector — and the per-configuration
  table. **It costs no request**, because the run that produced it is already paid for.

  Run the analyser by hand only for what the field does not hold — another window (`--days 60`), a
  different grouping, or a test that is not this incident:

  ```bash
  node <skill>/tools/dv-test-history.mjs '<test>'   # --section F1 for one group, --full for everything
  ```

The tool is `dv-test-history`, in `xwiki/xwiki-dev-tools`, and the division of labour is worth
stating plainly wherever this comes up: **`dv-test-history` establishes the facts, `xwiki-ci-check`
decides and acts on them.** The wrapper finds a checkout or clones one, and passes the Develocity
key the plugin already has.

**It costs real requests** — ~120 Develocity and ~19 Jenkins per test — which is why the sweep
spends it on deep class 1 incidents only, never on class 2/3/4 and never on one a `fixState`
answers whole. It **fails soft**: the first refusal (no checkout, no `python3`, no key, no network)
switches the pass off for the whole run and `summary.develocity.unavailable` says which — no
Develocity facts this morning, carry on with what Jenkins gave you. Do not go fetching them by hand
to fill the gap.
- **`develocity` MCP: for a class 2 break whose stage log came back `unclassified`, and nothing
  else.** The build scan names the failing goal and module directly, which is exactly what that log
  did not — a bounded second attempt on the one path where the tokens are earned. Every class 1
  question belongs to `develocity` above, which answers it with 28 days of executions behind it.

  The scan of a Jenkins build is one `execute_query` away, and it is the link worth putting in a
  commit comment about a build break:

  ```sql
  SELECT COALESCE(mavenAttributes.id, gradleAttributes.id) AS id
  FROM build WHERE build_start_date BETWEEN DATE '<the day before>' AND DATE '<the day after>'
    AND COALESCE(mavenAttributes.hasFailed, gradleAttributes.hasFailed) = true
    AND array_join(transform(filter(COALESCE(mavenAttributes.links, gradleAttributes.links),
        l -> l.label = 'Jenkins build'), l -> l.url), ' ') LIKE '%/job/<branch>/<build number>/%'
  ```

  The scan is then `https://community.develocity.cloud/s/<id>`. **No failing scan is a finding, not
  a failure of the query**: one Jenkins build runs Maven many times and none of those runs failed,
  so what broke is the pipeline itself — a quality gate, an archive step, an agent — and not a
  build. That is why the sweep does not do this lookup for you: on most class 2 incidents it would
  add an empty field.
