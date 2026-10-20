// What counts as somebody taking a failure in the room. The sentences are the ones that were
// misread in the live room before the first-person rule (xwiki/xwiki-dev-llm#309).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimedPart, isClaim } from '../../xwiki/skills/xwiki-ci-check/tools/lib/room.mjs';

test('a first-person sentence taking the failure is a claim', () => {
  assert.ok(isClaim('`RealtimeWikiEditorIT#toggleRealtimeWithSelf` I\'m taking care'));
  assert.ok(isClaim('I\'m on it'));
  assert.ok(isClaim('I\'ll fix it'));
  assert.ok(isClaim('I am looking into CollaborationIT'));
});

test('an offer, a report, a question or somebody else is not', () => {
  assert.ok(!isClaim('I know you\'re working on it'));
  assert.ok(!isClaim('let me know and I\'ll handle the backport'));
  assert.ok(!isClaim('should I look at it?'));
  assert.ok(!isClaim('I\'ve opened a PR for the leftovers'));
});

test('a claim covers its own sentence, not the tests mentioned beside it', () => {
  const { names } = claimedPart('ImageIT: I\'m on it. There\'s also CollaborationIT, but it\'s a known flicker');
  assert.deepEqual(names.tests, ['ImageIT']);
});

test('a claim naming nothing is about the message\'s subject, only when it has exactly one', () => {
  assert.deepEqual(claimedPart('XWIKI-123 fails again. I\'m on it.').names.jira, ['XWIKI-123']);
  assert.equal(claimedPart('ImageIT and LinkIT fail again. I\'m on it.'), null);
});
