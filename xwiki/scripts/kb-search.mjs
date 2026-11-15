#!/usr/bin/env node
// Search engine of the plugin's knowledge base (KB): BM25F over the `##` sections of the KB's
// Markdown files, returning pointers (`file#Section` + title + first line), never bodies — the model
// then reads only the section it needs. Serves the CLI below, the prompt/edit hooks and the
// xwiki-knowledge skill.
//
//   node kb-search.mjs "<query>" [--k N] [--version X] [--json] [--root DIR]
//
// Every weight and constant here is set a priori, not tuned: the benchmark's held-out questions
// measure it, they must not shape it. The index is never committed: it is built on first use and
// cached under state-dir.mjs's kbIndexDir(), keyed by the KB's file list, sizes and mtimes.
//
// Generated retrieval metadata (developer-phrased questions and aliases, per file and per section)
// lives in a sidecar, `_meta/<topic path>.json` (`.md` → `.json`), so a model reading a topic never
// pays for it. A sidecar whose `source_hash` no longer matches its topic's body is ignored.
//
// The pointer hooks (kb-hooks.mjs) also index the plugin's skills, each as one section — its name
// and its description — tagged `[skill]`; their `applies-to`/`applies-when` live in `_meta/skills.json`
// (`{ "<skill name>": { "applies-to": [...], "applies-when": [...] } }`), SKILL.md's frontmatter being
// the hosts'. A `gate` entry (`true`, or `{ "file-contains": "<regex>" }` over the committed file) also
// makes the commit skill gate (check-diff.mjs) refuse a matching commit until the skill is loaded.
// `search` returns skills only when asked (`skills: true`); the CLI never indexes them.
//
// Node built-ins only, so it runs unchanged under Claude Code, Kimi Code and opencode (Bun).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { kbIndexDir } from "./state-dir.mjs";
import { invokedDirectly } from "./invoked-directly.mjs";

// Bump whenever the index's shape or anything feeding it (tokenizer, fields, weights) changes.
export const INDEX_FORMAT = 4;

const FIELD_WEIGHTS = { heading: 3, questions: 2, context: 1, body: 1 };
const K1 = 1.2;
const B = 0.75;
const GLOSSARY_WEIGHT = 0.5;
const TIE_RATIO = 0.95;
const PER_FILE = 2;
const DEFAULT_K = 5;
const FIRST_LINE_MAX = 160;
const QUERY_MAX = 500;
const META_DIR = "_meta";
const SKILLS_META = `${META_DIR}/skills.json`;
const SKILL_PREFIX = "skill:";

/** The KB root shipped with the plugin: `xwiki/kb`. */
export function defaultRoot() {
  return join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "kb");
}

/** The skills shipped with the plugin, beside the KB: `xwiki/skills`. */
export function defaultSkillsRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

// ---------------------------------------------------------------------------------------------
// Parsing

const unquote = (v) => v.replace(/^(["'])(.*)\1$/, "$2");
const stripComment = (v) => v.replace(/\s+#\s.*$/, "").trim();

function scalarOrList(raw) {
  const v = stripComment(raw);
  if (/^\[.*\]$/.test(v)) {
    return v.slice(1, -1).split(",").map((x) => unquote(x.trim())).filter(Boolean);
  }
  return unquote(v);
}

/**
 * Tolerant parser for the KB's YAML-ish frontmatter: `key: scalar`, indented continuation lines
 * folded into the scalar, `key:` followed by `  - item` lines, inline `[a, b]` lists and trailing
 * ` # comment`s. Unknown keys are kept. Returns `{ data, body }`.
 */
export function parseFrontmatter(text) {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (kv) {
      key = kv[1];
      const v = kv[2] === undefined ? "" : scalarOrList(kv[2]);
      data[key] = v === "" ? null : v;
      continue;
    }
    if (key === null) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && (data[key] === null || Array.isArray(data[key]))) {
      (data[key] ??= []).push(unquote(stripComment(item[1])));
    } else if (/^\s/.test(line)) {
      const cont = line.trim();
      if (Array.isArray(data[key])) data[key][data[key].length - 1] += ` ${cont}`;
      else data[key] = data[key] === null ? cont : `${data[key]} ${cont}`;
    }
  }
  return { data, body: src.slice(m[0].length) };
}

/**
 * Splits a body into its `##` sections, ignoring `## ` inside fenced code. The text before the
 * first `##` is a section too when it holds anything beyond the `# H1`; its heading is `title`.
 * Returns `[{ heading, text }]`.
 */
export function splitSections(body, title) {
  const sections = [];
  let current = { heading: null, lines: [] };
  let fence = null;
  for (const line of body.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const h = fence === null && !f && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      sections.push(current);
      current = { heading: h[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  const [pre, ...rest] = sections;
  const preLines = pre.lines.filter((l) => !/^#\s/.test(l));
  const out = rest.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }));
  const preText = preLines.join("\n").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (preText) out.unshift({ heading: title, text: preText });
  return out;
}

/** First line of content of a section, light Markdown stripped, at most 160 characters. */
export function firstLine(text) {
  let fence = false;
  for (const raw of text.split("\n")) {
    if (/^\s*(`{3}|~{3})/.test(raw)) { fence = !fence; continue; }
    const line = raw.trim();
    if (fence || !line || /^<!--/.test(line) || /^#{1,6}\s*$/.test(line)) continue;
    const clean = line
      .replace(/^#{1,6}\s+/, "").replace(/^([-*+]|\d+\.)\s+/, "").replace(/^>\s*/, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
    if (!clean) continue;
    return clean.length > FIRST_LINE_MAX ? `${clean.slice(0, FIRST_LINE_MAX - 1)}…` : clean;
  }
  return "";
}

/** Glossary: one synonym group per list line, e.g. `- rights, permissions, ACL, access rights`. */
export function parseGlossary(text) {
  const groups = [];
  for (const line of parseFrontmatter(text).body.split("\n")) {
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!m) continue;
    const members = m[1].split(",").map((s) => tokenize(s)).filter((t) => t.length);
    if (members.length > 1) groups.push(members);
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Tokenizer

const STOPWORDS = new Set((
  "a an and are as at be been being but by can could did do does doing for from had has have how i "
  + "if in into is it its it's i'm me my no nor not of on or our so such than that the their them then "
  + "there these they this those to too was we were what when where which while who whom why will "
  + "with would you your should shall am any all about also just only very own same other some"
).split(" "));

function stem(t) {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** A word: letters and digits, joined by `.`, `_`, `'` or `-` into one identifier. */
const WORD = /[\p{L}\p{N}]+(?:[._'-][\p{L}\p{N}]+)*/gu;

/**
 * Lowercased terms: identifiers are split into their camelCase and `.`/`_`/`-` parts while the
 * joined whole is kept too (`ScriptService` → scriptservice, script, service); stopwords dropped;
 * light plural stemming only.
 */
export function tokenize(text) {
  const out = [];
  const words = String(text).match(WORD) || [];
  for (const word of words) {
    const parts = word.split(/[._'-]/).flatMap(
      (p) => p.match(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{N}+|[\p{L}\p{N}]+/gu) || []);
    const whole = word.toLowerCase().replace(/[._-]/g, "");
    const terms = parts.length > 1
      ? [whole, ...parts.filter((p) => p.length > 1).map((p) => p.toLowerCase())]
      : [whole];
    for (const raw of terms) {
      if (STOPWORDS.has(raw)) continue;
      const t = stem(raw.replace(/'/g, ""));
      if (t && !STOPWORDS.has(t)) out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Index

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function listFiles(root, ext, { skipMeta = true } = {}) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!(skipMeta && dir === root && e.name === META_DIR)) walk(p);
      } else if (e.isFile() && e.name.endsWith(ext)) files.push(relative(root, p).split(sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

const listMarkdown = (root) => listFiles(root, ".md");

/** Hash a sidecar is tied to: the topic's body, so curating its frontmatter does not stale it. */
export function bodyHash(text) {
  return createHash("sha256").update(parseFrontmatter(text).body).digest("hex");
}

/** Path of a topic's sidecar, relative to the KB root: `_meta/<topic path>` with `.md` → `.json`. */
export const sidecarOf = (rel) => `${META_DIR}/${rel.replace(/\.md$/, "")}.json`;

/**
 * The generated metadata of a topic, or null when its sidecar is absent, unreadable or stale (its
 * `source_hash` differs from the topic body's). Returns `{ file: string[], sections: { heading: string[] } }`.
 */
export function loadSidecar(root, rel, text) {
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(root, sidecarOf(rel)), "utf8"));
  } catch {
    return null;
  }
  if (!meta || meta.source_hash !== bodyHash(text)) return null;
  const terms = (o) => (o && typeof o === "object"
    ? [...asList(o.questions), ...asList(o.aliases)].map(String) : []);
  const sections = {};
  for (const [heading, o] of Object.entries(meta.sections || {})) sections[heading] = terms(o);
  return { file: terms(meta.file), sections };
}

/** Whether a KB file is searchable: not the root index nor glossary, and no `_template.md`. */
export function isCorpusFile(rel) {
  return rel !== "index.md" && rel !== "glossary.md" && !/(^|\/)_template\.md$/.test(rel);
}

/** Cache key of a KB root: the index format plus every Markdown file's and sidecar's path, size and mtime. */
export function indexKey(root, skillsRoot = null) {
  const h = createHash("sha256").update(`kb-search/${INDEX_FORMAT}\n`);
  const meta = listFiles(join(root, META_DIR), ".json", { skipMeta: false }).map((r) => `${META_DIR}/${r}`);
  const stat = (base, rel) => {
    const s = statSync(join(base, rel));
    h.update(`${rel}\t${s.size}\t${s.mtimeMs}\n`);
  };
  for (const rel of [...listMarkdown(root), ...meta]) stat(root, rel);
  if (skillsRoot) {
    h.update(`skills ${skillsRoot}\n`);
    for (const { dir } of skillFiles(skillsRoot)) stat(skillsRoot, `${dir}/SKILL.md`);
  }
  return h.digest("hex");
}

function skillFiles(skillsRoot) {
  if (!skillsRoot || !existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsRoot, e.name, "SKILL.md")))
    .map((e) => ({ dir: e.name })).sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * The skills a pointer may name: per `<skillsRoot>/<dir>/SKILL.md`, its `name` and its `description`
 * minus the sentences naming another `xwiki-*` skill (the "for X use Y" routing is about the sibling).
 * A skill that only the developer may start (EXPLICIT INVOCATION ONLY, `disable-model-invocation`)
 * is left out. Returns `[{ name, text, first }]`, `first` being the description's first sentence.
 */
export function readSkills(skillsRoot) {
  const skills = [];
  for (const { dir } of skillFiles(skillsRoot)) {
    const { data } = parseFrontmatter(readFileSync(join(skillsRoot, dir, "SKILL.md"), "utf8"));
    const name = String(data.name || dir);
    const description = data.description ? String(data.description) : "";
    if (!description || /EXPLICIT INVOCATION ONLY/i.test(description)
      || String(data["disable-model-invocation"]) === "true") continue;
    const sentences = description.split(/(?<=[.!?])\s+/);
    const own = sentences.filter((x) => !(x.match(/\bxwiki-[a-z][\w-]*/g) || []).some((n) => n !== name));
    skills.push({ name, text: own.join(" "), first: sentences[0] });
  }
  return skills;
}

function countInto(map, tokens, weight) {
  for (const t of tokens) map.set(t, (map.get(t) || 0) + weight);
  return tokens.length * weight;
}

/** Builds the index of a KB root (no cache involved). */
export function buildIndex(root, { skillsRoot = null } = {}) {
  const files = {};
  const sections = [];
  const postings = Object.create(null);
  let totalLength = 0;
  for (const rel of listMarkdown(root).filter(isCorpusFile)) {
    const text = readFileSync(join(root, rel), "utf8");
    const { data, body } = parseFrontmatter(text);
    const h1 = /^#\s+(.+)$/m.exec(body);
    const title = String(data.title || (h1 && h1[1]) || rel.replace(/\.md$/, ""));
    const summary = data.summary ? String(data.summary) : "";
    files[rel] = {
      title,
      status: data.status || null,
      stability: data.stability || null,
      versions: data.versions ? asList(data.versions).join(" ") : null,
      lastConfirmed: data["last-confirmed"] ? String(data["last-confirmed"]) : null,
      provenance: data.provenance || null,
      related: asList(data.related).map(String),
      appliesTo: asList(data["applies-to"]).map(String),
      appliesWhen: asList(data["applies-when"]).map(String),
    };
    const questions = tokenize([...asList(data.questions), ...asList(data.aliases)].join("\n"));
    const context = tokenize(`${title}\n${summary}`);
    // Generated questions and aliases: a section's own at the questions weight, the file's at half of it.
    const sidecar = loadSidecar(root, rel, text);
    const fileGenerated = sidecar ? tokenize(sidecar.file.join("\n")) : [];
    for (const s of splitSections(body, title)) {
      const tf = new Map();
      let length = countInto(tf, tokenize(s.heading), FIELD_WEIGHTS.heading);
      length += countInto(tf, questions, FIELD_WEIGHTS.questions);
      if (sidecar) {
        const own = Object.hasOwn(sidecar.sections, s.heading) ? sidecar.sections[s.heading] : [];
        length += countInto(tf, tokenize(own.join("\n")), FIELD_WEIGHTS.questions);
        length += countInto(tf, fileGenerated, FIELD_WEIGHTS.questions / 2);
      }
      length += countInto(tf, context, FIELD_WEIGHTS.context);
      length += countInto(tf, tokenize(s.text), FIELD_WEIGHTS.body);
      const idx = sections.length;
      sections.push({ file: rel, section: s.heading, first: firstLine(s.text), length });
      totalLength += length;
      for (const [t, w] of tf) (postings[t] ??= []).push(idx, w);
    }
  }
  if (skillsRoot) {
    let applies = {};
    try {
      applies = JSON.parse(readFileSync(join(root, SKILLS_META), "utf8")) || {};
    } catch { /* no skill metadata: skills match prompts only */ }
    for (const { name, text, first } of readSkills(skillsRoot)) {
      const file = `${SKILL_PREFIX}${name}`;
      const a = Object.hasOwn(applies, name) ? applies[name] : {};
      files[file] = { title: name, kind: "skill", status: null, stability: null, versions: null, lastConfirmed: null,
        provenance: null, related: [], appliesTo: asList(a["applies-to"]).map(String),
        appliesWhen: asList(a["applies-when"]).map(String) };
      const tf = new Map();
      let length = countInto(tf, tokenize(name), FIELD_WEIGHTS.heading);
      length += countInto(tf, tokenize(text), FIELD_WEIGHTS.body);
      const idx = sections.length;
      sections.push({ file, section: name, first: firstLine(first), length });
      totalLength += length;
      for (const [t, w] of tf) (postings[t] ??= []).push(idx, w);
    }
  }
  const glossaryPath = join(root, "glossary.md");
  const glossary = existsSync(glossaryPath) ? parseGlossary(readFileSync(glossaryPath, "utf8")) : [];
  return {
    format: INDEX_FORMAT,
    files,
    sections,
    postings,
    glossary,
    avgLength: sections.length ? totalLength / sections.length : 0,
  };
}

/**
 * The index of a KB root, from the cache when its key still matches, else rebuilt and cached.
 * A cache that cannot be read or written is ignored. `cacheDir: null` disables the cache.
 */
export function loadIndex(root = defaultRoot(), { cacheDir = kbIndexDir(), skillsRoot = null } = {}) {
  const abs = resolve(root);
  const skills = skillsRoot ? resolve(skillsRoot) : null;
  const key = indexKey(abs, skills);
  const name = createHash("sha256").update(skills ? `${abs}\n${skills}` : abs).digest("hex").slice(0, 16);
  const file = cacheDir && join(cacheDir, `${name}.json`);
  if (file) {
    try {
      const cached = JSON.parse(readFileSync(file, "utf8"));
      if (cached.key === key) return cached.index;
    } catch { /* missing or unreadable: rebuild */ }
  }
  const index = buildIndex(abs, { skillsRoot: skills });
  if (file) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify({ key, index }));
    } catch { /* a read-only state dir only costs the next run a rebuild */ }
  }
  return index;
}

// ---------------------------------------------------------------------------------------------
// Query

/** Turns a raw prompt into a query: fenced code and URLs dropped, inline code kept, length capped. */
export function promptToQuery(prompt) {
  const q = String(prompt)
    .replace(/(^|\n)\s*(`{3,}|~{3,})[\s\S]*?(\n\s*\2[^\n]*|$)/g, "\n")
    .replace(/\b(?:https?|ftp):\/\/\S+/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (q.length <= QUERY_MAX) return q;
  const cut = q.slice(0, QUERY_MAX);
  const space = cut.lastIndexOf(" ");
  return space > QUERY_MAX / 2 ? cut.slice(0, space) : cut;
}

/**
 * Weighted query terms, `term → { weight, word }`: the query's own at 1, glossary synonyms of a matched
 * group at 0.5. `word` is the query word a term comes from (a synonym is a word of its own), so that
 * an identifier counts once: `xwiki-platform` scores as the best of xwikiplatform, xwiki and platform,
 * not their sum.
 */
export function queryTerms(query, glossary = []) {
  const terms = new Map();
  (String(query).match(WORD) || []).forEach((word, i) => {
    for (const t of tokenize(word)) if (!terms.has(t)) terms.set(t, { weight: 1, word: i });
  });
  const present = new Set(terms.keys());
  for (const group of glossary) {
    if (!group.some((member) => member.every((t) => present.has(t)))) continue;
    for (const member of group) {
      for (const t of member) if (!terms.has(t)) terms.set(t, { weight: GLOSSARY_WEIGHT, word: `=${t}` });
    }
  }
  return terms;
}

function parseVersion(v) {
  const m = /^\s*(\d+(?:\.\d+)*)/.exec(String(v));
  return m ? m[1].split(".").map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * Whether `version` (e.g. `18.5.0-SNAPSHOT`) satisfies a `versions` constraint such as `>=17.4` or
 * `>=17.4 <18.0` (comparators `>=`, `>`, `<=`, `<`, `=`; a bare version means `=`). A missing or
 * unparseable constraint matches everything.
 */
export function versionMatches(constraint, version) {
  const v = parseVersion(version);
  if (!constraint || !v) return true;
  const parts = String(constraint).match(/(>=|<=|>|<|==?)?\s*\d+(?:\.\d+)*/g) || [];
  return parts.every((part) => {
    const [, op = "=", ver] = /^(>=|<=|>|<|==?)?\s*(.*)$/.exec(part);
    const c = compareVersions(v, parseVersion(ver));
    return { ">=": c >= 0, "<=": c <= 0, ">": c > 0, "<": c < 0, "=": c === 0, "==": c === 0 }[op];
  });
}

/** Tag shown with a hit: how much authority the section carries (a superseded ADR carries none). */
export function tagOf(fileMeta, file) {
  if (fileMeta.kind === "skill") return "[skill]";
  if (fileMeta.status === "proposed") return "[proposed: under discussion]";
  if (fileMeta.status === "superseded" || fileMeta.status === "deprecated") return "[superseded]";
  if (file.startsWith("decisions/") && fileMeta.status === "accepted") return "[ADR]";
  if (fileMeta.stability === "volatile") return "[volatile]";
  return "[rule]";
}

function resolveRelated(index, ref) {
  const r = ref.replace(/^\.?\//, "").replace(/#.*$/, "");
  const files = Object.keys(index.files);
  return files.find((f) => f === r || f === `${r}.md`)
    || files.find((f) => f.endsWith(`/${r}`) || f.endsWith(`/${r}.md`));
}

/**
 * Searches an index. Options: `k` (default 5), `version` (drops sections whose file's `versions`
 * excludes it), `skills` (also return the skills of an index built with them; id `skill:<name>`). Returns `[{ id, file, section, title, first, score, tag, related }]`, where
 * `related` lists `{ file, title }` one-hop pointers not already among the results.
 */
export function search(index, query, { k = DEFAULT_K, version, skills = false } = {}) {
  const N = index.sections.length;
  const byWord = new Map(); // query word → (section → its best term's score)
  for (const [term, { weight, word }] of queryTerms(query, index.glossary)) {
    if (!Object.hasOwn(index.postings, term)) continue;
    const posting = index.postings[term];
    const df = posting.length / 2;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    if (!byWord.has(word)) byWord.set(word, new Map());
    const best = byWord.get(word);
    for (let i = 0; i < posting.length; i += 2) {
      const s = posting[i];
      const tf = posting[i + 1];
      const norm = K1 * (1 - B + (B * index.sections[s].length) / index.avgLength);
      best.set(s, Math.max(best.get(s) || 0, weight * idf * ((tf * (K1 + 1)) / (tf + norm))));
    }
  }
  const scores = new Map();
  for (const best of byWord.values()) for (const [s, v] of best) scores.set(s, (scores.get(s) || 0) + v);
  let ranked = [...scores]
    .filter(([s]) => skills || index.files[index.sections[s].file].kind !== "skill")
    .filter(([s]) => !version || versionMatches(index.files[index.sections[s].file].versions, version))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  // Age breaks near-ties only: within a run of scores within 5% of its best, newer last-confirmed first.
  const confirmed = (s) => index.files[index.sections[s].file].lastConfirmed || "";
  const ordered = [];
  for (let i = 0; i < ranked.length;) {
    let j = i + 1;
    while (j < ranked.length && ranked[j][1] >= ranked[i][1] * TIE_RATIO) j++;
    ordered.push(...ranked.slice(i, j).sort((a, b) => confirmed(b[0]).localeCompare(confirmed(a[0]))));
    i = j;
  }
  ranked = ordered;

  const perFile = new Map();
  const hits = [];
  for (const [s, score] of ranked) {
    if (hits.length >= k) break;
    const sec = index.sections[s];
    const n = perFile.get(sec.file) || 0;
    if (n >= PER_FILE) continue;
    perFile.set(sec.file, n + 1);
    hits.push(sectionHit(index, sec, Math.round(score * 1000) / 1000));
  }
  const seen = new Set(hits.map((h) => h.file));
  for (const h of hits) {
    h.related = [];
    for (const ref of index.files[h.file].related) {
      const f = resolveRelated(index, ref);
      if (!f || seen.has(f)) continue;
      seen.add(f);
      h.related.push({ file: f, title: index.files[f].title });
    }
  }
  return hits;
}

/** The hit of one indexed section: `file#Section`, or `skill:<name>` for a skill. */
export function sectionHit(index, sec, score = 0) {
  const meta = index.files[sec.file];
  return { id: meta.kind === "skill" ? sec.file : `${sec.file}#${sec.section}`, file: sec.file, section: sec.section,
    title: meta.title, first: sec.first, score, tag: tagOf(meta, sec.file) };
}

/** Searches a KB root, through the index cache. */
export function kbSearch(query, { root = defaultRoot(), cacheDir, ...opts } = {}) {
  return search(loadIndex(root, cacheDir === undefined ? {} : { cacheDir }), query, opts);
}

/** Plain-text rendering: one line per hit, then its `related:` pointers if any. */
export function formatResults(hits) {
  const lines = [];
  for (const h of hits) {
    lines.push(`${h.tag} ${h.id} — ${h.title}: ${h.first}`);
    if (h.related.length) {
      lines.push(`  related: ${h.related.map((r) => `${r.file} (${r.title})`).join("; ")}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// CLI

export function parseArgs(argv) {
  const opts = { k: DEFAULT_K, json: false, root: null, version: null, query: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--k") opts.k = Number(argv[++i]);
    else if (a === "--version") opts.version = argv[++i];
    else if (a === "--root") opts.root = argv[++i];
    else opts.query.push(a);
  }
  if (!Number.isInteger(opts.k) || opts.k < 1) throw new Error("--k takes a positive integer");
  return { ...opts, query: opts.query.join(" ") };
}

if (invokedDirectly(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`kb-search: ${e.message}\n`);
    process.exit(2);
  }
  if (!opts.query.trim()) {
    process.stderr.write('usage: kb-search.mjs "<query>" [--k N] [--version X] [--json] [--root DIR]\n');
    process.exit(2);
  }
  const hits = kbSearch(opts.query, { root: opts.root || defaultRoot(), k: opts.k, version: opts.version });
  process.stdout.write(opts.json ? `${JSON.stringify(hits, null, 2)}\n` : `${formatResults(hits)}\n`);
}
