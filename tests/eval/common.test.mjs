// The benchmark's shared question checks, on the shipped group (e) questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuestions, missingReferences } from '../../eval/tools/common.mjs';

test('a group (e) question without gold.reference is refused, never judged against a missing section', () => {
  const questions = loadQuestions('e-docker');
  assert.deepEqual(missingReferences(questions), []);
  const [first] = questions;
  const stripped = { ...first, gold: { ...first.gold, reference: undefined } };
  assert.deepEqual(missingReferences([stripped, ...questions.slice(1)]), [first.id]);
  assert.deepEqual(missingReferences(loadQuestions('a')), []);
});
