// docpages.py lint: the rules tied to the Technical ID. A topic page's first sentence no longer has to
// link its extension (the DocGuide dropped that rule), while an Administrator page of a non-bundled
// extension must carry a Technical ID, which displays the bar naming that extension (DocApp 1.22+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = join(dirname(fileURLToPath(import.meta.url)),
  '../../xwiki/skills/xwiki-doc-writing/tools/docpages.py');

function lint(pages) {
  const dir = mkdtempSync(join(tmpdir(), 'docpages-'));
  writeFileSync(join(dir, 'pages.py'), `ALL = ${JSON.stringify(pages)}\n`);
  const run = spawnSync('python3', [TOOL, 'lint'], { cwd: dir, encoding: 'utf8' });
  return run.stdout.split('\n').filter((l) => l.startsWith(' - ')).map((l) => l.slice(3));
}

function page(space, fields = {}) {
  return {
    space, page: 'WebHome', title: 'S3 Blob Store', type: 'explanation', target: 'administrator',
    summary: 'Store attachments and deleted pages in an S3-compatible object store.',
    content: 'The S3 blob store keeps attachments in an object store.', ...fields,
  };
}

const technicalId = (problems) => problems.filter((p) => p.includes('Technical ID'));

test('a topic page whose first sentence does not link its extension is accepted', () => {
  const problems = lint([page(['documentation', 'extensions', 'admin', 's3-blob-store'],
    { ext: 'xwiki:org.xwiki.contrib:s3-blob-store' })]);
  assert.deepEqual(problems.filter((p) => p.includes('first sentence')), []);
  assert.deepEqual(technicalId(problems), []);
});

test('an Administrator page of a non-bundled extension without a Technical ID is reported', () => {
  const problems = lint([page(['documentation', 'extensions', 'admin', 's3-blob-store'])]);
  assert.equal(technicalId(problems).length, 1);
  assert.match(technicalId(problems)[0], /^documentation\.extensions\.admin\.s3-blob-store\.WebHome: /);
});

test('a page without a Technical ID elsewhere than the Administrator pages of non-bundled extensions is accepted',
  () => {
    const problems = lint([
      page(['documentation', 'xs', 'admin', 'group']),
      page(['documentation', 'extensions', 'user', 's3-blob-store'], { target: 'user' }),
    ]);
    assert.deepEqual(technicalId(problems), []);
  });
