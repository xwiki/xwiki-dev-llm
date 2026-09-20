// The open flickering-test issues on jira.xwiki.org, as a lookup from a CI test id to its issue.
//
// Shared because two skills join a CI failure to its issue and must agree on what "known flicker"
// means: xwiki-release-test-triage reports the join, xwiki-ci-check decides from it whether a
// flicker still needs filing. The field and label conventions are in okf/servers/jira.md.
//
// Read access is anonymous — no token.
//
// Use this module rather than querying the "Flickering Test" field yourself, because that field has
// two JQL traps and getting either wrong makes a test that HAS an issue look untracked — which, in
// an auto-filer, is how a duplicate gets created:
//
//   * `=` is rejected outright ("The operator '=' is not supported by the 'Flickering Test' field").
//     Only `~`, `is EMPTY` and `is not EMPTY` work.
//   * `~` matches tokens, not substrings, and the tokeniser splits on `$`. So
//     `"Flickering Test" ~ "RecycleBinIT"` finds nothing, while `~ "NestedRecycleBinIT"` finds the
//     issue. Matching here is done in memory against the whole field instead, so neither applies.

export const JIRA = "https://jira.xwiki.org";

// "Flickering tests" (filter 14240), the list every Release Plan links to.
const FLICKER_JQL = 'labels = flickering AND status in (Open, "In Progress", Reopened)';
// The "Flickering Test" field, holding the fully-qualified test as CI reports it.
const FLICKER_FIELD = "customfield_10870";

// Paged, because a single 200-issue request silently truncates: the *closed* flickers are already
// past 270, and a lookup that drops the tail reports "no issue" for a test that has one.
const search = async (jql, fields) => {
  const issues = [];
  for (let startAt = 0; ; ) {
    const url = `${JIRA}/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}`
      + `&maxResults=200&fields=${fields}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const page = await res.json();
    issues.push(...(page.issues || []));
    startAt += page.maxResults ?? 200;
    if (issues.length >= (page.total ?? 0) || !(page.issues || []).length) return { issues };
  }
};

/**
 * Builds the lookup once, then answers from memory.
 *
 * @param jql {string} defaults to the open flickers; pass the closed ones to spot a resurrection.
 * @returns {Promise<(id: string) => {key: string, summary: string, status: string,
 *   fixVersions: string[]}|null>} given a `class#method` test id, the issue tracking it, or null.
 *   `fixVersions` is what makes a closed hit actionable: compare it with the branch that is red to
 *   tell "the fix never shipped on this line" from "it shipped here and did not hold".
 */
export async function knownFlickers(jql = FLICKER_JQL) {
  const data = await search(jql, `summary,status,fixVersions,${FLICKER_FIELD}`);
  const byTest = new Map();
  const all = [];
  // Newest first, so that when a test has been filed more than once the *current* issue wins. JIRA
  // returns an unordered page, and a Map keyed by test keeps whichever arrived last — which on
  // `NavigationPanelAdministrationIT` meant answering with a 2024 issue whose fix shipped on every
  // line instead of the 2026 one that did not, i.e. reporting a live backport gap as settled.
  const byNewest = [...(data?.issues || [])]
    .sort((a, b) => Number(b.key.split("-")[1]) - Number(a.key.split("-")[1]));
  for (const issue of byNewest) {
    // `earlier` is on every entry, including the ones the summary fallback below returns, so a
    // caller can read it without checking which path produced the answer.
    const entry = {
      key: issue.key, summary: issue.fields.summary, status: issue.fields.status?.name || "",
      fixVersions: (issue.fields.fixVersions || []).map(version => version.name), earlier: []
    };
    all.push(entry);
    const ref = issue.fields[FLICKER_FIELD];
    if (ref) {
      const test = ref.trim().replace(/\(.*$/, "");
      const seen = byTest.get(test);
      // Keep the newest as the answer and remember the rest: "this test has been filed three times
      // before" is itself the finding on a flicker that keeps coming back.
      if (seen) seen.earlier.push(entry.key);
      else byTest.set(test, entry);
    }
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
