// Curates group (b) from solved forum threads: keeps durable, developer-relevant Q&As, extracts gold.
// Usage: node gen-b.mjs <threads.json> <count> <out b.json>
import fs from 'node:fs';
import { claudeJson, pool } from './claude.mjs';

const [inFile, countArg, outFile] = process.argv.slice(2);
const threads = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const count = Number(countArg || 30);

const schema = {
  type: 'object',
  properties: {
    keep: { type: 'boolean' },
    reason: { type: 'string' },
    question: { type: 'string', description: 'The asker\'s question, verbatim from the first post, trimmed to the part that asks (no greetings, no logs beyond one key error line).' },
    gold_answer: { type: 'string', description: 'The durable answer, distilled from the accepted post only.' },
    key_points: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
  required: ['keep', 'reason', 'question', 'gold_answer', 'key_points'],
};

const prompt = t => `You curate a benchmark of real questions for an assistant used by people who DEVELOP on XWiki: platform/extension developers, wiki-application and script (Velocity/Groovy) authors, and admins configuring XWiki. Below is a solved forum thread: the first post and the post marked as the solution.

Keep it (keep=true) ONLY if ALL hold:
- The question is about developing on, scripting, extending, configuring or contributing to XWiki (not a pure end-user how-to like "how do I bold text", not a hosting/account request).
- The accepted answer states a DURABLE fact, rule, API or approach that is still true for the current XWiki versions — not "upgrade to X.Y.Z", not a bug that got fixed, not a transient infrastructure incident, not "I solved it myself" without saying how.
- The answer is checkable from the accepted post alone.
- The question is understandable without the rest of the thread or attachments.

If kept: copy the question verbatim (you may cut greetings and long logs, never reword), distill gold_answer from the accepted post only, and give 1 to 4 key_points a correct answer must contain. If not kept, still fill the fields with empty strings / an empty list.

Thread "${t.title}" (${t.url}, ${t.created.slice(0, 10)}):
FIRST POST:
<<<
${t.question}
>>>
ACCEPTED ANSWER (post ${t.answer_post}):
<<<
${t.answer}
>>>`;

const graded = await pool(threads, 4, async t => {
  try {
    const r = await claudeJson(prompt(t), { model: 'opus', tools: '', jsonSchema: schema });
    console.error(`${t.topic} ${r.structured_output.keep ? 'KEEP' : 'drop'}: ${r.structured_output.reason.slice(0, 90)}`);
    return { t, g: r.structured_output };
  } catch (e) {
    console.error(`${t.topic} FAILED ${e.message}`);
    return null;
  }
});
const kept = graded.filter(x => x?.g.keep);
fs.writeFileSync(outFile.replace(/\.json$/, '-curation.json'), JSON.stringify(graded.filter(Boolean).map(x => ({ topic: x.t.topic, title: x.t.title, ...x.g })), null, 2));

// Balance categories, oldest-to-newest spread: alternate dev/discuss.
const byCat = { dev: kept.filter(x => x.t.cat === 'dev'), discuss: kept.filter(x => x.t.cat === 'discuss') };
const picked = [];
while (picked.length < count && (byCat.dev.length || byCat.discuss.length)) {
  for (const c of ['dev', 'discuss']) if (byCat[c].length && picked.length < count) picked.push(byCat[c].shift());
}
const out = picked.map((x, i) => ({
  id: `b${String(i + 1).padStart(2, '0')}`, group: 'b', question: x.g.question, kind: 'fact', key_points: x.g.key_points,
  gold: { answer: x.g.gold_answer, url: `${x.t.url}/${x.t.answer_post}`, created: x.t.created, cat: x.t.cat },
}));
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.error(`kept ${kept.length}/${threads.length}; wrote ${out.length}`);
