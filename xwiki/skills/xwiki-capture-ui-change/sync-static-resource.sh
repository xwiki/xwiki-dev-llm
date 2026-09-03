#!/usr/bin/env bash
# Copy a raw skin/webapp file (a CSS/JS resource or a skin .vm template, served straight off disk
# rather than packaged into a jar or xar) into a running instance, and keep any pre-built .min
# sibling in sync too - a stale .min.css/.min.js next to the raw file is served instead whenever a
# template loads it via $xwiki.get('ssfx').use('path/to/foo.css', true) (the trailing `true`
# prefers the minified sibling if one exists on disk). Overwriting only the raw file and
# restarting Jetty has zero visible effect if that stale sibling is what's actually served - this
# script closes that gap by refreshing both from the same source in one step.
#
# Neither a rebuild nor a restart is needed: the copied file is read off disk on the next request,
# so a before/after swap of one of these costs seconds rather than a full module build.
#
# This is NOT for xar-packaged wiki pages (use setup-xar-instance.sh) or jar-packaged classes
# (use setup-instance.sh) - it's for plain files that ship as-is, e.g. xwiki-platform-web-war's
# resources/uicomponents/**, or the flamingo skin's templates in
# xwiki-platform-flamingo-skin-resources (a `pom`-packaged module).
#
# Usage:
#   sync-static-resource.sh [--target-root <dir>] <instance-dir> <source-file> <relative-path>
#
# --target-root     Optional, default `resources`. The directory under webapps/xwiki/ that
#                   <relative-path> is relative to. Use `skins` for a skin's .vm templates and
#                   .less files, which live in webapps/xwiki/skins/<skin>/ rather than under
#                   resources/. Find the right root by locating the file in the instance:
#                     find <instance-dir>/webapps/xwiki -name previewactions.vm
# <instance-dir>    path to a XWiki jetty+hsqldb distribution root.
# <source-file>     the fixed/branch file to deploy, e.g.
#                    xwiki-platform-core/.../resources/uicomponents/viewers/comments.css
# <relative-path>   where it lives under webapps/xwiki/<target-root>/, e.g.
#                    uicomponents/viewers/comments.css, or flamingo/previewactions.vm with
#                    --target-root skins
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
if [[ "${1:-}" == -h || "${1:-}" == --help || $# -eq 0 ]]; then usage 0; fi

TARGET_ROOT="resources"
if [[ "${1:-}" == --target-root ]]; then
  [ $# -ge 2 ] || { echo "ERROR: --target-root needs a value" >&2; echo >&2; usage 1 >&2; }
  TARGET_ROOT="$2"
  shift 2
fi

if [ $# -lt 3 ]; then
  echo "ERROR: expected <instance-dir> <source-file> <relative-path>" >&2
  echo >&2
  usage 1 >&2
fi

INSTANCE_DIR="$1"
SOURCE_FILE="$2"
REL_PATH="$3"

TARGET_DIR="$INSTANCE_DIR/webapps/xwiki/$TARGET_ROOT/$(dirname "$REL_PATH")"
BASENAME="$(basename "$REL_PATH")"
EXT="${BASENAME##*.}"
STEM="${BASENAME%.*}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "ERROR: $TARGET_DIR does not exist - check the relative path and --target-root" >&2
  exit 1
fi

cp "$SOURCE_FILE" "$TARGET_DIR/$BASENAME"
echo "synced $TARGET_DIR/$BASENAME"

MIN_PATH="$TARGET_DIR/${STEM}.min.${EXT}"
if [ -f "$MIN_PATH" ]; then
  # Crude copy, not a real minification pass - fine for a visual repro, where the point is that
  # the SAME content is served regardless of which of the two files ssfx picks.
  cp "$SOURCE_FILE" "$MIN_PATH"
  echo "synced $MIN_PATH (pre-built minified sibling - kept in lockstep, not re-minified)"
fi
