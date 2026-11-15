// The org conventions hook: a SessionStart hook for Claude Code, and in `prompt` mode a
// UserPromptSubmit hook for Kimi Code, which discards SessionStart output but appends a prompt hook's
// plain stdout to the context — so Kimi gets the text on a session's first prompt only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(HOME, 'xwiki', 'scripts', 'inject-org-instructions.mjs');

function repo(remote) {
  const dir = mkdtempSync(join(tmpdir(), 'org-inject-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  if (remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
  return dir;
}

// Runs the hook with a host's environment, an isolated state root and no XWIKI_LLM_ORGS.
function run(args, payload, hostEnv, state) {
  const env = { ...process.env, XDG_STATE_HOME: state, XWIKI_LLM_WORK: join(state, 'work'), HOME: state, ...hostEnv };
  for (const k of ['CLAUDE_PLUGIN_ROOT', 'KIMI_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR', 'XWIKI_LLM_ORGS']) {
    if (!(k in hostEnv)) delete env[k];
  }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  return { status: r.status, out: r.stdout };
}

const KIMI = { KIMI_PLUGIN_ROOT: HOME };
const CLAUDE = { CLAUDE_PLUGIN_ROOT: join(HOME, 'xwiki') };
const SCOPED = 'https://github.com/xwiki/xwiki-platform.git';

test('Kimi: a scoped repo gets the conventions as plain text on the first prompt, then nothing', () => {
  const dir = repo(SCOPED);
  const state = mkdtempSync(join(tmpdir(), 'org-inject-state-'));
  const payload = { hook_event_name: 'UserPromptSubmit', session_id: 'session_abc', cwd: dir, prompt: 'hi' };
  const first = run(['prompt'], payload, KIMI, state);
  assert.equal(first.status, 0);
  assert.match(first.out, /^# /m);
  assert.match(first.out, /This machine's work directory:.*org-inject-/);
  assert.throws(() => JSON.parse(first.out), SyntaxError);
  assert.deepEqual(run(['prompt'], payload, KIMI, state), { status: 0, out: '' });
  // Another session still gets it.
  assert.notEqual(run(['prompt'], { ...payload, session_id: 'session_def' }, KIMI, state).out, '');
});

test('Kimi: an unscoped repo, or a payload without a session id, gets nothing', () => {
  const state = mkdtempSync(join(tmpdir(), 'org-inject-state-'));
  for (const dir of [repo('https://github.com/someone/personal.git'), repo(null)]) {
    assert.deepEqual(run(['prompt'], { session_id: 's1', cwd: dir }, KIMI, state), { status: 0, out: '' });
  }
  assert.deepEqual(run(['prompt'], { cwd: repo(SCOPED) }, KIMI, state), { status: 0, out: '' });
});

test('Kimi: an error never breaks the prompt', () => {
  // A state root that cannot be created: the marker write fails.
  const state = join(mkdtempSync(join(tmpdir(), 'org-inject-state-')), 'file');
  execFileSync('touch', [state]);
  assert.deepEqual(run(['prompt'], { session_id: 's1', cwd: repo(SCOPED) }, KIMI, state), { status: 0, out: '' });
});

test('Claude Code: the SessionStart output is unchanged, on every session', () => {
  const dir = repo(SCOPED);
  const state = mkdtempSync(join(tmpdir(), 'org-inject-state-'));
  const payload = { hook_event_name: 'SessionStart', session_id: 's1', cwd: dir };
  const outs = [run([], payload, CLAUDE, state), run([], payload, CLAUDE, state)];
  for (const { status, out } of outs) {
    assert.equal(status, 0);
    const { hookSpecificOutput: o } = JSON.parse(out);
    assert.equal(o.hookEventName, 'SessionStart');
    assert.match(o.additionalContext, /This machine's work directory:/);
  }
  assert.equal(outs[0].out, outs[1].out);
  assert.equal(run([], { cwd: repo('https://github.com/someone/personal.git') }, CLAUDE, state).out, '');
});
