// The end-of-session critic trigger (xwiki/scripts/diff-critic.mjs): blocks a stop once per session, only
// when the session changed its repo, never in a loop, never outside the repos in scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { agent, start, stop } from '../../xwiki/scripts/diff-critic.mjs';

const HEADER = '<!-- See the NOTICE file distributed with this work. GNU Lesser General Public License. -->\n';

function repo(remote = 'https://github.com/xwiki-contrib/application-foo.git') {
  const dir = mkdtempSync(join(tmpdir(), 'diff-critic-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'T');
  if (remote) git('remote', 'add', 'origin', remote);
  writeFileSync(join(dir, 'pom.xml'), `${HEADER}<project><version>1.0-SNAPSHOT</version></project>\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return { dir, git };
}

function write(dir, p, c) {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), c);
}

const TEST = 'foo-api/src/test/java/org/xwiki/foo/FooTest.java';
const env = {};
const setup = (remote) => {
  const r = repo(remote);
  const stateDir = mkdtempSync(join(tmpdir(), 'diff-critic-state-'));
  const payload = { session_id: 's1', cwd: r.dir };
  return { ...r, stateDir, payload };
};

test('a session that changed nothing stops without a request', () => {
  const { stateDir, payload } = setup();
  start(payload, { stateDir, env });
  assert.equal(stop(payload, { stateDir, env }), '');
});

test('a changed work tree asks once for the critic, naming the mapped skill, then never again', () => {
  const { dir, stateDir, payload } = setup();
  start(payload, { stateDir, env });
  write(dir, TEST, 'class FooTest\n{\n}\n');
  const reason = stop(payload, { stateDir, env });
  assert.match(reason, /xwiki-diff-critic/);
  assert.match(reason, /FooTest\.java/);
  assert.match(reason, /not in the background/);
  assert.match(reason, /xwiki-test-guidelines/);
  assert.equal(stop(payload, { stateDir, env }), '');
  write(dir, 'Other.java', 'class Other {}\n');
  assert.equal(stop(payload, { stateDir, env }), '');
});

test('a new commit counts as a change, and the base is the start HEAD', () => {
  const { dir, git, stateDir, payload } = setup();
  const base = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  start(payload, { stateDir, env });
  write(dir, 'src/main/java/Foo.java', 'class Foo {}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'FOO-1: Foo');
  const reason = stop(payload, { stateDir, env });
  assert.match(reason, new RegExp(`Base: ${base}`));
});

test('stop_hook_active never blocks', () => {
  const { dir, stateDir, payload } = setup();
  start(payload, { stateDir, env });
  write(dir, TEST, 'class FooTest {}\n');
  assert.equal(stop({ ...payload, stop_hook_active: true }, { stateDir, env }), '');
  assert.notEqual(stop(payload, { stateDir, env }), '');
});

test('a critic the session already ran is not asked for', () => {
  const { dir, stateDir, payload } = setup();
  start(payload, { stateDir, env });
  write(dir, TEST, 'class FooTest {}\n');
  agent({ ...payload, tool_input: { subagent_type: 'xwiki:xwiki-diff-critic', prompt: 'x' } }, { stateDir });
  assert.equal(stop(payload, { stateDir, env }), '');
});

test('another agent does not count as the critic', () => {
  const { dir, stateDir, payload } = setup();
  start(payload, { stateDir, env });
  write(dir, TEST, 'class FooTest {}\n');
  agent({ ...payload, tool_input: { subagent_type: 'Explore' } }, { stateDir });
  assert.notEqual(stop(payload, { stateDir, env }), '');
});

test('silent outside the repos in scope, without a baseline, or when turned off', () => {
  const out = setup('https://github.com/someone/personal.git');
  start(out.payload, { stateDir: out.stateDir, env });
  write(out.dir, TEST, 'class FooTest {}\n');
  assert.equal(stop(out.payload, { stateDir: out.stateDir, env }), '');

  const noBase = setup();
  write(noBase.dir, TEST, 'class FooTest {}\n');
  assert.equal(stop(noBase.payload, { stateDir: noBase.stateDir, env }), '');

  const off = setup();
  start(off.payload, { stateDir: off.stateDir, env });
  write(off.dir, TEST, 'class FooTest {}\n');
  assert.equal(stop(off.payload, { stateDir: off.stateDir, env: { XWIKI_LLM_DIFF_CRITIC: 'off' } }), '');
});

test('a resumed session keeps its first baseline', () => {
  const { dir, stateDir, payload } = setup();
  start(payload, { stateDir, env });
  write(dir, TEST, 'class FooTest {}\n');
  start(payload, { stateDir, env });
  assert.notEqual(stop(payload, { stateDir, env }), '');
});

test('an unwritable state never blocks', () => {
  const { dir, stateDir, payload } = setup();
  start(payload, { stateDir, env });
  write(dir, TEST, 'class FooTest {}\n');
  execFileSync('chmod', ['a-w', join(stateDir, 's1.critic.json')]);
  try {
    assert.equal(stop(payload, { stateDir, env }), '');
  } finally {
    execFileSync('chmod', ['u+w', join(stateDir, 's1.critic.json')]);
  }
});
