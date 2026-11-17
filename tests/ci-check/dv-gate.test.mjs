// Whether a "proven" flicker is a regression in its Develocity history. On 2026-11-17
// PDFExportIT#liveData was filed as a flicker on master (XWIKI-25778) after passing 19–20 runs per
// configuration and failing every one of them since 2026-11-13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regressionOf } from '../../xwiki/skills/xwiki-ci-check/tools/dv-test-history.mjs';

const rate = (name, failures, passBefore, passInSpan, passAfter, firstFail = '2026-11-13') =>
  ({ name, failures, runs: failures + passBefore + passInSpan + passAfter, passBefore, passInSpan, passAfter, firstFail });

const LIVE_DATA = { rates: [
  rate('master / chrome / postgresql latest / tomcat 11-jdk25', 5, 20, 0, 0),
  rate('master / firefox / oracle 19.3.0-se2 / jetty 12-jdk25', 5, 19, 0, 0),
  rate('master / chrome / mysql latest / tomcat 11-jdk25', 4, 20, 0, 0, '2026-11-14'),
  rate('master / firefox / mariadb latest / jetty 12-jdk25', 4, 19, 0, 0)
] };

test('a test failing every run since a day, after passing before, is a regression on that branch', () => {
  assert.equal(regressionOf(LIVE_DATA, 'master'), '2026-11-13');
});

test('one clean run among the failures, anywhere on the branch, keeps it a flicker', () => {
  const facts = { rates: [...LIVE_DATA.rates.slice(1), rate('master / chrome / postgresql latest / tomcat 11-jdk25', 5, 20, 1, 0)] };
  assert.equal(regressionOf(facts, 'master'), null);
  const healed = { rates: [rate('master / chrome / postgresql latest / tomcat 11-jdk25', 5, 20, 0, 3)] };
  assert.equal(regressionOf(healed, 'master'), null);
});

test('one failure is an event, and a test that never passed is not a change', () => {
  assert.equal(regressionOf({ rates: [rate('master / a / b / c', 1, 20, 0, 0)] }, 'master'), null);
  assert.equal(regressionOf({ rates: [rate('master / a / b / c', 5, 0, 0, 0)] }, 'master'), null);
});

test('only the incident\'s own branch is read, and no history says nothing', () => {
  assert.equal(regressionOf(LIVE_DATA, 'stable-18.10.x'), null);
  assert.equal(regressionOf({ rates: [] }, 'master'), null);
  assert.equal(regressionOf({ unavailable: 'no key' }, 'master'), null);
});
