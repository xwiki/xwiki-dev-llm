// The KB pointer hooks: scoping by git remote, the prompt hook's score threshold (with the probes that
// justify it, on the shipped KB), the edit hook's glob ranking and Sonar exclusion, per-session dedupe,
// and the never-fail rule — fed the stdin payloads Claude Code and Kimi Code actually send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'kb-hooks-state-'));
const {
  MAX_CHARS, MIN_SCORE, editPointers, formatPointers, globSpecificity, globToRegExp, hookOutput, loadSeen,
  promptPointers, runHook, saveSeen,
} = await import('../../xwiki/scripts/kb-hooks.mjs');
const { buildIndex, defaultRoot, loadIndex } = await import('../../xwiki/scripts/kb-search.mjs');
const { isScopedRemote } = await import('../../xwiki/scripts/repo-scope.mjs');

const script = join(dirname(fileURLToPath(import.meta.url)), '../../xwiki/scripts/kb-hooks.mjs');

function gitRepo(origin) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-hooks-repo-'));
  execFileSync('git', ['init', '-q', dir]);
  if (origin) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
  return dir;
}
const scoped = gitRepo('git@github.com:xwiki/xwiki-platform.git');
const personal = gitRepo('https://github.com/someone/dotfiles.git');
const notGit = mkdtempSync(join(tmpdir(), 'kb-hooks-plain-'));

// Payloads as documented: Claude Code's UserPromptSubmit / PreToolUse, and Kimi Code's
// UserPromptSubmit (camelCase fields converted to snake_case, no transcript_path).
const claudePrompt = (cwd, prompt, session = 'sess-1') => ({
  session_id: session,
  transcript_path: '/home/dev/.claude/projects/p/sess-1.jsonl',
  cwd,
  permission_mode: 'default',
  hook_event_name: 'UserPromptSubmit',
  prompt,
});
const kimiPrompt = (cwd, prompt) => ({ hook_event_name: 'UserPromptSubmit', session_id: 'kimi-1', cwd, prompt });
const claudeEdit = (cwd, filePath, newString, session = 'sess-1', toolName = 'Edit') => ({
  session_id: session,
  transcript_path: '/home/dev/.claude/projects/p/sess-1.jsonl',
  cwd,
  permission_mode: 'default',
  hook_event_name: 'PreToolUse',
  tool_name: toolName,
  tool_input: toolName === 'Write'
    ? { file_path: filePath, content: newString }
    : { file_path: filePath, old_string: 'x', new_string: newString, replace_all: false },
  tool_use_id: 'toolu_01',
});

function fixtureKb(files) {
  const root = mkdtempSync(join(tmpdir(), 'kb-hooks-kb-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const topic = (title, appliesTo, body, extra = '') =>
  `---\ntitle: ${title}\nstability: durable\napplies-to: [${appliesTo.map((g) => `"${g}"`).join(', ')}]\n${extra}---\n\n# ${title}\n\n${body}\n`;
const EDIT_KB = fixtureKb({
  'sonarqube/syntax-rules.md': topic('Syntax rules', ['**/*.java'], '## S1128 — unused import\n\nRemove it.'),
  'conventions/logging.md': topic('Logging', ['**/*.java'], '## Levels\n\nUse debug for internals.'),
  'architecture/component-system.md': topic('Component system', ['**/src/main/java/**/*.java'],
    '## Components\n\nUse @Component.\n\n## Mail components\n\nThe mail sender is a component.'),
  'conventions/script-services.md': topic('Script services', ['**/*ScriptService.java'], '## Naming\n\nEnd in ScriptService.'),
  'decisions/old-choice.md': topic('Old choice', ['**/*.java'], '## Decision\n\nObsolete.', 'status: superseded\n'),
  'conventions/frontend.md': topic('Front-end', ['**/*.js'], '## Bundling\n\nUse webjars.'),
});
const editIndex = buildIndex(EDIT_KB);

// ---------------------------------------------------------------------------------------------
// Scoping

test('scope: the two upstream orgs over SSH and HTTPS, plus XWIKI_LLM_ORGS, case-insensitively', () => {
  assert.ok(isScopedRemote('git@github.com:xwiki/xwiki-platform.git', {}));
  assert.ok(isScopedRemote('https://github.com/xwiki-contrib/application-forum.git', {}));
  assert.ok(isScopedRemote('https://github.com/XWiki/xwiki-commons', {}));
  assert.ok(!isScopedRemote('https://github.com/someone/xwiki-platform.git', {}));
  assert.ok(!isScopedRemote('https://github.com/xwikisas/application-x.git', {}));
  assert.ok(isScopedRemote('https://github.com/xwikisas/application-x.git', { XWIKI_LLM_ORGS: 'acme, xwikisas' }));
  assert.ok(isScopedRemote('https://github.com/a.b/x.git', { XWIKI_LLM_ORGS: 'a.b' }));
  assert.ok(!isScopedRemote('https://github.com/aXb/x.git', { XWIKI_LLM_ORGS: 'a.b' }));
});

test('scope: a personal repo or a non-git directory gets nothing, a scoped repo gets pointers', (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'kb-hooks-seen-'));
  const prompt = 'what @since version should I put on a new method?';
  for (const dir of [personal, notGit]) {
    assert.equal(runHook('prompt', claudePrompt(dir, prompt), { stateDir, env: {} }), '');
  }
  assert.match(runHook('prompt', claudePrompt(scoped, prompt), { stateDir, env: {} }), /conventions\/versioning\.md#/);
});

// ---------------------------------------------------------------------------------------------
// Prompt hook threshold — the probes MIN_SCORE was chosen from, run on the shipped KB.

// Prompts unrelated to XWiki development: the best section scores below MIN_SCORE.
const OFF_TOPIC = [
  "what's the weather",
  'write me a haiku about autumn leaves',
  'what time is it in Tokyo',
  'thanks that looks good now run it',
  'make this function faster',
];
// Questions the KB answers: the right file comes back above MIN_SCORE.
const ON_TOPIC = {
  'what @since version should I put on a new method?': 'conventions/versioning.md',
  'should I use javax or jakarta inject': 'conventions/code-style.md',
  'how do I add a translation key': 'conventions/translations.md',
  'how do I escape user input in velocity templates': 'conventions/security.md',
  'where do I put a data migration': 'architecture/data-migrations.md',
  'which JIRA component should the issue have': 'servers/jira.md',
  'the build fails with a license header error': 'conventions/code-style.md',
};
const realIndex = loadIndex(defaultRoot());

test('threshold: off-topic probes produce no pointer', () => {
  for (const prompt of OFF_TOPIC) assert.deepEqual(promptPointers(realIndex, prompt), [], prompt);
});

test('threshold: on-topic probes point at the right file, every pointer above MIN_SCORE', () => {
  for (const [prompt, file] of Object.entries(ON_TOPIC)) {
    const hits = promptPointers(realIndex, prompt);
    assert.equal(hits[0]?.file, file, prompt);
    assert.ok(hits.length <= 5 && hits.every((h) => h.score >= MIN_SCORE), prompt);
  }
});

test('threshold: a trivially short prompt is not searched at all', () => {
  for (const prompt of ['ok continue', 'yes do it', 'go', '/clear']) {
    assert.deepEqual(promptPointers(realIndex, prompt), [], prompt);
  }
});

// ---------------------------------------------------------------------------------------------
// Edit hook

test('edit: most specific glob first, ties broken by the score of the path words', () => {
  const ids = editPointers(editIndex, '/r/core/src/main/java/org/xwiki/mail/DefaultMailSender.java',
    { projectDir: '/r' }).map((h) => h.id);
  assert.deepEqual(ids, ['architecture/component-system.md#Mail components', 'conventions/logging.md#Levels']);
  const script = editPointers(editIndex, '/r/src/main/java/FooScriptService.java', { projectDir: '/r' });
  assert.equal(script[0].file, 'conventions/script-services.md');
  assert.ok(script.length <= 3);
});

test('edit: sonarqube files only when the path or the edit text mentions Sonar', () => {
  const path = 'src/main/java/org/xwiki/Foo.java';
  const files = (opts) => editPointers(editIndex, path, { k: 10, ...opts }).map((h) => h.file);
  assert.ok(!files({ editText: 'import java.util.List;' }).some((f) => f.startsWith('sonarqube/')));
  assert.ok(files({ editText: 'return x; // NOSONAR' }).includes('sonarqube/syntax-rules.md'));
  assert.ok(editPointers(editIndex, 'sonar/Foo.java', { k: 10 }).some((h) => h.file.startsWith('sonarqube/')));
});

test('edit: superseded entries and non-matching globs are never pointed at', () => {
  const files = editPointers(editIndex, 'Foo.java', { k: 10 }).map((h) => h.file);
  assert.ok(!files.includes('decisions/old-choice.md'));
  assert.ok(!files.includes('conventions/frontend.md'));
  assert.deepEqual(editPointers(editIndex, 'README.txt'), []);
});

test('edit: the hook on a real Write payload, in a scoped repo', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'kb-hooks-seen-'));
  const text = runHook('edit', claudeEdit(scoped, join(scoped, 'ui/src/main/webapp/app.js'), 'x', 's', 'Write'),
    { root: EDIT_KB, cacheDir: null, stateDir, env: {} });
  assert.match(text, /^XWiki KB pointers for ui\/src\/main\/webapp\/app\.js /);
  assert.match(text, /\n\[rule\] conventions\/frontend\.md#Bundling — Front-end: Use webjars\.$/);
});

test('globs: `**/` spans any depth, `*` stays within a segment', () => {
  assert.ok(globToRegExp('**/src/main/java/**/*.java').test('a/b/src/main/java/org/X.java'));
  assert.ok(globToRegExp('**/pom.xml').test('pom.xml'));
  assert.ok(!globToRegExp('**/*.java').test('X.javax'));
  assert.ok(!globToRegExp('src/*.java').test('src/a/X.java'));
  assert.ok(globSpecificity('**/*ScriptService.java') > globSpecificity('**/src/main/java/**/*.java'));
  assert.ok(globSpecificity('**/src/main/java/**/*.java') > globSpecificity('**/*.java'));
});

// ---------------------------------------------------------------------------------------------
// Dedupe

test('dedupe: a session gets each pointer once, another session gets it again', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'kb-hooks-seen-'));
  const prompt = 'should I use javax or jakarta inject';
  const opts = { stateDir, env: {} };
  const first = runHook('prompt', claudePrompt(scoped, prompt, 'a'), opts);
  assert.match(first, /code-style\.md#/);
  assert.equal(runHook('prompt', claudePrompt(scoped, prompt, 'a'), opts), '');
  assert.equal(runHook('prompt', claudePrompt(scoped, prompt, 'b'), opts), first);
  // The edit hook skips a file the session was already pointed at, whichever hook did it.
  const seen = loadSeen('a', stateDir);
  assert.ok([...seen].some((id) => id.startsWith('conventions/code-style.md#')));
});

test('dedupe: creating a session file prunes those untouched for a week', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'kb-hooks-seen-'));
  saveSeen('old', new Set(['x#y']), stateDir);
  const old = (Date.now() - 8 * 24 * 3600 * 1000) / 1000;
  utimesSync(join(stateDir, 'old.json'), old, old);
  saveSeen('recent', new Set(['x#y']), stateDir);
  saveSeen('new', new Set(['x#y']), stateDir);
  assert.deepEqual(readdirSync(stateDir).sort(), ['new.json', 'recent.json']);
  assert.deepEqual(loadSeen('../../etc/passwd', stateDir), new Set());
  saveSeen('../evil', new Set(['a#b']), stateDir);
  assert.ok(existsSync(join(stateDir, '___evil.json')));
});

// ---------------------------------------------------------------------------------------------
// Output

test('output: the block stays within ~300 tokens and names the KB root once', () => {
  const hit = (i) => ({ id: `f${i}.md#S`, section: 'S', title: 'T', first: 'x'.repeat(300), tag: '[rule]' });
  const { text, ids } = formatPointers([1, 2, 3, 4, 5, 6, 7].map(hit), '/kb');
  assert.ok(text.length <= MAX_CHARS && ids.length >= 3);
  assert.equal(text.split('/kb/').length, 2);
  assert.deepEqual(formatPointers([], '/kb'), { text: '', ids: [] });
});

test('output: JSON additionalContext for Claude Code, plain stdout for Kimi Code', () => {
  assert.deepEqual(JSON.parse(hookOutput('edit', 'ptr', { CLAUDE_PLUGIN_ROOT: '/p' })),
    { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'ptr' } });
  assert.equal(JSON.parse(hookOutput('prompt', 'ptr', {})).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(hookOutput('prompt', 'ptr', { KIMI_PLUGIN_ROOT: '/p' }), 'ptr');
  assert.equal(hookOutput('prompt', '', {}), '');
});

// ---------------------------------------------------------------------------------------------
// Never fail

const run = (args, input, env = {}) => spawnSync(process.execPath, [script, ...args],
  { input, encoding: 'utf8', env: { ...process.env, ...env } });

test('cli: a Claude Code prompt payload yields the JSON block, a Kimi one plain text', () => {
  const claude = run(['prompt'], JSON.stringify(claudePrompt(scoped, 'how do I add a translation key', 'cli-1')),
    { CLAUDE_PLUGIN_ROOT: '/p' });
  assert.equal(claude.status, 0);
  assert.match(JSON.parse(claude.stdout).hookSpecificOutput.additionalContext, /translations\.md#/);
  const kimi = run(['prompt'], JSON.stringify(kimiPrompt(scoped, 'how do I add a translation key')),
    { KIMI_PLUGIN_ROOT: '/p', CLAUDE_PLUGIN_ROOT: '' });
  assert.equal(kimi.status, 0);
  assert.match(kimi.stdout, /^XWiki KB pointers .*\n\[rule\] conventions\/translations\.md#/s);
});

test('cli: any error exits 0 and writes nothing', () => {
  for (const [args, input] of [
    [['prompt'], 'not json'],
    [['prompt'], ''],
    [['prompt'], 'null'],
    [['edit'], JSON.stringify({ cwd: scoped, tool_input: { file_path: 42 } })],
    [['bogus'], JSON.stringify(claudePrompt(scoped, 'how do I add a translation key'))],
    [[], JSON.stringify(claudePrompt(scoped, 'how do I add a translation key'))],
  ]) {
    const r = run(args, input);
    assert.equal(r.status, 0, `${args} ${input}`);
    assert.equal(r.stdout, '', `${args} ${input}`);
    assert.equal(r.stderr, '', `${args} ${input}`);
  }
  // An unwritable state directory costs the dedupe, not the prompt.
  const blocked = join(mkdtempSync(join(tmpdir(), 'kb-hooks-ro-')), 'file');
  writeFileSync(blocked, '');
  const r = run(['prompt'], JSON.stringify(claudePrompt(scoped, 'how do I add a translation key', 'ro')),
    { XDG_STATE_HOME: blocked });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /translations\.md#/);
});

// ---------------------------------------------------------------------------------------------
// opencode wrapper

test('opencode: 1.x appends prompt pointers as a synthetic part and edit pointers to the tool result', async () => {
  process.env.XWIKI_LLM_HOME = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const plugin = (await import('../../xwiki/opencode/plugins/xwiki-kb-pointers.js')).default;
  const hooks = await plugin.server({ directory: scoped });
  const output = { message: { id: 'msg_1' }, parts: [{ type: 'text', text: 'how do I add a translation key' }] };
  await hooks['chat.message']({ sessionID: 'oc-1' }, output);
  assert.equal(output.parts.length, 2);
  assert.ok(output.parts[1].synthetic && output.parts[1].messageID === 'msg_1');
  assert.match(output.parts[1].text, /translations\.md#/);
  const tool = { title: 'edit', output: 'Edit applied.', metadata: {} };
  await hooks['tool.execute.after'](
    { tool: 'edit', sessionID: 'oc-1', callID: 'c', args: { filePath: join(scoped, 'src/main/java/Foo.java') } }, tool);
  assert.match(tool.output, /^Edit applied\.\n\nXWiki KB pointers for src\/main\/java\/Foo\.java /);
  const off = await plugin.server({ directory: personal });
  const quiet = { message: { id: 'm' }, parts: [{ type: 'text', text: 'how do I add a translation key' }] };
  await off['chat.message']({ sessionID: 'oc-2' }, quiet);
  assert.equal(quiet.parts.length, 1);
});
