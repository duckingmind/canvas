import assert from "node:assert/strict";
import test from "node:test";
import {
  composePrompt,
  findFreePosition,
  isWorkflowTextReference,
  type WorkflowNode,
} from "../src/workflow.ts";

const node = (
  id: string,
  type: WorkflowNode["type"] = "note",
  text = id,
): WorkflowNode => ({ id, type, title: id, text });
const edge = (from: string, to: string) => ({ from, to });
const rect = (x: number, y: number, width = 300, height = 180) => ({
  x,
  y,
  width,
  height,
});

test("text reference eligibility excludes generated image prompts and empty nodes", () => {
  assert.equal(isWorkflowTextReference(node("note", "note", "说明")), true);
  assert.equal(isWorkflowTextReference(node("prompt", "prompt", "提示词")), true);
  assert.equal(isWorkflowTextReference(node("empty", "note", "  ")), false);
  assert.equal(isWorkflowTextReference({
    ...node("generated", "prompt", "原始提示词"),
    image: "https://example.test/generated.png",
  }), false);
  assert.equal(isWorkflowTextReference({
    ...node("local-generated", "prompt", "原始提示词"),
    localImage: "proxy-canvas:image:sha256:generated",
  }), true);
});

test("prompt composition includes upstream dependencies once in order and excludes downstream and unrelated content", () => {
  const nodes = [
    node("brief"),
    node("style"),
    node("detail", "prompt"),
    node("target", "prompt"),
    node("later"),
    node("other"),
  ];
  const edges = [
    edge("brief", "style"),
    edge("brief", "detail"),
    edge("style", "target"),
    edge("detail", "target"),
    edge("detail", "target"),
    edge("target", "later"),
  ];
  const before = structuredClone({ nodes, edges });
  const result = composePrompt(nodes, edges, "target");
  assert.equal(result.prompt, "brief\n\nstyle\n\ndetail\n\ntarget");
  assert.deepEqual(
    result.textReferences.map((reference) => reference.nodeId),
    ["brief", "style", "detail"],
  );
  assert.deepEqual({ nodes, edges }, before);
});

test("one persisted edge relation feeds prompt composition", () => {
  const result = composePrompt(
    [
      { ...node("image", "image"), title: "Image", image: "https://cdn.example/image.png" },
      { ...node("target", "prompt", "Create"), title: "Target" },
    ],
    [
      { from: "image", to: "target" },
    ],
    "target",
  );
  assert.deepEqual(result.imageReferences.map((reference) => reference.nodeId), ["image"]);
  assert.equal(result.prompt, "Create");
});

test("cycles, self edges and missing nodes cannot repeat the selected prompt or its sources", () => {
  const result = composePrompt(
    [node("a"), node("b"), node("target", "prompt")],
    [
      edge("a", "b"),
      edge("b", "a"),
      edge("b", "target"),
      edge("target", "a"),
      edge("target", "target"),
      edge("missing", "target"),
    ],
    "target",
  );
  assert.equal(result.prompt, "a\n\nb\n\ntarget");
  assert.equal(
    new Set(result.textReferences.map((reference) => reference.nodeId)).size,
    2,
  );
});

test("image dependencies including unloaded images remain visible and image metadata is not used as prompt text", () => {
  const result = composePrompt(
    [
      {
        ...node("image", "image", "old generation prompt"),
        image: "https://example.test/image.png",
      },
      { ...node("missing", "image"), localImage: "local-id" },
      node("empty", "note", "  "),
      node("target", "prompt", "  new prompt  "),
    ],
    [
      edge("image", "target"),
      edge("image", "target"),
      edge("missing", "target"),
      edge("empty", "target"),
    ],
    "target",
  );
  assert.equal(result.prompt, "new prompt");
  assert.deepEqual(result.textReferences, []);
  assert.deepEqual(result.imageReferences, [
    {
      nodeId: "image",
      title: "image",
      image: "https://example.test/image.png",
    },
  ]);
  assert.deepEqual(composePrompt([], [], "unknown"), {
    prompt: "",
    textReferences: [],
    imageReferences: [],
    videoReferences: [],
  });
});

test("video dependencies are exposed separately from image references", () => {
  const result = composePrompt([
    { ...node("video", "video"), mediaType: "video", video: "https://cdn.example/video.mp4" },
    { ...node("image", "image"), image: "https://cdn.example/image.png" },
    node("target", "prompt", "animate both"),
  ], [edge("video", "target"), edge("image", "target")], "target");
  assert.deepEqual(result.videoReferences, [{ nodeId: "video", title: "video", mediaType: "video", video: "https://cdn.example/video.mp4" }]);
  assert.deepEqual(result.imageReferences, [{ nodeId: "image", title: "image", image: "https://cdn.example/image.png" }]);
});

test("video dependencies preserve the referenced media type for asset recovery", () => {
  const result = composePrompt([
    { ...node("video", "video"), mediaType: "video", assetId: "asset-video" },
    { ...node("audio", "audio"), type: "audio", mediaType: "audio", assetId: "asset-audio" },
    { ...node("target", "prompt", "use both"), mediaType: "video" },
  ], [edge("video", "target"), edge("audio", "target")], "target");
  assert.deepEqual(result.videoReferences, [
    { nodeId: "video", title: "video", mediaType: "video", assetId: "asset-video" },
    { nodeId: "audio", title: "audio", mediaType: "audio", assetId: "asset-audio" },
  ]);
});

test("local extracted video and audio dependencies remain explicit video references", () => {
  const result = composePrompt([
    { ...node("local-video", "video"), mediaType: "video", localVideo: "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc" },
    { ...node("local-audio", "audio"), mediaType: "audio", localAudio: "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc" },
    { ...node("target", "prompt", "continue"), mediaType: "video" },
  ], [edge("local-video", "target"), edge("local-audio", "target")], "target");
  assert.deepEqual(result.videoReferences, [
    { nodeId: "local-video", title: "local-video", mediaType: "video", localVideo: "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc" },
    { nodeId: "local-audio", title: "local-audio", mediaType: "audio", localAudio: "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc" },
  ]);
});

test("local extracted video and audio references survive embedded composition", () => {
  const result = composePrompt([{
    ...node("target", "prompt", "continue"),
    mediaType: "video",
    embeddedReferences: [
      { id: "local-video", title: "clip", localVideo: "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc" },
      { id: "local-audio", title: "sound", localAudio: "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc" },
    ],
  }], [], "target");
  assert.deepEqual(result.videoReferences, [
    { nodeId: "local-video", title: "clip", mediaType: "video", localVideo: "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc" },
    { nodeId: "local-audio", title: "sound", mediaType: "audio", localAudio: "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc" },
  ]);
});

test("referencing extracted media uses only that result and deduplicates its local bytes", () => {
  const localVideo = "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc";
  const result = composePrompt([
    node("brief", "note", "old generation brief"),
    { ...node("source", "video"), video: "https://cdn.example/source.mp4" },
    { ...node("extract", "video"), localVideo },
    { ...node("copy", "video"), localVideo },
    { ...node("target", "prompt", "use this result"), mediaType: "video" },
  ], [edge("brief", "source"), edge("source", "extract"), edge("extract", "target"), edge("copy", "target")], "target");
  assert.equal(result.prompt, "use this result");
  assert.deepEqual(result.textReferences, []);
  assert.deepEqual(result.videoReferences, [{ nodeId: "extract", title: "extract", mediaType: "video", localVideo }]);
});

test("inline prompt references resolve to canvas media without putting media URLs in prompt text", () => {
  const result = composePrompt([
    { ...node("hero", "image", "hero source"), title: "主角", image: "https://cdn.example/hero.png" },
    { ...node("scene", "image", "scene source"), title: "雪夜", localImage: "proxy-canvas:image:scene" },
    {
      ...node("target", "prompt"),
      text: "保持构图 @主角",
      promptSegments: [
        { type: "text", text: "保持构图 " },
        { type: "reference", referenceId: "hero", label: "主角" },
        { type: "text", text: "，加入雪夜" },
        { type: "reference", referenceId: "scene", label: "雪夜" },
      ],
    },
  ], [edge("hero", "target")], "target");
  assert.equal(result.prompt, "保持构图 @主角，加入雪夜@雪夜");
  assert.deepEqual(result.imageReferences.map(reference => reference.nodeId), ["hero"]);
  assert.equal(result.prompt.includes("https://cdn.example/hero.png"), false);
});

test("video dependencies preserve audio references alongside video and image inputs", () => {
  const result = composePrompt([
    { ...node("image", "image"), image: "https://cdn.example/image.png" },
    { ...node("audio", "audio"), type: "audio", audio: "https://cdn.example/audio.mp3" },
    { ...node("video", "video"), type: "video", mediaType: "video", video: "https://cdn.example/video.mp4" },
    { ...node("target", "prompt", "animate with sound") , mediaType: "video" },
  ], [edge("image", "target"), edge("audio", "target"), edge("video", "target")], "target");
  assert.deepEqual(result.videoReferences, [
    { nodeId: "audio", title: "audio", mediaType: "audio", audio: "https://cdn.example/audio.mp3" },
    { nodeId: "video", title: "video", mediaType: "video", video: "https://cdn.example/video.mp4" },
  ]);
  assert.deepEqual(result.imageReferences, [{ nodeId: "image", title: "image", image: "https://cdn.example/image.png" }]);
});

test("creator uploads compose as embedded COS image references without graph nodes", () => {
  const result = composePrompt(
    [
      {
        ...node("target", "prompt", "edit this image"),
        embeddedReferences: [{ id: "upload-1", title: "reference.png", image: "https://cos.example/reference.png" }],
      },
    ],
    [],
    "target",
  );
  assert.equal(result.prompt, "edit this image");
  assert.deepEqual(result.imageReferences, [{
    nodeId: "upload-1",
    title: "reference.png",
    embedded: true,
    image: "https://cos.example/reference.png",
  }]);
});

test("local embedded references are excluded until uploaded to COS", () => {
  const result = composePrompt(
    [{
      ...node("target", "prompt", "edit this"),
      embeddedReferences: [{ id: "local-upload", title: "local.png", localImage: "proxy-canvas:image:sha256:local" }],
    }],
    [],
    "target",
  );
  assert.deepEqual(result.imageReferences, []);
});

test("embedded and canvas references share one image identity in the composed request", () => {
  const result = composePrompt(
    [
      {
        ...node("target", "prompt", "keep the composition"),
        embeddedReferences: [{ id: "upload-1", title: "uploaded.png", image: "https://cos.example/same.png" }],
      },
      { ...node("canvas-image", "image"), image: "https://cos.example/same.png" },
    ],
    [edge("canvas-image", "target")],
    "target",
  );
  assert.deepEqual(result.imageReferences.map((reference) => reference.nodeId), ["upload-1"]);
  assert.equal(result.imageReferences[0]?.embedded, true);
});

test("the same image URL connected through multiple nodes is exposed once", () => {
  const nodes = [
    { ...node("first", "image"), image: "https://cos.example/same.png" },
    { ...node("second", "image"), image: "https://cos.example/same.png" },
    node("target", "prompt", "make a video"),
  ];
  const result = composePrompt(nodes, [edge("first", "target"), edge("second", "target")], "target");
  assert.deepEqual(result.imageReferences.map((reference) => reference.nodeId), ["first"]);
});

test("continuing from a generated result does not replay historical text or accumulate historical images", () => {
  const previousPrompt = "一座图书馆，暖色灯光";
  const nextPrompt = `${previousPrompt}，增加雨景`;
  const nodes = [
    node("original-brief", "note", "一座图书馆"),
    {
      ...node("original-image", "image"),
      image: "https://example.test/original.png",
    },
    node("original-prompt", "prompt", "暖色灯光"),
    {
      ...node("result", "image", previousPrompt),
      image: "https://example.test/result.png",
    },
    node("new-brief", "note", "竖版构图"),
    node("next-prompt", "prompt", nextPrompt),
  ];
  const edges = [
    edge("original-brief", "original-prompt"),
    edge("original-image", "original-prompt"),
    edge("original-prompt", "result"),
    edge("result", "next-prompt"),
    edge("new-brief", "next-prompt"),
  ];
  const result = composePrompt(nodes, edges, "next-prompt");
  assert.equal(result.prompt, `竖版构图\n\n${nextPrompt}`);
  assert.deepEqual(
    result.textReferences.map((reference) => reference.nodeId),
    ["new-brief"],
  );
  assert.deepEqual(
    result.imageReferences.map((reference) => reference.nodeId),
    ["result"],
  );

  // A user can still intentionally connect an earlier image to the new task.
  const explicit = composePrompt(
    nodes,
    [...edges, edge("original-image", "next-prompt")],
    "next-prompt",
  );
  assert.deepEqual(
    explicit.imageReferences.map((reference) => reference.nodeId),
    ["result", "original-image"],
  );
});

test("long upstream chains do not overflow the call stack", () => {
  const nodes = Array.from({ length: 12000 }, (_, index) =>
    node(String(index), "prompt"),
  );
  const result = composePrompt(
    nodes,
    nodes.slice(1).map((item, index) => edge(nodes[index].id, item.id)),
    "11999",
  );
  assert.equal(result.textReferences.length, 11999);
  assert.equal(result.textReferences[0].nodeId, "0");
  assert.ok(result.prompt.endsWith("\n\n11999"));
});

test("placement preserves a free requested point and finds a nearby gap using actual sizes", () => {
  assert.deepEqual(findFreePosition([rect(500, 500)], rect(-100, -100)), {
    x: -100,
    y: -100,
  });
  assert.deepEqual(findFreePosition([rect(0, 0)], rect(40, 40)), {
    x: 40,
    y: 212,
  });
  assert.deepEqual(findFreePosition([rect(0, 0)], rect(332, 0)), {
    x: 332,
    y: 0,
  });
});

test("repeated placement in a dense negative-coordinate scene respects spacing without mutating inputs", () => {
  const occupied = [rect(-400, -300, 500, 300), rect(132, -300, 180, 600)];
  const original = structuredClone(occupied);
  const desired = rect(-350, -240, 250, 120);
  const first = findFreePosition(occupied, desired, 24);
  assert.deepEqual(occupied, original);
  assert.deepEqual(
    findFreePosition([...occupied].reverse(), desired, 24),
    first,
  );
  for (let count = 0; count < 100; count++) {
    const next = { ...desired, ...findFreePosition(occupied, desired, 24) };
    for (const other of occupied) {
      assert.ok(
        next.x >= other.x + other.width + 24 ||
          other.x >= next.x + next.width + 24 ||
          next.y >= other.y + other.height + 24 ||
          other.y >= next.y + next.height + 24,
      );
    }
    occupied.push(next);
  }
});
