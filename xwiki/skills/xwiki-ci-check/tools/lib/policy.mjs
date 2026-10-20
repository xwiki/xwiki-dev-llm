/*
 * Which branches the sweep covers, how they rank, and which of them may raise an alert. Part of
 * ci-check.mjs.
 */


// ---- Branch policy ---------------------------------------------------------------------------
// master is where the next version is developed; a `*.4.x` / `*.10.x` stable branch is an LTS,
// maintained for a long time; every other stable branch is transient — cut at a release and rarely
// touched again, so *silence on it is health, not a symptom*. Alerting stops two cycles back: an
// XWiki cycle is a major version, so with 18.x current, 16.x is the oldest branch worth a ping.

const CYCLE_DEPTH = 2;

/** @returns {{class: 'dev'|'lts'|'transient', cycle: number|null}} */
export function classifyBranch(branch) {
  if (branch === 'master') return { class: 'dev', cycle: null };
  const version = branch.match(/^stable-(\d+)\.(\d+)\.x$/);
  if (!version) return { class: 'transient', cycle: null };
  const [, major, minor] = version.map(Number);
  // The long-term-supported minors. They are the cycle's last release (`.10`) and its mid-cycle
  // one (`.4`); everything else in the same cycle is a transient stable branch.
  const lts = minor === 4 || minor === 10;
  return { class: lts ? 'lts' : 'transient', cycle: major };
}

/** Annotates each branch with its class and whether this run is allowed to raise an alert on it. */
export function withPolicy(branches) {
  const cycles = branches.map(b => classifyBranch(b).cycle).filter(c => c != null);
  const currentCycle = cycles.length ? Math.max(...cycles) : null;
  return branches.map(branch => {
    const { class: branchClass, cycle } = classifyBranch(branch);
    const inWindow = cycle == null || currentCycle == null || cycle >= currentCycle - CYCLE_DEPTH;
    return { branch, branchClass, cycle, alerting: branchClass !== 'transient' && inWindow };
  });
}

/** Branches ordered as a fix travels: master, then the newest LTS, then the rest. */
export function branchRank(branch) {
  const { class: branchClass, cycle } = classifyBranch(branch);
  return { dev: 0, lts: 1, transient: 2 }[branchClass] * 1000 - (cycle ?? 0);
}
