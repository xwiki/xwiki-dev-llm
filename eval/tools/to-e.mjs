// Turns gen-a.mjs output into group (e) questions of a KB batch (eval/README.md, "KB batches").
// Usage: node to-e.mjs <excerpts.json> <gen-a output.json> <questions/e-<slug>.json>
//   <excerpts.json> is what gen-a.mjs was given: one entry per fact, { id, gap, file: <page url>,
//   section, version, text: the page excerpt }. Questions already in the output file are kept, those
//   with the same id replaced (a regenerated question). Prints, per question, the fact's distinctive
//   terms (from the backlog entry) its key points leave out: all of them left out is the sign of a
//   question aimed at a side detail of its excerpt. It is a hint for the review, not a verdict.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalDir } from './common.mjs';

const page = (url) => String(url).replace(/[#?].*$/, '').replace(/\/+$/, '');

/** The fact's distinctive terms: identifiers, paths, options, versions, acronyms (lower-cased). */
export function factTerms(fact) {
  return [...new Set((fact.match(/[@-]?[A-Za-z][\w./:<>-]*[\w>]/g) || [])
    .filter((t) => /[a-z][A-Z]|[A-Z]{2,}|[./:_<]|\d|^[@-]/.test(t))
    .map((t) => t.replace(/[.,;:]+$/, '').toLowerCase()))];
}

/** The fact's distinctive terms that none of the key points mention. */
export function missingTerms(fact, keyPoints) {
  const text = keyPoints.join(' ').toLowerCase();
  return factTerms(fact).filter((t) => !text.includes(t));
}

/**
 * One group (e) question from a gen-a question, its excerpt and the backlog. Throws when the excerpt's
 * `gap` is not a backlog id or its page is not among that entry's sources.
 */
export function toE(q, excerpt, backlog) {
  const entry = backlog.find((b) => b.id === excerpt?.gap);
  if (!entry) throw new Error(`${q.id}: no backlog entry ${excerpt?.gap}`);
  if (!entry.sources.some((s) => page(s.url) === page(excerpt.file))) {
    throw new Error(`${q.id}: ${excerpt.file} is not a source of ${entry.id}`);
  }
  return {
    id: q.id, group: 'e', question: q.question, kind: q.kind, key_points: q.key_points, avoided_terms: q.avoided_terms,
    gold: {
      source: `${excerpt.file}@${excerpt.version}`, section: excerpt.section, gap: entry.id,
      reference: `${excerpt.text.trim()}\n\n(Source: ${excerpt.file} , page version ${excerpt.version}, section "${excerpt.section}")`,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [excerptsFile, genFile, outFile] = process.argv.slice(2);
  if (!outFile) {
    console.error('usage: node to-e.mjs <excerpts.json> <gen-a output.json> <questions/e-<slug>.json>');
    process.exit(2);
  }
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const excerpts = read(excerptsFile);
  const backlog = read(path.join(evalDir, 'backlog.json'));
  const made = read(genFile).map((q) => toE(q, excerpts.find((x) => x.id === q.id), backlog));
  const kept = fs.existsSync(outFile) ? read(outFile).filter((q) => !made.some((m) => m.id === q.id)) : [];
  const all = [...kept, ...made].sort((x, y) => x.id.localeCompare(y.id));
  fs.writeFileSync(outFile, JSON.stringify(all, null, 2) + '\n');
  for (const q of made) {
    const fact = backlog.find((b) => b.id === q.gold.gap).fact;
    const terms = factTerms(fact);
    const missing = missingTerms(fact, q.key_points);
    console.log(`${q.id} ${q.gold.gap}: ${terms.length - missing.length}/${terms.length} fact terms in the key points` +
      `${missing.length ? `; missing: ${missing.join(', ')}` : ''}${terms.length && missing.length === terms.length ? '  <- check it tests its fact' : ''}`);
  }
}
