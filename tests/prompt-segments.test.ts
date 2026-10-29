import assert from "node:assert/strict";
import test from "node:test";
import { isGenericImageFilename, normalizePromptSegments, promptReferenceDisplayLabel, promptSegmentsText, readablePromptText } from "../src/prompt-segments.ts";

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

test("compact cloud prompts rebuild their readable text from structured segments", () => {
  assert.equal(readablePromptText("", [
    { type: "text", text: "保持构图 " },
    { type: "reference", referenceId: "image-1", label: "主角" },
  ]), "保持构图 @主角");
});

test("opaque reference IDs are replaced with readable labels while identity is preserved", () => {
  const id = "47252581-772a-4614-8612-2ab169e3f11a";
  const segments = normalizePromptSegments([
    { type: "reference", referenceId: id, label: id },
    { type: "text", text: " 与 " },
    { type: "reference", referenceId: "asset:705fbefeae624f0f86f12345", label: "asset:705fbefeae624f0f86f12345" },
  ]);
  assert.deepEqual(segments, [
    { type: "reference", referenceId: id, label: "参考图 1" },
    { type: "text", text: " 与 " },
    { type: "reference", referenceId: "asset:705fbefeae624f0f86f12345", label: "参考图 2" },
  ]);
  assert.equal(promptSegmentsText(segments), "@参考图 1 与 @参考图 2");
  assert.equal(promptReferenceDisplayLabel(id, id, 1), "参考图 1");
  assert.equal(promptReferenceDisplayLabel("素材库参考图", "library-node", 2), "素材库参考图");
});

test("generic image filenames add no visual label beside a usable thumbnail", () => {
  for (const label of ["image.png", "img_2.jpeg", "photo-12.webp", "C:\\Uploads\\picture 1.jpg"]) {
    assert.equal(isGenericImageFilename(label), true, label);
  }
  for (const label of ["孙悟空.png", "海边场景.webp", "image-reference-final.png", "参考图 1"]) {
    assert.equal(isGenericImageFilename(label), false, label);
  }
});
