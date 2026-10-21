// One morning, one story: the digest, the paste and the commit comment agreeing with each other
// (2026-10-21: a reproduced culprit left uncommented, one cause both a flicker and a breakage, a
// Matrix "no owner found" over a paste naming one, a test both green and red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameBuildPeer } from '../../xwiki/skills/xwiki-ci-check/tools/lib/blame.mjs';
import { oneKindPerCause } from '../../xwiki/skills/xwiki-ci-check/tools/lib/sweep.mjs';
import { renderDetail, renderDigest, stateLine } from '../../xwiki/skills/xwiki-ci-check/tools/lib/render.mjs';

const BREAK = { id: 'platform/master/main:Build/maven:xwiki-platform-rendering-macro-context', repo: 'xwiki-platform',
  branch: 'master', class: 2, kind: 'build-break', state: 'build-break', primary: true, deep: true,
  firstBadBuild: 9045, lastGoodBuild: null, ageDays: 0, ageIsLowerBound: true };
const TEST = { id: 'platform/master/org.xwiki.rendering.macro.context.IntegrationTests#renderingTests',
  repo: 'xwiki-platform', branch: 'master', class: 1, kind: 'test-breakage', state: 'single env', primary: true,
  deep: true, firstBadBuild: 9045, lastGoodBuild: 9044,
  provable: { repo: 'xwiki-platform', state: 'single env', suspects: [{ sha: '2b79fb7b154b', author: 'surli' }] } };
const jobOf = () => 'main';

test('a break with no green build borrows the window of the test that first failed in the same build', () => {
  assert.equal(sameBuildPeer(BREAK, [BREAK, TEST], jobOf), TEST);
  assert.equal(sameBuildPeer(BREAK, [BREAK, { ...TEST, firstBadBuild: 9043 }], jobOf), null);
  assert.equal(sameBuildPeer(BREAK, [BREAK, { ...TEST, provable: null }], jobOf), null);
  assert.equal(sameBuildPeer({ ...BREAK, lastGoodBuild: 9044 }, [BREAK, TEST], jobOf), null);
});

test('one cause is a breakage on every branch once one branch says so', () => {
  const master = { kind: 'flicker' };
  const stable = { kind: 'test-breakage' };
  oneKindPerCause([master, stable]);
  assert.equal(master.kind, 'test-breakage');
  const flickers = [{ kind: 'flicker' }, { kind: 'flicker' }];
  oneKindPerCause(flickers);
  assert.deepEqual(flickers.map(incident => incident.kind), ['flicker', 'flicker']);
});

const SIDE = { id: 'platform/master/org.xwiki.blocknote.test.ui.AllIT$NestedSideMenuIT#sideMenuIsAlignedOnCaptionedImage',
  repo: 'xwiki-platform', branch: 'master', class: 1, kind: 'test-breakage', state: 'intermittent', primary: true,
  deep: true, ageDays: 0 };
const LIVEDATA = 'org.xwiki.livedata.test.ui.LiveDataIT#livedataLivetableTableLayoutWithCustomClass';
const OPEN = { id: `platform/stable-18.9.x/${LIVEDATA}`, repo: 'xwiki-platform', branch: 'stable-18.9.x', class: 1,
  kind: 'flicker', state: 'intermittent', primary: true, ageDays: 2 };
const order = { generatedAt: '2026-10-21T06:00:00Z', horizonDays: 7, budget: 5,
  summary: { jobs: 16, red: 6, incidents: 3 }, jobs: [], incidents: [BREAK, SIDE, OPEN] };
const digest = renderDigest(order, { available: true, at: '2026-10-20T06:00:00Z', state: {
  [`platform/master/${LIVEDATA}`]: stateLine(OPEN), [OPEN.id]: stateLine(OPEN) } });

test("a deep row's owner is the run's to fill, from the paste's Next", () => {
  assert.match(digest, new RegExp(`<!-- DONE: ${SIDE.id.replace(/[$.]/g, '\\$&')} -->`));
  assert.doesNotMatch(digest, /no owner found/);
});

test('an age that is only "at least today" is not printed as ≥0d', () => {
  assert.doesNotMatch(digest, /≥0d/);
  assert.match(digest, /age unknown/);
});

test('a test gone green on one branch says where it is still red', () => {
  assert.match(digest, /✅ \| platform\/master \| `LiveDataIT#livedataLivetableTableLayoutWithCustomClass` \(still red on 18\.9\.x\)/);
});

test('whoever said in the room they were looking at it is the one to ask', () => {
  const tag = { id: 'platform/stable-18.9.x/org.xwiki.tag.test.ui.AllIT$NestedTagIT#tagCloudListsNestedAndTerminalTags',
    repo: 'xwiki-platform', branch: 'stable-18.9.x', class: 1, kind: 'flicker', state: 'intermittent', primary: true,
    ageDays: 1, chat: [{ at: '2026-10-20T08:37:00Z', sender: '@mhamann:matrix.xwiki.com', said: "I'm checking it",
      permalink: 'https://matrix.to/#/x' }] };
  const page = renderDetail({ ...order, summary: { jobs: 1, red: 1, incidents: 1 }, incidents: [tag] }, { live: true });
  assert.match(page, /mhamann → said in the room on 2026-10-20 they were looking at it: ask first<br>nobody → not proven yet/);
});
