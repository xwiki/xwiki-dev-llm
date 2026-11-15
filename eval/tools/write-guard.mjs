// PreToolUse hook for benchmark sessions: denies a file-tool write (Write/Edit/MultiEdit/NotebookEdit)
// outside the roots in BENCH_WRITE_ROOTS (path.delimiter-separated). Sessions run in
// bypassPermissions mode, where Bash is confined by the OS sandbox but the file tools are not.
import fs from 'node:fs';
import path from 'node:path';

const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
// The target may not exist yet: resolve its nearest existing ancestor.
function realTarget(p) {
  let dir = p, rest = [];
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) { rest.unshift(path.basename(dir)); dir = path.dirname(dir); }
  return path.join(real(dir), ...rest);
}

const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const p = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (p) {
  const target = realTarget(path.resolve(input.cwd || process.cwd(), p));
  const roots = (process.env.BENCH_WRITE_ROOTS || '').split(path.delimiter).filter(Boolean).map(real);
  if (!roots.some(r => target === r || target.startsWith(r + path.sep))) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `Writes are limited to ${roots.join(', ')} in this environment.` } }));
  }
}
