/**
 * The judgements of xwiki-daily-close outlive the day they were made: an item whose facts have not
 * changed since it was judged gets the same answer again, so a run only asks about what moved.
 *
 * The memory is one JSON object keyed by item id: `{ answer, fingerprint, judgedOn }`. It is kept by
 * daily-close.mjs in `<work root>/daily-close/answers.json`; this module only decides, so that the
 * rules can be tested without the network.
 */

import { createHash } from "node:crypto";

// Some verdicts change with time alone (a parked PR, a quiet thread that has become concludable):
// past this age an answer is asked again even when nothing moved.
export const MAX_ANSWER_DAYS = 14;
// A forum vote runs about 72 hours: a topic judged before its last post was that old may have
// become concludable since, without anyone posting.
export const VOTE_WINDOW_DAYS = 3;

const DAY = 864e5;
const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / DAY;

/**
 * The facts a judgement was made on. Everything the script gathered counts, except what changes only
 * because a day passed: the questions (they quote today's date, and their evidence is the item
 * itself) and the idle counter.
 */
export function fingerprint(item) {
  const { questions, daysIdle, stale, ...facts } = item;
  return createHash("sha1").update(JSON.stringify(facts)).digest("hex");
}

/** Whether a remembered judgement still holds for the item as collected `today`. */
export function stillValid(entry, item, today) {
  if (!entry || entry.fingerprint !== fingerprint(item)) return false;
  if (daysBetween(entry.judgedOn, today) > MAX_ANSWER_DAYS) return false;
  return !(item.kind === "topic" && daysBetween(item.lastActivity, entry.judgedOn) < VOTE_WINDOW_DAYS);
}

/**
 * Fills `answers` (today's answers file) from `memory` for the items still waiting for a judgement.
 * A carried answer says when it was made. Returns how many were carried.
 */
export function carryOver(items, answers, memory, today) {
  let carried = 0;
  for (const item of items) {
    if (answers[item.id] || !stillValid(memory[item.id], item, today)) continue;
    answers[item.id] = { ...memory[item.id].answer, carried: memory[item.id].judgedOn };
    carried++;
  }
  return carried;
}

/**
 * Records today's own answers in `memory`, with the facts they were made on. With `prune`, forgets
 * the items that are no longer open — only safe on a complete run, where a missing item is a closed
 * one rather than a category that failed to load.
 */
export function remember(items, answers, memory, today, { prune = false } = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const [id, answer] of Object.entries(answers)) {
    if (answer.carried || !byId.has(id)) continue;
    memory[id] = { answer, fingerprint: fingerprint(byId.get(id)), judgedOn: today };
  }
  if (prune) for (const id of Object.keys(memory)) if (!byId.has(id)) delete memory[id];
  return memory;
}
