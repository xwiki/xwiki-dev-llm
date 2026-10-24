// What the paste and the digest say about a row, from the 2026-10-18 morning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaOf, missingLine, renderDetail, renderDigest, stateLine, xmlLimitProperty } from '../../xwiki/skills/xwiki-ci-check/tools/lib/render.mjs';

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
  assert.match(page, /\*\*0\*\* left once the deep budget/);
});

// 2026-10-19: "18.9.0-rc-1 unreleased — comment; reopening is a human's call" was the run's
// instruction, printed in two rows' headings.
test("a closed issue's unreleased fix is stated, not the run's instruction about it", () => {
  const order = { generatedAt: '2026-10-19T06:00:00Z', horizonDays: 7, budget: 5, summary: { jobs: 1, red: 1, incidents: 1 },
    jobs: [], incidents: [{ ...OLD, jiraClosed: { ...XWIKI_25242, unreleased: ['18.9.0-rc-1'] } }] };
  const rendered = renderDetail(order, { live: true });
  assert.match(rendered, /18\.9\.0-rc-1 unreleased/);
  assert.doesNotMatch(rendered, /reopening/);
});

// 2026-10-19: master's eslint break outlived the log budget; its window must still end at a green build.
test('a break older than the log budget says the builds before were not read', () => {
  const ESLINT = { id: 'platform/master/main:Build/eslint:l10n.ts', repo: 'xwiki-platform', branch: 'master', class: 2,
    kind: 'build-break', state: 'build-break', primary: true, deep: true, firstBadBuild: 9036, lastGoodBuild: 9030,
    unreadBack: true, ageDays: 0, ageIsLowerBound: true };
  const rendered = renderDetail({ generatedAt: '2026-10-19T06:00:00Z', horizonDays: 7, budget: 5,
    summary: { jobs: 1, red: 1, incidents: 1 }, jobs: [], incidents: [ESLINT] }, { live: true });
  assert.match(rendered, /failing back to #9036 at least; the broken builds before it were not read, and #9030 is the last that completed/);
});

// ---- 2026-10-24 -------------------------------------------------------------------------------
const order24 = incidents => ({ generatedAt: '2026-10-24T06:00:00Z', horizonDays: 7, budget: 5,
  summary: { jobs: 1, red: 1, incidents: incidents.length }, jobs: [], incidents });
const NOBODY_YESTERDAY = { available: true, at: '2026-10-23T06:00:00Z', state: {} };

test('the JAXP limit to raise is named, from the message or from its code', () => {
  // master #9059: the limit came from jaxp.properties, so only the code says which one it is.
  assert.equal(xmlLimitProperty(['… JAXP00010004: The accumulated size of entities is "100,001" that exceeded the'
    + ' "100,000" limit set by "jaxp.properties".']), 'jdk.xml.totalEntitySizeLimit');
  assert.equal(xmlLimitProperty(['JAXP00010003: The length of entity "[xml]" is "100,001" that exceeds the "100,000"'
    + ' limit set by "jdk.xml.maxGeneralEntitySizeLimit".']), 'jdk.xml.maxGeneralEntitySizeLimit');
  assert.equal(xmlLimitProperty([]), null);
  const JAXP = { id: 'platform/master/main:jenkins-xml-limit', repo: 'xwiki-platform', branch: 'master', class: 3,
    kind: 'infra', state: 'infra', signature: 'main:jenkins-xml-limit', primary: true, ageDays: 1,
    evidence: ['MavenPipelineException: … JAXP00010004: The accumulated size of entities is "100,001" …'] };
  const page = renderDetail(order24([JAXP]), { live: true });
  assert.match(page, /raise `jdk\.xml\.totalEntitySizeLimit` in the controller's JVM options/);
  // Named by its pattern, not by its kind: row 4 read `infra`.
  assert.match(page, /\*\*1\.\*\* `jenkins-xml-limit`/);
});

const DRAG = { id: 'platform/master/org.xwiki.realtime.wysiwyg.test.ui.AllIT$NestedRealtimeWYSIWYGEditorIT'
  + '#dragAndDropFilesAtTheSameTime', repo: 'xwiki-platform', branch: 'master', class: 1, kind: 'test-breakage',
  state: 'first seen', primary: true, ageDays: 0, ageIsLowerBound: true, jira: 'XWIKI-22619',
  fixState: { kind: 'fix-in-flight', number: 6687, url: 'https://github.com/xwiki/xwiki-platform/pull/6687', author: 'michitux',
    title: 'XWIKI-22643: Documents can be saved at the same time', where: 'it changes FileUploader' },
  develocity: { failures: 55, runs: 667, windowDays: 28, firstSeen: '2026-09-27', firstSeenDays: 27, news: 'known' } };

test('a failure Develocity saw weeks ago is aged from it, not new, and keeps its issue on Matrix', () => {
  const digest = renderDigest(order24([DRAG]), NOBODY_YESTERDAY);
  const row = digest.split('\n').find(line => line.includes('dragAndDropFilesAtTheSameTime'));
  assert.match(row, /^\| 🔁/);
  // At the edge of Develocity's 28 days, so a lower bound.
  assert.match(row, /\| ≥27d \|/);
  assert.match(renderDigest(order24([{ ...DRAG, develocity: { ...DRAG.develocity, firstSeenDays: 12 } }]),
    NOBODY_YESTERDAY), /\| 12d \|/);
  assert.match(row, /fix in flight: \[PR #6687\].* · tracked: \[XWIKI-22619\]/);
  assert.doesNotMatch(renderDetail(order24([DRAG]), { live: true }), /age unknown/);
  // Develocity's first failure today is still new.
  const fresh = { ...DRAG, develocity: { ...DRAG.develocity, firstSeenDays: 0, news: 'new' } };
  assert.match(renderDigest(order24([fresh]), NOBODY_YESTERDAY), /\| 🆕/);
});

test('what went green is said in words, and a JUnit engine reporting itself is not a test', () => {
  const previous = { available: true, at: '2026-10-23T06:00:00Z', state: {
    'platform/master/main:Build/maven:xwiki-platform-activeinstalls2-api': 'build-break/build-break//',
    'platform/stable-18.4.x/main:Build/unclassified:java.util.LinkedHashMap$Entry': 'unclassified/unclassified//',
    'platform/master/JUnit Jupiter#JUnit Jupiter': 'test-breakage/first seen//',
    'platform/master/org.xwiki.dashboard.test.ui.DashboardIT#editDashboard': 'flicker/intermittent//' } };
  const green = renderDigest(order24([]), previous).split('\n').find(line => line.startsWith('| ✅'));
  assert.match(green, /the build of `xwiki-platform-activeinstalls2-api`/);
  assert.match(green, /an unexplained build failure \(`java\.util\.LinkedHashMap\$Entry`\)/);
  assert.match(green, /`DashboardIT#editDashboard`/);
  assert.doesNotMatch(green, /JUnit Jupiter|maven:|unclassified:/);
});

test('a test failing in one environment, but not in every build, says so', () => {
  const single = { ...TOGGLE, kind: 'flicker', state: 'single env', failedIn: '2/6 builds, 1/1 envs', jira: 'XWIKI-23305' };
  const page = renderDetail(order24([single]), { live: true });
  assert.match(page, /one environment, not every build · 2\/6 builds/);
});
