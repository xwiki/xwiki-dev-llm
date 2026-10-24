// What the review's context pack decides without a model: keys, module profiles, the gate, past reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateStop, jiraKeys, profile, renderPriorComments, selectPriorComments }
  from '../../xwiki/skills/xwiki-review/tools/pack.mjs';

test('JIRA keys come from the subjects, without encodings or standards', () => {
  assert.deepEqual(jiraKeys('XWIKI-25426: The instances of a cluster don\'t share\nXCOMMONS-2092: fix, UTF-8 safe, see RFC-7231'),
    ['XWIKI-25426', 'XCOMMONS-2092']);
  assert.deepEqual(jiraKeys('[Misc] Fix the SonarQube java:S2386 issues'), []);
});

test('a path gets the profile the reviewers route on', () => {
  const docker = 'xwiki-platform-core/xwiki-platform-edit/xwiki-platform-edit-test/xwiki-platform-edit-test-docker/src/test/it/org/xwiki/edit/test/ui/InplaceEditIT.java';
  assert.deepEqual(profile(docker), ['docker-test', 'test']);
  assert.deepEqual(profile('xwiki-platform-core/xwiki-platform-oldcore/src/main/java/com/xpn/xwiki/web/XWikiAction.java'),
    ['oldcore', 'public-api']);
  assert.deepEqual(profile('a/src/main/java/org/xwiki/velocity/internal/util/VelocityParser.java'), []);
  assert.deepEqual(profile('m/src/main/resources/XWiki/Page.xml', '<packaging>xar</packaging>'), ['xar']);
  assert.deepEqual(profile('x/src/main/resources/templates/macros.vm'), ['frontend']);
});

test('the gate stops on state, a reviewed head, size and dependency bumps — and nothing else', () => {
  const ok = { lines: 300, files: 4, paths: ['a/B.java'] };
  assert.equal(gateStop({ ...ok, state: 'OPEN' }), null);
  assert.equal(gateStop(ok), null);
  assert.match(gateStop({ ...ok, state: 'MERGED' }), /merged/);
  assert.match(gateStop({ ...ok, state: 'OPEN', isDraft: true }), /draft/);
  assert.match(gateStop({ ...ok, markerFound: true }), /already reviewed/);
  assert.match(gateStop({ ...ok, lines: 3001 }), /too large/);
  assert.match(gateStop({ ...ok, files: 151 }), /too large/);
  assert.match(gateStop({ ...ok, author: 'app/renovate', paths: ['pom.xml', 'x/pom.xml'] }), /dependency bump/);
  assert.equal(gateStop({ ...ok, author: 'app/renovate', paths: ['pom.xml', 'x/A.java'] }), null);
});

const prs = [
  { number: 7000, title: 'Older', author: 'alice', comments: [
    { who: 'bob', at: '2026-09-01T10:00:00Z', path: 'a/X.java', line: 12, body: 'This duplicates StringUtils#abbreviate, use it instead.' },
    { who: 'alice', at: '2026-09-01T11:00:00Z', path: 'a/X.java', body: 'Done, thanks for pointing out the helper.' },
    { who: 'renovate[bot]', at: '2026-09-01T11:00:00Z', body: 'Some long automated message about dependencies.' },
    { who: 'carol', at: '2026-09-02T10:00:00Z', body: 'LGTM' },
    { who: 'carol', at: '2026-09-03T10:00:00Z', path: 'b/Y.java', body: 'Unrelated file, but a fair point about ordering here.' }] },
  { number: 7044, title: 'Under review', author: 'dave', comments: [
    { who: 'bob', at: '2026-10-20T15:00:00Z', path: 'a/X.java', body: 'This is the very review the run must not see.' }] },
  { number: 7100, title: 'Later', author: 'erin', comments: [
    { who: 'bob', at: '2026-10-25T10:00:00Z', path: 'a/X.java', body: 'Written after the cutoff, so not known at review time.' }] },
];

test('past reviews: other people, before the cutoff, never the PR under review, same file first', () => {
  const kept = selectPriorComments(prs, { cutoff: '2026-10-20T14:44:00Z', excludePr: 7044, changed: ['a/X.java'] });
  assert.deepEqual(kept.map((c) => [c.pr, c.who, c.sameFile]), [[7000, 'bob', true], [7000, 'carol', false]]);
  const text = renderPriorComments(kept);
  assert.match(text, /#7000 Older — bob, 2026-09-01, a\/X.java:12/);
  assert.doesNotMatch(text, /must not see|after the cutoff|LGTM/);
});

test('past reviews stay within their byte budget', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ pr: i, title: 't', who: 'bob', at: '2026-01-01T00:00:00Z',
    path: 'a/X.java', body: 'x'.repeat(600) }));
  assert.ok(renderPriorComments(many, 5000).length <= 5000);
});
