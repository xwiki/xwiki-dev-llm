// Which commit of a window a failure points at, and how sure that is. The commits are the real
// window of master's 2026-10-17 lint breaks, cut to what blame reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribute, blameKeys } from '../../xwiki/skills/xwiki-ci-check/tools/lib/blame.mjs';
import { BOT_LOGIN } from '../../xwiki/skills/xwiki-ci-check/tools/lib/github.mjs';

const NODE = 'xwiki-platform-core/xwiki-platform-node/src/main/node';
const commit = (short, author, title, files) => ({ sha: `${short}${'0'.repeat(30)}`, short, author, title, files });
const WINDOW = [
  commit('c7c967b3e0', 'manuelleduc', 'XWIKI-25311: Upgrade blocknote to 0.56.0', [`${NODE}/editors/blocknote/codeBlock.ts`]),
  commit('b565ea607d', 'manuelleduc', 'XWIKI-25312: Enable the promise/prefer-await-to-then ESLint rule', [
    `${NODE}/core/livedata/livedata-ui/src/components/panels/LivedataAdvancedPanelSort.vue`,
    `${NODE}/tools/tool-eslintconfig/src/index.ts`]),
  commit('953ad3d45e', 'vmassol', 'XWIKI-25300: Allow setting the version comment', ['xwiki-platform-core/rest/ObjectResource.java'])
];

test('the only commit touching the file the failure names is certain', () => {
  const blame = attribute({ class: 2, file: '/w/LivedataAdvancedPanelSort.vue', evidence: [] }, WINDOW);
  assert.equal(blame.tier, 'certain');
  assert.equal(blame.culprit.short, 'b565ea607d');
});

test('a module two commits touched is ambiguous, whoever pushed them', () => {
  const blame = attribute({ class: 2, signature: 'maven:xwiki-platform-node',
    evidence: ['[ERROR]   mvn <args> -rf :xwiki-platform-node'] }, WINDOW);
  assert.equal(blame.tier, 'ambiguous');
  assert.equal(blame.culprit, undefined);
});

test('an ESLint rule named in a commit subject points at it when its file changed in no commit', () => {
  const incident = { class: 2, file: '/w/src/l10n.ts', evidence: [
    '[INFO] /w/src/l10n.ts',
    '[INFO]    77:12  error  Prefer await to then()/catch()/finally()  promise/prefer-await-to-then'] };
  assert.deepEqual(blameKeys(incident).words, ['promise/prefer-await-to-then']);
  const blame = attribute(incident, WINDOW);
  assert.equal(blame.tier, 'likely');
  assert.equal(blame.culprit.short, 'b565ea607d');
});

test('prettier is not a rule anybody enables in a subject', () => {
  const incident = { class: 2, file: '/w/A.vue', evidence: ['[INFO]   1:1  error  Replace `x` with `y`  prettier/prettier'] };
  assert.deepEqual(blameKeys(incident).words, []);
});

test('the routine\'s own bot is never a suspect', () => {
  assert.ok(BOT_LOGIN.test('xwikiorg-llm-bot'));
  assert.ok(BOT_LOGIN.test('dependabot[bot]'));
  assert.ok(!BOT_LOGIN.test('manuelleduc'));
});
