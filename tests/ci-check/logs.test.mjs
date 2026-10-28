// What a red build's log is classified as. The lines are real: master build 9032 of xwiki-platform
// (2026-10-16), whose ESLint break was signed by the reactor's resume line until the eslint matcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alsoInfra, classify, diagnoseStages, eslintFile, keep } from '../../xwiki/skills/xwiki-ci-check/tools/lib/logs.mjs';

const at = key => `Build/${key}`;
const ROOT = '/root/workspace/XWiki_xwiki-platform_master/xwiki-platform-core/xwiki-platform-node/src/main/node';
const ESLINT_9032 = [
  '14:46:20,700 [INFO] > @xwiki/platform-livedata-ui@18.10.0-SNAPSHOT lint',
  `14:46:20,740 [INFO] ${ROOT}/core/livedata/livedata-ui/src/components/panels/LivedataAdvancedPanelSort.vue`,
  '14:46:20,740 [INFO]   197:32  error  Replace `⏎············e.moved.element.property,⏎············e.moved.newIndex,⏎········` '
    + 'with `e.moved.element.property,·e.moved.newIndex`  prettier/prettier',
  '14:46:20,741 [INFO] ',
  '14:46:20,741 [INFO] ✖ 1 problem (1 error, 0 warnings)',
  '14:47:55,980 [ERROR] Failed to execute goal com.github.eirslett:frontend-maven-plugin:2.0.2:pnpm (pnpm-lint) on project '
    + "xwiki-platform-node: Failed to run task: 'pnpm run lint' failed.",
  '14:47:55,990 [ERROR]   mvn <args> -rf :xwiki-platform-node'
];

const classified = lines => {
  const kept = keep(lines);
  return classify(kept, null, at, 'Build') || classify(kept, null, at, 'Build', { weak: true });
};

test('an ESLint error is signed by its file, not by the reactor resume line', () => {
  const result = classified(ESLINT_9032);
  assert.equal(result.signature, 'Build/eslint:LivedataAdvancedPanelSort.vue');
  assert.match(result.file, /LivedataAdvancedPanelSort\.vue$/);
  // The file line is quoted above its problem, which says what the problem is about.
  assert.match(result.evidence[0], /LivedataAdvancedPanelSort\.vue$/);
  assert.match(result.evidence[1], /197:32\s+error/);
});

test('the file of a problem is the path line above its run of problems', () => {
  const lines = [
    '[INFO] /src/l10n.ts',
    '[INFO]    77:12  error  Prefer await to then()/catch()/finally()  promise/prefer-await-to-then',
    '[INFO]    99:12  error  Prefer await to then()/catch()/finally()  promise/prefer-await-to-then'
  ];
  assert.equal(eslintFile(lines, 2), '/src/l10n.ts');
});

test('a bare [INFO] path line is not a break, and is not kept without a problem under it', () => {
  const lines = ['12:00:00,000 [INFO] /root/w/target/foo.js', '12:00:00,000 [INFO] done',
    '[ERROR]   mvn <args> -rf :xwiki-platform-node'];
  assert.deepEqual(keep(lines), ['[ERROR]   mvn <args> -rf :xwiki-platform-node']);
  assert.equal(classified(lines).signature, 'Build/maven:xwiki-platform-node');
});

test('TypeScript errors name their file in both of tsc\'s formats', () => {
  const rf = '[ERROR]   mvn <args> -rf :xwiki-platform-node';
  assert.equal(classified(['12:00:00,000 [INFO] src/components/Foo.vue(12,5): error TS2345: Argument', rf]).signature,
    'Build/tsc:Foo.vue:12');
  assert.equal(classified(['12:00:00,000 [INFO] src/bar.ts:7:3 - error TS2304: Cannot find name', rf]).signature,
    'Build/tsc:bar.ts:7');
});

test('a Java compile error keeps its file and line', () => {
  const result = classified(['[ERROR] /w/src/main/java/org/xwiki/Foo.java:[12,5] cannot find symbol']);
  assert.equal(result.signature, 'Build/compile:Foo.java:12');
  assert.equal(result.file, '/w/src/main/java/org/xwiki/Foo.java');
});

// master #9049 (2026-10-21): every step of "Build for TestRelease" passed and only the stage's own
// error said why it failed. Reported as "no error line, the next build settles it"; it recurs.
test('the withMaven XML limit on the controller is infrastructure, kept from a console line too', () => {
  const STAGE_ERROR = 'org.jenkinsci.plugins.pipeline.maven.MavenPipelineException: Exception occured in withMaven'
    + ' pipeline step: JAXP00010003: The length of entity "[xml]" is "100,001" that exceeds the "100,000" limit se';
  const CONSOLE = 'org.xml.sax.SAXParseException; lineNumber: 3407380; columnNumber: 57; JAXP00010003: The length of'
    + ' entity "[xml]" is "100,001" that exceeds the "100,000" limit set by "jdk.xml.maxGeneralEntitySizeLimit".';
  assert.deepEqual(keep(['[INFO] BUILD SUCCESS', CONSOLE]), [CONSOLE]);
  // Not a build break: no matcher names a module or a file in it.
  assert.equal(classify([], STAGE_ERROR, at, 'Build for TestRelease'), null);
});

// master #9055 (2026-10-23): Quality Step 1 failed on a test of activeinstalls2, and TestRelease,
// in parallel, on the controller's XML limit — which had already failed #9053 and #9054.
const JAXP_9055 = 'org.jenkinsci.plugins.pipeline.maven.MavenPipelineException: Exception occured in withMaven'
  + ' pipeline step: JAXP00010004: The accumulated size of entities is "100,001" that exceeded the "100,000" limit';
const QUALITY = { name: 'Build for Quality Step 1', lines: [], nodeError: 'script returned exit code 1' };
const TEST_RELEASE = { name: 'Build for TestRelease', lines: [], nodeError: JAXP_9055 };

test('an infrastructure failure of a parallel stage is a second cause, beside the first stage\'s', () => {
  const cause = { kind: 'build-break', signature: 'Build/maven:xwiki-platform-activeinstalls2-api' };
  assert.deepEqual(alsoInfra([QUALITY, TEST_RELEASE], cause), [{ kind: 'infra', signature: 'jenkins-xml-limit',
    file: null, stage: 'Build for TestRelease', evidence: [JAXP_9055] }]);
});

test('a later stage adds nothing when the first is already infrastructure, or fails for an ordinary reason', () => {
  assert.deepEqual(alsoInfra([TEST_RELEASE, TEST_RELEASE], { kind: 'infra', signature: 'jenkins-xml-limit' }), []);
  assert.deepEqual(alsoInfra([QUALITY, { ...QUALITY, name: 'Build for TestRelease' }], { kind: 'unclassified' }), []);
  // Only the first stage is the cause's: a lone stage has no second cause.
  assert.deepEqual(alsoInfra([TEST_RELEASE], { kind: 'build-break' }), []);
});

// master #9059 and #9060 (2026-10-24): TestRelease failed on the controller's JAXP limit and, in
// parallel, Quality Step 2 on a really red SonarCloud gate. Reading the infra patterns over every
// stage first made the build "infra — not the code", and the gate never got its first-fix treatment.
const JAXP_9060 = 'org.jenkinsci.plugins.pipeline.maven.MavenPipelineException: Exception occured in withMaven'
  + ' pipeline step: JAXP00010004: The accumulated size of entities is "100,001" that exceeded the "100,000" limit'
  + ' set by "jaxp.properties".';
const GATE = 'Pipeline aborted due to quality gate failure: ERROR';
const bag = (name, nodeError, lines = []) => ({ name, lines, truncated: [], nodeError });

test('a red quality gate is never masked by an infrastructure failure beside it, in either order', async () => {
  for (const stages of [
    [bag('Build for TestRelease', JAXP_9060), bag('Build for Quality Step 2', GATE)],
    [bag('Build for Quality Step 2', GATE), bag('Build for TestRelease', JAXP_9060)]
  ]) {
    const diagnosis = await diagnoseStages(stages);
    assert.equal(diagnosis.kind, 'build-break');
    assert.equal(diagnosis.signature, 'Build/sonar-gate:failed');
    assert.equal(diagnosis.stage, 'Build for Quality Step 2');
    assert.deepEqual(diagnosis.also?.map(also => [also.signature, also.stage]),
      [['jenkins-xml-limit', 'Build for TestRelease']]);
  }
});

test('a stage\'s own infrastructure failure still explains that stage', async () => {
  // A full disk crashes the forked VM: the disk is the cause, not a test-infrastructure break.
  const lines = ['12:00:00 No space left on device',
    '12:00:01 [ERROR] There are test failures. surefire ... The forked VM terminated without saying goodbye. VM crashed?'];
  const diagnosis = await diagnoseStages([bag('Build for Main', 'script returned exit code 1', lines)]);
  assert.equal(diagnosis.kind, 'infra');
  assert.equal(diagnosis.signature, 'disk-full');
});

test('a build only the infrastructure broke is infrastructure, even beside an unexplained stage', async () => {
  const diagnosis = await diagnoseStages([bag('Build for Main', 'script returned exit code 1'),
    bag('Build for TestRelease', JAXP_9060)]);
  assert.equal(diagnosis.kind, 'infra');
  assert.equal(diagnosis.signature, 'jenkins-xml-limit');
  assert.equal(diagnosis.also, undefined);
});

test('a red build with no failed stage is unclassified, not a crash', async () => {
  const diagnosis = await diagnoseStages([]);
  assert.equal(diagnosis.kind, 'unclassified');
  assert.equal(diagnosis.stage, null);
  assert.equal(diagnosis.also, undefined);
});
