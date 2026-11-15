// Group (e) questions from gen-a output, on batch 1's visual-regression fact: the first draft aimed at a
// side detail of the excerpt (scrolling, screen height), the regenerated one at the fact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factTerms, missingTerms, toE } from '../../eval/tools/to-e.mjs';

const DT = 'https://dev.xwiki.org/xwiki/bin/view/Community/Testing/DockerTesting';
const B05 = { id: 'B05', sources: [{ url: DT, version: '81.1', sections: ['Visual Regression Testing'] }],
  fact: 'Visual regression testing (18.9.0RC1+): take a ScreenshotComparator parameter and call assertMatches(name, element[, Insets]); references live in src/test/resources/screenshots/<declaring class, not AllIT>/<method>/firefox/<name>.png, are added by running once, and are refreshed with -Dxwiki.test.ui.screenshots.update=true. Firefox only.' };
const draft = ["The capture doesn't scroll the element into view. Firefox only captures the viewport, so a partly visible element gets cut off and one outside the view fails the assertion. The test has to make the element visible itself.",
  'A taller viewport avoids scrolling, and scrolling can drop the hover state before the image is taken.',
  "The stored images depend on the screen width but not the height, so a taller screen (the screenHeight option) doesn't require regenerating them."];
const redo = ['Baselines go under src/test/resources/screenshots/<class>/<method>/firefox/<name>.png',
  '<class> is the simple name of the class that declares the test method, not the AllIT suite that nests it',
  'To regenerate after an expected visual change, run with -Dxwiki.test.ui.screenshots.update=true, which overwrites the references'];

test('a question aimed at a side detail mentions none of its fact\'s distinctive terms', () => {
  assert.ok(factTerms(B05.fact).includes('-dxwiki.test.ui.screenshots.update'));
  assert.deepEqual(missingTerms(B05.fact, draft), factTerms(B05.fact));
  assert.ok(missingTerms(B05.fact, redo).length < factTerms(B05.fact).length);
});

test('a gen-a question becomes a group (e) question whose gold is the page excerpt at its version', () => {
  const excerpt = { id: 'e01', gap: 'B05', file: `${DT}/`, section: 'Visual Regression Testing', version: '81.1', text: '= Visual Regression Testing =\n…\n' };
  const q = toE({ id: 'e01', group: 'a', question: 'q?', kind: 'fact', key_points: redo, avoided_terms: [], gold: { file: `${DT}/` } }, excerpt, [B05]);
  assert.equal(q.group, 'e');
  assert.deepEqual({ ...q.gold, reference: undefined }, { source: `${DT}/@81.1`, section: 'Visual Regression Testing', gap: 'B05', reference: undefined });
  assert.match(q.gold.reference, /^= Visual Regression Testing =\n…\n\n\(Source: .*DockerTesting\/ , page version 81\.1, section "Visual Regression Testing"\)$/);
  assert.throws(() => toE({ id: 'e01' }, { ...excerpt, gap: 'B99' }, [B05]), /no backlog entry B99/);
  assert.throws(() => toE({ id: 'e01' }, { ...excerpt, file: 'https://dev.xwiki.org/xwiki/bin/view/Community/Building' }, [B05]), /not a source of B05/);
});
