import test from "node:test";
import assert from "node:assert/strict";
import { buildCharacterTurnaroundPrompt } from "../src/character-turnaround.ts";

test("character turnaround prompt keeps a fixed front-side-back sheet contract", () => {
  const prompt = buildCharacterTurnaroundPrompt({
    name: "林默",
    notes: "黑色短发，左耳保留银色耳钉",
  });

  assert.match(prompt, /林默/);
  assert.match(prompt, /正面全身、右侧面全身、背面全身/);
  assert.match(prompt, /同一角色、同一发型、同一服装/);
  assert.match(prompt, /黑色短发，左耳保留银色耳钉/);
  assert.match(prompt, /不要加入标题、文字、标签/);
});

test("character turnaround options can relax style and accessory inheritance", () => {
  const prompt = buildCharacterTurnaroundPrompt({
    name: "角色",
    preserveStyle: false,
    includeAccessories: false,
  });

  assert.match(prompt, /更清晰的专业角色设定稿表现/);
  assert.match(prompt, /不额外添加道具/);
  assert.doesNotMatch(prompt, /补充约束：/);
});

