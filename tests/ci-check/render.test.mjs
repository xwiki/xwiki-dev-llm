// What the paste and the digest say about a row, from the 2026-10-18 morning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaOf, missingLine, renderDetail, stateLine } from '../../xwiki/skills/xwiki-ci-check/tools/lib/render.mjs';

const XWIKI_25242 = { key: 'XWIKI-25242', resolution: 'Fixed', fixVersions: ['17.10.14', '18.9.0-rc-1', '18.4.7'] };

test("a closed issue's fix that skips a maintenance line is pointed out", () => {
  assert.equal(missingLine(XWIKI_25242, 'stable-18.8.x'), '18.8.x');
  assert.equal(missingLine(XWIKI_25242, 'stable-18.4.x'), null);
  assert.equal(missingLine(XWIKI_25242, 'master'), null);
  assert.equal(missingLine({ ...XWIKI_25242, resolution: 'Cannot Reproduce' }, 'stable-18.8.x'), null);
});

const TOGGLE = { id: 'platform/master/org.xwiki.realtime.wiki.test.ui.AllIT$NestedRealtimeWikiEditorIT#toggleRealtimeWithSelf',
  repo: 'xwiki-platform', branch: 'master', class: 1, kind: 'test-breakage', state: 'systematic', primary: true };

test('an answer that lapsed reads as words, not as field values', () => {
  const claimed = { ...TOGGLE, fixState: { kind: 'being-handled' } };
  const delta = deltaOf({ incidents: [TOGGLE], jobs: [] },
    { available: true, at: '2026-10-17T06:00:00Z', state: { [TOGGLE.id]: stateLine(claimed) } });
  assert.deepEqual(delta.changed[0].moved, ['no longer claimed in the room']);
});

const STALE = { id: 'platform/master/org.xwiki.rest.test.ObjectsResourceIT#testDELETEObject', repo: 'xwiki-platform',
  branch: 'master', class: 1, kind: 'test-breakage', state: 'systematic', primary: true, testCount: 4,
  fixState: { kind: 'stale-snapshot', sha: '953ad3d45e', author: 'vmassol', where: 'pushed 36 hours before', reason: 'r' } };
const OLD = { id: 'platform/stable-18.8.x/org.xwiki.test.security.ExtensionSecurityTest#checkForExtensionSecurityScanResult',
  repo: 'xwiki-platform', branch: 'stable-18.8.x', class: 1, kind: 'flicker', state: 'single env', primary: true,
  beyondHorizon: true, jiraClosed: XWIKI_25242 };
const DEEP = { ...TOGGLE, deep: true, silent: true };
const page = renderDetail({ generatedAt: '2026-10-18T06:00:00Z', horizonDays: 7, budget: 5,
  summary: { jobs: 20, red: 8, incidents: 3 }, jobs: [], incidents: [DEEP, STALE, OLD] }, { live: true });

test('a stale snapshot is explained by its answer, not by "fails every run"', () => {
  assert.match(page, /ObjectsResourceIT#testDELETEObject.*\| new test code ran against older production jars/);
});

test('a long-standing flicker whose fix skipped this line still names the backport', () => {
  assert.match(page, /someone → backport XWIKI-25242's fix to 18\.8\.x/);
});

test('the footer counts each incident once', () => {
  assert.match(page, /A culprit candidate for 1 of the 1 analysed\*\*\. Not analysed: \*\*1\*\* already answered, \*\*1\*\* older/);
  assert.match(page, /\*\*0\*\* below the deep budget/);
});
