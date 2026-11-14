// The benchmark's two-version comparison, on the scores and records of a real KB batch (Docker test
// framework facts, 3 runs per side, Opus judge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairedDiff, passK, questionScores, report, runMetrics, spread } from '../../eval/tools/analyze.mjs';

// Group (e) scores per question over 3 runs: master (base) and the branch adding the facts (head).
const E = {
  e02: [[2, 1, 2], [3, 3, 3]], e03: [[2, 2, 3], [2, 2, 3]], e05: [[1, 1, 1], [3, 3, 3]], e06: [[2, 2, 2], [2, 2, 2]],
  e08: [[2, 3, 1], [3, 3, 2]], e09: [[2, 3, 2], [3, 3, 3]], e11: [[3, 3, 2], [3, 3, 3]],
};
const eQuestions = Object.keys(E).map((id) => ({ id, group: 'e', gold: { source: 'https://dev.xwiki.org/…@81.1' } }));
const runsOf = (side) => [0, 1, 2].map((run) => Object.fromEntries(Object.entries(E).map(([id, s]) =>
  [id, { id, cost_usd: 0.2, tokens: { input: 1000 }, grade: { score: s[side][run], harmful: false } }])));

test('the paired difference averages each question\'s runs and bootstraps a reproducible 95% CI', () => {
  const base = questionScores(eQuestions, runsOf(0));
  const head = questionScores(eQuestions, runsOf(1));
  const d = pairedDiff(base, head);
  assert.equal(d.mean.toFixed(3), '0.714');
  assert.equal(d.lo.toFixed(3), '0.238');
  assert.equal(d.hi.toFixed(3), '1.238');
  assert.deepEqual(pairedDiff(base, head), d);
  assert.deepEqual([passK(base), passK(head)], [0, 4]);
});

test('a missing grade counts neither in the question mean nor towards pass^k', () => {
  const runs = runsOf(1);
  delete runs[2].e02.grade;
  const scores = questionScores(eQuestions, runs);
  assert.deepEqual(scores[0], [3, 3, null]);
  assert.equal(passK(scores), 3);
  assert.equal(pairedDiff([[2, 1, 2]], [scores[0]]).mean.toFixed(3), '1.333');
});

// Real group (a) and (d) records: a26 on master (hook pointed at the gold, file not read) and on the
// branch (file read, full score); d01 given five pointers to sections that cannot answer it.
const a26q = { id: 'a26', group: 'a', gold: { file: 'conventions/frontend.md', section: 'HTML, CSS, accessibility' } };
const a26master = { cost_usd: 0.0817, tokens: { input: 30724 }, okf_touches: [], hook_pointers: ['conventions/frontend.md#HTML, CSS, accessibility'], edit_pointers: [], grade: { score: 1, harmful: false } };
const a26branch = { cost_usd: 0.0353, tokens: { input: 95790 }, okf_touches: [{ tool: 'Read', target: 'kb/conventions/frontend.md' }], hook_pointers: ['conventions/frontend.md#HTML, CSS, accessibility'], edit_pointers: [], grade: { score: 3, harmful: false } };
const d01q = { id: 'd01', group: 'd' };
const d01 = { cost_usd: 0.0927, tokens: { input: 30967 }, okf_touches: [], edit_pointers: [], hook_pointers: [
  'servers/index.md#Accessing / writing to the XWiki-run sites via REST', 'conventions/logging.md#Decision table',
  'servers/jira.md#Bulk edits', 'servers/jira.md#Wiki-markup gotchas (descriptions and comments)',
  'testing/strategy.md#URLs and runtime configuration in functional tests'] };

test('a graded run reports the score and the gold reach; a (d) run the noise it was given', () => {
  const a = Object.fromEntries(runMetrics([{ q: a26q, r: a26branch }], true).map(([n, v]) => [n, v]));
  assert.equal(a['score (0–3)'], 3);
  assert.equal(a['gold file read'], 1);
  assert.equal(a['gold section in pointers'], 1);
  const d = Object.fromEntries(runMetrics([{ q: d01q, r: d01 }], false).map(([n, v]) => [n, v]));
  assert.equal(d['sessions given any pointer'], 1);
  assert.equal(d['pointers / session'], 5);
  assert.equal(d['score (0–3)'], undefined);
  assert.equal(spread([0.175, 0.175], 0, true), '18% [18%–18%]');
});

test('the report flags missing records and, without a head, marks the questions passing the gate', () => {
  const lines = report([a26q, d01q], [{ name: 'base', runs: [
    { label: 'm-r1', recs: { a26: a26master, d01 } }, { label: 'm-r2', recs: { a26: a26branch } }] }]).join('\n');
  assert.match(lines, /\| a26 \| 1,3 \| {2}\|/);
  assert.match(lines, /Missing: m-r2\/d01$/);
  const both = report([a26q], [{ name: 'master', runs: [{ label: 'm', recs: { a26: a26master } }] },
    { name: 'branch', runs: [{ label: 'b', recs: { a26: a26branch } }] }]).join('\n');
  assert.match(both, /Paired difference branch − master, score: 2\.000/);
  assert.match(both, /\| a26 \| 1 \| 3 \|/);
});
