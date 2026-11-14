// Compares two plugin versions over repeated runs: each side is a list of run labels (one label per run).
// Usage: node analyze.mjs --base <label,...> [--head <label,...>] --questions a,d[,<file>] [--out <dir>]
// Prints, per question group, the mean [min–max] over the runs of each metric, pass^k, and for graded
// groups the paired head − base score difference with its 95% bootstrap CI and the questions whose mean
// score moved by ≥ 1. Without --head it prints the base alone, with each question's scores (the baseline
// gate: a question scoring 3 in every run is marked).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuestions, parseArgs, runDir } from './common.mjs';

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** `mean [min–max]` of one value per run. */
export function spread(xs, digits = 2, pct = false) {
  const f = (x) => (pct ? `${Math.round(x * 100)}%` : x.toFixed(digits));
  return xs.length ? `${f(mean(xs))} [${f(Math.min(...xs))}–${f(Math.max(...xs))}]` : '-';
}

const ptrs = (r) => r.hook_pointers || [];
const skillLines = (r) => ptrs(r).filter((p) => p.startsWith('skill:')).length;
const readFile = (r, file) => (r.okf_touches || []).some((t) => t.target.endsWith(file));

/**
 * The metrics of one run of a group: [name, value of the run, digits, pct]. `items` are { q, r } pairs
 * holding the run's record; a graded group counts only graded records, group (d) every record.
 */
export function runMetrics(items, graded) {
  const xs = items.filter((x) => x.r && (!graded || x.r.grade));
  const per = (f) => mean(xs.map((x) => f(x.r, x.q)));
  const share = (f) => per((r, q) => (f(r, q) ? 1 : 0));
  const gold = xs.some((x) => x.q.gold?.file);
  return [
    ...(graded ? [
      ['score (0–3)', per((r) => r.grade.score), 2],
      ['full (3s)', xs.filter((x) => x.r.grade.score === 3).length, 1],
      ['harmful per run', xs.filter((x) => x.r.grade.harmful).length, 1],
    ] : [
      ['sessions given any pointer', share((r) => ptrs(r).length), 0, true],
      ['touched the KB or a skill', share((r) => (r.okf_touches || []).length), 0, true],
    ]),
    ...(graded && gold ? [
      ['gold file read', share((r, q) => readFile(r, q.gold.file)), 0, true],
      ['gold section in pointers', share((r, q) => ptrs(r).some((p) => p.startsWith(`${q.gold.file}#${q.gold.section}`))), 0, true],
      ['gold file in pointers', share((r, q) => ptrs(r).some((p) => p.startsWith(`${q.gold.file}#`))), 0, true],
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

/** pass^k: the questions scoring 3 in every one of the k runs. */
export function passK(scores) {
  return scores.filter((s) => s.length && s.every((x) => x === 3)).length;
}

/**
 * The paired difference of two sides' per-question mean scores (each question's runs averaged), with a
 * 95% bootstrap CI: 10,000 resamples of the questions, a fixed-seed LCG so a rerun prints the same CI.
 */
export function pairedDiff(baseScores, headScores, { resamples = 10000, seed = 12345 } = {}) {
  const qmean = (s) => mean(s.filter((x) => x !== null));
  const diffs = headScores.map((h, i) => qmean(h) - qmean(baseScores[i]));
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const boots = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)];
    boots.push(s / diffs.length);
  }
  boots.sort((a, b) => a - b);
  return { diffs, mean: mean(diffs), lo: boots[Math.floor(resamples * 0.025) - 1], hi: boots[Math.floor(resamples * 0.975) - 1] };
}

/** A label's records by question id, from the run directory `run.mjs` and `judge.mjs` write. */
export function loadRun(args, label) {
  const dir = runDir(args, label);
  const recs = {};
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json') && !f.startsWith('_')) recs[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  return recs;
}

/** The whole report, as Markdown lines. `sides` = [{ name, runs: [{ label, recs }] }]. */
export function report(questions, sides) {
  const out = [];
  const P = (s) => out.push(s);
  const missing = [];
  let cost = 0;
  for (const side of sides) {
    for (const { label, recs } of side.runs) {
      for (const q of questions) {
        const r = recs[q.id];
        if (!r) missing.push(`${label}/${q.id}`);
        else {
          cost += r.cost_usd || 0;
          if (q.group !== 'd' && !r.grade) missing.push(`${label}/${q.id} (ungraded)`);
        }
      }
    }
  }
  const groups = [...new Set(questions.map((q) => q.group))];
  const head = `| metric | ${sides.map((s) => s.name).join(' | ')} |\n|---|${sides.map(() => '---|').join('')}`;
  for (const g of groups) {
    const qs = questions.filter((q) => q.group === g);
    const graded = g !== 'd';
    const k = Math.max(...sides.map((s) => s.runs.length));
    P(`## Group (${g}), ${qs.length} questions, mean [min–max] over ${k} run${k > 1 ? 's' : ''}\n`);
    P(head);
    const tables = sides.map((s) => s.runs.map(({ recs }) => runMetrics(qs.map((q) => ({ q, r: recs[q.id] })), graded)));
    tables[0][0]?.forEach(([name, , digits, pct], i) => {
      P(`| ${name} | ${tables.map((runs) => spread(runs.map((m) => m[i][1]), digits, pct)).join(' | ')} |`);
    });
    if (!graded) { P(''); continue; }
    const scores = sides.map((s) => questionScores(qs, s.runs.map((r) => r.recs)));
    P(`| pass^k (3 in all runs) | ${scores.map(passK).join(' | ')} |`);
    const cell = (s) => s.map((x) => (x === null ? '-' : x)).join(',');
    if (sides.length === 1) {
      P('\n| question | scores | 3 in every run |\n|---|---|---|');
      qs.forEach((q, i) => P(`| ${q.id} | ${cell(scores[0][i])} | ${passK([scores[0][i]]) ? 'yes' : ''} |`));
      P('');
      continue;
    }
    const d = pairedDiff(scores[0], scores[1]);
    P(`\nPaired difference ${sides[1].name} − ${sides[0].name}, score: ${d.mean.toFixed(3)} (95% bootstrap CI ${d.lo.toFixed(3)} to ${d.hi.toFixed(3)}, ${qs.length} questions, each question's runs averaged)\n`);
    const moved = qs.map((q, i) => ({ q, i })).filter(({ i }) => Math.abs(d.diffs[i]) >= 1);
    if (moved.length) P(`Moved by ≥ 1:\n\n| question | ${sides[0].name} | ${sides[1].name} |\n|---|---|---|`);
    for (const { q, i } of moved) P(`| ${q.id} | ${cell(scores[0][i])} | ${cell(scores[1][i])} |`);
    if (moved.length) P('');
  }
  P(`Session cost: $${cost.toFixed(2)}. Missing: ${missing.length ? missing.join(', ') : 'none'}`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.base !== 'string' || !args.questions) {
    console.error('usage: node analyze.mjs --base <label,...> [--head <label,...>] --questions a,d[,<file>] [--out dir]');
    process.exit(2);
  }
  const side = (name, spec) => ({ name, runs: spec.split(',').filter(Boolean).map((label) => ({ label, recs: loadRun(args, label) })) });
  const sides = [side('base', args.base), ...(typeof args.head === 'string' ? [side('head', args.head)] : [])];
  console.log(report(loadQuestions(args.questions), sides).join('\n'));
}
