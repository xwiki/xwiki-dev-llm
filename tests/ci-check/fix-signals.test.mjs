// What may already answer an incident. On 2026-10-23 `InplaceEditIT#editInplaceFromOldRevision`
// failed in stable-17.10.x's Environment Tests only, and stable-18.4.x's main job failed it too: the
// 17.10.x row was called a stale snapshot, and the 18.4.x one, the real breakage, went unowned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtFromSource, staleSnapshot } from '../../xwiki/skills/xwiki-ci-check/tools/lib/fix-signals.mjs';

const TEST = 'org.xwiki.edit.test.ui.docker.AllIT$NestedInplaceEditIT#editInplaceFromOldRevision';
const incident = (branch, failingJobs) => ({
  repo: 'xwiki-platform', branch, class: 1, kind: 'test-breakage', signature: TEST, tests: [TEST], failingJobs
});
const ENV_ONLY = incident('stable-17.10.x', ['env-tests']);
const FROM_SOURCE = incident('stable-18.4.x', ['env-tests', 'main']);

test('a failure in the main job is built from source, one in Environment Tests alone is not', () => {
  assert.equal(builtFromSource(FROM_SOURCE), true);
  assert.equal(builtFromSource(ENV_ONLY), false);
  assert.equal(builtFromSource({ window: { job: 'main' } }), true);
});

test('no stale snapshot where the same failure is built from source on another branch', async () => {
  // Answered before any request: no job, no token, nothing read.
  assert.equal(await staleSnapshot(ENV_ONLY, [], { github: true }, [FROM_SOURCE, ENV_ONLY]), null);
});
