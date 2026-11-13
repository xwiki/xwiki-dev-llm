// Shared headless-Claude helpers for the benchmark tools.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs `claude -p` and resolves with the parsed `--output-format json` envelope.
// opts: { cwd, model, pluginDir, tools, jsonSchema, extraArgs, timeoutMs }
export function claudeJson(prompt, opts = {}) {
  const args = ['-p', prompt, '--output-format', 'json', '--no-session-persistence',
    '--setting-sources', '', '--strict-mcp-config', '--model', opts.model || 'sonnet'];
  if (opts.pluginDir) args.push('--plugin-dir', opts.pluginDir);
  if (opts.tools !== undefined) args.push('--tools', opts.tools);
  if (opts.jsonSchema) args.push('--json-schema', JSON.stringify(opts.jsonSchema));
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: opts.cwd || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs || 15 * 60 * 1000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`claude exited ${code}: ${err.slice(0, 500)} ${out.slice(0, 500)}`)); }
    });
  });
}

// Runs `claude -p --output-format stream-json` and resolves with all parsed events (for tool-call traces).
// stdout goes to a file (opts.streamFile, else a temp file), not a pipe: a file write is synchronous,
// so nothing claude has written can be lost however its process exits; the file is kept when no
// `result` event is found, for diagnosis. opts.env is merged over process.env.
export function claudeStream(prompt, opts = {}) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--setting-sources', '', '--strict-mcp-config', '--model', opts.model || 'sonnet'];
  if (opts.pluginDir) args.push('--plugin-dir', opts.pluginDir);
  if (opts.tools !== undefined) args.push('--tools', opts.tools);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  const streamFile = opts.streamFile || path.join(os.tmpdir(), `claude-stream-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(streamFile, 'w');
    const child = spawn('claude', args, { cwd: opts.cwd || process.cwd(), stdio: ['ignore', fd, 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : process.env });
    fs.closeSync(fd);
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs || 20 * 60 * 1000);
    child.stderr.on('data', d => { err += d; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const out = fs.readFileSync(streamFile, 'utf8');
      const lines = out.split('\n').filter(Boolean);
      let bad = 0;
      const events = lines.flatMap(l => { try { return [JSON.parse(l)]; } catch { bad++; return []; } });
      if (!events.some(e => e.type === 'result')) {
        const last = events.at(-1);
        return reject(new Error(`claude exited ${code}${signal ? ' ' + signal : ''}: no result event (${out.length} bytes, ${events.length} events, ${bad} unparsable lines, last event ${last?.type}/${last?.subtype || ''}; stream kept in ${streamFile}) ${err.slice(0, 500)}`));
      }
      if (!opts.streamFile) fs.rmSync(streamFile, { force: true });
      resolve(events);
    });
  });
}

// Runs async tasks with bounded concurrency.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}
