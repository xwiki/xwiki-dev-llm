/*
 * Small helpers shared by the sweep's modules — kept apart so that no two of them import each other.
 */

export const DAY = 86400000;
export const daysSince = timestamp => Math.floor((Date.now() - timestamp) / DAY);
export const dayOf = timestamp => new Date(timestamp).toISOString().slice(0, 10);

export const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;


export const testName = id => {
  const [className, method] = String(id).split('#');
  const simple = className.split(/[.$]/).pop().replace(/^Nested/, '');
  return method ? `${simple}#${method}` : simple;
};


/**
 * What two incidents on two branches share when they are one cause: the repo, and the signature —
 * or the root cause their tests share, since those tests, and so the signature, differ by branch.
 * The id carries the signature (`<repo>/<branch>/<signature>`), and survives the work order's digest.
 */
export const causeKey = incident => `${incident.repo}\u0000${incident.rootCause
  ? `cause:${incident.rootCause}` : incident.id.split('/').slice(2).join('/')}`;

/** Whether the branch already answers for the *whole* incident — the only case that goes quiet. */
export const settled = incident => !!incident.fixState && !incident.fixState.partial && !incident.fixState.candidate;
