#!/usr/bin/env bash
# Start the "before" XWiki instance of the released-image route: the official Docker image of a
# released version, with its flavor installed and XWiki.Admin created, so that `Admin:admin` works
# on it as on the branch's instance. Takes a few minutes once the images are pulled; the flavor
# install downloads from extensions.xwiki.org.
#
# Usage:
#   before-instance.sh [--capture-dir <dir>] <version> <port>
#   before-instance.sh --remove <port>
#
# <version>       the released version to run, e.g. 18.7.0: image xwiki:<version>-mysql-tomcat.
# <port>          a free host port, bound to 127.0.0.1 only: the instance runs with the well-known
#                 `superadmin:system` credentials.
# --capture-dir   where installjobrequest.xml is written. Default: $CAPTURE_DIR, else a temp dir.
# --remove        remove the containers and network of the instance on <port>.
#
# Creates the containers xwiki-before-<port> and xwiki-before-<port>-db on the network
# xwiki-before-<port>. Prints BEFORE_URL=http://localhost:<port> as its last line: the image serves
# XWiki at the root context, with no /xwiki.
#
# Why each step exists, since none of it is obvious from the image:
# - XWiki connects as the database root user: a MYSQL_USER account lacks the PROCESS privilege the
#   schema migration needs, and a first start failing on it leaves a half-created schema behind.
# - The image starts as an empty wiki that sends every request, REST included, to the Distribution
#   Wizard. The script enables superadmin, turns off the wizard's automatic start, restarts, and
#   installs the flavor with the REST install job instead.
# - The wizard also creates XWiki.Admin, which the flavor's pages name as their author. Skipped, it
#   does not exist and every script those pages hold fails to render ("the execution of the
#   [velocity] script macro is not allowed"), so the script creates it with admin and programming
#   rights.
set -euo pipefail
# Print this script's own header comment as its usage text.
usage() {
  awk 'NR>1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"
  exit "${1:-1}"
}
die() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == -h || "${1:-}" == --help || $# -eq 0 ]]; then usage 0; fi

check_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ] \
    || die "'$1' is not a port number (1-65535)"
}

REMOVE=""
CAPTURE="${CAPTURE_DIR:-}"
while [[ "${1:-}" == --capture-dir || "${1:-}" == --remove ]]; do
  if [[ "$1" == --remove ]]; then REMOVE=1; shift; continue; fi
  [ $# -ge 2 ] || { echo "ERROR: $1 needs a value" >&2; echo >&2; usage 1 >&2; }
  CAPTURE="$2"; shift 2
done

if [ -n "$REMOVE" ]; then
  [ $# -eq 1 ] || { echo "ERROR: --remove expects <port>" >&2; echo >&2; usage 1 >&2; }
  check_port "$1"
  command -v docker >/dev/null || die "docker is not installed"
  docker rm -f "xwiki-before-$1" "xwiki-before-$1-db" >/dev/null 2>&1 || true
  docker network rm "xwiki-before-$1" >/dev/null 2>&1 || true
  echo "removed xwiki-before-$1, xwiki-before-$1-db and network xwiki-before-$1"
  exit 0
fi

if [ $# -ne 2 ]; then
  echo "ERROR: expected <version> <port>" >&2
  echo >&2
  usage 1 >&2
fi
V="$1"
PORT="$2"
[[ "$V" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?(-rc-[0-9]+)?$ ]] \
  || die "'$V' is not a released XWiki version (e.g. 18.7.0)"
check_port "$PORT"

NAME="xwiki-before-$PORT"
DB="$NAME-db"
BEFORE_URL="http://localhost:$PORT"
for tool in docker curl; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable - start Docker first"
if docker ps -a --format '{{.Names}}' | grep -qxE "$NAME|$DB"; then
  die "a container $NAME or $DB already exists. A failed first start leaves a half-created schema" \
    "behind, so recreate both rather than restarting one: $0 --remove $PORT"
fi
if command -v lsof >/dev/null && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT is already in use - pick a port nothing listens on"
fi
if [ -z "$CAPTURE" ]; then CAPTURE="$(mktemp -d)"; fi
mkdir -p "$CAPTURE"

# The HTTP code of a request, "000" when nothing answers.
code() { curl -s -o /dev/null -w '%{http_code}' "$@" || true; }
# Fail with the reason the logs give, when a known one is there.
fail_with_logs() {
  local logs
  logs="$(docker logs "$NAME" 2>&1 | tail -n 400)"
  if grep -q "PROCESS privilege" <<<"$logs"; then
    die "$1. The logs show a missing PROCESS privilege: XWiki must connect as the database root" \
      "user. The schema is now half-created: $0 --remove $PORT, then start again"
  fi
  die "$1 - check: docker logs $NAME"
}
# Wait until a request answers with one of the expected codes, up to $2 tries 3s apart.
wait_for() {
  local expected="$1" tries="$2" c i
  shift 2
  for i in $(seq 1 "$tries"); do
    c="$(code "$@")"
    [[ " $expected " == *" $c "* ]] && return 0
    sleep 3
  done
  return 1
}

echo "starting $NAME (xwiki:$V-mysql-tomcat) on 127.0.0.1:$PORT"
docker network create "$NAME" >/dev/null
docker run -d --name "$DB" --net "$NAME" -e MYSQL_ROOT_PASSWORD=xwiki \
  -e MYSQL_DATABASE=xwiki mysql:8.4 --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_bin --explicit-defaults-for-timestamp=1 >/dev/null
# DB_USER=root: a MYSQL_USER account lacks the PROCESS privilege (see the header).
docker run -d --name "$NAME" --net "$NAME" -p "127.0.0.1:$PORT:8080" \
  -e DB_HOST="$DB" -e DB_USER=root -e DB_PASSWORD=xwiki -e DB_DATABASE=xwiki \
  "xwiki:$V-mysql-tomcat" >/dev/null \
  || die "could not start xwiki:$V-mysql-tomcat - is $V a released version with a Docker image?"

# Edit the configuration once the entrypoint's first-start setup is done (its marker file), and
# before any request reaches XWiki, which would start the wizard and the schema creation.
W=/usr/local/tomcat/webapps/ROOT/WEB-INF
for i in $(seq 1 60); do
  docker exec "$NAME" test -f "$W/../.first_start_completed" 2>/dev/null && break
  [ "$i" -lt 60 ] || fail_with_logs "the container did not finish its first-start setup after 1min"
  sleep 1
done
docker exec "$NAME" sh -c "
  sed -i 's/^# xwiki.superadminpassword=system/xwiki.superadminpassword=system/' $W/xwiki.cfg
  grep -q '^distribution.automaticStartOnMainWiki=false' $W/xwiki.properties \
    || echo distribution.automaticStartOnMainWiki=false >> $W/xwiki.properties"
docker exec "$NAME" grep -q '^xwiki.superadminpassword=system' "$W/xwiki.cfg" \
  || die "could not enable superadmin: no '# xwiki.superadminpassword=system' line in $W/xwiki.cfg"
docker restart "$NAME" >/dev/null

echo "waiting for XWiki to answer as superadmin (up to 6min)"
REST="$BEFORE_URL/rest/wikis/xwiki"
if ! wait_for 200 120 -u superadmin:system "$REST"; then
  if [[ "$(curl -s -o /dev/null -w '%{redirect_url}' -u superadmin:system "$REST" || true)" == *distribution* ]]; then
    die "every request still goes to the Distribution Wizard: distribution.automaticStartOnMainWiki=false" \
      "did not take in $W/xwiki.properties - check: docker exec $NAME cat $W/xwiki.properties"
  fi
  fail_with_logs "XWiki did not answer $REST as superadmin after 6min"
fi

# The install-job request body of xwiki-deploy-extension, for the flavor of the main wiki.
REQUEST="$CAPTURE/installjobrequest.xml"
cat > "$REQUEST" <<EOF
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<jobRequest xmlns="http://www.xwiki.org">
  <id>
    <element>extension</element>
    <element>provision</element>
    <element>796fb04f-b095-4db8-a3ec-fa03f22051f8</element>
  </id>
  <interactive>false</interactive>
  <remote>false</remote>
  <verbose>true</verbose>
  <property>
    <key>extensions</key>
    <value>
      <list xmlns="" xmlns:ns2="http://www.xwiki.org">
        <org.xwiki.extension.ExtensionId>
          <id>org.xwiki.platform:xwiki-platform-distribution-flavor-mainwiki</id>
          <version class="org.xwiki.extension.version.internal.DefaultVersion" serialization="custom">
            <org.xwiki.extension.version.internal.DefaultVersion>
              <string>$V</string>
            </org.xwiki.extension.version.internal.DefaultVersion>
          </version>
        </org.xwiki.extension.ExtensionId>
      </list>
    </value>
  </property>
  <property>
    <key>extensions.excluded</key>
    <value>
      <set xmlns="" xmlns:ns2="http://www.xwiki.org"/>
    </value>
  </property>
  <property>
    <key>interactive</key>
    <value>
      <boolean xmlns="" xmlns:ns2="http://www.xwiki.org">false</boolean>
    </value>
  </property>
  <property>
    <key>namespaces</key>
    <value>
      <list xmlns="" xmlns:ns2="http://www.xwiki.org">
        <string>wiki:xwiki</string>
      </list>
    </value>
  </property>
</jobRequest>
EOF
echo "installing the flavor xwiki-platform-distribution-flavor-mainwiki $V (a couple of minutes)"
# Tried five times: the extension repositories (extensions.xwiki.org, nexus.xwiki.org) can time out,
# and each attempt reuses what the previous ones downloaded.
for attempt in 1 2 3 4 5; do
  ANSWER="$(curl -s -u superadmin:system -X PUT -H "Content-Type: text/xml" --upload-file "$REQUEST" \
    "$BEFORE_URL/rest/jobs?jobType=install&async=false" || true)"
  grep -q '<state>FINISHED</state>' <<<"$ANSWER" && break
  [ "$attempt" = 5 ] && die "the flavor install did not finish: $(head -c 300 <<<"${ANSWER:-no answer}")"
  echo "the flavor install failed ($(head -c 200 <<<"${ANSWER:-no answer}")), retrying"
done

# XWiki.Admin, which the wizard would have created (see the header).
P="$BEFORE_URL/rest/wikis/xwiki/spaces/XWiki/pages"
post() {
  local c
  c="$(curl -s -o /dev/null -w '%{http_code}' -u superadmin:system \
    -H "Content-Type: application/xml" -X "$1" "$2" --data "$3" || true)"
  [[ "$c" == 201 || "$c" == 202 ]] || die "creating XWiki.Admin failed ($1 $2 answered $c). Without" \
    "it every script of the flavor's pages fails to render: \"the execution of the [velocity] script" \
    "macro is not allowed\""
}
post PUT "$P/Admin" '<page xmlns="http://www.xwiki.org"><title>Admin</title>
  <content>{{include reference="XWiki.XWikiUserSheet"/}}</content></page>'
post POST "$P/Admin/objects" '<object xmlns="http://www.xwiki.org">
  <className>XWiki.XWikiUsers</className><property name="first_name"><value>Admin</value></property>
  <property name="password"><value>admin</value></property>
  <property name="active"><value>1</value></property></object>'
post POST "$P/XWikiPreferences/objects" '<object xmlns="http://www.xwiki.org">
  <className>XWiki.XWikiGlobalRights</className>
  <property name="users"><value>XWiki.Admin</value></property>
  <property name="levels"><value>admin,programming</value></property>
  <property name="allow"><value>1</value></property></object>'
[ "$(code -u Admin:admin "$REST")" = 200 ] || die "XWiki.Admin was created but Admin:admin is refused"
if curl -s -u Admin:admin "$BEFORE_URL/bin/view/Main/WebHome" | grep -q "script macro is not allowed"; then
  die "Main.WebHome still fails to run its scripts: XWiki.Admin lacks programming rights"
fi

echo "ready: Admin:admin works; remove with: $0 --remove $PORT"
echo "BEFORE_URL=$BEFORE_URL"
