import assert from "node:assert/strict";
import test from "node:test";
import { normalizePromptSegments, promptSegmentsText } from "../src/prompt-segments.ts";

test("empty or invalid saved segments fall back to the legacy prompt text", () => {
  assert.deepEqual(normalizePromptSegments([], "legacy prompt"), [
    { type: "text", text: "legacy prompt" },
  ]);
  assert.deepEqual(normalizePromptSegments([{ type: "reference", referenceId: "", label: "bad" }], "legacy prompt"), [
    { type: "text", text: "legacy prompt" },
  ]);
});

test("legacy prompt fallback remains bounded", () => {
  assert.equal(normalizePromptSegments([], "x".repeat(20_100))[0]?.type, "text");
  assert.equal((normalizePromptSegments([], "x".repeat(20_100))[0] as { text: string }).text.length, 20_000);
});

test("prompt text keeps reference labels in sequence", () => {
  assert.equal(promptSegmentsText([
    { type: "text", text: "保留构图 " },
    { type: "reference", referenceId: "image-1", label: "主角" },
    { type: "text", text: "，使用 " },
    { type: "reference", referenceId: "image-2", label: "雪夜" },
  ]), "保留构图 @主角，使用 @雪夜");
});
