#!/usr/bin/env node
/**
 * What a SonarCloud quality gate failed on, and who wrote the code that failed it.
 *
 * A gate failure looked unattributable for as long as the only thing read about it was the Jenkins
 * log: that log says `QUALITY GATE STATUS: FAILED` and nothing else, so file overlap has nothing to
 * overlap and the commits in the regression window are a list of people none of whom can be shown
 * to have caused anything. SonarCloud knows all of it — which condition failed, the new-code issues
 * under that condition, and for each of them the file, the line, the rule, the day it was first
 * raised and (from the SCM data of the analysis) the author of the line.
 *
 * So this module answers two questions and stops: **what failed the gate**, and **whose code is
 * under it**. Turning an author and a file into a commit is `ci-check.mjs`'s job, because that is
 * where the GitHub client and its token already are.
 *
 *   node sonar-gate.mjs xwiki-platform master        # the facts, as JSON
 *
 * Credentials: `SONARQUBE_TOKEN` (the same one `xwiki/.mcp.json` gives the `sonarqube` MCP server).
 * Without it the module reports itself unavailable and the sweep carries on exactly as it did
 * before — no gate facts this morning, which is a fact worth printing and not a failure.
 */

const SONAR = process.env.SONARQUBE_URL || 'https://sonarcloud.io';

/** The three repos this skill sweeps, and their SonarCloud projects. */
const PROJECTS = {
  'xwiki-commons': 'org.xwiki.commons:xwiki-commons',
  'xwiki-rendering': 'org.xwiki.rendering:xwiki-rendering',
  'xwiki-platform': 'org.xwiki.platform:xwiki-platform'
};

/**
 * Which issues explain a failing condition. A rating is a rating *of* something — the worst issue
 * of that software quality in new code — so the condition names the query that lists them.
 *
 * The other conditions are named and not explained: duplication and reviewed hotspots are not an
 * issue list, and coverage is a per-file measure. Saying "the gate failed on new_coverage" and
 * stopping there is honest; inventing an author for it would not be.
 */
const EXPLAINED_BY = {
  new_reliability_rating: { impactSoftwareQualities: 'RELIABILITY' },
  new_security_rating: { impactSoftwareQualities: 'SECURITY' },
  new_maintainability_rating: { impactSoftwareQualities: 'MAINTAINABILITY' },
  new_violations: {},
  new_blocker_violations: { impactSeverities: 'BLOCKER' },
  new_critical_violations: { impactSeverities: 'HIGH' }
};

const CONDITION_NAMES = {
  new_reliability_rating: 'reliability of new code',
  new_security_rating: 'security of new code',
  new_maintainability_rating: 'maintainability of new code',
  new_coverage: 'coverage of new code',
  new_duplicated_lines_density: 'duplication in new code',
  new_security_hotspots_reviewed: 'security hotspots reviewed'
};

const RATINGS = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' };
const readable = (metric, value) => (/_rating$/.test(metric)
  ? `${RATINGS[Math.round(Number(value))] || value}`
  : `${value}`);

async function call(path, params, token) {
  const url = `${SONAR}/api/${path}?${new URLSearchParams(params)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` }
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map(error => error.msg).join('; '));
  return body;
}

/**
 * The gate of one branch: its failing conditions, and the new-code issues under each of them.
 *
 * `{ unavailable }` for everything that is not an answer — no token, no such project or branch, a
 * refused request. The caller treats that exactly like a missing Develocity key: report that there
 * are no gate facts, and change nothing else.
 */
export async function gateFacts(repo, branch, { issueLimit = 12 } = {}) {
  const token = process.env.SONARQUBE_TOKEN;
  if (!token) return { unavailable: 'SONARQUBE_TOKEN is not set' };
  const projectKey = process.env.SONARQUBE_PROJECT_KEY || PROJECTS[repo];
  if (!projectKey) return { unavailable: `no SonarCloud project is known for ${repo}` };

  let status;
  try {
    status = (await call('qualitygates/project_status', { projectKey, branch }, token)).projectStatus;
  } catch (error) {
    return { unavailable: `${error.message}`.slice(0, 160) };
  }
  const period = status?.periods?.[0] || status?.period || null;
  const failing = (status?.conditions || []).filter(condition => condition.status !== 'OK');
  const facts = {
    projectKey,
    branch,
    status: status?.status || null,
    // What "new code" means on this project, since every condition below is about that window and
    // an issue raised before it is not what failed the gate.
    newCodePeriod: period && (period.mode === 'days' ? `last ${period.parameter} days` : period.mode),
    newCodeSince: period?.date ? period.date.slice(0, 10) : null,
    url: `${SONAR}/project/issues?id=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(branch)}&inNewCodePeriod=true`,
    conditions: failing.map(condition => ({
      metric: condition.metricKey,
      name: CONDITION_NAMES[condition.metricKey] || condition.metricKey,
      actual: readable(condition.metricKey, condition.actualValue),
      threshold: readable(condition.metricKey, condition.errorThreshold),
      explained: !!EXPLAINED_BY[condition.metricKey]
    })),
    issues: []
  };
  if (!failing.length) return facts;

  // Newest first, because the issue that turned the gate red is the newest one under the condition
  // — and because an issue raised months ago is a different conversation from one raised last night.
  for (const condition of failing) {
    const filter = EXPLAINED_BY[condition.metricKey];
    if (!filter) continue;
    let found;
    try {
      found = await call('issues/search', {
        componentKeys: projectKey, branch, resolved: 'false', sinceLeakPeriod: 'true',
        s: 'CREATION_DATE', asc: 'false', ps: String(issueLimit), ...filter
      }, token);
    } catch (error) {
      facts.issuesUnavailable = `${error.message}`.slice(0, 160);
      continue;
    }
    for (const issue of found.issues || []) {
      facts.issues.push({
        metric: condition.metricKey,
        rule: issue.rule,
        // The path inside the repo: the component key is `<projectKey>:<path>`.
        file: String(issue.component || '').slice(projectKey.length + 1),
        line: issue.line ?? null,
        severity: (issue.impacts || []).map(impact => impact.severity).join(',') || issue.severity || null,
        message: String(issue.message || '').slice(0, 160),
        // The SCM author of the line, as the analysis recorded it. Often empty — a file with no SCM
        // data, or a line older than the blame the analysis had — which is why `ci-check.mjs` looks
        // the commit up by path as well, and why neither alone is allowed to assert anything.
        author: issue.author || null,
        raisedOn: (issue.creationDate || '').slice(0, 10),
        url: `${SONAR}/project/issues?id=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(branch)}&open=${encodeURIComponent(issue.key)}`
      });
    }
    // The count matters more than the list: "three issues fail this, here are the newest" is the
    // shape of the answer, and `total` is the only place the rest of them are.
    facts.total = (facts.total || 0) + (found.total ?? found.paging?.total ?? (found.issues || []).length);
  }
  return facts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [repo, branch = 'master'] = process.argv.slice(2);
  if (!repo) {
    process.stderr.write('Usage: node sonar-gate.mjs <repo> [branch]\n');
    process.exit(2);
  }
  console.log(JSON.stringify(await gateFacts(repo, branch), null, 2));
}
