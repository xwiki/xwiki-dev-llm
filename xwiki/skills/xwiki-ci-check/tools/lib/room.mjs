/*
 * The room as an input: what the team said about an incident, which may only ever buy silence.
 * Part of ci-check.mjs.
 */

import { JIRA } from '../../../../scripts/jira-flickers.mjs';
import { namesIn } from '../matrix.mjs';
import { forwardKeys, shortly } from './fix-signals.mjs';
import { readFileSync } from 'node:fs';

// ---- The room --------------------------------------------------------------------------------
// The fourth and fifth ways a red test is nobody's defect — and the only two the routine learns by
// listening rather than by measuring.
//
// A failure can be *announced*: "I'm pushing the reproduction test case today such that it will be
// executed tonight and fail". Nothing but the room knows that. Without it the
// sweep attributes tonight's red to the person who said it and comments on their commit — the worst
// output this tool has, because it is wrong in someone's name about something they told everyone
// about first. And a failure can be *claimed*: "I'm currently on XWIKI-23740", "I investigated the
// lock issue, it's the default isolation level on MySQL". Analysing that again is the noise.
//
// Three rules hold this together, and none of them is negotiable:
//
// 1. **Chat may suppress, never trigger.** It is untrusted text — anyone in the room writes it —
//    entering a context that writes to GitHub, JIRA and Matrix under a bot identity. If it can only
//    ever buy silence, the worst a hostile or joking message achieves is a quieter routine. The
//    asymmetry costs nothing, because suppression is where the whole value is.
// 2. **Chat never touches blame.** A culprit sourced from a joke would be wrong in someone's name.
//    Nothing here reaches `attribute`; it sets `fixState`, which *removes* a name.
// 3. **A claim decays.** Both values are anchored on the build that the incident's current streak
//    starts in, so a regression window that moves throws the claim away: "I'm on it" from last week
//    is not a reason to be quiet about a test that broke again this morning.
//
// Because this suppresses on a *sentence* where the other passes suppress on a commit, a PR or a
// timestamp, it is marked `fromChat`, and references/digest.md requires the digest line it earns to be
// posted whatever else is cut. The routine's reading of the room goes back into the room, where the
// person who wrote the sentence is reading it and can say it was misread.

/** How long a claim of ownership is worth anything. Two mornings, not three. */
const CLAIM_HOURS = 48;

/**
 * A failure foretold, in the words people actually use for it.
 *
 * The window between the intent and the outcome is what this has to allow: the sentence that
 * started this whole pass is *"my plan is to push the reproduction test case on master today such
 * that it will be executed tonight and **fail**"*, where eight words separate `will` from `fail`.
 * Matching only the adjacent pair reads as narrow and is simply wrong — measured on 2026-09-18,
 * `will (?:fail|break)` misses that message, which is the one message the design exists for. So:
 * both halves, in order, inside one clause.
 */
const ANNOUNCES =
  /\b(?:will|going to|expected to|it'll)\b[^.!?\n]{0,60}?\b(?:fail|fails|break|breaks|be red|go red|turn red|not pass)\b/i;
/** …unless it says the opposite, which the same words do. */
const ANNOUNCES_NOT = /\b(?:not|never|shouldn't|should not|won't|will not|no longer)\s+(?:\w+\s+){0,3}?(?:fail|break)\b/i;
// Somebody has taken it. A claim is credited to whoever wrote it, so it must be the writer saying
// *they* own *this failure* — and the room says much else in the first person. Each of these was
// read as a claim before (2026-10-17): "I know you're working on it" (about someone else), "let me
// know and I'll handle the backport" (an offer, about a backport), "I've opened <PR> for the
// leftovers" (a report — and filed issues, PRs and pushed fixes are read from JIRA, GitHub and the
// commits, not from what anyone says about them).

/** "I'm on it", "I'll take care": a claim with nothing more to say. */
const CLAIM_WHOLE =
  /\bI(?:['’]m| am) (?:on it|on this|on that|taking care(?! of))\b|\bI(?:['’]ll| will) take care(?! of)\b/i;
/** A verb of ownership, which only claims something when its object is the failure. */
const CLAIM_VERB =
  /\bI(?:['’]m| am) (?:currently )?(?:working on|investigating|debugging|fixing|handling|looking (?:at|into)|taking care of|having a look at|taking a look at)\s+|\bI(?:['’]ll| will) (?:fix|handle|investigate|debug|look (?:at|into)|take care of|have a look at|take a look at)\s+/gi;
/** …and the objects that are the failure: a pronoun for it, or its test or issue named. */
const CLAIM_OBJECT =
  /^(?:(?:it|this|that|them|this one|that one)\b|(?:the |this |that )(?:failure|flicker|test|issue)s?\b|`?[A-Z]\w*(?:IT|Test)\b|`?[A-Z][A-Z0-9]{1,9}-\d+)/;
const CLAIM_OBJECT_WORD = /^(?:it|this|that|them|this one|that one|(?:the|this|that) (?:failure|flicker|test|issue)s?)\b/i;
/** A question, a condition or an offer claims nothing: "should I look at it?", "if nobody is, I'll fix it". */
const NOT_A_CLAIM = /\?|\b(?:if|unless|let me know|want me to|should I|shall I|can I|could I)\b/i;

/** Whether one sentence is its writer taking the failure it names (or that "it" refers to). */
export function isClaim(clause) {
  if (NOT_A_CLAIM.test(clause)) return false;
  if (CLAIM_WHOLE.test(clause)) return true;
  return [...clause.matchAll(CLAIM_VERB)].some(match => {
    const rest = clause.slice(match.index + match[0].length);
    return CLAIM_OBJECT.test(rest) || CLAIM_OBJECT_WORD.test(rest);
  });
}

/** The sentences (or lines) of a message or comment. */
const clausesOf = body => String(body).split(/(?<=[.!?])\s+|\n+/);

/** Whether any sentence of `body` is a claim. */
const claims = body => clausesOf(body).some(isClaim);

/**
 * The part of a message a claim is about: its sentences or lines that make one. A message that
 * claims one test and mentions another in passing ("…I'm on it. There's also CollaborationIT, but
 * it's a known flicker") claims only the first.
 */
export function claimedPart(body) {
  const clauses = clausesOf(body).filter(isClaim);
  const names = clauses.length ? namesIn(clauses.join('\n')) : null;
  if (names) return { names };
  // "XWIKI-123 fails again. I'm on it." — the claim names nothing itself, so it is about the
  // message's subject, but only when the message has exactly one.
  const whole = namesIn(body);
  return clauses.length && whole && whole.tests.filter(name => !name.includes('#')).length <= 1
    && whole.jira.length <= 1 ? { names: whole } : null;
}

/** What the last runs concluded, as `matrix.mjs --last-memory` printed it, or nothing: it fails open. */
export function memoryOfArgs(args) {
  if (!args.memory) return {};
  try {
    return JSON.parse(readFileSync(args.memory, 'utf8'))?.memory || {};
  } catch {
    return {};
  }
}

/** The room's messages, as `matrix.mjs --since` printed them, or none when it was not read. */
export function chatOf(args) {
  if (!args.chat) return { available: false, messages: [] };
  try {
    const read = JSON.parse(readFileSync(args.chat === '-' ? 0 : args.chat, 'utf8'));
    return { available: read?.available !== false, messages: read?.messages || [] };
  } catch {
    return { available: false, messages: [] };
  }
}

/**
 * The names this incident answers to in prose: the simple class names of its failing tests, its
 * JIRA key, and its own build.
 *
 * Class names and not file names, exactly as `inFlightKeys` reasons — a chat message writes
 * `DocExtraTabsIT`, never `DocExtraTabsIT.java` — and grouped per failing class, so coverage is
 * counted in tests and an incident spanning five classes is not silenced by a sentence naming one.
 */
function chatKeys(incident) {
  const groups = forwardKeys(incident).groups
    .map(keys => keys.filter(key => key.endsWith('.java')).map(key => key.replace(/\.java$/, '')));
  return {
    groups,
    jira: incident.jira?.key || null,
    // `https://ci.xwiki.org/job/…/job/master/1377/` — the job path and the build number, which is
    // the one identifier a human pastes that matches an incident exactly rather than by name.
    build: incident.buildUrl ? incident.buildUrl.replace(/\/+$/, '') : null,
    // The packages and methods the incident's own tests are in, to tell its `ImageIT` from the
    // other `ImageIT`s the room talks about. See `namesIncident`.
    packages: [...new Set((incident.tests || []).map(id => id.split('#')[0].split(/[.$]/).slice(0, -1))
      .filter(parts => parts.length > 1).map(parts => parts.join('.')))],
    methods: [...new Set((incident.tests || []).map(id => id.split('#')[1]).filter(Boolean))]
  };
}

// A chat message is the *weakest* evidence any pass here runs on — a sentence, written by anyone,
// naming a class by the short name three modules happen to share — and it is the only evidence that
// buys silence without a build, a commit or a PR behind it. So it is matched more strictly than a
// pull request is, not more loosely, and these two guards are why.
//
// Both are contradictions, never requirements: a message that says nothing about the package or the
// method still matches, because that is how people write. It is a message that names a *different*
// one that is thrown away. Measured on the live room, 2026-09-18: without them, a discussion of
// `org.xwiki.ckeditor…ImageIT` on stable-18.8.x was attached to `org.xwiki.blocknote…ImageIT#editImage`
// on master, on nothing but the four letters they share.

/** Whether the message talks about some other module's class of the same name. */
const otherPackage = (message, keys) => {
  const named = message.names?.packages || [];
  return !!named.length && !!keys.packages.length
    && !named.some(one => keys.packages.some(ours => ours.startsWith(one) || one.startsWith(ours)));
};

/** Whether the message pins a method, and every method it pins belongs to some other failure. */
const otherMethod = (message, keys) => {
  const pinned = (message.names?.tests || []).filter(name => name.includes('#'));
  return !!pinned.length && !!keys.methods.length
    && !pinned.some(name => keys.methods.includes(name.split('#')[1]));
};

/** Whether `message` names this incident at all — the mechanical half, before any judging. */
function namesIncident(message, keys) {
  if (otherPackage(message, keys) || otherMethod(message, keys)) return null;
  const named = new Set(message.names?.tests || []);
  if (keys.jira && (message.names?.jira || []).includes(keys.jira)) return keys.groups;
  if (keys.build && (message.names?.builds || []).some(url => url.replace(/\/+$/, '') === keys.build)) {
    return keys.groups;
  }
  // A group is named when the message names the class, however it wrote it — bare, or with the
  // method, which `namesIn` emits both of.
  const covered = keys.groups.filter(group => group.some(name => named.has(name)
    || [...named].some(token => token.split('#')[0] === name)));
  return covered.length ? covered : null;
}

/**
 * What the room already said about this incident: an announcement made *before* the build that
 * shows it, or a claim of ownership made *after* it and still fresh.
 *
 * The two guards are timestamps, not prose, and they are what makes a sentence usable at all. An
 * announcement that post-dates the red build is a comment on it, not a warning; a claim that
 * pre-dates it was about a previous occurrence of the same test, which is precisely the "I'm on it
 * from last week" this must not honour.
 *
 * Fails open like every other pass: no chat file, an unreadable room, a message that matches
 * nothing — the incident is left exactly as it was, reported and attributed.
 */
export function chatClaim(incident, chat, want) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  const brokeAt = incident.window?.firstBad?.timestamp;
  if (!brokeAt) return null;
  const keys = chatKeys(incident);
  if (!keys.groups.length || keys.groups.some(group => !group.length)) return null;
  const fresh = Date.now() - CLAIM_HOURS * 3600 * 1000;
  const wanted = message => {
    const at = Date.parse(message.at);
    return want === 'announced'
      ? at < brokeAt && ANNOUNCES.test(message.body) && !ANNOUNCES_NOT.test(message.body)
      : at >= brokeAt && at >= fresh && claims(message.body);
  };
  // A claim covers what its own sentence names, not everything else the message mentions.
  const about = message => (want === 'announced' ? message : claimedPart(message.body));
  const matched = chat.messages
    .map(message => ({ message, part: wanted(message) ? about(message) : null }))
    .map(({ message, part }) => ({ message, covers: part ? namesIncident(part, keys) : null }))
    .filter(entry => entry.covers);
  if (!matched.length) return null;
  // The most explanatory message wins, and the most recent of those — the same rule `inFlightFix`
  // uses to avoid pointing a reader at the narrower of two answers.
  const [{ message }] = [...matched].reverse().sort((a, b) => b.covers.length - a.covers.length);
  // Coverage is counted over *every* matching message, as the other passes count it over every
  // commit: two people naming one failing class each answer for both, and only a full house is
  // `settled` and goes quiet.
  const covered = keys.groups.filter(group => matched.some(entry => entry.covers.includes(group)));
  return {
    kind: want,
    fromChat: true,
    author: message.sender,
    // Quoted, and bounded: what goes in the work order is evidence of what was said, not a channel
    // through which a long message reaches a model's instructions.
    title: `"${message.body.replace(/\s+/g, ' ').trim().slice(0, 200)}"`,
    url: message.permalink,
    at: message.at,
    where: want === 'announced'
      ? `said in the room ${shortly(Date.parse(message.at), brokeAt)} before build `
        + `#${incident.firstBadBuild} ran`
      : `said in the room on ${message.at.slice(0, 16).replace('T', ' ')}, after build `
        + `#${incident.firstBadBuild}`,
    covers: covered.map(group => group[group.length - 1]),
    of: keys.groups.length,
    partial: keys.groups.length > 1 && covered.length < keys.groups.length,
    reason: want === 'announced'
      ? 'the room was told this failure was coming, so the commit it would be pinned on did not '
        + 'break anything that was working'
      : 'somebody in the room has said they are on it, within the last two days and after this '
        + 'build'
  };
}

/**
 * Every message that names this incident, whatever it says about it.
 *
 * Separate from `chatClaim` on purpose: suppression needs a phrase and a timestamp to agree, but
 * *citing* the room needs neither. "I investigated the lock issue, it's the default isolation level
 * on MySQL — XWIKI-25019" suppresses nothing and is the single most useful line the digest can
 * carry about that incident, because the analysis is done and published and the routine's own would
 * be a worse copy of it.
 */
export function mentionsOf(incident, chat) {
  if (incident.beyondHorizon || !chat.messages.length) return [];
  const keys = chatKeys(incident);
  if (!keys.groups.length) return [];
  return chat.messages.filter(message => namesIncident(message, keys)).map(message => ({
    at: message.at,
    sender: message.sender,
    said: message.body.replace(/\s+/g, ' ').trim().slice(0, 200),
    permalink: message.permalink
  }));
}

// The same claim, made where it is most often made. A flicker issue's comments are chat with an
// address on the envelope: attributable and topical by construction, so the matching costs nothing
// — there is no incident to match, the issue *is* the incident's issue. One anonymous read per key,
// cached, and only for an incident that has a key at all.

const issueComments = new Map();
const commentsOn = (key) => {
  if (!issueComments.has(key)) {
    issueComments.set(key, (async () => {
      try {
        const res = await fetch(`${JIRA}/rest/api/2/issue/${encodeURIComponent(key)}` +
          '?fields=comment', { headers: { Accept: 'application/json' } });
        if (!res.ok) return [];
        const body = await res.json();
        return (body?.fields?.comment?.comments || []).map(comment => ({
          at: comment.created,
          author: comment.author?.displayName || comment.author?.name || null,
          body: String(comment.body || '')
        }));
      } catch {
        return [];
      }
    })());
  }
  return issueComments.get(key);
};

/**
 * Whether the incident's own JIRA issue says somebody is on it, said after this break and recently.
 *
 * Bounded exactly as the chat claim is, and for the same reason: a flicker issue collects "I'm
 * looking at this" comments over months, and honouring a year-old one would silence the test
 * forever. Unlike chat this answers for the whole incident only when the incident *is* that issue's
 * test — the key is the first failing test's flicker issue, and a comment on it says nothing about
 * four other classes that broke in the same build.
 */
export async function issueClaim(incident) {
  if (![1, 2].includes(incident.class) || incident.beyondHorizon) return null;
  const key = incident.jira?.key;
  const brokeAt = incident.window?.firstBad?.timestamp;
  // No GitHub gate: the flicker lookup already reads JIRA anonymously on every run, so the issue
  // this incident is tracked as is known even in the cheap mode, and asking it one more question
  // costs one anonymous GET, cached per key.
  if (!key || !brokeAt) return null;
  const { groups } = chatKeys(incident);
  if (groups.length !== 1) return null;
  const fresh = Date.now() - CLAIM_HOURS * 3600 * 1000;
  const [comment] = (await commentsOn(key)).filter(entry => {
    const at = Date.parse(entry.at);
    return at >= brokeAt && at >= fresh && claims(entry.body);
  }).slice(-1);
  if (!comment) return null;
  return {
    kind: 'being-handled',
    fromChat: true,
    author: comment.author,
    title: `"${comment.body.replace(/\s+/g, ' ').trim().slice(0, 200)}"`,
    url: `${JIRA}/browse/${key}`,
    at: comment.at,
    where: `commented on ${key} on ${String(comment.at).slice(0, 16).replace('T', ' ')}, after `
      + `build #${incident.firstBadBuild}`,
    covers: groups[0].slice(-1),
    of: 1,
    partial: false,
    reason: `its own issue ${key} carries somebody saying they are on it, within the last two days `
      + 'and after this build'
  };
}
