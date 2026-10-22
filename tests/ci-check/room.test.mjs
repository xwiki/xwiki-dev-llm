// What counts as somebody taking a failure in the room. The sentences are the ones that were
// misread in the live room before the first-person rule (xwiki/xwiki-dev-llm#309).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimedPart, excerptFor, isClaim } from '../../xwiki/skills/xwiki-ci-check/tools/lib/room.mjs';

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

// vmassol, 2026-10-21 11:23: two pings in one message. The 2026-10-22 paste quoted the first 200
// characters (the macro-context break) under SideMenuIT, and called the room unrelated.
test('a quote is the paragraph that names the incident', () => {
  const body = 'Simon Urli master is still red because of the `xwiki-platform-rendering-macro-context` build break'
    + ' (since 2b79fb7b, XWIKI-25420: `AsyncRendererCache` now injects `WikiDescriptorManager`). The fix PR is ready.'
    + '\n\nMarius Dumitru Florea `SideMenuIT` (7 alignment tests) has been failing on master and 18.9.x since'
    + ' XWIKI-25404 with tiny screenshot diffs.\n\nJust a heads up as you might be working on it already. Thx';
  const sideMenu = { tests: ['org.xwiki.blocknote.test.ui.AllIT$NestedSideMenuIT#sideMenuIsAlignedOnCaptionedImage'] };
  assert.match(excerptFor(body, sideMenu), /^Marius Dumitru Florea `SideMenuIT`/);
  // Nothing named in any one paragraph: the message's start, as before.
  assert.match(excerptFor(body, { tests: ['org.xwiki.Foo#bar'] }), /^Simon Urli master/);
});
