// Shared by validate.mjs (invariants 11 and 12) and consolidation-candidates.mjs, so that the copy
// check and the candidate finder split, word and budget the Markdown the same way. Node built-ins only.

// ---- Paragraph blocks and shingles (invariant 11) --------------------------------------------
// A block is a paragraph or a list item, with frontmatter and code fences left out. Below
// MIN_BLOCK_WORDS a repeat is a phrase, not a rule. A block naming a host's path variable is exempt:
// each skill has to say for itself where the shared okf/ and scripts/ are on each host, as a skill
// cannot include another file.
export const SHINGLE_WORDS = 8;
export const MIN_BLOCK_WORDS = 20;
export const COPY_RATIO = 0.5;

// The files compared for copies: what ships in the plugin, plus the repo's own docs.
export const inDupScope = (p) =>
  /^(xwiki\/|docs\/|README\.md$|CLAUDE\.md$)/.test(p) && !/\/tools\//.test(p);

export const words = (text) =>
  text.toLowerCase().replace(/[`*_>#|[\]()]/g, " ").match(/[a-z0-9][a-z0-9'./-]*/g) ?? [];

export const shingles = (ws, size = SHINGLE_WORDS) => {
  const out = new Set();
  for (let i = 0; i + size <= ws.length; i++) out.add(ws.slice(i, i + size).join(" "));
  return out;
};

// The comparable blocks of one Markdown file, each as { text, words }.
export const blocksOf = (markdown) => {
  const body = markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1/gm, ""); // fences, indented ones in list items too
  const out = [];
  for (const block of body.split(/\r?\n\s*\r?\n|\r?\n(?=\s*(?:[-*]|\d+\.)\s)/)) {
    if (/CLAUDE_PLUGIN_ROOT|KIMI_SKILL_DIR|XWIKI_LLM_HOME/.test(block)) continue;
    const ws = words(block);
    if (ws.length < MIN_BLOCK_WORDS) continue;
    out.push({ text: block.trim(), words: ws });
  }
  return out;
};

// Every block of `paths`, and an index from each shingle to the blocks holding it.
export const indexBlocks = (paths, read, size = SHINGLE_WORDS) => {
  const blocks = [];
  const owners = new Map(); // shingle -> indexes of the blocks holding it
  for (const path of paths) {
    for (const { text, words: ws } of blocksOf(read(path))) {
      const set = shingles(ws, size);
      const index = blocks.push({ path, text, shingles: set }) - 1;
      for (const s of set) (owners.get(s) ?? owners.set(s, []).get(s)).push(index);
    }
  }
  return { blocks, owners };
};

// For block i: other-file block index -> number of shingles the two have in common.
export const sharedWithOtherFiles = ({ blocks, owners }, i) => {
  const shared = new Map();
  for (const s of blocks[i].shingles) {
    for (const j of owners.get(s)) {
      if (blocks[j].path !== blocks[i].path) shared.set(j, (shared.get(j) ?? 0) + 1);
    }
  }
  return shared;
};

// ---- Size budgets (invariants 5, 8 and 12) ---------------------------------------------------
export const ORG_MAX_BYTES = 8000;
export const ORG_MAP_MAX_BYTES = 1800;
export const OKF_INDEX_MAX_BYTES = 11000;
export const OKF_ENTRY_MAX_BYTES = 240;
export const SKILL_MAX_BYTES = 20000;
export const DEFAULT_MAX_BYTES = 12000;

// Whether invariant 12 budgets this tracked Markdown file.
export const isBudgeted = (p) =>
  /^xwiki\/(skills|okf)\//.test(p) && !/\/tools\//.test(p) && p !== "xwiki/okf/index.md";

// Its budget: the entry in scripts/size-budgets.json, else the default for its kind.
export const budgetOf = (p, budgets) =>
  budgets[p] ?? (p.endsWith("/SKILL.md") ? SKILL_MAX_BYTES : DEFAULT_MAX_BYTES);

// The OKF map block of xwiki-org.md (invariant 5), or null when its delimiters are missing.
export const orgMapBlock = (orgMd) => {
  const start = orgMd.indexOf("OKF map");
  const end = orgMd.indexOf("**Capturing learnings:**");
  return start === -1 || end === -1 || end < start ? null : orgMd.slice(start, end);
};

// The topic entries of okf/index.md (invariant 8): each `- **name** — …` with its wrapped lines.
export const okfIndexEntries = (okfIndex) => {
  const entries = [];
  let entry = null;
  for (const line of okfIndex.split("\n")) {
    const head = line.match(/^- \*\*([a-z0-9-]+)\*\* —/);
    if (head) {
      entry = { name: head[1], text: line };
      entries.push(entry);
    } else if (entry && /^ {2}\S/.test(line)) {
      entry.text += "\n" + line;                         // a wrapped continuation of the same entry
    } else {
      entry = null;
    }
  }
  return entries;
};

// ---- Skill pointers (invariant 10) -----------------------------------------------------------
// Only a name in a pointer phrase counts ("use `xwiki-x` instead", "the `xwiki-x` skill"): a bare
// `xwiki-…` is usually a Maven module or a repo. The skills of another plugin, which this repo
// cannot see, are listed so that a pointer to one is not reported as dangling.
export const EXTERNAL_SKILLS = new Set(["xwiki-security-review", "xwiki-security-pass"]);
const skillName = "(xwiki-[a-z0-9]+(?:-[a-z0-9]+)*)";
const pointerPattern = new RegExp(
  `\`?\\b${skillName}\\b\`?(?=\\*{0,2}\\s+(?:skill|instead))` +
    `|(?:skills?|[Uu]se|via|run|load|invoke)\\s+\\*{0,2}\`?${skillName}\\b`,
  "g"
);
export const skillPointers = (text) => new Set([...text.matchAll(pointerPattern)].map((m) => m[1] ?? m[2]));
