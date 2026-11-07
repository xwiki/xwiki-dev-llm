// What the KB source sync decides without the network: which pages a KB file cites, where the wiki
// keeps them, and which ones the routine must read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesUrl, classify, devSources, editsSince, pageKey, pinArg, restPaths, versionCmp }
  from '../../scripts/kb-sources.mjs';

const VIEW = 'https://dev.xwiki.org/xwiki/bin/view/';

test('one page per dev.xwiki.org URL, whatever its anchor, query, slash or encoding', () => {
  assert.equal(pageKey(`${VIEW}Community/CodeStyle/JavaCodeStyle/#HDeprecation`), `${VIEW}Community/CodeStyle/JavaCodeStyle`);
  assert.equal(pageKey(`${VIEW}Community/CodeStyle/JavaCodeStyle?viewer=changes`), `${VIEW}Community/CodeStyle/JavaCodeStyle`);
  assert.equal(pageKey(`${VIEW}Community/Some+Page`), pageKey(`${VIEW}Community/Some%20Page`));
  assert.equal(pageKey('https://www.xwiki.org/xwiki/bin/view/Documentation/'), null);
  assert.equal(pageKey('https://extensions.xwiki.org/xwiki/bin/view/Extension/Component+Module'), null);
  assert.equal(pageKey(VIEW), null);
  assert.equal(pageKey(`${VIEW}Community/Bad%E0`), null);
});

test('only the dev.xwiki.org pages of the sources: frontmatter list are cited', () => {
  const md = [
    '---',
    'title: T',
    'sources:',
    `  - ${VIEW}Community/Testing/JavaUnitTesting/#HBestpractices`,
    `  - ${VIEW}Community/Testing/JavaUnitTesting/#HMocking`,
    '  - https://extensions.xwiki.org/xwiki/bin/view/Extension/Component+Module',
    '  - John Ousterhout, "A Philosophy of Software Design"',
    `  - ${VIEW}Community/CodeStyle — the rules common to all languages`,
    `  - "${VIEW}Community/Quoted"`,
    `  - [Docker testing](${VIEW}Community/Testing/DockerTesting/)`,
    'verify: |',
    `  curl ${VIEW}Community/ReleaseProcess`,
    '---',
    `See ${VIEW}Community/DevelopmentPractices in the body.`,
  ].join('\n');
  assert.deepEqual(devSources(md), [`${VIEW}Community/Testing/JavaUnitTesting`, `${VIEW}Community/CodeStyle`,
    `${VIEW}Community/Quoted`, `${VIEW}Community/Testing/DockerTesting`]);
  assert.deepEqual(devSources('no frontmatter'), []);
});

test('a view URL resolves to the nested page first, then the terminal one', () => {
  assert.deepEqual(restPaths(`${VIEW}Community/CodeStyle`),
    ['spaces/Community/spaces/CodeStyle/pages/WebHome', 'spaces/Community/pages/CodeStyle']);
  assert.deepEqual(restPaths(`${VIEW}Community`), ['spaces/Community/pages/WebHome']);
  assert.deepEqual(restPaths(pageKey(`${VIEW}Community/Some+Page`)),
    ['spaces/Community/spaces/Some%20Page/pages/WebHome', 'spaces/Community/pages/Some%20Page']);
});

test('versions compare as numbers, not strings', () => {
  assert.ok(versionCmp('10.1', '9.1') > 0);
  assert.ok(versionCmp('4.130', '4.14') > 0);
  assert.equal(versionCmp('28.1', '28.1'), 0);
});

test('a page is changed, moved, unpinned or unreachable, and a pin no file cites is unused', () => {
  const nested = 'spaces/C/spaces/A/pages/WebHome';
  const cited = new Map([['a', ['kb/x.md']], ['b', ['kb/x.md', 'kb/y.md']], ['c', ['kb/y.md']],
    ['d', ['kb/z.md']], ['e', ['kb/z.md']]]);
  const pins = { a: '9.1', b: '3.2', d: '1.1', e: '164.1', gone: '2.1' };
  const current = new Map([['a', { version: '10.1', path: nested }], ['b', { version: '3.2', path: nested }],
    ['c', { version: '1.1', path: nested }], ['d', { error: 'HTTP 403' }], ['e', { version: '1.1', path: nested }]]);
  assert.deepEqual(classify(cited, pins, current), {
    changed: [{ key: 'a', files: ['kb/x.md'], from: '9.1', to: '10.1', changes: 'a/?viewer=changes&rev1=9.1&rev2=10.1' }],
    moved: [{ key: 'e', files: ['kb/z.md'], from: '164.1', to: '1.1' }],
    unpinned: [{ key: 'c', files: ['kb/y.md'], to: '1.1' }],
    unreachable: [{ key: 'd', files: ['kb/z.md'], reason: 'HTTP 403' }],
    unusedPins: ['gone'],
  });
});

test('the wiki\'s view of the change ends with a slash for a nested page only', () => {
  assert.equal(changesUrl(`${VIEW}Community/CodeStyle`, 'spaces/Community/spaces/CodeStyle/pages/WebHome', '27.1', '28.1'),
    `${VIEW}Community/CodeStyle/?viewer=changes&rev1=27.1&rev2=28.1`);
  assert.equal(changesUrl(`${VIEW}Community/DevelopmentPractices`, 'spaces/Community/pages/DevelopmentPractices', '253.1', '264.2'),
    `${VIEW}Community/DevelopmentPractices?viewer=changes&rev1=253.1&rev2=264.2`);
});

test('the edits since a pin, newest first, with the author\'s short name', () => {
  const summaries = [
    { version: '9.1', modified: Date.UTC(2026, 0, 2), modifier: 'xwiki:XWiki.Old', comment: '' },
    { version: '10.1', modified: Date.UTC(2026, 0, 3), modifier: 'xwiki:XWiki.VincentMassol', comment: 'c1' },
    { version: '11.1', modified: Date.UTC(2026, 0, 4), modifier: 'xwiki:XWiki.surli' },
  ];
  assert.deepEqual(editsSince(summaries, '9.1'), [
    { version: '11.1', date: '2026-01-04', author: 'surli', comment: '' },
    { version: '10.1', date: '2026-01-03', author: 'VincentMassol', comment: 'c1' },
  ]);
});

test('a pin argument may name the exact version read', () => {
  assert.deepEqual(pinArg(`${VIEW}Community/CodeStyle/@27.1`), [`${VIEW}Community/CodeStyle`, '27.1']);
  assert.deepEqual(pinArg(`${VIEW}Community/CodeStyle#HComments`), [`${VIEW}Community/CodeStyle`, undefined]);
});
