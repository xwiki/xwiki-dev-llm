#!/usr/bin/env node
// Deterministic grading of the group (c) checklist points a record's diff, commit messages or final
// message can settle mechanically. Each grader returns true (respected), false (violated) or null
// (cannot tell from the record: no diff, or the point does not apply to what the session did).
//
//   node grade-det.mjs --labels run1,run2 [--json out.json] [--out dir] [--clones dir]
//
// The judge's verdict counts as a pass only when it is `covered`. Graders read only the record and
// the task repo's root pom at `base` (for the expected @since / @Deprecated(since) value).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clonesDir, loadQuestions, parseArgs, runDir } from './common.mjs';

// ---- record parsing ---------------------------------------------------------------------------

export function parseDiff(diff) {
  const files = [];
  let cur = null;
  for (const line of String(diff || '').split('\n')) {
    const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (m) { files.push(cur = { path: m[2], added: [], removed: [], isNew: false, deleted: false }); continue; }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.isNew = true;
    else if (line.startsWith('deleted file mode')) cur.deleted = true;
    else if (line.startsWith('+++') || line.startsWith('---')) continue;
    else if (line.startsWith('+')) cur.added.push(line.slice(1));
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  return files;
}

export function summaries(commits) {
  return String(commits || '').split(/\n----\n?/).map((b) => b.trim()).filter(Boolean)
    .map((b) => b.split('\n')[0].trim()).filter((s) => !/^Merge\b/.test(s));
}

const versionCache = new Map();
/** The project version of a root pom, its parent's excluded (e.g. 18.8.0-SNAPSHOT). */
export function pomVersion(pom) {
  const noParent = String(pom || '').replace(/<parent>[\s\S]*?<\/parent>/, '');
  return (/<version>([^<]+)<\/version>/.exec(noParent) || [])[1] || null;
}

/** The project version of the task repo's root pom at `base`, read from its clone under `clones`. */
export function baseVersion(task, clones) {
  const repo = task.repo || 'xwiki-platform';
  const key = `${clones}/${repo}@${task.base}`;
  if (!versionCache.has(key)) {
    let v = null;
    try {
      v = pomVersion(execFileSync('git', ['-C', path.join(clones, repo), 'show', `${task.base}:pom.xml`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch { /* unknown */ }
    versionCache.set(key, v);
  }
  return versionCache.get(key);
}

/** The next release of a dev version, per okf/conventions/versioning.md: X.Y.0-SNAPSHOT → X.Y.0RC1. */
export function nextRelease(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)-SNAPSHOT$/.exec(v || '');
  if (!m) return null;
  return m[3] === '0' ? `${m[1]}.${m[2]}.0RC1` : `${m[1]}.${m[2]}.${m[3]}`;
}

// ---- helpers over a parsed record -------------------------------------------------------------

function ctx(task, rec, version) {
  const files = parseDiff(rec.diff);
  const sums = summaries(rec.commits);
  const sel = (re) => files.filter((f) => re.test(f.path));
  const added = (re) => sel(re).flatMap((f) => f.added).join('\n');
  const removed = (re) => sel(re).flatMap((f) => f.removed).join('\n');
  const ANY = /./;
  const IT = /src\/test\/.*IT\.java$/;
  const MAIN_JAVA = /src\/main\/(java|aspect)\/.*\.(java|aj)$/;
  const allMisc = () => (sums.length ? sums.every((s) => s.startsWith('[Misc]')) : null);
  const allKey = (key) => (sums.length ? sums.every((s) => s.startsWith(`${key}: `)) : null);
  const revapiAdded = (re = /pom\.xml$/) => /<code>\s*java\.[\w.]+\s*<\/code>|<regex>|java\.(method|class|field|annotation)\.\w+/.test(added(re));
  const next = nextRelease(version);
  const deprecatedSinces = () => [...added(/\.(java|aj)$/).matchAll(/@Deprecated\s*\(\s*since\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
  const javadocDeprecatedVersionless = () => {
    const lines = added(/\.(java|aj)$/).split('\n').filter((l) => /^\s*\*\s*@deprecated\b/.test(l));
    return lines.every((l) => !/\b(since|\d+\.\d+)/i.test(l.replace(/@deprecated/, '')));
  };
  return { files, sums, sel, added, removed, ANY, IT, MAIN_JAVA, allMisc, allKey, revapiAdded, next,
    deprecatedSinces, javadocDeprecatedVersionless, answer: String(rec.answer || ''), hasDiff: files.length > 0 };
}

// ---- the graders, per task and point ----------------------------------------------------------
// Each: [point index (1-based), kind, fn(c) → bool|null]. kind "diff" needs a diff, "msg" needs commits,
// "answer" reads the final message (with the diff/commits as alternative evidence where the point says so).

export const GRADERS = {
  c01: [
    [1, 'diff', (c) => !/java\.method\.removed/.test(c.added(/pom\.xml$/))],
    [2, 'diff', (c) => /xwiki-platform-oldcore/.test(c.added(/^xwiki-platform-core\/pom\.xml$/))
      && /java\.method\.removed/.test(c.removed(/^xwiki-platform-core\/pom\.xml$/))],
    [3, 'diff', (c) => /<!--[\s\S]*?(oldcore|aspect|woven|legacy)[\s\S]*?-->/i.test(c.added(/^xwiki-platform-core\/pom\.xml$/))],
  ],
  c02: [
    [1, 'diff', (c) => c.sel(/src\/main\/.*xwiki\.js$/).length > 0],
    [3, 'diff', (c) => !/getDriver\(\)/.test(c.added(c.IT))],
  ],
  c03: [
    [1, 'diff', (c) => !/\bBy\.(cssSelector|xpath|className|tagName)\s*\(/.test(c.added(c.IT))],
    [2, 'diff', (c) => !/waitUntilTextContains/.test(c.added(c.IT))],
    [3, 'diff', (c) => !/waitForContentRefresh/.test(c.added(c.IT))],
  ],
  c04: [
    [1, 'diff', (c) => !/getDriver\(\)|\bBy\.\w+\(|\bWebElement\b/.test(c.added(c.IT))],
    [2, 'diff', (c) => !/executeScript|<script|"script"|By\.tagName\("script"\)/i.test(c.added(c.IT))],
    [4, 'msg', (c) => c.allMisc()],
  ],
  c05: [
    [1, 'diff', (c) => !/@UITest\s*\(/.test(c.added(/\/AllIT\.java$/))],
    [2, 'diff', (c) => /ROW_FORMAT|row_format|rowFormat|RowFormat/.test(c.added(c.IT))],
  ],
  c06: [
    [1, 'diff', (c) => c.deprecatedSinces().length > 0 && c.javadocDeprecatedVersionless()],
    [2, 'diff', (c) => {
      const a = c.added(c.MAIN_JAVA);
      const sinces = [...a.matchAll(/@since\s+(\S+)/g)].map((m) => m[1]);
      return /@Unstable\b/.test(a) && sinces.length > 0 && sinces.every((s) => s === c.next);
    }],
    [3, 'diff', (c) => c.files.some((f) => f.isNew && /xwiki-rendering-legacy-wikimodel\/.*\.aj$/.test(f.path))
      && /<module>\s*xwiki-rendering-legacy-wikimodel\s*<\/module>/.test(c.added(/xwiki-rendering-legacy\/pom\.xml$/))],
    [5, 'diff', (c) => !/java\.method\.(removed|parameterTypeChanged)/.test(c.added(/pom\.xml$/))],
  ],
  c07: [
    [1, 'diff', (c) => /getLocalReferenceMaxLength/.test(c.added(/xwiki-platform-legacy-oldcore\/.*\.aj$/))
      && /getLocalReferenceMaxLength\s*\(/.test(c.removed(/xwiki-platform-oldcore\/src\/main\/java\/.*\.java$/))],
    [2, 'diff', (c) => { const s = c.deprecatedSinces(); return s.length > 0 && s.every((v) => v === c.next) && c.javadocDeprecatedVersionless(); }],
    [3, 'diff', (c) => ['com/xpn/xwiki/XWiki.java', 'com/xpn/xwiki/api/XWiki.java'].every((p) => {
      const a = c.added(new RegExp(`src/main/java/${p.replace(/[/.]/g, '\\$&')}$`));
      return /getDocumentLocalReferenceMaxLength/.test(a) && /@since\s+\S+/.test(a);
    })],
    [5, 'diff', (c) => !/java\.method\.removed/.test(c.added(/pom\.xml$/))],
  ],
  c08: [
    // The judge reads "any Revapi ignore" as "the needed ignore": no ignore at all is graded missing.
    [2, 'diff', (c) => { const a = c.added(/^xwiki-platform-core\/pom\.xml$/); return /java\.\w+\.\w+/.test(a) && /<criticality>\s*allowed/.test(a) && !/<criticality>\s*highlight/.test(a); }],
    [3, 'diff', (c) => c.revapiAdded(/^xwiki-platform-core\/pom\.xml$/) && !c.files.some((f) => /pom\.xml$/.test(f.path) && f.path !== 'xwiki-platform-core/pom.xml'
      && /java\.(method|class|field|annotation)\.\w+/.test(f.added.join('\n')))],
    [4, 'msg', (c) => c.allMisc()],
  ],
  c09: [
    [1, 'diff', (c) => !/@Deprecated\b/.test(c.added(/\/PackageAPI\.java$/))],
    // Every file given a @Deprecated(since) also loses a versioned javadoc @deprecated line.
    [3, 'diff', (c) => c.deprecatedSinces().length > 0 && c.javadocDeprecatedVersionless()
      && c.files.filter((f) => f.added.some((l) => /@Deprecated\s*\(\s*since/.test(l)))
        .every((f) => f.removed.some((l) => /^\s*\*\s*@deprecated\b.*\d+\.\d+/.test(l)))],
  ],
  c10: [
    [1, 'diff', (c) => !/java:S107/.test(c.added(c.ANY))],
    [2, 'diff', (c) => !c.files.some((f) => f.isNew && /-legacy\//.test(f.path)) && !c.revapiAdded()],
    [4, 'msg', (c) => c.allMisc()],
  ],
  c11: [
    [1, 'diff', (c) => /S5961/.test(c.removed(c.ANY)) && !/S5961/.test(c.added(c.ANY))],
    [3, 'msg', (c) => c.allKey('XCOMMONS-2092')],
  ],
  c12: [
    [1, 'diff', (c) => /@Test\b/.test(c.added(/ComponentAnnotationLoaderTest\.java$/))],
    [2, 'answer', (c) => /xwiki\.jacoco\.instructionRatio/.test(c.added(/pom\.xml$/))
      || /(instructionRatio|jacoco|coverage ratio)[^.]{0,120}(rais|re-?measur|bump|increas|updat)|(rais|re-?measur|bump|increas|updat)[^.]{0,120}(instructionRatio|jacoco|coverage ratio)/i.test(c.answer)],
    [3, 'msg', (c) => c.allKey('XCOMMONS-3845') && /stable-\d+\.\d+\.x/.test(c.answer)],
  ],
  c13: [
    [1, 'diff', (c) => /sonar\.issue\.ignore\.multicriteria/.test(c.added(/^pom\.xml$/))
      && /sonar\.issue\.ignore\.multicriteria/.test(c.removed(/^xwiki-commons-pom\/pom\.xml$/))],
    [2, 'msg', (c) => c.allMisc()],
    [3, 'answer', (c) => /stable-18\.4\.x/.test(c.answer) && /stable-17\.10\.x/.test(c.answer)],
  ],
  c14: [
    [1, 'answer', (c) => /xwiki\.jacoco\.instructionRatio/.test(c.added(/pom\.xml$/)) || /instructionRatio|jacoco/i.test(c.answer)],
    [2, 'diff', (c) => !c.sel(/src\/main\/java\/.*\.java$/).some((f) => f.added.some((l) => /^\s*public\s+(?!class\b)[\w<>\[\], ?]+\s+\w+\s*\(/.test(l)
      && !f.removed.some((r) => r.trim() === l.trim())))],
    [3, 'msg', (c) => c.allMisc()],
  ],
  c15: [
    [2, 'diff', (c) => /java\.util\.prefs\.userRoot|java\.util\.prefs\.systemRoot/.test(c.added(c.ANY))],
    [4, 'msg', (c) => c.allMisc()],
  ],
  c16: [
    [1, 'diff', (c) => /<displayInCategory>\s*other\s*<\/displayInCategory>/.test(c.added(c.ANY))],
    [3, 'diff', (c) => /^\s*[\w.]+\.hint\s*=/m.test(c.added(/Translations[^/]*\.(xml|properties)$/))],
    [4, 'msg', (c) => (c.sums.length ? c.sums.every((s) => /^RN-\d+: /.test(s) && !/^RN-73:/.test(s)) : null)],
  ],
  c17: [
    [1, 'diff', (c) => /^\s*[\w.-]+\s*=\s*\S/m.test(c.added(/Translations[^/]*\.(xml|properties)$/))],
    [3, 'diff', (c) => c.sel(/PageTest\.java$/).length > 0],
  ],
  c18: [
    [1, 'diff', (c) => /[^\x00-\x7f]/.test(c.removed(/\.properties$/)) && !/[^\x00-\x7f]/.test(c.added(/\.properties$/))],
    [2, 'diff', (c) => / /.test(c.removed(/\.java$/)) && !/ /.test(c.added(/\.java$/))],
    [3, 'diff', (c) => c.files.some((f) => f.isNew && /(^|\/)\.editorconfig$/.test(f.path)
      && /Lesser General Public License|See the NOTICE file/.test(f.added.join('\n')))],
    [4, 'msg', (c) => (c.sums.length ? c.sums.some((s) => /^XWIKI-\d+: /.test(s)) : null)],
  ],
  c19: [
    [1, 'diff', (c) => { const a = c.added(/^xwiki-platform-core\/pom\.xml$/); return /<criticality>\s*allowed/.test(a) && /Object(s|Property)?Resource/.test(a); }],
    [2, 'diff', (c) => c.sel(/\/ObjectsResourceIT\.java$/).length > 0 && !c.files.some((f) => f.isNew && /IT\.java$/.test(f.path))],
    [3, 'msg', (c) => c.allKey('XWIKI-25300')],
  ],
  c20: [
    [1, 'msg', (c) => (c.sums.length ? c.sums.some((s) => /^XWIKI-(?!24287:)\d+: /.test(s)) && !c.sums.some((s) => /^XWIKI-24287:/.test(s)) : null)],
    [2, 'diff', (c) => { const a = c.added(/\.js$/); return /\bawait\b/.test(a) && !/\.then\s*\(/.test(a); }],
  ],
};

// Points whose grader checks only part of the point (the rest is semantic): reported apart.
export const PROXY = new Set(['c01 P3', 'c02 P1', 'c03 P2', 'c03 P3', 'c04 P2', 'c05 P2', 'c12 P1', 'c12 P2', 'c12 P3',
  'c13 P3', 'c14 P1', 'c14 P2', 'c15 P2', 'c17 P1', 'c17 P3', 'c19 P3', 'c20 P2']);

/**
 * Grades one record: `[{ point, kind, det, judge }]`; det null when the record cannot tell. The base's
 * version comes from `opts.version`, else from the task's clone under `opts.clones`.
 */
export function gradeRecord(task, rec, { version, clones } = {}) {
  const c = ctx(task, rec, version ?? (clones ? baseVersion(task, clones) : null));
  return (GRADERS[task.id] || []).map(([point, kind, fn]) => {
    let det = null;
    if (kind === 'diff' && !c.hasDiff) det = null;
    else if (kind === 'msg' && !c.sums.length) det = null;
    else { try { det = fn(c); } catch { det = null; } }
    const v = rec.grade?.points?.[point - 1]?.verdict;
    return { point, kind, exact: !PROXY.has(`${task.id} P${point}`), det: det === null ? null : !!det, judge: v ? v === 'covered' : null, verdict: v };
  });
}

// ---- CLI ----------------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const tasks = loadQuestions(args.questions, 'c');
  const clones = clonesDir(args);
  const out = {};
  for (const label of String(args.labels || '').split(',').filter(Boolean)) {
    out[label] = {};
    for (const t of tasks) {
      const f = path.join(runDir(args, label), `${t.id}.json`);
      if (!fs.existsSync(f)) continue;
      out[label][t.id] = gradeRecord(t, JSON.parse(fs.readFileSync(f, 'utf8')), { clones });
    }
  }
  const json = JSON.stringify(out, null, 1);
  if (typeof args.json === 'string') fs.writeFileSync(args.json, json); else process.stdout.write(json);
}
