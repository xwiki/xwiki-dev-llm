// Grades a run's answers against the frozen gold with an LLM judge, then prints the scoreboard.
// Usage: node judge.mjs --label <run label> --questions a,b,c [--kb <kb dir>] [--out <dir>]
//          [--model opus] [--concurrency 4]
// A group (a) reference is the question's `gold.reference`, else its gold section: frozen in
// questions/a-sections.json, or read from --kb when given (to judge against another KB's wording).
import fs from 'node:fs';
import path from 'node:path';
import { claudeJson, pool } from './claude.mjs';
import { evalDir, loadQuestions, missingReferences, parseArgs, runDir as runDirOf } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.label) {
  console.error('usage: node judge.mjs --label <label> --questions a,b,c [--kb dir] [--out dir] [--model opus]');
  process.exit(2);
}
const runDir = runDirOf(args);
const questions = loadQuestions(args.questions, 'a');
if (missingReferences(questions).length) {
  console.error(`group (e) questions without gold.reference: ${missingReferences(questions).join(', ')}`);
  process.exit(2);
}
const frozen = JSON.parse(fs.readFileSync(path.join(evalDir, 'questions', 'a-sections.json'), 'utf8'));

function goldSection(gold) {
  if (!args.kb) {
    return frozen.find(s => s.file === gold.file && s.section === gold.section)?.text.trim() || '(section not found)';
  }
  const body = fs.readFileSync(path.join(path.resolve(args.kb), gold.file), 'utf8');
  const parts = body.split(/^(?=## )/m);
  return parts.find(p => p.startsWith(`## ${gold.section}`))?.trim() || '(section not found)';
}

const schema = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: { point: { type: 'string' }, verdict: { type: 'string', enum: ['covered', 'partial', 'missing', 'contradicted'] } },
        required: ['point', 'verdict'],
      },
    },
    harmful: { type: 'boolean', description: 'The answer asserts a rule or fact that contradicts the reference and would lead the developer to do the wrong thing.' },
    score: { type: 'integer', minimum: 0, maximum: 3, description: '3 = complete and correct; 2 = correct, minor gap; 1 = partly right or vague; 0 = wrong, missing or harmful' },
    rationale: { type: 'string' },
  },
  required: ['points', 'harmful', 'score', 'rationale'],
};

function prompt(q, rec) {
  const ref = q.group === 'a' || q.group === 'e' ? (q.gold.reference || goldSection(q.gold)) : q.group === 'b' ? q.gold.answer : q.gold.checklist.join('\n- ');
  const subject = q.group === 'c'
    ? `The developer gave this TASK to their coding agent:\n<<<\n${q.task}\n>>>\n\nThe agent's final message:\n<<<\n${rec.answer}\n>>>\n\n${rec.commits ? `The agent's commit messages:\n<<<\n${rec.commits}\n>>>\n\n` : ''}The agent's diff:\n<<<\n${(rec.diff || '(no changes)').slice(0, 60000)}\n>>>`
    : `The developer asked:\n<<<\n${q.question}\n>>>\n\nThe agent answered:\n<<<\n${rec.answer}\n>>>`;
  const points = q.group === 'c' ? q.gold.checklist : q.key_points;
  return `You grade an XWiki developer assistant against a trusted reference. Judge only against the reference: an extra correct detail is fine, an extra claim that contradicts the reference is not.

${subject}

Reference (ground truth):
<<<
${ref}
>>>

Grade each required point (copy it into "point"):
${points.map(p => `- ${p}`).join('\n')}
${q.kind === 'volatile-behaviour' ? '\nThis question asks for a volatile value: the correct behaviour is to NOT quote a remembered value and to say how/where to verify it. Quoting a specific value as current is "contradicted".' : ''}
${q.group === 'c' ? '\nFor a task, a point is "covered" when the diff (or, for process points, the final message) respects it; "missing" when the diff ignores it.' : ''}`;
}

await pool(questions, Number(args.concurrency || 4), async q => {
  const recFile = path.join(runDir, `${q.id}.json`);
  if (!fs.existsSync(recFile)) return;
  const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
  if (rec.grade || q.group === 'd') return; // resumable; (d) has no gold: it measures retrieval noise only
  try {
    const r = await claudeJson(prompt(q, rec), { model: args.model || 'opus', tools: '', jsonSchema: schema });
    // The judge's own cost goes with its grade, so a run's total (analyze.mjs) is measured, not estimated.
    rec.grade = { ...r.structured_output, cost_usd: r.total_cost_usd ?? null };
    fs.writeFileSync(recFile, JSON.stringify(rec, null, 2));
    console.error(`${q.id} score ${rec.grade.score}${rec.grade.harmful ? ' HARMFUL' : ''}`);
  } catch (e) {
    console.error(`${q.id} judge FAILED: ${e.message}`);
  }
});

// Scoreboard.
const recs = questions.map(q => {
  const f = path.join(runDir, `${q.id}.json`);
  return fs.existsSync(f) ? { q, r: JSON.parse(fs.readFileSync(f, 'utf8')) } : null;
}).filter(x => x?.r.grade);
const groups = [...new Set(recs.map(x => x.q.group))].sort();
const rows = groups.map(g => {
  const xs = recs.filter(x => x.q.group === g);
  const avg = f => xs.reduce((n, x) => n + f(x), 0) / xs.length;
  const recall = g === 'a' ? avg(x => x.r.okf_touches.some(t => t.target.endsWith(x.q.gold.file)) ? 1 : 0) : null;
  const row = {
    group: g, n: xs.length,
    score: +avg(x => x.r.grade.score).toFixed(2),
    full: xs.filter(x => x.r.grade.score === 3).length,
    harmful: xs.filter(x => x.r.grade.harmful).length,
    gold_file_read: recall === null ? '-' : `${Math.round(recall * 100)}%`,
    okf_used: `${Math.round(avg(x => x.r.okf_touches.length ? 1 : 0) * 100)}%`,
    in_tokens: Math.round(avg(x => x.r.tokens.input)),
    out_tokens: Math.round(avg(x => x.r.tokens.output)),
    cost_usd: +avg(x => x.r.cost_usd || 0).toFixed(3),
  };
  // v2 (records with hook_pointers): did the UserPromptSubmit hook point at the gold section / file?
  if (g === 'a' && xs.some(x => x.r.hook_pointers)) {
    const ptrs = x => x.r.hook_pointers || [];
    row.gold_in_pointers = `${Math.round(avg(x => ptrs(x).some(p => p.startsWith(`${x.q.gold.file}#${x.q.gold.section}`)) ? 1 : 0) * 100)}%`;
    row.gold_file_in_pointers = `${Math.round(avg(x => ptrs(x).some(p => p.startsWith(`${x.q.gold.file}#`)) ? 1 : 0) * 100)}%`;
  }
  if (xs.some(x => x.r.hook_pointers)) row.pointed = `${Math.round(avg(x => x.r.hook_pointers?.length ? 1 : 0) * 100)}%`;
  return row;
});
// Group (d): nothing in the OKF answers these, so any OKF pointer/read is noise.
const ds = questions.filter(q => q.group === 'd').map(q => {
  const f = path.join(runDir, `${q.id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}).filter(Boolean);
if (ds.length) {
  const avg = f => ds.reduce((n, r) => n + f(r), 0) / ds.length;
  rows.push({ group: 'd', n: ds.length, score: '-', full: '-', harmful: '-', gold_file_read: '-',
    okf_used: `${Math.round(avg(r => r.okf_touches.length ? 1 : 0) * 100)}%`,
    in_tokens: Math.round(avg(r => r.tokens.input)), out_tokens: Math.round(avg(r => r.tokens.output)),
    cost_usd: +avg(r => r.cost_usd || 0).toFixed(3),
    ...(ds.some(r => r.hook_pointers) ? { pointed: `${Math.round(avg(r => r.hook_pointers?.length ? 1 : 0) * 100)}%` } : {}) });
}
console.table(rows);
fs.writeFileSync(path.join(runDir, '_scoreboard.json'), JSON.stringify(rows, null, 2));
