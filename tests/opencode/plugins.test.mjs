// The opencode plugins import the hook scripts for their exported checks. opencode runs them in its
// compiled Bun binary, whose argv[1] is a virtual path realpath cannot resolve: a script that throws on
// it at import time leaves its plugin with no hooks, and the guard silently does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  };
  for (const [file, hooks] of Object.entries(expected)) {
    const plugin = (await import(pathToFileURL(join(HOME, 'xwiki', 'opencode', 'plugins', file)).href)).default;
    const registered = await plugin.server({ directory: HOME });
    assert.deepEqual(Object.keys(registered).sort(), hooks.sort(), file);
  }
});
