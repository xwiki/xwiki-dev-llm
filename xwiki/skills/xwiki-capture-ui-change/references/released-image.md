# The released version's Docker image

Read by `xwiki-capture-ui-change` when its "Cheapest first" section picked the released version's
official Docker image for the "before", before the first `docker run`. Step numbers are those of
that skill's `SKILL.md`; `$CAPTURE_DIR` and the browser session come from its environment block.

```bash
V=18.7.0   # the latest release the bug affects
docker network create xwiki-before
docker run -d --name xwiki-before-db --net xwiki-before -e MYSQL_ROOT_PASSWORD=xwiki \
  -e MYSQL_DATABASE=xwiki mysql:8.4 --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_bin --explicit-defaults-for-timestamp=1
docker run -d --name xwiki-before --net xwiki-before -p 127.0.0.1:8089:8080 \
  -e DB_HOST=xwiki-before-db \
  -e DB_USER=root -e DB_PASSWORD=xwiki -e DB_DATABASE=xwiki "xwiki:$V-mysql-tomcat"
```

Pick a host port nothing listens on (8089 here), and keep it bound to `127.0.0.1`: the instance
runs with a well-known `superadmin` password. Four things about the image are not obvious:

- **XWiki connects as the database root user.** A `MYSQL_USER` account lacks the `PROCESS`
  privilege XWiki's schema migration needs, and a first start that fails on it leaves a
  half-created schema behind: recreate both containers rather than restarting one.
- **It serves XWiki at the root context:** `http://localhost:8089`, with no `/xwiki`. Keep that
  in its own `BEFORE_URL`; `XWIKI_BASE_URL` stays the branch's instance, which step 0 waits on.
- **It starts as an empty wiki** that sends every request, REST included, to the Distribution
  Wizard. Skip the wizard: enable `superadmin`, turn off the wizard's automatic start, restart, and
  install the flavor as `superadmin:system` with the install-job request body of
  `xwiki-deploy-extension`, saved as `$CAPTURE_DIR/installjobrequest.xml` and filled with extension
  `org.xwiki.platform:xwiki-platform-distribution-flavor-mainwiki` and version `$V` (its namespace
  `wiki:xwiki` is already right). The job downloads from
  extensions.xwiki.org and takes a couple of minutes.
- **The wizard also creates `XWiki.Admin`**, and the flavor's pages name it as their author.
  Skipped, it does not exist, so every script those pages hold fails to render ("the execution of
  the [velocity] script macro is not allowed … check the rights of its last author"). Create it
  with admin and programming rights, after which `Admin:admin` works here as on the branch's
  instance and `superadmin` is only needed for this setup.

```bash
docker exec xwiki-before sh -c 'W=/usr/local/tomcat/webapps/ROOT/WEB-INF
  sed -i "s/^# xwiki.superadminpassword=system/xwiki.superadminpassword=system/" $W/xwiki.cfg
  echo distribution.automaticStartOnMainWiki=false >> $W/xwiki.properties'
docker restart xwiki-before
BEFORE_URL=http://localhost:8089
UP=""
for i in $(seq 1 60); do
  curl -sf -o /dev/null -u superadmin:system "$BEFORE_URL/rest/wikis/xwiki" && { UP=1; break; }
  sleep 3
done
[ -n "$UP" ] || echo "not up after 3min, check: docker logs xwiki-before"
curl -s -u superadmin:system -X PUT -H "Content-Type: text/xml" \
  --upload-file "$CAPTURE_DIR/installjobrequest.xml" "$BEFORE_URL/rest/jobs?jobType=install&async=false" \
  | grep -o '<state>[^<]*</state>'   # expect FINISHED
P="$BEFORE_URL/rest/wikis/xwiki/spaces/XWiki/pages"
X=(-s -o /dev/null -w '%{http_code}\n' -u superadmin:system -H "Content-Type: application/xml")
curl "${X[@]}" -X PUT "$P/Admin" --data '<page xmlns="http://www.xwiki.org"><title>Admin</title>
  <content>{{include reference="XWiki.XWikiUserSheet"/}}</content></page>'
curl "${X[@]}" -X POST "$P/Admin/objects" --data '<object xmlns="http://www.xwiki.org">
  <className>XWiki.XWikiUsers</className><property name="first_name"><value>Admin</value></property>
  <property name="password"><value>admin</value></property>
  <property name="active"><value>1</value></property></object>'
curl "${X[@]}" -X POST "$P/XWikiPreferences/objects" --data '<object xmlns="http://www.xwiki.org">
  <className>XWiki.XWikiGlobalRights</className>
  <property name="users"><value>XWiki.Admin</value></property>
  <property name="levels"><value>admin,programming</value></property>
  <property name="allow"><value>1</value></property></object>'   # each: 201
```

Then pick the fixture (step 2) and shoot it as step 3 does, against `$BEFORE_URL`. A page or
object the fixture needs is created on both instances by the same REST write as `Admin:admin`,
with only the base URL changing: `$BEFORE_URL/rest/…` here, `$XWIKI_BASE_URL/rest/…` (with its
`/xwiki`) on the branch's. Remove the
containers when done: `docker rm -f xwiki-before xwiki-before-db && docker network rm xwiki-before`.
