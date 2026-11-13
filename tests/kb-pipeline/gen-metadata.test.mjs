// The KB pipeline's metadata step: the model's answer mapped onto a topic, and frontmatter additions.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { addFrontmatter, toSidecar } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
const { bodyHash, parseFrontmatter } = await import('../../xwiki/scripts/kb-search.mjs');

const TOPIC = '---\ntitle: Logging\nsources:\n  - https://dev.xwiki.org/x\n---\n\n# Logging\n\n## Levels\n\nUse debug.\n';

test('addFrontmatter appends absent keys only, quoting globs, skipping empty values', () => {
  const out = addFrontmatter(TOPIC.replace('title: Logging', 'title: Logging\nprovenance: community'), {
    provenance: 'official',
    'last-confirmed': '2026-10-01',
    related: ['conventions/code-style.md'],
    'applies-to': ['**/*.java'],
    empty: [],
    missing: null,
  });
  const { data, body } = parseFrontmatter(out);
  assert.equal(data.provenance, 'community');
  assert.equal(data['last-confirmed'], '2026-10-01');
  assert.deepEqual(data.related, ['conventions/code-style.md']);
  assert.deepEqual(data['applies-to'], ['**/*.java']);
  assert.ok(!('empty' in data) && !('missing' in data));
  assert.match(out, /applies-to: \["\*\*\/\*\.java"\]\n---\n/);
  assert.equal(bodyHash(out), bodyHash(TOPIC));
  assert.equal(body, parseFrontmatter(TOPIC).body);
});

test('toSidecar keys sections by heading, keeps only known related paths, rejects a wrong count', () => {
  const topic = { rel: 'conventions/logging.md', text: TOPIC, headings: ['Levels'] };
  const answer = {
    file: { questions: ['how do I log', 'how do I log '], aliases: ['logger'] },
    sections: [{ heading: 'Levels', questions: ['which level'], aliases: [] }],
    related: ['conventions/code-style.md', 'nope.md', 'conventions/logging.md'],
    applies_to: ['**/*.java'],
  };
  const known = new Set(['conventions/code-style.md', 'conventions/logging.md']);
  const sidecar = toSidecar(topic, answer, known);
  assert.deepEqual(sidecar.file.questions, ['how do I log']);
  assert.deepEqual(sidecar.sections, { Levels: { questions: ['which level'], aliases: [] } });
  assert.deepEqual(sidecar.proposed, { related: ['conventions/code-style.md'], 'applies-to': ['**/*.java'] });
  assert.equal(sidecar.source_hash, bodyHash(TOPIC));
  assert.throws(() => toSidecar({ ...topic, headings: ['Levels', 'Other'] }, answer, known), /1 sections returned for 2/);
});
