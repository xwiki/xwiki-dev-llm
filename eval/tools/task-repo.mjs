// Per-task repo isolation for group (c), shared by run.mjs and its check (`node task-repo.mjs --check`).
//
// A task's session gets a fresh repo holding only `base` and its ancestors: a new `git init` that
// fetches the one commit from the task's clone through upload-pack (which packs only the objects
// reachable from it — no hardlinked pack, no alternates), checked out detached, with no branch, tag,
// remote ref or FETCH_HEAD. The real fix (the task's `source`) and any branch a past session left in
// the clone are therefore unreachable. `origin` keeps a `github.com/<org>/<repo>` path, so the
// plugin's SessionStart hook still scopes it in, but on a host that never resolves, and has no push URL.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cloneUrl, parseArgs, outRoot, taskClone, loadQuestions } from './common.mjs';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();

export function makeTaskRepo(clone, base, dir) {
  clone = path.resolve(clone);
  if (!fs.existsSync(clone)) {
    throw new Error(`no clone at ${clone}: git clone ${cloneUrl(path.basename(clone))} ${clone}`);
  }
  let sha;
  try { sha = sh(clone, 'rev-parse', '--verify', `${base}^{commit}`); }
  catch { sh(clone, 'fetch', '-q', 'origin', base); sha = sh(clone, 'rev-parse', '--verify', `${base}^{commit}`); }
  fs.rmSync(dir, { recursive: true, force: true });
  sh(path.dirname(dir), 'init', '-q', dir);
  sh(dir, 'fetch', '-q', '--no-tags', '--upload-pack', 'git -c uploadpack.allowAnySHA1InWant=true upload-pack', clone, sha);
  sh(dir, 'checkout', '-q', '--detach', sha);
  fs.rmSync(path.join(dir, '.git', 'FETCH_HEAD'), { force: true });
  const upstream = sh(clone, 'remote', 'get-url', 'origin'); // https://github.com/<org>/<repo>.git
  const slug = (/github\.com[:/](.+)$/.exec(upstream) || [])[1] || path.basename(clone);
  sh(dir, 'remote', 'add', 'origin', `https://bench.invalid/github.com/${slug}`);
  sh(dir, 'config', 'remote.origin.pushurl', 'DISABLED-bench-no-push');
  sh(dir, 'config', 'user.name', 'XWiki Bench');
  sh(dir, 'config', 'user.email', 'bench@example.invalid');
  return sha;
}

// What the session produced: the working tree (index included) as a commit on top of HEAD, plus every
// local branch tip, minus the tips that are already ancestors of another one. A branch switch or a new
// branch therefore never drops work; each remaining tip is diffed from `base`.
export function sessionResult(dir, base) {
  sh(dir, 'add', '-A');
  const head = sh(dir, 'rev-parse', 'HEAD');
  const tree = sh(dir, 'write-tree');
  const work = tree === sh(dir, 'rev-parse', 'HEAD^{tree}') ? head
    : sh(dir, 'commit-tree', tree, '-p', head, '-m', '(uncommitted changes at session end)');
  const named = new Map([[work, 'HEAD']]);
  for (const l of sh(dir, 'for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads').split('\n').filter(Boolean)) {
    const [s, n] = l.split(' ');
    if (!named.has(s)) named.set(s, n);
  }
  const anc = (a, b) => { try { sh(dir, 'merge-base', '--is-ancestor', a, b); return true; } catch { return false; } };
  const tips = [...named.keys()].filter(t => t !== base && ![...named.keys()].some(o => o !== t && anc(t, o)));
  const commits = tips.length
    ? sh(dir, 'log', '--reverse', '--format=%B%n----', ...tips, `^${base}`).replace(/\(uncommitted changes at session end\)\n+----\n?/g, '')
    : '';
  const diffs = tips.map(t => ({ tip: named.get(t), diff: sh(dir, 'diff', base, t) + '\n' }));
  return {
    tips: diffs.map(d => d.tip),
    commits,
    diff: diffs.length === 1 ? diffs[0].diff : diffs.map(d => `### session tip: ${d.tip}\n${d.diff}`).join('\n'),
  };
}

// `node task-repo.mjs --check [--questions c] [--only c07,c12] [--out dir] [--clones dir]`: builds every
// task's repo and checks that it holds exactly the ancestors of base, no ref, no source commit, and no
// usable push remote.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv.includes('--check')) {
  const args = parseArgs(process.argv.slice(2));
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
  const tasks = loadQuestions(args.questions, 'c').filter(q => q.group === 'c' && (!only || only.has(q.id)));
  const reposDir = path.join(outRoot(args), 'task-repos');
  fs.mkdirSync(reposDir, { recursive: true });
  for (const q of tasks) {
    const clone = taskClone(args, q).dir;
    const dir = path.join(reposDir, `check-${q.id}`);
    const sha = makeTaskRepo(clone, q.base, dir);
    const problems = [];
    const refs = sh(dir, 'for-each-ref');
    if (refs) problems.push(`refs: ${refs}`);
    const all = Number(sh(dir, 'rev-list', '--count', '--all', 'HEAD'));
    const expected = Number(sh(clone, 'rev-list', '--count', sha));
    if (all !== expected) problems.push(`reachable ${all} != ancestors of base ${expected}`);
    const src = String(q.source || '').replace(/-.*$/, '');
    let srcInClone = null;
    try { srcInClone = sh(clone, 'rev-parse', '--verify', `${src}^{commit}`); } catch {}
    try { sh(dir, 'cat-file', '-e', `${srcInClone || src}^{commit}`); problems.push(`source ${src} present`); } catch {}
    if (sh(dir, 'log', '--all', '--format=%H').split('\n').some(h => h.startsWith(src))) problems.push('source in log --all');
    try { sh(dir, 'push', '--dry-run', 'origin', 'HEAD:refs/heads/x'); problems.push('push dry-run succeeded'); } catch {}
    console.log(`${q.id} base=${sha.slice(0, 10)} source=${src}${srcInClone ? ' (in clone)' : ''} commits=${all} ${problems.length ? 'FAIL ' + problems.join('; ') : 'ok'}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
