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

// Only the commit message (or PR body) of a compound command is checked, never the rest of it: an
// agent edits files through heredocs and `sed -i` in the same command, and that code is full of
// `@Annotations`. Shapes taken from real agent sessions.
const found = (command, cwd) => checkCommitText(command, { cwd })?.findings.map((f) => f.token) ?? null;
const jira = () => repo({ 'pom.xml': '<issueManagement><system>jira</system></issueManagement>' });

test('a heredoc edit chained with a commit is not commit text', () => {
  const command = `python3 - <<'EOF'
import re
p = 'src/main/java/org/xwiki/Foo.java'
s = open(p).read().replace('    public void old()', '    @Deprecated(since = "18.9.0RC1")\\n    public void old()')
open(p, 'w').write(s)
EOF
git add -A && git commit -q -F - <<'EOF'
XWIKI-123: Deprecate Foo#old

* Deprecate \`old()\` in favor of \`current()\`
EOF
git log --oneline -1`;
  assert.equal(found(command, jira()), null);
  assert.deepEqual(found(command.replace('* Deprecate `old()`', '* Deprecate old() with @Deprecated'), jira()),
    ['@Deprecated']);
});

test('a sed edit or an appending heredoc before the commit is not commit text', () => {
  assert.equal(found("cd /tmp/repo && sed -i 's/@since 18.0.0RC1/@since 18.9.0RC1/' Foo.java && git add -A"
    + " && git commit -q -m 'XWIKI-1: Fix the since' -m 'Use the right version'"), null);
  assert.equal(found(`cat >> FooTest.java <<'EOF'
    @Test
    void render() {}
}
EOF
git commit -am 'XWIKI-1: Add a test'`), null);
  const notes = `cat > notes.md <<'EOF'
Follows #12
EOF
git commit -m 'XWIKI-1: Fix'`;
  assert.equal(found(notes, jira()), null);
});

test('another command\'s -m is not a commit message', () => {
  // `python3 -m` was read as the summary, which pushed the real summary into the checked body.
  assert.deepEqual(found("python3 -m pytest && git commit -m 'XWIKI-1: Fix the @Inject field' -m 'See @bob'"),
    ['@bob']);
});

test('every way of passing the message is still checked', () => {
  const cases = {
    'git -C /tmp/repo commit -q -m "XWIKI-1: Fix" -m "cc @bob" 2>&1 | tail -3': ['@bob'],
    'git commit -am "XWIKI-1: Fix" -m"cc @bob"': ['@bob'],
    'git commit --message="XWIKI-1: Fix" --message="cc @bob"': ['@bob'],
    "git commit -m 'XWIKI-1: Fix' \\\n  -m 'cc @bob'": ['@bob'],
    "git commit -m \"$(cat <<'EOF'\nXWIKI-1: Use @Inject\n\nReplace the lookup with @Inject\nEOF\n)\"": ['@Inject'],
    "cat <<'EOF' | git commit -F -\nXWIKI-1: Fix\n\ncc @bob\nEOF": ['@bob'],
    "echo 'cc @bob' | git commit -m 'XWIKI-1: Fix' -F -": ['@bob'],
    "cat > /tmp/msg.txt <<'EOF'\nXWIKI-1: Fix\n\ncc @bob\nEOF\ngit commit -F /tmp/msg.txt": ['@bob'],
    "bash -c \"git commit -m 'XWIKI-1: Fix' -m 'cc @bob'\"": ['@bob'],
  };
  for (const [command, tokens] of Object.entries(cases)) assert.deepEqual(found(command), tokens, command);
});

test('a message file on disk is read, relative to a cd in the same command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-msg-'));
  writeFileSync(join(dir, 'msg.txt'), 'XWIKI-1: Fix @summary\n\nThanks @bob\n');
  assert.deepEqual(found(`cd ${dir} && git commit --file msg.txt`, tmpdir()), ['@bob']);
  assert.equal(found(`git commit -F ${join(dir, 'missing.txt')}`), null);
});

test('a PR body is checked, not the heredoc edit before it', () => {
  const command = `python3 - <<'EOF'
open('Foo.java', 'a').write('@Override\\n')
EOF
gh pr create --title "XWIKI-1: Fix" --body-file - <<'EOF'
Jira: https://jira.xwiki.org/browse/XWIKI-1
cc @bob
EOF`;
  assert.deepEqual(found(command), ['@bob']);
  assert.equal(found(command.replace('cc @bob', 'cc `@bob`')), null);
  assert.deepEqual(found("gh pr edit 12 --body 'cc @bob'"), ['@bob']);
});
