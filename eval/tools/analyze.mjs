// Compares two plugin versions over repeated runs: each side is a list of run labels (one label per run).
// Usage: node analyze.mjs --base <label,...> [--head <label,...>] --questions a,d[,<file>] [--out <dir>]
//          [--allow-missing | --gate]
// Prints, per question group, the mean [min–max] over the runs of each metric, pass^k (k = that side's
// run count), and for graded groups the paired head − base score difference with its 95% bootstrap CI and
// the questions whose mean score moved by ≥ 1. Without --head it prints the base alone, with each
// question's scores (the baseline gate: a question scoring 3 in every run is marked).
// A missing run directory, record or grade makes the comparison refuse to print, unless --allow-missing:
// then the paired difference uses only the questions graded at least once on both sides.
// --gate (with --head) also checks the KB batch gate of eval/README.md on the groups present (see gate()),
// prints PASS or FAIL per condition and exits 0 when all pass, 1 otherwise, 2 when a record is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuestions, parseArgs, runDir } from './common.mjs';

/** The mean, or null for no values (never 0: an absent score is not a zero). */
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** `mean [min–max]` of one value per run; runs whose value is null are left out, `-` when none is left. */
export function spread(values, digits = 2, pct = false) {
  const xs = values.filter((x) => x !== null);
  const f = (x) => (pct ? `${Math.round(x * 100)}%` : x.toFixed(digits));
  return xs.length ? `${f(mean(xs))} [${f(Math.min(...xs))}–${f(Math.max(...xs))}]` : '-';
}

const ptrs = (r) => r.hook_pointers || [];
const skillLines = (r) => ptrs(r).filter((p) => p.startsWith('skill:')).length;
const readFile = (r, file) => (r.okf_touches || []).some((t) => t.target.endsWith(file));

/**
 * The metrics of one run of a group: [name, value, digits, pct]. The rows depend only on the questions
 * (so every run of a group has the same rows); a value is null when the run has no record to count.
 * A graded group counts only graded records, group (d) every record. `recs` = the run's records by id.
 */
export function runMetrics(questions, recs, graded) {
  const xs = questions.map((q) => ({ q, r: recs[q.id] })).filter((x) => x.r && (!graded || x.r.grade));
  const per = (f) => mean(xs.map((x) => f(x.r, x.q)));
  const share = (f) => per((r, q) => (f(r, q) ? 1 : 0));
  const count = (f) => (xs.length ? xs.filter((x) => f(x.r)).length : null);
  const withGold = (f) => mean(xs.filter((x) => x.q.gold?.file).map((x) => (f(x.r, x.q) ? 1 : 0)));
  return [
    ...(graded ? [
      ['score (0–3)', per((r) => r.grade.score), 2],
      ['full (3s)', count((r) => r.grade.score === 3), 1],
      ['harmful per run', count((r) => r.grade.harmful), 1],
    ] : [
      ['sessions given any pointer', share((r) => ptrs(r).length), 0, true],
      ['touched the KB or a skill', share((r) => (r.okf_touches || []).length), 0, true],
    ]),
    ...(graded && questions.some((q) => q.gold?.file) ? [
      ['gold file read', withGold((r, q) => readFile(r, q.gold.file)), 0, true],
      ['gold section in pointers', withGold((r, q) => ptrs(r).some((p) => p.startsWith(`${q.gold.file}#${q.gold.section}`))), 0, true],
      ['gold file in pointers', withGold((r, q) => ptrs(r).some((p) => p.startsWith(`${q.gold.file}#`))), 0, true],
    ] : []),
    ['pointers / session', per((r) => ptrs(r).length), 2],
    ['skill lines / session', per(skillLines), 2],
    ['sessions with a skill line', share(skillLines), 0, true],
    ['edit-hook injections / session', per((r) => (r.edit_pointers || []).length), 2],
    ['in-tokens / question', per((r) => r.tokens?.input || 0), 0],
    ['cost / question ($)', per((r) => r.cost_usd || 0), 3],
  ];
}

/** Per question, its score in each run (null when that run has no grade for it). */
export function questionScores(questions, runs) {
  return questions.map((q) => runs.map((recs) => recs[q.id]?.grade?.score ?? null));
}

/** pass^k: the questions scoring 3 in every one of the k runs (a missing score is not a 3). */
export function passK(scores) {
  return scores.filter((s) => s.length && s.every((x) => x === 3)).length;
}

/** Indices of the questions graded in at least one run on both sides: the only ones a paired difference may use. */
export function commonQuestions(baseScores, headScores) {
  const graded = (s) => s.some((x) => x !== null);
  return baseScores.map((_, i) => i).filter((i) => graded(baseScores[i]) && graded(headScores[i]));
}

/** mulberry32: a 32-bit PRNG in [0, 1), exact in JavaScript numbers, so a fixed seed reproduces a CI. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The paired difference of two sides' per-question mean scores (each question's runs averaged), with a
 * 95% bootstrap CI: `resamples` resamples of the questions, a fixed seed so a rerun prints the same CI.
 * Every question passed must be graded at least once on both sides (see commonQuestions).
 */
export function pairedDiff(baseScores, headScores, { resamples = 10000, seed = 12345 } = {}) {
  if (!Number.isInteger(resamples) || resamples < 40) throw new Error(`resamples must be an integer ≥ 40, got ${resamples}`);
  const qmean = (s) => mean(s.filter((x) => x !== null));
  if (!headScores.length || headScores.some((h, i) => qmean(h) === null || qmean(baseScores[i]) === null)) {
    throw new Error('every question must be graded on both sides');
  }
  const diffs = headScores.map((h, i) => qmean(h) - qmean(baseScores[i]));
  const rnd = mulberry32(seed);
  const boots = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)];
    boots.push(s / diffs.length);
  }
  boots.sort((a, b) => a - b);
  const at = (q) => boots[Math.min(resamples - 1, Math.floor(q * resamples))];
  return { diffs, mean: mean(diffs), lo: at(0.025), hi: at(0.975) };
}

/** A label's records by question id, from the run directory `run.mjs` and `judge.mjs` write; null when it does not exist. */
export function loadRun(args, label) {
  const dir = runDir(args, label);
  if (!fs.existsSync(dir)) return null;
  const recs = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json') && !f.startsWith('_')) recs[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return recs;
}

/** What is absent: run directories (recs null), records, grades (outside group d). */
export function missingItems(questions, sides) {
  const out = [];
  for (const side of sides) {
    for (const { label, recs } of side.runs) {
      if (!recs) { out.push(`${label} (no run directory)`); continue; }
      for (const q of questions) {
        if (!recs[q.id]) out.push(`${label}/${q.id}`);
        else if (q.group !== 'd' && !recs[q.id].grade) out.push(`${label}/${q.id} (ungraded)`);
      }
    }
  }
  return out;
}

/** Per run, the count of answers judged harmful (graded records only). */
const harmfulPerRun = (qs, runs) => runs.map((recs) => qs.filter((q) => recs[q.id]?.grade?.harmful).length);

/**
 * The KB batch gate (eval/README.md, "KB batches") on the groups of `questions` it covers, head against
 * base: (e) the paired difference's CI lies above 0; (a) its CI does not lie entirely below 0; (e) and (a)
 * harmful answers per run do not grow (means over the runs); (d) pointers per session do not exceed the
 * base runs' maximum (fewer is better: they are noise there). Returns [{ condition, value, pass }]; a
 * group absent from `questions` adds no condition. `sides` as in report(), every record present.
 */
export function gate(questions, [base, head], opts) {
  const rows = [];
  const of = (g) => questions.filter((q) => q.group === g);
  for (const g of ['e', 'a']) {
    const qs = of(g);
    if (!qs.length) continue;
    const d = pairedDiff(questionScores(qs, base.runs.map((r) => r.recs)), questionScores(qs, head.runs.map((r) => r.recs)), opts);
    const ci = `${d.mean.toFixed(3)} (CI ${d.lo.toFixed(3)} to ${d.hi.toFixed(3)})`;
    rows.push(g === 'e'
      ? { condition: '(e) score difference: CI above 0', value: ci, pass: d.lo > 0 }
      : { condition: '(a) score difference: CI not entirely below 0', value: ci, pass: d.hi >= 0 });
    const [hb, hh] = [base, head].map((side) => mean(harmfulPerRun(qs, side.runs.map((r) => r.recs))));
    rows.push({ condition: `(${g}) harmful per run does not grow`, value: `${hb.toFixed(2)} -> ${hh.toFixed(2)}`, pass: hh <= hb });
  }
  const ds = of('d');
  if (ds.length) {
    const per = (recs) => mean(ds.map((q) => ptrs(recs[q.id]).length));
    const [pb, ph] = [base, head].map((side) => side.runs.map((r) => per(r.recs)));
    rows.push({ condition: '(d) pointers per session within the base maximum',
      value: `${mean(ph).toFixed(2)} vs base max ${Math.max(...pb).toFixed(2)}`, pass: mean(ph) <= Math.max(...pb) });
  }
  return rows;
}

/** The whole report, as Markdown lines. `sides` = [{ name, runs: [{ label, recs }] }] (recs null for a missing run). */
export function report(questions, sides) {
  const out = [];
  const P = (s) => out.push(s);
  sides = sides.map((s) => ({ ...s, runs: s.runs.map((r) => ({ ...r, recs: r.recs || {} })) }));
  const sum = (f) => sides.flatMap((s) => s.runs).reduce((t, { recs }) => t + questions.reduce((c, q) => c + (recs[q.id] ? f(recs[q.id]) || 0 : 0), 0), 0);
  const cost = sum((r) => r.cost_usd);
  const judgeCost = sum((r) => r.grade?.cost_usd);
  const ks = sides.map((s) => s.runs.length);
  const head = `| metric | ${sides.map((s, i) => `${s.name} (${ks[i]} run${ks[i] > 1 ? 's' : ''})`).join(' | ')} |\n|---|${sides.map(() => '---|').join('')}`;
  for (const g of [...new Set(questions.map((q) => q.group))]) {
    const qs = questions.filter((q) => q.group === g);
    const graded = g !== 'd';
    P(`## Group (${g}), ${qs.length} questions, mean [min–max] over the runs\n`);
    P(head);
    const tables = sides.map((s) => s.runs.map(({ recs }) => runMetrics(qs, recs, graded)));
    tables[0][0].forEach(([name, , digits, pct], i) => {
      P(`| ${name} | ${tables.map((runs) => spread(runs.map((m) => m[i][1]), digits, pct)).join(' | ')} |`);
    });
    if (!graded) { P(''); continue; }
    const scores = sides.map((s) => questionScores(qs, s.runs.map((r) => r.recs)));
    P(`| pass^k (3 in all k runs) | ${scores.map((s, i) => `${passK(s)} (k=${ks[i]})`).join(' | ')} |`);
    const cell = (s) => s.map((x) => (x === null ? '-' : x)).join(',');
    if (sides.length === 1) {
      P('\n| question | scores | 3 in every run |\n|---|---|---|');
      qs.forEach((q, i) => P(`| ${q.id} | ${cell(scores[0][i])} | ${passK([scores[0][i]]) ? 'yes' : ''} |`));
      P('');
      continue;
    }
    const used = commonQuestions(scores[0], scores[1]);
    if (!used.length) { P(`\nNo question graded on both sides: no paired difference.\n`); continue; }
    const d = pairedDiff(used.map((i) => scores[0][i]), used.map((i) => scores[1][i]));
    P(`\nPaired difference ${sides[1].name} − ${sides[0].name}, score: ${d.mean.toFixed(3)} (95% bootstrap CI ${d.lo.toFixed(3)} to ${d.hi.toFixed(3)}; ${used.length} of ${qs.length} questions graded on both sides, each question's runs averaged)\n`);
    const moved = used.map((i, j) => ({ q: qs[i], i, diff: d.diffs[j] })).filter((x) => Math.abs(x.diff) >= 1);
    if (moved.length) P(`Moved by ≥ 1:\n\n| question | ${sides[0].name} | ${sides[1].name} |\n|---|---|---|`);
    for (const { q, i } of moved) P(`| ${q.id} | ${cell(scores[0][i])} | ${cell(scores[1][i])} |`);
    if (moved.length) P('');
  }
  P(`Session cost: $${cost.toFixed(2)}. Judge cost: $${judgeCost.toFixed(2)}.`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const labels = (name) => {
    if (args[name] === undefined) return null;
    const list = typeof args[name] === 'string' ? args[name].split(',').filter(Boolean) : [];
    if (!list.length) { console.error(`--${name} needs at least one run label`); process.exit(2); }
    return list;
  };
  const base = labels('base');
  const headLabels = labels('head');
  if (!base || !args.questions) {
    console.error('usage: node analyze.mjs --base <label,...> [--head <label,...>] --questions a,d[,<file>] [--out dir] [--allow-missing | --gate]');
    process.exit(2);
  }
  if (args.gate && (!headLabels || args['allow-missing'])) {
    console.error('--gate needs --head, and never --allow-missing: a gate is read on complete runs only');
    process.exit(2);
  }
  const side = (name, list) => ({ name, runs: list.map((label) => ({ label, recs: loadRun(args, label) })) });
  const sides = [side('base', base), ...(headLabels ? [side('head', headLabels)] : [])];
  const questions = loadQuestions(args.questions);
  const missing = missingItems(questions, sides);
  if (missing.length && !args['allow-missing']) {
    console.error(`Missing (rerun or judge them${args.gate ? '' : ', or pass --allow-missing'}):\n${missing.join('\n')}`);
    process.exit(args.gate ? 2 : 1);
  }
  console.log(report(questions, sides).join('\n'));
  if (missing.length) console.log(`Missing: ${missing.join(', ')}`);
  if (args.gate) {
    const rows = gate(questions, sides);
    if (!rows.length) {
      console.error('--gate: none of the groups (a), (d), (e) in --questions');
      process.exit(2);
    }
    console.log(`\n## Gate\n\n| condition | value | verdict |\n|---|---|---|`);
    for (const r of rows) console.log(`| ${r.condition} | ${r.value} | ${r.pass ? 'PASS' : 'FAIL'} |`);
    const pass = rows.every((r) => r.pass);
    console.log(`\nGate: ${pass ? 'PASS' : 'FAIL'}`);
    process.exit(pass ? 0 : 1);
  }
}
