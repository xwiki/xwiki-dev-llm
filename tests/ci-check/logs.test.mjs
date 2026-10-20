// What a red build's log is classified as. The lines are real: master build 9032 of xwiki-platform
// (2026-10-16), whose ESLint break was signed by the reactor's resume line until the eslint matcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, eslintFile, keep } from '../../xwiki/skills/xwiki-ci-check/tools/lib/logs.mjs';

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
