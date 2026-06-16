---
name: extension
description: Deploy an XWiki extension (XAR or JAR) to a running XWiki instance via the REST job API. Use when the user wants to install, deploy, or hot-reload a built extension into a local XWiki.
---

To deploy an XWiki extension (XAR, JAR), to a running XWiki install, do the following:
0) If the extension is a core extension (i.e. located in webapps/xwiki/WEB-INF/lib) then simply replace the jar with the new one and don't go over the next steps and ask the dev to restart XWiki.
1) Find the id of the extension to deploy: it's the maven groupId followed by ":", followed by the maven artifactId of the extension, which you can find in the pom.xml
2) Also find the version in the version property in the pom.xml
3) Generate an XML file named installjobrequest.xml in the target dir of the extension to deploy,  exactly like the following one (replace the string "id here" and "version here" by the extension id and the version value):

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
4) If the install fails because the extension is already installed, first uninstall it by generating an XML file named uninstalljobrequest.xml in the target dir, exactly like installjobrequest.xml but without the `extensions.excluded` and `interactive` properties, then run:
`curl -i --user "Admin:admin" -X PUT -H "Content-Type: text/xml" "http://localhost:8080/xwiki/rest/jobs?jobType=uninstall&async=false" --upload-file uninstalljobrequest.xml`
Then re-run the install curl command.
5) Run `curl -i --user "Admin:admin" -X PUT -H "Content-Type: text/xml" "http://localhost:8080/xwiki/rest/jobs?jobType=install&async=false" --upload-file installjobrequest.xml`
