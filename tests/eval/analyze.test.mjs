// The benchmark's two-version comparison, on the scores and records of a real KB batch (Docker test
// framework facts, 3 runs per side, Opus judge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commonQuestions, gate, loadRun, missingItems, pairedDiff, passK, questionScores, report, runMetrics, spread } from '../../eval/tools/analyze.mjs';

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
  assert.equal(pairedDiff([[2, 1, 2]], [scores[0]], { resamples: 100 }).mean.toFixed(3), '1.333');
});

test('a question graded on one side only, or on neither, stays out of the paired difference', () => {
  const base = [[2, 1, 2], [null, null, null], [3, 3, 3]];
  const head = [[3, 3, 3], [3, 3, 3], [null, null, null]];
  assert.deepEqual(commonQuestions(base, head), [0]);
  assert.throws(() => pairedDiff(base, head), /graded on both sides/);
  assert.throws(() => pairedDiff([[1]], [[2]], { resamples: 10 }), /resamples/);
  assert.equal(passK(head), 2);
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
  const a = Object.fromEntries(runMetrics([a26q], { a26: a26branch }, true).map(([n, v]) => [n, v]));
  assert.equal(a['score (0–3)'], 3);
  assert.equal(a['gold file read'], 1);
  assert.equal(a['gold section in pointers'], 1);
  const d = Object.fromEntries(runMetrics([d01q], { d01 }, false).map(([n, v]) => [n, v]));
  assert.equal(d['sessions given any pointer'], 1);
  assert.equal(d['pointers / session'], 5);
  assert.equal(d['score (0–3)'], undefined);
  assert.equal(spread([0.175, 0.175], 0, true), '18% [18%–18%]');
});

test('a run with nothing graded has the same rows as the others, each shown as -', () => {
  const ungraded = { a26: { ...a26master, grade: undefined } };
  const rows = runMetrics([a26q], ungraded, true);
  assert.deepEqual(rows.map(([n]) => n), runMetrics([a26q], { a26: a26master }, true).map(([n]) => n));
  assert.ok(rows.every(([, v]) => v === null));
  assert.equal(spread([null, null]), '-');
  assert.equal(spread([null, 2]), '2.00 [2.00–2.00]');
});

test('a missing run directory is reported, not read as a run scoring 0', () => {
  const out = mkdtempSync(join(tmpdir(), 'eval-analyze-'));
  mkdirSync(join(out, 'runs', 'm-r1'), { recursive: true });
  writeFileSync(join(out, 'runs', 'm-r1', 'a26.json'), JSON.stringify(a26master));
  assert.equal(loadRun({ out }, 'm-r2'), null);
  const sides = [{ name: 'base', runs: [{ label: 'm-r1', recs: loadRun({ out }, 'm-r1') }, { label: 'm-r2', recs: null }] }];
  assert.deepEqual(missingItems([a26q, d01q], sides), ['m-r1/d01', 'm-r2 (no run directory)']);
  assert.match(report([a26q], sides).join('\n'), /\| score \(0–3\) \| 1\.00 \[1\.00–1\.00\] \|/);
});

test('the report flags missing records and, without a head, marks the questions passing the gate', () => {
  const lines = report([a26q, d01q], [{ name: 'base', runs: [
    { label: 'm-r1', recs: { a26: a26master, d01 } }, { label: 'm-r2', recs: { a26: a26branch } }] }]).join('\n');
  assert.match(lines, /\| a26 \| 1,3 \| {2}\|/);
  const both = report([a26q], [{ name: 'master', runs: [{ label: 'm', recs: { a26: a26master } }] },
    { name: 'branch', runs: [{ label: 'b', recs: { a26: a26branch } }] }]).join('\n');
  assert.match(both, /Paired difference branch − master, score: 2\.000/);
  assert.match(both, /\| a26 \| 1 \| 3 \|/);
});

// The gate on batch 1: (e) gained, (a) unchanged with one harmful answer per run, (d) given fewer pointers.
const side = (name, runs) => ({ name, runs: runs.map((recs, i) => ({ label: `${name}-r${i + 1}`, recs })) });
const dRuns = (n) => [0, 1, 2].map(() => ({ d01: { ...d01, hook_pointers: d01.hook_pointers.slice(0, n) } }));
const aRuns = (score, harmful) => [0, 1, 2].map(() => ({ a26: { ...a26master, grade: { score, harmful } } }));
const merge = (...sets) => sets[0].map((_, i) => Object.assign({}, ...sets.map((s) => s[i])));

test('the batch gate passes batch 1: (e) CI above 0, (a) and harmful flat, (d) pointers not above the base maximum', () => {
  const rows = gate([...eQuestions, a26q, d01q], [
    side('master', merge(runsOf(0), aRuns(2, true), dRuns(5))), side('branch', merge(runsOf(1), aRuns(2, true), dRuns(4)))]);
  assert.deepEqual(rows.map((r) => r.pass), [true, true, true, true, true, true, true, true]);
  assert.match(rows[0].value, /0\.714 \(CI 0\.238 to 1\.238\)/);
  assert.match(rows.at(-1).value, /4\.00 vs base max 5\.00/);
});

test('the batch gate fails on an (e) CI reaching 0, an (a) loss, more harmful answers or more (d) pointers', () => {
  const [base, head] = [side('master', merge(runsOf(1), aRuns(3, false), dRuns(4))), side('branch', merge(runsOf(1), aRuns(1, true), dRuns(5)))];
  const rows = gate([...eQuestions, a26q, d01q], [base, head]);
  assert.deepEqual(rows.map((r) => [r.condition.slice(0, 3), r.pass]),
    [['(e)', false], ['(e)', true], ['(a)', false], ['(a)', false], ['(e)', true], ['(a)', true], ['(d)', true], ['(d)', false]]);
  assert.deepEqual(gate([eQuestions[0]].map((q) => ({ ...q, group: 'b' })), [base, head]), []);
});

test('the batch gate fails a group whose records name two models; a record without model_id is not counted', () => {
  const withModel = (runs, id) => runs.map((recs) => Object.fromEntries(Object.entries(recs).map(([k, r]) => [k, { ...r, model_id: id }])));
  const base = side('master', withModel(runsOf(0), 'claude-opus-5-5'));
  const one = (rows) => rows.find((r) => r.condition === '(e) one model on both sides');
  assert.equal(one(gate(eQuestions, [base, side('branch', withModel(runsOf(1), 'claude-opus-5-5'))])).pass, true);
  assert.equal(one(gate(eQuestions, [base, side('branch', runsOf(1))])).pass, true);
  const mixed = one(gate(eQuestions, [base, side('branch', withModel(runsOf(1), 'claude-sonnet-5-5'))]));
  assert.deepEqual([mixed.pass, mixed.value], [false, 'claude-opus-5-5, claude-sonnet-5-5']);
});

test('the report sums the judge\'s recorded cost apart from the sessions\'', () => {
  const recs = { a26: { ...a26branch, grade: { ...a26branch.grade, cost_usd: 0.25 } } };
  assert.match(report([a26q], [{ name: 'base', runs: [{ label: 'm', recs }] }]).join('\n'), /Session cost: \$0\.04\. Judge cost: \$0\.25/);
});
