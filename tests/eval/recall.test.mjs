// The benchmark's retrieval recall scoring, with the plugin's real kb-search on a small KB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'eval-state-'));
const { buildIndex, search } = await import('../../xwiki/scripts/kb-search.mjs');
const { scoreRecall } = await import('../../eval/tools/recall.mjs');

const FILES = {
  'conventions/page-deletion.md': `# Deleting a page

## Procedure

The Backlinks list misses absolute URLs and macro parameters: search the whole farm for the page name
before deleting it, then repoint or remove each hit.

## Redirects

Leave a redirect when an external site links to the page.
`,
  'conventions/versioning.md': `# Versions in code

## The @since format

Use the next release, written X.Y.0RC1, read from the root pom.
`,
};

function kb() {
  const root = mkdtempSync(join(tmpdir(), 'eval-kb-'));
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return buildIndex(root);
}

const q = (id, question, file, section) => ({ id, question, gold: { file, section } });

test('recall counts a hit at file and section level, and lists a miss with its top hits', () => {
  const scored = scoreRecall([
    q('a01', 'Before deleting a page, is the backlinks list enough or do absolute URLs escape it?',
      'conventions/page-deletion.md', 'Procedure'),
    q('a02', 'Which version goes in a since tag, the next release candidate from the root pom?',
      'conventions/versioning.md', 'The @since format'),
    q('a03', 'zebracorn quux', 'conventions/page-deletion.md', 'No such section'),
  ], kb(), search);

  assert.equal(scored.n, 3);
  assert.deepEqual(scored.perQuestion.slice(0, 2).map((p) => [p.fileRank, p.sectionRank]), [[1, 1], [1, 1]]);
  assert.deepEqual(scored.recall.section, { '@1': 0.667, '@3': 0.667, '@5': 0.667 });
  assert.equal(scored.misses.length, 1);
  assert.equal(scored.misses[0].id, 'a03');
  assert.equal(scored.misses[0].goldIndexed, false, 'a gold section missing from the KB is flagged, not just missed');
});

test('the shipped group (a) questions all name a gold file and section', async () => {
  const { loadQuestions } = await import('../../eval/tools/common.mjs');
  const a = loadQuestions('a');
  assert.equal(a.length, 40);
  for (const x of a) assert.ok(x.gold.file && x.gold.section, x.id);
});
