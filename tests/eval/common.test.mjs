// The benchmark's shared question checks, on the shipped group (e) questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadQuestions, missingReferences, stagePlugin } from '../../eval/tools/common.mjs';

test('a group (e) question without gold.reference is refused, never judged against a missing section', () => {
  const questions = loadQuestions('e-docker');
  assert.deepEqual(missingReferences(questions), []);
  const [first] = questions;
  const stripped = { ...first, gold: { ...first.gold, reference: undefined } };
  assert.deepEqual(missingReferences([stripped, ...questions.slice(1)]), [first.id]);
  assert.deepEqual(missingReferences(loadQuestions('a')), []);
});

test('a plugin is staged at a path of the same length whatever its source and label, and restaged fresh', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-'));
  const short = path.join(tmp, 'a', 'xwiki');
  const long = path.join(tmp, 'a-much-longer-source-directory', 'xwiki');
  for (const dir of [short, long]) {
    fs.mkdirSync(path.join(dir, 'kb'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'kb', 'x.md'), dir);
  }
  const out = path.join(tmp, 'out');
  const [one, two] = [stagePlugin(short, out, 'master-r1'), stagePlugin(long, out, 'branch-with-a-long-label-r1')];
  assert.notEqual(one, two);
  assert.equal(one.length, two.length);
  assert.equal(fs.readFileSync(path.join(two, 'kb', 'x.md'), 'utf8'), long);
  fs.writeFileSync(path.join(one, 'stale'), '');
  assert.equal(stagePlugin(short, out, 'master-r1'), one);
  assert.equal(fs.existsSync(path.join(one, 'stale')), false);
});
