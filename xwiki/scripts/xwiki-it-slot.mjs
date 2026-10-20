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
 * It also keeps testcontainers' leftovers from piling up. Testcontainers removes a run's containers
 * and networks through a ryuk container once the test JVM exits, but the ryuk of testcontainers 1.17
 * and older (0.3.x) speaks Docker API 1.29, which recent daemons refuse: every run then leaks its
 * browser container and its network until the daemon has no address pool left. So when the daemon
 * refuses that API version and no ryuk image is configured, the command runs with a ryuk that
 * negotiates the API version, and a run starting while leftover networks have piled up says so.
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

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { itSlotDir } from './state-dir.mjs';

const NO_SLOT_EXIT = 75;
const POLL_MS = 5000;
const REPORT_EVERY_MS = 60000;

/** The Docker API version spoken by the 0.3.x ryuk images, the default of testcontainers 1.17 and older. */
const OLD_RYUK_API_VERSION = '1.29';
/**
 * A ryuk that negotiates the Docker API version, verified to reap with testcontainers 1.17 and 2.0. It
 * replaces the ryuk of whatever testcontainers version the build uses, newer ones included, which is
 * harmless while the testcontainers-ryuk protocol stays unchanged: only a testcontainers release that
 * changes that protocol requires moving this to the ryuk that release names.
 */
const WORKING_RYUK_IMAGE = 'testcontainers/ryuk:0.14.0';
const TESTCONTAINERS_LABEL = 'org.testcontainers=true';
/** Empty testcontainers networks above which the daemon is about to run out of address pools. */
const EMPTY_NETWORKS_WARNING = 10;

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

/**
 * @returns {string[]|null} the output lines of a docker command, or null when docker is missing, the
 *   daemon is unreachable or the command failed: the checks below are advisory and skip themselves then.
 */
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000 });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * @returns {Map<string, string>} the developer's testcontainers settings: `~/.testcontainers.properties`,
 *   overridden by the matching `TESTCONTAINERS_*` environment variables, which is testcontainers' own
 *   precedence.
 */
function testcontainersSettings() {
  const settings = new Map();
  try {
    const file = path.join(os.homedir(), '.testcontainers.properties');
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*([^#!=\s]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
      if (match) settings.set(match[1], match[2]);
    }
  } catch {
    // No properties file: testcontainers' defaults apply.
  }
  for (const key of ['ryuk.container.image', 'ryuk.disabled']) {
    const value = process.env[`TESTCONTAINERS_${key.replaceAll('.', '_').toUpperCase()}`];
    if (value) settings.set(key, value);
  }
  return settings;
}

/**
 * @returns {object|null} the environment to add to the command so that ryuk can reach the daemon, or
 *   null when nothing needs to change: the daemon accepts the old ryuk, the developer chose a ryuk
 *   image or disabled ryuk, or docker cannot be queried.
 */
function ryukEnvironment(settings) {
  if (settings.has('ryuk.container.image') || settings.get('ryuk.disabled') === 'true') return null;
  const minimum = docker('version', '--format', '{{.Server.MinAPIVersion}}');
  if (!minimum || minimum.length === 0 || compareVersions(minimum[0], OLD_RYUK_API_VERSION) <= 0) return null;
  console.error(`Running with ${WORKING_RYUK_IMAGE}: the Docker daemon refuses the ryuk of testcontainers 1.17 `
    + 'and older (set ryuk.container.image in ~/.testcontainers.properties to choose another one).');
  return { TESTCONTAINERS_RYUK_CONTAINER_IMAGE: WORKING_RYUK_IMAGE };
}

/** @returns {{containers: string[], networks: string[]}|null} the testcontainers resources on the daemon. */
function testcontainersResources() {
  const containers = docker('ps', '-aq', '--no-trunc', '--filter', `label=${TESTCONTAINERS_LABEL}`);
  const networks = docker('network', 'ls', '-q', '--no-trunc', '--filter', `label=${TESTCONTAINERS_LABEL}`);
  return containers && networks ? { containers, networks } : null;
}

/** @returns {number} how many testcontainers networks have no container attached, i.e. are leftovers. */
function countEmptyNetworks(networks) {
  if (networks.length === 0) return 0;
  const counts = docker('network', 'inspect', '--format', '{{len .Containers}}', ...networks) || [];
  return counts.filter(count => count === '0').length;
}

const CLEANUP_COMMANDS = '  docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)\n'
  + '  docker network prune -f --filter label=org.testcontainers=true\n'
  + 'Run them only when no other Docker functional test is running on this machine.';

function warnAboutEmptyNetworks(resources) {
  const empty = countEmptyNetworks(resources.networks);
  if (empty < EMPTY_NETWORKS_WARNING) return;
  console.error(`${empty} testcontainers networks are left over from earlier runs. Each one holds an address `
    + 'pool, and once they are exhausted every run dies in beforeAll ("all predefined address pools have been '
    + 'fully subnetted", or "networkMode was not specified"). To remove the leftovers:\n' + CLEANUP_COMMANDS);
}

// stdout is asynchronous on a pipe (macOS): process.exit() right after a write cuts off whatever the
// reader has not drained yet, so exit from the callback of a write queued behind it instead.
const exitAfterOutput = code => new Promise(() => process.stdout.write('', () => process.exit(code)));

const { options, command } = parseArgs(process.argv.slice(2));
const max = Math.max(1, options.max || Number(process.env.XWIKI_LLM_IT_SLOTS) || 2);

if (options.status) {
  console.log(`Slots: ${max} (${slotDir})`);
  console.log(describe(listHolders(max)));
  const resources = testcontainersResources();
  if (resources) {
    console.log(`Testcontainers on the daemon: ${resources.containers.length} container(s), `
      + `${resources.networks.length} network(s) of which ${countEmptyNetworks(resources.networks)} without container`);
  }
  await exitAfterOutput(0);
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

const resources = testcontainersResources();
if (resources) warnAboutEmptyNetworks(resources);
const ryukEnv = ryukEnvironment(testcontainersSettings());

const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, ...ryukEnv } });
child.on('error', error => {
  release();
  console.error(`Cannot run [${command[0]}]: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  release();
  process.exit(signal ? 128 + os.constants.signals[signal] : code);
});
