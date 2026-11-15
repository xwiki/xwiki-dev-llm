// Used by validate.mjs (invariant 14). JSON.parse keeps only the last of two equal keys in one
// object, so a manifest that names an event twice (two "UserPromptSubmit" arrays after a merge)
// silently drops the first array's hooks. The opposite slip — one hook declared twice, which a
// merge can also leave — parses fine and runs the hook twice per call. Node built-ins only.

/** The keys that appear more than once in the same object of a JSON text, as `path.key` strings. */
export function duplicateKeys(text) {
  const dups = [];
  const stack = [];
  let i = 0;
  const readString = () => {
    let s = "";
    i++;
    while (text[i] !== '"') {
      if (text[i] === "\\") { s += text[i + 1]; i += 2; } else s += text[i++];
    }
    i++;
    return s;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "{" || c === "[") {
      const parent = stack.at(-1);
      // An object's value takes the key just read; an array's element takes the array's own path.
      const path = !parent ? "" : parent.keys ? parent.pending ?? parent.path : parent.path;
      stack.push({ keys: c === "{" ? new Set() : null, path });
      i++;
    } else if (c === "}" || c === "]") {
      stack.pop();
      i++;
    } else if (c === '"') {
      const s = readString();
      let j = i;
      while (/\s/.test(text[j])) j++;
      const top = stack.at(-1);
      if (top?.keys && text[j] === ":") {
        const path = top.path ? `${top.path}.${s}` : s;
        if (top.keys.has(s)) dups.push(path);
        top.keys.add(s);
        top.pending = path;
      }
    } else i++;
  }
  return dups;
}

/**
 * The hooks a parsed manifest declares more than once with the same event, matcher, `if` and command,
 * as readable labels. Takes Claude Code's shape (`hooks: {Event: [{matcher, hooks: [{if, command}]}]}`)
 * and Kimi's (`hooks: [{event, matcher, command}]`).
 */
export function duplicateHooks(manifest) {
  const hooks = manifest?.hooks;
  const flat = Array.isArray(hooks)
    ? hooks.map((h) => [h.event, h.matcher, h.if, h.command])
    : Object.entries(hooks ?? {}).flatMap(([event, groups]) =>
      groups.flatMap((g) => (g.hooks ?? []).map((h) => [event, g.matcher, h.if, h.command])));
  const seen = new Set();
  const dups = [];
  for (const [event, matcher, cond, command] of flat) {
    const label = [event, matcher && `matcher ${matcher}`, cond && `if ${cond}`, command].filter(Boolean).join(" / ");
    if (seen.has(label)) dups.push(label);
    seen.add(label);
  }
  return dups;
}
