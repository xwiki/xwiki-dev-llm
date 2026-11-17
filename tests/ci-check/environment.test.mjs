// Which environment of the matrix a suite ran in. On 2026-11-17 every suite read "default", because
// the last block name is the enclosing "docker" stage: PDFExportIT#liveData, failing in every
// environment since a regression, was filed as a flicker (XWIKI-25778).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentOf } from '../../xwiki/scripts/jenkins.mjs';

const ENV = 'Oracle 19.3.0-se2, Jetty 12-jdk25, Filesystem, Firefox';
const STAGE = `${ENV} - Docker tests #4 for xwiki-platform-edit, xwiki-platform-export-pdf`;

test('the environment is read from the Docker tests block, wherever it sits', () => {
  assert.equal(environmentOf({ enclosingBlockNames: [`Build for ${STAGE}`, STAGE, 'docker'] }), ENV);
  assert.equal(environmentOf({ enclosingBlockNames: [STAGE] }), ENV);
});

test('a suite outside the matrix is the default environment', () => {
  assert.equal(environmentOf({ enclosingBlockNames: ['Build for Test Framework', 'docker'] }), 'default');
  assert.equal(environmentOf({}), 'default');
});
