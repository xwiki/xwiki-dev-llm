---
name: xwiki-deploy-extension
description: Deploy an XWiki extension (XAR or JAR) to a running XWiki instance via the REST job API. Use when the user wants to install, deploy, or hot-reload a built extension into a local XWiki.
---

To read or change pages or objects on a running XWiki, use `xwiki-rest-api`; to edit the XAR's pages before building it, `xwiki-xar-pages`; to shoot a UI fix's "before", `xwiki-capture-ui-change`.

To deploy an XWiki extension (XAR, JAR), to a running XWiki install, do the following:
0) If the extension is a core extension (i.e. located in webapps/xwiki/WEB-INF/lib) then simply replace the jar with the new one and don't go over the next steps and ask the dev to restart XWiki. Find that directory from the process listening on the port (`lsof -nP -iTCP:8080 -sTCP:LISTEN -t`, then `lsof -a -p <pid> -d cwd -Fn`), never by guessing. Build the jar on the instance's branch; for a module that a `-legacy` module weaves, the jar to replace is the legacy one.
1) The extension id is `<groupId>:<artifactId>` and its version the `<version>`, both from its pom.xml.
2) Generate `installjobrequest.xml` in the extension's target dir, exactly like the following one, with the id and version in place of "id here" and "version here":

```

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
          <id>id here</id>
          <version class="org.xwiki.extension.version.internal.DefaultVersion" serialization="custom">
            <org.xwiki.extension.version.internal.DefaultVersion>
              <string>version here</string>
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
```
3) If the install fails because the extension is already installed, first uninstall it by generating `uninstalljobrequest.xml` in the target dir, like installjobrequest.xml but without the `extensions.excluded` and `interactive` properties, then run:
`curl -i --user "Admin:admin" -X PUT -H "Content-Type: text/xml" "http://localhost:8080/xwiki/rest/jobs?jobType=uninstall&async=false" --upload-file uninstalljobrequest.xml`
Then re-run the install curl command, then check it with the browser cache disabled: reinstalled pages are back at version 1.1, and their JSX/SSX URLs (cached 30 days) only change with it, so the browser keeps the old scripts.
4) Run `curl -i --user "Admin:admin" -X PUT -H "Content-Type: text/xml" "http://localhost:8080/xwiki/rest/jobs?jobType=install&async=false" --upload-file installjobrequest.xml`
5) To switch a set of installed extensions to another version (e.g. back to the previous release): installing only the top extension at the old version leaves the newer dependencies in place, since they still satisfy it. Run one install job per extension, dependents first (UI, then macros, then APIs) — a job plans against the current state and refuses to break a dependency — and the reverse order to go back up; an extension installed on a subwiki namespace needs its own jobs. Then check the versions from a wiki page listing `$services.extension.installed.getInstalledExtensions()` (root and each wiki namespace), not from the files on disk.
6) A local `-SNAPSHOT` build silently loses to a published snapshot of the same version: the dependencies resolve from the repositories declared in the extension's POMs before the local Maven repository. Build it under a version no repository has (e.g. `X.Y.Z-local-SNAPSHOT`) to deploy it.
