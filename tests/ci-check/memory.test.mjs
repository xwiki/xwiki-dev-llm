// What a morning concluded, written into its paste and read back the next morning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBlock, memoryOf, recallable } from '../../xwiki/skills/xwiki-ci-check/tools/memory.mjs';

const ID = 'platform/master/main:Build/eslint:l10n.ts';
const PASTE = [
  '| What fails | Why | Next — who |',
  '|---|---|---|',
  '| **1.** `eslint:l10n.ts`<br>_build break · 0d_ | b565ea607d made promise/prefer-await-to-then an error \\| shared config '
    + '| manuelleduc → convert the three `.then()` chains<br>bot → fix PR |',
  '',
  '<details>',
  '<summary><b>1</b> · <code>eslint:l10n.ts</code> — the evidence, and the root cause</summary>',
  '',
  '```',
  '[INFO]    77:12  error  Prefer await to then()',
  '```',
  '',
  'The rule was enabled in tool-eslintconfig; l10n.ts was not linted while the build stopped earlier.',
  '',
  '</details>',
  ...memoryBlock('2026-10-17', new Map([[ID, 1]]),
    [{ id: ID, state: 'build-break/build-break//', analysedOn: '2026-10-17' }])
].join('\n');

test('the conclusions are read back from the cells and the root-cause paragraph', () => {
  const entry = memoryOf(PASTE)[ID];
  assert.equal(entry.state, 'build-break/build-break//');
  assert.equal(entry.why, 'b565ea607d made promise/prefer-await-to-then an error | shared config');
  assert.equal(entry.next, 'manuelleduc → convert the three `.then()` chains\nbot → fix PR');
  assert.match(entry.analysis, /^The rule was enabled/);
});

test('a paste without the block has no memory', () => {
  assert.deepEqual(memoryOf('# CI sweep\n\nnothing'), {});
});

test('a conclusion is recalled only for the same state, filled, and at most two days old', () => {
  const entry = memoryOf(PASTE)[ID];
  assert.ok(recallable(entry, 'build-break/build-break//', '2026-10-19'));
  assert.ok(!recallable(entry, 'build-break/build-break//', '2026-10-20'));
  assert.ok(!recallable(entry, 'test-breakage/systematic//', '2026-10-18'));
  assert.ok(!recallable({ ...entry, why: '<!-- WHY: x -->' }, 'build-break/build-break//', '2026-10-18'));
});
