// The KB search engine: parsing, tokenizing, ranking rules and the index cache, on a small real KB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'kb-state-'));
const {
  buildIndex, kbSearch, loadIndex, parseFrontmatter, promptToQuery, search, splitSections, tokenize,
  versionMatches,
} = await import('../../xwiki/scripts/kb-search.mjs');
const { kbIndexDir } = await import('../../xwiki/scripts/state-dir.mjs');

const script = join(dirname(fileURLToPath(import.meta.url)), '../../xwiki/scripts/kb-search.mjs');

const FILES = {
  'index.md': '# Map\n\n## Routing\n\nzebracorn routing table\n',
  'glossary.md': '# Glossary\n\n- rights, permissions, ACL, access rights\n',
  'decisions/_template.md': '---\ntitle: <title>\nstatus: accepted  # proposed | accepted\n---\n\n## Context\n\nzebracorn\n',
  'conventions/versioning.md': `---
title: Versions in code
stability: durable
summary: Use the next release for @since, written X.Y.0RC1. The current version is
  read from pom.xml.
sources:
  - https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/
related: [architecture/rights, decisions/binary-compat.md]
questions:
  - which version goes in a since tag
custom-key: kept
---

# Versions in code

Intro paragraph about versions.

## The @since format

Write \`@since 18.5.0RC1\` on every new public API.

\`\`\`java
## not a heading
\`\`\`

## Deprecation

Use @Deprecated(since = "…") and explain why in the Javadoc.

## Checking a branch version

Read the pom.xml of the branch on origin.
`,
  'architecture/rights.md': `---
title: Required rights
stability: durable
summary: How access is checked.
aliases: [RightService]
---

# Required rights

## Checking access

Call the ContextualAuthorizationManager to check that the current user has the rights.
`,
  'decisions/binary-compat.md': `---
title: Check binary but not source compatibility
status: accepted
summary: Revapi checks binary compatibility only.
---

# Check binary but not source compatibility

## Decision

Revapi breaks the build on a binary incompatibility.
`,
  'decisions/new-idea.md': `---
title: Adopt a flux capacitor
status: proposed
summary: A flux capacitor for every module.
---

## Decision

Every module gets a flux capacitor.
`,
  'servers/ci.md': `---
title: CI agents
stability: volatile
summary: The agents running the flux build.
versions: ">=17.4 <18.0"
---

## Agents

The flux build runs on agent-1.
`,
};

function kb(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kb-'));
  for (const [rel, content] of Object.entries({ ...FILES, ...extra })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const ids = (hits) => hits.map((h) => h.id);

test('frontmatter: scalars, folded lines, lists, inline lists, comments and unknown keys', () => {
  const { data, body } = parseFrontmatter(FILES['conventions/versioning.md']);
  assert.equal(data.title, 'Versions in code');
  assert.equal(data.summary, 'Use the next release for @since, written X.Y.0RC1. The current version is read from pom.xml.');
  assert.deepEqual(data.sources, ['https://dev.xwiki.org/xwiki/bin/view/Community/VersioningAndReleasePractices/']);
  assert.deepEqual(data.related, ['architecture/rights', 'decisions/binary-compat.md']);
  assert.deepEqual(data.questions, ['which version goes in a since tag']);
  assert.equal(data['custom-key'], 'kept');
  assert.ok(body.startsWith('\n# Versions in code'));
  assert.equal(parseFrontmatter(FILES['decisions/_template.md']).data.status, 'accepted');
  assert.equal(parseFrontmatter(FILES['servers/ci.md']).data.versions, '>=17.4 <18.0');
});

test('sections: one per ##, fenced ## ignored, the intro headed by the file title', () => {
  const { body } = parseFrontmatter(FILES['conventions/versioning.md']);
  const sections = splitSections(body, 'Versions in code');
  assert.deepEqual(sections.map((s) => s.heading),
    ['Versions in code', 'The @since format', 'Deprecation', 'Checking a branch version']);
  assert.match(sections[1].text, /## not a heading/);
  assert.deepEqual(splitSections('# Only a title\n\n## A\n\ntext\n', 'T').map((s) => s.heading), ['A']);
});

test('tokenizer: identifiers split and kept whole, stopwords dropped, plurals folded', () => {
  assert.deepEqual(tokenize('ScriptService'), ['scriptservice', 'script', 'service']);
  assert.deepEqual(tokenize('xwiki-platform'), ['xwikiplatform', 'xwiki', 'platform']);
  assert.deepEqual(tokenize('How do the permissions of classes apply to policies?'),
    ['permission', 'class', 'apply', 'policy']);
  assert.deepEqual(tokenize('status bus analysis'), ['status', 'bus', 'analysis']);
});

test('corpus: the root index, the glossary and templates are not searchable', () => {
  const index = buildIndex(kb());
  assert.deepEqual(Object.keys(index.files).sort(), ['architecture/rights.md', 'conventions/versioning.md',
    'decisions/binary-compat.md', 'decisions/new-idea.md', 'servers/ci.md']);
  assert.deepEqual(search(index, 'zebracorn'), []);
});

test('a hit is a pointer: id, title, first line, tag and one-hop related files', () => {
  const [hit] = search(buildIndex(kb()), 'since format');
  assert.equal(hit.id, 'conventions/versioning.md#The @since format');
  assert.equal(hit.title, 'Versions in code');
  assert.equal(hit.first, 'Write @since 18.5.0RC1 on every new public API.');
  assert.equal(hit.tag, '[rule]');
  assert.deepEqual(hit.related, [
    { file: 'architecture/rights.md', title: 'Required rights' },
    { file: 'decisions/binary-compat.md', title: 'Check binary but not source compatibility' },
  ]);
});

test('questions and aliases make a section findable by words absent from its text', () => {
  assert.equal(search(buildIndex(kb()), 'RightService')[0].file, 'architecture/rights.md');
  assert.equal(search(buildIndex(kb()), 'which tag')[0].file, 'conventions/versioning.md');
});

test('glossary: a synonym group member expands the query to the others', () => {
  const hits = search(buildIndex(kb()), 'permissions');
  assert.equal(hits[0].id, 'architecture/rights.md#Checking access');
  assert.deepEqual(search(buildIndex(kb({ 'glossary.md': '' })), 'permissions'), []);
});

test('tags: accepted ADR, proposed ADR, volatile', () => {
  const index = buildIndex(kb());
  assert.equal(search(index, 'revapi')[0].tag, '[ADR]');
  const flux = Object.fromEntries(search(index, 'flux').map((h) => [h.file, h.tag]));
  assert.deepEqual(flux, { 'decisions/new-idea.md': '[proposed: under discussion]', 'servers/ci.md': '[volatile]' });
});

test('versions filter out, never down-rank', () => {
  const index = buildIndex(kb());
  assert.deepEqual(search(index, 'agent', { version: '17.10.2' }).map((h) => h.file), ['servers/ci.md']);
  assert.deepEqual(search(index, 'agent', { version: '18.5.0-SNAPSHOT' }), []);
  assert.equal(versionMatches('>=17.4', '17.4.0RC1'), true);
  assert.equal(versionMatches('<17.4', '17.4'), false);
  assert.equal(versionMatches(null, '1.0'), true);
});

test('at most two sections per file, k caps the results', () => {
  const index = buildIndex(kb());
  const hits = search(index, 'version since deprecated pom branch', { k: 10 });
  assert.equal(hits.filter((h) => h.file === 'conventions/versioning.md').length, 2);
  assert.equal(search(index, 'version since deprecated pom branch flux', { k: 1 }).length, 1);
});

test('age breaks near-ties only: the newer last-confirmed wins among equal scores', () => {
  const page = (date) => `---\ntitle: Quokka\nlast-confirmed: ${date}\n---\n\n## Quokka care\n\nFeed the quokka.\n`;
  const index = buildIndex(kb({ 'a-old.md': page('2015-01-01'), 'b-new.md': page('2026-01-01') }));
  assert.deepEqual(search(index, 'quokka').map((h) => h.file), ['b-new.md', 'a-old.md']);
});

test('the index is cached under kbIndexDir() and rebuilt when the KB changes', () => {
  const root = kb();
  assert.equal(kbSearch('quokka', { root }).length, 0);
  assert.ok(readdirSync(kbIndexDir()).length > 0);
  writeFileSync(join(root, 'quokka.md'), '## Quokka\n\nA quokka.\n');
  assert.equal(kbSearch('quokka', { root })[0].file, 'quokka.md');
});

test('an unwritable cache directory is ignored', () => {
  const blocker = join(mkdtempSync(join(tmpdir(), 'kb-block-')), 'file');
  writeFileSync(blocker, '');
  const index = loadIndex(kb(), { cacheDir: join(blocker, 'sub') });
  assert.ok(index.sections.length > 0);
  assert.equal(existsSync(join(blocker, 'sub')), false);
});

test('promptToQuery drops fenced code and URLs, keeps inline code, caps the length', () => {
  const q = promptToQuery('Fix `ScriptService` per https://jira.xwiki.org/browse/XWIKI-1\n```java\nsecretCode();\n```\nplease');
  assert.equal(q, 'Fix ScriptService per please');
  assert.ok(promptToQuery('word '.repeat(500)).length <= 500);
});

test('CLI: one line per hit plus related pointers, or JSON', () => {
  const root = kb();
  const text = execFileSync('node', [script, 'since', 'format', '--k', '1', '--root', root], { encoding: 'utf8' });
  assert.equal(text, '[rule] conventions/versioning.md#The @since format — Versions in code: '
    + 'Write @since 18.5.0RC1 on every new public API.\n'
    + '  related: architecture/rights.md (Required rights); '
    + 'decisions/binary-compat.md (Check binary but not source compatibility)\n');
  const json = JSON.parse(execFileSync('node', [script, '--json', '--root', root, 'revapi'], { encoding: 'utf8' }));
  assert.deepEqual(ids(json), ['decisions/binary-compat.md#Decision']);
});
