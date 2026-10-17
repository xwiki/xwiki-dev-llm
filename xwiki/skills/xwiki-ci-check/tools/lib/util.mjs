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


/** Whether the branch already answers for the *whole* incident — the only case that goes quiet. */
export const settled = incident => !!incident.fixState && !incident.fixState.partial && !incident.fixState.candidate;
