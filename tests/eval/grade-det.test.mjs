// The benchmark's deterministic group (c) grader, on a real session record (task c13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeRecord, nextRelease, parseDiff, pomVersion, summaries } from '../../eval/tools/grade-det.mjs';

const tasks = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../eval/questions/c.json'), 'utf8'));
const c13 = tasks.find((t) => t.id === 'c13');

// A Sonnet session's record for c13: it added the exclusions to the root pom but left the copy in
// xwiki-commons-pom, and named the stable branches without their `stable-` prefix.
const record = {
  diff: `diff --git a/pom.xml b/pom.xml
index 47de5101f..07b62cc0f 100644
--- a/pom.xml
+++ b/pom.xml
@@ -253,6 +253,20 @@
     <sonar.organization>xwiki</sonar.organization>
     <!-- Tells Sonar to use jacoco for coverage results -->
     <sonar.java.coveragePlugin>jacoco</sonar.java.coveragePlugin>
+    <!-- Tell SonarQube to not report usage of deprecated APIs and constant interfaces in XWiki legacy code. -->
+    <sonar.issue.ignore.multicriteria>e1,e2</sonar.issue.ignore.multicriteria>
+    <sonar.issue.ignore.multicriteria.e1.ruleKey>java:S1133</sonar.issue.ignore.multicriteria.e1.ruleKey>
+    <sonar.issue.ignore.multicriteria.e1.resourceKey>
+      **/xwiki-*-legacy-*/**/*.java
+    </sonar.issue.ignore.multicriteria.e1.resourceKey>
+    <sonar.issue.ignore.multicriteria.e2.ruleKey>java:S1214</sonar.issue.ignore.multicriteria.e2.ruleKey>
+    <sonar.issue.ignore.multicriteria.e2.resourceKey>
+      **/xwiki-*-legacy-*/**/*.java
+    </sonar.issue.ignore.multicriteria.e2.resourceKey>
     <!-- Here's how we handle multi-module jacoco coverage:
`,
  commits: '[Misc] Apply the SonarQube legacy exclusions to xwiki-commons itself\n\n* The root POM doesn\'t inherit from '
    + 'xwiki-commons-pom, so the java:S1133 and java:S1214 exclusions\n  for -legacy modules defined there were never '
    + 'applied to xwiki-commons\' own analysis.\n\n----',
  answer: '**Backport:** this clone has no 18.4.x or 17.10.x branches or tags, only a detached HEAD, and I couldn\'t '
    + 'fetch them. To backport, check out each stable branch and run `git cherry-pick -x 3b132e44a`.',
  grade: { points: [{ verdict: 'partial' }, { verdict: 'covered' }, { verdict: 'covered' }] },
};

test('parseDiff splits files and keeps only the added and removed lines', () => {
  const [pom] = parseDiff(record.diff);
  assert.equal(parseDiff(record.diff).length, 1);
  assert.equal(pom.path, 'pom.xml');
  assert.equal(pom.added.length, 10);
  assert.deepEqual(pom.removed, []);
  assert.equal(pom.isNew, false);
});

test('summaries keeps each commit summary and drops merges', () => {
  assert.deepEqual(summaries(`${record.commits}\nMerge branch 'x'\n----`),
    ['[Misc] Apply the SonarQube legacy exclusions to xwiki-commons itself']);
});

test('the next release of a dev version: an RC1 for X.Y.0, the version itself for a bugfix line', () => {
  assert.equal(nextRelease('18.10.0-SNAPSHOT'), '18.10.0RC1');
  assert.equal(nextRelease('17.10.4-SNAPSHOT'), '17.10.4');
  assert.equal(nextRelease('18.10.0'), null);
});

test('pomVersion reads the project version, not the parent one', () => {
  const pom = `<project>
  <parent><groupId>org.xwiki.commons</groupId><artifactId>xwiki-commons</artifactId><version>18.9.0</version></parent>
  <artifactId>xwiki-platform</artifactId>
  <version>18.10.0-SNAPSHOT</version>
</project>`;
  assert.equal(pomVersion(pom), '18.10.0-SNAPSHOT');
});

test('c13: each point graded from the record, side by side with the judge', () => {
  const graded = gradeRecord(c13, record, { version: '18.10.0-SNAPSHOT' });
  assert.deepEqual(graded.map(({ point, det, judge }) => ({ point, det, judge })), [
    // The exclusions were added to the root pom but not removed from xwiki-commons-pom.
    { point: 1, det: false, judge: false },
    { point: 2, det: true, judge: true },
    // The judge accepted "18.4.x"; the grader wants the branch names.
    { point: 3, det: false, judge: true },
  ]);
  assert.equal(graded[2].exact, false, 'c13 P3 is a proxy: the grader checks only the branch names');
});

test('a point that needs a diff is ungraded when the session changed nothing', () => {
  const graded = gradeRecord(c13, { diff: '', commits: '', answer: '' }, { version: null });
  assert.deepEqual(graded.map((g) => g.det), [null, null, false]);
});
