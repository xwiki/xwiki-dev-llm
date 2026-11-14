// Runs benchmark questions/tasks through headless Claude Code with one plugin version.
// Usage: node run.mjs --label <name> --questions a,b[,c,d] [--plugin <xwiki plugin dir>] [--out <dir>]
//          [--clones <dir>] [--model sonnet] [--concurrency 4] [--only a01,b03] [--code-dir <dir>]
// Groups a/b/d run in a stub repo (an xwiki-remote repo, so the plugin's SessionStart hook injects);
// group c runs each task in its own throwaway repo holding only the task's base (task-repo.mjs),
// with the whole repo writable from the task's cwd, and records the diff of everything it produced.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { claudeStream, pool } from './claude.mjs';
import { clonesDir, evalDir, kbDirOf, loadQuestions, outRoot, parseArgs, pluginDir as pluginDirOf, runDir, taskClone } from './common.mjs';
import { makeTaskRepo, sessionResult } from './task-repo.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.label || !args.questions) {
  console.error('usage: node run.mjs --label <name> --questions a,b,c,d [--plugin dir] [--out dir] [--clones dir] [--model sonnet] [--only a01]');
  process.exit(2);
}
const pluginDir = pluginDirOf(args);
const label = args.label;
const model = args.model || 'sonnet';
const only = args.only ? new Set(args.only.split(',')) : null;
const out = outRoot(args);
const outDir = runDir(args);
fs.mkdirSync(outDir, { recursive: true });

const items = loadQuestions(args.questions)
  .filter(q => !only || only.has(q.id))
  .filter(q => !fs.existsSync(path.join(outDir, `${q.id}.json`))); // resumable

// v2 plugins inject KB pointers from a UserPromptSubmit hook; stream-json does not carry hook output,
// so each session writes a --debug-file and the injected pointer ids go into the record as
// `hook_pointers`. Ids are matched against the plugin's own KB index (longest `file#section` prefix).
const kbSearch = path.join(pluginDir, 'scripts', 'kb-search.mjs');
const kbIds = fs.existsSync(kbSearch)
  ? (await import(pathToFileURL(kbSearch).href)).loadIndex(kbDirOf(pluginDir), { cacheDir: null }).sections
    .map(s => `${s.file}#${s.section}`).sort((x, y) => y.length - x.length)
  : null;
const debugDir = path.join(outDir, '_debug');
if (kbIds) fs.mkdirSync(debugDir, { recursive: true });

function hookPointers(debugFile) {
  let text = null;
  try {
    for (const line of fs.readFileSync(debugFile, 'utf8').split('\n')) {
      const i = line.indexOf('Hooks: Parsed initial response: ');
      if (i < 0) continue;
      const o = JSON.parse(line.slice(i + 'Hooks: Parsed initial response: '.length));
      if (o.hookSpecificOutput?.hookEventName === 'UserPromptSubmit') { text = o.hookSpecificOutput.additionalContext || ''; break; }
    }
  } catch { return null; }
  if (text === null) return [];
  return pointerIds(text);
}

// The pointer ids of an injected block: `skill:<name>` for a `[skill]` line (`[skill] load <name>` in
// older plugins), the KB id for any other `[tag]` line; header lines are skipped.
function pointerIds(text) {
  return text.split('\n').filter(l => /^\[[^\]]*\] /.test(l)).map(l => {
    const s = /^\[skill\] (?:load )?(\S+)/.exec(l);
    if (s) return `skill:${s[1]}`;
    l = l.replace(/^\[[^\]]*\] /, '');
    return kbIds.find(id => l.startsWith(id)) || `?${l.slice(0, 80)}`;
  });
}

// The edit hook's pointers (PreToolUse additionalContext starting "XWiki KB pointers"), one entry
// per injection: { subject, ids }.
function editPointers(debugFile) {
  const out = [];
  try {
    for (const line of fs.readFileSync(debugFile, 'utf8').split('\n')) {
      const i = line.indexOf('Hooks: Parsed initial response: ');
      if (i < 0) continue;
      let o;
      try { o = JSON.parse(line.slice(i + 'Hooks: Parsed initial response: '.length)); } catch { continue; }
      const t = o.hookSpecificOutput?.additionalContext || '';
      if (o.hookSpecificOutput?.hookEventName !== 'PreToolUse'
        || !(t.startsWith('XWiki KB pointers') || t.startsWith('Before going further, load'))) continue;
      out.push({ subject: (/^XWiki KB pointers for (\S+)/m.exec(t) || [])[1] || null, ids: pointerIds(t) });
    }
  } catch { return null; }
  return out;
}

// The benchmark measures the KB, so the web is closed: an answer fetched live from xwiki.org would
// score the network, not the knowledge base. Maven is closed too (task diffs are judged, not built).
// Git network commands are closed too: the fix exists upstream, after the task's base.
const disallowed = ['WebFetch', 'WebSearch', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(mvn:*)', 'Bash(gh:*)', 'Bash(git push:*)',
  'Bash(git fetch:*)', 'Bash(git pull:*)', 'Bash(git clone:*)', 'Bash(git ls-remote:*)'];

function okfTouches(events) {
  const touches = [];
  for (const e of events) {
    if (e.type !== 'assistant') continue;
    for (const c of e.message?.content || []) {
      if (c.type !== 'tool_use') continue;
      const s = JSON.stringify(c.input);
      const m = s.match(/(?:okf|kb)\/[A-Za-z0-9_\-/]+\.md/g);
      if (c.name === 'Skill') touches.push({ tool: 'Skill', target: c.input.skill || c.input.command });
      if (m) for (const f of new Set(m)) touches.push({ tool: c.name, target: f });
    }
  }
  return touches;
}

// The text of a tool_use's result (a denial's reason).
function toolResultText(events, id) {
  for (const e of events) {
    if (e.type !== 'user') continue;
    for (const c of e.message?.content || []) {
      if (c.type === 'tool_result' && c.tool_use_id === id) {
        return typeof c.content === 'string' ? c.content : (c.content || []).map(x => x.text || '').join(' ');
      }
    }
  }
  return '';
}

function summarize(events) {
  const result = events.find(e => e.type === 'result');
  const u = result.usage || {};
  return {
    answer: result.result,
    is_error: result.is_error,
    num_turns: result.num_turns,
    duration_ms: result.duration_ms,
    cost_usd: result.total_cost_usd,
    tokens: {
      input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      output: u.output_tokens || 0,
    },
    tool_calls: events.filter(e => e.type === 'assistant')
      .flatMap(e => (e.message?.content || []).filter(c => c.type === 'tool_use').map(c => c.name)),
    tool_inputs: events.filter(e => e.type === 'assistant')
      .flatMap(e => (e.message?.content || []).filter(c => c.type === 'tool_use').map(c => `${c.name} ${JSON.stringify(c.input).slice(0, 200)}`)),
    okf_touches: okfTouches(events),
    permission_denials: (result.permission_denials || []).map(d => ({ tool: d.tool_name, input: d.tool_input,
      reason: toolResultText(events, d.tool_use_id).slice(0, 300) })),
  };
}

// The stub repo of groups a/b/d: an xwiki-platform origin and a root pom with a fixed dev version.
function stubRepo() {
  const dir = path.join(out, 'repo-stub');
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pom.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.xwiki.platform</groupId>
  <artifactId>xwiki-platform</artifactId>
  <version>18.10.0-SNAPSHOT</version>
  <packaging>pom</packaging>
</project>
`);
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('remote', 'add', 'origin', 'https://github.com/xwiki/xwiki-platform.git');
  }
  return dir;
}

// What a session must not read: the questions with their gold, past results, and the group (c)
// clones, which hold the real fix after each task's base.
const hidden = [path.join(evalDir, 'questions'), path.join(out, 'runs'), path.join(out, 'recall'), clonesDir(args)];

await pool(items, Number(args.concurrency || 4), async q => {
  const started = Date.now();
  try {
    // --code-dir <dir>: groups a/b/d/e run in <dir>/xwiki-platform instead of the stub, with every other
    // repo under <dir> readable too (the "agent with the code" condition).
    let cwd = q.group === 'c' ? null : args['code-dir'] ? path.join(path.resolve(args['code-dir']), 'xwiki-platform') : stubRepo();
    let repo = null;
    let base = null;
    if (q.group === 'c') {
      // The task's base is fetched into the clone when the clone lacks it.
      repo = path.join(out, 'task-repos', `${label}-${q.id}`);
      fs.mkdirSync(path.dirname(repo), { recursive: true });
      base = makeTaskRepo(taskClone(args, q).dir, q.base, repo);
      cwd = q.cwd ? path.join(repo, q.cwd) : repo;
    }
    const debugFile = kbIds && path.join(debugDir, `${q.id}.log`);
    // `--debug-file` appends: a retried task (lost result event) would otherwise count the failed
    // attempt's hook injections too.
    if (debugFile) fs.rmSync(debugFile, { force: true });
    // Group c sessions work like a developer's: any shell command, compound or scripted, in the task
    // repo and a per-task scratch dir (the plugin's work directory and TMPDIR). bypassPermissions
    // removes the prompts (denied in -p) that compound `cd … && git commit` and `$VAR` commands
    // trigger even when allowed; the OS sandbox confines Bash writes to those two dirs and closes the
    // network; tools/write-guard.mjs does the same for the file tools, which the sandbox does not
    // cover; the deny rules still apply in that mode and keep the questions and results unread.
    const scratch = repo && `${repo}.scratch`;
    let env, permArgs;
    if (repo) {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.mkdirSync(path.join(scratch, 'work'), { recursive: true });
      fs.mkdirSync(path.join(scratch, 'tmp'), { recursive: true });
      env = { XWIKI_LLM_WORK: path.join(scratch, 'work'), TMPDIR: path.join(scratch, 'tmp'),
        BENCH_WRITE_ROOTS: [repo, scratch].join(path.delimiter) };
      const settings = {
        sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
          filesystem: { allowWrite: [repo, scratch], denyRead: hidden } },
        permissions: { deny: [...disallowed, ...hidden.map(d => `Read(/${d}/**)`)] },
        hooks: { PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit',
          hooks: [{ type: 'command', command: `node ${JSON.stringify(path.join(evalDir, 'tools', 'write-guard.mjs'))}` }] }] },
      };
      permArgs = ['--add-dir', repo, '--add-dir', scratch, '--settings', JSON.stringify(settings),
        '--permission-mode', 'bypassPermissions', '--disallowedTools', ...disallowed];
    } else {
      const codeDirs = args['code-dir'] ? fs.readdirSync(path.resolve(args['code-dir'])).map(d => path.join(path.resolve(args['code-dir']), d))
        .filter(d => d !== cwd && fs.statSync(d).isDirectory()).flatMap(d => ['--add-dir', d]) : [];
      permArgs = [...codeDirs, '--disallowedTools', ...disallowed, ...hidden.map(d => `Read(/${d}/**)`), '--permission-mode', 'default',
        '--allowedTools', 'Read', 'Grep', 'Glob', 'Skill', 'Bash(git:*)', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cd:*)',
        'Bash(cat:*)', 'Bash(grep:*)', 'Bash(find:*)', 'Bash(sed:*)', 'Bash(head:*)'];
    }
    const streamFile = path.join(outDir, `_stream-${q.id}.jsonl`);
    const events = await claudeStream(q.group === "c" ? `${q.task}\n\n(Environment: Maven, the network and GitHub are unavailable here, so you cannot build or run tests. Make the complete change anyway, as you would before building, and commit it.)` : q.question, {
      cwd, model, pluginDir, env, streamFile,
      // The permission scope is the cwd; a task that starts in a module may still need to edit the
      // rest of its repo (poms, legacy modules, page objects), so the repo root is added to it.
      extraArgs: [...(debugFile ? ['--debug-file', debugFile] : []), '--add-dir', pluginDir, ...permArgs],
    });
    if (!process.env.BENCH_KEEP_STREAM) fs.rmSync(streamFile, { force: true });
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    // An errored session (usage limit, API error) is not a sample: fail it, so a later pass retries it.
    const result = events.find(e => e.type === 'result');
    if (result.is_error) {
      if (repo) fs.rmSync(repo, { recursive: true, force: true });
      throw new Error(`session error: ${String(result.result).slice(0, 200)}`);
    }
    const rec = { id: q.id, group: q.group, label, model, ...summarize(events) };
    if (debugFile) rec.hook_pointers = hookPointers(debugFile);
    if (debugFile) rec.edit_pointers = editPointers(debugFile);
    if (repo) {
      // Diff against the base, across the working tree, HEAD and every local branch, so neither a
      // commit, a branch switch nor a new branch loses work. Commit messages are kept for the
      // commit-format checklist points.
      Object.assign(rec, sessionResult(repo, base));
      fs.rmSync(repo, { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(outDir, `${q.id}.json`), JSON.stringify(rec, null, 2));
    console.error(`${q.id} done in ${Math.round((Date.now() - started) / 1000)}s, ${rec.tokens.input} in-tokens, okf: ${rec.okf_touches.map(t => t.target).join(' ') || '-'}`);
  } catch (e) {
    const kept = path.join(outDir, `_stream-${q.id}.jsonl`);
    if (fs.existsSync(kept)) fs.renameSync(kept, path.join(outDir, `_stream-${q.id}-failed-${Date.now()}.jsonl`));
    console.error(`${q.id} FAILED: ${e.message}`);
  }
});
