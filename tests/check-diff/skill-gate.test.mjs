// The commit skill gate (check-diff.mjs + the skill loads kb-hooks.mjs records): a commit touching files
// whose rules live in a skill the session has not loaded is refused once per skill, never twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkCommit } from '../../xwiki/scripts/check-diff.mjs';
import { runHook } from '../../xwiki/scripts/kb-hooks.mjs';

const HEADER = '<!-- See the NOTICE file distributed with this work. GNU Lesser General Public License. -->\n';

function repo(changes, remote = 'https://github.com/xwiki-contrib/application-foo.git') {
  const dir = mkdtempSync(join(tmpdir(), 'skill-gate-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'T');
  git('remote', 'add', 'origin', remote);
  writeFileSync(join(dir, 'pom.xml'), `${HEADER}<project><version>1.0-SNAPSHOT</version></project>\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  for (const [p, c] of Object.entries(changes)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git('add', '-A');
  return dir;
}

const COMMIT = "git commit -m 'FOO-1: Fix foo'";
const gate = (dir, sessionId, stateDir, env = {}) => checkCommit(COMMIT, { cwd: dir, sessionId, stateDir, env }).deny;
const TEST = 'foo-api/src/test/java/org/xwiki/foo/FooTest.java';
const JAVA_TEST = '/*\n * See the NOTICE file. GNU Lesser General Public License.\n */\nclass FooTest\n{\n}\n';

test('a test change is refused once for the unloaded test skills, then goes through', () => {
  const dir = repo({ [TEST]: JAVA_TEST });
  const state = mkdtempSync(join(tmpdir(), 'skill-gate-state-'));
  const first = gate(dir, 's1', state);
  assert.match(first, /XWiki skill gate/);
  assert.match(first, /skills xwiki-test-guidelines, xwiki-increase-test-coverage/);
  assert.equal(gate(dir, 's1', state), '');
  // Another session starts over.
  assert.match(gate(dir, 's2', state), /xwiki-test-guidelines/);
});

test('a skill loaded through the Skill tool is not asked for', () => {
  const dir = repo({ [TEST]: JAVA_TEST });
  const state = mkdtempSync(join(tmpdir(), 'skill-gate-state-'));
  runHook('skill', { session_id: 's3', cwd: dir, tool_input: { skill: 'xwiki:xwiki-test-guidelines' } }, { stateDir: state, cacheDir: null });
  const deny = gate(dir, 's3', state);
  assert.doesNotMatch(deny, /xwiki-test-guidelines/);
  assert.match(deny, /skill xwiki-increase-test-coverage, which/);
});

test('XAR pages, translations and legacy code map to their skills; other resources do not', () => {
  const state = mkdtempSync(join(tmpdir(), 'skill-gate-state-'));
  const page = 'foo-ui/src/main/resources/Foo/WebHome.xml';
  assert.match(gate(repo({ [page]: `<?xml version="1.1"?>\n${HEADER}<xwikidoc version="1.5">\n<content>Hi</content>\n</xwikidoc>\n` }), 'x1', state),
    /xwiki-xar-pages/);
  assert.equal(gate(repo({ 'foo-api/src/main/resources/logback.xml': `${HEADER}<configuration/>\n` }), 'x2', state), '');
  const tr = 'foo-ui/src/main/resources/ApplicationResources.properties';
  assert.match(gate(repo({ [tr]: '# GNU Lesser General Public License\nfoo.title=Foo\n' }), 'x3', state), /xwiki-translations/);
  const legacy = 'foo-legacy/src/main/java/org/xwiki/foo/OldFoo.java';
  assert.match(gate(repo({ [legacy]: '/* License */\nclass OldFoo\n{\n    @Deprecated(since = "1.0")\n    void old()\n    {\n    }\n}\n' }), 'x4', state),
    /xwiki-legacy/);
});

test('no gate without a session, under Kimi Code, or with the gates off', () => {
  const dir = repo({ [TEST]: JAVA_TEST });
  const state = mkdtempSync(join(tmpdir(), 'skill-gate-state-'));
  assert.equal(gate(dir, null, state), '');
  assert.equal(gate(dir, 'k1', state, { KIMI_PLUGIN_ROOT: '/k' }), '');
  assert.equal(gate(dir, 'k2', state, { XWIKI_LLM_COMMIT_GATES: 'off' }), '');
});
