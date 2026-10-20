# The export plan — state, tasks and the incremental rules

## State directory

One per subtree and language, stable across exports:

```
<work>/xwiki-doc-export/<root>__<lang>/          e.g. documentation.xs.user__de
  export.json            root, language, exclusions, the xwiki-platform checkout
  manifest.json          the pages in navigation order: ref, key, title, depth, children, version,
                         attachment versions (rewritten by every scan)
  state.json             per page: sourceHash, translatedFromHash, fetchedVersion, fetchedAttachments
  unknown-blocks.json    block classes/tags with no print rule, and where they occur
  accepted-classes.json  the ones reviewed and accepted as harmless
  source/<key>.html      the page after the print transform (what translators read)
  translated/<key>.html  the translation (absent for --lang en)
  assets/                images, named by a hash of their URL (a new attachment revision is a new file)
  ui-strings.<lang>.json the official UI strings, English label -> translations (from the checkout)
  glossary.<lang>.json   terms chosen for this book by the translators
  labels.<lang>.json     the labels the same on every page (cover, Contents, In this section, the metadata line)
  PLAN.md, tasks/        the current plan; earlier ones are moved to plans/
  batches.json           the chunks of each translate task
  prompts/               one prompt file per chunk
  book.html, out/        the printed book, the PDF and the change reports
  last-export.json       the pages and hashes of the last successful build
```

The directory breaks the `<repo>/<date>-<slug>` convention on purpose. An export belongs to a subtree and a language, not to a repository or a day, and the next export has to find this one's cache.

Deleting the directory loses nothing that cannot be rebuilt, but the next export then starts over and retranslates every page.

## What makes a page need work

| Upstream event | What happens |
|---|---|
| New page | fetched, translated |
| Page version or any attachment version changed | re-fetched. If the transformed HTML is **identical** (an edit that only touched metadata), the translation is kept; otherwise it is retranslated. |
| Page deleted | its cached files are removed at the next scan, and it is gone from the next book |
| Pages reordered or re-pinned | nothing to fetch; the next build follows the new order |
| Print rule changed (a new rule in `transform()`) | `fetch --all`. Only pages whose output actually changed are retranslated. |

`translatedFromHash` is set only by a passing `check`, so a page with a translation that was never checked counts as untranslated.

## Tasks

`plan` writes PLAN.md in the layout `docplan.py` reads (Setup / Decisions / Open questions / a Tasks table). The tasks:

| Task | Planned when | The session |
|---|---|---|
| `NN-glossary` | translating, and `ui-strings` is missing or `labels` is untranslated (normally done in the planning session already) | `glossary --platform <checkout>`, translate `labels.<lang>.json` |
| `NN-translate` | one per session's worth of chunks | `prompt`, one subagent per chunk in one message, `check`, retry failures once |
| `NN-build` | always, last | `build`, one look at the PDF, report the path and the change report |

**Sizing.**
- A chunk is at most `--chunk-bytes` of transformed source HTML (default 30000). Measured: a 20 KB chunk cost its subagent about 77k tokens (reading the source, writing the translation, updating the glossary), so 30 KB leaves a subagent comfortable headroom.
- A session runs `--chunks-per-session` chunks (default 8).
- The main session only holds the prompt paths, one reply line per subagent and the check summary, so 8 chunks cost it far less than its 30% budget.
- Lower the chunk size if a subagent runs out of room or starts dropping markup (the check will say "N elements instead of M").

**Replanning.** `plan` refuses to replace a PLAN.md with open tasks unless given `--force`. A finished plan is moved to `plans/`, and its Decisions carry over to the new one. Each export is its own plan: *scan → fetch → plan → tasks*.

## The first export of `documentation/xs/user`

About 180 pages. `plan` prints the exact numbers: at the defaults, 1 MB of transformed HTML is about 35 chunks over 5 translate sessions, plus the planning session and the build.

Later exports usually plan one short translate task and a build.
