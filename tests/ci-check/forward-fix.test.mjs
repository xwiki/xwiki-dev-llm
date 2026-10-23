// What a forward fix must touch. On 2026-10-23 `9c03e54382` fixed `SideMenuIT` on stable-18.9.x by
// changing only its screenshots, and the row read "flicker" because only `SideMenuIT.java` was a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touches } from '../../xwiki/skills/xwiki-ci-check/tools/lib/blame.mjs';
import { forwardKeys } from '../../xwiki/skills/xwiki-ci-check/tools/lib/fix-signals.mjs';

const TEST = 'org.xwiki.blocknote.test.ui.SideMenuIT#sideMenuIsAlignedOnCaptionedImage';
const SCREENSHOTS = 'xwiki-platform-core/xwiki-platform-blocknote/xwiki-platform-blocknote-test/'
  + 'xwiki-platform-blocknote-test-docker/src/test/resources/screenshots/SideMenuIT/sideMenuIsAlignedOnCaptionedImage/'
  + 'firefox/captionedImage.png';
const keysOf = id => forwardKeys({ class: 1, tests: [id] }).groups[0];
const fixes = (id, files) => keysOf(id).some(key => touches({ files }, key));

test('the directory named after the failing test is its own, and a change there is a fix', () => {
  assert.equal(fixes(TEST, [SCREENSHOTS]), true);
  // The `.java` key stays last: it is what `covers` names the class by.
  assert.equal(keysOf(TEST).at(-1), 'SideMenuIT.java');
});

test('a directory only starting with the test\'s name is another test\'s', () => {
  assert.equal(fixes(TEST, [SCREENSHOTS.replace('/SideMenuIT/', '/SideMenuITHelper/')]), false);
});

test('a nested suite\'s test owns the directory named without the Nested prefix', () => {
  const nested = 'org.xwiki.flamingo.test.docker.AllIT$NestedVersionIT#testDeleteVersion';
  assert.equal(fixes(nested, ['src/test/resources/VersionIT/page.xml']), true);
  assert.equal(fixes(nested, ['src/test/java/org/xwiki/flamingo/test/docker/VersionIT.java']), true);
});
