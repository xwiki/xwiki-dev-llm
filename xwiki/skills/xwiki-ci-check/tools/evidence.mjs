#!/usr/bin/env node
/*
 * The evidence of one failure that the work order does not carry, read narrowly: what a run used to
 * hand to a human as "someone → read the server log of #9007", it reads here itself.
 *
 * For a failing test, from the build's test report — never its ~80 MB console:
 *   - each distinct failure (grouped by the trace's first line), with the environments it failed in;
 *   - its stack, cut to the exception lines and the `org.xwiki` frames;
 *   - the server's own log for that test — the Docker tests capture it in the case's stdout, as
 *     `ServletContainerExecutor - STDOUT:` lines — kept to errors, exceptions and their stacks;
 *   - the screenshot and video archived for it.
 * For a build break, the lines of the failing stage's own step log matching a pattern.
 *
 * Read-only, like the sweep. Usage:
 *   node evidence.mjs --build <build URL> --test <Class#method>
 *   node evidence.mjs --build <build URL> --grep <regex> [--max 60]
 */

import { CI, failedNodesOf, getJSON, stagesOf, stepConsole, stepLog, tree } from '../../../scripts/jenkins.mjs';

const USAGE = 'Usage: node evidence.mjs --build <build URL> (--test <Class#method> | --grep <regex>) [--max <n>]';

/** The lines of a stack worth reading: what was thrown, why, and where in XWiki's own code. */
export function stackOf(trace, frames = 12) {
  const kept = [];
  let xwiki = 0;
  for (const line of String(trace || '').split('\n')) {
    const frame = line.trim().startsWith('at ');
    if (!frame) {
      if (line.trim() && !/^(Build info|System info|Driver info|Capabilities|Session ID|Command):?/.test(line.trim())) {
        kept.push(line.trimEnd().slice(0, 300));
      }
    } else if (/\borg\.xwiki\./.test(line) && xwiki++ < frames) {
      kept.push(line.trimEnd());
    }
  }
  return kept.slice(0, 40);
}

const SERVER = /ServletContainerExecutor - (?:STDOUT|STDERR): /;
const STACK_LINE = /^\s+at |^Caused by|^\s+\.\.\. \d+ more/;
// What the server logs on every start, failure or not: reporting it would bury the one line that
// matters under the same twenty every test prints.
const NOISE = new RegExp(['MavenExtensionScanner - Collision', 'Not all security plugins configured',
  'sun\\.misc\\.Unsafe', 'terminally deprecated', 'Invalid cookie header', '--enable-native-access',
  'restricted method'].join('|'));

/** The server's own errors during one test, each with the stack lines right under it. */
export function serverErrors(stdout, max = 40) {
  const lines = String(stdout || '').split('\n').filter(line => SERVER.test(line))
    .map(line => line.split(SERVER)[1]);
  const kept = [];
  for (let index = 0; index < lines.length && kept.length < max; index++) {
    const line = lines[index];
    if (!/\b(ERROR|FATAL)\b|Exception|Caused by/.test(line) || NOISE.test(line)) continue;
    kept.push(line.slice(0, 300));
    for (let next = index + 1; next < lines.length && STACK_LINE.test(lines[next]); next++) {
      if (/^Caused by/.test(lines[next]) || /\borg\.xwiki\./.test(lines[next])) kept.push(lines[next].slice(0, 300));
      index = next;
    }
  }
  return [...new Set(kept)].slice(0, max);
}

const environmentOf = suite => String(suite.enclosingBlockNames?.slice(-1)[0] || 'main')
  .replace(/ - Docker tests.*$/, '');

async function testEvidence(build, test) {
  const [className, method] = test.split('#');
  const simple = className.split(/[.$]/).pop().replace(/^Nested/, '');
  const fields = tree('suites[enclosingBlockNames,cases[className,name,status,errorStackTrace,stdout]]');
  const report = await getJSON(`${build}/testReport/api/json?tree=${fields}`);
  const failures = new Map();
  for (const suite of report?.suites || []) {
    for (const entry of suite.cases || []) {
      if (!['FAILED', 'REGRESSION'].includes(entry.status)) continue;
      const entrySimple = entry.className.split(/[.$]/).pop().replace(/^Nested/, '');
      if (entrySimple !== simple || (method && entry.name.replace(/\(.*$/, '') !== method)) continue;
      const stack = stackOf(entry.errorStackTrace);
      const key = stack[0] || '(no trace)';
      if (!failures.has(key)) failures.set(key, { stack, environments: [], server: serverErrors(entry.stdout) });
      failures.get(key).environments.push(environmentOf(suite));
    }
  }
  const out = [`# ${test} in ${build}`];
  if (!failures.size) out.push('', 'No failing case of this test in the build\'s test report.');
  let number = 0;
  for (const { stack, environments, server } of failures.values()) {
    out.push('', `## Failure ${++number} — ${environments.length} environment(s): ${environments.join('; ')}`,
      '', '```', ...stack, '```');
    out.push('', server.length ? ['Server log during the test:', '', '```', ...server, '```'].join('\n')
      : 'Server log during the test: no error.');
  }
  const artifacts = await getJSON(`${build}/api/json?tree=${tree('artifacts[relativePath]')}`);
  const mine = (artifacts?.artifacts || []).map(artifact => artifact.relativePath)
    .filter(path => path.includes(simple) && (!method || path.includes(method)))
    .sort((a, b) => Number(b.endsWith('.png')) - Number(a.endsWith('.png')));
  out.push('', mine.length ? 'Archived for it (the screenshot first — it shows what the page really was):'
    : 'Nothing archived for it.');
  for (const path of mine.slice(0, 8)) out.push(`- ${build}/artifact/${path.replace(/\$/g, '%24')}`);
  return out.join('\n');
}

async function grepEvidence(build, pattern, max) {
  const re = new RegExp(pattern);
  const out = [`# /${pattern}/ in the failing stages of ${build}`];
  for (const stage of (await stagesOf(build)).filter(entry => entry.status === 'FAILED')) {
    for (const node of (await failedNodesOf(stage)).slice(0, 3)) {
      const { lines, consoleUrl } = await stepLog(node);
      const all = consoleUrl ? await stepConsole(consoleUrl) : lines;
      const hits = all.filter(line => re.test(line)).slice(0, max);
      out.push('', `## ${stage.name} — ${hits.length} line(s)`, '',
        '```', ...hits.map(line => line.slice(0, 300)), '```');
    }
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const options = { max: 60 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--build') options.build = argv[++i].replace(/\/+$/, '');
    else if (argv[i] === '--test') options.test = argv[++i];
    else if (argv[i] === '--grep') options.grep = argv[++i];
    else if (argv[i] === '--max') options.max = Number(argv[++i]);
    else { console.error(USAGE); process.exit(2); }
  }
  if (!options.build?.startsWith(CI) || !(options.test || options.grep)) {
    console.error(USAGE);
    process.exit(2);
  }
  console.log(options.test ? await testEvidence(options.build, options.test)
    : await grepEvidence(options.build, options.grep, options.max));
}
