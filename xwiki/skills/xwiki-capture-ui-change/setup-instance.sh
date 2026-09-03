#!/usr/bin/env bash
# Build a jar-packaged module at a given git ref and swap its jar into a local XWiki instance's
# WEB-INF/lib, then restart the instance. This is how the "before" state of a UI fix is reached:
# the pre-fix code is built from a commit the working tree no longer contains, without touching
# that working tree or its git history.
#
# Usage:
#   setup-instance.sh [--verify jarHint:pathInJar:pattern ...] \
#     <instance-dir> <module-dir> <git-ref-or-HEAD> [extra-module-dir ...]
#
# --verify           Optional, repeatable, and strongly recommended: it is what turns a silently
#                    stale jar into a loud failure. jarHint matches the swapped module's
#                    artifactId, pathInJar is a file inside the jar (`*` covers version-numbered
#                    path segments), and pattern must appear in that file's content. Splits on its
#                    first two colons only, so the pattern may contain colons and spaces. E.g.
#                    'tree-webjar:META-INF/resources/webjars/*/finder.js:xwiki-icon'.
# <instance-dir>     path to an XWiki jetty+hsqldb distribution root. Keep it outside any
#                    git-tracked checkout (see $XWIKI_TEST_INSTANCES_DIR in SKILL.md step 0) so
#                    instance logs and swapped jars never show up as untracked files in the repo
#                    under comparison.
# <module-dir>       path to the maven module to build. Its packaging must be jar (or webjar).
# <git-ref-or-HEAD>  "HEAD" to build the working tree exactly as it sits, uncommitted changes and
#                    all, or a commit-ish (e.g. <fix-commit>~1) to build via a throwaway sparse
#                    worktree, created next to the repo's git dir and cleaned up automatically.
#                    This script never writes to the repo's git history.
# extra-module-dir   Additional modules to build and swap. Needed where a -legacy module weaves the
#                    changed one with AspectJ: the woven jar is what ships in WEB-INF/lib and the
#                    original is not deployed at all, so swapping only the module you edited
#                    changes nothing on screen. For xwiki-platform-oldcore always pass
#                    xwiki-platform-core/xwiki-platform-legacy/xwiki-platform-legacy-oldcore here.
#                    The xwiki-build skill owns that rule and how to spot such a module.
#
# Reads XWIKI_BASE_URL (default http://localhost:8080/xwiki) to know which instance to wait for.
#
# Progress log: every run tees its full output to <instance-dir>/setup-instance.log (truncated each
# run). Follow it with `tail -f` rather than piping this script's stdout through anything - a
# non-`-f` `tail -N` buffers ALL output until the process exits, defeating watching it live.
#
# This script STOPS AND RESTARTS the instance it deploys into. Never point it at an instance this
# session did not start; check with `lsof -nP -iTCP:8080 -sTCP:LISTEN` first.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
if [[ "${1:-}" == -h || "${1:-}" == --help || $# -eq 0 ]]; then usage 0; fi

VERIFY_SPECS=()
while [[ "${1:-}" == --verify ]]; do
  VERIFY_SPECS+=("$2")
  shift 2
done

if [ $# -lt 3 ]; then
  echo "ERROR: expected <instance-dir> <module-dir> <git-ref-or-HEAD> [extra-module-dir ...]" >&2
  echo >&2
  usage 1 >&2
fi

INSTANCE_DIR="$1"
MODULE_DIR="$2"
GIT_REF="$3"
shift 3
BASE_URL="${XWIKI_BASE_URL:-http://localhost:8080/xwiki}"

mkdir -p "$INSTANCE_DIR"
exec > >(tee "$INSTANCE_DIR/setup-instance.log") 2>&1

resolve_repo "$MODULE_DIR"
# A trap rather than a call after the swap loop: a failed --verify exits from inside that loop, and
# the worktree has to go either way.
trap remove_worktree EXIT
build_at_ref install "$GIT_REF" "$MODULE_DIR" "$@"

echo "--- stopping instance (if running) ---"
(cd "$INSTANCE_DIR" && java -jar ./jetty/start.jar STOP.KEY=xwiki STOP.PORT=8079 --stop) || true
sleep 2

echo "--- swapping jar(s) into $INSTANCE_DIR ---"
# Verify against the jar of whichever module's artifactId contains the spec's jarHint, tying
# verification to the exact jar this run just swapped rather than re-searching WEB-INF/lib
# afterwards (which can ambiguously match an unrelated jar whose artifactId shares the substring).
verify_against() {
  local target="$1" path_in_jar="$2" pattern="$3" entry
  # path_in_jar may contain a glob - resolve it against the jar's own file list rather than
  # assuming the exact version-numbered path.
  entry="$(unzip -Z1 "$target" | grep -x -- "$(echo "$path_in_jar" | sed 's/\*/[^\/]*/g')" | head -1)"
  if [ -z "$entry" ]; then
    echo "VERIFY FAILED: no entry matching $path_in_jar in $target" >&2
    exit 1
  fi
  if unzip -p "$target" "$entry" | grep -q -- "$pattern"; then
    echo "verified $target:$entry matches /$pattern/"
  else
    echo "VERIFY FAILED: $target:$entry does not match /$pattern/ - the swap did not land the code" >&2
    exit 1
  fi
}

VERIFIED=0
resolve_local_repo "$MODULE_DIR"
for m in "${BUILT_MODULES[@]}"; do
  ARTIFACT_ID="$(evaluate "$m" project.artifactId)"
  VERSION="$(evaluate "$m" project.version)"
  JAR="$(artifact_path "$m" jar "$ARTIFACT_ID" "$VERSION")"
  TARGET="$INSTANCE_DIR/webapps/xwiki/WEB-INF/lib/$ARTIFACT_ID-$VERSION.jar"
  if [ -f "$TARGET" ]; then
    cp "$JAR" "$TARGET"
    echo "swapped $ARTIFACT_ID-$VERSION.jar"
  else
    echo "WARNING: $TARGET is not in the instance - this module's jar isn't deployed under that" >&2
    echo "         name. Check WEB-INF/lib by hand (unzip -l + grep for your changed class)." >&2
  fi
  for spec in "${VERIFY_SPECS[@]:-}"; do
    [ -n "$spec" ] || continue
    case "$ARTIFACT_ID" in
      *"${spec%%:*}"*)
        REST="${spec#*:}"
        verify_against "$TARGET" "${REST%%:*}" "${REST#*:}"
        VERIFIED=$((VERIFIED + 1))
        ;;
    esac
  done
done

if [ "${#VERIFY_SPECS[@]}" -gt "$VERIFIED" ]; then
  echo "VERIFY FAILED: some --verify specs matched no swapped module's artifactId - check the jarHint" >&2
  exit 1
fi

echo "--- starting instance ---"
# The XWiki JVM has to leave this script's process session, or a tool harness capturing this
# script's output considers itself "still running" for as long as the server lives, i.e. forever.
# setsid does that properly but is Linux-only, so fall back to nohup in a detached subshell on
# macOS, where the double fork plus </dev/null is enough in practice.
if command -v setsid >/dev/null 2>&1; then
  (cd "$INSTANCE_DIR" && setsid nohup ./start_xwiki.sh < /dev/null > "$INSTANCE_DIR/boot.log" 2>&1 &)
else
  (cd "$INSTANCE_DIR" && nohup ./start_xwiki.sh < /dev/null > "$INSTANCE_DIR/boot.log" 2>&1 &) &
fi

echo "--- waiting for instance to come up ---"
for i in $(seq 1 40); do
  if curl -sf -o /dev/null "$BASE_URL/bin/view/Main/WebHome" 2>/dev/null; then
    echo "instance is up (attempt $i)"
    exit 0
  fi
  sleep 3
done
echo "WARNING: instance did not come up within the timeout - check $INSTANCE_DIR/boot.log" >&2
exit 1
