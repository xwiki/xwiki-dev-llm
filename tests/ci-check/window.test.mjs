// Where a build break's window ends. On 2026-10-19 master's eslint break had outlived the log budget:
// no green build in its window, so no culprit, so no "already commented" — and the digest said
// "no owner found" over a commented commit and an open fix PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakWindow } from '../../xwiki/skills/xwiki-ci-check/tools/lib/sweep.mjs';

const build = (number, result) => ({ number, result, timestamp: Date.parse('2026-10-18T18:00:00Z') });
const BUILDS = [build(9039, 'FAILURE'), build(9038, 'FAILURE'), build(9037, 'FAILURE'), build(9030, 'SUCCESS')];
const JOB = { label: 'main', url: 'https://ci.xwiki.org/job/XWiki/job/xwiki-platform/job/master', builds: BUILDS };

test('a break older than the log budget still ends its window at the last completed build', async () => {
  // A budget of one log: the walk stops at #9038 without reading it, so no network is touched.
  const window = await breakWindow(JOB, BUILDS[0], 'eslint:l10n.ts', 1);
  assert.equal(window.firstBad.number, 9039);
  assert.equal(window.lastGood.number, 9030);
  assert.equal(window.atLeast, true);
  assert.equal(window.unread, true);
});
