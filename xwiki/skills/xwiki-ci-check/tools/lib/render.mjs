/*
 * Rendering: the paste, the status grid, the delta against the last digest, and the digest. Part
 * of ci-check.mjs.
 */

import { JIRA } from '../../../../scripts/jira-flickers.mjs';
import { memoryBlock } from '../memory.mjs';
import { branchRank, classifyBranch } from './policy.mjs';
import { plural, settled, testName } from './util.mjs';

// ---- The paste ---------------------------------------------------------------------------------
// Rendered here, not by the model, for one reason: the paste is read every morning, and a document
// whose shape is re-invented each day is read as a new document each day.
//
// The shape is a table per branch — *what fails*, *why*, *what happens next and who does it* — over
// a collapsed block of evidence per row. That order is the document's argument: a reader who owns
// none of this is done after the tables, and a reader who owns one row opens one block. Nothing the
// sweep knows has been dropped; what changed is that the evidence no longer arrives before the
// answer, and that the rules the sweep obeys are no longer restated to the people who wrote them —
// they are in SKILL.md, which is where they belong.
//
// Three cells cannot be rendered, because they are the conclusion and not a field: a `deep`
// incident's *why* and *next* are one `<!-- WHY: id -->` / `<!-- NEXT: id -->` marker each, and its
// root cause is the `<!-- ANALYSIS: id -->` line inside its block. references/paste.md says how to fill all three.

const agedAs = incident => (incident.ageDays == null
  ? 'age unknown'
  : `${incident.ageIsLowerBound ? '≥' : ''}${incident.ageDays}d`);

/**
 * When the failure started — or, honestly, that it is not known.
 *
 * `firstBadBuild` with no `lastGoodBuild` means the sweep ran out of history (or of log budget)
 * before it found a green build, so that number is how far it looked and not when the break began.
 * Printing it as "since #N" is how the same unchanged incident comes out dated differently every
 * morning, and a digest whose dates move is one nobody checks.
 */
function windowOf(incident) {
  if (incident.firstBadBuild == null) return null;
  return incident.lastGoodBuild == null
    ? `failing in every build examined, back to #${incident.firstBadBuild} — start not established`
    : `since #${incident.firstBadBuild}, last good #${incident.lastGoodBuild}`
      + (incident.maskedBy ? ` — #${incident.maskedBy.build} stopped earlier, on \`${incident.maskedBy.by}\`,`
        + ' so this may have been there, hidden: the window reaches back past it' : '');
}

const shortName = incident => testName(incident.id.split('/').slice(2).join('/'));
const analysis = incident => (incident.deep ? [``, `<!-- ANALYSIS: ${incident.id} -->`] : []);
/** How an answer is named in prose — a sha, a PR by its number, or the person who said it. */
export const fixName = fix => (fix.kind === 'fix-in-flight' ? `PR #${fix.number}`
  : fix.fromChat ? `${fix.author || 'somebody'}` : fix.sha);
const fixRef = fix => (fix.kind === 'fix-in-flight' ? `PR #${fix.number}`
  : fix.fromChat ? `[what was said](${fix.url})` : `\`${fix.sha}\``);
/**
 * The headline each kind of answer earns, what closes its paragraph, and its row's *Why* — the
 * answer is the reason, where a test's state words ("fails every run") would read as a defect.
 *
 * The wording is the whole difference between the two: a commit that touches the failing file has
 * landed and will be judged by the next build, whereas a PR naming the test is somebody's intent —
 * it may be the fix, it may be a rewrite that touches it, and it may never merge. Both buy the
 * same silence; only one of them may be reported as a fix.
 */
export const FIX_HEAD = {
  'fix-unbuilt': {
    why: 'a commit CI has not built yet looks like the fix',
    whole: 'Possibly fixed already', part: 'Part of this may be fixed already', link: 'by',
    quiet: 'Not analysed, nobody pinged — the next build settles it.'
  },
  'fix-in-flight': {
    why: 'an open PR names this test',
    whole: 'A fix may be in flight', part: 'Part of this may be in flight', link: '—',
    quiet: 'Not analysed, nobody pinged — the PR is where this gets settled.'
  },
  'stale-snapshot': {
    why: 'new test code ran against older production jars — no defect shown',
    whole: 'Ran against a stale snapshot', part: 'Part of this ran against a stale snapshot',
    link: '—',
    quiet: 'Not analysed, nobody pinged — the next Environment Tests run has the production code.'
  },
  announced: {
    why: 'the room was told this was coming',
    whole: 'Announced in the room before it broke', part: 'Part of this was announced in the room',
    link: '—',
    quiet: 'Not analysed, nobody pinged — the room was told this was coming, so the commit this '
      + 'would otherwise be pinned on broke nothing that was working.'
  },
  'being-handled': {
    why: 'somebody has said they are on it',
    whole: 'Somebody has said they are on it', part: 'Part of this is claimed',
    link: '—',
    quiet: 'Not analysed, nobody pinged — it is claimed, and the claim is at most two days old.'
  },
  'fixed-elsewhere': {
    why: 'green again on another branch',
    whole: 'Already fixed on another branch', part: 'Part of this is fixed on another branch',
    link: 'by',
    quiet: 'Not analysed, nobody pinged — this is a backport candidate: hand the commit to'
      + ' `xwiki-backport`, and verify it first, since a signature also goes green when the test is'
      + ' deleted.'
  }
};
/**
 * What the room said about this incident, minus whatever is already quoted above it as the answer.
 *
 * This is the half of the room read that suppresses nothing: somebody has found the cause, filed
 * the issue or claimed the test, and none of that is visible on any dashboard. Cited, never
 * summarised — the permalink goes back to the sentence, in its own context, where the person who
 * wrote it can see how it was read.
 */
const said = incident => (incident.chat || [])
  .filter(message => message.permalink !== incident.fixState?.url);
const chatBlock = incident => (said(incident).length
  ? ['', '**Said in the room** — the analysis may already be done:',
    ...said(incident).map(message =>
      `- **${message.sender}**, ${message.at.slice(0, 16).replace('T', ' ')}: "${message.said}" ` +
      `[link](${message.permalink})`)]
  : []);

/**
 * What the quality gate failed on, and whose code is under it.
 *
 * Printed wherever the incident is — deep or not — because for a gate failure this *is* the
 * evidence: the stage log's one line says only that the gate failed, and everything a reader needs
 * in order to act is here. The names are the authors of the code under the failing condition, which
 * is a weaker claim than "broke the build" and is worded as one.
 */
function sonarBlock(incident) {
  const sonar = incident.sonar;
  if (!sonar) return [];
  const out = ['', `**Quality gate — ${sonar.conditions.map(condition =>
    `${condition.name} is ${condition.actual}, the gate wants ${condition.threshold}`).join('; ')}**` +
    ` (new code: ${sonar.newCodePeriod}${sonar.newCodeSince ? `, since ${sonar.newCodeSince}` : ''}).`];
  if (sonar.total > sonar.issues.length) {
    out.push(`${sonar.total} issues fail it; the newest ${sonar.issues.length} are what turned it red:`);
  }
  for (const issue of sonar.issues) {
    out.push(`- \`${issue.file.split('/').pop()}:${issue.line ?? '?'}\` — ${issue.rule}` +
      `${issue.severity ? ` (${issue.severity})` : ''}, raised ${issue.raisedOn} — ${issue.message}` +
      `${issue.author ? `\n    author: ${issue.author}${issue.authorUnresolved ? ' (no commit in the window is theirs)' : ''}` : ''}` +
      `${issue.commit ? `${issue.author ? ' ·' : '\n   '} introduced by \`${issue.commit.short}\`` +
        ` (${issue.commit.author}, ${issue.commit.date}) — ${issue.commit.title}`
        : `${issue.author ? ' ·' : '\n   '} no commit touched this file when it was raised — an existing` +
          ' line, newly reported'}`);
  }
  if (sonar.unequivocal && sonar.target) {
    // Where §4 actually comments: the commit, rather than the PR, when another incident shares it.
    const onPr = sonar.target.kind === 'pr' && !incident.commentedWith && (!incident.commentable || !!incident.commentable.pr);
    out.push(`_One person put all of this here — ${onPr
      ? `comment on **PR #${sonar.target.number}** (${sonar.target.url})`
      : `comment on **\`${sonar.target.short}\`**${incident.commentedWith ? ', one comment with the other incident it broke' : ''}`
        + ` (${incident.commentable?.url || sonar.target.url})`}, per §4._`);
  } else if (sonar.culprits?.length) {
    out.push(`_Whose code: ${sonar.culprits.map(entry => `**${entry.who}** (${plural(entry.issues, 'issue')}` +
      `${entry.commits.length ? `, ${entry.commits.join(', ')}` : ''})`).join(', ')}._` +
      `${sonar.equivocalBecause ? ` _Reported and not pinged: ${sonar.equivocalBecause}._` : ''}`);
  } else if (sonar.equivocalBecause) {
    out.push(`_Nobody is named: ${sonar.equivocalBecause}._`);
  }
  out.push(`_The gate: ${sonar.url}_`);
  if (sonar.issuesUnavailable) out.push(`_Could not list the issues: ${sonar.issuesUnavailable}._`);
  return out;
}

/**
 * What 28 days of executions say about this test, as against what tonight's job says.
 *
 * Printed above the blame on purpose: it is the block that decides whether there is a culprit to
 * look for at all. A test that has been failing 2% of the time since August was not broken by a
 * commit in tonight's window, however well that commit's files overlap — and the configuration
 * enrichment ("only on Chrome") is a cause, where a red square is only a symptom.
 *
 * The analyser's own sentences are quoted, not paraphrased: they carry p-values, and rewording a
 * p-value is how a hedge becomes a claim.
 */
function develocityBlock(incident) {
  const facts = incident.develocity;
  if (!facts) return [];
  const started = facts.firstSeen
    ? `first failed ${facts.firstSeen} (${facts.firstSeenDays}d ago), last ${facts.lastSeen}`
    : 'start not established';
  const out = ['',
    `**Develocity — ${facts.windowDays} days, every branch** (\`${testName(facts.test)}\`` +
    `${incident.testCount > 1 ? ', the test naming this incident' : ''}): ` +
    `${facts.failures} failures in ${facts.runs} executions (${facts.failRate}), ${started}.`,
    // The one line that reconciles the two ages, because they look like a contradiction otherwise.
    `_The age above is the current streak in the builds Jenkins retains; this is when the failure ` +
    `started._`];
  // Only where it disambiguates: with one distinct failure the findings below say so in a sentence,
  // and a line repeating it in numbers is the kind of padding that makes a paste stop being read.
  if (facts.group && facts.distinct > 1) {
    out.push(`- This incident is ${facts.group.label} \`${facts.group.exception}\` — ` +
      `${facts.group.count} of ${facts.failures} failures (${facts.group.share}), ` +
      `${facts.distinct} distinct failures in all`);
  }
  for (const finding of facts.findings) out.push(`- ${finding}`);
  // The per-configuration *rates*, which the findings do not carry: "3/26 on Chrome+PostgreSQL" is
  // what a repeat run has to reproduce, and S8's oracle needs the configuration to run it on.
  if (facts.configs.length) out.push(`- Concentrated in: ${facts.configs.join(' | ')}`);
  if (facts.scans.length) out.push(`- Build scans: ${facts.scans.join(' · ')}`);
  if (facts.artifacts) {
    out.push(`- Archived by Jenkins (${facts.artifacts.config}): ` +
      [facts.artifacts.screenshot && `[screenshot](${facts.artifacts.screenshot})`,
        facts.artifacts.video && `[video](${facts.artifacts.video})`].filter(Boolean).join(' · '));
  }
  // The analyser's full report is *not* named here. It is a path in a temp directory on the machine
  // that ran the sweep — live for the pass that writes the analysis, which reads it from the work
  // order's `develocity.report`, and gone by the time anybody opens the paste.
  return out;
}

function evidenceBlock(incident) {
  if (!incident.evidence?.length) return [];
  // ` | ` between them, never a comma: one environment is itself a comma-separated row ("MySQL
  // latest, Tomcat 11-jdk25, Filesystem, Chrome"), so joining two with commas makes eight facets
  // of one imaginary environment.
  return ['', '```', ...incident.evidence, '```', ...(incident.envs?.length
    ? [`Failing environments: ${incident.envs.join(' | ')}`] : [])];
}

/**
 * The one paragraph an incident somebody has already answered gets, in place of everything else.
 *
 * Hedged, always, because the claim rests on a name overlap and not on a green build: what settles
 * it is the next build, or the merge, and this paragraph exists only to stop the routine arguing
 * with people who have already moved on.
 */
function fixBlock(incident) {
  const fix = incident.fixState;
  if (!fix) return [];
  const head = `${fixRef(fix)} **${fix.author || '(unknown)'}** — ${fix.title}`;
  const where = fix.where[0].toUpperCase() + fix.where.slice(1);
  // A name match only, and whether it answers this failure is the run's to decide (§3): either
  // wording would be false half the time, so the run writes the line once it has read the PR.
  if (fix.candidate) return ['', `<!-- CANDIDATE: ${incident.id} -->`];
  if (fix.partial) {
    const rest = fix.of - fix.covers.length;
    return ['', `**${FIX_HEAD[fix.kind].part}** — ${head}`,
      `${where}; ${fix.reason}. It covers ${fix.covers.join(', ')} — the other ` +
      `${plural(rest, 'failing test')} ${rest === 1 ? 'is' : 'are'} left unanswered, so this incident stands.`];
  }
  // Where the incident spans several tests, the commit or PR named above answers for one of them
  // and the sentence has to say what answers for the rest — otherwise the line reads as a fix for a
  // test it does not mention.
  const whole = fix.of > 1
    ? ` All ${fix.of} failing tests (${fix.covers.join(', ')}) are answered the same way.`
    : '';
  return ['', `**${FIX_HEAD[fix.kind].whole}** — ${head}`,
    `${where}; ${fix.reason}.${whole} ${FIX_HEAD[fix.kind].quiet}`];
}

function blameBlock(incident) {
  // Before the `blame` guard, not after: a settled incident is never deep, and the work order
  // carries no blame for an incident below the line — so testing `blame` first would drop the one
  // line that says why nothing was written. A *partial* fix is printed above the blame it does
  // not cancel.
  if (settled(incident)) return fixBlock(incident);
  const out = fixBlock(incident);
  const blame = incident.blame;
  if (!blame) return out;
  if (blame.culprit) {
    out.push('', `Blame **${blame.tier}** — ${blame.reason}.`,
      `Culprit: \`${blame.culprit.short}\` **${blame.culprit.author || '(unknown)'}** — ` +
      `${blame.culprit.title} [${plural(blame.culprit.filesChanged ?? 0, 'file')}]`);
  } else if (blame.suspects?.length) {
    out.push('', `Blame **${blame.tier}** — ${blame.reason}.`);
  }
  // With neither a culprit nor a suspect there is nothing here to show: "nobody is pinged, because
  // a gate has no single author" is the row's own *next* cell, and printing the same sentence again
  // under the evidence is how a three-incident morning came to read as a wall of text.
  for (const suspect of blame.suspects || []) out.push(`- ${suspect}`);
  if (incident.silent) out.push(`_Already commented in this state (${incident.notified?.state}) — saying nothing._`);
  return out;
}

/** What two incidents on two branches share when they are one break: the repo, and the signature. */
const causeKey = incident => `${incident.repo}\u0000${incident.id.split('/').slice(2).join('/')}`;

/** Whether this incident is the red quality gate, which is a build break with its own vocabulary. */
export const isGate = incident => /sonar-gate:failed$/.test(incident.signature || '');

/**
 * Release-blocking, as §5 means it — recomputed here from the digested incident rather than shared
 * with the run's own `blocksRelease`, which reads fields (`alerting`) the work order does not carry.
 */
const blocking = incident => incident.branchClass !== 'transient' && incident.primary !== false
  && !settled(incident) && (incident.class === 2
    || (incident.class === 1 && incident.state === 'systematic' && !incident.beyondHorizon));

/** What a reader calls the thing that is red, as plain text — the table and the summary style it. */
function subjectOf(incident) {
  if (isGate(incident)) return 'Sonar quality gate';
  if (incident.class === 1) return shortName(incident);
  if (incident.class === 3) return incident.state || 'infrastructure';
  return incident.signature ? incident.signature.split('/').pop() : incident.kind;
}

/** What kind of red it is, in two or three words. */
function kindOf(incident) {
  if (isGate(incident)) return 'quality gate';
  if (incident.class === 2) return 'build break';
  if (incident.class === 3) return 'infrastructure';
  if (incident.class === 1) {
    const what = incident.kind === 'test-breakage' ? 'breakage' : 'flicker';
    return incident.testCount > 1 ? `${what}, ${plural(incident.testCount, 'test')}` : what;
  }
  return incident.kind;
}

const STATE_WORDS = {
  systematic: 'fails every run', 'single env': 'one environment, every build',
  'first seen': 'seen once', intermittent: 'intermittent'
};

/**
 * Column two when the renderer can answer it: the mechanical *why*.
 *
 * A gate is the one failure whose real explanation is already a field — the condition it failed and
 * the value it wanted — so it is written here and no analysis slot is spent restating two nouns.
 * Everything else below the deep line gets the numbers that distinguish it from its neighbours (how
 * often, over what, in how many environments), which is as far as a renderer can honestly go.
 */
function whyOf(incident) {
  if (settled(incident)) return FIX_HEAD[incident.fixState.kind].why;
  if (incident.sonar?.conditions?.length) {
    return incident.sonar.conditions
      .map(condition => `${condition.name} is ${condition.actual}, the gate wants ${condition.threshold}`)
      .join('; ');
  }
  if (incident.class === 3) {
    const gap = incident.snapshotGap;
    return gap ? `the environment — or the stale snapshot: its jars are from main #${gap.deployedBuild}, `
      + `${plural(gap.behind, 'commit')} behind, ${gap.changes} `
      + `of them production changes (newest: ${gap.production.map(commit => `\`${commit.sha}\``).join(', ')})`
      : 'the agent or the environment, not the code';
  }
  const bits = [];
  if (incident.class === 1) {
    bits.push(STATE_WORDS[incident.state] || incident.state);
    if (incident.failedIn) bits.push(incident.failedIn);
    if (incident.develocity) {
      bits.push(`${incident.develocity.failures}/${incident.develocity.runs} over ` +
        `${incident.develocity.windowDays}d everywhere it runs`);
    }
  } else if (incident.evidence?.length) {
    bits.push(incident.evidence[0].replace(/\s+/g, ' ').slice(0, 110));
  } else if (incident.state) {
    bits.push(incident.state);
  }
  return bits.filter(Boolean).join(' · ');
}

/**
 * The key of an incident's open flicker issue. The sweep holds the issue, the work order holds only
 * its key, and `--render-detail` renders from the work order — so both shapes reach the renderer.
 */
export const jiraKey = incident => (typeof incident.jira === 'string' ? incident.jira : incident.jira?.key);

/**
 * How a closed flicker issue reads on a row. Without a Fix Version nobody can say which lines carry
 * the fix, so it is named as closed, never as a fix this branch is known to have or to miss.
 */
const closedAs = closed => (unfixed(closed)
  ? `${closed.key} closed as ${closed.resolution}, not fixed`
  : closed.fixVersions?.length
    ? `already fixed by ${closed.key} (${closed.fixVersions.join(', ')})${unshipped(closed)}`
    : `${closed.key} closed${closed.resolution ? ' as fixed' : ''}, no Fix Version`);

/**
 * The Fix Versions of a closed issue not yet released, as a clause. Such an issue is the one a
 * *human* may reopen (okf/servers/jira.md); the routine only comments on it (references/fix-signals.md).
 */
const unshipped = closed => (closed.unreleased?.length
  ? `, ${closed.unreleased.join(', ')} unreleased — comment; reopening is a human's call` : '');

/**
 * Whether a closed issue was closed *without* a fix — Cannot Reproduce, Won't Fix, Duplicate. Such
 * an issue is history, not a backport source: there is no commit to carry anywhere. `resolution` is
 * absent from a work order written before it was read, which reads as unknown, never as unfixed.
 */
const unfixed = closed => !!closed.resolution && closed.resolution !== 'Fixed';

/**
 * The maintenance line a closed issue's fix skips, as `18.8.x`, or null. Pointed out whatever the
 * horizon, since it asks for nothing to be written: on 2026-10-18 `ExtensionSecurityTest` failed on
 * stable-18.8.x for 17 days as "counted, not written about", while XWIKI-25242's Fix Versions
 * (17.10.14, 18.9.0-rc-1, 18.4.7) said the fix had never reached that line.
 */
export function missingLine(closed, branch) {
  const line = String(branch).match(/^stable-(\d+\.\d+)\.x$/)?.[1];
  if (!line || unfixed(closed) || !closed.fixVersions?.length) return null;
  return closed.fixVersions.some(version => version.startsWith(`${line}.`)) ? null : `${line}.x`;
}

/** Why nobody is asked to do anything — always a reason, never an empty cell. */
function noOneOwes(incident, horizonDays) {
  if (incident.beyondHorizon) return `older than the ${horizonDays}-day horizon — counted, not written about`;
  if (incident.jira) return 'already tracked — the issue is where this gets settled';
  if (incident.jiraClosed) {
    if (unfixed(incident.jiraClosed)) {
      return `${incident.jiraClosed.key} was closed as ${incident.jiraClosed.resolution} — it flickers again,`
        + ' and there is no fix to backport';
    }
    return incident.jiraClosed.fixVersions?.length
      ? `${incident.jiraClosed.key} already fixed this test in ${incident.jiraClosed.fixVersions.join(', ')}`
        + (unshipped(incident.jiraClosed) || ' — compare that with this branch before filing anything')
      : `${incident.jiraClosed.key} was closed${incident.jiraClosed.resolution ? ' as fixed' : ''} with no Fix Version — find its commit before`
        + ' assuming this branch has it or lacks it';
  }
  if (incident.kind === 'flicker' && !incident.proven) {
    return 'not proven yet — an issue is earned by two builds on two days';
  }
  if (incident.class === 3) {
    return incident.snapshotGap ? 'expect it to clear once main deploys a snapshot again'
      : 'nothing in the code to change; watch for the same agent tomorrow';
  }
  return 'below the analysis budget — reported, not analysed';
}

/**
 * Column three: what happens next, and who does it.
 *
 * Every line starts with its actor — `bot`, a person, `nobody`, `done` — because that is the word
 * a reader scans for, and a column that sometimes leads with the actor and sometimes with the verb
 * is a column that has to be read rather than scanned. The run's own moves are mechanical and
 * written here; what a *person* should do is the conclusion of the analysis, so a deep incident
 * leaves a marker for the pass that writes its root cause (SKILL.md §6).
 */
function nextOf(incident, { horizonDays, filing, stabilising, cause, sharing }) {
  const lines = [];
  const fix = incident.fixState;
  if (settled(incident)) {
    // The hedge is the wording `FIX_HEAD` already carries, and it is kept exactly: no value here
    // asserts a fix — a commit will be judged by the next build and a PR may never merge.
    lines.push(`nobody → ${FIX_HEAD[fix.kind].whole.toLowerCase()}: ${fixRef(fix)} ` +
      `(${fix.author || 'unknown'})` +
      `${fix.kind === 'fixed-elsewhere' ? ' — a backport candidate, verify first' : ''}`);
  } else if (incident.primary === false) {
    lines.push(`see ${cause ? `#${cause.number}` : 'above'} → one cause, analysed on ` +
      `${cause?.branch || incident.alsoOn?.[0] || 'another branch'}`);
  } else if (!incident.beyondHorizon) {
    if (incident.unanswered) {
      lines.push(`done → asked ${incident.unanswered.author || 'its author'} on ${incident.unanswered.since}, no answer yet`);
    } else if (incident.silent) {
      lines.push('done → already commented, in this same state');
    }
    // The one incident already asked that still gets a COMMENT cell: the proof's follow-up, or why none went.
    if (incident.prove) {
      lines.push(`bot → run the test at \`${incident.commentable.sha.slice(0, 10)}\` and at its parent, `
        + 'in the stabilisation slot: prove the cause or drop the suspicion');
    }
    if (incident.commentable || incident.provable) {
      // Whether the comment goes is the run's decision (§4 may drop the culprit), so a line saying
      // it went would be false the moment it does not: the run fills this in once it has decided.
      lines.push(`<!-- COMMENT: ${incident.id} -->`);
    } else if (incident.commentedWith) {
      lines.push(`bot → one comment for this and #${sharing ?? '?'}: the same commit`);
    }
    if (filing) lines.push(`bot → file **one** issue for \`${filing.className}\` (${filing.scope})`);
    if (stabilising) lines.push('bot → find the cause, force the race, fix, draft PR on proof');
    if (incident.jira && incident.state === 'systematic') {
      lines.push(`someone → re-triage ${jiraKey(incident)}: filed as a flicker, failing every run`);
    }
  }
  const missing = incident.jiraClosed && !settled(incident) && incident.primary !== false
    && missingLine(incident.jiraClosed, incident.branch);
  if (missing) {
    lines.push(`someone → backport ${incident.jiraClosed.key}'s fix to ${missing} with \`xwiki-backport\``
      + ' — its Fix Versions skip this line; verify first');
  }
  if (incident.deep && !settled(incident)) {
    lines.push(`<!-- NEXT: ${incident.id} -->`);
  } else if (!lines.length) {
    lines.push(`nobody → ${noOneOwes(incident, horizonDays)}`);
  }
  return lines.join('<br>');
}

/**
 * A table cell: a newline ends the row and a bare pipe starts a new column, so neither reaches one.
 * The pipe is escaped rather than replaced — a log line is evidence, and `\|` renders as the pipe
 * that was actually there, inside a code span as well as outside one.
 */
const cell = text => String(text ?? '')
  .replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>').trim() || '—';

/**
 * What the reader opens when the row is theirs: the evidence, the history, the attribution and the
 * root cause, behind one disclosure triangle.
 *
 * Collapsed, because the tables above are the document and this is the appendix to one row of them
 * — and because PrivateBin renders the markdown inside `<details>` exactly as it does outside it,
 * so nothing is lost by folding it away.
 */
/** The root cause an earlier morning wrote, quoted as that morning's. */
function recalledBlock(incident) {
  const { recalled } = incident;
  if (!recalled) return [];
  return ['', `**As concluded on ${recalled.analysedOn}**, and unchanged since — not re-analysed today:`,
    ...(recalled.analysis ? ['', recalled.analysis] : [])];
}

function evidenceFor(incident) {
  const head = [windowOf(incident), incident.stage ? `stage _${incident.stage}_` : null].filter(Boolean);
  const body = incident.deep
    ? [...evidenceBlock(incident), ...sonarBlock(incident), ...develocityBlock(incident),
      ...blameBlock(incident), ...chatBlock(incident), ...analysis(incident)]
    : [...fixBlock(incident), ...sonarBlock(incident), ...chatBlock(incident), ...recalledBlock(incident)];
  const out = [...(head.length ? ['', head.join(' · ')] : []), ...body];
  return out.some(line => line.trim()) ? out : null;
}

/**
 * The order the rows come in, which is the order they should be dealt with: what blocks a release,
 * then what is broken, then what is flaky, then what is nobody's to fix. A row whose answer is
 * already known — settled, or the same cause as a row above — goes last: it is there so that a red
 * square on the dashboard has a line here, not because anyone has to act on it.
 */
function rowRank(incident, primaries) {
  // A peer sorts where the incident it points at sorts, half a rank behind it — a pointer to a red
  // gate is still the first thing on that branch, and a pointer is never the thing you read first.
  if (incident.primary === false) {
    const cause = primaries?.get(causeKey(incident));
    return cause ? rowRank(cause) + 0.5 : 9;
  }
  if (settled(incident)) return 8;
  if (isGate(incident)) return 0;
  if (incident.class === 2) return 1;
  if (incident.class === 1 && incident.kind === 'test-breakage') return incident.beyondHorizon ? 6 : 2;
  if (incident.flickerGroup) return 3;
  if (incident.class === 1 && incident.kind === 'flicker' && !incident.jira) return 4;
  if (incident.jira) return 5;
  if (incident.class === 3) return 7;
  return 6.5;
}

export function renderDetail(report, { live }) {
  const { summary, incidents } = report;
  const date = report.generatedAt.slice(0, 10);
  const redRepos = new Set(report.jobs.filter(job => job.result && job.result !== 'SUCCESS').map(job => job.repo));
  const green = [...new Set(report.jobs.map(job => job.repo))].filter(repo => !redRepos.has(repo));
  const out = [`# CI sweep — ${date}${live ? '' : ' (not a live run — no digest posted, no issue filed)'}`];
  if (!incidents.length) {
    return [...out, '', `Nothing red across ${plural(summary.jobs, 'job')}. Nothing written.`].join('\n');
  }

  // One cause, one row. The peers of an `also-red` group keep a row in *their own* branch's table —
  // a pointer, not a copy — because the person who watches that branch reads that table and has to
  // find it there; the analysis and the comment still happen once, under the branch that carries
  // the cause. A flicker group is the other collapse: one row for the test class, in the branch of
  // the incident that heads it, because what the run files is one issue for the class.
  const groups = new Map();
  for (const incident of incidents) {
    if (!incident.flickerGroup) continue;
    groups.set(incident.flickerGroup, [...(groups.get(incident.flickerGroup) || []), incident]);
  }
  const filings = new Map();
  for (const group of groups.values()) {
    const branches = [...new Set(group.flatMap(incident => [incident.branch, ...(incident.alsoOn || [])]))];
    const methods = [...new Set(group.map(shortName))].sort();
    filings.set(group[0].id, {
      className: testName(group[0].id.split('/').slice(2).join('/')).split('#')[0],
      scope: `${plural(methods.length, 'method')}, ${branches.join(' + ')}`,
      methods, branches, group
    });
  }
  const rows = incidents.filter(incident => !incident.flickerGroup || filings.has(incident.id));

  // Keyed by the signature the id carries rather than by `signature`, which the work order omits
  // for a class-1 incident: what a test failure is, is its test, and the id already holds it.
  const primaries = new Map();
  for (const incident of rows) {
    if (incident.primary === true) primaries.set(causeKey(incident), incident);
  }
  const sections = new Map();
  for (const incident of rows) {
    const key = `${incident.repo}\u0000${incident.branch}`;
    sections.set(key, [...(sections.get(key) || []), incident]);
  }
  const ordered = [...sections.entries()]
    .map(([key, list]) => ({
      repo: key.split('\u0000')[0], branch: key.split('\u0000')[1],
      list: list.sort((a, b) => rowRank(a, primaries) - rowRank(b, primaries)
        || (b.ageDays ?? -1) - (a.ageDays ?? -1))
    }))
    // The branch a reader must look at first is the one with the worst row on it, not the one that
    // sorts first by name — a red gate on a stable branch outranks a flicker on master.
    .sort((a, b) => rowRank(a.list[0], primaries) - rowRank(b.list[0], primaries)
      || branchRank(a.branch) - branchRank(b.branch) || a.repo.localeCompare(b.repo));

  // Numbered across the whole document, in reading order, so that a row and the block that belongs
  // to it are tied together by something short enough to say out loud in the room.
  const numbers = new Map();
  for (const section of ordered) for (const incident of section.list) numbers.set(incident.id, numbers.size + 1);
  const causeOf = incident => {
    const cause = incident.primary === false ? primaries.get(causeKey(incident)) : null;
    return cause ? { number: numbers.get(cause.id), branch: cause.branch } : null;
  };

  const blockers = rows.filter(blocking);
  out.push('', blockers.length
    ? `**${[...new Set(blockers.map(incident => incident.branch))].join(', ')} ` +
      `${blockers.length === 1 ? 'blocks' : 'block'} a release** — ` +
      `${blockers.map(incident => `${subjectOf(incident)} (#${numbers.get(incident.id)})`).join(', ')}.`
    : '**Nothing here blocks a release.**');
  out.push('', `Swept **${plural(summary.jobs, 'job')}**, **${summary.red} red** → ` +
    `**${plural(summary.incidents, 'incident')}**` +
    `${green.length ? `. ${green.join(' and ')} ${green.length === 1 ? 'is' : 'are'} green on every branch` : ''}.`);
  if (report.githubTokenWarning) out.push('', `⚠️ ${report.githubTokenWarning}`);

  for (const section of ordered) {
    out.push('', `## ${section.repo} · ${section.branch}`, '',
      '| What fails | Why | Next — who |', '|---|---|---|');
    for (const incident of section.list) {
      const cause = causeOf(incident);
      const meta = [kindOf(incident), agedAs(incident),
        incident.jira ? `tracked as ${(incident.jiras || [jiraKey(incident)]).join(', ')}` : null,
        incident.jiraClosed ? closedAs(incident.jiraClosed) : null,
        incident.alsoOn?.length && incident.primary !== false ? `also red on ${incident.alsoOn.join(', ')}` : null,
        incident.buildUrl ? `[build](${incident.buildUrl})` : null].filter(Boolean).join(' · ');
      const name = isGate(incident) ? `**${subjectOf(incident)}**` : `\`${subjectOf(incident)}\``;
      const filing = filings.get(incident.id);
      // A gate explains itself out of fields the renderer holds — the condition it failed and the
      // value the gate wanted — so it keeps its mechanical answer and spends no analysis slot
      // restating two nouns. For everything else that won a slot, *why* is the conclusion of that
      // analysis: the numbers a renderer can reach say how often a test fails, never why it does.
      const why = cause ? `the same failure as #${cause.number} on ${cause.branch}`
        : incident.recalled ? incident.recalled.why
        : incident.deep && !incident.sonar?.conditions?.length ? `<!-- WHY: ${incident.id} -->`
          : whyOf(incident);
      out.push(`| **${numbers.get(incident.id)}.** ${cell(name)}<br>_${cell(meta)}_ ` +
        `| ${cell(why)} ` +
        `| ${cell(incident.recalled ? `${incident.recalled.next}<br>_as concluded on ${incident.recalled.analysedOn}_`
          : nextOf(incident, { horizonDays: report.horizonDays, filing, cause,
            stabilising: incident.stabilise, sharing: numbers.get(incident.commentedWith) }))} |`);
    }
    for (const incident of section.list) {
      const body = evidenceFor(incident);
      const filing = filings.get(incident.id);
      const lists = filing && filing.methods.length > 1;
      if (!body && !lists) continue;
      out.push('', '<details>', `<summary><b>${numbers.get(incident.id)}</b> · ` +
        `${isGate(incident) ? `<b>${subjectOf(incident)}</b>` : `<code>${subjectOf(incident)}</code>`}` +
        ' — the evidence, and the root cause</summary>');
      // Every method of a flicker group, because the issue the run files lists them and somebody
      // has to be able to check that list against what is actually red.
      if (lists) {
        out.push('', `One issue for \`${filing.className}\` — ${filing.scope}:`,
          ...filing.methods.map(method => `- \`${method}\``));
      }
      out.push(...(body || []), '', '</details>');
    }
  }

  const stabilise = summary.stabilise;
  const notes = [];
  // Worth its line every morning, including the morning it is "none": a reader who does not see it
  // wonders whether the pass ran at all, and "a build break is open, so no flake fix today" is the
  // ordering being obeyed rather than a gap.
  if (stabilise && !stabilise.id) {
    const named = (stabilise.blockers || [])
      .map(id => (numbers.has(id) ? `#${numbers.get(id)}` : id));
    notes.push(`**No stabilisation fix this run** — ${stabilise.skipped}` +
      `${named.length ? ` (${named.join(', ')})` : ''}.`);
    if (stabilise.prove) {
      notes.push(`**The slot proves #${numbers.get(stabilise.prove.id)} instead** — \`${stabilise.prove.short}\``
        + ` (${stabilise.prove.author || 'its author'}) was asked on ${stabilise.prove.asked} and has not answered.`);
    }
  }
  const deep = incidents.filter(incident => incident.deep);
  const recalled = incidents.filter(incident => incident.recalled);
  // Only what the tool knows: whether a comment then goes is the run's decision, in each COMMENT cell.
  // Each incident is counted once: an analysed one already commented on has a culprit, and one
  // beyond the horizon is not also "below the budget" (2026-10-18 counted both, and said "1 are").
  const named = deep.filter(incident => incident.commentable || incident.provable || incident.commentedWith
    || incident.silent);
  const rest = incidents.filter(incident => !incident.deep && !incident.recalled && incident.primary !== false);
  const answered = rest.filter(settled).length;
  const old = rest.filter(incident => !settled(incident) && incident.beyondHorizon).length;
  const below = rest.length - answered - old;
  notes.push(`**A culprit candidate for ${named.length} of the ${deep.length} analysed**` +
    `${deep.length > named.length ? ` — no commit to attribute the other ${deep.length - named.length} to` : ''}.` +
    ` Not analysed: **${answered}** already answered, **${old}** older than the ${report.horizonDays}-day` +
    ` horizon, **${recalled.length}** concluded on an earlier morning and unchanged, **${below}** below the` +
    ` deep budget of ${report.budget} — reported, by design.`);
  out.push('', '---', '', ...notes.map(note => `_${note}_`));
  // What tomorrow's run reads back: the analysed rows keep today's date, the recalled ones the date
  // they were concluded on, so a conclusion ages out however many mornings it is carried.
  out.push(...memoryBlock(date, numbers, [
    ...deep.map(incident => ({ id: incident.id, state: incident.memoryState, analysedOn: date, asked: incident.asked,
      proved: incident.prove ? date : incident.provedOn })),
    ...recalled.map(incident => ({
      id: incident.id, state: incident.memoryState, analysedOn: incident.recalled.analysedOn
    }))
  ]));
  return out.join('\n');
}

// ---- The status grid ---------------------------------------------------------------------------
// The one snapshot the digest carries: a repo × branch grid of the dashboard's colours, so a reader
// sees how red CI is before reading a word, and reads the lines below only for the branch they own.
// Rendered here, never written, because a colour that is chosen by hand is one that drifts from the
// dashboard it claims to summarise.

const DOTS = { red: '🔴', orange: '🟠', green: '🟢', none: '⚪' };

/**
 * One cell. Red is a branch that cannot be released as it stands — a build break, a failing gate,
 * a test that fails every run — whether or not the incident is analysed today, collapsed onto
 * another branch or beyond the horizon, because the dashboard shows it red all the same. Orange is
 * red of any other kind: flickers, infrastructure, a red job the sweep did not explain.
 */
export const unreleasable = incident => incident.class === 2 || isGate(incident)
  || (incident.class === 1 && incident.state === 'systematic');

function cellOf(jobs, incidents) {
  if (incidents.some(unreleasable)) return 'red';
  if (incidents.length || jobs.some(job => job.result && job.result !== 'SUCCESS')) return 'orange';
  return jobs.some(job => job.result === 'SUCCESS') ? 'green' : 'none';
}

const shortBranch = branch => branch.replace(/^stable-/, '');
const shortRepo = repo => repo.replace(/^xwiki-/, '');
const branchOrder = (a, b) => {
  const version = branch => (branch === 'master' ? [Infinity] : (branch.match(/\d+/g) || []).map(Number));
  const [va, vb] = [version(a), version(b)];
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    if ((va[i] ?? -1) !== (vb[i] ?? -1)) return (vb[i] ?? -1) - (va[i] ?? -1);
  }
  return 0;
};

/** The grid as a Markdown pipe table — matrix.mjs posts it as an HTML table — and its worst colour. */
function statusOf(report) {
  const repos = [...new Set(report.jobs.map(job => job.repo))];
  const branches = [...new Set(report.jobs.map(job => job.branch))].sort(branchOrder);
  const colours = [];
  const rows = repos.map(repo => {
    const row = branches.map(branch => {
      const jobs = report.jobs.filter(job => job.repo === repo && job.branch === branch);
      if (!jobs.length) return '';
      const colour = cellOf(jobs, (report.incidents || [])
        .filter(incident => incident.repo === repo && incident.branch === branch));
      colours.push(colour);
      return DOTS[colour];
    });
    return `| ${shortRepo(repo)} | ${row.join(' | ')} |`;
  });
  const worst = ['red', 'orange', 'green', 'none'].find(colour => colours.includes(colour)) || 'none';
  return {
    worst: DOTS[worst],
    grid: [`| | ${branches.map(shortBranch).join(' | ')} |`, `|---|${branches.map(() => ':-:').join('|')}|`,
      ...rows].join('\n')
  };
}

// ---- The delta ---------------------------------------------------------------------------------
// A daily state snapshot is what the CI dashboard already is, so the digest carries exactly one —
// the status grid above, a glance long — and spends its lines elsewhere. What a dashboard cannot
// show is the *transitions*: what broke since yesterday, what moved, and — the one it can never
// show — what went green. So each run is compared against the state the last digest carried, and a
// morning that moved nothing is not posted at all.
//
// The comparison is mechanical and belongs here rather than in the model's reading of yesterday's
// prose: an id either was in yesterday's state or was not. The prose is then written about the
// handful of lines this produces.

/**
 * What is compared, as one short string per incident — the whole state of a red morning has to fit
 * in a chat message (see matrix.mjs). Deliberately *not* the age: an incident whose only change is
 * that it is a day older has not changed, and re-announcing it daily is the noise this removes.
 */
export const stateLine = incident => [
  // Only an answer that silences counts; an unconfirmed candidate leaves the incident as it was.
  incident.kind, incident.state ?? '', settled(incident) ? incident.fixState.kind : '',
  incident.beyondHorizon ? 'long-standing' : ''
].join('/');

/** An answer as the room reads it: the digest printed `answer being-handled → none` on 2026-10-18. */
const ANSWER_WORDS = {
  none: 'unanswered', 'fix-unbuilt': 'a fix unbuilt', 'fix-in-flight': 'a fix PR open',
  'stale-snapshot': 'a stale snapshot', announced: 'announced', 'being-handled': 'claimed in the room',
  'fixed-elsewhere': 'fixed on another branch'
};
const answerWords = answer => ANSWER_WORDS[answer] || answer;
const movedAs = (what, from, to) => {
  if (what !== 'answer') return `${from} → ${to}`;
  return to === 'none' ? `no longer ${answerWords(from)}` : `${answerWords(from)} → ${answerWords(to)}`;
};

const parseLine = line => {
  const [kind = '', state = '', answer = '', horizon = ''] = String(line ?? '').split('/');
  return { kind, state, answer, beyondHorizon: horizon === 'long-standing' };
};

/**
 * Today's incidents against the state the last digest carried.
 *
 * Beyond the horizon nothing is written and nothing is analysed, so those incidents are counted and
 * never classified: a two-month-old flicker that fails today, passes tomorrow and fails again on
 * Thursday would otherwise produce a `FIXED` line and a `NEW` line every other morning — the
 * churniest possible source of exactly the noise this exists to stop. Each incident is judged by
 * the day it exists on: one that crossed the horizon today is counted, one that was long-standing
 * yesterday and is back under the horizon today has been green in between and broken again, which
 * is news.
 *
 * @param {object} report a work order
 * @param {object|null} previous `{available, at, state}` as `matrix.mjs --last-state` prints it, or
 *   a bare state map. `available: false` — the room could not be read — is not the same as an empty
 *   state, and the difference is the whole reason this fails open: an unknown yesterday means today
 *   is reported in full, saying so, because a routine that posts nothing because a read failed is
 *   indistinguishable from a green morning.
 */
export function deltaOf(report, previous) {
  // An envelope announces itself by carrying either of its own fields; anything else is the bare
  // state map. Told apart explicitly, because the failure of guessing is silent and absurd: the
  // envelope of an unreadable room was read as a state of two incidents named `available` and
  // `reason`, and both were then reported as fixed.
  const envelope = previous != null && ('available' in previous || 'state' in previous);
  const available = !envelope || previous.available !== false;
  const before = new Map(Object.entries((envelope ? previous.state : previous) || {})
    .filter(([id]) => !(report.withheld || []).includes(id.split('/')[1]))
    .map(([id, line]) => [id, { line: String(line ?? ''), ...parseLine(line) }]));
  const state = {};
  const appeared = [];
  const changed = [];
  const fixed = [];
  let same = 0;
  let longStanding = 0;
  // What blocks a release and has not moved: the delta alone would make it go quiet after its first
  // morning, and a break nobody fixes must keep being said until it is (Vincent, 2026-10-17).
  const stuck = [];
  const blocking = incident => unreleasable(incident) && incident.primary !== false && !settled(incident);
  for (const incident of report.incidents || []) {
    state[incident.id] = stateLine(incident);
    const now = parseLine(state[incident.id]);
    if (now.beyondHorizon) {
      longStanding++;
      if (blocking(incident)) stuck.push(incident.id);
      continue;
    }
    const was = before.get(incident.id);
    if (!was) {
      appeared.push({ id: incident.id, kind: now.kind, state: now.state, answer: now.answer || null,
        dot: DOTS[unreleasable(incident) ? 'red' : 'orange'] });
      continue;
    }
    const moves = [['kind', was.kind, now.kind], ['state', was.state, now.state],
      ['answer', was.answer || 'none', now.answer || 'none']]
      .filter(([, from, to]) => from !== to)
      .map(([what, from, to]) => movedAs(what, from, to));
    if (moves.length) {
      changed.push({ id: incident.id, from: was.line, to: state[incident.id], moved: moves,
        dot: DOTS[unreleasable(incident) ? 'red' : 'orange'] });
    } else {
      same++;
      if (blocking(incident)) stuck.push(incident.id);
    }
  }
  for (const [id, was] of before) {
    if (was.beyondHorizon || state[id]) continue;
    fixed.push({ id, was: `${was.kind}/${was.state}` });
  }
  // An unknown yesterday classifies nothing. Calling today's incidents `NEW` would be a claim about
  // a comparison that never happened — a week-old flicker announced as this morning's breakage is
  // worse than the snapshot the digest falls back to, which at least says what it is.
  if (!available) {
    return {
      previous: { available: false, at: null, known: 0, reason: previous?.reason ?? null },
      silent: false,
      new: [], changed: [], fixed: [], same: 0, stuck: [],
      unknown: Object.keys(state).length,
      longStanding,
      status: statusOf(report),
      state,
      withheld: report.withheld
    };
  }
  return {
    previous: { available, at: previous?.at ?? null, known: before.size },
    // Nothing to say is the correct outcome, and the one the whole change exists to produce. It is
    // never reached on an unknown yesterday, whatever today looks like.
    silent: available && !appeared.length && !changed.length && !fixed.length && !stuck.length,
    new: appeared,
    changed,
    fixed,
    same,
    stuck,
    longStanding,
    status: statusOf(report),
    state,
    // The lines the digest may not name (`publicView`): `matrix.mjs --state` refuses a digest that does.
    withheld: report.withheld
  };
}

// ---- The digest ----------------------------------------------------------------------------------
// Rendered like the paste, and for the same reason: its shape — the grid, which rows, in what
// order, their links and their counts — is mechanical, and a digest re-invented every morning drifts
// from the dashboard it summarises and from the rules of references/digest.md. What only the run
// knows is left as a marker: what it wrote about an incident (`DONE`), the paste URL (`PASTE`) and
// a stabilisation PR (`STABILISE`). `matrix.mjs` refuses a digest that still holds one.

/** Rows the table holds before the rest is left to the paste — `fromChat` rows come on top. */
const DIGEST_ROWS = 5;
const roomName = sender => String(sender || 'somebody').replace(/^@/, '').split(':')[0];
const linked = (text, url) => (url ? `[${text}](${url})` : text);
const browse = key => `${JIRA}/browse/${key}`;

/** The *Done* cell: what is already known, or a marker for what this run did about it. */
function doneOf(incident, report) {
  const fix = incident.fixState;
  if (settled(incident)) {
    const sha = linked(`\`${fix.sha}\``, fix.url);
    if (fix.kind === 'fix-unbuilt') return `likely fixed, unbuilt: ${sha}`;
    if (fix.kind === 'fix-in-flight') return `fix in flight: ${linked(`PR #${fix.number}`, fix.url)}`;
    if (fix.kind === 'stale-snapshot') return `stale snapshot, not a break: ${sha}`;
    if (fix.kind === 'fixed-elsewhere') {
      const where = fix.branch && !report.withheld?.includes(fix.branch) ? shortBranch(fix.branch) : 'another branch';
      return `fixed on ${where} by ${sha}, backport candidate`;
    }
    if (fix.kind === 'announced') return `quiet: ${linked('announced', fix.url)} by ${roomName(fix.author)} before it broke`;
    if (fix.kind === 'being-handled') return `quiet: ${roomName(fix.author)} ${linked('is on it', fix.url)}`;
  }
  // What the run itself may have done — commented, filed, commented on a closed issue, confirmed a
  // candidate PR — is known only once it has done it.
  // Named, not @-mentioned: the room sees who has been asked and for how long, and nobody is pinged twice.
  const unanswered = incident.unanswered && `asked ${incident.unanswered.author || 'its author'} on `
    + `${linked(incident.unanswered.since, incident.unanswered.url)}, no answer yet`;
  if (incident.commentable || incident.provable || incident.commentedWith || incident.flickerGroup
    || incident.jiraClosed || fix?.candidate) {
    return `${unanswered ? `${unanswered} · ` : ''}<!-- DONE: ${incident.id} -->`;
  }
  if (incident.recalled) return `as concluded on ${incident.recalled.analysedOn} — in the paste`;
  if (unanswered) return unanswered;
  if (incident.silent) return linked('already commented', incident.notified?.url);
  // Beyond the horizon the analysis is the paste's alone: nothing was posted, whoever it names.
  if (incident.beyondHorizon && incident.deep) return 'long-standing: cause and owner in the paste';
  if (incident.jira) {
    return `tracked: ${(incident.jiras || [jiraKey(incident)]).map(key => linked(key, browse(key))).join(', ')}`;
  }
  return incident.deep ? 'no owner found' : 'in the paste, not analysed';
}

/** The *What* cell: what is red, and the one fact a dashboard does not have. */
function whatOf(incident, moves = []) {
  const sonar = incident.sonar;
  let what;
  if (isGate(incident)) {
    // Whose code, never who broke it: `sonar.culprits` holds GitHub logins, never an address.
    what = `${linked('sonar gate', sonar?.url)} red`
      + (sonar?.conditions?.length ? ` — ${sonar.conditions.map(c => `${c.name} is ${c.actual}`).join('; ')}` : '')
      + (sonar?.culprits?.length ? `: ${sonar.culprits.map(c => `${plural(c.issues, 'issue')} in `
        + `${c.files.map(file => `\`${file}\``).join(', ')} (${c.who})`).join(', ')}` : '');
  } else if (incident.class === 1) {
    const name = shortName(incident);
    what = `\`${name.length > 60 ? `${name.slice(0, 59)}…` : name}\` ${kindOf(incident)}`;
  } else {
    what = `${kindOf(incident)} \`${subjectOf(incident)}\``;
  }
  const dv = incident.develocity;
  if (dv) what += `, ${dv.failures}/${dv.runs} over ${dv.windowDays}d${dv.firstSeen ? `, first failed ${dv.firstSeen}` : ''}`;
  if (incident.jiraClosed) {
    what += `, ${linked(incident.jiraClosed.key, browse(incident.jiraClosed.key))} closed`
      + `${unfixed(incident.jiraClosed) ? ` as ${incident.jiraClosed.resolution}` : ''}`;
  }
  if (moves.length) what += ` — ${moves.join(', ')}`;
  return what;
}

/** The room's word on an incident, as one clause the *Done* cell carries. */
const citeRoom = incident => said(incident).slice(-1).map(message =>
  `, ${linked(`discussed ${message.at.slice(5, 16).replace('T', ' ')}`, message.permalink)} (${roomName(message.sender)})`)
  .join('');

/**
 * The digest, from a work order and what the last digest carried (`--previous`).
 *
 * @returns {string} Markdown for `matrix.mjs --file`, holding markers until the run fills them
 */
export function renderDigest(report, previous, { paste = null } = {}) {
  const delta = deltaOf(report, previous);
  const incidents = report.incidents || [];
  const byId = new Map(incidents.map(incident => [incident.id, incident]));
  const primaryOf = incident => (incident.primary === false
    ? incidents.find(other => other.primary === true && causeKey(other) === causeKey(incident)) || incident
    : incident);
  // One cause, one row: a peer that moved puts its primary on the table, whose branch list names it.
  const rows = new Map();
  const put = (incident, mark, moves = []) => {
    if (!incident || incident.beyondHorizon) return;
    const primary = primaryOf(incident);
    const own = primary === incident;
    const known = rows.get(primary.id);
    if (known && (known.own || !own)) return;
    rows.set(primary.id, { incident: primary, own, mark: own ? mark : '🔄', moves: own ? moves : [] });
  };
  if (delta.previous.available) {
    for (const entry of delta.new) put(byId.get(entry.id), '🆕');
    for (const entry of delta.changed) put(byId.get(entry.id), '🔄', entry.moved);
  } else {
    for (const incident of incidents) put(incident, '');
  }
  const owned = incident => !!(incident.commentable || incident.provable || incident.commentedWith);
  const rank = ({ incident }) => (unreleasable(incident) ? (owned(incident) ? 0 : 1) : 2);
  const moved = [...rows.values()].sort((a, b) => rank(a) - rank(b) || rowRank(a.incident) - rowRank(b.incident));

  // Gone green: one row per test class or signature, whatever the branch count.
  const fixed = new Map();
  for (const { id } of delta.fixed) {
    const [repo, branch, ...rest] = id.split('/');
    const signature = rest.join('/');
    const [what, method] = testName(signature).split('#');
    const key = `${repo}\u0000${method ? what : signature}`;
    const entry = fixed.get(key) || { repo, what: method ? what : signature.split('/').pop(), branches: new Set(), methods: new Set() };
    entry.branches.add(shortBranch(branch));
    if (method) entry.methods.add(method);
    fixed.set(key, entry);
  }
  const line = (mark, incident, moves) => `| ${mark}${incident ? DOTS[unreleasable(incident) ? 'red' : 'orange'] : ''} `
    + `| ${shortRepo(incident.repo)}/${[incident.branch, ...(incident.alsoOn || [])].map(shortBranch).join('+')} `
    + `| ${cell(whatOf(incident, moves))} | ${incident.ageDays == null ? '—' : agedAs(incident)} `
    + `| ${cell(doneOf(incident, report) + citeRoom(incident))} |`;
  // What went green is the line no dashboard shows, so it is never cut: one row per repo.
  const greenRows = [...new Set([...fixed.values()].map(entry => entry.repo))].map(repo => {
    const entries = [...fixed.values()].filter(entry => entry.repo === repo);
    const branches = [...new Set(entries.flatMap(entry => [...entry.branches]))];
    return `| ✅ | ${repo}/${branches.join('+')} | ${cell(entries.map(entry => (entry.methods.size > 1
      ? `${entry.methods.size} × \`${entry.what}\``
      : `\`${entry.what}${entry.methods.size ? `#${[...entry.methods][0]}` : ''}\``)).join('; '))} | — | green |`;
  });
  const shown = moved.slice(0, Math.max(1, DIGEST_ROWS - greenRows.length));
  // A suppression on a *sentence* always goes back to the room that said it, whatever else is cut:
  // the person who wrote it is the one reader who can say it was misread.
  const chatRows = incidents.filter(incident => settled(incident) && incident.fixState.fromChat
    && incident.primary !== false && !incident.beyondHorizon && !shown.some(row => row.incident === incident))
    .map(incident => line('', incident));
  // Still blocking a release, unchanged: one ⏳ row each, its age saying how long it has been.
  const stuckRows = (delta.stuck || []).map(id => byId.get(id)).filter(Boolean)
    .filter(incident => !rows.has(incident.id)).slice(0, 3).map(incident => line('⏳', incident));
  const kept = [...shown.map(({ incident, mark, moves }) => line(mark, incident, moves)), ...stuckRows, ...greenRows];
  const more = moved.length - shown.length;
  const counts = delta.previous.available
    ? `${delta.new.length} new, ${delta.changed.length} changed, ${delta.fixed.length} fixed`
      + (delta.stuck?.length ? `, ${delta.stuck.length} still blocking` : '')
    : `${delta.unknown} red`;
  const stuckLong = (delta.stuck || []).filter(id => byId.get(id)?.beyondHorizon).length;
  const sameLeft = delta.same - ((delta.stuck || []).length - stuckLong);
  const longLeft = delta.longStanding - stuckLong;
  const tail = [more ? `${more} more in the paste` : null, sameLeft ? `${sameLeft} unchanged` : null,
    longLeft ? `+${longLeft} long-standing` : null].filter(Boolean);
  return [
    ...(delta.silent ? ['<!-- SILENT: nothing moved since the last digest. Post nothing, unless §5 opened a '
      + 'stabilisation PR: then fill STABILISE, delete this line, and post. -->', ''] : []),
    `${delta.status.worst} CI ${report.generatedAt.slice(0, 10)} — ${counts} · detail → ${paste || '<!-- PASTE -->'} (1 week)`,
    '',
    delta.status.grid,
    '',
    '| | Branch | What | Age | Done |',
    '|---|---|---|---|---|',
    ...kept,
    ...chatRows,
    '<!-- STABILISE: the row of the stabilisation draft PR §5 opened (→ draft fix for `Test#method`: its proof, '
      + 'its PR link), or delete this line -->',
    ...(tail.length ? ['', `… ${tail.join(' · ')}`] : []),
    ...(delta.previous.available ? [] : ['', '(could not read the last digest — this is a full snapshot)'])
  ].join('\n');
}

/**
 * The LTS lines older than the two maintained ones: they take security fixes only, and
 * okf/processes/release.md forbids naming them in a public artifact — which the digest is.
 */
export function securityOnly(branches) {
  return [...new Set(branches)].filter(branch => classifyBranch(branch).class === 'lts').sort(branchOrder).slice(2);
}

/**
 * The work order as the public room may see it: without the security-only lines — no grid column,
 * no row, no `alsoOn` entry, no state carried forward — and naming them in `withheld`. The paste and
 * the terminal are internal and keep them.
 */
export function publicView(report) {
  const withheld = securityOnly((report.jobs || []).map(job => job.branch));
  const hidden = branch => withheld.includes(branch);
  return {
    ...report,
    withheld,
    jobs: (report.jobs || []).filter(job => !hidden(job.branch)),
    incidents: (report.incidents || []).filter(incident => !hidden(incident.branch))
      .map(incident => (incident.alsoOn?.some(hidden) ? { ...incident, alsoOn: incident.alsoOn.filter(b => !hidden(b)) } : incident))
  };
}
