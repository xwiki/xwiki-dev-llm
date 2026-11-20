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
  const previous = { file: null, sections: { Format: { questions: ['zebra crossing', 'kept wording'], aliases: [] } } };
  assert.deepEqual(rankDrops(root, topic, sidecar(['kept wording']), previous),
    [{ part: 'Format', question: 'zebra crossing', before: 1, after: null, kept: false }]);
  assert.deepEqual(rankDrops(root, topic, sidecar(['zebra crossing', 'kept wording']), previous), []);
  // A gone heading's question: reported only when no section of the file ranks for it.
  const gone = { file: null, sections: {}, gone: { Old: { questions: ['zebra crossing'], aliases: [] } } };
  assert.deepEqual(rankDrops(root, topic, sidecar(['kept wording']), gone),
    [{ part: 'Old', question: 'zebra crossing', before: 'heading gone', after: null, kept: false }]);
  assert.deepEqual(rankDrops(root, topic, sidecar(['zebra crossing']), gone), []);
});

test('a changed section shows the model its new lines and the questions it is found by', async (t) => {
  const { addedLines, bestMatches, hashes, oldSectionTexts, previousOf, prompt, topicOf } =
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
  // questions the section ranked first for were dropped and none asked about the exception.
  const v1 = '---\ntitle: JIRA\n---\n\n# JIRA\n\n## Closing\n\nSet Fix Version/s to the next version of every branch.\n'
    + 'Choose the resolution Fixed.\n\n## Bulk edits\n\nUse the REST API.\n';
  const v2 = v1.replace('every branch.\n', 'every branch,\nexcept a more recent branch while X.Y.0 is unreleased.\n');
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(file, v1);
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'v1');
  writeFileSync(file, v2);
  const before = topicOf('servers/jira.md', v1);
  const topic = topicOf('servers/jira.md', v2);
  const old = { file: { questions: [], aliases: [] }, sections: {
    Closing: { questions: ['which fix version on master and a stable branch', 'which resolution'], aliases: [] },
    'Bulk edits': { questions: ['many issues at once'], aliases: [] } }, ...hashes(before) };
  mkdirSync(join(root, '_meta', 'servers'), { recursive: true });
  writeFileSync(join(root, '_meta', 'servers', 'jira.json'), JSON.stringify(old));

  const texts = oldSectionTexts(root, topic, old);
  assert.deepEqual(Object.keys(texts), ['Closing']);
  const added = addedLines(texts.Closing, topic.sections.find((s) => s.heading === 'Closing').text);
  assert.deepEqual(added, ['Set Fix Version/s to the next version of every branch,',
    'except a more recent branch while X.Y.0 is unreleased.']);
  const previous = { ...previousOf(topic, old), added: { Closing: added } };
  previous.best = bestMatches(root, topic, old, previous);
  assert.deepEqual(previous.best, [['Closing', 'which fix version on master and a stable branch'],
    ['Closing', 'which resolution']]);
  // A best match is its part's own: the same question in another part is not marked there.
  const shared = { ...previous, sections: { ...previous.sections, 'Bulk edits': { questions: ['which resolution'] } } };
  assert.doesNotMatch(prompt(topic, [topic], shared), /section "Bulk edits"[^\n]*\n {2}its best search match/);

  const text = prompt(topic, [topic], previous);
  assert.match(text, /its best search match for: \["which fix version on master and a stable branch","which resolution"\]/);
  assert.match(text, /new or changed lines:\n {4}> Set Fix Version\/s[^\n]*\n {4}> except a more recent branch/);
  assert.match(text, /never\none listed as its best search match/);
  assert.match(text, /at least one of the part's questions asks for\nwhat they say/);
  // Outside git, or with no recorded hash, there is no old text to compare: no lines, no failure.
  const noGit = mkdtempSync(join(tmpdir(), 'no-git-'));
  t.after(() => rmSync(noGit, { recursive: true, force: true }));
  mkdirSync(join(noGit, 'servers'));
  writeFileSync(join(noGit, 'servers', 'jira.md'), v2);
  assert.deepEqual(oldSectionTexts(noGit, topic, old), {});
  assert.deepEqual(oldSectionTexts(root, topic, { ...old, section_hashes: undefined }), {});
});
