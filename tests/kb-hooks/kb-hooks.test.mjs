// The KB pointer hooks: scoping by git remote, the prompt hook's score threshold (with the probes that
// justify it, on the shipped KB), the edit hook's glob ranking, per-session dedupe,
// and the never-fail rule — fed the stdin payloads Claude Code and Kimi Code actually send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'kb-hooks-state-'));
const {
  MAX_CHARS, MIN_SCORE, addedText, editPointers, formatPointers, globSpecificity, globToRegExp, hookOutput, loadSeen,
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

// applies-when: topics that matter only when the edit adds a given kind of text. Block-list
// regexes, single-quoted, as a topic writes them; one does not compile and must be ignored.
const whenTopic = (title, appliesTo, when, body) => `---\ntitle: ${title}\nstability: durable\n`
  + (appliesTo ? `applies-to: [${appliesTo.map((g) => `"${g}"`).join(', ')}]\n` : '')
  + `applies-when:\n${when.map((w) => `  - '${w}'`).join('\n')}\n---\n\n# ${title}\n\n${body}\n`;
const WHEN_KB = fixtureKb({
  'conventions/dependencies.md': whenTopic('Dependencies', ['**/pom.xml'],
    ['<groupId>(?!org\\.xwiki\\b|\\$\\{)[^<]+</groupId>'], '## Third-party dependencies\n\nAsk first.'),
  'conventions/logging.md': whenTopic('Logging', ['**/*.java'],
    ['\\b(?:LOGGER|logger)\\.(?:trace|debug|info|warn|error)\\(', '\\bLoggerFactory\\.getLogger\\('],
    '## Levels\n\nUse debug for internals.'),
  'conventions/versioning.md': whenTopic('Versioning', null, ['@since\\s', '([unclosed'],
    '## Since\n\nUse the next version.'),
  'architecture/component-system.md': topic('Component system', ['**/*.java'], '## Components\n\nUse @Component.'),
});
const whenIndex = buildIndex(WHEN_KB);
const POM_DEPS = `    <dependency>
      <groupId>org.xwiki.commons</groupId>
      <artifactId>xwiki-commons-component-api</artifactId>
      <version>\${commons.version}</version>
    </dependency>`;
const pomEdit = (newDeps) => claudeEdit(scoped, join(scoped, 'xwiki-platform-core/xwiki-platform-mail/pom.xml'),
  newDeps).tool_input;
const pointedFiles = (input, path = input.file_path) =>
  editPointers(whenIndex, path, { projectDir: scoped, added: addedText(input) }).map((h) => h.file);

test('applies-when: a third-party dependency added to a pom points at the dependency rules', () => {
  const input = { ...pomEdit(`${POM_DEPS}
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </dependency>`), old_string: POM_DEPS };
  assert.deepEqual(pointedFiles(input), ['conventions/dependencies.md']);
});

test('applies-when: a version bump or an org.xwiki dependency in a pom points at nothing', () => {
  const bump = { ...pomEdit(POM_DEPS.replace('${commons.version}', '17.10.0')), old_string: POM_DEPS };
  assert.deepEqual(pointedFiles(bump), []);
  const xwikiDep = { ...pomEdit(`${POM_DEPS}
    <dependency>
      <groupId>org.xwiki.platform</groupId>
      <artifactId>xwiki-platform-oldcore</artifactId>
      <version>\${project.version}</version>
    </dependency>`), old_string: POM_DEPS };
  assert.deepEqual(pointedFiles(xwikiDep), []);
  const sameModule = { ...pomEdit('<groupId>${project.groupId}</groupId>'), old_string: '' };
  assert.deepEqual(pointedFiles(sameModule), []);
});

test('applies-when: logging added to Java ranks above the path-only topic; context lines do not count', () => {
  const path = join(scoped, 'core/src/main/java/org/xwiki/mail/internal/DefaultMailSender.java');
  const old = '    public void send(Mail mail)\n    {\n        this.queue.add(mail);';
  const logged = { file_path: path, old_string: old,
    new_string: `${old}\n        this.logger.debug("Queued mail [{}]", mail);`, replace_all: false };
  assert.deepEqual(pointedFiles(logged), ['conventions/logging.md', 'architecture/component-system.md']);
  // The logger call was already there: moving a line next to it adds no logging.
  const context = { file_path: path, old_string: `${old}\n        this.logger.debug("Queued");`,
    new_string: `    public void send(Mail mail)\n    {\n        this.logger.debug("Queued");\n        this.queue.add(mail);`,
    replace_all: false };
  assert.deepEqual(pointedFiles(context), ['architecture/component-system.md']);
});

test('applies-when: no applies-to means any path; an invalid regex is ignored, the valid one still matches', () => {
  const input = { file_path: join(scoped, 'ui/src/main/resources/Main/WebHome.xml'), old_string: 'x',
    new_string: ' * @since 18.0.0RC1' };
  assert.deepEqual(pointedFiles(input), ['conventions/versioning.md']);
  assert.deepEqual(pointedFiles({ ...input, new_string: 'no tag here' }), []);
});

test('applies-when: MultiEdit edits, Write against the file it replaces, unknown text', () => {
  const multi = { file_path: 'X.java', edits: [
    { old_string: 'a', new_string: 'b', replace_all: false },
    { old_string: 'c', new_string: 'c\n * @since 18.0.0', replace_all: false }] };
  assert.equal(addedText(multi), 'b\n * @since 18.0.0');
  const write = { file_path: 'X.java', content: 'class X\n{\n    /** @since 1.0 */\n}\n' };
  assert.equal(addedText(write, 'class X\n{\n    /** @since 1.0 */\n}\n'), '');
  assert.match(addedText(write, null), /@since/);
  assert.equal(addedText({ file_path: 'X.java' }), null);
  // Without the added text (an opencode edit with no args), a content-conditioned topic stays out.
  assert.deepEqual(editPointers(whenIndex, 'Foo.java', {}).map((h) => h.file), ['architecture/component-system.md']);
});

test('applies-when: the hook reads the file a Claude Code Write overwrites, so unchanged text is not added', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'kb-hooks-seen-'));
  const file = join(scoped, 'src/main/java/Old.java');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'class Old\n{\n    /** @since 1.0 */\n    void a() {}\n}\n');
  const opts = { root: WHEN_KB, cacheDir: null, stateDir, env: {} };
  const rewrite = (session, content) => runHook('edit', claudeEdit(scoped, file, content, session, 'Write'), opts);
  assert.doesNotMatch(rewrite('w1', 'class Old\n{\n    /** @since 1.0 */\n    void a() { b(); }\n}\n'),
    /versioning/);
  assert.match(rewrite('w2', 'class Old\n{\n    /** @since 1.0 */\n    void a() {}\n    /** @since 2.0 */\n}\n'),
    /versioning\.md#Since/);
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
    { tool: 'edit', sessionID: 'oc-1', callID: 'c', args: { filePath: join(scoped, 'src/main/java/FooScriptService.java') } }, tool);
  assert.match(tool.output, /^Edit applied\.\n\nXWiki KB pointers for src\/main\/java\/FooScriptService\.java /);
  const off = await plugin.server({ directory: personal });
  const quiet = { message: { id: 'm' }, parts: [{ type: 'text', text: 'how do I add a translation key' }] };
  await off['chat.message']({ sessionID: 'oc-2' }, quiet);
  assert.equal(quiet.parts.length, 1);
});

test('applies-when on the shipped KB: a content match points at the section its matched line names', () => {
  const at = (path, added) => editPointers(realIndex, path, { added }).map((h) => h.id);
  assert.deepEqual(at('core/pom.xml', '      <groupId>com.fasterxml.jackson.core</groupId>'),
    ['conventions/dependencies.md#Accepting a new third-party dependency']);
  assert.equal(at('core/src/main/java/org/xwiki/A.java', '@Unstable')[0], 'conventions/backward-compatibility.md#`@Unstable` annotation');
});

// ---------------------------------------------------------------------------------------------
// Skills as pointer targets

const { SKILL_K, namedSkills } = await import('../../xwiki/scripts/kb-hooks.mjs');
const { defaultSkillsRoot, readSkills, search } = await import('../../xwiki/scripts/kb-search.mjs');

const skill = (name, description) => [`${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`];
const SKILLS = fixtureKb(Object.fromEntries([
  skill('xwiki-legacy', 'Move a deprecated API into its legacy module. Use when retiring a deprecated method. For the build use xwiki-build.'),
  skill('xwiki-build', 'Build and test XWiki Maven modules with mvn.'),
  skill('xwiki-review', '"EXPLICIT INVOCATION ONLY. A deep review of a deprecated legacy change."'),
]));
const SKILL_KB = fixtureKb({
  'conventions/compat.md': topic('Backward compatibility', ['**/*.java'],
    '## Deprecation\n\nDeprecate first, then retire the deprecated method to the legacy module later.'),
  '_meta/skills.json': JSON.stringify({ 'xwiki-legacy': { 'applies-to': ['**/*.java'], 'applies-when': ['@Deprecated\\b'] } }),
});
const skillIndex = buildIndex(SKILL_KB, { skillsRoot: SKILLS });

test('skills: indexed by name and own description; sibling routing and explicit-only skills left out', () => {
  const byName = Object.fromEntries(readSkills(SKILLS).map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(byName), ['xwiki-build', 'xwiki-legacy']);
  assert.doesNotMatch(byName['xwiki-legacy'].text, /build/);
  assert.equal(byName['xwiki-legacy'].first, 'Move a deprecated API into its legacy module.');
  // Only asked-for searches return skills; a KB index built without them has none.
  assert.ok(search(skillIndex, 'retire deprecated legacy').every((h) => h.tag !== '[skill]'));
  const [hit] = search(skillIndex, 'retire deprecated legacy', { skills: true }).filter((h) => h.tag === '[skill]');
  assert.equal(hit.id, 'skill:xwiki-legacy');
  assert.equal(Object.keys(buildIndex(SKILL_KB).files).some((f) => f.startsWith('skill:')), false);
});

test('skills: a prompt\'s skill pointers lead, as a load instruction naming them, ahead of the KB block', () => {
  const hits = promptPointers(skillIndex, 'how do I retire a deprecated method to the legacy module', { minScore: 0 });
  assert.equal(hits[0].id, 'skill:xwiki-legacy');
  assert.ok(hits.some((h) => h.id === 'conventions/compat.md#Deprecation'));
  assert.ok(promptPointers(skillIndex, 'retire deprecated legacy module', { minScore: 0, k: 0 }).every((h) => h.tag === '[skill]'));
  // KB hits first in the input: the skills still come first in the text.
  const { text, ids } = formatPointers([...hits.filter((h) => h.tag !== '[skill]'), ...hits.filter((h) => h.tag === '[skill]')], 'KB');
  assert.match(text, /^Before going further, load with your Skill tool: xwiki-legacy, xwiki-build — their steps are not in these pointers/);
  assert.match(text, /\n\[skill\] xwiki-legacy — Move a deprecated API into its legacy module\.\n\[skill\] xwiki-build — .*\nXWiki KB pointers — /);
  assert.match(formatPointers(hits.filter((h) => h.id !== 'skill:xwiki-build'), 'KB').text, /^[^\n]*: xwiki-legacy — its steps /);
  assert.match(text, /\n\[\w+\] conventions\/compat\.md#Deprecation/);
  assert.deepEqual(new Set(ids), new Set(hits.map((h) => h.id)));
  const kbOnly = formatPointers(hits.filter((h) => h.tag !== '[skill]'), 'KB').text;
  assert.match(kbOnly, /^XWiki KB pointers — /);
  assert.doesNotMatch(kbOnly, /\[skill\]|Skill tool/);
  // Only skills: no KB header.
  assert.doesNotMatch(formatPointers(hits.filter((h) => h.tag === '[skill]'), 'KB').text, /XWiki KB pointers/);
});

test('skills: the edit hook matches a skill by applies-to and applies-when, apart from the KB slots', () => {
  const ids = (added) => editPointers(skillIndex, 'core/src/main/java/A.java', { added }).map((h) => h.id);
  assert.deepEqual(ids('    @Deprecated\n    void old();'), ['skill:xwiki-legacy', 'conventions/compat.md#Deprecation']);
  assert.deepEqual(ids('void neu();'), ['conventions/compat.md#Deprecation']);
  assert.equal(editPointers(skillIndex, 'core/src/main/java/A.java', { added: '@Deprecated', k: 0 }).length, 1);
  assert.ok(SKILL_K >= 1);
});

test('skills: a loaded skill (Skill tool, or named in the prompt) is not pointed at again', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'kb-hooks-seen-'));
  const opts = { root: SKILL_KB, skillsRoot: SKILLS, cacheDir: null, stateDir, env: {} };
  const load = { session_id: 's', cwd: scoped, hook_event_name: 'PreToolUse', tool_name: 'Skill',
    tool_input: { skill: 'xwiki:xwiki-legacy' } };
  assert.equal(runHook('skill', load, opts), '');
  assert.ok(loadSeen('s', stateDir).has('skill:xwiki-legacy'));
  const edit = claudeEdit(scoped, join(scoped, 'core/src/main/java/A.java'), '@Deprecated\nvoid old();', 's');
  assert.doesNotMatch(runHook('edit', edit, opts), /\[skill\]/);
  assert.deepEqual(namedSkills(skillIndex, '/xwiki:xwiki-legacy then xwiki-build, not xwiki-platform'),
    ['skill:xwiki-legacy', 'skill:xwiki-build']);
  runHook('prompt', claudePrompt(scoped, '/xwiki-build the core module please', 't'), opts);
  assert.ok(loadSeen('t', stateDir).has('skill:xwiki-build'));
});

const fullIndex = loadIndex(defaultRoot(), { skillsRoot: defaultSkillsRoot() });

test('skills on the shipped plugin: off-topic probes still get nothing; a task names its skill', () => {
  for (const prompt of OFF_TOPIC) assert.deepEqual(promptPointers(fullIndex, prompt), [], prompt);
  const ids = (p) => promptPointers(fullIndex, p).map((h) => h.id);
  assert.ok(ids('remove the deprecated method from the main module and move it to the legacy module')
    .includes('skill:xwiki-legacy'));
  assert.ok(ids('write javadoc for the new public interface').includes('skill:xwiki-javadoc'));
  const skills = Object.values(fullIndex.files).filter((f) => f.kind === 'skill');
  assert.ok(skills.length > 20 && !fullIndex.files['skill:xwiki-review'], 'explicit-only skills are left out');
});

test('skills on the shipped plugin: _meta/skills.json names real skills and its regexes compile', () => {
  const meta = JSON.parse(readFileSync(join(defaultRoot(), '_meta/skills.json'), 'utf8'));
  for (const [name, m] of Object.entries(meta)) {
    assert.ok(existsSync(join(defaultSkillsRoot(), name, 'SKILL.md')), name);
    for (const re of m['applies-when'] ?? []) assert.doesNotThrow(() => new RegExp(re, 'm'), re);
  }
  const at = (path, added) => editPointers(fullIndex, path, { added }).filter((h) => h.tag === '[skill]').map((h) => h.id);
  assert.ok(at('core/src/test/java/org/xwiki/ATest.java', '@Test void a() {}').includes('skill:xwiki-test-guidelines'));
  assert.deepEqual(at('core/src/main/resources/ApplicationResources.properties', 'core.a.label=A'),
    ['skill:xwiki-translations']);
});

test('opencode: a skill loaded through the skill tool is recorded for the session', async () => {
  process.env.XWIKI_LLM_HOME = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const plugin = (await import('../../xwiki/opencode/plugins/xwiki-kb-pointers.js')).default;
  const hooks = await plugin.server({ directory: scoped });
  await hooks['tool.execute.after']({ tool: 'skill', sessionID: 'oc-skill', callID: 'c', args: { name: 'xwiki-legacy' } },
    { title: 'skill', output: 'loaded', metadata: {} });
  assert.ok(loadSeen('oc-skill').has('skill:xwiki-legacy'));
});

// ---------------------------------------------------------------------------------------------
// Commits (shared with check-diff.mjs)

const { diffAdditions } = await import('../../xwiki/scripts/kb-hooks.mjs');
const { isGitCommit, takesUnstaged } = await import('../../xwiki/scripts/shell-commands.mjs');

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
function commitRepo() {
  const dir = gitRepo('git@github.com:xwiki/xwiki-platform.git');
  writeFileSync(join(dir, 'README'), 'x\n');
  git(dir, 'add', 'README');
  git(dir, 'commit', '-qm', 'init');
  mkdirSync(join(dir, 'core/src/main/java'), { recursive: true });
  writeFileSync(join(dir, 'core/src/main/java/A.java'), 'class A {\n    @Deprecated\n    void old() {}\n}\n');
  return dir;
}

test('commit: which shell commands commit, and which take unstaged changes', () => {
  for (const c of ['git commit -m x', 'cd core && git commit -F - <<EOF', 'git -C core commit --amend',
    'bash -c "git commit -m x"', 'git -c a=b commit']) assert.ok(isGitCommit(c), c);
  for (const c of ['git log --grep commit', 'git status', 'echo commit', 'gh pr create', 'git commit-tree x'])
    assert.ok(!isGitCommit(c), c);
  assert.ok(takesUnstaged('git commit -am x') && takesUnstaged('git add A.java && git commit -m x'));
  assert.ok(!takesUnstaged('git commit -m x') && !takesUnstaged('git commit --amend -m x'));
  assert.deepEqual([...diffAdditions('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n+c\n'
    + 'diff --git a/gone b/gone\n+++ /dev/null\n-z\n')], [['x', 'b\nc'], ['gone', '']]);
});

// ---------------------------------------------------------------------------------------------
// Shell edits: the edit pointers for the lines a Bash command added

const { shellChanges, shellWrites, writesNothing } = await import('../../xwiki/scripts/kb-hooks.mjs');

const postBash = (cwd, command, session = 'sh') => ({ session_id: session, cwd, hook_event_name: 'PostToolUse',
  tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: '', stderr: '' } });

test('shell edits: a clearly read-only command is skipped without running git', () => {
  for (const c of ['grep -rn "@Deprecated" core/src | head -20', 'git -C core log --oneline -3', 'cat A.java 2>/dev/null',
    "find . -name '*.java' | wc -l", 'sed -n 1,20p A.java', 'cd core && git status --short', 'ls > /dev/null 2>&1',
    'LC_ALL=C sort a.txt | uniq -c']) assert.ok(writesNothing(c), c);
  for (const c of ["sed -i 's/a/b/' A.java", "python3 - <<'EOF'\nopen('A.java', 'w').write('x')\nEOF",
    "cat > A.java <<'EOF'\nclass A {}\nEOF", 'echo x >> A.java', 'find . -name "*.orig" -delete',
    'git add -A && git commit -m x', 'perl -pi -e s/a/b/ A.java', "cat <<'EOF' | tee A.java\nx\nEOF", "echo 'x"])
    assert.ok(!writesNothing(c), c);
  // Only tracked files can change: the walk for new files is skipped.
  for (const c of ["sed -i 's/a/b/' A.java", "cd core && perl -pi -e 's/a/b/' A.java && git add -A && git commit -qm x",
    'find . -name "*.orig" -delete']) assert.equal(shellWrites(c), 'tracked', c);
  for (const c of ["sed 's/a/b/' A.java > B.java", 'perl gen.pl', 'git checkout other', "python3 - <<'EOF'\nx\nEOF"])
    assert.equal(shellWrites(c), 'any', c);
});

test('shell edits: points at what the command added, once, and sees through a commit', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'kb-hooks-seen-'));
  const root = fixtureKb({
    'conventions/compat.md': readFileSync(join(SKILL_KB, 'conventions/compat.md'), 'utf8'),
    'conventions/translations.md': topic('Translations', ['**/*.properties'], '## Keys\n\nPrefix each key.'),
    '_meta/skills.json': readFileSync(join(SKILL_KB, '_meta/skills.json'), 'utf8'),
  });
  const opts = { root, skillsRoot: SKILLS, cacheDir: null, stateDir, env: {} };
  const repo = commitRepo();
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'A');
  const java = join(repo, 'core/src/main/java/A.java');
  writeFileSync(java, 'class A {\n    @Deprecated\n    void old() {}\n    @Deprecated\n    void older() {}\n}\n');
  assert.equal(runHook('bash', postBash(repo, 'grep -n Deprecated core/src/main/java/A.java'), opts), '');
  const edit = "python3 - <<'EOF'\np = 'core/src/main/java/A.java'\nEOF";
  const text = runHook('bash', postBash(repo, edit), opts);
  assert.match(text, /^Before going further, load with your Skill tool: xwiki-legacy — /);
  assert.match(text, /\nXWiki KB pointers for core\/src\/main\/java\/A\.java — [^\n]*\n\[rule\] conventions\/compat\.md#Deprecation/);
  assert.match(hookOutput('bash', text), /"hookEventName":"PostToolUse"/);
  // Nothing new since the previous check: nothing.
  assert.equal(runHook('bash', postBash(repo, "sed -i 's/x/x/' README"), opts), '');
  // A command that edits and commits: the commit is seen through, only its new lines count.
  mkdirSync(join(repo, 'core/src/main/resources'), { recursive: true });
  writeFileSync(join(repo, 'core/src/main/resources/ApplicationResources.properties'), 'core.a.label=A\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'B');
  const both = runHook('bash', postBash(repo, "cat > core/src/main/resources/ApplicationResources.properties <<'EOF'\n"
    + "core.a.label=A\nEOF\ngit add -A && git commit -qm B"), opts);
  assert.match(both, /^XWiki KB pointers for core\/src\/main\/resources\/ApplicationResources\.properties [^\n]*\n\[rule\] conventions\/translations\.md#Keys/);
  assert.doesNotMatch(both, /xwiki-legacy|compat\.md/);
  // Outside a scoped repo, or without a session to keep a snapshot for, nothing.
  assert.equal(runHook('bash', postBash(personal, edit, 'p'), opts), '');
  assert.equal(runHook('bash', { ...postBash(repo, edit), session_id: undefined }, opts), '');
});

test('shell edits: a snapshot keeps line hashes, and a mass change points at nothing', () => {
  const repo = commitRepo();
  const first = shellChanges(repo, null);
  assert.deepEqual([...first.changes.keys()], [join(repo, 'core/src/main/java/A.java')].map((p) => realpathSync(p)));
  assert.ok(!JSON.stringify(first.snapshot).includes('Deprecated'));
  assert.equal(shellChanges(repo, first.snapshot).changes.size, 0);
  for (let i = 0; i < 201; i++) writeFileSync(join(repo, `f${i}.txt`), `line ${i}\n`);
  const mass = shellChanges(repo, first.snapshot);
  assert.equal(mass.changes.size, 0);
  // A branch switch is seen through: only the work tree against the new HEAD is kept.
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'many');
  const switched = shellChanges(repo, first.snapshot);
  assert.equal(switched.changes.size, 0);
  assert.deepEqual(switched.snapshot.files, {});
  assert.equal(shellChanges(notGit, null), null);
});

test('shell edits: a checkout, pull or reset is not an edit, and a commit after it is still seen through', () => {
  const repo = commitRepo();
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'A');
  git(repo, 'checkout', '-qb', 'other');
  writeFileSync(join(repo, 'core/src/main/java/B.java'), 'class B {}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'B');
  git(repo, 'checkout', '-q', '-');
  const before = shellChanges(repo, null).snapshot;
  // What the branch adds over master is not this session's edit.
  git(repo, 'checkout', '-q', 'other');
  const switched = shellChanges(repo, before);
  assert.equal(switched.changes.size, 0);
  git(repo, 'reset', '-q', '--hard', 'HEAD~1');
  assert.equal(shellChanges(repo, switched.snapshot).changes.size, 0);
  // An edit then a commit on the new branch: the commit is seen through.
  const now = shellChanges(repo, null).snapshot;
  writeFileSync(join(repo, 'core/src/main/java/C.java'), 'class C {}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'C');
  writeFileSync(join(repo, 'core/src/main/java/C.java'), 'class C {}\n// more\n');
  git(repo, 'commit', '-qam', 'C2', '--amend');
  assert.deepEqual([...shellChanges(repo, now).changes.keys()],
    [realpathSync(join(repo, 'core/src/main/java')) + '/C.java']);
});

test('opencode: a bash edit gets the shell-edit pointers appended', async () => {
  process.env.XWIKI_LLM_HOME = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const plugin = (await import('../../xwiki/opencode/plugins/xwiki-kb-pointers.js')).default;
  const repo = commitRepo();
  const hooks = await plugin.server({ directory: repo });
  const tool = { title: 'bash', output: '', metadata: {} };
  await hooks['tool.execute.after']({ tool: 'bash', sessionID: 'oc-shell', callID: 'c',
    args: { command: "cat > core/src/main/java/A.java <<'EOF'\n...\nEOF" } }, tool);
  assert.match(tool.output, /^\n\nBefore going further, load with your Skill tool: xwiki-legacy/);
});
