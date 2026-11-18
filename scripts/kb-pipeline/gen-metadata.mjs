#!/usr/bin/env node
// Metadata step of the KB pipeline: for each KB topic, a cheap model (Haiku, through headless Claude
// Code) writes the retrieval metadata kb-search indexes — per section and per file, questions phrased
// the way a developer would ask them while coding, and aliases — into the topic's sidecar
// `_meta/<topic path>.json` (see xwiki/scripts/kb-search.mjs). It also proposes the human-curated
// frontmatter fields `related:` and `applies-to:`, kept in the sidecar under `proposed` until
// `--apply-frontmatter` writes them, with `provenance` and `last-confirmed`, into topics that lack them.
//
//   node scripts/kb-pipeline/gen-metadata.mjs [--root DIR] [--only REL]... [--concurrency N] [--model M] [--force]
//   node scripts/kb-pipeline/gen-metadata.mjs --apply-frontmatter [--root DIR] [--provenance official]
//
// Resumable: a topic is skipped while its sidecar is current — `source_hash` matches its body and
// `file_hash` its title and summary (other frontmatter edits do not re-run the model). The model sees
// only the topic itself plus the list of KB paths and titles (to pick `related:` from) — never anything
// else.
//
// Stable: a regenerated topic keeps the metadata of each section whose heading and text are unchanged
// (`section_hashes`) and its file-level questions while its title and summary are (`file_hash`), and
// calls no model when nothing it would replace changed: a title or summary edit renews the file part
// only, a body edit only the changed sections. The model's wording varies from run to run, and each
// varied word moves search scores; `--force` regenerates everything. A current sidecar without these
// hashes gets them, with no model call.
//
// Edited, not rerolled: a changed part's previous questions and aliases go to the model, which keeps
// those the new text still answers word for word, drops the others and adds what is new. Each previous
// question is then searched with the part's old and new metadata; a part now ranking lower for one it
// ranked within RANK_WATCH is printed as a `RANK` line and the run exits 1, the sidecar written. A
// dropped question the text no longer answers is expected; anything else is a regression to fix by hand
// in the sidecar (the validator checks hashes, not wording).
//
// Residual risk: kb-search counts a file's generated questions in every section of that file, document
// frequencies included, so regenerating them (a title or summary edit, or `--force`) can still move the
// prompt-hook probes of other files across MIN_SCORE. When a tests/kb-hooks/ probe fails or a `RANK` line
// is printed after a regeneration, the change keeps that sidecar and lists them in its PR (or run report)
// for a committer; it never regenerates again until the tests pass, which tunes the KB to the probes.

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { invokedDirectly } from "../../xwiki/scripts/invoked-directly.mjs";
import {
  bodyHash, buildIndex, defaultRoot, isCorpusFile, loadSidecar, parseFrontmatter, search, sidecarOf,
  splitSections,
} from "../../xwiki/scripts/kb-search.mjs";

const MODEL = "haiku";
const CONCURRENCY = 4;
// A previous question counts when its part ranked within RANK_WATCH hits; searched RANK_DEPTH deep.
const RANK_WATCH = 10;
const RANK_DEPTH = 30;

const stringList = (min, max) => ({ type: "array", items: { type: "string" }, minItems: min, maxItems: max });

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["file", "sections", "related", "applies_to"],
  properties: {
    file: {
      type: "object",
      additionalProperties: false,
      required: ["questions", "aliases"],
      properties: { questions: stringList(2, 5), aliases: stringList(0, 5) },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "questions", "aliases"],
        properties: { heading: { type: "string" }, questions: stringList(2, 5), aliases: stringList(0, 5) },
      },
    },
    related: stringList(0, 4),
    applies_to: stringList(0, 8),
  },
};

/** The KB's topics: Markdown files kb-search indexes, as `{ rel, text, title, headings }`. */
export function corpus(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || (dir === root && e.name === "_meta")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(relative(root, p).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort().filter(isCorpusFile).map((rel) => {
    const text = readFileSync(join(root, rel), "utf8");
    const { data, body } = parseFrontmatter(text);
    const h1 = /^#\s+(.+)$/m.exec(body);
    const title = String(data.title || (h1 && h1[1]) || rel.replace(/\.md$/, ""));
    const sections = splitSections(body, title);
    return { rel, text, title, summary: data.summary ? String(data.summary) : "", sections,
      headings: sections.map((s) => s.heading) };
  });
}

export function prompt(topic, all, previous = { file: null, sections: {} }) {
  const others = all.filter((t) => t.rel !== topic.rel).map((t) => `- ${t.rel} — ${t.title}`).join("\n");
  return `You write search metadata for one file of the XWiki developers' knowledge base. A search engine
matches developers' questions against it; nobody reads it but the engine.

For the whole file and for each of its sections, write:
- questions: how a developer would ask, in their own words, while coding, for what this file or section
  answers. Write them as that developer would — someone who may not know XWiki's name for the thing:
  use the everyday terms they would use, not just the section's own jargon. Vary the angle: the task
  they are doing, the problem they hit, the decision they face. File: 2–5. Each section: 2–5.
- aliases: other names a developer might search for — synonyms, older or other names, abbreviations,
  the generic term for an XWiki-specific name and vice versa. 0–5; none rather than padding.

Also propose:
- related: 0–4 paths, from the list below, of the other files a reader of this one most likely needs
  next. Only paths from the list, exactly as written.
- applies_to: path globs of the files whose editing these rules govern (e.g. "**/*.vm",
  "**/src/main/resources/**/*.xml", "**/pom.xml", "**/src/test/**/*.java"). Empty when the file is not
  about editing code or files in a repository (a process, a server, a policy).

Return the sections in the order given, each with its heading copied exactly.
${previousBlock(previous)}
Sections, in order:
${topic.headings.map((h) => `- ${h}`).join("\n")}

Other files of the knowledge base:
${others}

The file (${topic.rel}):
<file>
${topic.text}
</file>`;
}

/** The prompt's list of the changed parts' previous metadata, or nothing. */
function previousBlock(previous) {
  const parts = [...(previous.file ? [["the whole file", previous.file]] : []),
    ...Object.entries(previous.sections).map(([h, m]) => [`section "${h}"`, m])];
  if (!parts.length) return "";
  const list = parts.map(([name, m]) => `- ${name}: questions ${JSON.stringify(m.questions || [])}, aliases ${
    JSON.stringify(m.aliases || [])}`).join("\n");
  return `
These parts had metadata before their text changed. Keep, word for word, every question and alias the
new text still answers; drop only those it no longer answers; then add what the new text answers that
they miss, within the counts above:
${list}
`;
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** What a section's metadata is written from: its heading and text. */
export const sectionHash = (section) => sha(`${section.heading}\n${section.text}`);

/** What the file-level metadata is written from: the title and the summary. */
export const fileHash = (topic) => sha(`${topic.title}\n${topic.summary || ""}`);

/** The hashes a sidecar records for `topic`, so a later run knows what changed. */
export function hashes(topic) {
  return {
    file_hash: fileHash(topic),
    section_hashes: Object.fromEntries((topic.sections || []).map((s) => [s.heading, sectionHash(s)])),
  };
}

/**
 * Whether `topic`'s sidecar is current: its `source_hash` matches the body and its `file_hash` the title
 * and summary (a sidecar from before `file_hash` is not).
 */
export function sidecarCurrent(root, topic) {
  return Boolean(loadSidecar(root, topic.rel, topic.text)) && readRaw(root, topic.rel)?.file_hash === fileHash(topic);
}

/**
 * The previous sidecar's metadata kept for `topic`: `{ file, sections }`, each kept part only where its
 * recorded hash still matches (the file part on `file_hash`, a section on its `section_hashes` entry), and
 * `complete` when nothing is left for a model to write. A sidecar without hashes keeps nothing.
 */
export function reusable(topic, old) {
  const kept = { file: null, sections: {} };
  if (!old || typeof old !== "object") return { ...kept, complete: false };
  if (old.file && old.file_hash === fileHash(topic)) kept.file = old.file;
  // Keyed by heading: a heading used twice has one hash for two sections, so its sections are never kept.
  for (const s of topic.sections || []) {
    if (old.sections && Object.hasOwn(old.sections, s.heading) && old.section_hashes?.[s.heading] === sectionHash(s)) {
      kept.sections[s.heading] = old.sections[s.heading];
    }
  }
  return { ...kept, complete: kept.file !== null && Object.keys(kept.sections).length === (topic.sections || []).length };
}

/** The previous metadata of the parts of `topic` that changed since `old`: `{ file, sections }`. */
export function previousOf(topic, old) {
  const out = { file: null, sections: {} };
  if (!old || typeof old !== "object") return out;
  if (old.file && old.file_hash !== fileHash(topic)) out.file = old.file;
  for (const s of topic.sections || []) {
    if (old.sections && Object.hasOwn(old.sections, s.heading) && old.section_hashes?.[s.heading] !== sectionHash(s)) {
      out.sections[s.heading] = old.sections[s.heading];
    }
  }
  return out;
}

/**
 * The previous questions of `topic`'s changed parts for which the part ranks lower in kb-search with
 * `sidecar` than with the previous metadata put back, among those it ranked within RANK_WATCH:
 * `[{ part, question, before, after, kept }]`, a rank 1-based or null past RANK_DEPTH. Searches a copy
 * of `root`, so the KB is not touched.
 */
export function rankDrops(root, topic, sidecar, previous) {
  const asked = [...(previous.file?.questions || []).map((q) => ["(file)", q]),
    ...Object.entries(previous.sections).flatMap(([h, m]) => (m.questions || []).map((q) => [h, q]))];
  if (!asked.length) return [];
  const tmp = mkdtempSync(join(tmpdir(), "kb-rank-"));
  try {
    cpSync(root, tmp, { recursive: true });
    writeSidecar(tmp, topic.rel, sidecar);
    const after = buildIndex(tmp);
    writeSidecar(tmp, topic.rel, { ...sidecar, file: previous.file || sidecar.file,
      sections: { ...sidecar.sections, ...previous.sections } });
    const before = buildIndex(tmp);
    const rank = (index, part, q) => {
      const i = search(index, q, { k: RANK_DEPTH })
        .findIndex((h) => h.file === topic.rel && (part === "(file)" || h.section === part));
      return i < 0 ? null : i + 1;
    };
    const now = (part) => (part === "(file)" ? sidecar.file : sidecar.sections[part])?.questions || [];
    return asked.map(([part, question]) => ({ part, question, before: rank(before, part, question),
      after: rank(after, part, question), kept: now(part).includes(question) }))
      .filter((r) => r.before !== null && r.before <= RANK_WATCH && (r.after === null || r.after > r.before));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** `fresh` (a new sidecar) with the parts of `old` that `reusable` keeps, and the topic's hashes. */
export function mergeSidecar(topic, fresh, old) {
  const kept = reusable(topic, old);
  const sections = {};
  for (const h of topic.headings) sections[h] = Object.hasOwn(kept.sections, h) ? kept.sections[h] : fresh.sections[h];
  return { ...fresh, file: kept.file || fresh.file, sections, ...hashes(topic), source_hash: bodyHash(topic.text) };
}

/** Turns the model's answer into the sidecar object, or throws when it does not fit the topic. */
export function toSidecar(topic, answer, known) {
  if (answer.sections.length !== topic.headings.length) {
    throw new Error(`${answer.sections.length} sections returned for ${topic.headings.length}`);
  }
  const clean = (list) => [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  const sections = {};
  topic.headings.forEach((heading, i) => {
    const s = answer.sections.find((x) => x.heading.trim() === heading) || answer.sections[i];
    sections[heading] = { questions: clean(s.questions), aliases: clean(s.aliases) };
  });
  return {
    file: { questions: clean(answer.file.questions), aliases: clean(answer.file.aliases) },
    sections,
    proposed: {
      related: clean(answer.related).filter((r) => r !== topic.rel && known.has(r)).slice(0, 4),
      "applies-to": clean(answer.applies_to),
    },
    source_hash: bodyHash(topic.text),
  };
}

function claude(input, model) {
  const args = ["-p", "--model", model, "--tools", "", "--output-format", "json", "--json-schema",
    JSON.stringify(SCHEMA), "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config"];
  // An empty working directory, so no project instructions reach the model.
  const cwd = mkdtempSync(join(tmpdir(), "kb-meta-"));
  return new Promise((ok, ko) => {
    const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60 * 1000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const env = JSON.parse(out);
        if (!env.structured_output) throw new Error(env.result || "no structured_output");
        ok(env);
      } catch (e) {
        ko(new Error(`claude exited ${code}: ${e.message} ${err.slice(0, 300)}`));
      }
    });
    child.stdin.end(input);
  });
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Inserts `key: value` lines before the closing `---` of a topic's frontmatter, for absent keys only. */
export function addFrontmatter(text, fields) {
  const m = /^(---\n[\s\S]*?\n)(---[ \t]*(?:\n|$))/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const { data } = parseFrontmatter(text);
  const yaml = (v) => (Array.isArray(v) ? `[${v.map((x) => (/^[\w./-]+$/.test(x) ? x : JSON.stringify(x))).join(", ")}]` : v);
  const lines = Object.entries(fields)
    .filter(([k, v]) => !Object.hasOwn(data, k) && v != null && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${yaml(v)}\n`);
  return m[1] + lines.join("") + text.slice(m[1].length);
}

/** Date of the latest commit touching a file, `YYYY-MM-DD`, or null outside git. */
function lastCommitDate(abs) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cs", "--", abs], { cwd: dirname(abs), encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const o = { root: defaultRoot(), only: [], concurrency: CONCURRENCY, model: MODEL, force: false,
    apply: false, provenance: "official" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") o.root = resolve(argv[++i]);
    else if (a === "--only") o.only.push(argv[++i]);
    else if (a === "--concurrency") o.concurrency = Number(argv[++i]);
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--force") o.force = true;
    else if (a === "--apply-frontmatter") o.apply = true;
    else if (a === "--provenance") o.provenance = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function readRaw(root, rel) {
  try {
    return JSON.parse(readFileSync(join(root, sidecarOf(rel)), "utf8"));
  } catch {
    return null;
  }
}

function writeSidecar(root, rel, sidecar) {
  const out = join(root, sidecarOf(rel));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(sidecar, null, 2)}\n`);
}

async function generate(o) {
  const all = corpus(o.root);
  const known = new Set(all.map((t) => t.rel));
  const scope = all.filter((t) => !o.only.length || o.only.includes(t.rel));
  // A current sidecar from before the hashes: record them, so its next regeneration keeps what it can.
  let backfilled = 0;
  for (const t of scope) {
    const raw = readRaw(o.root, t.rel);
    if (raw && !raw.section_hashes && loadSidecar(o.root, t.rel, t.text)) {
      writeSidecar(o.root, t.rel, { ...raw, ...hashes(t) });
      backfilled++;
    }
  }
  if (backfilled) console.log(`hashes recorded in ${backfilled} current sidecars`);
  const todo = scope.filter((t) => o.force || !sidecarCurrent(o.root, t));
  console.log(`${all.length} topics, ${todo.length} to generate`);
  let cost = 0;
  let failed = 0;
  let drops = 0;
  await pool(todo, o.concurrency, async (topic) => {
    const old = o.force ? null : readRaw(o.root, topic.rel);
    if (old && reusable(topic, old).complete) {
      writeSidecar(o.root, topic.rel, mergeSidecar(topic, old, old));
      console.log(`kept ${topic.rel} (no section, title or summary changed)`);
      return;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const previous = previousOf(topic, old);
        const env = await claude(prompt(topic, all, previous), o.model);
        cost += env.total_cost_usd || 0;
        const sidecar = mergeSidecar(topic, toSidecar(topic, env.structured_output, known), old);
        const lower = rankDrops(o.root, topic, sidecar, previous);
        writeSidecar(o.root, topic.rel, sidecar);
        console.log(`ok   ${topic.rel} (${topic.headings.length} sections)`);
        for (const d of lower) {
          console.error(`RANK ${topic.rel}#${d.part}: "${d.question}" ${d.before} → ${d.after ?? "gone"}${
            d.kept ? "" : " (dropped)"}`);
        }
        drops += lower.length;
        return;
      } catch (e) {
        if (attempt < 2) continue;
        failed++;
        console.error(`FAIL ${topic.rel}: ${e.message}`);
        return;
      }
    }
  });
  console.log(`cost: $${cost.toFixed(4)}${failed ? `, ${failed} failed — rerun to retry them` : ""}`);
  if (drops) console.error(`${drops} previous question(s) rank lower — see this script's header`);
  if (failed || drops) process.exitCode = 1;
}

function applyFrontmatter(o) {
  let changed = 0;
  for (const topic of corpus(o.root)) {
    const abs = join(o.root, topic.rel);
    let proposed = {};
    try {
      proposed = JSON.parse(readFileSync(join(o.root, sidecarOf(topic.rel)), "utf8")).proposed || {};
    } catch { /* no sidecar: provenance and last-confirmed only */ }
    // A topic with `provenance` was already migrated and its related/applies-to reviewed: an absent
    // key there is a decision (no pointer from edits), so the proposals only go to new topics.
    const reviewed = /^provenance:/m.test(topic.text.split(/^---\s*$/m)[1] ?? "");
    const next = addFrontmatter(topic.text, {
      provenance: o.provenance,
      "last-confirmed": lastCommitDate(abs),
      related: reviewed ? undefined : proposed.related,
      "applies-to": reviewed ? undefined : proposed["applies-to"],
    });
    if (next !== topic.text) {
      writeFileSync(abs, next);
      changed++;
    }
  }
  console.log(`frontmatter updated in ${changed} topics`);
}

if (invokedDirectly(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  if (!existsSync(o.root)) throw new Error(`no KB at ${o.root}`);
  if (o.apply) applyFrontmatter(o);
  else await generate(o);
}
