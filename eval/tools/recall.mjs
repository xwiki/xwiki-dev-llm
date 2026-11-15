// Retrieval recall of a plugin's kb-search on a question set, with no LLM: for each question, searches
// the raw question text and reports recall@1/3/5 at file level (gold.file among the hits) and section
// level (gold.file + gold.section), plus the misses (gold section not in the top 5) with their top 3.
// Usage: node recall.mjs --label <label> [--questions a] [--plugin <xwiki dir>] [--kb <kb dir>] [--out <dir>]
//   The engine is the plugin's scripts/kb-search.mjs, the KB its kb/ unless --kb names another.
//   Writes <out>/recall/<label>.json and prints the scores.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kbDirOf, loadQuestions, outRoot, parseArgs, pluginDir } from './common.mjs';

const K = [1, 3, 5];

/** Scores `questions` against an index: `search(index, text, { k })` returns hits `{ id, file }`. */
export function scoreRecall(questions, index, search) {
  const known = new Set(index.sections.map((s) => `${s.file}#${s.section}`));
  const hitsAt = { file: Object.fromEntries(K.map((k) => [k, 0])), section: Object.fromEntries(K.map((k) => [k, 0])) };
  const perQuestion = [];
  const misses = [];
  for (const q of questions) {
    const gold = `${q.gold.file}#${q.gold.section}`;
    const hits = search(index, q.question, { k: 5 });
    const fileRank = hits.findIndex((h) => h.file === q.gold.file) + 1 || null;
    const sectionRank = hits.findIndex((h) => h.id === gold) + 1 || null;
    for (const k of K) {
      if (fileRank && fileRank <= k) hitsAt.file[k]++;
      if (sectionRank && sectionRank <= k) hitsAt.section[k]++;
    }
    perQuestion.push({ id: q.id, gold, fileRank, sectionRank });
    if (!sectionRank) misses.push({ id: q.id, gold, goldIndexed: known.has(gold), fileRank, top3: hits.slice(0, 3).map((h) => h.id) });
  }
  const n = questions.length;
  const ratio = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`@${k}`, Math.round((v / n) * 1000) / 1000]));
  return { n, recall: { file: ratio(hitsAt.file), section: ratio(hitsAt.section) }, misses, perQuestion };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.label) {
    console.error('usage: node recall.mjs --label <label> [--questions a] [--plugin dir] [--kb dir] [--out dir]');
    process.exit(2);
  }
  const plugin = pluginDir(args);
  const kbRoot = path.resolve(args.kb || kbDirOf(plugin));
  const engine = path.join(plugin, 'scripts', 'kb-search.mjs');
  const { buildIndex, search } = await import(pathToFileURL(engine).href);
  const questions = loadQuestions(args.questions, 'a').filter((q) => q.gold?.file && q.gold?.section);
  if (!questions.length) {
    console.error('no question with a gold file#section: recall measures group (a) only');
    process.exit(2);
  }
  const index = buildIndex(kbRoot);
  const t0 = performance.now();
  const scored = scoreRecall(questions, index, search);
  const result = {
    label: args.label, questions: args.questions || 'a', plugin, kb: kbRoot, sections: index.sections.length,
    avgQueryMs: Math.round(((performance.now() - t0) / questions.length) * 100) / 100, ...scored,
  };
  const out = path.join(outRoot(args), 'recall', `${args.label}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${args.label}: n=${result.n}, ${index.sections.length} sections`);
  console.log(`file    recall ${JSON.stringify(result.recall.file)}`);
  console.log(`section recall ${JSON.stringify(result.recall.section)}`);
  console.log(`misses (section not in top 5): ${result.misses.length} -> ${out}`);
}
