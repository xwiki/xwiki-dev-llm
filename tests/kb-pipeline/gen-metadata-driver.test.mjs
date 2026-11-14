// The metadata step's driver, end to end on a temporary KB, with a stub `claude` on PATH: which topics
// call the model, which parts of a sidecar a run keeps, and what a failed call leaves behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/kb-pipeline/gen-metadata.mjs');

// Answers with one question per section and file, tagged FAKE_TAG; logs each call; FAKE_FAIL fails it.
const STUB = `#!/usr/bin/env node
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FAKE_LOG, 'CALL\\n');
if (process.env.FAKE_FAIL) process.exit(1);
const tag = process.env.FAKE_TAG;
const heads = [...input.split('Sections, in order:')[1].split('Other files of the knowledge base:')[0].matchAll(/^- (.+)$/gm)].map((m) => m[1]);
console.log(JSON.stringify({ total_cost_usd: 0, structured_output: {
  file: { questions: [tag + ' file'], aliases: [] },
  sections: heads.map((h) => ({ heading: h, questions: [tag + ' ' + h], aliases: [] })),
  related: [], applies_to: [] } }));
`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gen-meta-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'claude'), STUB);
  chmodSync(join(dir, 'bin', 'claude'), 0o755);
  mkdirSync(join(dir, 'kb', 'conventions'), { recursive: true });
  writeFileSync(join(dir, 'log'), '');
  const topic = join(dir, 'kb', 'conventions', 'logging.md');
  const sidecar = join(dir, 'kb', '_meta', 'conventions', 'logging.json');
  return {
    write: (summary, body) => writeFileSync(topic, `---\ntitle: Logging\nsummary: ${summary}\n---\n\n# Logging\n\n${body}\n`),
    run: (tag, env = {}) => {
      writeFileSync(join(dir, 'log'), '');
      const r = spawnSync('node', [script, '--root', join(dir, 'kb')], { encoding: 'utf8',
        env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_LOG: join(dir, 'log'), FAKE_TAG: tag, ...env } });
      return { status: r.status, calls: readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean).length };
    },
    raw: () => readFileSync(sidecar, 'utf8'),
    json: () => JSON.parse(readFileSync(sidecar, 'utf8')),
    setRaw: (o) => writeFileSync(sidecar, JSON.stringify(o)),
  };
}

const LEVELS = '## Levels\n\nUse info.';
const FORMAT = '## Format\n\nOne line.';
const questions = (j) => [j.file.questions[0], ...Object.entries(j.sections).map(([h, s]) => `${h}=${s.questions[0]}`)];

test('generate: no model call when nothing changed; reordering, deleting or reflowing sections keeps them', () => {
  const k = setup();
  k.write('About logs.', `${LEVELS}\n\n${FORMAT}`);
  assert.deepEqual(k.run('g1'), { status: 0, calls: 1 });
  assert.deepEqual(questions(k.json()), ['g1 file', 'Levels=g1 Levels', 'Format=g1 Format']);
  assert.deepEqual(k.run('g2'), { status: 0, calls: 0 });
  k.write('About logs.', `${FORMAT}\n\n${LEVELS}`);
  assert.deepEqual(k.run('g3'), { status: 0, calls: 0 });
  k.write('About logs.', `${FORMAT}\n\n\n\n`);
  assert.deepEqual(k.run('g4'), { status: 0, calls: 0 });
  assert.deepEqual(questions(k.json()), ['g1 file', 'Format=g1 Format']);
});

test('generate: a summary-only edit renews only the file part, a section edit only that section', () => {
  const k = setup();
  k.write('About logs.', `${LEVELS}\n\n${FORMAT}`);
  k.run('g1');
  k.write('About logging.', `${LEVELS}\n\n${FORMAT}`);
  assert.deepEqual(k.run('g2'), { status: 0, calls: 1 });
  assert.deepEqual(questions(k.json()), ['g2 file', 'Levels=g1 Levels', 'Format=g1 Format']);
  k.write('About logging.', `${LEVELS}\n\n## Format\n\nTwo lines.`);
  assert.deepEqual(k.run('g3'), { status: 0, calls: 1 });
  assert.deepEqual(questions(k.json()), ['g2 file', 'Levels=g1 Levels', 'Format=g3 Format']);
});

test('generate: a failed model call leaves the sidecar byte-identical and exits 1', () => {
  const k = setup();
  k.write('About logs.', `${LEVELS}\n\n${FORMAT}`);
  k.run('g1');
  const before = k.raw();
  k.write('About logs.', `${LEVELS}\n\n## Format\n\nTwo lines.`);
  assert.deepEqual(k.run('g2', { FAKE_FAIL: '1' }), { status: 1, calls: 2 });
  assert.equal(k.raw(), before);
});

test('generate: a current sidecar without hashes gets them, its generated text untouched, no model call', () => {
  const k = setup();
  k.write('About logs.', `${LEVELS}\n\n${FORMAT}`);
  k.run('g1');
  const { section_hashes: sections, file_hash: file, ...unhashed } = k.json();
  k.setRaw(unhashed);
  assert.deepEqual(k.run('g2'), { status: 0, calls: 0 });
  assert.deepEqual(k.json(), { ...unhashed, file_hash: file, section_hashes: sections });
});
