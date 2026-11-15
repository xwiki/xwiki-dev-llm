// The "agent with the code" condition (run.mjs --code-dir): the code clones a session may read, and the
// isolation that makes its score measure the KB rather than something else left in reach.
// Usage: node code-dir.mjs <dir> [--strip]
//   Lists the agent instruction files (CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/) in the clones of
//   <dir>, and removes them with --strip. Exits 1 while any is left, 2 when <dir> is not a valid code dir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './common.mjs';

/** The repos a session with the code reads: xwiki-platform (its cwd) and, when present, its two upstreams. */
export const CODE_REPOS = ['xwiki-platform', 'xwiki-commons', 'xwiki-rendering'];

const AGENT_FILES = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude']);

const within = (a, b) => a === b || a.startsWith(b + path.sep);

/**
 * The clones of `dir` a session gets, xwiki-platform first, as paths under `dir` (the session's cwd keeps
 * `dir` as its parent, whatever a symlink points at). Refuses a dir without
 * xwiki-platform, and any clone or dir that holds, or sits inside, the checkout `self` (default: the one
 * running the tool): its eval/ data states the facts being measured.
 */
export function codeRepos(dir, self = repoRoot) {
  const real = (p) => fs.realpathSync(p);
  const me = real(self);
  const root = path.resolve(dir);
  if (within(real(root), me) || within(me, real(root))) throw new Error(`${dir}: holds or is inside ${me}, whose eval/ data a session must not read`);
  if (!fs.existsSync(path.join(root, 'xwiki-platform'))) throw new Error(`${dir}: no xwiki-platform clone`);
  const repos = CODE_REPOS.map((r) => path.join(root, r)).filter((p) => fs.existsSync(p));
  for (const r of repos) {
    if (within(real(r), me) || within(me, real(r))) throw new Error(`${r}: holds or is inside ${me}, whose eval/ data a session must not read`);
  }
  return repos;
}

/** The agent instruction files and directories anywhere in `repos` (.git and node_modules skipped). */
export function agentFiles(repos) {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (AGENT_FILES.has(e.name)) found.push(path.join(d, e.name));
      else if (e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules') walk(path.join(d, e.name));
    }
  };
  repos.forEach(walk);
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [dir, flag] = process.argv.slice(2);
  let repos;
  try {
    repos = codeRepos(dir);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  let found = agentFiles(repos);
  if (flag === '--strip') {
    found.forEach((f) => fs.rmSync(f, { recursive: true, force: true }));
    console.log(found.map((f) => `removed ${f}`).join('\n'));
    found = agentFiles(repos);
  }
  if (found.length) {
    console.error(`agent instruction files in the code clones (remove them, or pass --strip):\n${found.join('\n')}`);
    process.exit(1);
  }
  console.log(`isolated: ${repos.join(', ')}`);
}
