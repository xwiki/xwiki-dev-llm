// The opencode plugins import the hook scripts for their exported checks. opencode runs them in its
// compiled Bun binary, whose argv[1] is a virtual path realpath cannot resolve: a script that throws on
// it at import time leaves its plugin with no hooks, and the guard silently does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { invokedDirectly } from '../../xwiki/scripts/invoked-directly.mjs';

const HOME = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUNFS_ARGV1 = '/$bunfs/root/src/index.js';

test('a virtual argv[1] reads as imported, not as a throw', () => {
  assert.equal(invokedDirectly(import.meta.url, BUNFS_ARGV1), false);
  assert.equal(invokedDirectly(import.meta.url, fileURLToPath(import.meta.url)), true);
});

test('every opencode plugin registers its hooks under the opencode binary argv', async () => {
  process.argv[1] = BUNFS_ARGV1;
  process.env.XWIKI_LLM_HOME = HOME;
  const expected = {
    'xwiki-commit-text.js': ['tool.execute.before'],
    'xwiki-commit-gates.js': ['tool.execute.before', 'tool.execute.after'],
    'xwiki-line-endings.js': ['tool.execute.after'],
    'xwiki-kb-pointers.js': ['chat.message', 'tool.execute.after'],
  };
  for (const [file, hooks] of Object.entries(expected)) {
    const plugin = (await import(pathToFileURL(join(HOME, 'xwiki', 'opencode', 'plugins', file)).href)).default;
    const registered = await plugin.server({ directory: HOME });
    assert.deepEqual(Object.keys(registered).sort(), hooks.sort(), file);
  }
});

test('the line-ending guard reads the file from the args opencode 1.x passes after the call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-eol-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  writeFileSync(join(dir, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(dir, 'notes.txt'), 'alpha\r\nbeta\r\n');
  process.env.XWIKI_LLM_HOME = HOME;
  const plugin = (await import(pathToFileURL(join(HOME, 'xwiki', 'opencode', 'plugins', 'xwiki-line-endings.js')).href)).default;
  const hooks = await plugin.server({ directory: dir });
  const filePath = join(dir, 'notes.txt');
  // The shape opencode 1.18 hands tool.execute.after: args on input, the tool result as output.
  await assert.rejects(
    hooks['tool.execute.after']({ tool: 'edit', sessionID: 's', callID: 'c', args: { filePath } },
      { title: 'notes.txt', metadata: {}, output: 'Edit applied successfully.' }),
    /Line-ending mismatch/);
});
