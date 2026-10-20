/*
 * What one morning concluded, read back the next morning.
 *
 * Every run used to start from nothing: the same breakage was root-caused again each day to reach
 * the conclusion the day before had reached (16.10.x's ObjectEditorIT, every morning of a week),
 * while incidents lower in the budget were never analysed at all (PDFExportIT#pageRevision, four
 * mornings running). The conclusions already exist — the paste holds each analysed incident's
 * *Why* and *Next* cells and its root-cause paragraph — so the memory is the paste itself, plus one
 * folded block mapping its row numbers to incident ids. Nothing new for the model to write, and
 * nothing new to store: the last digest links the paste, and the paste keeps a week.
 *
 * Pure functions only; `matrix.mjs --last-memory` does the reading, `ci-check.mjs` the rendering.
 */

const BLOCK_HEAD = '<summary>Run memory — read back by the next run</summary>';
const FENCE = /```json\n([\s\S]*?)\n```/;

/**
 * The folded block a paste ends with.
 *
 * @param {string} date the run's day
 * @param {Map<string, number>} numbers incident id → row number
 * @param {object[]} incidents those worth remembering: `{id, state, analysedOn}`, and `asked` (the
 *   day its culprit was asked) and `proved` (the day the run last tried to prove it) when they apply
 */
export function memoryBlock(date, numbers, incidents) {
  const rows = {};
  for (const { id, state, analysedOn, asked, proved } of incidents) {
    if (numbers.has(id)) rows[numbers.get(id)] = { id, state, analysedOn, ...(asked ? { asked } : {}), ...(proved ? { proved } : {}) };
  }
  return ['', '<details>', BLOCK_HEAD, '', '```json', JSON.stringify({ v: 1, date, rows }), '```', '', '</details>'];
}

/** A table cell back to text: the renderer escaped pipes and turned newlines into `<br>`. */
const uncell = text => text.replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim();

/**
 * `{id: {state, analysedOn, asked, proved, why, next, analysis}}` from a paste's text, or `{}` when it carries no
 * memory block (a paste from before this existed, or not a paste of this skill at all).
 */
export function memoryOf(paste) {
  const text = String(paste || '');
  const start = text.indexOf(BLOCK_HEAD);
  const json = start >= 0 ? text.slice(start).match(FENCE) : null;
  if (!json) return {};
  let block;
  try {
    block = JSON.parse(json[1]);
  } catch {
    return {};
  }
  const out = {};
  for (const [number, { id, state, analysedOn, asked, proved }] of Object.entries(block.rows || {})) {
    // `| **3.** <what> | <why> | <next> |` — the cells are split on unescaped pipes only.
    const row = text.split('\n').find(line => line.startsWith(`| **${number}.** `));
    const cells = row ? row.slice(1, -1).split(/(?<!\\)\|/).map(uncell) : [];
    const details = text.match(new RegExp(`<summary><b>${number}</b> ·[^\\n]*</summary>\\n([\\s\\S]*?)\\n</details>`));
    // The root cause is the prose after the last fenced block or list of the evidence: kept short,
    // since it is context for the next run, not something to re-publish.
    const analysis = details ? details[1].split('\n\n').filter(part => part && !/^(```|- |\*\*Develocity|_The age)/
      .test(part.trim())).pop()?.trim().slice(0, 800) : undefined;
    out[id] = { state, analysedOn, asked, proved, why: cells[1], next: cells[2], analysis };
  }
  return out;
}

/** A conclusion still worth reusing: about the same state, and recent enough not to have gone stale. */
export function recallable(entry, state, today, maxAgeDays = 2) {
  if (!entry || entry.state !== state || !entry.analysedOn || !entry.why || !entry.next) return false;
  // A cell the run never filled is not a conclusion.
  if (/<!--/.test(entry.why + entry.next)) return false;
  const age = (Date.parse(today) - Date.parse(entry.analysedOn)) / 86400000;
  return age >= 0 && age <= maxAgeDays;
}
