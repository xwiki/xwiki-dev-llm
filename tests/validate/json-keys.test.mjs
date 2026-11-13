import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateHooks, duplicateKeys } from "../../scripts/json-keys.mjs";

test("a hook event named twice is reported (the shape a merge once left in hooks.json)", () => {
  const text = `{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \\"\${CLAUDE_PLUGIN_ROOT}/scripts/kb-hooks.mjs\\" prompt" }] }
    ],
    "PostToolUse": [
      { "matcher": "Skill", "hooks": [{ "type": "command", "command": "node \\"\${CLAUDE_PLUGIN_ROOT}/scripts/skill-gate.mjs\\"" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \\"\${CLAUDE_PLUGIN_ROOT}/scripts/skill-gate.mjs\\"" }] }
    ]
  }
}`;
  assert.deepEqual(duplicateKeys(text), ["hooks.UserPromptSubmit"]);
});

test("equal keys in different objects, and keys inside strings, are not duplicates", () => {
  const text = '{"a": {"x": 1}, "b": {"x": 2}, "c": ["{\\"a\\": 1}", {"a": "\\"a\\":"}]}';
  assert.deepEqual(duplicateKeys(text), []);
});

test("a repeat nested in an array element is reported with its path", () => {
  assert.deepEqual(duplicateKeys('{"hooks": [{"type": "a", "type": "b"}]}'), ["hooks.type"]);
});

test("a hook declared twice in one matcher group is reported (the shape a merge once left in hooks.json)", () => {
  const diff = { type: "command", if: "Bash(git *)", command: "node check-diff.mjs", timeout: 15 };
  const manifest = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [
    diff, { type: "command", if: "Bash(git commit*)", command: "node check-commit-text.mjs" }, { ...diff },
  ] }] } };
  assert.deepEqual(duplicateHooks(manifest), ["PreToolUse / matcher Bash / if Bash(git *) / node check-diff.mjs"]);
});

test("a hook repeated across two groups with the same matcher is reported", () => {
  const group = () => ({ matcher: "Skill", hooks: [{ type: "command", command: "node skill-gate.mjs" }] });
  assert.equal(duplicateHooks({ hooks: { PostToolUse: [group(), group()] } }).length, 1);
});

test("the same command under another event, matcher or if is not a duplicate", () => {
  const h = (cond) => ({ type: "command", if: cond, command: "node check-commit-text.mjs" });
  const manifest = { hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [h("Bash(git commit*)"), h("Bash(gh pr*)")] }, { matcher: "Edit", hooks: [h()] }],
    PostToolUse: [{ matcher: "Bash", hooks: [h("Bash(git commit*)")] }],
  } };
  assert.deepEqual(duplicateHooks(manifest), []);
});

test("Kimi's flat hook list is checked the same way", () => {
  const h = (event) => ({ event, matcher: "Bash", command: "node check-diff.mjs" });
  assert.deepEqual(duplicateHooks({ hooks: [h("PreToolUse"), h("PostToolUse"), h("PreToolUse")] }),
    ["PreToolUse / matcher Bash / node check-diff.mjs"]);
});
