#!/usr/bin/env node
/**
 * Runs one XWiki Docker functional test N times and reports the pass **rate**.
 *
 * A flicker is a probability, not a boolean: "it passed" after one run says almost nothing, and
 * `@RepeatedTest(failureThreshold = 1)` stops at the first failure, which measures nothing either.
 * This wrapper runs the test a fixed number of times on one configuration, counts the executions
 * that passed, keeps each failing run's artifacts, and writes a report another tool (or a pull
 * request body) can quote. Run it once before a fix and once after, and the two reports are the
 * evidence that the fix did something.
 *
 *   node xwiki-it-repeat.mjs --module <path-to-*-test-docker> --test MenuIT#menuInApplicationsPanel
 *   node xwiki-it-repeat.mjs --test ImageIT#editImage --runs 20 --browser chrome --label before
 *   node xwiki-it-repeat.mjs --test ImageIT#editImage --runs 20 --browser chrome --label after \
 *     --baseline target/it-repeat/before-20260919-0102/report.json
 *
 * Two loops, because the fast one cannot run every configuration:
 *
 * - `--mode reuse` (the default where it is possible) provisions the wiki once with
 *   `xwiki.test.ui.keepRunning=true`, then re-runs the test against it with
 *   `xwiki.test.ui.servletEngine=external`. Ten times faster per run, and the loop the flicker
 *   skill already uses by hand. `ServletEngine.EXTERNAL` is hardcoded to `localhost:8080`, so this
 *   only works with the framework's default `jetty_standalone` engine — the wiki has to be on the
 *   host port. The database still comes from the provisioning run, whose container is kept alive.
 * - `--mode fresh` runs the whole `-Pdocker,integration-tests` build once per repetition. Works
 *   with any servlet engine, and is what CI does; costs a full run each time.
 *
 * What it refuses to count: a run that failed in `beforeAll` never executed the test, so it is
 * reported as a setup error and left **out** of the rate rather than counted as a failure (see
 * `okf/testing/running-docker-its.md` — a starved Docker daemon otherwise reads as a flickering
 * test). Same for a run killed by `--timeout`.
 *
 * The whole session takes one Docker IT slot through `xwiki-it-slot.mjs`, released however it ends.
 *
 * Exit codes: 0 every execution passed · 1 at least one execution failed · 2 usage or pre-flight
 * refusal · 3 no run produced a usable execution.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const SLOT_SCRIPT = path.join(scriptDir, 'xwiki-it-slot.mjs');

/** The wiki is kept alive until this file appears in the Maven run's working directory. */
const STOP_FILE = 'stop.txt';

/** XWikiDockerExtension logs this once the wiki is up and parked, which is the repeats' green light. */
const KEEP_RUNNING_MARKER = 'XWiki is kept running';

/**
 * Lines that prove the run never reached the test. Straight from the symptom table in
 * `okf/testing/running-docker-its.md`: each one is about the machine, not about the code.
 */
const SETUP_FAILURE_MARKERS = [
  'Error setting up the XWiki testing environment',
  'Failed to start XWiki in',
  'Failed to install Extension',
  'Could not start container',
  'dnsNotFound'
];

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error(`Usage: xwiki-it-repeat.mjs --test <Class#method> [options]

  --test SPEC         the test to repeat, as -Dit.test takes it (required)
  --module PATH       the *-test-docker module to run it in (default: the working directory)
  --runs N            repetitions (default 10)
  --mode reuse|fresh  reuse one provisioned wiki, or a full build per run
                      (default: reuse on jetty_standalone, fresh otherwise)
  --browser NAME      firefox | chrome
  --database NAME     hsqldb_embedded | mysql | postgresql | oracle
  --servlet-engine E  jetty_standalone | tomcat | jetty | wildfly
  --label TEXT        names the report and the slot, e.g. before / after
  --out DIR           report and per-run artifacts (default: <module>/target/it-repeat/<label>-<date>)
  --baseline FILE     a previous report.json, to print the before/after comparison
  --timeout MINUTES   per run, killed and reported as a timeout (default 30)
  --slot-max N        concurrent IT runs allowed on this machine (default: the slot script's)
  --slot-wait SECS    how long to queue for a slot (default: the slot script's)
  --mvn CMD           Maven command (default: xmvn when on PATH, else mvn)
  -D key=value        extra Maven property, repeatable
  --dry-run           print the commands instead of running them`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    test: null, module: process.cwd(), runs: 10, mode: null, browser: null, database: null,
    servletEngine: null, label: null, out: null, baseline: null, timeout: 30, slotMax: null,
    slotWait: null, mvn: null, properties: [], dryRun: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--test') options.test = argv[++i];
    else if (arg === '--module') options.module = path.resolve(argv[++i]);
    else if (arg === '--runs') options.runs = Number(argv[++i]);
    else if (arg === '--mode') options.mode = argv[++i];
    else if (arg === '--browser') options.browser = argv[++i];
    else if (arg === '--database') options.database = argv[++i];
    else if (arg === '--servlet-engine') options.servletEngine = argv[++i];
    else if (arg === '--label') options.label = argv[++i];
    else if (arg === '--out') options.out = path.resolve(argv[++i]);
    else if (arg === '--baseline') options.baseline = path.resolve(argv[++i]);
    else if (arg === '--timeout') options.timeout = Number(argv[++i]);
    else if (arg === '--slot-max') options.slotMax = argv[++i];
    else if (arg === '--slot-wait') options.slotWait = argv[++i];
    else if (arg === '--mvn') options.mvn = argv[++i];
    else if (arg === '-D') options.properties.push(argv[++i]);
    else if (arg.startsWith('-D')) options.properties.push(arg.slice(2));
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') usage();
    else usage(`Unknown argument [${arg}].`);
  }
  if (!options.test) usage('--test is required.');
  if (!Number.isInteger(options.runs) || options.runs < 1) usage('--runs must be a positive integer.');
  if (options.mode && !['reuse', 'fresh'].includes(options.mode)) usage('--mode is reuse or fresh.');
  return options;
}

function onPath(command) {
  const finder = process.platform === 'win32' ? 'where' : 'command';
  const result = spawnSync(finder, ['-v', command], { stdio: 'ignore', shell: process.platform !== 'win32' });
  return result.status === 0;
}

/**
 * @returns {string|null} the process listening on the port, or null when nothing is. Windows and any
 *   machine without `lsof` get null, which the caller reads as "cannot tell" rather than "free".
 */
function portHolder(port) {
  if (process.platform === 'win32') return null;
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const lines = result.stdout.trim().split('\n').slice(1);
  return lines.length > 0 ? lines[0].replace(/\s+/g, ' ') : null;
}

function mavenConfiguration(options) {
  const properties = [];
  if (options.browser) properties.push(`-Dxwiki.test.ui.browser=${options.browser}`);
  if (options.database) properties.push(`-Dxwiki.test.ui.database=${options.database}`);
  if (options.servletEngine) properties.push(`-Dxwiki.test.ui.servletEngine=${options.servletEngine}`);
  for (const property of options.properties) properties.push(`-D${property}`);
  return properties;
}

/**
 * Wraps a command in the IT slot limiter. Only the session's long-lived process takes a slot: in
 * reuse mode the provisioning Maven stays alive for the whole session, so its slot covers the
 * repeats running inside it, and asking for a second one would deadlock a single-slot machine.
 */
function withSlot(command, options, label) {
  const slotArguments = [SLOT_SCRIPT];
  if (options.slotMax) slotArguments.push('--max', options.slotMax);
  if (options.slotWait) slotArguments.push('--wait', options.slotWait);
  slotArguments.push('--label', label, '--', ...command);
  return [process.execPath, ...slotArguments];
}

/**
 * Runs a command, streaming its output to the console and to `logFile`.
 *
 * @param onOutput called with each chunk, so a caller can watch for a marker without re-reading
 * @returns {Promise<{code: number|null, signal: string|null, timedOut: boolean, kill: Function}>}
 */
function run(command, cwd, logFile, timeoutMinutes, onOutput) {
  return new Promise(resolve => {
    const log = fs.createWriteStream(logFile);
    log.write(`$ ${command.join(' ')}\n\n`);
    const child = spawn(command[0], command.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = timeoutMinutes > 0
      ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMinutes * 60000)
      : null;
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => {
        log.write(chunk);
        process.stdout.write(chunk);
        if (onOutput) onOutput(chunk.toString());
      });
    }
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      log.end(`\nCannot run [${command[0]}]: ${error.message}\n`);
      resolve({ code: 127, signal: null, timedOut, child });
    });
    child.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      log.end();
      resolve({ code, signal, timedOut, child });
    });
  });
}

/** Starts a command without waiting for it, for the provisioning run that parks until `stop.txt`. */
function start(command, cwd, logFile, onOutput) {
  const log = fs.createWriteStream(logFile);
  log.write(`$ ${command.join(' ')}\n\n`);
  const child = spawn(command[0], command.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => {
    child.on('exit', (code, signal) => { log.end(); resolve({ code, signal }); });
    child.on('error', error => { log.end(`\n${error.message}\n`); resolve({ code: 127, signal: null }); });
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => {
      log.write(chunk);
      process.stdout.write(chunk);
      if (onOutput) onOutput(chunk.toString());
    });
  }
  return { child, exited };
}

/**
 * Reads the executions of one run out of the Failsafe XML reports written since it started.
 *
 * Counted per **test execution**, not per Maven run: a `@RepeatedTest` in the source, or a class
 * with several methods, yields several executions in one report, and the rate is over all of them.
 *
 * One entry is dropped rather than counted: the framework fails a test class that leaves a file
 * outside `target/`, and reports that as a synthetic `executionError` testcase — which the reuse
 * loop's own `stop.txt` trips, since `keepRunning` requires that file in the module directory. It is
 * this tool's footprint, not a result about the test, so it is subtracted and reported separately.
 *
 * @returns {{executions: Array, failures: Array, noise: number}}
 */
function readExecutions(reportsDirectory, since) {
  const executions = [];
  let noise = 0;
  if (!fs.existsSync(reportsDirectory)) return { executions, failures: [], noise };
  for (const name of fs.readdirSync(reportsDirectory)) {
    if (!name.startsWith('TEST-') || !name.endsWith('.xml')) continue;
    const file = path.join(reportsDirectory, name);
    if (fs.statSync(file).mtimeMs < since) continue;
    const xml = fs.readFileSync(file, 'utf8');
    for (const chunk of xml.split('<testcase ').slice(1)) {
      const head = chunk.slice(0, chunk.indexOf('>') + 1);
      const body = chunk.split('</testcase>')[0];
      const attribute = key => (head.match(new RegExp(`${key}="([^"]*)"`)) || [])[1] || '';
      const problem = body.match(/<(failure|error)([^>]*)>/);
      const execution = {
        name: attribute('name'),
        className: attribute('classname'),
        seconds: Number(attribute('time') || 0),
        passed: !problem
      };
      if (problem) {
        const details = problem[2];
        execution.type = (details.match(/type="([^"]*)"/) || [])[1] || problem[1];
        execution.message = decodeXml((details.match(/message="([^"]*)"/) || [])[1] || '').slice(0, 300);
      }
      if (execution.name === 'executionError' && execution.message?.includes(STOP_FILE)) {
        noise++;
        continue;
      }
      executions.push(execution);
    }
  }
  return { executions, failures: executions.filter(execution => !execution.passed), noise };
}

function decodeXml(text) {
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** Copies into the run's directory every artifact the run itself produced, and nothing older. */
function archive(moduleDirectory, runDirectory, since) {
  const archived = [];
  for (const relative of ['target/failsafe-reports', 'target/screenshots']) {
    const source = path.join(moduleDirectory, relative);
    if (!fs.existsSync(source)) continue;
    for (const name of fs.readdirSync(source)) {
      const file = path.join(source, name);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.mtimeMs < since) continue;
      const target = path.join(runDirectory, path.basename(relative));
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(file, path.join(target, name));
      archived.push(path.join(path.basename(relative), name));
    }
  }
  return archived;
}

function setupFailure(logFile) {
  const log = fs.readFileSync(logFile, 'utf8');
  return SETUP_FAILURE_MARKERS.find(marker => log.includes(marker)) || null;
}

/**
 * Turns the runs into the numbers the report is about. Setup errors and timeouts are counted
 * separately and excluded from the rate: they are facts about the machine, and averaging them into
 * a flicker rate is how an oracle starts lying.
 */
function summarise(runs) {
  const executions = runs.flatMap(run => run.executions);
  const passed = executions.filter(execution => execution.passed).length;
  return {
    runs: runs.length,
    executions: executions.length,
    passed,
    failed: executions.length - passed,
    passRate: executions.length > 0 ? passed / executions.length : null,
    setupErrors: runs.filter(run => run.outcome === 'setup-error').length,
    timeouts: runs.filter(run => run.outcome === 'timeout').length,
    noSlot: runs.filter(run => run.outcome === 'no-slot').length,
    noise: runs.reduce((total, run) => total + (run.noise || 0), 0)
  };
}

function percentage(rate) {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

/**
 * What a clean series does and does not prove. With zero failures in n executions the failure rate
 * is still only bounded above by roughly 3/n at 95% confidence (the rule of three) — the reason
 * "I ran it ten times and it passed" is a weak claim about a flicker that fails one run in twelve.
 */
function cleanSeriesCaveat(summary) {
  if (summary.executions === 0 || summary.failed > 0) return null;
  const bound = 3 / summary.executions;
  if (bound >= 0.5) {
    return `${summary.executions} clean executions bound almost nothing: 20 are needed to exclude a `
      + 'failure rate of 15%, 60 to exclude 5% (rule of three, 95% confidence).';
  }
  return `${summary.executions} clean executions bound the failure rate below ${(bound * 100).toFixed(1)}% `
    + '(95% confidence, rule of three) — not to zero.';
}

function renderSummary(report, baseline) {
  const { summary, configuration } = report;
  const lines = [
    `${report.test} — ${summary.runs} runs, ${summary.executions} executions `
      + `(${configuration.mode} mode, ${configuration.browser || 'default browser'} / `
      + `${configuration.database || 'default database'} / ${configuration.servletEngine || 'default engine'})`,
    `passed ${summary.passed}/${summary.executions} (${percentage(summary.passRate)}), failed ${summary.failed}`
  ];
  if (summary.setupErrors > 0) {
    lines.push(`${summary.setupErrors} run(s) failed to set up and are excluded from the rate — `
      + 'the machine, not the test (okf/testing/running-docker-its.md).');
  }
  if (summary.timeouts > 0) lines.push(`${summary.timeouts} run(s) hit the timeout and are excluded from the rate.`);
  if (summary.noSlot > 0) lines.push(`${summary.noSlot} run(s) never got a Docker IT slot and never started.`);
  if (summary.noise > 0) {
    lines.push(`${summary.noise} framework failure(s) about this tool's own ${STOP_FILE} ignored — `
      + 'the file `keepRunning` requires trips the "no files outside target" check.');
  }
  const caveat = cleanSeriesCaveat(summary);
  if (caveat) lines.push(caveat);
  for (const run of report.runs) {
    if (run.outcome === 'passed') continue;
    const failure = run.executions.find(execution => !execution.passed);
    const detail = failure ? `${failure.type}: ${failure.message}`
      : (run.setupMarker || (run.outcome === 'no-slot' ? 'no slot came free' : 'no execution reported'));
    lines.push(`  run ${String(run.index).padStart(2, '0')}  ${run.outcome.toUpperCase()}  `
      + `${Math.round(run.seconds)}s  ${detail}`);
    if (run.artifacts.length > 0) lines.push(`      artifacts: ${path.basename(run.directory)}/`);
  }
  if (baseline) {
    lines.push('', `baseline ${baseline.startedAt.slice(0, 16).replace('T', ' ')}: `
      + `${baseline.summary.passed}/${baseline.summary.executions} (${percentage(baseline.summary.passRate)})`
      + `  →  now ${summary.passed}/${summary.executions} (${percentage(summary.passRate)})`);
  }
  return lines.join('\n');
}

/** The same numbers as Markdown, because a flicker fix's pull request has to carry them. */
function renderMarkdown(report, baseline) {
  const { summary, configuration } = report;
  const configurationText = [configuration.browser, configuration.database, configuration.servletEngine]
    .filter(Boolean).join(' / ') || 'framework defaults';
  const lines = [
    `**${report.test}** repeated ${summary.runs}× on ${configurationText} (${configuration.mode} mode)`,
    '',
    '| | executions | passed | failed | pass rate |',
    '|---|---|---|---|---|'
  ];
  if (baseline) {
    lines.push(`| before (${baseline.startedAt.slice(0, 10)}) | ${baseline.summary.executions} `
      + `| ${baseline.summary.passed} | ${baseline.summary.failed} | ${percentage(baseline.summary.passRate)} |`);
  }
  lines.push(`| ${baseline ? 'after' : report.label || 'run'} | ${summary.executions} | ${summary.passed} `
    + `| ${summary.failed} | ${percentage(summary.passRate)} |`);
  const caveat = cleanSeriesCaveat(summary);
  if (caveat) lines.push('', caveat);
  if (summary.setupErrors > 0 || summary.timeouts > 0) {
    lines.push('', `Excluded from the rate: ${summary.setupErrors} setup error(s), ${summary.timeouts} timeout(s), ${summary.noSlot} run(s) that never got a slot.`);
  }
  lines.push('', 'These runs are local: the integration tests were not run in CI.');
  return lines.join('\n');
}

const options = parseArgs(process.argv.slice(2));

if (!fs.existsSync(path.join(options.module, 'pom.xml'))) {
  usage(`[${options.module}] has no pom.xml — point --module at the *-test-docker module.`);
}

const mvn = options.mvn || (onPath('xmvn') ? 'xmvn' : 'mvn');
const engine = options.servletEngine || 'jetty_standalone';
const mode = options.mode || (engine === 'jetty_standalone' ? 'reuse' : 'fresh');

if (mode === 'reuse' && engine !== 'jetty_standalone') {
  console.error(`--mode reuse needs the jetty_standalone servlet engine: the test framework's EXTERNAL engine is `
    + `hardcoded to localhost:8080, so it cannot reach a [${engine}] container on a mapped port. `
    + 'Use --mode fresh for that configuration.');
  process.exit(2);
}

// Pre-flight, for the reuse loop only: a wiki already on :8080 is the `401` trap — the tests would
// provision into it and fail in beforeAll. Never stop an instance this session did not start.
if (mode === 'reuse' && !options.dryRun) {
  const holder = portHolder(8080);
  if (holder) {
    console.error(`Something already listens on :8080 — [${holder}].\nA jetty_standalone run would provision into `
      + 'it and die in beforeAll with a 401. Stop it yourself if it is yours, or use --mode fresh with a '
      + 'containerised servlet engine.');
    process.exit(2);
  }
}

const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const outputDirectory = options.out
  || path.join(options.module, 'target', 'it-repeat', `${options.label ? `${options.label}-` : ''}${stamp}`);
fs.mkdirSync(outputDirectory, { recursive: true });

const configuration = {
  mode, browser: options.browser, database: options.database, servletEngine: options.servletEngine,
  mvn, module: options.module, properties: options.properties, runs: options.runs
};
const reportsDirectory = path.join(options.module, 'target', 'failsafe-reports');
const runs = [];

const freshCommand = [
  mvn, 'verify', '-B', '-ntp', '-Pdocker,integration-tests', `-Dit.test=${options.test}`,
  ...mavenConfiguration(options)
];
const provisionCommand = [...freshCommand, '-Dxwiki.test.ui.keepRunning=true'];
const repeatCommand = [
  mvn, 'compiler:testCompile', 'failsafe:integration-test', '-B', '-ntp', '-Pdocker,integration-tests',
  `-Dit.test=${options.test}`, ...mavenConfiguration({ ...options, servletEngine: 'external' })
];

if (options.dryRun) {
  console.log(`mode: ${mode}\nmodule: ${options.module}\nreport: ${outputDirectory}\n`);
  if (mode === 'fresh') {
    console.log(`${options.runs}× ${withSlot(freshCommand, options, 'it-repeat').join(' ')}`);
  } else {
    console.log(`1×  ${withSlot(provisionCommand, options, 'it-repeat').join(' ')}`);
    console.log(`${options.runs - 1}×  ${repeatCommand.join(' ')}`);
    console.log(`then: touch ${path.join(options.module, STOP_FILE)}`);
  }
  process.exit(0);
}

/** Records one finished run: what it executed, why it produced nothing, and where its artifacts are. */
function record(index, since, result, logFile) {
  const directory = path.join(outputDirectory, `run-${String(index).padStart(2, '0')}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.renameSync(logFile, path.join(directory, 'mvn.log'));
  const { executions, failures, noise } = readExecutions(reportsDirectory, since);
  const artifacts = archive(options.module, directory, since);
  const marker = setupFailure(path.join(directory, 'mvn.log'));
  let outcome;
  if (result.timedOut) outcome = 'timeout';
  // 75 is the slot script's EX_TEMPFAIL: the run never started, so it is not a fact about the test.
  else if (result.code === 75) outcome = 'no-slot';
  else if (executions.length === 0) outcome = 'setup-error';
  else if (marker && failures.length === 0 && result.code !== 0) outcome = 'setup-error';
  else outcome = failures.length > 0 ? 'failed' : 'passed';
  const run = {
    index, outcome, exitCode: result.code, seconds: (Date.now() - since) / 1000,
    setupMarker: outcome === 'setup-error' ? marker : null,
    executions, noise, artifacts, directory
  };
  runs.push(run);
  console.log(`\n=== run ${index}/${options.runs}: ${outcome} `
    + `(${executions.length} execution(s), ${Math.round(run.seconds)}s) ===\n`);
  return run;
}

let provisioning = null;
const stopFile = path.join(options.module, STOP_FILE);

/** Lets the parked provisioning run finish, so its containers and the wiki go away. */
function stopProvisionedWiki() {
  if (!provisioning) return;
  // Empty on purpose: the framework's StopFileWatcher deletes the file itself only when it is
  // empty, and otherwise logs a warning asking for it to be deleted by hand.
  try { fs.writeFileSync(stopFile, ''); } catch { /* best effort */ }
}
process.on('exit', stopProvisionedWiki);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stopProvisionedWiki(); process.exit(128 + os.constants.signals[signal]); });
}

if (mode === 'fresh') {
  for (let index = 1; index <= options.runs; index++) {
    const since = Date.now();
    const logFile = path.join(outputDirectory, `run-${index}.log`);
    const result = await run(withSlot(freshCommand, options, `it-repeat ${options.test}`), options.module,
      logFile, options.timeout, null);
    record(index, since, result, logFile);
  }
} else {
  // A stop.txt left behind by an interrupted session would stop this one before it started.
  try { fs.unlinkSync(stopFile); } catch { /* not there, which is the normal case */ }

  const since = Date.now();
  const logFile = path.join(outputDirectory, 'run-1.log');
  let parked = false;
  provisioning = start(withSlot(provisionCommand, options, `it-repeat ${options.test}`), options.module, logFile,
    text => { if (text.includes(KEEP_RUNNING_MARKER)) parked = true; });

  const exited = provisioning.exited.then(result => ({ ...result, ended: true }));
  while (!parked) {
    const outcome = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 2000))]);
    if (outcome && outcome.ended) {
      provisioning = null;
      record(1, since, { code: outcome.code, timedOut: false }, logFile);
      console.error('\nThe provisioning run ended without parking the wiki — nothing to repeat against. '
        + `Its log is in ${outputDirectory}.`);
      break;
    }
    if ((Date.now() - since) / 60000 > options.timeout) {
      console.error(`\nThe provisioning run did not park the wiki within ${options.timeout} minutes.`);
      provisioning.child.kill('SIGTERM');
      break;
    }
  }

  if (parked) {
    // Run 1 is the provisioning run itself: it executed the test before parking, so its result counts.
    // Its screenshots exist already, but its Failsafe report does not — that JVM is parked inside
    // afterAll and writes the report only once stop.txt lets it finish. So the artifacts are taken
    // now, before a repeat overwrites them, and the executions are read at the end.
    const directory = path.join(outputDirectory, 'run-01');
    fs.mkdirSync(directory, { recursive: true });
    const first = {
      index: 1, outcome: 'pending', exitCode: null, seconds: 0, setupMarker: null,
      executions: [], noise: 0, artifacts: archive(options.module, directory, since), directory
    };
    runs.push(first);
    console.log(`\n=== run 1/${options.runs}: wiki provisioned and kept running ===\n`);

    for (let index = 2; index <= options.runs; index++) {
      const runSince = Date.now();
      const runLog = path.join(outputDirectory, `run-${index}.log`);
      const result = await run(repeatCommand, options.module, runLog, options.timeout, null);
      record(index, runSince, result, runLog);
    }

    const stoppedAt = Date.now();
    stopProvisionedWiki();
    const outcome = await provisioning.exited;
    provisioning = null;
    try { fs.unlinkSync(stopFile); } catch { /* already gone */ }
    fs.renameSync(logFile, path.join(directory, 'mvn.log'));
    const firstRead = readExecutions(reportsDirectory, stoppedAt);
    first.executions = firstRead.executions;
    first.noise = firstRead.noise;
    // Its report, and anything else that JVM only wrote on its way out.
    first.artifacts.push(...archive(options.module, directory, stoppedAt));
    first.exitCode = outcome.code;
    // Wall-clock would be the whole parked session, so run 1 is timed by what it reports itself.
    first.seconds = first.executions.reduce((total, execution) => total + execution.seconds, 0);
    first.outcome = first.executions.length === 0 ? 'setup-error'
      : (first.executions.some(execution => !execution.passed) ? 'failed' : 'passed');
    if (first.outcome === 'setup-error') first.setupMarker = setupFailure(path.join(directory, 'mvn.log'));
  }
}

const baseline = options.baseline && fs.existsSync(options.baseline)
  ? JSON.parse(fs.readFileSync(options.baseline, 'utf8')) : null;
const report = {
  test: options.test, label: options.label, startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(), configuration, summary: summarise(runs),
  baseline: baseline ? { label: baseline.label, startedAt: baseline.startedAt, summary: baseline.summary } : null,
  runs: runs.map(run => ({ ...run, directory: path.relative(outputDirectory, run.directory) }))
};
fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, 'summary.md'), `${renderMarkdown(report, baseline)}\n`);

console.log(`\n${renderSummary(report, baseline)}\n\nreport: ${outputDirectory}`);

if (report.summary.executions === 0) process.exit(3);
process.exit(report.summary.failed > 0 ? 1 : 0);
