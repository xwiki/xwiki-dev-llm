// How failing tests become incidents. The traces are real: 2026-10-24, when WebDriverManager could
// not resolve a driver for any legacy suite on any branch, and the sweep reported it as four
// "breakage" incidents — one of them folded into an unrelated RealtimeWYSIWYGEditorIT failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rootCauseOf } from '../../xwiki/scripts/jenkins.mjs';
import { flickerLookup } from '../../xwiki/scripts/jira-flickers.mjs';
import { breakageGroups } from '../../xwiki/skills/xwiki-ci-check/tools/lib/sweep.mjs';
import { renderDigest } from '../../xwiki/skills/xwiki-ci-check/tools/lib/render.mjs';
import { causeKey } from '../../xwiki/skills/xwiki-ci-check/tools/lib/util.mjs';

const MCE = 'org.apache.hc.core5.http.MessageConstraintException: Maximum line length limit exceeded';
// stable-18.4.x #278, `org.xwiki.filter.test.ui.AllIT`: the suite's own message says nothing.
const PO_SUITE = ['java.lang.RuntimeException: Failed to initialize PO suite',
  '\tat org.xwiki.test.ui.PageObjectSuite.run(PageObjectSuite.java:107)',
  'Caused by: io.github.bonigarcia.wdm.config.WebDriverManagerException: ' + MCE,
  '\tat io.github.bonigarcia.wdm.WebDriverManager.handleException(WebDriverManager.java:1544)',
  '\tat org.xwiki.test.ui.WebDriverFactory.createWebDriver(WebDriverFactory.java:54)',
  `Caused by: ${MCE}`,
  '\tat org.apache.hc.core5.http.impl.io.SessionInputBufferImpl.readLine(SessionInputBufferImpl.java:291)'].join('\n');

test('the root cause is the last link of the chain, and an assertion has none', () => {
  assert.equal(rootCauseOf(PO_SUITE), MCE);
  assert.equal(rootCauseOf('org.opentest4j.AssertionFailedError: expected: <true> but was: <false>\n\tat x(X.java:1)'), null);
  assert.equal(rootCauseOf(null), null);
});

const window = (job, number) => ({ job, firstBad: { number, timestamp: number } });
const entry = (id, cause, firstBad = 1413) => ({ id, row: { cause }, window: window('env-tests', firstBad) });
const upgrade = version => entry(`org.xwiki.test.ui.Upgrade${version}Test#initializationError`, MCE);

test('tests of several classes sharing a root cause are one group, apart from what failed in the same build', () => {
  const realtime = entry('org.xwiki.realtime.wysiwyg.test.ui.AllIT$NestedRealtimeWYSIWYGEditorIT#dragAndDropFilesAtTheSameTime', null);
  const groups = breakageGroups([realtime, upgrade(1510), upgrade(1610), upgrade(1710)]);
  assert.equal(groups.length, 2);
  const byCause = groups.find(group => group.rootCause);
  assert.equal(byCause.rootCause, MCE);
  assert.equal(byCause.entries.length, 3);
  assert.deepEqual(groups.find(group => !group.rootCause).entries, [realtime]);
});

test('a test whose environment never came up is infra, and takes no other test with it', () => {
  const skin = { ...entry('org.xwiki.skin.test.ui.SkinVisualIT#initializationError', 'org.xwiki.job.JobException: …'),
    row: { cause: 'org.xwiki.job.JobException: …',
      detail: 'Error setting up the XWiki testing environment on agent [a19-003o8zkqsohie]' } };
  const realtime = entry('org.xwiki.realtime.wysiwyg.test.ui.AllIT$NestedRealtimeWYSIWYGEditorIT#dragAndDropFilesAtTheSameTime', null);
  const groups = breakageGroups([skin, realtime]);
  assert.deepEqual(groups.map(group => [group.infra, group.entries.length]), [['agent-environment', 1], [null, 1]]);
});

test('a cause shared across jobs and first failing builds is still one group', () => {
  const groups = breakageGroups([upgrade(1011), entry('org.xwiki.cluster.test.AllIT#', MCE, 278),
    { ...entry('org.xwiki.filter.test.ui.AllIT#', MCE, 276), window: window('main', 276) }]);
  assert.equal(groups.length, 1);
});

test('a chained exception of one class, or of two tests, is no cause to group by', () => {
  const sameClass = ['a', 'b', 'c'].map(method => entry(`org.xwiki.FooIT#${method}`, MCE, 10 + method.length));
  assert.equal(breakageGroups(sameClass).every(group => !group.rootCause), true);
  assert.equal(breakageGroups([upgrade(84), upgrade(911)]).every(group => !group.rootCause), true);
});

test('one root cause on three branches is one cause, whatever its tests are called there', () => {
  const on = (branch, test) => ({ id: `platform/${branch}/${test}`, repo: 'xwiki-platform', rootCause: MCE });
  assert.equal(causeKey(on('master', 'org.xwiki.test.ui.Upgrade1110Test#initializationError')),
    causeKey(on('stable-18.4.x', 'org.xwiki.test.ui.Upgrade1011Test#')));
  // Without a shared root cause, the signature is the cause, as before.
  assert.notEqual(causeKey({ ...on('master', 'a.B#c'), rootCause: undefined }),
    causeKey({ ...on('master', 'a.B#d'), rootCause: undefined }));
});

test('a cause-grouped row is named by its cause, not by the test that sorts first', () => {
  const incident = { id: 'platform/stable-18.4.x/org.xwiki.test.ui.Upgrade1011Test#', repo: 'xwiki-platform',
    branch: 'stable-18.4.x', class: 1, kind: 'test-breakage', state: 'first seen', testCount: 21, rootCause: MCE,
    primary: true, ageDays: 0, ageIsLowerBound: true };
  const digest = renderDigest({ generatedAt: '2026-10-24T06:00:00Z', jobs: [], incidents: [incident] },
    { available: true, at: '2026-10-23T06:00:00Z', state: {} });
  assert.match(digest, /`MessageConstraintException: Maximum line length limit exceeded` breakage, 21 tests/);
  assert.doesNotMatch(digest, /Upgrade1011Test/);
});

test('a class-level failure is not "tracked" by every issue naming its class', () => {
  const lookup = flickerLookup([{ key: 'XWIKI-25301', fields: {
    summary: 'AllIT$NestedMacroIT#macroWithParameters is flickering', status: { name: 'Open' } } }]);
  assert.equal(lookup('org.xwiki.cluster.test.AllIT#'), null);
  assert.equal(lookup('org.xwiki.rendering.test.ui.AllIT$NestedMacroIT#macroWithParameters')?.key, 'XWIKI-25301');
});
