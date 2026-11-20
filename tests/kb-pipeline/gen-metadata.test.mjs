// The KB pipeline's metadata step: the model's answer mapped onto a topic, and frontmatter additions.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { addFrontmatter, toSidecar } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
const { bodyHash, parseFrontmatter } = await import('../../xwiki/scripts/kb-search.mjs');

const TOPIC = '---\ntitle: Logging\nsources:\n  - https://dev.xwiki.org/x\n---\n\n# Logging\n\n## Levels\n\nUse debug.\n';

test('addFrontmatter appends absent keys only, quoting globs, skipping empty values', () => {
  const out = addFrontmatter(TOPIC.replace('title: Logging', 'title: Logging\nprovenance: community'), {
    provenance: 'official',
    'last-confirmed': '2026-10-01',
    related: ['conventions/code-style.md'],
    'applies-to': ['**/*.java'],
    empty: [],
    missing: null,
  });
  const { data, body } = parseFrontmatter(out);
  assert.equal(data.provenance, 'community');
  assert.equal(data['last-confirmed'], '2026-10-01');
  assert.deepEqual(data.related, ['conventions/code-style.md']);
  assert.deepEqual(data['applies-to'], ['**/*.java']);
  assert.ok(!('empty' in data) && !('missing' in data));
  assert.match(out, /applies-to: \["\*\*\/\*\.java"\]\n---\n/);
  assert.equal(bodyHash(out), bodyHash(TOPIC));
  assert.equal(body, parseFrontmatter(TOPIC).body);
});

test('toSidecar keys sections by heading, keeps only known related paths, rejects a wrong count', () => {
  const topic = { rel: 'conventions/logging.md', text: TOPIC, headings: ['Levels'] };
  const answer = {
    file: { questions: ['how do I log', 'how do I log '], aliases: ['logger'] },
    sections: [{ heading: 'Levels', questions: ['which level'], aliases: [] }],
    related: ['conventions/code-style.md', 'nope.md', 'conventions/logging.md'],
    applies_to: ['**/*.java'],
  };
  const known = new Set(['conventions/code-style.md', 'conventions/logging.md']);
  const sidecar = toSidecar(topic, answer, known);
  assert.deepEqual(sidecar.file.questions, ['how do I log']);
  assert.deepEqual(sidecar.sections, { Levels: { questions: ['which level'], aliases: [] } });
  assert.deepEqual(sidecar.proposed, { related: ['conventions/code-style.md'], 'applies-to': ['**/*.java'] });
  assert.equal(sidecar.source_hash, bodyHash(TOPIC));
  assert.throws(() => toSidecar({ ...topic, headings: ['Levels', 'Other'] }, answer, known), /1 sections returned for 2/);
});

test('a regenerated sidecar keeps unchanged sections and the file part while title and summary are unchanged', async () => {
  const { hashes, mergeSidecar, reusable } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
  const { splitSections: split } = await import('../../xwiki/scripts/kb-search.mjs');
  const topicOf = (text, summary = 'About logs.') => {
    const sections = split(parseFrontmatter(text).body, 'Logging');
    return { rel: 'conventions/logging.md', text, title: 'Logging', summary, sections, headings: sections.map((s) => s.heading) };
  };
  const v1 = topicOf(`${TOPIC}\n## Format\n\nOne line.\n`);
  const old = { file: { questions: ['old file q'], aliases: [] },
    sections: { Levels: { questions: ['old levels q'], aliases: [] }, Format: { questions: ['old format q'], aliases: [] } },
    proposed: { related: [], 'applies-to': [] }, source_hash: bodyHash(v1.text), ...hashes(v1) };
  // Nothing changed that the model would write: complete, no model call needed.
  assert.equal(reusable(v1, old).complete, true);
  // Format's text changes: Levels and the file part are kept, Format takes the fresh answer.
  const v2 = topicOf(`${TOPIC}\n## Format\n\nTwo lines.\n`);
  const fresh = { file: { questions: ['new file q'], aliases: [] },
    sections: { Levels: { questions: ['new levels q'], aliases: [] }, Format: { questions: ['new format q'], aliases: [] } },
    proposed: { related: [], 'applies-to': [] }, source_hash: 'x' };
  const merged = mergeSidecar(v2, fresh, old);
  assert.equal(reusable(v2, old).complete, false);
  assert.deepEqual(merged.file.questions, ['old file q']);
  assert.deepEqual(merged.sections.Levels.questions, ['old levels q']);
  assert.deepEqual(merged.sections.Format.questions, ['new format q']);
  assert.equal(merged.source_hash, bodyHash(v2.text));
  assert.deepEqual(merged.section_hashes, hashes(v2).section_hashes);
  // A new summary renews the file part; a sidecar without hashes keeps nothing.
  assert.deepEqual(mergeSidecar(topicOf(v1.text, 'About logging.'), fresh, old).file.questions, ['new file q']);
  const { section_hashes: _s, file_hash: _f, ...unhashed } = old;
  assert.deepEqual(mergeSidecar(v1, fresh, unhashed).sections.Levels.questions, ['new levels q']);
});

test('previousOf hands the model the old metadata of the changed parts only', async () => {
  const { hashes, previousOf, prompt } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
  const { splitSections: split } = await import('../../xwiki/scripts/kb-search.mjs');
  const topicOf = (text) => {
    const sections = split(parseFrontmatter(text).body, 'Logging');
    return { rel: 'conventions/logging.md', text, title: 'Logging', summary: '', sections, headings: sections.map((s) => s.heading) };
  };
  const v1 = topicOf(`${TOPIC}\n## Format\n\nOne line.\n`);
  const old = { file: { questions: ['file q'], aliases: [] },
    sections: { Levels: { questions: ['levels q'], aliases: [] }, Format: { questions: ['format q'], aliases: ['fmt'] } },
    ...hashes(v1) };
  const v2 = topicOf(`${TOPIC}\n## Format\n\nTwo lines.\n`);
  const previous = previousOf(v2, old);
  assert.deepEqual(previous, { file: null, sections: { Format: { questions: ['format q'], aliases: ['fmt'] } }, gone: {} });
  const text = prompt(v2, [v2], previous);
  assert.match(text, /section "Format": questions \["format q"\], aliases \["fmt"\]/);
  assert.match(text, /Only when the new text answers something none of them covers/);
  assert.doesNotMatch(text, /levels q|file q|no longer exist/);
  assert.doesNotMatch(prompt(v1, [v1], previousOf(v1, old)), /had metadata before|no longer exist/);
  // A renamed heading: its old questions go to the model as a former section, not lost.
  const v3 = topicOf(`${TOPIC}\n## Layout\n\nOne line.\n`);
  const renamed = previousOf(v3, old);
  assert.deepEqual(renamed.gone, { Format: { questions: ['format q'], aliases: ['fmt'] } });
  assert.match(prompt(v3, [v3], renamed), /no longer exist[\s\S]*former section "Format": questions \["format q"\]/);
});

test('rankDrops reports a previous question its part no longer ranks for, not one it still does', async (t) => {
  const { hashes, rankDrops } = await import('../../scripts/kb-pipeline/gen-metadata.mjs');
  // `before` is the rank `changesOf` recorded, with the old metadata.
  const { splitSections: split } = await import('../../xwiki/scripts/kb-search.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'rank-drops-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'conventions'));
  const text = '---\ntitle: Logging\n---\n\n# Logging\n\n## Levels\n\nUse info.\n\n## Format\n\nOne line.\n';
  writeFileSync(join(root, 'conventions', 'logging.md'), text);
  const sections = split(parseFrontmatter(text).body, 'Logging');
  const topic = { rel: 'conventions/logging.md', text, title: 'Logging', summary: '', sections, headings: sections.map((s) => s.heading) };
  const sidecar = (format) => ({ file: { questions: [], aliases: [] },
    sections: { Levels: { questions: ['which severity'], aliases: [] }, Format: { questions: format, aliases: [] } },
    source_hash: bodyHash(text), ...hashes(topic) });
  const previous = { file: null, sections: { Format: { questions: ['zebra crossing', 'kept wording'], aliases: [] } },
    ranks: [['Format', 'zebra crossing', 1], ['Format', 'kept wording', 1]] };
  assert.deepEqual(rankDrops(root, topic, sidecar(['kept wording']), previous),
    [{ part: 'Format', question: 'zebra crossing', before: 1, after: null, kept: false }]);
  assert.deepEqual(rankDrops(root, topic, sidecar(['zebra crossing', 'kept wording']), previous), []);
  // A gone heading's question: reported only when no section of the file ranks for it.
  const gone = { file: null, sections: {}, gone: { Old: { questions: ['zebra crossing'], aliases: [] } } };
  assert.deepEqual(rankDrops(root, topic, sidecar(['kept wording']), gone),
    [{ part: 'Old', question: 'zebra crossing', before: 'heading gone', after: null, kept: false }]);
  assert.deepEqual(rankDrops(root, topic, sidecar(['zebra crossing']), gone), []);
});

test('a changed section shows the model its new sentences and the questions it is found by', async (t) => {
  const { changesOf, fifths, hashes, oldSectionTexts, prompt, toSidecar, topicOf } =
    await import('../../scripts/kb-pipeline/gen-metadata.mjs');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'changed-section-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'servers'));
  const file = join(root, 'servers', 'jira.md');
  // The change that motivated this: an exception added to the Fix Version/s rule, whose previous
  // questions the section ranked first for were dropped and none asked about the exception. The edit
  // re-wraps the paragraph, which must not make its unchanged sentences look new.
  const v1 = '---\ntitle: JIRA\n---\n\n# JIRA\n\n## Closing\n\nSet Fix Version/s to the next version of every\n'
    + 'branch the fix landed on. Choose the resolution Fixed when\na change fixed it.\n\n'
    + '## Bulk edits\n\nUse the REST API to edit many issues at once.\n';
  const v2 = v1.replace('every\nbranch the fix landed on.', 'every branch the fix\nlanded on, except a more recent '
    + 'branch while X.Y.0 is unreleased.').replace('Fixed when\na change', 'Fixed\nwhen a change');
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(file, v1);
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'v1');
  writeFileSync(file, v2);
  const topic = topicOf('servers/jira.md', v2);
  const closing = ['which fix version on master and a stable branch', 'which resolution when a change fixed it',
    'fix version for a fix', 'closing an issue'];
  const old = { file: { questions: [], aliases: [] }, sections: {
    Closing: { questions: closing, aliases: [] },
    'Bulk edits': { questions: ['many issues at once'], aliases: [] } }, ...hashes(topicOf('servers/jira.md', v1)) };
  mkdirSync(join(root, '_meta', 'servers'), { recursive: true });
  writeFileSync(join(root, '_meta', 'servers', 'jira.json'), JSON.stringify(old));

  const previous = changesOf(root, topic, old);
  assert.deepEqual(previous.added, { Closing: ['Set Fix Version/s to the next version of every branch the fix landed '
    + 'on, except a more recent branch while X.Y.0 is unreleased.'] });
  assert.deepEqual(previous.missing, []);
  assert.deepEqual(previous.ranks.map(([, q, r]) => [q, r]), closing.map((q) => [q, 1]));
  // All four are what the section is found by, so the code allows a fifth, and only there.
  assert.deepEqual(fifths(previous), ['Closing']);
  const text = prompt(topic, [topic], previous);
  assert.match(text, /section "Closing"[^\n]*\n {2}its best search match for: \["which fix version/);
  assert.match(text, /new sentences:\n {4}> Set Fix Version\/s[^\n]*unreleased\.\n {2}may have 5 questions/);
  assert.doesNotMatch(text, /> Choose the resolution/);
  const answer = (n) => ({ file: { questions: ['f', 'g'], aliases: [] }, related: [], applies_to: [],
    sections: topic.headings.map((h) => ({ heading: h, questions: ['a', 'b', 'c', 'd', 'e'].slice(0, n), aliases: [] })) });
  const counts = (s) => Object.values(s.sections).map((m) => m.questions.length);
  assert.deepEqual(counts(toSidecar(topic, answer(5), new Set(), fifths(previous))), [5, 4]);
  assert.deepEqual(counts(toSidecar(topic, answer(5), new Set())), [4, 4]);

  // A question another section answers better is not marked, and then no fifth is allowed.
  const mixed = { ...old, sections: { ...old.sections,
    Closing: { questions: [...closing.slice(0, 3), 'use the REST API to edit many issues at once'], aliases: [] } } };
  writeFileSync(join(root, '_meta', 'servers', 'jira.json'), JSON.stringify(mixed));
  const partly = changesOf(root, topic, mixed);
  assert.notEqual(partly.ranks.at(-1)[2], 1);
  assert.deepEqual(fifths(partly), []);
  assert.doesNotMatch(prompt(topic, [topic], partly), /may have 5/);
  // A best match is its part's own: the same question in another part is not marked there.
  const shared = { ...previous, sections: { ...previous.sections, 'Bulk edits': { questions: [closing[1]] } } };
  assert.doesNotMatch(prompt(topic, [topic], shared), /section "Bulk edits"[^\n]*\n {2}its best search match/);

  // Outside git, or with no recorded hash, there is no old text: the section is listed as missing.
  const noGit = mkdtempSync(join(tmpdir(), 'no-git-'));
  t.after(() => rmSync(noGit, { recursive: true, force: true }));
  mkdirSync(join(noGit, 'servers'));
  writeFileSync(join(noGit, 'servers', 'jira.md'), v2);
  assert.deepEqual(oldSectionTexts(noGit, topic, old), {});
  assert.deepEqual(changesOf(noGit, topic, old).missing, ['Closing']);
  assert.deepEqual(oldSectionTexts(root, topic, { ...old, section_hashes: undefined }), {});
});
