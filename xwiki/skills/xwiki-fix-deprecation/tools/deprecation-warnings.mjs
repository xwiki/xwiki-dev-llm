#!/usr/bin/env node
// Group the javac deprecation warnings of one or more Maven build logs by deprecated API.
//
// XWiki builds compile with -Xlint:all and showDeprecation, so every build log already lists each call to a
// deprecated API, resolved by type (overloads and common names are not a problem here):
//   [WARNING] /path/Foo.java:[12,34] bar(java.lang.String) in org.acme.Baz has been deprecated
//
// Usage: node deprecation-warnings.mjs <maven.log>... [--api <substring>]
//
// javac does NOT report a use from the same top-level class, nor from code that is itself @Deprecated:
// complete this list with a grep before concluding that an API has no caller left.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const apiIdx = args.indexOf('--api');
const apiFilter = apiIdx >= 0 ? args.splice(apiIdx, 2)[1] : null;

const RE = /\[WARNING\] (\S+\.java):\[(\d+),\d+\] (.+?) in (\S+) has been deprecated( and marked for removal)?/;
const byApi = new Map();
for (const log of args) {
  for (const line of readFileSync(log, 'utf8').split('\n')) {
    const m = line.match(RE);
    if (!m) continue;
    const [, file, lineNo, member, owner, removal] = m;
    // A deprecated type is reported as "<Type> in <package>".
    const api = /^[A-Z]\w*$/.test(member) ? `${owner}.${member}` : `${owner}#${member}`;
    if (apiFilter && !api.includes(apiFilter)) continue;
    if (!byApi.has(api)) byApi.set(api, { removal: !!removal, sites: new Set() });
    byApi.get(api).sites.add(`${file}:${lineNo}`);
  }
}

const sorted = [...byApi.entries()].sort((a, b) => b[1].sites.size - a[1].sites.size || a[0].localeCompare(b[0]));
for (const [api, { removal, sites }] of sorted) {
  const all = [...sites];
  const tests = all.filter(s => s.includes('/src/test/')).length;
  console.log(`${api}${removal ? ' [forRemoval]' : ''}: ${all.length - tests} main, ${tests} test`);
  for (const s of all.sort()) console.log(`  ${s}`);
}
if (!sorted.length) console.log('No deprecation warning found.');
