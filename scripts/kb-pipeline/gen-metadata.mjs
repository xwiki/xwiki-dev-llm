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
// Resumable: a topic whose sidecar `source_hash` still matches its body is skipped (the hash covers
// the body only, so curating frontmatter does not re-run the model). The model sees only the topic
// itself plus the list of KB paths and titles (to pick `related:` from) — never anything else.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  bodyHash, defaultRoot, isCorpusFile, loadSidecar, parseFrontmatter, sidecarOf, splitSections,
} from "../../xwiki/scripts/kb-search.mjs";

const MODEL = "haiku";
const CONCURRENCY = 4;

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
        properties: { heading: { type: "string" }, questions: stringList(2, 4), aliases: stringList(0, 5) },
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
    return { rel, text, title, headings: splitSections(body, title).map((s) => s.heading) };
  });
}

export function prompt(topic, all) {
  const others = all.filter((t) => t.rel !== topic.rel).map((t) => `- ${t.rel} — ${t.title}`).join("\n");
  return `You write search metadata for one file of the XWiki developers' knowledge base. A search engine
matches developers' questions against it; nobody reads it but the engine.

For the whole file and for each of its sections, write:
- questions: how a developer would ask, in their own words, while coding, for what this file or section
  answers. Write them as that developer would — someone who may not know XWiki's name for the thing:
  use the everyday terms they would use, not just the section's own jargon. Vary the angle: the task
  they are doing, the problem they hit, the decision they face. File: 2–5. Each section: 2–4.
- aliases: other names a developer might search for — synonyms, older or other names, abbreviations,
  the generic term for an XWiki-specific name and vice versa. 0–5; none rather than padding.

Also propose:
- related: 0–4 paths, from the list below, of the other files a reader of this one most likely needs
  next. Only paths from the list, exactly as written.
- applies_to: path globs of the files whose editing these rules govern (e.g. "**/*.vm",
  "**/src/main/resources/**/*.xml", "**/pom.xml", "**/src/test/**/*.java"). Empty when the file is not
  about editing code or files in a repository (a process, a server, a policy).

Return the sections in the order given, each with its heading copied exactly.

Sections, in order:
${topic.headings.map((h) => `- ${h}`).join("\n")}

Other files of the knowledge base:
${others}

The file (${topic.rel}):
<file>
${topic.text}
</file>`;
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

async function generate(o) {
  const all = corpus(o.root);
  const known = new Set(all.map((t) => t.rel));
  const todo = all.filter((t) => (!o.only.length || o.only.includes(t.rel))
    && (o.force || !loadSidecar(o.root, t.rel, t.text)));
  console.log(`${all.length} topics, ${todo.length} to generate`);
  let cost = 0;
  let failed = 0;
  await pool(todo, o.concurrency, async (topic) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const env = await claude(prompt(topic, all), o.model);
        cost += env.total_cost_usd || 0;
        const sidecar = toSidecar(topic, env.structured_output, known);
        const out = join(o.root, sidecarOf(topic.rel));
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify(sidecar, null, 2)}\n`);
        console.log(`ok   ${topic.rel} (${topic.headings.length} sections)`);
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
  if (failed) process.exitCode = 1;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = parseArgs(process.argv.slice(2));
  if (!existsSync(o.root)) throw new Error(`no KB at ${o.root}`);
  if (o.apply) applyFrontmatter(o);
  else await generate(o);
}
