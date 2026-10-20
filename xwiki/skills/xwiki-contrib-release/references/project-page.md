# Creating a Project page on extensions.xwiki.org

Read by `xwiki-contrib-release` §6 when the modules have standalone pages and no Project page.

1. Create `Extension/<Space>/WebHome` with an `ExtensionCode.ProjectClass` (`id` =
   `<groupId>:<parent artifactId>`, plus name, summary, description, entryPoints…) and an
   `ExtensionCode.ExtensionProxyClass` copied from a module page: without it, no "Update project"
   button.
2. Move each module page under it (rename: preserve children, update links, automatic redirect).
   Links on the other wikis, the xwiki.org blog posts included, get updated too.
3. Click "Update project". It names the Project from the parent pom's `xwiki.extension.name`
   (`okf/conventions/naming.md`): set it first.
4. That import creates a Project version page for **every past version**, with an empty `notes`, and
   those now replace the modules' ones on display: fill them all as in §7.
