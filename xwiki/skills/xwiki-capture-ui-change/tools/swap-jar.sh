#!/usr/bin/env bash
# Swap the jars of one or more built modules into a jetty+hsqldb XWiki instance's WEB-INF/lib, then
# restart the instance once: the deploy half of the jar route (references/jar-route.md), run once
# per state after `package` built each module.
#
# Each jar replaces the one already deployed for its artifactId, under the deployed file name: the
# instance's version can differ from the branch's, and copying under the built name would add a
# second jar rather than replace the first. Before its first swap, each deployed jar is backed up
# to <capture-dir>/original/webapps/xwiki/WEB-INF/lib/<jar>; a later run never replaces a backup,
# so `cp -R <capture-dir>/original/. <instance-dir>/` restores the instance as it was found.
# Every module is checked before any jar is copied.
#
# Usage:
#   swap-jar.sh [--instance <dir>] [--capture-dir <dir>] [--base-url <url>] [--no-restart]
#               <module-dir>...
#
# --instance      the instance's distribution root. Default: $INSTANCE_DIR.
# --capture-dir   where the original/ backups go. Default: $CAPTURE_DIR.
# --base-url      the instance's URL, waited on after the restart. Default: $XWIKI_BASE_URL, else
#                 http://localhost:8080/xwiki.
# --no-restart    only swap; restart the instance yourself.
# <module-dir>    a module built with `package`: its jar is target/<artifactId>-<version>.jar, as
#                 named by target/maven-archiver/pom.properties.
#
# The restart stops the instance when it answers (stop_xwiki.sh), waits for it to go down, starts
# it detached (start_xwiki.sh, output in <instance-dir>/xwiki-start.log) and waits up to 2min for
# it to answer. Never point it at an instance this session did not start.
set -euo pipefail
# Print this script's own header comment as its usage text.
usage() {
  awk 'NR>1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"
  exit "${1:-1}"
}
die() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == -h || "${1:-}" == --help || $# -eq 0 ]]; then usage 0; fi

INSTANCE="${INSTANCE_DIR:-}"
CAPTURE="${CAPTURE_DIR:-}"
BASE_URL="${XWIKI_BASE_URL:-http://localhost:8080/xwiki}"
RESTART=1
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --no-restart) RESTART=""; shift; continue ;;
    --instance|--capture-dir|--base-url) ;;
    *) echo "ERROR: unknown option $1" >&2; echo >&2; usage 1 >&2 ;;
  esac
  [ $# -ge 2 ] || { echo "ERROR: $1 needs a value" >&2; echo >&2; usage 1 >&2; }
  case "$1" in
    --instance) INSTANCE="$2" ;;
    --capture-dir) CAPTURE="$2" ;;
    --base-url) BASE_URL="$2" ;;
  esac
  shift 2
done
if [ $# -eq 0 ]; then
  echo "ERROR: expected at least one <module-dir>" >&2
  echo >&2
  usage 1 >&2
fi
[ -n "$INSTANCE" ] || die "no instance: pass --instance or set INSTANCE_DIR"
[ -n "$CAPTURE" ] || die "no capture directory: pass --capture-dir or set CAPTURE_DIR"
LIB="$INSTANCE/webapps/xwiki/WEB-INF/lib"
[ -d "$LIB" ] || die "$LIB does not exist - is $INSTANCE a jetty+hsqldb distribution root?"
ORIG="$CAPTURE/original/webapps/xwiki/WEB-INF/lib"

# Resolve every module's built jar and deployed jar before copying anything.
BUILT=()
DEPLOYED=()
for MODULE in "$@"; do
  PROPS="$MODULE/target/maven-archiver/pom.properties"
  [ -f "$PROPS" ] || die "$PROPS not found - build $MODULE with 'package' first"
  A="$(sed -n 's/^artifactId=//p' "$PROPS" | tr -d '\r')"
  VER="$(sed -n 's/^version=//p' "$PROPS" | tr -d '\r')"
  JAR="$MODULE/target/$A-$VER.jar"
  [ -f "$JAR" ] || die "$JAR not found - build $MODULE with 'package' first"
  MATCHES=()
  for f in "$LIB/$A"-[0-9]*.jar; do [ -e "$f" ] && MATCHES+=("$f"); done
  [ "${#MATCHES[@]}" -gt 0 ] || die "no $A-<version>.jar in $LIB: the module does not ship as that" \
    "jar - find the jar holding the changed class before going further"
  [ "${#MATCHES[@]}" -eq 1 ] || die "several $A jars in $LIB (${MATCHES[*]##*/}) - remove the stray one"
  BUILT+=("$JAR")
  DEPLOYED+=("${MATCHES[0]}")
done

mkdir -p "$ORIG"
for i in "${!BUILT[@]}"; do
  D="${DEPLOYED[$i]}"
  if [ -e "$ORIG/${D##*/}" ]; then
    echo "kept the existing backup of ${D##*/}"
  else
    cp "$D" "$ORIG/" && echo "backed up ${D##*/} to $ORIG"
  fi
  cp "${BUILT[$i]}" "$D"
  echo "swapped ${BUILT[$i]##*/} into $D"
done

[ -n "$RESTART" ] || { echo "not restarted (--no-restart): restart $INSTANCE for the swap to apply"; exit 0; }
up() { curl -s -o /dev/null "$BASE_URL/bin/view/Main/WebHome"; }
if up; then
  (cd "$INSTANCE" && ./stop_xwiki.sh) >/dev/null 2>&1 || die "stop_xwiki.sh failed in $INSTANCE"
  for i in $(seq 1 60); do up || break; sleep 2; done
  ! up || die "$BASE_URL still answers 2min after stop_xwiki.sh"
fi
# setsid takes the JVM out of the shell's session (Linux only; nohup is enough on macOS), without
# which a tool harness waits on the server for as long as it lives.
DETACH=$(command -v setsid || true)
(cd "$INSTANCE" && $DETACH nohup ./start_xwiki.sh < /dev/null > xwiki-start.log 2>&1 &)
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "$BASE_URL/bin/view/Main/WebHome"; then echo "restarted: $BASE_URL is up"; exit 0; fi
  sleep 2
done
die "$BASE_URL not up after 2min, check $INSTANCE/xwiki-start.log"
