// Locations and argument parsing shared by the benchmark tools. Every location is an option or derived
// from one: nothing here names a machine path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workRoot } from '../../xwiki/scripts/state-dir.mjs';

/** The eval/ directory (questions/, tools/) and the repo holding it. */
export const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.dirname(evalDir);

/** `--name value` pairs into an object; a flag with no value is `true`. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : (i++, next);
  }
  return args;
}

/**
 * Where runs, recall reports, task repos and the group (c) clones go: `--out`, else a directory under
 * the plugin's work root — outside the repo, so results never land in a commit.
 */
export function outRoot(args) {
  return path.resolve(args.out || path.join(workRoot(), 'xwiki-dev-llm', 'eval'));
}

/** One run's records (`<id>.json`) and `_scoreboard.json`. */
export function runDir(args, label = args.label) {
  return path.join(outRoot(args), 'runs', label);
}

/** The plugin under test: `--plugin`, else this checkout's xwiki/. */
export function pluginDir(args) {
  return path.resolve(args.plugin || path.join(repoRoot, 'xwiki'));
}

/** A plugin's knowledge base: kb/, or okf/ in a snapshot older than the rename. */
export function kbDirOf(plugin) {
  const kb = path.join(plugin, 'kb');
  return fs.existsSync(kb) ? kb : path.join(plugin, 'okf');
}

/** The question files: `--questions a,b` (paths, or bare group names resolved in eval/questions/). */
export function questionFiles(spec, fallback = 'a') {
  return String(spec || fallback).split(',').filter(Boolean).map((f) =>
    /[\\/.]/.test(f) ? path.resolve(f) : path.join(evalDir, 'questions', `${f}.json`));
}

export function loadQuestions(spec, fallback) {
  return questionFiles(spec, fallback).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}

/**
 * The ids of group (e) questions with no `gold.reference`: their reference is the page text, never a KB
 * section, so judging them without it would grade against nothing.
 */
export function missingReferences(questions) {
  return questions.filter((q) => q.group === 'e' && !q.gold?.reference).map((q) => q.id);
}

/** The directory holding one clone per group (c) repo, named as the task's `repo`. */
export function clonesDir(args) {
  return path.resolve(args.clones || path.join(outRoot(args), 'clones'));
}

/** A task's repo name (`xwiki-platform` when unset) and the clone it is built from. */
export function taskClone(args, task) {
  const repo = task.repo || 'xwiki-platform';
  return { repo, dir: path.join(clonesDir(args), repo) };
}

/** The GitHub URL of a group (c) repo: the xwiki org for XWiki Standard's repos, xwiki-contrib otherwise. */
export function cloneUrl(repo) {
  return `https://github.com/${/^xwiki-(commons|rendering|platform)$/.test(repo) ? 'xwiki' : 'xwiki-contrib'}/${repo}.git`;
}
