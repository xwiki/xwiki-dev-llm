#!/usr/bin/env node
/**
 * Gathers a developer's open work — GitHub pull requests, JIRA issues, forum topics they started —
 * applies the deterministic "how close is it to done" rules of the xwiki-daily-close skill, and
 * ranks what is worth closing today.
 *
 * The rules live here rather than in the skill's prose so that "ready" means the same thing every
 * day and for every developer, and can be reviewed in a pull request. What code cannot decide (did
 * this thread reach a conclusion, does this comment ask something of you) is left as questions for
 * the session's model, which answers them into a file that `rank` merges back.
 *
 *   node daily-close.mjs collect [--only gh|jira|forum]   gather + classify, write today's run file
 *   node daily-close.mjs pending                           items still waiting for a judgement
 *   node daily-close.mjs show <itemId>                     one item's facts, questions and evidence
 *   node daily-close.mjs rank [--budget N] [--others-budget N]   merge the answers, rank, print the report
 *   node daily-close.mjs accept <topicId> <postNumber>      mark a forum post as the solution (writes)
 *   node daily-close.mjs done <itemId> <action>            record an action taken through the skill
 *   node daily-close.mjs config [key=value ...]            show or set github/jira/forum/budget/othersBudget
 *
 * State lives in `<work root>/daily-close/` (see state-dir.mjs): `config.json`, `history.jsonl`,
 * `actions.jsonl`, and `runs/<date>.json` with the model's `runs/<date>.answers.json` next to it.
 *
 * Every remote failure is an error that names the category it broke, never an empty result: the
 * GitHub search API answers HTTP 403 once past 30 requests a minute, and a script that read that as
 * "nothing found" would report every issue as having no commit.
 *
 * Node built-ins only, plus the `gh` CLI for GitHub (it owns the developer's login).
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workRoot } from "./state-dir.mjs";

const JIRA = "https://jira.xwiki.org";
const FORUM = "https://forum.xwiki.org";
const DAY = 864e5;
// Past this much time without human activity an item is stale: counted in the stats, never offered.
const STALE_DAYS = 365;
// A repository where the developer wrote at least this share of the last year's commits has no
// second reviewer to wait for, so the approval rule does not hold its pull requests back.
const SOLE_COMMITTER_SHARE = 0.9;
const DEFAULT_BUDGET = 10;
const DEFAULT_OTHERS_BUDGET = 5;
// Accounts whose comments are not a human waiting for an answer.
const BOTS = new Set(["claude", "sonarqubecloud", "socket-security", "renovate-bot", "renovate",
  "dependabot", "github-actions", "codecov", "xwikiorg"]);

const dir = join(workRoot(), "daily-close");
const runsDir = join(dir, "runs");
const today = new Date().toISOString().slice(0, 10);

// ---- small helpers ---------------------------------------------------------------------------

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const days = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);
const isBot = (login) => !login || login.endsWith("[bot]") || BOTS.has(login);
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const writeJson = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
const latest = (...isos) => isos.filter(Boolean).sort().at(-1) ?? null;
const keyPattern = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i] ?? true;
    else out._.push(argv[i]);
  }
  return out;
}

// The search API allows 30 requests a minute; spacing them is cheaper than being refused.
let lastSearch = 0;
function gh(argv, { search = false, json = true } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (search) {
      sleep(Math.max(0, lastSearch + 2100 - Date.now()));
      lastSearch = Date.now();
    }
    const r = spawnSync("gh", argv, { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status === 0) return json ? JSON.parse(r.stdout || "null") : r.stdout;
    const err = `${r.stderr ?? ""}${r.error?.message ?? ""}`.trim();
    if (attempt < 4 && /rate limit|secondary|abuse|HTTP 403|HTTP 429|HTTP 50[234]/i.test(err)) {
      sleep(15000 * (attempt + 1));
      continue;
    }
    throw new Error(`gh ${argv.slice(0, 2).join(" ")}: ${err.split("\n")[0] || `exit ${r.status}`}`);
  }
}

async function http(url, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
    if (res.ok) return res.json();
    if (attempt < 4 && (res.status === 429 || res.status >= 502)) {
      sleep((Number(res.headers.get("retry-after")) || 5 * (attempt + 1)) * 1000);
      continue;
    }
    throw new Error(`${url.split("?")[0]}: HTTP ${res.status}`);
  }
}

const jiraHeaders = () => (process.env.JIRA_API_TOKEN ? { Authorization: `Bearer ${process.env.JIRA_API_TOKEN}` } : {});
const jira = (path) => http(`${JIRA}${path}`, jiraHeaders());
const forumHeaders = () => (process.env.DISCOURSE_API_KEY && process.env.DISCOURSE_API_USERNAME
  ? { "Api-Key": process.env.DISCOURSE_API_KEY, "Api-Username": process.env.DISCOURSE_API_USERNAME } : {});
const forum = (path) => http(`${FORUM}${path}`, forumHeaders());

async function jiraSearch(jql, fields) {
  const issues = [];
  for (let startAt = 0; ;) {
    // validateQuery=warn: a `key in (...)` naming one unknown or restricted key would otherwise fail
    // the whole query.
    const page = await jira(`/rest/api/2/search?validateQuery=warn&maxResults=100&startAt=${startAt}`
      + `&fields=${fields}&jql=${encodeURIComponent(jql)}`);
    issues.push(...page.issues);
    startAt += page.issues.length;
    if (!page.issues.length || startAt >= page.total) return issues;
  }
}

// ---- configuration and identity --------------------------------------------------------------

function config() {
  return readJson(join(dir, "config.json"), {});
}

function orgs() {
  return ["xwiki", "xwiki-contrib", ...(process.env.XWIKI_LLM_ORGS ?? "").split(/[\s,]+/).filter(Boolean)];
}

// ---- GitHub ----------------------------------------------------------------------------------

const PR_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){
pullRequest(number:$number){number title url body isDraft createdAt mergeable reviewDecision
author{login __typename} repository{nameWithOwner}
latestReviews(first:30){nodes{state submittedAt body url author{login}}} participants(first:100){nodes{login}}
reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{author{login} body url}}}}
comments(last:8){nodes{author{login} createdAt body url}}
commits(last:1){nodes{commit{committedDate statusCheckRollup{state}}}}}}}`;

function fetchPr(url) {
  const [, owner, name, number] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  const call = () => gh(["api", "graphql", "-f", `query=${PR_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`,
    "-F", `number=${number}`]).data.repository.pullRequest;
  let pr = call();
  // GitHub computes mergeability lazily: the first read of a PR nobody looked at lately is UNKNOWN.
  if (pr.mergeable === "UNKNOWN") {
    sleep(3000);
    pr = call();
  }
  return pr;
}

// Who the developer can merge without a second reviewer: repos where they wrote nearly everything.
const soleCache = new Map();
function soleCommitter(repo, me) {
  if (!soleCache.has(repo)) {
    const since = new Date(Date.now() - 365 * DAY).toISOString();
    const authors = [];
    for (let page = 1; page <= 3; page++) {
      const logins = gh(["api", `repos/${repo}/commits?since=${since}&per_page=100&page=${page}`,
        "--jq", "[.[].author.login]"]);
      authors.push(...logins.filter((l) => !isBot(l)));
      if (logins.length < 100) break;
    }
    soleCache.set(repo, authors.length > 0 && authors.filter((l) => l === me).length / authors.length >= SOLE_COMMITTER_SHARE);
  }
  return soleCache.get(repo);
}

function classifyPr(item) {
  if (item.stale) return { cls: "stale", blockers: [] };
  const mine = item.group === "mine";
  const b = [];
  if (item.draft) b.push(item.approved ? "draft (approved: undraft it)" : "draft");
  if (item.conflict) b.push(mine ? "conflict: rebase" : "conflict: the author must rebase");
  if (item.ci === "FAILURE" || item.ci === "ERROR") b.push("CI red");
  if (item.ci === "PENDING" || item.ci === "EXPECTED") b.push("CI running");
  if (item.changesRequestedBy.length) b.push(`changes requested by ${item.changesRequestedBy.join(", ")}`);
  if (item.liveThreads.length) b.push(`${item.liveThreads.length} open review thread(s)`);
  if (item.waitingOnYou) b.push(`answer ${item.lastOther.by}`);
  if (item.waitingOn) b.push(`waiting on ${item.waitingOn.who.join(", ")} (asked ${item.waitingOn.at.slice(0, 10)})`);
  if (item.needsApproval && !item.approved) b.push(`needs an approval (${item.issueType})`);
  const hard = item.changesRequestedBy.length > 0 || item.liveThreads.length > 3 || (item.draft && !item.approved)
    || (item.conflict && /FAILURE|ERROR/.test(item.ci ?? "")) || Boolean(item.waitingOn);
  const cls = b.length === 0 ? "ready" : !hard && b.length <= 2 ? "close" : "not-close";
  return { cls, blockers: b };
}

// Words that make an @-mention a request rather than a thank-you.
const REQUEST = /\?|\b(review|look|approve|check|could you|can you|please|let me know)\b/i;

// Who the developer's own last message leaves the next step to: the author of a PR they reviewed with comments, and
// the participants they @-mention with a request. Only participants count, since an "@Something" in prose is as often
// a Java annotation or a javadoc tag as a login. A person stops being waited on once they comment or review after that
// message, or, for the author, push a commit after it.
function waitingOnOthers(me, author, participants, comments, reviews, lastCommitAt) {
  const last = [...comments.filter((c) => c.by === me).map((c) => ({ at: c.at, url: c.url, text: c.text })),
    ...reviews.filter((r) => r.author?.login === me && r.body?.trim())
      .map((r) => ({ at: r.submittedAt, url: r.url, text: r.body, review: r.state }))]
    .sort((x, y) => x.at.localeCompare(y.at)).at(-1);
  if (!last) return null;
  // Quoted lines are someone else's words, and code is not prose.
  const own = last.text.replace(/```[\s\S]*?(```|$)/g, "").replace(/`[^`\n]*`/g, "")
    .split("\n").filter((l) => !l.trimStart().startsWith(">")).join("\n");
  const known = new Map(participants.map((l) => [l.toLowerCase(), l]));
  const who = new Set(REQUEST.test(own)
    ? [...own.matchAll(/(?<![\w@])@([A-Za-z0-9-]+)/g)].map((m) => known.get(m[1].toLowerCase()))
      .filter((l) => l && l !== me && !isBot(l)) : []);
  if (author !== me && /COMMENTED|CHANGES_REQUESTED/.test(last.review ?? "")) who.add(author);
  const answered = (login) => [...comments.filter((c) => c.by === login).map((c) => c.at),
    ...reviews.filter((r) => r.author?.login === login).map((r) => r.submittedAt),
    login === author ? lastCommitAt : null].some((at) => at && at > last.at);
  const left = [...who].filter((l) => !answered(l));
  return left.length ? { who: left, at: last.at, url: last.url } : null;
}

function collectGithub(me) {
  const owners = orgs().flatMap((o) => ["--owner", o]);
  const byUrl = new Map();
  for (const [role, flag] of [["author", "--author"], ["review", "--review-requested"], ["assignee", "--assignee"]]) {
    const found = gh(["search", "prs", flag, me, ...owners, "--state", "open", "--limit", "300",
      "--json", "url"], { search: true });
    for (const { url } of found) {
      if (!byUrl.has(url)) byUrl.set(url, new Set());
      byUrl.get(url).add(role);
    }
  }
  const prs = [...byUrl].map(([url, roles]) => ({ pr: fetchPr(url), roles }));
  // Issue types decide whether a PR needs an approval: one query for every key the titles carry.
  const keys = [...new Set(prs.flatMap(({ pr }) => pr.title.match(keyPattern) ?? []))];
  return { prs, keys, me };
}

async function buildGithubItems({ prs, keys, me }) {
  const types = new Map();
  for (let i = 0; i < keys.length; i += 50) {
    for (const issue of await jiraSearch(`key in (${keys.slice(i, i + 50).join(",")})`, "issuetype")) {
      types.set(issue.key, issue.fields.issuetype.name);
    }
  }
  return prs.map(({ pr, roles }) => {
    const repo = pr.repository.nameWithOwner;
    const author = pr.author?.login ?? "ghost";
    // A GitHub App's login comes without its "[bot]" suffix here, so ask for the type instead.
    const app = pr.author?.__typename === "Bot";
    const group = roles.has("author") ? "mine" : roles.has("review") ? "review"
      : app || isBot(author) ? "routine" : "assigned";
    const comments = pr.comments.nodes.map((c) => ({ by: c.author?.login, at: c.createdAt, url: c.url, text: c.body.slice(0, 1500) }))
      .filter((c) => !isBot(c.by));
    const reviews = pr.latestReviews.nodes;
    const myLast = latest(...comments.filter((c) => c.by === me).map((c) => c.at),
      ...reviews.filter((r) => r.author?.login === me).map((r) => r.submittedAt), author === me ? pr.createdAt : null);
    const lastOther = comments.filter((c) => c.by !== me).at(-1) ?? null;
    const lastCommit = pr.commits.nodes[0]?.commit;
    const issueKeys = pr.title.match(keyPattern) ?? [];
    const issueType = issueKeys.map((k) => types.get(k)).find(Boolean) ?? null;
    const item = {
      id: `gh:${repo}#${pr.number}`, kind: "pr", group, repo, number: pr.number, url: pr.url,
      title: pr.title, author, authorQuery: app ? `app/${author.replace(/\[bot\]$/, "")}` : author,
      created: pr.createdAt, draft: pr.isDraft,
      lastActivity: latest(pr.createdAt, lastCommit?.committedDate, comments.at(-1)?.at),
      conflict: pr.mergeable === "CONFLICTING", ci: lastCommit?.statusCheckRollup?.state ?? "NONE",
      approved: reviews.some((r) => r.state === "APPROVED") && !reviews.some((r) => r.state === "CHANGES_REQUESTED"),
      changesRequestedBy: reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.author?.login),
      liveThreads: pr.reviewThreads.nodes.filter((t) => !t.isResolved && !t.isOutdated)
        .map((t) => ({ by: t.comments.nodes[0]?.author?.login, url: t.comments.nodes[0]?.url, text: t.comments.nodes[0]?.body.slice(0, 800) })),
      outdatedThreads: pr.reviewThreads.nodes.filter((t) => !t.isResolved && t.isOutdated).length,
      lastOther, waitingOnYou: Boolean(lastOther && (!myLast || lastOther.at > myLast)),
      waitingOn: waitingOnOthers(me, author, pr.participants.nodes.map((p) => p.login), comments, reviews,
        lastCommit?.committedDate),
      issueKeys, issueType,
      dependsOn: [...(pr.body ?? "").matchAll(/depends on (?:#|https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/)(\d+)/gi)]
        .map((m) => `gh:${repo}#${m[1]}`),
    };
    item.stale = days(item.lastActivity) > STALE_DAYS;
    if (group === "mine" && !item.stale && /New Feature|Improvement/.test(issueType ?? "")) {
      item.needsApproval = !soleCommitter(repo, me);
      if (!item.needsApproval) item.note = "no reviewer available: merging unreviewed";
    }
    Object.assign(item, classifyPr(item));
    item.questions = [];
    if (item.waitingOnYou && !item.stale) {
      item.questions.push({ ask: `Does ${lastOther.by}'s last comment ask something of ${me}, ask for the PR to be closed`
        + " instead of merged, or only acknowledge? Answer with the action it calls for.", evidence: lastOther });
    }
    if (item.liveThreads.length && !item.stale) {
      item.questions.push({ ask: "For each open review thread: is it already addressed (a later commit or reply), or what"
        + " exactly is still to do?", evidence: item.liveThreads });
    }
    return item;
  });
}

// ---- JIRA ------------------------------------------------------------------------------------

const branchCache = new Map();
function stableBranches(repo) {
  if (!branchCache.has(repo)) {
    // With --paginate, --jq runs once per page: ask for lines, not one JSON document per page.
    const names = gh(["api", `repos/${repo}/branches?per_page=100`, "--paginate", "--jq", ".[].name"], { json: false })
      .split("\n").filter((n) => /^stable-\d/.test(n));
    const version = (n) => n.match(/\d+/g).map(Number);
    names.sort((a, b) => {
      const [x, y] = [version(a), version(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
      return 0;
    });
    // The maintained lines are the newest few; older ones receive no backports.
    branchCache.set(repo, names.slice(0, 3));
  }
  return branchCache.get(repo);
}

const subjectsCache = new Map();
function branchSubjects(repo, branch, since) {
  const key = `${repo}@${branch}@${since}`;
  if (!subjectsCache.has(key)) {
    subjectsCache.set(key, gh(["api", `repos/${repo}/commits?sha=${branch}&since=${since}&per_page=100`, "--paginate",
      "--jq", ".[].commit.message | split(\"\\n\")[0]"], { json: false }).split("\n"));
  }
  return subjectsCache.get(key);
}

const pomCache = new Map();
function pomVersion(repo, branch) {
  const key = `${repo}@${branch}`;
  if (!pomCache.has(key)) {
    let version = null;
    try {
      const pom = gh(["api", `repos/${repo}/contents/pom.xml?ref=${branch}`, "-H", "Accept: application/vnd.github.raw"],
        { json: false });
      version = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").match(/<version>([^<]+)<\/version>/)?.[1] ?? null;
    } catch {
      // A repo without a root pom (infra, docker) simply has no version to propose.
    }
    pomCache.set(key, version);
  }
  return pomCache.get(key);
}

async function collectJira(me) {
  const jql = process.env.JIRA_API_TOKEN ? "assignee = currentUser() AND resolution = Unresolved"
    : `assignee = "${me}" AND resolution = Unresolved`;
  const issues = await jiraSearch(jql, "summary,status,issuetype,created,updated,project");
  const owners = orgs().flatMap((o) => ["--owner", o]);
  const items = [];
  for (const issue of issues) {
    const f = issue.fields;
    const item = {
      id: `jira:${issue.key}`, kind: "issue", group: "jira", key: issue.key, url: `${JIRA}/browse/${issue.key}`,
      title: `${issue.key}: ${f.summary}`, type: f.issuetype.name, status: f.status.name, project: f.project.key,
      created: f.created, lastActivity: f.updated, stale: days(f.updated) > STALE_DAYS, commits: [], openPrs: [],
      questions: [],
    };
    items.push(item);
    if (item.stale) {
      item.cls = "stale";
      continue;
    }
    const keyRe = new RegExp(`\\b${issue.key}\\b`);
    // Private security forks (`-ghsa-`) mirror the real commits; counting them would double them.
    item.commits = gh(["search", "commits", issue.key, ...owners, "--limit", "100", "--json", "sha,repository,commit,url"],
      { search: true })
      .filter((c) => keyRe.test(c.commit.message) && !c.repository.fullName.includes("-ghsa-"))
      .map((c) => ({ repo: c.repository.fullName, sha: c.sha, url: c.url, date: c.commit.committer.date }));
    item.openPrs = gh(["search", "prs", issue.key, ...owners, "--state", "open", "--json", "url,title,repository,number"],
      { search: true })
      .filter((p) => keyRe.test(p.title)).map((p) => `gh:${p.repository.nameWithOwner}#${p.number}`);
    if (item.openPrs.length) {
      item.cls = "close";
      item.blockers = ["close once its pull request(s) are merged"];
      continue;
    }
    if (!item.commits.length) {
      item.cls = "not-close";
      item.blockers = ["no code yet"];
      continue;
    }
    // A reopen after the last commit means the developer decided the work is not finished.
    const lastCommit = latest(...item.commits.map((c) => c.date));
    const full = await jira(`/rest/api/2/issue/${issue.key}?expand=changelog&fields=comment`);
    const reopened = full.changelog.histories
      .filter((h) => h.items.some((i) => i.field === "status" && i.toString === "Reopened")).map((h) => h.created).sort().at(-1);
    if (reopened && Date.parse(reopened) > Date.parse(lastCommit)) {
      item.cls = "not-close";
      item.blockers = [`reopened on ${reopened.slice(0, 10)}, after the last commit`];
      item.reopenReason = full.fields.comment.comments.filter((c) => c.created >= reopened.slice(0, 10))
        .map((c) => c.body.slice(0, 600))[0] ?? null;
      continue;
    }
    item.cls = "ready";
    item.blockers = [];
    item.branches = [];
    for (const repo of [...new Set(item.commits.map((c) => c.repo))]) {
      const defaultBranch = gh(["api", `repos/${repo}`, "--jq", ".default_branch"], { json: false }).trim();
      item.branches.push({ repo, branch: defaultBranch, pomVersion: pomVersion(repo, defaultBranch) });
      const since = item.commits.map((c) => c.date).sort()[0];
      for (const branch of stableBranches(repo)) {
        if (branchSubjects(repo, branch, since).some((s) => keyRe.test(s))) {
          item.branches.push({ repo, branch, pomVersion: pomVersion(repo, branch) });
        }
      }
    }
    item.unreleasedVersions = (await jira(`/rest/api/2/project/${item.project}/versions`))
      .filter((v) => !v.released && !v.archived).map((v) => v.name).slice(-12);
    item.questions.push({ ask: "Fix Versions: map each branch's pom version to the matching unreleased JIRA version;"
      + " if a supported branch the bug affects is missing, this is a backport to do (close, not ready).",
    evidence: { branches: item.branches, unreleasedVersions: item.unreleasedVersions } });
  }
  return items;
}

// ---- Forum -----------------------------------------------------------------------------------

const stripHtml = (html) => html.replace(/<aside[\s\S]*?<\/aside>/g, " [quote] ").replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();

async function collectForum(me) {
  const site = await forum("/site.json");
  const news = new Set(site.categories.filter((c) => /news/i.test(c.name) || /news/i.test(c.slug)).map((c) => c.id));
  const topics = [];
  for (let page = 0; ; page++) {
    const list = (await forum(`/topics/created-by/${encodeURIComponent(me)}.json?page=${page}`)).topic_list;
    topics.push(...list.topics);
    if (!list.topics.length || !list.more_topics_url) break;
  }
  const items = [];
  // Each category's "About the … category" description topic is the category's, not a discussion.
  // Only each category's own page names it, at the end of its `topic_url`; ask each category once.
  const about = new Set();
  for (const id of new Set(topics.map((x) => x.category_id))) {
    const url = await forum(`/c/${id}/show.json`).then((c) => c.category.topic_url, () => null);
    about.add(Number(url?.match(/\/(\d+)$/)?.[1]));
  }
  for (const t of topics.filter((x) => !x.has_accepted_answer && !x.closed && !x.archived && !news.has(x.category_id)
    && !about.has(x.id))) {
    const item = {
      id: `forum:${t.id}`, kind: "topic", group: "forum", url: `${FORUM}/t/${t.id}`, title: t.title,
      category: site.categories.find((c) => c.id === t.category_id)?.name ?? String(t.category_id),
      created: t.created_at, lastActivity: t.last_posted_at, stale: days(t.last_posted_at) > STALE_DAYS, questions: [],
    };
    items.push(item);
    if (item.stale) {
      item.cls = "stale";
      continue;
    }
    const topic = await forum(`/t/${t.id}.json`);
    let posts = topic.post_stream.posts;
    const missing = topic.post_stream.stream.filter((id) => !posts.some((p) => p.id === id));
    for (let i = 0; i < missing.length; i += 20) {
      const query = missing.slice(i, i + 20).map((id) => `post_ids[]=${id}`).join("&");
      posts = posts.concat((await forum(`/t/${t.id}/posts.json?${query}`)).post_stream.posts);
    }
    posts.sort((a, b) => a.post_number - b.post_number);
    // Links are read from the HTML before it is stripped, or the PR and issue references are lost.
    item.links = [...new Set(posts.flatMap((p) => [
      ...[...p.cooked.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)].map((m) => `gh:${m[1]}#${m[2]}`),
      ...(stripHtml(p.cooked).match(keyPattern) ?? []).map((k) => `jira:${k}`),
      ...[...p.cooked.matchAll(/jira\.xwiki\.org\/browse\/([A-Z][A-Z0-9]+-\d+)/g)].map((m) => `jira:${m[1]}`),
    ]))];
    item.posts = posts.map((p) => ({ n: p.post_number, by: p.username, at: p.created_at, replyTo: p.reply_to_user?.username,
      text: stripHtml(p.cooked).slice(0, p.post_number === 1 ? 5000 : 2000) }));
    const myLast = item.posts.filter((p) => p.by === me).at(-1)?.at;
    const addressed = item.posts.filter((p) => p.by !== me && p.at > (myLast ?? "")
      && (p.replyTo === me || new RegExp(`@${me}\\b`, "i").test(p.text)));
    item.waitingOnYou = addressed.length > 0;
    item.daysIdle = days(t.last_posted_at);
    // Vote hints only: a vote said in words ("yes", "lgtm") is the judge's to count.
    const votes = {};
    for (const p of item.posts.slice(1)) {
      const m = p.text.replace(/\[quote\]/g, "").match(/(?:^|[\s(])([+-][01])(?=$|[\s,.!):])/);
      if (m) votes[p.by] = m[1];
    }
    item.votes = votes;
    item.cls = null;
    item.questions.push({
      ask: `Classify this topic ${me} started (today is ${today}). READY: a post states the conclusion (vote result or`
        + " consensus summary) and any follow-up it promised is done; give that post number. CLOSE-a: the vote window"
        + " (~72h) has passed or the discussion is quiet with no open disagreement, but no conclusion post exists; draft one."
        + " CLOSE-b: a conclusion exists but promised follow-up is visibly not done; name it. CLOSE-c: a question or point"
        + ` addressed to ${me} is unanswered and blocks concluding; quote it. NOT-CLOSE: open disagreement, a vote still`
        + " running, or not a topic that concludes.",
      evidence: "posts (see `show`)",
    });
  }
  return items;
}

// ---- collect ---------------------------------------------------------------------------------

async function collect(opts) {
  mkdirSync(runsDir, { recursive: true });
  const cfg = config();
  const only = opts.only ? new Set(String(opts.only).split(",")) : null;
  const run = { date: today, partial: Boolean(only), identities: {}, skipped: {}, errors: {}, items: [] };
  // Per category: who the developer is there (null skips it, with the reason), and how to collect.
  const categories = {
    gh: [() => cfg.github ?? gh(["api", "user", "--jq", ".login"], { json: false }).trim(), null,
      async (me) => buildGithubItems(collectGithub(me))],
    jira: [async () => (process.env.JIRA_API_TOKEN ? (await jira("/rest/api/2/myself")).name : cfg.jira),
      "no JIRA_API_TOKEN and no `jira` username in config", collectJira],
    forum: [() => cfg.forum ?? process.env.DISCOURSE_API_USERNAME,
      "no forum username: run `config forum=<username>`", collectForum],
  };
  for (const [name, [identify, whySkipped, gather]] of Object.entries(categories)) {
    if (only && !only.has(name)) continue;
    try {
      const me = await identify();
      if (!me) {
        run.skipped[name] = whySkipped;
        continue;
      }
      run.identities[name] = me;
      run.items.push(...await gather(me));
    } catch (e) {
      run.errors[name] = e.message;
    }
  }
  run.forumWrite = Boolean(forumHeaders()["Api-Key"]);
  const file = runFile(opts);
  writeJson(file, run);
  const pending = run.items.filter(needsJudgement).length;
  console.log(`run: ${file}`);
  console.log(`items: ${run.items.length}, waiting for a judgement: ${pending}`);
  for (const [c, why] of Object.entries(run.skipped)) console.log(`skipped ${c}: ${why}`);
  for (const [c, why] of Object.entries(run.errors)) console.log(`ERROR ${c}: ${why}`);
  if (run.identities.forum && !run.forumWrite) console.log("forum: read-only (no DISCOURSE_API_KEY): drafts only");
}

// A narrowed run gets its own file, so it never replaces the day's full run.
const runFile = (opts) => opts.run ?? join(runsDir, opts.only ? `${today}.${String(opts.only).replace(/,/g, "-")}.json`
  : `${today}.json`);

const needsJudgement = (item) => item.cls !== "stale" && item.questions?.length > 0;

function loadRun(opts) {
  const file = runFile(opts);
  if (!existsSync(file)) throw new Error(`no run file ${file}: run \`collect\` first`);
  const answersFile = file.replace(/\.json$/, ".answers.json");
  return { run: readJson(file), answers: readJson(answersFile, {}), answersFile };
}

// ---- pending / show --------------------------------------------------------------------------

function pending(opts) {
  const { run, answers, answersFile } = loadRun(opts);
  const left = run.items.filter((i) => needsJudgement(i) && !answers[i.id]);
  console.log(`answers file: ${answersFile}`);
  console.log(`${left.length} item(s) waiting for a judgement:`);
  for (const i of left) console.log(`${i.id}\t${i.cls ?? "unjudged"}\t${i.title.slice(0, 80)}`);
}

function show(opts) {
  const { run } = loadRun(opts);
  const item = run.items.find((i) => i.id === opts._[1]);
  if (!item) throw new Error(`no item ${opts._[1]} in the run`);
  console.log(JSON.stringify(item, null, 1));
}

// ---- rank ------------------------------------------------------------------------------------

const SEVERITY = { ready: 0, close: 1, "not-close": 2, stale: 3 };

function units(items) {
  const parent = new Map(items.map((i) => [i.id, i.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const join2 = (a, b) => parent.has(a) && parent.has(b) && parent.set(find(a), find(b));
  const live = (id) => items.find((i) => i.id === id && i.cls !== "stale");
  for (const i of items.filter((x) => x.cls !== "stale")) {
    for (const k of i.issueKeys ?? []) if (live(`jira:${k}`)) join2(i.id, `jira:${k}`);
    for (const d of i.dependsOn ?? []) if (live(d)) join2(i.id, d);
    for (const p of i.openPrs ?? []) if (live(p)) join2(i.id, p);
    for (const l of i.links ?? []) if (live(l)) join2(i.id, l);
  }
  const groups = new Map();
  for (const i of items) {
    const root = find(i.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return [...groups.values()].map((members) => {
    // Steps in the order they are done: conclude the thread, merge the PRs (dependencies first),
    // then close the issues the merges finish.
    const prs = members.filter((m) => m.kind === "pr");
    const ordered = [];
    const visit = (p) => {
      if (ordered.includes(p)) return;
      for (const d of p.dependsOn ?? []) {
        const dep = prs.find((x) => x.id === d);
        if (dep) visit(dep);
      }
      ordered.push(p);
    };
    prs.sort((a, b) => a.created.localeCompare(b.created)).forEach(visit);
    const steps = [...members.filter((m) => m.kind === "topic"), ...ordered,
      ...members.filter((m) => m.kind === "issue").sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }))];
    // An issue held only by a PR of the same unit follows that PR rather than blocking the unit.
    const follows = (m) => m.kind === "issue" && m.openPrs?.length && m.openPrs.every((p) => members.some((x) => x.id === p));
    const acting = steps.filter((m) => !follows(m));
    const lead = acting[0] ?? steps[0];
    const worst = Math.max(...acting.map((m) => SEVERITY[m.cls] ?? 2));
    const cls = lead.cls === "ready" && worst > 0 ? "close" : lead.cls;
    return {
      steps, cls, title: lead.title, waitingOnYou: steps.some((m) => m.waitingOnYou && m.cls !== "stale"),
      age: Math.max(...steps.map((m) => days(m.created))), routine: steps.every((m) => m.group === "routine"),
      // Whose work it is follows the first step: another person's PR to review is theirs, even when
      // merging it closes one of your issues.
      theirs: lead.kind === "pr" && lead.group !== "mine",
    };
  });
}

function categoryOf(item) {
  return item.kind === "pr" ? `gh-${item.group}` : item.kind === "issue" ? "jira" : "forum";
}

function stats(items) {
  const out = {};
  for (const i of items) {
    const c = categoryOf(i);
    out[c] ??= { open: 0, ready: 0, close: 0, "not-close": 0, stale: 0, unjudged: 0, ages: [] };
    out[c].open++;
    out[c][i.cls ?? "unjudged"]++;
    out[c].ages.push(days(i.created));
  }
  for (const s of Object.values(out)) {
    s.oldest = Math.max(...s.ages);
    s.median = median(s.ages);
    delete s.ages;
  }
  return out;
}

const SPARK = "▁▂▃▄▅▆▇█";
function sparkline(values) {
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  return values.map((v) => SPARK[hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * 7)]).join("");
}

function describeStep(m) {
  const what = m.action ?? (m.kind === "pr" ? (m.cls === "ready" ? (m.group === "mine" ? "merge" : "review and merge")
    : (m.blockers ?? []).join("; "))
    : m.kind === "issue" ? (m.cls === "ready" ? `close (on ${m.branches.map((b) => b.branch).join(", ")})`
      : (m.blockers ?? []).join("; "))
      : m.cls);
  const label = m.kind === "pr" ? `${m.repo.split("/")[1]}#${m.number}` : m.kind === "issue" ? m.key : `forum ${m.id.slice(6)}`;
  const extra = [m.note, m.outdatedThreads ? `${m.outdatedThreads} outdated thread(s) to resolve` : null].filter(Boolean);
  return `[${label}](${m.solutionUrl ?? m.url}): ${what}${extra.length ? ` (${extra.join("; ")})` : ""}`;
}

function rank(opts) {
  const { run, answers } = loadRun(opts);
  const cfg = config();
  // The developer's answers override the rules: a judge reading "this one can now be closed" turns
  // a merge into a close.
  for (const item of run.items) {
    const a = answers[item.id];
    if (!a) continue;
    if (a.cls) item.cls = a.cls;
    if (a.action) item.action = a.action;
    if (a.note) item.note = a.note;
    if (a.solutionPost) item.solutionUrl = `${item.url}/${a.solutionPost}`;
    // A comment that only acknowledges, or a PR its author parked, is nobody waiting on you.
    if (a.waiting === false) item.waitingOnYou = false;
  }
  const all = units(run.items);
  const tier = (u) => (u.waitingOnYou ? 0 : u.cls === "ready" ? 1 : 2);
  // Waiting decides the order, never eligibility: someone waiting on a thread the judge found
  // nothing to do in is not today's work.
  const offered = all.filter((u) => !u.routine && (u.cls === "ready" || u.cls === "close"))
    .sort((a, b) => tier(a) - tier(b) || b.age - a.age);
  // Two buckets, each with its own budget, so other people's old PRs never crowd out your own
  // finished work, nor the reverse.
  const cap = (n) => (run.partial ? Infinity : Number(n));
  const buckets = [
    { title: "Your work", units: offered.filter((u) => !u.theirs),
      budget: cap(opts.budget ?? cfg.budget ?? DEFAULT_BUDGET) },
    { title: "Others' work waiting on you", units: offered.filter((u) => u.theirs),
      budget: cap(opts["others-budget"] ?? cfg.othersBudget ?? DEFAULT_OTHERS_BUDGET) },
  ];
  const routine = run.items.filter((i) => i.group === "routine" && i.cls === "ready");

  const s = stats(run.items);
  const historyFile = join(dir, "history.jsonl");
  const history = existsSync(historyFile) ? readFileSync(historyFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const previous = history.filter((h) => h.date < today).at(-1);
  if (!run.partial && !Object.keys(run.errors).length) {
    const kept = history.filter((h) => h.date !== today);
    kept.push({ date: today, stats: s });
    writeFileSync(historyFile, `${kept.map((h) => JSON.stringify(h)).join("\n")}\n`);
    history.splice(0, history.length, ...kept);
  }
  const actions = existsSync(join(dir, "actions.jsonl"))
    ? readFileSync(join(dir, "actions.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];

  const out = [];
  const me = Object.values(run.identities)[0] ?? "";
  out.push(`# Daily close: ${today} (${me})`, "");
  for (const [c, why] of Object.entries(run.skipped)) out.push(`- skipped **${c}**: ${why}`);
  for (const [c, why] of Object.entries(run.errors)) out.push(`- **ERROR ${c}**: ${why} (this category is missing, not empty)`);
  out.push("", "| Category | Open | Ready | Close | Not close | Stale | Unjudged | Oldest | Median | vs last run |",
    "|---|---|---|---|---|---|---|---|---|---|");
  for (const [c, v] of Object.entries(s).sort()) {
    const prev = previous?.stats?.[c]?.open;
    const delta = prev === undefined ? "—" : `${v.open - prev >= 0 ? "+" : ""}${v.open - prev}`;
    out.push(`| ${c} | ${v.open} | ${v.ready} | ${v.close} | ${v["not-close"]} | ${v.stale} | ${v.unjudged} | ${v.oldest}d | ${v.median}d | ${delta} |`);
  }
  const month = history.filter((h) => days(h.date) <= 30);
  if (month.length > 1) {
    out.push("", "30-day trend (open items): " + Object.keys(s).sort()
      .map((c) => `${c} ${sparkline(month.map((h) => h.stats[c]?.open ?? 0))}`).join(" · "));
  }
  const week = actions.filter((a) => days(a.date) <= 7).length;
  out.push("", `Closed through this skill in the last 7 days: ${week}`, "");
  for (const bucket of buckets) {
    const shown = bucket.units.slice(0, bucket.budget);
    out.push(`## ${bucket.title}: ${shown.length}${bucket.units.length > shown.length ? ` of ${bucket.units.length}` : ""}`, "");
    shown.forEach((u, n) => {
      const tag = u.waitingOnYou ? "**waiting on you** · " : u.cls === "ready" ? "ready · " : "close · ";
      out.push(`${n + 1}. ${tag}${u.title} (${u.age}d)`);
      for (const m of u.steps) out.push(`   - ${describeStep(m)}`);
    });
    out.push("");
  }
  if (routine.length) {
    const authors = [...new Set(routine.map((r) => `author:${r.authorQuery}`))];
    const q = `is:pr is:open assignee:${run.identities.gh} ${authors.join(" ")}`;
    out.push("", `## Routine PRs (outside the budget)`, "",
      `${routine.length} green, mergeable PR(s) by bots assigned to you: review and merge them in bulk.`
      + ` [Open the list](https://github.com/pulls?q=${encodeURIComponent(q)})`);
  }
  const unjudged = run.items.filter((i) => i.cls === null && !answers[i.id]);
  if (unjudged.length) out.push("", `${unjudged.length} item(s) still unjudged: run \`pending\`.`);
  const report = out.join("\n");
  writeFileSync(runFile(opts).replace(/\.json$/, ".md"), `${report}\n`);
  console.log(report);
}

// ---- accept ----------------------------------------------------------------------------------

// The one write the script does, because the forum MCP has no "accept solution" tool and a curl
// command line would put the API key in the process list. Run only after the developer said yes.
async function accept(opts) {
  const [, topic, number] = opts._;
  if (!topic || !number) throw new Error("usage: accept <topicId> <postNumber>");
  if (!forumHeaders()["Api-Key"]) throw new Error("no DISCOURSE_API_KEY/DISCOURSE_API_USERNAME: mark it by hand");
  const post = await forum(`/posts/by_number/${topic}/${number}.json`);
  const res = await fetch(`${FORUM}/solution/accept.json`, {
    method: "POST", headers: { ...forumHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
    body: `id=${post.id}`,
  });
  if (!res.ok) throw new Error(`accepting ${FORUM}/t/${topic}/${number}: HTTP ${res.status}`);
  console.log(`accepted ${FORUM}/t/${topic}/${number} as the solution`);
}

// ---- done / config ---------------------------------------------------------------------------

function done(opts) {
  const [, id, ...action] = opts._;
  if (!id || !action.length) throw new Error("usage: done <itemId> <action>");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "actions.jsonl"), `${JSON.stringify({ date: new Date().toISOString(), id, action: action.join(" ") })}\n`);
}

function setConfig(opts) {
  mkdirSync(dir, { recursive: true });
  const cfg = config();
  for (const pair of opts._.slice(1)) {
    const [k, v] = pair.split("=");
    if (!["github", "jira", "forum", "budget", "othersBudget"].includes(k)) throw new Error(`unknown config key ${k}`);
    cfg[k] = /budget/i.test(k) ? Number(v) : v;
  }
  writeJson(join(dir, "config.json"), cfg);
  console.log(JSON.stringify(cfg));
}

const opts = args(process.argv.slice(2));
const commands = { collect, pending, show, rank, accept, done, config: setConfig };
const command = commands[opts._[0] ?? "collect"];
if (!command) {
  console.error(`unknown command ${opts._[0]}; one of ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
try {
  await command(opts);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
