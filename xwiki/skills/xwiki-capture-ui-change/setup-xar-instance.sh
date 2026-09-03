#!/usr/bin/env bash
# Build a xar-packaged module (wiki pages, not classes) at a given git ref and push it into a
# RUNNING local XWiki through the classic Administration > Import page.
#
# Prefer the xwiki-deploy-extension skill over this script: it installs a XAR through the REST job
# API and is the shared, maintained way to deploy an extension. This exists only for the one case
# that route cannot handle - the Extension Manager cross-checks the XAR's declared dependency
# versions against the instance's bundled core jars and fails outright ("InstallException:
# Dependency [...] is not compatible with core extension feature [...]") the moment the branch's
# ${project.version} has drifted from the cached test instance's. The Import page just overwrites
# the named wiki documents, with no dependency graph involved.
#
# Usage:
#   setup-xar-instance.sh [--base-url http://localhost:8080] [--user Admin:admin] \
#     [--verify Space.Page:pattern ...] <module-dir> <git-ref-or-HEAD> [extra-module-dir ...]
#
# --base-url         Optional. Defaults to XWIKI_BASE_URL with any /xwiki suffix stripped, else
#                    http://localhost:8080. The instance must already be UP: this script only
#                    pushes wiki-page content over HTTP, it never starts or stops a server.
# --user             Optional. HTTP Basic credentials, defaulting to XWIKI_ADMIN_USER and
#                    XWIKI_ADMIN_PASS as SKILL.md step 0 exports them, else Admin:admin. Basic auth
#                    is fine for this Import flow, unlike the CSRF-protected POSTs that need a real
#                    browser session.
# --verify           Optional, repeatable. After each import, re-export the given page as a XAR and
#                    grep it, rather than trusting "N Page(s) installed" (that count is real but
#                    says nothing about whether it is YOUR content or a same-named page from a
#                    stale prior run). Format "Space.Page:pattern". Exits 1 on a miss.
# <module-dir>       the maven module to build; its pom.xml must have <packaging>xar</packaging>.
# <git-ref-or-HEAD>  "HEAD" for the working tree as-is, or a commit-ish built via a throwaway
#                    sparse worktree. This script never writes to the repo's git history.
# extra-module-dir   further xar modules, built and imported independently in the order given.
#
# For static files served straight off disk (skin .vm, webapp CSS/JS) use sync-static-resource.sh -
# those are not wiki pages and do not go through Import.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
if [[ "${1:-}" == -h || "${1:-}" == --help || $# -eq 0 ]]; then usage 0; fi

BASE_URL="${XWIKI_BASE_URL:-http://localhost:8080}"
BASE_URL="${BASE_URL%/}"
BASE_URL="${BASE_URL%/xwiki}"
XWIKI_USER="${XWIKI_ADMIN_USER:-Admin}:${XWIKI_ADMIN_PASS:-admin}"
VERIFY_SPECS=()

while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --user) XWIKI_USER="$2"; shift 2 ;;
    --verify) VERIFY_SPECS+=("$2"); shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ $# -lt 2 ]; then
  echo "ERROR: expected <module-dir> <git-ref-or-HEAD> [extra-module-dir ...]" >&2
  echo >&2
  usage 1 >&2
fi

MODULE_DIR="$1"
GIT_REF="$2"
shift 2
COOKIE_JAR="$(mktemp)"
# One trap for both: a second `trap ... EXIT` would replace this one rather than add to it. The
# worktree is cleaned up here rather than after the import loop because a failed import or --verify
# exits from inside it. remove_worktree tolerates being called before resolve_repo has run.
trap 'rm -f "$COOKIE_JAR"; remove_worktree' EXIT

# A fresh form_token has to come from a real rendered page - it is session-bound, and a stale one
# copy-pasted from an earlier fetch is rejected with "Invalid or missing form token", not a helpful
# "expired" message.
fetch_form_token() {
  curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" --user "$XWIKI_USER" \
    "$BASE_URL/xwiki/bin/admin/XWiki/XWikiPreferences?editor=globaladmin&section=Import" \
  | grep -o 'name="form_token" type="hidden" value="[^"]*"' | head -1 \
  | sed 's/.*value="//;s/"$//'
}

import_xar() {
  local xar_path="$1" xar_name token detail_html pages_file page_count result installed errors
  xar_name="$(basename "$xar_path")"

  echo "--- uploading $xar_name ---"
  token="$(fetch_form_token)"
  curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" --user "$XWIKI_USER" \
    -F "form_token=$token" \
    -F "filepath=@${xar_path};type=application/octet-stream" \
    -F "filename=" \
    -F "xredirect=/xwiki/bin/admin/XWiki/XWikiPreferences?editor=globaladmin&section=Import" \
    "$BASE_URL/xwiki/bin/upload/XWiki/XWikiPreferences" -o /dev/null -w "  upload HTTP %{http_code}\n"

  # The Import detail page pre-checks every page in the XAR (including per-locale translation
  # variants) - re-derive the exact list from its own checkboxes rather than assuming a fixed page
  # set, since that varies per module.
  detail_html="$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" --user "$XWIKI_USER" \
    "$BASE_URL/xwiki/bin/import/XWiki/XWikiPreferences?editor=globaladmin&section=Import&file=${xar_name}")"
  pages_file="$(mktemp)"
  grep -o 'name="pages" type="checkbox" value="[^"]*"' <<<"$detail_html" \
    | sed 's/.*value="//;s/"$//' > "$pages_file"
  page_count="$(wc -l < "$pages_file")"
  if [ "$page_count" -eq 0 ]; then
    echo "ERROR: no pages in the uploaded XAR's import-detail page - the upload likely failed" >&2
    rm -f "$pages_file"
    exit 1
  fi

  echo "--- importing $xar_name ($page_count page(s)) ---"
  token="$(fetch_form_token)"
  local curl_args=(-s -b "$COOKIE_JAR" -c "$COOKIE_JAR" --user "$XWIKI_USER"
    -F "form_token=$token" -F "action=import" -F "name=${xar_name}")
  while IFS= read -r p; do
    curl_args+=(-F "pages=$p")
  done < "$pages_file"
  rm -f "$pages_file"

  local import_url="$BASE_URL/xwiki/bin/import/XWiki/XWikiPreferences?editor=globaladmin&section=Import"
  result="$(curl "${curl_args[@]}" "$import_url")"
  installed="$(grep -o '<li>[0-9]* Page(s) installed</li>' <<<"$result" | grep -o '[0-9]*' || echo 0)"
  errors="$(grep -o '<li>[0-9]* Page(s) with error</li>' <<<"$result" | grep -o '[0-9]*' || echo '?')"
  echo "  $installed page(s) installed, $errors page(s) with error"
  if [ "$errors" != "0" ]; then
    echo "ERROR: import reported errors - inspect the response manually" >&2
    exit 1
  fi
}

verify_against() {
  local spec="$1" page="${1%%:*}" pattern="${1#*:}" space name xar
  space="${page%.*}"
  name="${page##*.}"
  # mktemp --suffix is a GNU extension; build the name portably instead.
  xar="$(mktemp)".xar
  curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" --user "$XWIKI_USER" \
    "$BASE_URL/xwiki/bin/export/${space}/${name}?format=xar" -o "$xar"
  # The page-content REST endpoint often does NOT reflect object-property content (e.g. a
  # stylesheet's "code" property) the way a raw XAR export does - always verify via export.
  if unzip -p "$xar" "${space}/${name}.xml" 2>/dev/null | grep -q -- "$pattern"; then
    echo "verified ${page}: matches /$pattern/"
    rm -f "$xar"
  else
    echo "VERIFY FAILED: ${page} does not match /$pattern/ after import" >&2
    rm -f "$xar"
    exit 1
  fi
}

resolve_repo "$MODULE_DIR"
build_at_ref package "$GIT_REF" "$MODULE_DIR" "$@"

for m in "${BUILT_MODULES[@]}"; do
  # The XAR is read from the module's own target/, not the local repository, so only the file name
  # is needed and neither the groupId nor the repository root has to be resolved.
  ARTIFACT_ID="$(evaluate "$m" project.artifactId)"
  VERSION="$(evaluate "$m" project.version)"
  XAR="$m/target/$ARTIFACT_ID-$VERSION.xar"
  if [ ! -f "$XAR" ]; then
    echo "ERROR: no XAR at $XAR - check <packaging>xar</packaging> is set for this module" >&2
    exit 1
  fi
  import_xar "$XAR"
done

for spec in "${VERIFY_SPECS[@]:-}"; do
  [ -n "$spec" ] && verify_against "$spec"
done

echo "--- done ---"
