#!/usr/bin/env bash
# Copy a raw skin/webapp file (a CSS/JS resource or a skin .vm template, served straight off disk
# rather than packaged into a jar or xar) into a running instance. No rebuild, no restart: the file is
# read off disk on the next request.
#
# A pre-built .min sibling is overwritten too: a template loading the file via
# $xwiki.get('ssfx').use('path/to/foo.css', true) is served that sibling in preference, so copying
# only the raw file would have no visible effect.
#
# Not for xar-packaged pages (use the xwiki-deploy-extension skill) nor jar-packaged code (the jar
# route, references/jar-route.md).
#
# Usage:
#   sync-static-resource.sh [--target-root <dir>] [--backup-dir <dir>] <instance-dir> <source-file>
#                           <relative-path>
#
# --target-root     Optional, default `resources`. The directory under webapps/xwiki/ that
#                   <relative-path> is relative to. Use `skins` for a skin's .vm templates and
#                   .less files, which live in webapps/xwiki/skins/<skin>/ rather than under
#                   resources/.
# --backup-dir      Optional. Before the first overwrite of each file, copy the instance's own copy
#                   to the same path under <dir> (<dir>/webapps/xwiki/<target-root>/...), so that
#                   `cp -R <dir>/. <instance-dir>/` restores the instance. A later run never
#                   replaces a backup. A file the instance does not have yet is reported, not saved.
# <instance-dir>    path to a XWiki jetty+hsqldb distribution root.
# <source-file>     the fixed/branch file to deploy, e.g.
#                    xwiki-platform-core/.../resources/uicomponents/viewers/comments.css
# <relative-path>   where it lives under webapps/xwiki/<target-root>/, e.g.
#                    uicomponents/viewers/comments.css, or flamingo/previewactions.vm with
#                    --target-root skins
set -euo pipefail
# Print this script's own header comment as its usage text. awk, not sed: the `\( \|$\)`
# alternation a sed one-liner needs here is a GNU extension that BSD/macOS sed rejects.
usage() {
  awk 'NR>1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"
  exit "${1:-1}"
}
if [[ "${1:-}" == -h || "${1:-}" == --help || $# -eq 0 ]]; then usage 0; fi

TARGET_ROOT="resources"
BACKUP_DIR=""
while [[ "${1:-}" == --target-root || "${1:-}" == --backup-dir ]]; do
  [ $# -ge 2 ] || { echo "ERROR: $1 needs a value" >&2; echo >&2; usage 1 >&2; }
  if [[ "$1" == --target-root ]]; then TARGET_ROOT="$2"; else BACKUP_DIR="$2"; fi
  shift 2
done

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

# Save the instance's own copy of a file under BACKUP_DIR, once.
backup() {
  [ -n "$BACKUP_DIR" ] || return 0
  local saved="$BACKUP_DIR/${1#"$INSTANCE_DIR"/}"
  [ -e "$saved" ] && return 0
  if [ -f "$1" ]; then
    mkdir -p "$(dirname "$saved")" && cp "$1" "$saved" && echo "backed up $1"
  else
    echo "NOTE: $1 is new, nothing to back up - delete it when restoring the instance"
  fi
}

backup "$TARGET_DIR/$BASENAME"
cp "$SOURCE_FILE" "$TARGET_DIR/$BASENAME"
echo "synced $TARGET_DIR/$BASENAME"

MIN_PATH="$TARGET_DIR/${STEM}.min.${EXT}"
if [ -f "$MIN_PATH" ]; then
  backup "$MIN_PATH"
  # Crude copy, not a real minification pass - fine for a visual repro, where the point is that
  # the SAME content is served regardless of which of the two files ssfx picks.
  cp "$SOURCE_FILE" "$MIN_PATH"
  echo "synced $MIN_PATH (pre-built minified sibling - kept in lockstep, not re-minified)"
fi
