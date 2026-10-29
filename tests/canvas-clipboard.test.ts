import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasNode } from "../src/canvas-types.ts";
import {
  parseCanvasNodeClipboard,
  readCanvasClipboard,
  refreshCanvasClipboardNodes,
  remapCopiedNodeReferences,
  serializeCanvasNodes,
} from "../src/canvas-clipboard.ts";

function node(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: "prompt-a",
    type: "prompt",
    title: "创作节点",
    text: "@人物",
    x: 0,
    y: 0,
    width: 480,
    height: 270,
    color: "#fff",
    embeddedReferences: [{ id: "ref-a", title: "人物", image: "data:image/png;base64,YQ==" }],
    promptSegments: [{ type: "reference", referenceId: "ref-a", label: "人物" }],
    ...overrides,
  };
}

test("canvas clipboard reads supported files before plain text and deduplicates file entries", () => {
  const image = new File([new Uint8Array([1, 2, 3])], "clip.png", { type: "image/png" });
  const payload = readCanvasClipboard({
    items: [{ kind: "string", getAsFile: () => null }, { kind: "file", getAsFile: () => image }],
    files: [image],
    getData: () => "surrounding description",
  } as unknown as DataTransfer);
  assert.deepEqual(payload, { kind: "files", files: [image] });
});

test("plain text is a supported canvas clipboard payload", () => {
  assert.deepEqual(readCanvasClipboard({
    items: [],
    files: [],
    getData: (type: string) => type === "text/plain" ? "pasted idea" : "",
  } as unknown as DataTransfer), { kind: "text", text: "pasted idea" });
});

test("copied embedded references and inline prompt references receive matching fresh IDs", () => {
  const original = node();
  const ids = new Map([[original.id, "prompt-copy"]]);
  let sequence = 0;
  const [copy] = remapCopiedNodeReferences([original], ids, () => `ref-copy-${++sequence}`);
  assert.equal(copy.id, original.id, "the helper only repairs references; node IDs are applied by the caller");
  assert.equal(copy.embeddedReferences?.[0].id, "ref-copy-1");
  assert.deepEqual(copy.promptSegments, [{ type: "reference", referenceId: "ref-copy-1", label: "人物" }]);
  assert.equal(original.embeddedReferences?.[0].id, "ref-a", "the source document is not mutated");
});

test("prompt segments that reference copied canvas nodes follow the new node IDs", () => {
  const source = node({
    embeddedReferences: undefined,
    promptSegments: [{ type: "reference", referenceId: "image-a", label: "原图" }],
  });
  const [copy] = remapCopiedNodeReferences([source], new Map([["image-a", "image-copy"]]), () => "unused");
  assert.deepEqual(copy.promptSegments, [{ type: "reference", referenceId: "image-copy", label: "原图" }]);
});

test("same-canvas paste refreshes a copied node to its newest regenerated media", () => {
  const copied = node({ id: "result", type: "image", image: "https://cdn.example/old.png", assetId: "asset-old" });
  const latest = { ...copied, image: "https://cdn.example/latest.png", assetId: "asset-latest", taskId: "task-latest" };

  const refreshed = refreshCanvasClipboardNodes([copied], "canvas-a", "canvas-a", [latest]);

  assert.equal(refreshed[0], latest);
  assert.equal(refreshed[0].image, "https://cdn.example/latest.png");
  assert.equal(refreshed[0].assetId, "asset-latest");
  assert.equal(refreshed[0].taskId, "task-latest");
});

test("cross-canvas paste keeps the copied snapshot and deleted nodes remain recoverable", () => {
  const copied = node({ id: "result", type: "image", image: "https://cdn.example/copied.png" });
  const elsewhere = { ...copied, image: "https://cdn.example/other-canvas.png" };

  const crossCanvas = refreshCanvasClipboardNodes([copied], "canvas-a", "canvas-b", [elsewhere]);
  const unknownOrigin = refreshCanvasClipboardNodes([copied], undefined, "canvas-a", [elsewhere]);
  const deleted = refreshCanvasClipboardNodes([copied], "canvas-a", "canvas-a", []);

  assert.equal(crossCanvas[0], copied);
  assert.equal(unknownOrigin[0], copied);
  assert.equal(deleted[0], copied);
});

test("serialized canvas clipboard carries its document identity while legacy arrays remain readable", () => {
  const copied = node();
  assert.deepEqual(parseCanvasNodeClipboard(serializeCanvasNodes([copied], "canvas-a")), {
    documentId: "canvas-a",
    nodes: [copied],
  });
  assert.deepEqual(parseCanvasNodeClipboard(JSON.stringify([copied])), { nodes: [copied] });
});
