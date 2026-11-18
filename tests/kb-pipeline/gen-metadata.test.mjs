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

test('a regenerated sidecar keeps unchanged sections and the file part while title and summary are unchanged', async () => {
  const { hashes, mergeSidecar, reusable } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
  const { splitSections: split } = await import('../../xwiki/scripts/kb-search.mjs');
  const topicOf = (text, summary = 'About logs.') => {
    const sections = split(parseFrontmatter(text).body, 'Logging');
    return { rel: 'conventions/logging.md', text, title: 'Logging', summary, sections, headings: sections.map((s) => s.heading) };
  };
  const v1 = topicOf(`${TOPIC}\n## Format\n\nOne line.\n`);
  const old = { file: { questions: ['old file q'], aliases: [] },
    sections: { Levels: { questions: ['old levels q'], aliases: [] }, Format: { questions: ['old format q'], aliases: [] } },
    proposed: { related: [], 'applies-to': [] }, source_hash: bodyHash(v1.text), ...hashes(v1) };
  // Nothing changed that the model would write: complete, no model call needed.
  assert.equal(reusable(v1, old).complete, true);
  // Format's text changes: Levels and the file part are kept, Format takes the fresh answer.
  const v2 = topicOf(`${TOPIC}\n## Format\n\nTwo lines.\n`);
  const fresh = { file: { questions: ['new file q'], aliases: [] },
    sections: { Levels: { questions: ['new levels q'], aliases: [] }, Format: { questions: ['new format q'], aliases: [] } },
    proposed: { related: [], 'applies-to': [] }, source_hash: 'x' };
  const merged = mergeSidecar(v2, fresh, old);
  assert.equal(reusable(v2, old).complete, false);
  assert.deepEqual(merged.file.questions, ['old file q']);
  assert.deepEqual(merged.sections.Levels.questions, ['old levels q']);
  assert.deepEqual(merged.sections.Format.questions, ['new format q']);
  assert.equal(merged.source_hash, bodyHash(v2.text));
  assert.deepEqual(merged.section_hashes, hashes(v2).section_hashes);
  // A new summary renews the file part; a sidecar without hashes keeps nothing.
  assert.deepEqual(mergeSidecar(topicOf(v1.text, 'About logging.'), fresh, old).file.questions, ['new file q']);
  const { section_hashes: _s, file_hash: _f, ...unhashed } = old;
  assert.deepEqual(mergeSidecar(v1, fresh, unhashed).sections.Levels.questions, ['new levels q']);
});

test('previousOf hands the model the old metadata of the changed parts only', async () => {
  const { hashes, previousOf, prompt } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
  const { splitSections: split } = await import('../../xwiki/scripts/kb-search.mjs');
  const topicOf = (text) => {
    const sections = split(parseFrontmatter(text).body, 'Logging');
    return { rel: 'conventions/logging.md', text, title: 'Logging', summary: '', sections, headings: sections.map((s) => s.heading) };
  };
  const v1 = topicOf(`${TOPIC}\n## Format\n\nOne line.\n`);
  const old = { file: { questions: ['file q'], aliases: [] },
    sections: { Levels: { questions: ['levels q'], aliases: [] }, Format: { questions: ['format q'], aliases: ['fmt'] } },
    ...hashes(v1) };
  const v2 = topicOf(`${TOPIC}\n## Format\n\nTwo lines.\n`);
  const previous = previousOf(v2, old);
  assert.deepEqual(previous, { file: null, sections: { Format: { questions: ['format q'], aliases: ['fmt'] } }, gone: {} });
  const text = prompt(v2, [v2], previous);
  assert.match(text, /section "Format": questions \["format q"\], aliases \["fmt"\]/);
  assert.match(text, /Only when the new text answers something none of them covers/);
  assert.doesNotMatch(text, /levels q|file q|no longer exist/);
  assert.doesNotMatch(prompt(v1, [v1], previousOf(v1, old)), /had metadata before|no longer exist/);
  // A renamed heading: its old questions go to the model as a former section, not lost.
  const v3 = topicOf(`${TOPIC}\n## Layout\n\nOne line.\n`);
  const renamed = previousOf(v3, old);
  assert.deepEqual(renamed.gone, { Format: { questions: ['format q'], aliases: ['fmt'] } });
  assert.match(prompt(v3, [v3], renamed), /no longer exist[\s\S]*former section "Format": questions \["format q"\]/);
});

test('rankDrops reports a previous question its part no longer ranks for, not one it still does', async (t) => {
  const { hashes, rankDrops } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
  const { splitSections: split } = await import('../../xwiki/scripts/kb-search.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'rank-drops-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'conventions'));
  const text = '---\ntitle: Logging\n---\n\n# Logging\n\n## Levels\n\nUse info.\n\n## Format\n\nOne line.\n';
  writeFileSync(join(root, 'conventions', 'logging.md'), text);
  const sections = split(parseFrontmatter(text).body, 'Logging');
  const topic = { rel: 'conventions/logging.md', text, title: 'Logging', summary: '', sections, headings: sections.map((s) => s.heading) };
  const sidecar = (format) => ({ file: { questions: [], aliases: [] },
    sections: { Levels: { questions: ['which severity'], aliases: [] }, Format: { questions: format, aliases: [] } },
    source_hash: bodyHash(text), ...hashes(topic) });
  const previous = { file: null, sections: { Format: { questions: ['zebra crossing', 'kept wording'], aliases: [] } } };
  assert.deepEqual(rankDrops(root, topic, sidecar(['kept wording']), previous),
    [{ part: 'Format', question: 'zebra crossing', before: 1, after: null, kept: false }]);
  assert.deepEqual(rankDrops(root, topic, sidecar(['zebra crossing', 'kept wording']), previous), []);
  // A gone heading's question: reported only when no section of the file ranks for it.
  const gone = { file: null, sections: {}, gone: { Old: { questions: ['zebra crossing'], aliases: [] } } };
  assert.deepEqual(rankDrops(root, topic, sidecar(['kept wording']), gone),
    [{ part: 'Old', question: 'zebra crossing', before: 'heading gone', after: null, kept: false }]);
  assert.deepEqual(rankDrops(root, topic, sidecar(['zebra crossing']), gone), []);
});
