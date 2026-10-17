// Where a commit comment may go: the tool's culprit, or one the run proved among its suspects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusal } from '../../xwiki/skills/xwiki-ci-check/tools/commit-comment.mjs';

const ID = 'platform/master/main:Build/eslint:LivedataAdvancedPanelSort.vue';
const B565 = 'b565ea607d46745e0be0efd1e9505f6d66f2d5c8';
const workOrder = { incidents: [{ id: ID, provable: { repo: 'xwiki-platform', state: 'build-break', suspects: [
  { sha: 'c7c967b3e0118dcbd4ca4e73517003ba4fc49cb2', author: 'manuelleduc' },
  { sha: B565, author: 'manuelleduc' }] } }] };
const WHY = 'LivedataAdvancedPanelSort.vue:197 is a line this commit rewrote in reorderSorts';

test('a culprit the tool did not pick needs a proof', () => {
  assert.match(refusal(workOrder, { incident: ID, sha: 'b565ea607d' }), /needs --proof/);
  assert.match(refusal(workOrder, { incident: ID, sha: 'b565ea607d', proof: 'guess', why: WHY }), /needs --proof/);
  assert.match(refusal(workOrder, { incident: ID, sha: 'b565ea607d', proof: 'in-diff', why: 'it did' }), /--why/);
});

test('a proof picks among the suspects, never outside the window', () => {
  assert.match(refusal(workOrder, { incident: ID, sha: 'f221ce14b7', proof: 'in-diff', why: WHY }), /not one of/);
});

test('a proven suspect may be commented on', () => {
  assert.equal(refusal(workOrder, { incident: ID, sha: 'b565ea607d', proof: 'in-diff', why: WHY }), null);
});
