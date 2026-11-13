// Generates group (a) questions from sampled OKF sections.
// Usage: node gen-a.mjs <a-sections.json> <out a.json>
import fs from 'node:fs';
import { claudeJson, pool } from './claude.mjs';

const [inFile, outFile] = process.argv.slice(2);
const sections = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const schema = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    kind: { type: 'string', enum: ['fact', 'volatile-behaviour'] },
    key_points: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    avoided_terms: { type: 'array', items: { type: 'string' } },
  },
  required: ['question', 'kind', 'key_points', 'avoided_terms'],
};

const prompt = s => `You are building a retrieval benchmark for a knowledge base used by XWiki developers' coding agents.

Below is ONE section of that knowledge base. Write ONE question that an XWiki developer would plausibly ask in a coding session, whose correct answer is in this section.

Hard rules:
- Phrase it the way a developer would, from their situation ("I'm about to…", "Why does…", "Can I…"), NOT as a lookup of the section.
- AVOID the section's distinctive terms: its heading words, rule IDs (e.g. S1659), file names, and the exact jargon phrases the section uses. Use synonyms or describe the situation instead. List the terms you avoided in avoided_terms. The question must still be unambiguous for a knowledgeable XWiki developer.
- The answer must follow from this section alone. Prefer the section's most non-obvious rule or trap over its most obvious one.
- key_points: 1 to 4 short, checkable facts a correct answer MUST contain (taken from the section, not invented).
- If the section says a value is volatile and must be verified rather than quoted, set kind to "volatile-behaviour": ask for the value, and make the key points the expected behaviour (do not quote a cached value; where to verify it).

Section (file ${s.file}, heading "${s.section}"):
<<<
${s.text}
>>>`;

const results = await pool(sections, 4, async s => {
  const r = await claudeJson(prompt(s), { model: 'opus', tools: '', jsonSchema: schema });
  const q = r.structured_output;
  if (!q) throw new Error(`${s.id}: no structured output: ${JSON.stringify(r).slice(0, 300)}`);
  console.error(`${s.id} ok: ${q.question.slice(0, 100)}`);
  return { id: s.id, group: 'a', question: q.question, kind: q.kind, key_points: q.key_points,
    avoided_terms: q.avoided_terms, gold: { file: s.file, section: s.section } };
});
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
