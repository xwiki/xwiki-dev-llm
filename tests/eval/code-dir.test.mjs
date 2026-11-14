// The "agent with the code" condition: only the three code clones, never this checkout, and no agent
// instruction file in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentFiles, codeRepos } from '../../eval/tools/code-dir.mjs';

const layout = () => {
  const home = mkdtempSync(join(tmpdir(), 'eval-code-'));
  for (const r of ['xwiki-dev-llm/eval', 'xwiki-platform/core', 'xwiki-commons', 'xwiki-rendering', 'other']) mkdirSync(join(home, r), { recursive: true });
  return home;
};

test('the session gets xwiki-platform and its two upstreams, nothing else in the dir', () => {
  const home = layout();
  const code = join(home, 'code');
  mkdirSync(code);
  for (const r of ['xwiki-platform', 'xwiki-commons', 'xwiki-rendering', 'other']) symlinkSync(join(home, r), join(code, r));
  assert.deepEqual(codeRepos(code, join(home, 'xwiki-dev-llm')), ['xwiki-platform', 'xwiki-commons', 'xwiki-rendering'].map((r) => join(code, r)));
});

test('a dir holding this checkout, or inside it, or without xwiki-platform is refused', () => {
  const home = layout();
  const self = join(home, 'xwiki-dev-llm');
  assert.throws(() => codeRepos(home, self), /holds or is inside/);
  assert.throws(() => codeRepos(join(self, 'eval'), self), /holds or is inside/);
  const code = join(home, 'code');
  mkdirSync(code);
  symlinkSync(self, join(code, 'xwiki-platform'));
  assert.throws(() => codeRepos(code, self), /holds or is inside/);
  assert.throws(() => codeRepos(join(home, 'other'), self), /no xwiki-platform clone/);
});

test('agent instruction files anywhere in the clones are found, outside .git', () => {
  const home = layout();
  writeFileSync(join(home, 'xwiki-platform', 'core', 'AGENTS.md'), '');
  mkdirSync(join(home, 'xwiki-commons', '.claude'));
  mkdirSync(join(home, 'xwiki-rendering', '.git'));
  writeFileSync(join(home, 'xwiki-rendering', '.git', 'CLAUDE.md'), '');
  assert.deepEqual(agentFiles(['xwiki-platform', 'xwiki-commons', 'xwiki-rendering'].map((r) => join(home, r))).sort(),
    [join(home, 'xwiki-commons', '.claude'), join(home, 'xwiki-platform', 'core', 'AGENTS.md')]);
});
