import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { duplicateKeys } from "../../scripts/json-keys.mjs";

test("a hook event named twice is reported (the hooks.json a merge left at 18c9a17)", () => {
  const text = execFileSync("git", ["show", "18c9a17:xwiki/hooks/hooks.json"], { encoding: "utf8" });
  assert.deepEqual(duplicateKeys(text), ["hooks.UserPromptSubmit"]);
});

test("equal keys in different objects, and keys inside strings, are not duplicates", () => {
  const text = '{"a": {"x": 1}, "b": {"x": 2}, "c": ["{\\"a\\": 1}", {"a": "\\"a\\":"}]}';
  assert.deepEqual(duplicateKeys(text), []);
});

test("a repeat nested in an array element is reported with its path", () => {
  assert.deepEqual(duplicateKeys('{"hooks": [{"type": "a", "type": "b"}]}'), ["hooks.type"]);
});
