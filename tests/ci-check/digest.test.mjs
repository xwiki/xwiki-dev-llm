// What a morning says against the last digest, and how incidents are grouped before it says it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaOf, stateLine } from '../../xwiki/skills/xwiki-ci-check/tools/lib/render.mjs';
import { cofailing } from '../../xwiki/skills/xwiki-ci-check/tools/lib/sweep.mjs';

const BREAK = { id: 'platform/master/main:Build/eslint:l10n.ts', repo: 'xwiki-platform', branch: 'master', class: 2,
  kind: 'build-break', state: 'build-break', primary: true };
const FLICKER = { id: 'platform/master/org.xwiki.FooIT#bar', repo: 'xwiki-platform', branch: 'master', class: 1,
  kind: 'flicker', state: 'intermittent' };
const report = incidents => ({ incidents, jobs: [{ repo: 'xwiki-platform', branch: 'master', result: 'FAILURE' }] });
const yesterday = incidents => ({ available: true, at: '2026-10-16T06:00:00Z',
  state: Object.fromEntries(incidents.map(incident => [incident.id, stateLine(incident)])) });

test('a morning where nothing moved is silent', () => {
  const delta = deltaOf(report([FLICKER]), yesterday([FLICKER]));
  assert.equal(delta.silent, true);
});

test('a release blocker that has not moved keeps being said', () => {
  const delta = deltaOf(report([BREAK, FLICKER]), yesterday([BREAK, FLICKER]));
  assert.equal(delta.silent, false);
  assert.deepEqual(delta.stuck, [BREAK.id]);
});

const flicker = (method, builds, jira = null) => ({
  row: { perJob: [{ job: 'main', failedBuilds: builds.map(number => ({ number })) }] },
  incident: { id: `platform/stable-16.10.x/org.xwiki.test.ui.extension.ExtensionIT#${method}`,
    tests: [`org.xwiki.test.ui.extension.ExtensionIT#${method}`], evidence: ['timeout'], jira, jiraClosed: null }
});

test('flickers of one class failing in exactly the same builds are one incident, with all their issues', () => {
  const [group, alone] = cofailing([
    flicker('testInstall', [160, 162, 165, 167], { key: 'XWIKI-17831' }),
    flicker('testDowngrade', [160, 162, 165, 167], { key: 'XWIKI-24623' }),
    flicker('testUninstall', [162, 165, 167], { key: 'XWIKI-17146' })
  ]);
  assert.equal(group.cofailing, true);
  assert.equal(group.testCount, 2);
  assert.match(group.id, /#testDowngrade$/);
  assert.deepEqual(group.jiras.sort(), ['XWIKI-17831', 'XWIKI-24623']);
  assert.equal(alone.cofailing, undefined);
});

test('one shared failing build is a coincidence, not a group', () => {
  assert.equal(cofailing([flicker('a', [160]), flicker('b', [160])]).length, 2);
});
