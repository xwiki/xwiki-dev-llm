// Which repos get their `#123` references blocked: only those whose issues live in JIRA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCommitText, usesJiraIssues } from '../../xwiki/scripts/check-commit-text.mjs';

const commit = "git commit -m 'Fix the macro' -m 'Follows #259 and @since'";

// A repo whose root holds `files`, with an optional origin remote.
function repo(files = {}, remote) {
  const dir = mkdtempSync(join(tmpdir(), 'commit-text-'));
  execFileSync('git', ['init', '-q', dir]);
  if (remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const tokens = (dir) => checkCommitText(commit, { cwd: dir })?.findings.map((f) => f.token);

test('a pom.xml declaring JIRA issue management blocks #123', () => {
  const pom = '<project><issueManagement><system>jira</system>'
    + '<url>https://jira.xwiki.org/browse/XWIKI</url></issueManagement></project>';
  assert.deepEqual(tokens(repo({ 'pom.xml': pom })), ['@since', '#259']);
});

test('a contrib pom.xml naming its JIRA project blocks #123', () => {
  const pom = '<project><properties><xwiki.issueManagement.jira.id>OIDC</xwiki.issueManagement.jira.id>'
    + '</properties></project>';
  assert.equal(usesJiraIssues(repo({ 'pom.xml': pom })), true);
});

test('a pom.xml tracking issues in GitHub only blocks the mention', () => {
  const pom = '<project><issueManagement><system>GitHub</system>'
    + '<url>https://github.com/xwikisas/project-management/issues</url></issueManagement>'
    + '<!-- see https://jira.xwiki.org/browse/XWIKI-123 --></project>';
  assert.deepEqual(tokens(repo({ 'pom.xml': pom })), ['@since']);
});

test('without a pom.xml, the origin remote\'s org decides', () => {
  assert.equal(usesJiraIssues(repo({}, 'git@github.com:xwiki/xwiki-dev-llm.git')), true);
  assert.equal(usesJiraIssues(repo({}, 'https://github.com/xwiki-contrib/some-tool.git')), true);
  assert.equal(usesJiraIssues(repo({}, 'https://github.com/xwikisas/xwikisas-dev-llm.git')), false);
});

test('the repo is found from a subdirectory', () => {
  const dir = repo({ 'pom.xml': '<project><issueManagement><system>GitHub</system></issueManagement></project>' });
  mkdirSync(join(dir, 'module'));
  assert.equal(usesJiraIssues(join(dir, 'module')), false);
});

test('what cannot be read keeps the check on', () => {
  assert.equal(usesJiraIssues(repo()), true);
  assert.equal(usesJiraIssues(mkdtempSync(join(tmpdir(), 'not-a-repo-'))), true);
});
