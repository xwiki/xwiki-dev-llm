// The benchmark's two-version comparison, on the scores and records of a real KB batch (Docker test
// framework facts, 3 runs per side, Opus judge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isGraded } from '../../eval/tools/common.mjs';
import { changedTarget, commonQuestions, gate, loadRun, missingItems, pairedDiff, passK, questionScores, report, runMetrics, sawBatch, spread, tolerance } from '../../eval/tools/analyze.mjs';

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
    side('master', merge(runsOf(0), aRuns(2, true), dRuns(5))), side('branch', merge(runsOf(1), aRuns(2, true), dRuns(4)))],
    { changed: ['xwiki/kb/conventions/frontend.md'] });
  assert.deepEqual(rows.map((r) => r.pass), [true, true, true, true, true, true, true, true]);
  assert.match(rows[0].value, /0\.714 \(CI 0\.238 to 1\.238\)/);
  assert.match(rows.at(-1).value, /4\.00 vs base max 5\.00/);
});

test('the batch gate fails on an (e) CI reaching 0, an (a) loss, a new harmful answer it caused or more (d) pointers', () => {
  const [base, head] = [side('master', merge(runsOf(1), aRuns(3, false), dRuns(4))), side('branch', merge(runsOf(1), aRuns(1, true), dRuns(5)))];
  const rows = gate([...eQuestions, a26q, d01q], [base, head], { changed: ['xwiki/kb/conventions/frontend.md'] });
  assert.deepEqual(rows.map((r) => [r.condition.slice(0, 3), r.pass]),
    [['(e)', false], ['(e)', true], ['(a)', false], ['(a)', false], ['(e)', true], ['(a)', true], ['(d)', true], ['(d)', false]]);
  assert.deepEqual(gate([eQuestions[0]].map((q) => ({ ...q, group: 'b' })), [base, head]), []);
});

// Batch 2, group (a): harmful on master a02,a28 / a02,a13 / a28; on the branch a02,a10 / a02,a28 / a12,a28.
// a02 and a28 stay at 2 even counting every session; a10 and a12 are new, from sessions that never saw the batch.
const batch2Changed = ['xwiki/kb/_meta/testing/strategy.json', 'xwiki/kb/_meta/testing/unit-test-framework.json',
  'xwiki/kb/index.md', 'xwiki/kb/testing/strategy.md', 'xwiki/kb/testing/unit-test-framework.md'];
const readNew = [{ tool: 'Read', target: 'kb/testing/strategy.md' }];
const hIds = ['a02', 'a10', 'a12', 'a13', 'a28'];
const hRuns = (...runs) => runs.map((ids) => Object.fromEntries(hIds.map((id) =>
  [id, { ...a26master, grade: { score: 1, harmful: ids.includes(id) } }])));
const hQs = hIds.map((id) => ({ ...a26q, id }));
const hBase = side('master', hRuns(['a02', 'a28'], ['a02', 'a13'], ['a28']));
const harmfulRow = (rows) => rows.find((r) => r.condition.includes('harmful more often'));
const hRow = (headRuns) => harmfulRow(gate(hQs, [hBase, side('branch', headRuns)], { changed: batch2Changed }));

test('the batch gate passes batch 2: no question is harmful more often, counting only sessions that saw the batch', () => {
  const runs = hRuns(['a02', 'a10'], ['a02', 'a28'], ['a12', 'a28']);
  for (const r of runs) for (const id of ['a02', 'a28']) r[id] = { ...r[id], okf_touches: readNew };
  const row = hRow(runs);
  assert.deepEqual([row.pass, row.value], [true, 'none (6 of 15 head sessions saw the batch; harmful from sessions that did not: '
    + 'branch-r1/a10, branch-r3/a12; harmful per run: base 2,2,1, head 2,2,2)']);
});

test('the batch gate fails a question harmful more often, from sessions that saw the batch, than on master plus 1', () => {
  // a13: harmful 1 of 3 on master, 3 of 3 on the branch from sessions that read the new text.
  const runs = hRuns(['a13'], ['a13'], ['a13']);
  for (const r of runs) r.a13 = { ...r.a13, okf_touches: readNew };
  const row = hRow(runs);
  assert.deepEqual([row.pass, row.value.split(' (')[0], row.confirm], [false, 'branch-r1/a13, branch-r2/a13, branch-r3/a13', ['a13']]);
  assert.match(row.value, /to confirm: a13\)$/);
  // Two of them from sessions that saw the batch: within master's one plus 1.
  runs[2].a13 = { ...runs[2].a13, okf_touches: [] };
  assert.deepEqual([hRow(runs).pass, hRow(runs).confirm], [true, undefined]);
  // Group (e): e02, never harmful on master, harmful once on the branch is within the tolerance, twice is not.
  const head = runsOf(1);
  const eRow = () => harmfulRow(gate(eQuestions, [side('master', runsOf(0)), side('branch', head)], { changed: batch2Changed }));
  head[0].e02 = { ...head[0].e02, okf_touches: readNew, grade: { score: 1, harmful: true } };
  assert.equal(eRow().pass, true);
  head[1].e02 = { ...head[0].e02 };
  assert.deepEqual([eRow().pass, eRow().confirm], [false, ['e02']]);
});

test('the harmful tolerance is 1 per 3 base runs, never below 1', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9].map(tolerance), [1, 1, 1, 1, 2, 3]);
});

// Three confirmation runs per side, with records for a13 only.
const confirmRuns = (name, harmfulRuns, seenRuns = harmfulRuns) => side(name, [0, 1, 2].map((i) =>
  ({ a13: { ...a26master, okf_touches: seenRuns.includes(i) ? readNew : [], grade: { score: 1, harmful: harmfulRuns.includes(i) } } })));

test('confirmation runs pool with the first ones: six runs per side, tolerance 2', () => {
  const runs = hRuns(['a13'], ['a13'], ['a13']);
  for (const r of runs) r.a13 = { ...r.a13, okf_touches: readNew };
  const confirmed = (base, head, headSeen = head) => harmfulRow(gate(hQs, [hBase, side('branch', runs)],
    { changed: batch2Changed, confirm: { base: confirmRuns('cmaster', base), head: confirmRuns('cbranch', head, headSeen) } }));
  // 3 + 1 seen harmful against 1 + 0 on master: 4 > 1 + 2.
  const row = confirmed([], [0]);
  assert.deepEqual([row.pass, row.confirm], [false, undefined]);
  assert.equal(row.value.split(' (')[0], 'branch-r1/a13, branch-r2/a13, branch-r3/a13, cbranch-r1/a13');
  // 3 + 0 against 1 + 0: 3 ≤ 3, the first runs were noise.
  const cleared = confirmed([], []);
  assert.equal(cleared.pass, true);
  assert.match(cleared.value, /^none \(.*cleared by the confirmation runs: a13\)$/);
  // Harmful confirmation answers from sessions that did not see the batch do not count.
  assert.equal(confirmed([], [0, 1, 2], []).pass, true);
});

test('confirmation runs count only for the questions confirmed, the model check included', () => {
  const runs = hRuns(['a13'], ['a13'], ['a13']);
  for (const r of runs) r.a13 = { ...r.a13, okf_touches: readNew };
  const head = confirmRuns('cbranch', []);
  // a02 is not to confirm: its harmful answers and its other model in the confirmation runs are ignored.
  for (const r of head.runs) r.recs.a02 = { ...a26master, okf_touches: readNew, model_id: 'other', grade: { score: 0, harmful: true } };
  const rows = gate(hQs, [hBase, side('branch', runs)], { changed: batch2Changed, confirm: { base: confirmRuns('cmaster', []), head } });
  assert.deepEqual(rows.map((r) => r.pass), [true, true, true]);
  head.runs[0].recs.a13 = { ...head.runs[0].recs.a13, model_id: 'other' };
  const base = confirmRuns('cmaster', []);
  base.runs[0].recs.a13 = { ...base.runs[0].recs.a13, model_id: 'claude-sonnet-5-5' };
  const model = gate(hQs, [hBase, side('branch', runs)], { changed: batch2Changed, confirm: { base, head } })
    .find((r) => r.condition === '(a) one model on both sides');
  assert.deepEqual([model.pass, model.value], [false, 'claude-sonnet-5-5, other']);
});

// Real tool inputs: b1-e-code-r1/e05 grepped the KB folder, b1-e-code-r2/e05 grepped from inside it;
// neither left an okf_touches entry, which only keeps `.md` paths.
const grepFolder = 'Grep {"pattern":"(?i)debug|suspend|breakpoint","path":"/Users/x/OKF-2.0/xwiki/kb/testing","output_mode":"content"}';
const grepInKb = 'Bash {"command":"cd /Users/x/OKF-2.0/xwiki/kb && grep -rn -i \\"debug\\\\|5005\\" testing/ | head -50"}';
const saw = (rec, changed, base) => sawBatch({ okf_touches: [], hook_pointers: [], edit_pointers: [], ...rec },
  new Set(changed.map(changedTarget)), base);

test('a session saw the batch when it read, grepped, searched or was pointed at what the batch changed', () => {
  const topic = ['xwiki/kb/testing/strategy.md'];
  assert.equal(saw({}, topic), false);
  assert.equal(saw({ okf_touches: readNew }, topic), true);
  assert.equal(saw({ tool_inputs: [grepFolder] }, topic), true);
  assert.equal(saw({ tool_inputs: [grepInKb] }, topic), true);
  assert.equal(saw({ tool_inputs: ['Grep {"path":"/Users/x/OKF-2.0/xwiki/kb/conventions"}'] }, topic), false);
  assert.equal(saw({ tool_inputs: ['Read {"file_path":"/Users/x/OKF-2.0/xwiki/kb/testing/strategy-old.md"}'] }, topic), false);
  assert.equal(saw({ tool_inputs: ['Bash {"command":"node /p/xwiki/scripts/kb-search.mjs \\"mock a component\\""}'] }, topic), true);
  assert.equal(saw({ hook_pointers: ['testing/strategy.md#Mocking'] }, topic), true);
  assert.equal(saw({ edit_pointers: [{ subject: 'Foo.java', ids: ['testing/strategy.md#Mocking'] }] }, topic), true);
  assert.equal(saw({ edit_pointers: ['testing/strategy.md#Mocking'] }, topic), true);
  const skill = ['xwiki/skills/xwiki-build/SKILL.md'];
  assert.equal(saw({ okf_touches: [{ tool: 'Skill', target: 'xwiki:xwiki-build' }] }, skill), true);
  assert.equal(saw({ hook_pointers: ['skill:xwiki-build'] }, skill), true);
  assert.equal(saw({ hook_pointers: ['skill:xwiki-jira'] }, skill), false);
  // A file feeding every session or every search: every session saw it.
  assert.equal(saw({}, ['xwiki/kb/glossary.md']), true);
  assert.equal(saw({}, ['xwiki/scripts/kb-hooks.mjs']), true);
  // Prompt-hook pointers are the same on every run of a side: different ones mean the batch moved the ranking.
  const base = [{ hook_pointers: ['conventions/logging.md#A', 'servers/jira.md#B'] }];
  assert.equal(saw({ hook_pointers: ['servers/jira.md#B', 'conventions/logging.md#A'] }, topic, base), false);
  assert.equal(saw({ hook_pointers: ['servers/jira.md#B'] }, topic, base), true);
});

test('a changed path maps to the KB topic or skill a session can see, to every session, or to nothing', () => {
  assert.deepEqual(['xwiki/kb/testing/strategy.md', 'xwiki\\kb\\testing\\strategy.md', './xwiki/kb/testing/strategy.md',
    '/Users/x/xwiki-dev-llm/wt/xwiki/kb/_meta/testing/strategy.json', 'C:\\work\\xwiki\\kb\\testing\\strategy.md',
    'xwiki/skills/xwiki-build/references/maven.md', 'xwiki/kb/glossary.md', 'xwiki/kb/_meta/skills.json',
    'xwiki/instructions/xwiki-org.md', 'xwiki/hooks/hooks.json', 'eval/README.md', 'scripts/validate.mjs',
    '/Users/x/xwiki-dev-llm/README.md'].map(changedTarget),
  ['kb/testing/strategy.md', 'kb/testing/strategy.md', 'kb/testing/strategy.md', 'kb/testing/strategy.md',
    'kb/testing/strategy.md', 'skill:xwiki-build', '*', '*', '*', '*', null, null, null]);
});

test('--gate exits 2 on a missing, empty or plugin-less --changed', () => {
  const cli = (...extra) => spawnSync(process.execPath, [fileURLToPath(new URL('../../eval/tools/analyze.mjs', import.meta.url)),
    '--base', 'm', '--head', 'b', '--questions', 'a', '--out', tmpdir(), '--gate', ...extra], { encoding: 'utf8' });
  for (const r of [cli(), cli('--changed', ''), cli('--changed', 'eval/README.md,scripts/validate.mjs')]) {
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--changed/);
  }
  assert.match(cli('--changed', 'eval/README.md').stderr, /outside the plugin, ignored: eval\/README\.md/);
});

test('--gate exits 3 with the questions to confirm, then reads the confirmation runs\' verdict', () => {
  const out = mkdtempSync(join(tmpdir(), 'eval-confirm-'));
  const qFile = join(out, 'q.json');
  writeFileSync(qFile, JSON.stringify([{ ...a26q, id: 'a13' }, { ...a26q, id: 'a02' }]));
  const write = (label, recs) => {
    mkdirSync(join(out, 'runs', label), { recursive: true });
    for (const [id, rec] of Object.entries(recs)) writeFileSync(join(out, 'runs', label, `${id}.json`), JSON.stringify(rec));
  };
  const rec = (harmful, seen) => ({ ...a26master, model_id: 'claude-opus-5-5', okf_touches: seen ? readNew : [], grade: { score: 1, harmful } });
  ['m1', 'm2', 'm3'].forEach((l) => write(l, { a13: rec(false), a02: rec(false) }));
  // a13: never harmful on master, twice on the branch from sessions that read the new text.
  ['b1', 'b2'].forEach((l) => write(l, { a13: rec(true, true), a02: rec(false) }));
  write('b3', { a13: rec(false), a02: rec(false) });
  ['cm1', 'cm2', 'cm3'].forEach((l) => write(l, { a13: rec(false) }));
  ['cb1', 'cb2'].forEach((l) => write(l, { a13: rec(false) }));
  const cli = (...extra) => spawnSync(process.execPath, [fileURLToPath(new URL('../../eval/tools/analyze.mjs', import.meta.url)),
    '--base', 'm1,m2,m3', '--head', 'b1,b2,b3', '--questions', qFile, '--out', out, '--gate',
    '--changed', 'xwiki/kb/testing/strategy.md', ...extra], { encoding: 'utf8' });
  const first = cli();
  assert.equal(first.status, 3, first.stderr);
  assert.match(first.stdout, /Gate: CONFIRM a13$/m);
  const confirm = ['--confirm-base', 'cm1,cm2,cm3', '--confirm-head', 'cb1,cb2,cb3'];
  const gap = cli(...confirm);
  assert.equal(gap.status, 2);
  assert.match(gap.stderr, /cb3 \(no run directory\)/);
  write('cb3', { a13: rec(false) });
  const cleared = cli(...confirm); // 2 of 6 against 0 of 6: within the tolerance of 2
  assert.equal(cleared.status, 0, cleared.stdout);
  assert.match(cleared.stdout, /Confirmation cost: session \$0\.49, judge \$0\.00\./);
  write('cb3', { a13: { ...rec(false), model_id: 'claude-sonnet-5-5' } });
  assert.equal(cli(...confirm).status, 1); // a confirmation run on another model
  write('cb3', { a13: rec(true, true) });
  assert.equal(cli(...confirm).status, 1); // 3 of 6
  assert.equal(cli('--confirm-base', 'cm1').status, 2);
  assert.equal(cli('--confirm-base', 'cm1,cm2', '--confirm-head', 'cb1,cb2').status, 2);
  assert.equal(cli('--confirm-base', 'cm1,cm2,cm3', '--confirm-head', 'cb1,cb2').status, 2);
  // A harmful question over the tolerance with another failing condition: no confirmation, exit 1.
  ['x1', 'x2', 'x3'].forEach((l) => write(l, { a13: { ...rec(false), grade: { score: 3, harmful: false } }, a02: { ...rec(false), grade: { score: 3, harmful: false } } }));
  const both = spawnSync(process.execPath, [fileURLToPath(new URL('../../eval/tools/analyze.mjs', import.meta.url)),
    '--base', 'x1,x2,x3', '--head', 'b1,b2,b3', '--questions', qFile, '--out', out, '--gate',
    '--changed', 'xwiki/kb/testing/strategy.md'], { encoding: 'utf8' });
  assert.equal(both.status, 1, both.stdout);
  assert.match(both.stdout, /Gate: FAIL$/m);
});

test('a grade without a score, left by a failed judge call, counts as ungraded', () => {
  const sides = [{ name: 'm', runs: [{ label: 'm-r1', recs: { a26: { ...a26master, grade: { cost_usd: 0 } } } }] }];
  assert.deepEqual(missingItems([a26q], sides), ['m-r1/a26 (ungraded)']);
  assert.deepEqual([isGraded({ grade: { cost_usd: 0 } }), isGraded({ grade: { score: 0 } }), isGraded(undefined)], [false, true, false]);
});

test('the batch gate fails a group whose records name two models; a record without model_id is not counted', () => {
  const withModel = (runs, id) => runs.map((recs) => Object.fromEntries(Object.entries(recs).map(([k, r]) => [k, { ...r, model_id: id }])));
  const base = side('master', withModel(runsOf(0), 'claude-opus-5-5'));
  const one = (rows) => rows.find((r) => r.condition === '(e) one model on both sides');
  assert.equal(one(gate(eQuestions, [base, side('branch', withModel(runsOf(1), 'claude-opus-5-5'))], { changed: [] })).pass, true);
  assert.equal(one(gate(eQuestions, [base, side('branch', runsOf(1))], { changed: [] })).pass, true);
  const mixed = one(gate(eQuestions, [base, side('branch', withModel(runsOf(1), 'claude-sonnet-5-5'))], { changed: [] }));
  assert.deepEqual([mixed.pass, mixed.value], [false, 'claude-opus-5-5, claude-sonnet-5-5']);
});

test('the report sums the judge\'s recorded cost apart from the sessions\'', () => {
  const recs = { a26: { ...a26branch, grade: { ...a26branch.grade, cost_usd: 0.25 } } };
  assert.match(report([a26q], [{ name: 'base', runs: [{ label: 'm', recs }] }]).join('\n'), /Session cost: \$0\.04\. Judge cost: \$0\.25/);
});
