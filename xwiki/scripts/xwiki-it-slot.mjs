#!/usr/bin/env node
/**
 * Caps how many XWiki Docker functional-test runs execute at once on one machine.
 *
 * A `-Pdocker,integration-tests` run holds a servlet engine, a browser container of a couple of
 * gigabytes and a ryuk, and it writes SNAPSHOT artifacts into the shared `~/.m2`. Several agents
 * launching one at the same time starve the Docker daemon, and starvation surfaces as a failure in
 * `beforeAll` that reads like a product bug (see okf/testing/running-docker-its.md). Nothing in
 * Maven or testcontainers serialises this, so this wrapper does: it takes one of N slots, runs the
 * command, and releases the slot however the command ends.
 *
 * Wrap the whole Maven invocation rather than the test phase alone — the `install` of the SNAPSHOT
 * artifacts is part of what is being serialised.
 *
 *   node xwiki-it-slot.mjs -- mvn verify -B -ntp -Pdocker,integration-tests
 *   node xwiki-it-slot.mjs --max 1 -- mvn verify …     # exclusive
 *   node xwiki-it-slot.mjs --status                    # who is holding what
 *
 * Options (all optional):
 *   --max N        concurrent runs allowed. Default: $XWIKI_LLM_IT_SLOTS, else 2.
 *   --wait SECONDS give up waiting for a slot. Default 3600. 0 means "do not wait".
 *   --label TEXT   shown in --status; defaults to the working directory's basename.
 *   --status       print the current holders and exit.
 *
 * Exit codes: the command's own, or 75 (EX_TEMPFAIL) when no slot came free in time.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { itSlotDir } from './state-dir.mjs';

const NO_SLOT_EXIT = 75;
const POLL_MS = 5000;
const REPORT_EVERY_MS = 60000;

const slotDir = itSlotDir();

function parseArgs(argv) {
  const options = { max: null, wait: 3600, label: null, status: false };
  const command = [];
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { command.push(...argv.slice(i + 1)); break; }
    else if (arg === '--status') options.status = true;
    else if (arg === '--max') options.max = Number(argv[++i]);
    else if (arg === '--wait') options.wait = Number(argv[++i]);
    else if (arg === '--label') options.label = argv[++i];
    else { command.push(...argv.slice(i)); break; }
  }
  return { options, command };
}

/**
 * @returns {boolean} whether the process is still running. EPERM means it is, and is owned by
 *   somebody else; only ESRCH proves it is gone.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readSlot(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Unreadable or half-written: treat as stale rather than deadlocking on it.
    return null;
  }
}

function listHolders(max) {
  const holders = [];
  for (let slot = 0; slot < max; slot++) {
    const file = path.join(slotDir, `slot-${slot}`);
    if (!fs.existsSync(file)) continue;
    const held = readSlot(file);
    if (held && isAlive(held.pid)) holders.push({ slot, ...held });
  }
  return holders;
}

function describe(holders) {
  if (holders.length === 0) return 'no run is holding a slot';
  return holders
    .map(h => `  slot ${h.slot}: ${h.label} (pid ${h.pid}, since ${h.started})\n    ${h.cmd}`)
    .join('\n');
}

/**
 * @returns {string|null} the claimed slot file, or null when all slots are held by live processes.
 */
function tryAcquire(max, entry) {
  fs.mkdirSync(slotDir, { recursive: true });
  // Each slot is reclaimed at most once per pass, so a slot another process keeps re-creating
  // cannot spin here: the next poll starts a fresh pass.
  const reclaimed = new Set();
  for (let slot = 0; slot < max; slot++) {
    const file = path.join(slotDir, `slot-${slot}`);
    try {
      // 'wx' fails when the file exists, which is what makes the claim atomic.
      const handle = fs.openSync(file, 'wx');
      fs.writeFileSync(handle, JSON.stringify({ slot, ...entry }, null, 2));
      fs.closeSync(handle);
      return file;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = readSlot(file);
      if ((held === null || !isAlive(held.pid)) && !reclaimed.has(slot)) {
        // The holder died without releasing. Reclaim, and retry this slot once.
        reclaimed.add(slot);
        try { fs.unlinkSync(file); slot--; } catch { /* somebody else reclaimed it first */ }
      }
    }
  }
  return null;
}

const { options, command } = parseArgs(process.argv.slice(2));
const max = Math.max(1, options.max || Number(process.env.XWIKI_LLM_IT_SLOTS) || 2);

if (options.status) {
  console.log(`Slots: ${max} (${slotDir})`);
  console.log(describe(listHolders(max)));
  process.exit(0);
}

if (command.length === 0) {
  console.error('Usage: xwiki-it-slot.mjs [--max N] [--wait SECONDS] [--label TEXT] -- <command>');
  process.exit(2);
}

const entry = {
  pid: process.pid,
  label: options.label || path.basename(process.cwd()),
  cwd: process.cwd(),
  cmd: command.join(' '),
  started: new Date().toISOString()
};

const deadline = Date.now() + options.wait * 1000;
let slotFile = tryAcquire(max, entry);
let lastReport = 0;
while (slotFile === null) {
  if (Date.now() >= deadline) {
    console.error(`No IT slot free after ${options.wait}s (${max} allowed). Currently held by:`);
    console.error(describe(listHolders(max)));
    process.exit(NO_SLOT_EXIT);
  }
  if (Date.now() - lastReport > REPORT_EVERY_MS) {
    console.error(`Waiting for one of ${max} IT slots. Currently held by:`);
    console.error(describe(listHolders(max)));
    lastReport = Date.now();
  }
  await new Promise(resolve => setTimeout(resolve, POLL_MS));
  slotFile = tryAcquire(max, entry);
}

let released = false;
function release() {
  if (released) return;
  released = true;
  try { fs.unlinkSync(slotFile); } catch { /* already gone */ }
}
process.on('exit', release);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { release(); process.exit(128 + os.constants.signals[signal]); });
}

const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
child.on('error', error => {
  release();
  console.error(`Cannot run [${command[0]}]: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  release();
  process.exit(signal ? 128 + os.constants.signals[signal] : code);
});
