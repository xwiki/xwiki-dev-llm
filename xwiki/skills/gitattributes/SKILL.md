---
name: gitattributes
description: Honor the repository's .gitattributes (line endings, encoding, text/binary) when generating or editing files, so newly written files don't produce spurious CRLF/LF or whitespace diffs. Use whenever you create, generate or rewrite a file that git tracks — config, source, scripts, data — even if the task doesn't mention git or line endings.
---

# Honoring `.gitattributes` when generating files

A repository's `.gitattributes` declares per-path rules — most importantly **line endings**
(`eol`, `text`), plus text/binary classification and working-tree encoding. If a file you write
doesn't match those rules, the first `git diff`/`git status` reports the *whole file* as changed (a
CRLF↔LF flip) even though the visible content is identical. That noise is silent, easy to miss, and
pollutes the commit — so it's worth getting right at write time rather than cleaning up later.

The rules can come from the root `.gitattributes`, a nested `.gitattributes` in a subdirectory, or
the user's global gitattributes — so resolve them through git instead of eyeballing the root file.
Don't assume LF; let git tell you what a given path expects.

## Establish the convention, then write

For most repos the line-ending rule is uniform (e.g. a blanket `* text=auto eol=lf`), so you only
need to learn it once per session, then apply it to everything you write. Check the *specific path*
you're about to create — `git check-attr` works even for files that don't exist yet:

```bash
git check-attr text eol working-tree-encoding -- path/to/file/you/will/create.ext
```

Re-check when you write into a different directory or a path with a distinctive extension (e.g.
`*.bat`, `*.ps1`, `*.sh`, generated binaries), since those often carry their own overrides.

Interpreting the output:

| Output                          | What to write                                                                  |
|---------------------------------|--------------------------------------------------------------------------------|
| `eol: lf`                       | **LF** (`\n`) line endings.                                                    |
| `eol: crlf`                     | **CRLF** (`\r\n`) line endings.                                                |
| `text: set`, eol unspecified    | Text, normalized to LF in the repo — write **LF**; git renormalizes on commit. |
| `text: auto`, eol unspecified   | Git decides by content; **LF** is the safe default unless siblings use CRLF.   |
| `text: unset` / `-text`         | **Binary** — preserve bytes exactly; never inject or convert line endings.     |
| `text: unspecified`, no eol     | No rule. Match the existing line endings of sibling files in that directory.   |
| `working-tree-encoding: <enc>`  | Working-tree bytes use `<enc>` (e.g. `UTF-16`); write/edit in that encoding.    |

When nothing is specified and you need to match a sibling, this reveals its line endings:

```bash
git ls-files --eol -- path/to/sibling.ext   # e.g. "w/crlf" means the working file uses CRLF
```

## Verify after writing

The precise check works for new and edited files alike. Stage the file as intent-to-add (no real
commit), then ask git to compare its working-tree line endings against what the attributes require:

```bash
git add -N path/to/file.ext
git ls-files --eol -- path/to/file.ext
```

Read the `w/` (working tree) column against `attr/`. If attributes say `eol=lf` but you see
`w/crlf` (or vice-versa), the file is wrong — rewrite it with the correct endings. For an *edit* to
an already-tracked file, a quick alternative is `git diff --stat -- <path>`: if a near-no-op edit
shows the whole file changed, the line endings are off. `git diff --check` additionally flags
trailing-whitespace and EOL errors git would warn about.

## XWiki note

XWiki repositories normalize source files to **LF** and use **UTF-8**. Unless `.gitattributes`
overrides a specific path (e.g. Windows `.bat`/`.cmd` scripts marked `eol=crlf`), generate files
with LF line endings and UTF-8 encoding.
