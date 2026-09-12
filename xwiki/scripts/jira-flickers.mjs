// The open flickering-test issues on jira.xwiki.org, as a lookup from a CI test id to its issue.
//
// Shared because two skills join a CI failure to its issue and must agree on what "known flicker"
// means: xwiki-release-test-triage reports the join, xwiki-ci-check decides from it whether a
// flicker still needs filing. The field and label conventions are in okf/servers/jira.md.
//
// Read access is anonymous — no token.

export const JIRA = "https://jira.xwiki.org";

// "Flickering tests" (filter 14240), the list every Release Plan links to.
const FLICKER_JQL = 'labels = flickering AND status in (Open, "In Progress", Reopened)';
// The "Flickering Test" field, holding the fully-qualified test as CI reports it.
const FLICKER_FIELD = "customfield_10870";

const search = async (jql, fields) => {
  const url = `${JIRA}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=200&fields=${fields}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

/**
 * Builds the lookup once, then answers from memory.
 *
 * @param jql {string} defaults to the open flickers; pass the closed ones to spot a resurrection.
 * @returns {Promise<(id: string) => {key: string, summary: string, status: string}|null>} given a
 *   `class#method` test id, the issue tracking it, or null.
 */
export async function knownFlickers(jql = FLICKER_JQL) {
  const data = await search(jql, `summary,status,${FLICKER_FIELD}`);
  const byTest = new Map();
  const all = [];
  for (const issue of data?.issues || []) {
    const entry = { key: issue.key, summary: issue.fields.summary, status: issue.fields.status?.name || "" };
    all.push(entry);
    const ref = issue.fields[FLICKER_FIELD];
    if (ref) byTest.set(ref.trim().replace(/\(.*$/, ""), entry);
  }
  // Not every flicker issue fills the field in, so fall back to the summary — but only when it
  // names both the class and the method, since a bare method name matches far too much.
  return id => {
    const exact = byTest.get(id);
    if (exact) return exact;
    const [className, method] = id.split("#");
    const simpleName = className.split(/[.$]/).pop().replace(/^Nested/, "");
    return all.find(issue => issue.summary.includes(simpleName) && issue.summary.includes(method)) || null;
  };
}

/** The same lookup over *closed* flicker issues: a hit there is a flicker that came back. */
export const closedFlickers = () =>
  knownFlickers('labels = flickering AND status in (Closed, Resolved)');
