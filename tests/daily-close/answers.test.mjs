// Which judgements a daily-close run reuses from an earlier day, and which it asks again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryOver, fingerprint, remember } from '../../xwiki/scripts/daily-close-answers.mjs';

const pr = (extra = {}) => ({ id: 'gh:xwiki/xwiki-platform#6486', kind: 'pr', cls: 'close', ci: 'SUCCESS',
  lastActivity: '2026-10-10T08:00:00Z', liveThreads: [], questions: [{ ask: 'Does surli ask something?' }], ...extra });
const topic = (lastActivity) => ({ id: 'forum:18000', kind: 'topic', cls: null, lastActivity,
  questions: [{ ask: 'Classify this topic (today is 2026-10-20)' }] });
const answer = { cls: 'close', action: 'close the PR: surli says it is obsolete' };

const judged = (item, on) => remember([item], { [item.id]: answer }, {}, on);

test('an unchanged item gets yesterday\'s answer, saying when it was made', () => {
  const memory = judged(pr(), '2026-10-19');
  const answers = {};
  assert.equal(carryOver([pr()], answers, memory, '2026-10-20'), 1);
  assert.deepEqual(answers[pr().id], { ...answer, carried: '2026-10-19' });
});

test('a new comment, a CI change or a new review thread asks again', () => {
  const memory = judged(pr(), '2026-10-19');
  for (const moved of [pr({ lastActivity: '2026-10-19T17:00:00Z' }), pr({ ci: 'FAILURE' }),
    pr({ liveThreads: [{ by: 'tmortagne', text: 'and this?' }] })]) {
    assert.equal(carryOver([moved], {}, memory, '2026-10-20'), 0);
  }
});

test('the questions\' wording and the idle counter are not facts', () => {
  const tomorrow = { ...pr(), daysIdle: 11, questions: [{ ask: 'Does surli ask something? (today is 2026-10-21)' }] };
  assert.equal(fingerprint(tomorrow), fingerprint({ ...pr(), daysIdle: 10 }));
});

test('an answer older than two weeks is asked again even when nothing moved', () => {
  assert.equal(carryOver([pr()], {}, judged(pr(), '2026-10-05'), '2026-10-20'), 0);
});

test('a topic judged while its vote could still run is asked again', () => {
  const recent = topic('2026-10-18T10:00:00Z');
  assert.equal(carryOver([recent], {}, judged(recent, '2026-10-19'), '2026-10-20'), 0);
  const quiet = topic('2026-10-01T10:00:00Z');
  assert.equal(carryOver([quiet], {}, judged(quiet, '2026-10-19'), '2026-10-20'), 1);
});

test('a carried answer is not re-remembered, so it still expires', () => {
  const memory = judged(pr(), '2026-10-10');
  const answers = {};
  carryOver([pr()], answers, memory, '2026-10-20');
  remember([pr()], answers, memory, '2026-10-20');
  assert.equal(memory[pr().id].judgedOn, '2026-10-10');
});

test('pruning forgets closed items, and only when asked', () => {
  const memory = judged(pr(), '2026-10-19');
  remember([], {}, memory, '2026-10-20');
  assert.ok(memory[pr().id]);
  remember([], {}, memory, '2026-10-20', { prune: true });
  assert.deepEqual(memory, {});
});
