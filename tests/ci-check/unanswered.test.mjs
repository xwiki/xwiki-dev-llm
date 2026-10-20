// A question nobody answers: named in the digest, then proved in the stabilisation slot (2026-10-18,
// a6747deb54 asked on 10-16 about RealtimeWikiEditorIT, master blocked, no reply).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerIn } from '../../xwiki/skills/xwiki-ci-check/tools/lib/github.mjs';
import { memoryBlock, memoryOf } from '../../xwiki/skills/xwiki-ci-check/tools/memory.mjs';
import { renderDetail, renderDigest } from '../../xwiki/skills/xwiki-ci-check/tools/lib/render.mjs';
import { refusal } from '../../xwiki/skills/xwiki-ci-check/tools/commit-comment.mjs';

const ID = 'platform/master/org.xwiki.realtime.wiki.test.ui.AllIT$NestedRealtimeWikiEditorIT#toggleRealtimeWithSelf';
const A6747 = 'a6747deb542c59a4bd80987212344b500983eeea';
const asked = { user: { login: 'xwikiorg-llm-bot' }, html_url: 'https://github.com/c#1', created_at: '2026-10-16T06:40:00Z',
  body: `could you check?\n<!-- xwiki-ci-check: ${ID} state=systematic -->` };

test("only a person's reply answers a question; the bot's own later comments do not", () => {
  assert.equal(markerIn([asked, { user: { login: 'xwikiorg-llm-bot' }, body: 'more' }], ID).replies, 0);
  assert.equal(markerIn([asked, { user: { login: 'mflorea' }, body: 'looking' }], ID).replies, 1);
});

const TOGGLE = { id: ID, repo: 'xwiki-platform', branch: 'master', class: 1, kind: 'test-breakage', state: 'systematic',
  primary: true, deep: true, silent: true, ageDays: 5,
  notified: { state: 'systematic', url: 'https://github.com/c#1', at: asked.created_at },
  unanswered: { since: '2026-10-16', url: 'https://github.com/c#1', author: 'mflorea' } };
const report = (incident, stabilise) => ({ generatedAt: '2026-10-18T06:00:00Z', horizonDays: 7, budget: 5,
  summary: { jobs: 20, red: 8, incidents: 1, stabilise }, jobs: [], incidents: [incident] });

test('an unanswered question names who was asked and since when, in the paste and the digest', () => {
  assert.match(renderDetail(report(TOGGLE), { live: true }), /done → asked mflorea on 2026-10-16, no answer yet/);
  assert.match(renderDigest(report(TOGGLE), { available: true, state: {} }),
    /asked mflorea on \[2026-10-16\]\(https:\/\/github\.com\/c#1\), no answer yet/);
});

const PROVING = { ...TOGGLE, prove: true,
  commentable: { repo: 'xwiki-platform', state: 'systematic+reproduced', tier: 'likely', sha: A6747, author: 'mflorea',
    followUp: 'reproduced' } };

const PROVE_ORDER = report(PROVING, { skipped: 'a blocker is open', blockers: [ID],
  prove: { id: ID, short: 'a6747deb54', author: 'mflorea', asked: '2026-10-16' } });

test('the slot goes to the blocker instead, and only its row says what ran', () => {
  const page = renderDetail(PROVE_ORDER, { live: true });
  assert.doesNotMatch(page, /bot → run the test/);
  assert.match(page, /<!-- COMMENT: /);
  assert.match(page, /The slot goes to proving #1 instead\*\* — `a6747deb54` \(mflorea\) was asked on 2026-10-16/);
});

// 2026-10-19: the proof was skipped before any run, and the memory still kept the slot off it for a week.
test('the memory records a proof attempt only once a run started', () => {
  assert.doesNotMatch(renderDetail(PROVE_ORDER, { live: true }), /"proved"/);
  assert.match(renderDetail(PROVE_ORDER, { live: true, proofRan: true }), /"proved":"2026-10-18"/);
});

test('a second comment on an asked commit is the reproduced proof or nothing', () => {
  const order = { incidents: [PROVING] };
  const why = 'fails 4/10 at a6747deb54 and 0/10 at its parent on master / firefox';
  assert.match(refusal(order, { incident: ID, sha: 'a6747deb54' }), /only with --proof reproduced/);
  assert.match(refusal(order, { incident: ID, sha: 'a6747deb54', proof: 'diff-link', why }), /only with --proof reproduced/);
  assert.equal(refusal(order, { incident: ID, sha: 'a6747deb54', proof: 'reproduced', why }), null);
});

test('the memory carries the question and the proof attempt forward', () => {
  const paste = [`| **1.** x | why | next |`,
    ...memoryBlock('2026-10-18', new Map([[ID, 1]]), [{ id: ID, state: 's', analysedOn: '2026-10-18',
      asked: '2026-10-16', proved: '2026-10-18' }])].join('\n');
  const entry = memoryOf(paste)[ID];
  assert.equal(entry.asked, '2026-10-16');
  assert.equal(entry.proved, '2026-10-18');
});
