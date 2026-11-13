// Builds the human review pack: questions + gold for groups (a)/(b), and a blind calibration sample.
// Usage: node review-pack.mjs <run label> <pack dir> [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { loadQuestions, parseArgs, runDir } from './common.mjs';

const [label, outDir] = process.argv.slice(2);
const args = parseArgs(process.argv.slice(4));
const a = loadQuestions('a');
const b = loadQuestions('b');
fs.mkdirSync(outDir, { recursive: true });

// 1. Question review.
let md = `# Benchmark question review\n\nFor each question: keep, reword (write the new wording), or drop. Group (a) questions must be answerable from the gold section and must not reuse its key terms; group (b) questions are verbatim forum posts — judge whether the gold is right and durable.\n\n## Group (a) — v1 coverage\n\n`;
for (const q of a) md += `### ${q.id} — \`${q.gold.file}\` § ${q.gold.section}\n\n${q.question}\n\n- Key points: ${q.key_points.join(' / ')}\n- Verdict: \n\n`;
md += `## Group (b) — real forum questions\n\n`;
for (const q of b) md += `### ${q.id} — ${q.gold.url} (${q.gold.cat}, ${q.gold.created.slice(0, 10)})\n\n${q.question.trim()}\n\n- Gold: ${q.gold.answer.replace(/\n+/g, ' ')}\n- Key points: ${q.key_points.join(' / ')}\n- Verdict: \n\n`;
fs.writeFileSync(path.join(outDir, 'questions-review.md'), md);

// 2. Blind calibration sample: 8 from (a), 7 from (b), spread over the judge's scores (hidden from the grader).
const recs = [...a, ...b].map(q => ({ q, r: JSON.parse(fs.readFileSync(path.join(runDir(args, label), `${q.id}.json`), 'utf8')) }))
  .filter(x => x.r.grade);
const pick = (group, n) => {
  const xs = recs.filter(x => x.q.group === group).sort((x, y) => x.r.grade.score - y.r.grade.score || x.q.id.localeCompare(y.q.id));
  return Array.from({ length: n }, (_, i) => xs[Math.floor((i + 0.5) * xs.length / n)]);
};
const sample = [...pick('a', 8), ...pick('b', 7)];
let cal = `# Judge calibration — grade blind\n\nGrade each answer 0–3 against the reference (3 = complete and correct; 2 = correct, minor gap; 1 = partly right or vague; 0 = wrong, missing or harmful) and say whether it is harmful (asserts something contradicting the reference that would make the developer do the wrong thing). Do not look at the run's records first: the judge's grades are hidden on purpose.\n\n`;
for (const { q, r } of sample) {
  const ref = q.group === 'a' ? `section § ${q.gold.section} of ${q.gold.file} (frozen in eval/questions/a-sections.json, ${q.id})` : `${q.gold.answer.replace(/\n+/g, ' ')} (${q.gold.url})`;
  cal += `## ${q.id}\n\n**Question:** ${q.question.trim()}\n\n**Reference:** ${ref}\n\n**Key points:** ${q.key_points.join(' / ')}\n\n**Answer:**\n\n${r.answer.trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n- Your score (0–3): \n- Harmful (y/n): \n\n`;
}
fs.writeFileSync(path.join(outDir, 'calibration.md'), cal);
fs.writeFileSync(path.join(outDir, '.calibration-ids.json'), JSON.stringify(sample.map(x => ({ id: x.q.id, label }))));
console.log(`wrote ${a.length + b.length} questions and ${sample.length} calibration answers to ${outDir}`);
