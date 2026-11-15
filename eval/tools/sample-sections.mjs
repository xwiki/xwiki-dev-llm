// Deterministically samples KB sections for benchmark group (a).
// Usage: node sample-sections.mjs <kb-dir> <count> > sections.json
import fs from 'node:fs';
import path from 'node:path';

const [kbDir, countArg] = process.argv.slice(2);
const count = Number(countArg || 40);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (p.endsWith('.md') ? [p] : []);
  });
}

// Index files, templates and maps are routing, not knowledge.
const skip = f => /(^|\/)(index|_template)\.md$/.test(f);

const sections = [];
for (const file of walk(kbDir).filter(f => !skip(f))) {
  const rel = path.relative(kbDir, file);
  const body = fs.readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  // Split on level-2 headings; level-3 stay inside their parent so a section keeps its context.
  const parts = body.split(/^(?=## )/m);
  for (const part of parts) {
    const m = part.match(/^## (.+)$/m);
    if (!m) continue;
    const text = part.trim();
    if (text.length < 400) continue;
    sections.push({ file: rel, section: m[1].trim(), dir: rel.split('/')[0], bytes: text.length, text });
  }
}

// Seeded PRNG (mulberry32) so the sample is reproducible.
let seed = 20261103;
const rand = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Stratify by top-level directory, proportional to its FILE count (a directory of many small sections,
// like sonarqube/, must not dominate), at least 2 each.
const byDir = {};
for (const s of sections) (byDir[s.dir] ||= []).push(s);
const dirs = Object.keys(byDir).sort();
const files = d => new Set(byDir[d].map(s => s.file)).size;
const totalFiles = dirs.reduce((n, d) => n + files(d), 0);
const quota = Object.fromEntries(dirs.map(d => [d, Math.max(2, Math.round(count * files(d) / totalFiles))]));
let picked = [];
for (const d of dirs) {
  // At most one section per file per pass, so one big file cannot dominate.
  const pool = shuffle([...byDir[d]]);
  const seen = new Set();
  const first = pool.filter(s => !seen.has(s.file) && seen.add(s.file));
  const rest = pool.filter(s => !first.includes(s));
  picked.push(...[...first, ...rest].slice(0, quota[d]));
}
picked = shuffle(picked).slice(0, count);

console.error(`${sections.length} sections in ${new Set(sections.map(s => s.file)).size} files; picked ${picked.length}:`,
  Object.fromEntries(dirs.map(d => [d, picked.filter(s => s.dir === d).length])));
process.stdout.write(JSON.stringify(picked.map((s, i) => ({ id: `a${String(i + 1).padStart(2, '0')}`, ...s })), null, 2));
