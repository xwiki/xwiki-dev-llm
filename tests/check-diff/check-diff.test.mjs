// The commit-time diff check (xwiki/scripts/check-diff.mjs), on real git repos shaped like XWiki's:
// what it refuses, and the false positives it must not raise (moved code, backports, existing
// deprecations, overrides, internal and test modules, contrib repos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkCommit, nextRelease, pomVersion } from '../../xwiki/scripts/check-diff.mjs';

const LICENSE = `/*
 * See the NOTICE file distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 */
`;
const POM = `<?xml version="1.0" encoding="UTF-8"?>
<!-- See the NOTICE file distributed with this work. GNU Lesser General Public License. -->
<project>
  <parent>
    <groupId>org.xwiki.commons</groupId>
    <artifactId>xwiki-commons-pom</artifactId>
    <version>18.9.0</version>
  </parent>
  <groupId>org.xwiki.platform</groupId>
  <artifactId>xwiki-platform</artifactId>
  <version>18.9.0-SNAPSHOT</version>
</project>
`;
const API = 'xwiki-platform-core/xwiki-platform-foo/xwiki-platform-foo-api/src/main/java/org/xwiki/foo';
const javaClass = (body, { pkg = 'org.xwiki.foo', name = 'FooManager', annotations = '' } = {}) => `${LICENSE}package ${pkg};

/**
 * Manages foos.
 *
 * @version $Id$
 * @since 17.0.0RC1
 */
${annotations}public class ${name}
{
    /**
     * @return the existing foo
     */
    public String getFoo()
    {
        return "foo";
    }
${body}}
`;
const env = {};
const ORIGIN = 'https://github.com/xwiki/xwiki-platform.git';

/** A repo with an initial commit holding `files`, then `changes` written and staged. */
function repo(files, changes = {}, { remote = ORIGIN, stage = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-diff-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'T');
  if (remote) git('remote', 'add', 'origin', remote);
  const write = (all) => {
    for (const [p, c] of Object.entries(all)) {
      if (c === null) { rmSync(join(dir, p)); continue; }
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
  };
  write({ 'pom.xml': POM, ...files });
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  write(changes);
  if (stage) git('add', '-A');
  return dir;
}

const run = (dir, command = "git commit -m 'XWIKI-1: Add foo'") => checkCommit(command, { cwd: dir, env });
const rules = (r) => [...r.deny.matchAll(/^kb\/conventions\/([\w-]+)\.md/gm)].map((m) => m[1]);
const base = { [`${API}/FooManager.java`]: javaClass('') };
const withMethod = (method) => ({ [`${API}/FooManager.java`]: javaClass(method) });

test('the next release follows versioning.md', () => {
  assert.equal(nextRelease('18.9.0-SNAPSHOT'), '18.9.0RC1');
  assert.equal(nextRelease('16.10.20-SNAPSHOT'), '16.10.20');
  assert.equal(nextRelease('18.9.0'), null);
  assert.equal(pomVersion(POM), '18.9.0-SNAPSHOT');
});

test('a new public method with @Unstable and the next release passes', () => {
  const r = run(repo(base, withMethod(`
    /**
     * @return the bar
     * @since 18.9.0RC1
     */
    @Unstable
    public String getBar()
    {
        return "bar";
    }
`)));
  assert.deepEqual(r, { deny: '', context: '' });
});

test('a new public method without @Unstable is refused, with the rule home', () => {
  const r = run(repo(base, withMethod(`
    /**
     * @return the bar
     * @since 18.9.0RC1
     */
    public String getBar()
    {
        return "bar";
    }
`)));
  assert.deepEqual(rules(r), ['backward-compatibility']);
  assert.match(r.deny, /FooManager#getBar/);
  assert.match(r.deny, /Diff-Check: skip/);
});

test('a wrong or malformed @since is refused; a final of the previous minor passes', () => {
  const method = (v) => withMethod(`
    /**
     * @return the bar
     * @since ${v}
     */
    @Unstable
    public String getBar()
    {
        return "bar";
    }
`);
  assert.deepEqual(rules(run(repo(base, method('18.9RC1')))), ['versioning']);
  assert.match(run(repo(base, method('18.8.0RC1'))).deny, /does not name the next release, `18\.9\.0RC1`/);
  assert.equal(run(repo(base, method('18.8.0'))).deny, '');
});

test('a backport line added to an existing @since block passes', () => {
  const before = withMethod(`
    /**
     * @return the bar
     * @since 18.9.0RC1
     */
    @Unstable
    public String getBar()
    {
        return "bar";
    }
`);
  const after = withMethod(`
    /**
     * @return the bar
     * @since 18.4.7
     * @since 18.9.0RC1
     */
    @Unstable
    public String getBar()
    {
        return "bar";
    }
`);
  assert.equal(run(repo(before, after)).deny, '');
});

test('a javadoc @deprecated repeating the version is refused', () => {
  const r = run(repo(base, withMethod(`
    /**
     * @return the old foo
     * @deprecated since 18.9.0RC1, use {@link #getFoo()} instead
     */
    @Deprecated(since = "18.9.0RC1")
    public String getOldFoo()
    {
        return "foo";
    }
`)));
  assert.deepEqual(rules(r), ['versioning']);
  assert.match(r.deny, /repeats the version/);
});

test('adding since to an existing deprecation keeps its old version', () => {
  const old = (annotation) => withMethod(`
    /**
     * @return the old foo
     * @deprecated use {@link #getFoo()} instead
     */
    ${annotation}
    public String getOldFoo()
    {
        return "foo";
    }
`);
  assert.equal(run(repo(old('@Deprecated'), old('@Deprecated(since = "2.4M1")'))).deny, '');
  // Sonar's S1123: the annotation added under a javadoc tag that was already there.
  assert.equal(run(repo(old(''), old('@Deprecated(since = "9.0RC1,8.4.2")'))).deny, '');
});

test('moving a class to a -legacy module raises nothing', () => {
  const cls = javaClass('', { name: 'OldFoo' });
  const r = run(repo({ [`${API}/OldFoo.java`]: cls }, {
    [`${API}/OldFoo.java`]: null,
    [`xwiki-platform-core/xwiki-platform-legacy/xwiki-platform-legacy-foo/src/main/java/org/xwiki/foo/OldFoo.java`]: cls,
  }));
  assert.deepEqual(r, { deny: '', context: '' });
});

test('internal packages, test modules, overrides and changed signatures need no @Unstable', () => {
  const internal = 'xwiki-platform-core/xwiki-platform-foo/xwiki-platform-foo-default/src/main/java/org/xwiki/foo/internal';
  assert.equal(run(repo({}, { [`${internal}/DefaultFoo.java`]: javaClass('', { pkg: 'org.xwiki.foo.internal', name: 'DefaultFoo' }).replace('17.0.0RC1', '18.9.0RC1') })).deny, '');
  const po = 'xwiki-platform-core/xwiki-platform-foo/xwiki-platform-foo-test/xwiki-platform-foo-test-pageobjects/src/main/java/org/xwiki/foo/test/po';
  assert.equal(run(repo({}, { [`${po}/FooPage.java`]: javaClass('', { pkg: 'org.xwiki.foo.test.po', name: 'FooPage' }).replace('17.0.0RC1', '18.9.0RC1') })).deny, '');
  assert.equal(run(repo(base, withMethod(`
    @Override
    public String toString()
    {
        return "foo";
    }
`))).deny, '');
  // A new overload is new API, even when the old one's declaration line is touched too.
  assert.match(run(repo(base, { [`${API}/FooManager.java`]: javaClass(`
    /**
     * @param id the id
     * @return the foo
     * @since 18.9.0RC1
     */
    public String getFoo(int id)
    {
        return "foo";
    }
`).replace('public String getFoo()', 'public String getFoo( )') })).deny, /FooManager#getFoo/);
  // A generics fix changes the line declaring getFoo: not a new method.
  const generic = javaClass('').replace('public String getFoo()', 'public <T> T getFoo()');
  assert.equal(run(repo(base, { [`${API}/FooManager.java`]: generic })).deny, '');
});

test('a new public class and a new interface method are refused without @Unstable', () => {
  const r = run(repo({}, { [`${API}/NewFoo.java`]: javaClass('', { name: 'NewFoo' }).replace('17.0.0RC1', '18.9.0RC1') }));
  assert.match(r.deny, /new public API `NewFoo`/);
  const iface = (m) => `${LICENSE}package org.xwiki.foo;

/**
 * @version $Id$
 */
public interface FooService
{
    /**
     * @return foo
     */
    String foo();
${m}}
`;
  const r2 = run(repo({ [`${API}/FooService.java`]: iface('') }, { [`${API}/FooService.java`]: iface(`
    /**
     * @return bar
     * @since 18.9.0RC1
     */
    default String bar()
    {
        return null;
    }
`) }));
  assert.match(r2.deny, /FooService#bar/);
});

test('a .properties file turned UTF-8 is refused; \\u escapes and ISO-8859-1 pass', () => {
  const p = 'xwiki-platform-core/xwiki-platform-foo/src/main/resources/ApplicationResources_fr.properties';
  const head = '# See the NOTICE file distributed with this work. GNU Lesser General Public License.\n';
  const r = run(repo({ [p]: `${head}foo.title=Titre\n` }, { [p]: `${head}foo.title=Titre\nfoo.hint=Détails :\n` }));
  assert.deepEqual(rules(r), ['code-style']);
  assert.match(r.deny, /ISO-8859-1/);
  assert.equal(run(repo({ [p]: `${head}a=b\n` }, { [p]: `${head}a=b\nfoo.hint=D\\u00e9tails\n` })).deny, '');
  assert.equal(run(repo({ [p]: `${head}a=b\n` }, { [p]: Buffer.from(`${head}a=b\nfoo.hint=Détails\n`, 'latin1') })).deny, '');
});

test('a new source file without a license header is refused; JSON and test resources are not', () => {
  const r = run(repo({}, { [`${API}/Bare.java`]: 'package org.xwiki.foo;\n\n/**\n * @version $Id$\n * @since 18.9.0RC1\n */\n@Unstable\npublic class Bare\n{\n}\n' }));
  assert.deepEqual(rules(r), ['code-style']);
  assert.match(r.deny, /license header/);
  assert.equal(run(repo({}, { 'xwiki-platform-core/foo/package.json': '{"name":"foo"}\n',
    'xwiki-platform-core/foo/src/test/resources/data.xml': '<data/>\n' })).deny, '');
});

test('a contrib repo gets the license and encoding rules only', () => {
  const r = run(repo(base, withMethod(`
    /**
     * @since 1.3
     */
    public String getBar()
    {
        return "bar";
    }
`), { remote: 'https://github.com/xwiki-contrib/application-foo.git' }));
  assert.equal(r.deny, '');
});

test('the trailer and the environment variable skip the check; other commands and repos are ignored', () => {
  const dir = repo(base, withMethod(`
    public String getBar()
    {
        return "bar";
    }
`));
  assert.notEqual(run(dir).deny, '');
  assert.equal(run(dir, "git commit -m 'XWIKI-1: Add foo' -m 'Diff-Check: skip (getBar is a test hook)'").deny, '');
  assert.equal(checkCommit("git commit -m 'XWIKI-1: Add foo'", { cwd: dir, env: { XWIKI_LLM_COMMIT_GATES: 'off' } }).deny, '');
  assert.equal(run(dir, 'git status').deny, '');
  assert.equal(run(repo(base, withMethod('    public String getBar()\n    {\n        return null;\n    }\n'),
    { remote: 'https://github.com/someone/foo.git' })).deny, '');
});

test('a git add in the same command brings unstaged and untracked files in', () => {
  const dir = repo(base, { [`${API}/Bare.java`]: 'package org.xwiki.foo;\n\npublic class Bare\n{\n}\n' }, { stage: false });
  assert.equal(run(dir).deny, '');
  assert.match(run(dir, "git add -A && git commit -m 'XWIKI-1: Add foo'").deny, /license header/);
});

test('heuristics come back as advice, never as a refusal', () => {
  const mod = 'xwiki-platform-core/xwiki-platform-foo/xwiki-platform-foo-api';
  const pom = '<project><properties><xwiki.jacoco.instructionRatio>0.50</xwiki.jacoco.instructionRatio></properties></project>\n';
  const t = `${mod}/src/test/java/org/xwiki/foo/FooManagerTest.java`;
  const r = run(repo({ ...base, [`${mod}/pom.xml`]: pom, [t]: `${LICENSE}class FooManagerTest\n{\n}\n` },
    { [t]: `${LICENSE}class FooManagerTest\n{\n    void bar()\n    {\n    }\n}\n` }));
  assert.equal(r.deny, '');
  assert.match(r.context, /instructionRatio/);
  const vm = 'xwiki-platform-core/xwiki-platform-foo/xwiki-platform-foo-ui/src/main/resources/templates/foo.vm';
  const r2 = run(repo({ [vm]: '## License\n#set ($a = 1)\n' }, { [vm]: '## License\n#set ($a = 2)\n' }), "git commit -m '[Misc] Tweak foo'");
  assert.match(r2.context, /no test in the commit/);
  assert.match(r2.context, /\[Misc\]/);
});
