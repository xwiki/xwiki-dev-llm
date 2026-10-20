#!/usr/bin/env node
// Inventory the deprecated Java APIs declared in one XWiki repo and rank them by how easy they are to
// retire: few callers (script callers — Velocity, wiki pages, JS — cost more to migrate and verify than Java
// ones), a documented replacement, a module already wrapped by a weaving -legacy module.
//
// Usage (from inside a checkout of xwiki-commons, xwiki-rendering or xwiki-platform):
//   node find-candidates.mjs [--repos <dir,...>] [--module <substring>] [--min-callers N] [--limit N] [--json <file>]
//
// --repos   checkouts searched for callers; default: the current repo plus its xwiki-commons,
//           xwiki-rendering and xwiki-platform siblings when they exist. They are released together, so a
//           caller in any of them blocks the move to legacy.
// --module       only APIs whose declaring path contains this substring.
// --min-callers  only APIs with at least N Java callers (main + test): 1 hides the "move only" APIs, which
//                no code calls any more, to show the ones needing a migration.
//
// Counts are by NAME (every tracked source file is tokenized once), so they are upper bounds: a common
// method name ("getName") collects unrelated hits. A zero is
// reliable; a small count must be confirmed from the compiler's deprecation warnings (see SKILL.md). The
// notes say when some "callers" do not even name the declaring class: likely homonyms.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const git = (cwd, gitArgs) => {
  try {
    return execFileSync('git', ['-C', cwd, ...gitArgs], { encoding: 'utf8', maxBuffer: 1 << 30 });
  } catch (e) {
    // git grep exits 1 when nothing matches.
    if (e.status === 1) return '';
    throw e;
  }
};

const declRepo = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
const siblings = ['xwiki-commons', 'xwiki-rendering', 'xwiki-platform']
  .map(n => path.join(path.dirname(declRepo), n))
  .filter(d => existsSync(path.join(d, '.git')));
const repos = opt('repos') ? opt('repos').split(',').map(d => path.resolve(d))
  : [...new Set([declRepo, ...siblings])];
const moduleFilter = opt('module');
const limit = Number(opt('limit', 40));
const minCallers = Number(opt('min-callers', 0));

const CODE_GLOBS = ['*.java', '*.aj', '*.groovy', '*.vm', '*.xml', '*.js', '*.ts', '*.vue'];
const isMainJava = p => /\/src\/main\/java\//.test(p) && !p.includes('/target/') && !/-legacy/.test(p);

// ---------------------------------------------------------------------------------------------------------
// 1. Deprecated declarations of the current repo.

function nearestModule(repo, rel) {
  let dir = path.dirname(path.join(repo, rel));
  while (dir.startsWith(repo)) {
    const pom = path.join(dir, 'pom.xml');
    if (existsSync(pom)) {
      const xml = readFileSync(pom, 'utf8').replace(/<parent>[\s\S]*?<\/parent>/, '');
      return { dir, artifactId: (xml.match(/<artifactId>([^<]+)<\/artifactId>/) || [])[1] };
    }
    dir = path.dirname(dir);
  }
  return { dir: repo, artifactId: '?' };
}

function javadocBefore(lines, i) {
  for (let k = i - 1; k >= Math.max(0, i - 60); k--) {
    const t = lines[k].trim();
    if (t.startsWith('/**')) return lines.slice(k, i).join('\n');
    if (t && !t.startsWith('*') && !t.startsWith('@') && !t.startsWith('//')) return '';
  }
  return '';
}

function parseDeclarations(repo) {
  const files = git(repo, ['grep', '-l', '@Deprecated', '--', '*.java']).split('\n').filter(isMainJava);
  const out = [];
  for (const rel of files) {
    const src = readFileSync(path.join(repo, rel), 'utf8');
    const lines = src.split('\n');
    const pkg = (src.match(/^package\s+([\w.]+);/m) || [])[1] || '';
    const cls = path.basename(rel, '.java');
    const component = /@Component\b/.test(src);
    const scriptService = /implements[^{]*\bScriptService\b/.test(src);
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t.startsWith('@Deprecated')) return;
      let decl = '';
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const s = lines[j].trim();
        if (!s || s.startsWith('@') || s.startsWith('*') || s.startsWith('/')) continue;
        decl = s;
        break;
      }
      const doc = javadocBefore(lines, i);
      const depText = (doc.match(/@deprecated([\s\S]*?)(?=\n\s*\*\s*@\w|\*\/|$)/) || [])[1] || '';
      const since = (t.match(/since\s*=\s*"([^"]+)"/) || depText.match(/(?:since\s+)?(\d+\.\d+[\w.,\s]*?)(?:[,.]?\s|$)/)
        || [])[1] || '';
      // Keep the link target, not its label: {@link Foo#bar(Object) label}.
      const link = ((depText.match(/\{@link(?:plain)?\s+([^}]+)\}/) || [])[1] || '').trim().split(/\s+(?![^(]*\))/)[0];
      const noop = /not (taken into account|used)|no[- ]?op\b|has no effect|(is|are) ignored/i.test(depText);
      const replacement = link || (noop ? '(no-op)' : /\b(use|replaced by|instead)\b/i.test(depText) ? '(text)' : '');
      let kind, name, word;
      const tm = decl.match(/\b(class|interface|enum|record|@interface)\s+(\w+)/);
      const mm = decl.match(/(\w+)\s*\(/);
      const fm = decl.match(/(\w+)\s*(=|;)/);
      if (tm) {
        kind = 'type'; name = tm[2]; word = name;
      } else if (mm && !/^(return|new|throw)\b/.test(decl)) {
        kind = mm[1] === cls ? 'ctor' : 'method'; name = mm[1]; word = kind === 'ctor' ? cls : name;
      } else if (fm) {
        kind = 'field'; name = fm[1]; word = name;
      } else {
        return;
      }
      if (moduleFilter && !rel.includes(moduleFilter)) return;
      out.push({
        kind, word, rel, cls, since: since.trim(), replacement,
        api: kind === 'type' && name === cls ? `${pkg}.${cls}` : `${pkg}.${cls}#${name}`,
        internal: /\.internal(\.|$)/.test(pkg), component: kind === 'type' && component, scriptService
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// 2. Callers, by name, in every repo, in one grep pass per repo.

const decls = parseDeclarations(declRepo);
const words = new Set(decls.map(d => d.word));
// Velocity reads getFoo()/isFoo() as $obj.foo, so also look for the property name in scripts.
const velocityProp = w => {
  const m = w.match(/^(get|is)([A-Z]\w*)$/);
  return m ? m[2][0].toLowerCase() + m[2].slice(1) : null;
};
decls.forEach(d => d.kind === 'method' && velocityProp(d.word) && words.add(velocityProp(d.word)));
// A real caller of a member usually names its class (import, typed variable): tells real hits from homonyms.
decls.forEach(d => words.add(d.cls));

// Tokenizing every file once against a Set is much faster than a multi-pattern `git grep -o`, and needs
// nothing but Node.
const hits = new Map(); // word -> Set of "repoName/path"
const TOKEN = /[A-Za-z_$][\w$]*/g;
for (const repo of repos) {
  const files = git(repo, ['ls-files', '-z', '--', ...CODE_GLOBS]).split('\0')
    .filter(f => f && !f.includes('/target/') && !f.endsWith('pom.xml'));
  for (const file of files) {
    let text;
    try {
      text = readFileSync(path.join(repo, file), 'utf8');
    } catch {
      continue; // listed but absent (sparse checkout, deleted in the working tree)
    }
    const key = `${path.basename(repo)}/${file}`;
    for (const w of new Set(text.match(TOKEN))) {
      if (!words.has(w)) continue;
      if (!hits.has(w)) hits.set(w, new Set());
      hits.get(w).add(key);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// 3. Legacy readiness: which main artifacts are already woven by a -legacy module.

const woven = new Set();
for (const repo of repos) {
  for (const pom of git(repo, ['grep', '-l', '<weaveDependency>', '--', '*pom.xml']).split('\n').filter(Boolean)) {
    const xml = readFileSync(path.join(repo, pom), 'utf8');
    for (const block of xml.match(/<weaveDependency>[\s\S]*?<\/weaveDependency>/g) || []) {
      woven.add((block.match(/<artifactId>([^<]+)</) || [])[1]);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// 4. Rank and print.

const repoName = path.basename(declRepo);
// A file declaring a deprecated member of the same name (an overload, a sibling class) is not a caller.
const declaringFiles = new Map();
for (const d of decls) {
  if (!declaringFiles.has(d.word)) declaringFiles.set(d.word, new Set());
  declaringFiles.get(d.word).add(`${repoName}/${d.rel}`);
}
// Overloads of one API become one row.
const byApi = new Map();
for (const d of decls) {
  const key = `${d.kind} ${d.api}`;
  if (byApi.has(key)) byApi.get(key).overloads++;
  else byApi.set(key, { ...d, overloads: 1 });
}
const rows = [...byApi.values()].map(d => {
  const files = [...(hits.get(d.word) || [])].filter(f => !declaringFiles.get(d.word).has(f));
  const java = files.filter(f => /\.(java|aj|groovy)$/.test(f) && !f.includes('/src/test/') && !/-legacy/.test(f));
  const tests = files.filter(f => f.includes('/src/test/'));
  const legacy = files.filter(f => /-legacy/.test(f) && !f.includes('/src/test/'));
  const prop = d.kind === 'method' ? velocityProp(d.word) : null;
  const scriptFiles = files.filter(f => /\.(vm|xml|js|ts|vue)$/.test(f))
    .concat(prop ? [...(hits.get(prop) || [])].filter(f => /\.(vm|xml)$/.test(f)) : []);
  const module = nearestModule(declRepo, d.rel).artifactId;
  const notes = [];
  if (d.internal) notes.push('internal: delete, no legacy');
  else notes.push(woven.has(module) ? 'legacy weaver exists' : 'no legacy weaver');
  if (d.component) notes.push('component: its hint is the contract');
  if (d.scriptService) notes.push('script service: Velocity callers');
  if (d.kind !== 'type' && java.length) {
    const ownerFiles = hits.get(d.cls) || new Set();
    const naming = java.filter(f => ownerFiles.has(f)).length;
    if (naming < java.length) notes.push(`only ${naming}/${java.length} Java callers name ${d.cls}`);
  }
  if (d.overloads > 1) notes.push(`${d.overloads} overloads`);
  if (!d.replacement) notes.push('no replacement named');
  return { ...d, module, java: java.length, tests: tests.length, legacy: legacy.length,
    scripts: [...new Set(scriptFiles)].length, notes: notes.join('; '),
    callers: { java, tests, legacy, scripts: [...new Set(scriptFiles)] } };
});

// A script caller costs more than a Java one: nothing compiles it, so it must be rendered to be verified.
const easiness = r => r.scripts * 25 + (r.component ? 500 : 0) + r.java * 10 + r.tests * 3
  + (r.internal || woven.has(r.module) ? 0 : 20) + (r.replacement ? 0 : 5);
rows.sort((a, b) => easiness(a) - easiness(b) || a.api.localeCompare(b.api));
const shown = rows.filter(r => r.java + r.tests >= minCallers);

if (opt('json')) writeFileSync(opt('json'), JSON.stringify({ repos, rows }, null, 2));

console.log(`${decls.length} deprecated declarations (${rows.length} APIs) in ${repoName} main code, `
  + `${shown.length} shown before --limit; callers searched in: `
  + repos.map(r => path.basename(r)).join(', '));
console.log(['kind', 'api', 'since', 'java', 'tests', 'scripts', 'legacy', 'replacement', 'notes'].join('\t'));
for (const r of shown.slice(0, limit)) {
  console.log([r.kind, r.api, r.since, r.java, r.tests, r.scripts, r.legacy, r.replacement || '-', r.notes].join('\t'));
}
