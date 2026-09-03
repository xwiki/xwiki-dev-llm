#!/usr/bin/env bash
# Shared helpers for setup-instance.sh, setup-xar-instance.sh and sync-static-resource.sh: usage
# output, the Maven invocation, resolving a module's coordinates, and building it at an arbitrary
# git ref through a throwaway sparse worktree. sync-static-resource.sh needs no Maven and uses only
# usage(). Sourced, never run directly.

# Print the sourcing script's own header comment as its usage text, so `--help` and a missing
# argument both explain the interface instead of dying on an unbound variable. awk, not sed: the
# `\( \|$\)` alternation a sed one-liner needs here is a GNU extension that BSD/macOS sed rejects.
usage() {
  awk 'NR>1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"
  exit "${1:-1}"
}

# Build with the JDK the branch targets, per the xwiki-build skill: xmvn (from xwiki-dev-tools)
# reads xwiki.java.version from the pom, exports the matching JAVA_HOME, then delegates to mvn. It
# matters more here than in a normal build, since these scripts deliberately build OLD commits,
# which are the ones most likely to target an older Java than the machine default.
if command -v xmvn >/dev/null 2>&1; then MVN=xmvn; else MVN=mvn; fi
# -B -ntp on every invocation, per the org conventions: batch mode plus no transfer progress, so a
# build's output stays greppable instead of drowning in download lines.
MVN_FLAGS=(-B -ntp)

mvn_build() {
  local dir="$1" goal="$2"
  echo "--- building $dir ---"
  (cd "$dir" && "$MVN" "${MVN_FLAGS[@]}" -q clean "$goal" -DskipTests \
    -Dxwiki.revapi.skip=true -Dspoon.skip=true -Dcheckstyle.skip=true \
    -Dspotbugs.skip=true -Dlicense.skip=true)
}

# Don't scrape pom.xml with grep/sed for the artifactId/version: a pom's FIRST <artifactId>/
# <version> tags belong to its <parent> block, and dependency/plugin declarations further down have
# their own. Ask Maven, the only thing that resolves inheritance correctly. -o (offline) first since
# it is faster once maven-help-plugin is cached; fall back to online on a machine without it.
evaluate() {
  (cd "$1" && "$MVN" "${MVN_FLAGS[@]}" -q -o help:evaluate -Dexpression="$2" -DforceStdout 2>/dev/null) \
    || (cd "$1" && "$MVN" "${MVN_FLAGS[@]}" -q help:evaluate -Dexpression="$2" -DforceStdout)
}

# The repository root, resolved once per run into LOCAL_REPO. It is a machine-wide setting, so
# asking Maven for it per module pays for a JVM start to get the same answer back every time. It is
# still asked rather than assumed, because ~/.m2/repository is only the default and settings.xml may
# point elsewhere. Call this from a script body, never inside a command substitution, whose subshell
# would discard the cached value.
LOCAL_REPO=""
resolve_local_repo() {
  [ -n "$LOCAL_REPO" ] || LOCAL_REPO="$(evaluate "$1" settings.localRepository)"
}

# artifact_path <module-dir> <packaging> <artifact-id> <version>
# Absolute path of a built artifact in the local Maven repository. artifactId and version are passed
# in because every caller has already asked Maven for both. groupId is still resolved here, since
# this skill runs in xwiki-commons and xwiki-rendering and xwiki-contrib too, not only
# org.xwiki.platform. Requires resolve_local_repo to have run.
artifact_path() {
  local dir="$1" packaging="$2" artifact_id="$3" version="$4" group_id
  group_id="$(evaluate "$dir" project.groupId)"
  echo "$LOCAL_REPO/${group_id//.//}/$artifact_id/$version/$artifact_id-$version.$packaging"
}

# REPO_ROOT / WORKTREE_DIR for a module directory.
resolve_repo() {
  REPO_ROOT="$(cd "$1" && git rev-parse --show-toplevel)"
  # Not "$REPO_ROOT/.git": in a LINKED worktree that is a *file* pointing at the real git dir, so
  # creating anything underneath it fails with "Not a directory". --git-common-dir resolves to the
  # shared git directory from a main checkout and a linked worktree alike. cd+pwd because git may
  # answer with a path relative to the module directory.
  local common_dir
  common_dir="$(cd "$1" && cd "$(git rev-parse --git-common-dir)" && pwd)"
  WORKTREE_DIR="$common_dir/xwiki-capture-ui-change-worktree"
}

# build_at_ref <goal> <ref> <module-dir>...
# Builds every module at <ref>, then leaves BUILT_MODULES holding the directory each was built in -
# the module itself for HEAD, its counterpart inside the throwaway worktree otherwise. Those
# directories stay readable until the caller's remove_worktree EXIT trap fires.
build_at_ref() {
  local goal="$1" ref="$2"
  shift 2
  BUILT_MODULES=()
  if [ "$ref" = "HEAD" ]; then
    local m
    for m in "$@"; do
      mvn_build "$m" "$goal"
      BUILT_MODULES+=("$m")
    done
    return
  fi

  echo "--- creating worktree at $ref ---"
  git -C "$REPO_ROOT" worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
  local rel_modules=() m
  for m in "$@"; do
    rel_modules+=("${m#"$REPO_ROOT"/}")
  done
  # Sparse + no-checkout: a full worktree add would materialize the ENTIRE repo (10k+ files) just to
  # build one small module, which is both slow and spews a huge "Updating files: N%" progress dump
  # into any captured output. Cone-mode sparse-checkout limits it to the module(s) plus each
  # ancestor directory's own files (the pom.xml at every level of the reactor), which is all a
  # `cd module && mvn` build needs.
  git -C "$REPO_ROOT" worktree add --quiet --no-checkout "$WORKTREE_DIR" "$ref"
  git -C "$WORKTREE_DIR" sparse-checkout init --cone
  git -C "$WORKTREE_DIR" sparse-checkout set "${rel_modules[@]}"
  git -C "$WORKTREE_DIR" checkout --quiet "$ref"
  local rel
  for rel in "${rel_modules[@]}"; do
    mvn_build "$WORKTREE_DIR/$rel" "$goal"
    BUILT_MODULES+=("$WORKTREE_DIR/$rel")
  done
}

# Meant to be installed as an EXIT trap, so the throwaway worktree is removed however the script
# ends, including the early exits a failed --verify takes. It is therefore safe to call at any
# point: an unset WORKTREE_DIR, from a trap armed before resolve_repo ran, and a path that was
# never created, on the HEAD ref, are both treated as nothing to remove.
#
# An `if` rather than a `[ -d ... ] && git ...` one-liner, so the exit status is 0 when there is
# nothing to do. The callers all run under `set -e`, which would otherwise turn that status into an
# abort part-way through the procedure.
remove_worktree() {
  if [ -n "${WORKTREE_DIR:-}" ] && [ -d "$WORKTREE_DIR" ]; then
    git -C "$REPO_ROOT" worktree remove "$WORKTREE_DIR" --force
  fi
}
