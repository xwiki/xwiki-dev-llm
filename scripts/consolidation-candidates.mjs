#!/usr/bin/env node
// Candidate finder for the weekly consolidation routine (scripts/consolidation-routine.md). It
// narrows, it does not judge: each list below is ranked text the routine reads before deciding what,
// if anything, to change. validate.mjs fails on the clear cases; this reports what sits just below
// them, where only a reader can tell a restated rule from two different ones.
//
//   near-duplicates   blocks sharing 25-50% of their 8-word shingles across files (50% fails invariant 11)
//   budget-pressure   files at 95% of their size budget or more (invariants 5, 8, 12)
//   similar-skills    skill descriptions with a high word overlap, so the model may pick the wrong one
//   one-way-pointers  a description routing to a sibling that names it nowhere in return
//   okf-restated      OKF topics whose text reappears in skills, grouped by topic
//   orphans           OKF topics no skill cites, references/ files their skill never names
//   split             skills and OKF topics that are large, growing, or cover several readers or topics
//
// Usage: node scripts/consolidation-candidates.mjs [--json] [--limit N] [--exclude path,path,...]
//        node scripts/consolidation-candidates.mjs --lossless [base-ref]   (default origin/master)
// --exclude drops every candidate touching a listed file (the files an open pull request changes).
// Node built-ins only; reads tracked files and local git history, no network.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  COPY_RATIO, DEFAULT_MAX_BYTES, OKF_ENTRY_MAX_BYTES, OKF_INDEX_MAX_BYTES, ORG_MAP_MAX_BYTES, ORG_MAX_BYTES, SKILL_MAX_BYTES,
  budgetOf, inDupScope, indexBlocks, isBudgeted, okfIndexEntries, orgMapBlock, sharedWithOtherFiles,
  EXTERNAL_SKILLS, shingles, skillPointers, words,
} from "./md-blocks.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const LIMIT = Number(opt("--limit") ?? 8);
const EXCLUDE = new Set((opt("--exclude") ?? "").split(",").filter(Boolean));
const NEAR_DUP_MIN = 0.25;
const PRESSURE_MIN = 0.95;
const GROWTH_WINDOW = "4 weeks ago";

const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const bytes = (s) => Buffer.byteLength(s);
const git = (...a) => execFileSync("git", a, { cwd: repoRoot, encoding: "utf8", maxBuffer: 1 << 26 });
const tracked = git("ls-files", "-z", "--", "*.md").split("\0").filter((p) => p && existsSync(join(repoRoot, p)));
const skills = [...new Set(tracked.map((p) => p.match(/^xwiki\/skills\/([^/]+)\/SKILL\.md$/)?.[1]).filter(Boolean))].sort();
const okfTopics = tracked.filter(
  (p) => /^xwiki\/okf\/.+\.md$/.test(p) && !/\/(index|_template)\.md$/.test(p) && !/\/decisions\//.test(p)
);
const skillDocs = (s) => tracked.filter((p) => p.startsWith(`xwiki/skills/${s}/`) && !/\/tools\//.test(p));
const kept = (...paths) => paths.every((p) => !EXCLUDE.has(p));
const snippet = (t, n = 110) => t.replace(/\s+/g, " ").slice(0, n);
const pct = (x) => Math.round(100 * x);
const top = (list) => list.sort((a, b) => b.score - a.score).slice(0, LIMIT);

// Content words: what two passages share when they are about the same thing.
const STOP = new Set(
  ("the a an and or of to in on for with from by as at is are be it its this that these those not no use " +
    "used when what which who whose than then there their them they into only also each every any one two " +
    "never always does do done can may must should will would has have had but if so such per via over under " +
    "instead skill skills xwiki run runs using about other more most same here where while").split(" ")
);
const contentWords = (t) => words(t.replace(/xwiki-[a-z0-9-]+/g, " ")).filter((w) => w.length > 3 && !STOP.has(w));
const jaccard = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
};
const sections = (md) => {
  const heads = [...md.matchAll(/^## (.+)$/gm)];
  return heads.map((h, i) => ({ title: h[1].trim(), text: md.slice(h.index, heads[i + 1]?.index ?? md.length) }));
};
const description = (md) => {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const m = fm.match(/^description:[ \t]*(.*(?:\n[ \t]+.*)*)/m);
  return (m?.[1] ?? "").replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
};

// ---- --lossless: is every removed sentence still stated somewhere? ---------------------------
// Every sentence a change removes from a Markdown file (base ref -> working tree) is looked up, by its
// 5-word shingles, in every text file of the working tree, new files included (a script's comments can
// be a fact's home). A sentence below 60% is printed: it was dropped or reworded, and the change must
// say where its fact lives now.
if (args.includes("--lossless")) {
  const base = opt("--lossless")?.startsWith("--") === false ? opt("--lossless") : "origin/master";
  const all = git("ls-files", "-z", "-co", "--exclude-standard", "--", "*.md", "*.mjs", "*.js", "*.sh", "*.json", "*.jsonc", "*.yml").split("\0")
    .filter((p) => p && existsSync(join(repoRoot, p)));
  const corpus = new Set();
  for (const p of all) for (const s of shingles(words(read(p)), 5)) corpus.add(s);
  const removed = new Map(); // file -> removed text
  let file = null;
  for (const line of git("diff", "-U0", base, "--", "*.md").split("\n")) {
    if (line.startsWith("--- ")) file = line.slice(6);
    else if (line.startsWith("-") && file) removed.set(file, (removed.get(file) ?? "") + line.slice(1) + "\n");
  }
  let lost = 0;
  for (const [f, text] of removed) {
    const sentences = text.replace(/^---$[\s\S]*?^---$/m, "").split(/(?<=[.!?])\s+|\n\s*(?:[-*]|\d+\.)\s+|\n\s*\n/);
    for (const sentence of sentences) {
      const sh = shingles(words(sentence), 5);
      if (sh.size < 3) continue;
      const covered = [...sh].filter((s) => corpus.has(s)).length / sh.size;
      if (covered < 0.6) {
        lost++;
        console.log(`- ${f} (${pct(covered)}% still stated): ${snippet(sentence, 220)}`);
      }
    }
  }
  console.log(lost ? `\n${lost} removed sentence(s) not found elsewhere: show where each fact lives now, or restore it.`
    : `Lossless: every sentence removed since ${base} is still stated in the working tree.`);
  process.exit(0);
}

// ---- near-duplicates ---------------------------------------------------------------------------
const dupIndex = indexBlocks(tracked.filter(inDupScope), read);
const nearDup = [];
const seen = new Set();
dupIndex.blocks.forEach((block, i) => {
  for (const [j, count] of sharedWithOtherFiles(dupIndex, i)) {
    const other = dupIndex.blocks[j];
    const ratio = Math.max(count / block.shingles.size, count / other.shingles.size);
    const pair = `${Math.min(i, j)}-${Math.max(i, j)}`;
    if (ratio < NEAR_DUP_MIN || ratio >= COPY_RATIO || count < 4 || seen.has(pair)) continue;
    seen.add(pair);
    if (!kept(block.path, other.path)) continue;
    nearDup.push({ score: ratio, files: [block.path, other.path], shared: `${pct(ratio)}%`,
      a: snippet(block.text), b: snippet(other.text) });
  }
});

// ---- budget-pressure ---------------------------------------------------------------------------
const budgets = JSON.parse(read("scripts/size-budgets.json"));
const pressure = [];
const press = (file, what, size, max) => {
  if (size / max >= PRESSURE_MIN && kept(file)) pressure.push({ score: size / max, files: [file], what, size, max });
};
for (const p of tracked.filter(isBudgeted)) press(p, "file", bytes(read(p)), budgetOf(p, budgets));
const orgMd = read("xwiki/instructions/xwiki-org.md");
const okfIndex = read("xwiki/okf/index.md");
press("xwiki/instructions/xwiki-org.md", "always-on file", bytes(orgMd), ORG_MAX_BYTES);
press("xwiki/instructions/xwiki-org.md", "OKF map block", bytes(orgMapBlock(orgMd) ?? ""), ORG_MAP_MAX_BYTES);
press("xwiki/okf/index.md", "file", bytes(okfIndex), OKF_INDEX_MAX_BYTES);
for (const e of okfIndexEntries(okfIndex)) press("xwiki/okf/index.md", `entry '${e.name}'`, bytes(e.text), OKF_ENTRY_MAX_BYTES);

// ---- similar-skills and one-way-pointers -------------------------------------------------------
const skillMd = Object.fromEntries(skills.map((s) => [s, read(`xwiki/skills/${s}/SKILL.md`)]));
const desc = Object.fromEntries(skills.map((s) => [s, description(skillMd[s])]));
const descWords = Object.fromEntries(skills.map((s) => [s, new Set(contentWords(desc[s]))]));
const similar = [];
const oneWay = [];
for (const a of skills) {
  for (const b of skills) {
    if (a < b) {
      const score = jaccard(descWords[a], descWords[b]);
      if (score >= 0.2 && kept(`xwiki/skills/${a}/SKILL.md`, `xwiki/skills/${b}/SKILL.md`)) {
        const routed = [desc[a].includes(b) && `${a}->${b}`, desc[b].includes(a) && `${b}->${a}`].filter(Boolean);
        similar.push({ score, files: [`xwiki/skills/${a}/SKILL.md`, `xwiki/skills/${b}/SKILL.md`],
          routedInDescriptions: routed.join(", ") || "neither names the other" });
      }
    }
  }
  for (const b of skillPointers(desc[a])) {
    if (b === a) continue;
    if (!skills.includes(b) && !EXTERNAL_SKILLS.has(b)) {
      oneWay.push({ score: 2, files: [`xwiki/skills/${a}/SKILL.md`], dangling: b });
    } else if (skills.includes(b) && !skillMd[b].includes(a) && kept(`xwiki/skills/${b}/SKILL.md`)) {
      oneWay.push({ score: jaccard(descWords[a], descWords[b]), files: [`xwiki/skills/${a}/SKILL.md`, `xwiki/skills/${b}/SKILL.md`],
        pointer: `${a} routes to ${b}; ${b}'s SKILL.md never names ${a}` });
    }
  }
}

// ---- okf-restated ------------------------------------------------------------------------------
// 6-word shingles, a lower bar than invariant 11: a skill paraphrasing an OKF rule keeps its phrases.
const okfSkillIndex = indexBlocks([...okfTopics, ...skills.flatMap(skillDocs)], read, 6);
const restated = new Map(); // okf file -> { skills: Map(skill -> shared), cites: Set }
okfSkillIndex.blocks.forEach((block, i) => {
  const skill = block.path.match(/^xwiki\/skills\/([^/]+)\//)?.[1];
  if (!skill) return;
  for (const [j, count] of sharedWithOtherFiles(okfSkillIndex, i)) {
    const topic = okfSkillIndex.blocks[j].path;
    if (!topic.startsWith("xwiki/okf/") || count < 3 || count / block.shingles.size < 0.15) continue;
    const r = restated.get(topic) ?? restated.set(topic, { skills: new Map(), cites: new Set() }).get(topic);
    r.skills.set(skill, (r.skills.get(skill) ?? 0) + count);
    if (skillDocs(skill).some((d) => read(d).includes(topic.slice("xwiki/".length)))) r.cites.add(skill);
  }
});
const okfRestated = [...restated].filter(([t, r]) => kept(t, ...[...r.skills.keys()].map((s) => `xwiki/skills/${s}/SKILL.md`)))
  .map(([topic, r]) => ({
    score: r.skills.size + [...r.skills.values()].reduce((x, y) => x + y, 0) / 100,
    files: [topic],
    skills: [...r.skills].map(([s, n]) => `${s} (${n} shingles${r.cites.has(s) ? ", cites it" : ", does not cite it"})`),
  }));

// ---- orphans -----------------------------------------------------------------------------------
const allSkillText = skills.flatMap(skillDocs).map(read).join("\n");
const indexNames = new Set(okfIndexEntries(okfIndex).map((e) => e.name));
const orphans = [];
for (const t of okfTopics) {
  const name = t.split("/").pop().replace(/\.md$/, "");
  const sub = t.replace(/[^/]+$/, "index.md"); // okf/servers/index.md and the like map their own topics
  const inIndex = indexNames.has(name) || (existsSync(join(repoRoot, sub)) && read(sub).includes(name));
  const cited = allSkillText.includes(t.slice("xwiki/".length));
  if ((!inIndex || !cited) && kept(t)) {
    orphans.push({ score: inIndex ? 0.5 : 2, files: [t],
      why: [!inIndex && "no `**name**` entry in okf/index.md or its sub-index", !cited && "no skill cites its path"].filter(Boolean).join("; ") });
  }
}
for (const s of skills) {
  const docs = skillDocs(s);
  const text = docs.map(read).join("\n");
  for (const r of docs.filter((d) => d.includes("/references/"))) {
    const ref = r.slice(`xwiki/skills/${s}/`.length);
    if (!text.includes(ref) && kept(r)) orphans.push({ score: 3, files: [r], why: `nothing in ${s} names ${ref}` });
  }
}

// ---- split -------------------------------------------------------------------------------------
// Signals only; a split itself is proposed, never made, by the routine.
const pastSha = git("rev-list", "-1", `--before=${GROWTH_WINDOW}`, "HEAD").trim();
const pastSize = new Map(
  (pastSha ? git("ls-tree", "-r", "-l", pastSha, "--", "xwiki") : "").split("\n").map((l) => l.match(/^\S+ blob \S+\s+(\d+)\t(.+)$/))
    .filter(Boolean).map((m) => [m[2], Number(m[1])])
);
// A section only one branch of a run, one mode or one sub-agent reads: the pattern the earlier splits moved out.
const CONDITIONAL = /\b(only (when|if|in|for)|dry[- ]run|rehears|sub-?agents?|each (agent|reviewer)|--write|\bmode\b|resum|optional|if (the|a|an|you) )/i;
// Which part of an OKF topic each skill reads: the section whose title the words around a citation
// of the topic's path name (a quoted title, or at least two of the title's content words).
const citations = new Map(); // okf file -> { skills: Set, parts: Map(section title -> Set(skill)) }
for (const s of skills) {
  for (const d of skillDocs(s)) {
    const text = read(d);
    for (const m of text.matchAll(/okf\/([a-z0-9-]+\/[a-z0-9-]+\.md)/g)) {
      const file = `xwiki/okf/${m[1]}`;
      if (!existsSync(join(repoRoot, file))) continue;
      const c = citations.get(file) ?? citations.set(file, { skills: new Set(), parts: new Map() }).get(file);
      c.skills.add(s);
      const around = text.slice(Math.max(0, m.index - 150), m.index + 250);
      const near = new Set(contentWords(around));
      let best = null;
      for (const { title } of sections(read(file))) {
        const tw = contentWords(title);
        const hits = around.includes(title) ? 99 : tw.filter((w) => near.has(w)).length;
        if (hits >= 2 && (!best || hits > best.hits)) best = { title, hits };
      }
      if (best) (c.parts.get(best.title) ?? c.parts.set(best.title, new Set()).get(best.title)).add(s);
    }
  }
}
// IDF over OKF topics, so a section is matched to a topic by the words that set topics apart.
const topicWords = new Map(okfTopics.map((t) => [t, new Set(contentWords(read(t)))]));
const df = new Map();
for (const ws of topicWords.values()) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
const idf = (w) => Math.log(okfTopics.length / (df.get(w) ?? 1));
// IDF-weighted cosine of two word sets, so a large topic does not attract every section by its size.
const weight = (ws) => [...ws].reduce((n, w) => n + idf(w) ** 2, 0);
const affinity = (ws, topicSet) => {
  let hit = 0;
  for (const w of ws) if (topicSet.has(w)) hit += idf(w) ** 2;
  return hit / Math.sqrt(weight(ws) * weight(topicSet) || 1);
};
const split = [];
const growth = (p, size) => (pastSize.has(p) ? (size - pastSize.get(p)) / pastSize.get(p) : 0);
const GROWN = 0.15; // and only counted for a file already past half its ceiling: a small file may grow
for (const s of skills) {
  const p = `xwiki/skills/${s}/SKILL.md`;
  const md = skillMd[s];
  const size = bytes(md);
  const cap = SKILL_MAX_BYTES; // its budget is its size plus ~10%, so the cap is what says "large"
  const secs = sections(md);
  const conditional = secs.filter((x) => CONDITIONAL.test(x.title) || CONDITIONAL.test(x.text.slice(0, 400)));
  const condShare = conditional.reduce((n, x) => n + bytes(x.text), 0) / size;
  const refs = skillDocs(s).filter((d) => d.includes("/references/"));
  const g = growth(p, size);
  const score = 2 * (size / cap) + Math.min(1, Math.max(0, g)) + condShare; // on the scale of an OKF topic below
  if ((size / cap >= 0.75 || (g >= GROWN && size / cap >= 0.5)) && kept(p)) {
    split.push({ score, files: [p], size, cap, growth4w: `${pct(g)}%`, sections: secs.length,
      references: `${refs.length} (${refs.reduce((n, r) => n + bytes(read(r)), 0)} bytes)`,
      conditionalSections: conditional.map((x) => `${x.title} (${bytes(x.text)} B)`) });
  }
}
for (const t of okfTopics) {
  const md = read(t);
  const size = bytes(md);
  const max = budgetOf(t, budgets);
  const secs = sections(md);
  const foreign = [];
  for (const sec of secs) {
    const ws = new Set(contentWords(sec.text));
    if (ws.size < 30 || t.startsWith("xwiki/okf/sonarqube/")) continue; // rule families are by rule, mapped in sonarqube/index.md
    const own = new Set(contentWords(md.replace(sec.text, "")));
    const ownAff = affinity(ws, own);
    let best = null;
    for (const [other, set] of topicWords) {
      if (other === t) continue;
      const a = affinity(ws, set);
      if (a > 1.25 * ownAff && (!best || a > best.a)) best = { other, a };
    }
    if (best) foreign.push(`"${sec.title}" reads closer to ${best.other.slice("xwiki/okf/".length)}`);
  }
  const c = citations.get(t);
  const parts = c ? [...c.parts].map(([sec, ss]) => `"${sec}": ${[...ss].join(", ")}`) : [];
  const partReaders = c ? new Set([...c.parts.values()].flatMap((ss) => [...ss])).size : 0;
  const g = growth(t, size);
  // An OKF topic has no hard cap and its budget is its size plus ~10%; the 12 KB default is what says "large".
  const score = Math.min(2, size / DEFAULT_MAX_BYTES) + Math.min(1, Math.max(0, g)) + 0.3 * foreign.length +
    0.2 * (c?.parts.size ?? 0);
  if ((size >= DEFAULT_MAX_BYTES || (g >= GROWN && size >= DEFAULT_MAX_BYTES / 2) || foreign.length >= 2 ||
      (c?.parts.size ?? 0) >= 2) && kept(t)) {
    split.push({ score, files: [t], size, budget: max, growth4w: `${pct(g)}%`, sections: secs.length,
      citedBy: `${c?.skills.size ?? 0} skills, ${partReaders} of them traceable to one section`,
      foreignSections: foreign, sectionReaders: parts });
  }
}

// ---- report ------------------------------------------------------------------------------------
const report = {
  "near-duplicates": top(nearDup),
  "budget-pressure": top(pressure),
  "similar-skills": top(similar),
  "one-way-pointers": top(oneWay),
  "okf-restated": top(okfRestated),
  orphans: top(orphans),
  split: top(split),
};
if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [name, list] of Object.entries(report)) {
    console.log(`## ${name} (${list.length})\n`);
    for (const c of list) {
      const { score, files, ...rest } = c;
      console.log(`- ${score.toFixed(2)} ${files.join(" + ")}`);
      for (const [k, v] of Object.entries(rest)) {
        console.log(`  - ${k}: ${Array.isArray(v) ? (v.length ? v.join("; ") : "none") : v}`);
      }
    }
    console.log("");
  }
}
