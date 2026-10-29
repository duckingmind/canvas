import assert from "node:assert/strict";
import test from "node:test";
import {
  copiedMediaIdentity,
  copiedMediaFields,
  createEditableCanvasTaskCopy,
  creationInputSignature,
  placeCreatorPanel,
} from "../src/creation-state.ts";
import type { CanvasNode } from "../src/canvas-types.ts";

const input = {
  prompt: "柔和的午后光线",
  model: "image-model",
  references: [{ nodeId: "source", image: "https://example.test/image.png" }],
};

test("duplicating completed video preserves the stable task identity after its signed URL expires", () => {
  const source: CanvasNode = {
    id: "video-source", type: "video", mediaType: "video", title: "生成视频", text: "",
    x: 0, y: 0, width: 360, height: 240, color: "#ccc", video: "https://cdn.test/video.mp4?signature=short-lived",
    taskId: "video-task", status: "completed",
  };
  assert.deepEqual(copiedMediaIdentity(source), { taskId: "video-task", status: "completed" });
});

test("duplicating an existing platform image reuses its asset identity without an upload state", () => {
  const source: CanvasNode = {
    id: "image-source", type: "image", mediaType: "image", title: "平台图片", text: "",
    x: 0, y: 0, width: 360, height: 240, color: "#ccc",
    image: "https://cdn.test/signed-image.png?signature=expired",
    imageThumbnail: "https://cdn.test/signed-thumb.png?signature=expired",
    assetId: "image-asset", status: "completed",
    localImage: "proxy-canvas:image:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.deepEqual(copiedMediaIdentity(source), { assetId: "image-asset", status: "completed" });
  const fields = copiedMediaFields(source);
  assert.equal(fields.assetId, "image-asset");
  assert.equal(fields.image, undefined);
  assert.equal(fields.imageThumbnail, undefined);
  assert.equal(fields.localImage, undefined);
  assert.equal(fields.uploadState, undefined);
});

test("duplicating a durable URL keeps the URL without creating a new asset", () => {
  const source: CanvasNode = {
    id: "image-source", type: "image", mediaType: "image", title: "长期图片", text: "",
    x: 0, y: 0, width: 360, height: 240, color: "#ccc",
    image: "https://cdn.example/image.png", status: "completed",
  };
  assert.deepEqual(copiedMediaIdentity(source), { status: "completed" });
  assert.equal(copiedMediaFields(source).image, source.image);
});

test("duplicating media never treats a temporary URL or local cache as a stable identity", () => {
  const source: CanvasNode = {
    id: "video-source", type: "video", mediaType: "video", title: "本地视频", text: "",
    x: 0, y: 0, width: 360, height: 240, color: "#ccc", localVideo: "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc",
    video: "blob:temporary", status: "completed",
  };
  assert.deepEqual(copiedMediaIdentity(source), {});
  const localImage: CanvasNode = {
    ...source,
    id: "local-image", type: "image", mediaType: "image",
    image: "data:image/png;base64,AAAA", localImage: "proxy-canvas:image:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    localVideo: undefined, video: undefined,
  };
  assert.deepEqual(copiedMediaIdentity(localImage), {});
  assert.equal(copiedMediaFields(localImage).image, undefined);
});

test("uploading media cannot be duplicated until the platform confirms its identity", () => {
  const source: CanvasNode = {
    id: "uploading-image", type: "image", mediaType: "image", title: "上传中", text: "",
    x: 0, y: 0, width: 360, height: 240, color: "#ccc",
    image: "https://cdn.example/image.png", assetId: "pending-asset", uploadState: "uploading",
  };
  assert.deepEqual(copiedMediaIdentity(source), {});
});

test("copied embedded references keep stable IDs and clear transient deliveries and cache keys", () => {
  const source: CanvasNode = {
    id: "prompt-source", type: "prompt", mediaType: "image", title: "提示词", text: "@人物",
    x: 0, y: 0, width: 480, height: 270, color: "#ccc",
    embeddedReferences: [{
      id: "reference", title: "人物", assetId: "reference-asset",
      image: "https://cdn.example/image.png?signature=expired",
      localImage: "proxy-canvas:image:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }],
  };
  const reference = copiedMediaFields(source).embeddedReferences?.[0];
  assert.equal(reference?.assetId, "reference-asset");
  assert.equal(reference?.image, undefined);
  assert.equal(reference?.localImage, undefined);
});

test("copying a creator keeps inputs but clears every old task and result identity", () => {
  const source: CanvasNode = {
    id: "creator-old",
    type: "prompt",
    mediaType: "image",
    title: "图片创作",
    text: "保留这段提示词",
    promptSegments: [{ type: "text", text: "保留这段提示词" }],
    embeddedReferences: [{ id: "reference-old", title: "参考图", image: "https://cdn.test/reference.png" }],
    modelId: "image-model",
    modelSelection: "user",
    imageSettings: { resolution: "2k", aspectRatio: "3:4" },
    x: 10,
    y: 20,
    width: 480,
    height: 270,
    color: "#ccc",
    image: "https://cdn.test/old-result.png",
    imageThumbnail: "https://cdn.test/old-thumb.png",
    assetId: "old-asset",
    taskId: "old-task",
    status: "queued",
    error: "old error",
    taskPrompt: "old frozen prompt",
    taskDiagnostic: { code: "image_submission_not_found" },
    inputSignature: "old-signature",
    submission: { key: "old-key", model: "image-model", prompt: "old frozen prompt", images: [] },
    resultOf: "old-source",
    resultIndex: 0,
  };

  const copy = createEditableCanvasTaskCopy(source, "creator-new");
  assert.equal(copy.id, "creator-new");
  assert.equal(copy.title, "图片创作 · 新任务");
  assert.equal(copy.text, source.text);
  assert.equal(copy.modelId, source.modelId);
  assert.deepEqual(copy.imageSettings, source.imageSettings);
  assert.deepEqual(copy.embeddedReferences, source.embeddedReferences);
  assert.notStrictEqual(copy.embeddedReferences, source.embeddedReferences);
  for (const field of [
    "image", "imageThumbnail", "assetId", "taskId", "status", "error", "taskPrompt",
    "taskDiagnostic", "inputSignature", "submission", "resultOf", "resultIndex",
  ] as const) {
    assert.equal(copy[field], undefined, field);
  }
});

test("input fingerprints track text, model, replacement images and ordered references", () => {
  const initial = creationInputSignature(input);
  for (const changed of [
    { ...input, prompt: "柔和的清晨光线" },
    { ...input, model: "another-model" },
    { ...input, references: [{ nodeId: "source", image: "replacement" }] },
    { ...input, references: [{ nodeId: "other", image: input.references[0].image }] },
    { ...input, references: [] },
  ]) {
    assert.notEqual(creationInputSignature(changed), initial);
  }
  const references = [
    ...input.references,
    { nodeId: "second", image: "second image" },
  ];
  assert.notEqual(
    creationInputSignature({ ...input, references }),
    creationInputSignature({ ...input, references: [...references].reverse() }),
  );
  assert.equal(creationInputSignature(structuredClone(input)), initial);
  assert.equal(creationInputSignature({ ...input, prompt: ` ${input.prompt}\n` }), initial);
});

test("input fingerprints include the frozen image output format", () => {
  const png = creationInputSignature({ ...input, settings: { outputFormat: "png" } });
  const webp = creationInputSignature({ ...input, settings: { outputFormat: "webp" } });
  assert.notEqual(png, webp);
  assert.equal(png, creationInputSignature({ ...input, settings: { outputFormat: "png" } }));
});

test("input fingerprints track local video and audio references", () => {
  const localVideo = "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc";
  const localAudio = "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc";
  const video = creationInputSignature({ ...input, references: [{ nodeId: "video", localVideo }] });
  const audio = creationInputSignature({ ...input, references: [{ nodeId: "audio", localAudio }] });
  assert.notEqual(video, audio);
  assert.notEqual(video, creationInputSignature({ ...input, references: [{ nodeId: "video", localVideo: "replacement" }] }));
});

test("ignored images, layout changes and cached copies do not mark inputs changed", () => {
  const ignored = creationInputSignature({ ...input, ignoreImageRefs: true });
  assert.equal(
    creationInputSignature({
      ...input,
      ignoreImageRefs: true,
      references: [{ nodeId: "replacement", localImage: "cache-2" }],
    }),
    ignored,
  );
  assert.equal(ignored, creationInputSignature({ ...input, references: [] }));
  assert.notEqual(ignored, creationInputSignature(input));
  const moved = {
    ...input,
    x: -240,
    y: 500,
    title: "Renamed node",
    references: [{ ...input.references[0], localImage: "cache", x: 999 }],
  };
  assert.equal(creationInputSignature(moved), creationInputSignature(input));
  assert.equal(
    creationInputSignature({ ...input, references: [{ nodeId: "source", localImage: "a" }] }),
    creationInputSignature({ ...input, references: [{ nodeId: "source", localImage: "b" }] }),
  );
});

test("input fingerprints are compact and distinguish field boundaries", () => {
  const image = `data:image/png;base64,${"A".repeat(500_000)}`;
  const signature = creationInputSignature({
    ...input,
    references: [{ nodeId: "large", image }],
  });
  assert.match(signature, /^v1:[0-9a-f]{16}$/);
  assert.notEqual(
    creationInputSignature({ ...input, prompt: "ab", model: "c" }),
    creationInputSignature({ ...input, prompt: "a", model: "bc" }),
  );
});

test("desktop creator follows the selected image and respects its actual screen dimensions", () => {
  const placement = placeCreatorPanel(
    { x: 340, y: 110, width: 360, height: 180 },
    { width: 1200, height: 900 },
  );
  assert.deepEqual(placement, {
    left: 240,
    top: 304,
    width: 560,
  });
});

test("mobile creator stays centered on the selected node", () => {
  const placement = placeCreatorPanel(
    { x: 100, y: 30, width: 240, height: 180 },
    { width: 390, height: 844 },
  );
  assert.deepEqual(placement, {
    left: 37,
    top: 224,
    width: 366,
  });
});

test("panned nodes keep the creator attached instead of viewport clamping", () => {
  for (const width of [390, 700, 901, 1200]) {
    for (const height of [390, 720]) {
      for (const x of [-3000, -100, 200, 3000]) {
        for (const y of [-3000, -100, 200, 3000]) {
          const placement = placeCreatorPanel(
            { x, y, width: 400, height: 230 },
            { width, height },
          );
          const expectedCenter = x + 200;
          assert.equal(placement.left + placement.width / 2, expectedCenter);
          assert.equal(placement.top, y + 230 + 14);
        }
      }
    }
  }
});

test("board height does not compress or reposition the editor", () => {
  const initial = placeCreatorPanel(
    { x: 700, y: 500, width: 320, height: 180 },
    { width: 901, height: 720 },
    { width: 620 },
  );
  assert.deepEqual(initial, { left: 550, top: 694, width: 620 });
  for (const height of [80, 390, 900, 2000]) {
    assert.deepEqual(placeCreatorPanel(
      { x: 700, y: 500, width: 320, height: 180 },
      { width: 901, height },
      { width: 620 },
    ), initial);
  }
});

test("placement handles tiny boards and invalid dimensions safely", () => {
  for (const board of [
    { width: 390, height: 80 },
    { width: 10, height: 10 },
    { width: NaN, height: Infinity },
  ]) {
    const placement = placeCreatorPanel(
      { x: NaN, y: Infinity, width: -1, height: -1 },
      board,
    );
    for (const field of ["left", "top", "width"] as const) {
      assert.ok(Number.isFinite(placement[field]));
    }
    assert.ok(placement.width >= 0);
  }
});

test("screen-space creator placement uses the zoomed node anchor but keeps a fixed panel size", () => {
  const atZoomOut = placeCreatorPanel({ x: 420, y: 180, width: 160, height: 120 }, { width: 1200, height: 800 }, { width: 540 });
  const atZoomIn = placeCreatorPanel({ x: 840, y: 360, width: 320, height: 240 }, { width: 1200, height: 800 }, { width: 540 });
  assert.deepEqual(atZoomOut, { left: 230, top: 314, width: 540 });
  assert.deepEqual(atZoomIn, { left: 730, top: 614, width: 540 });
});

test("editor position tracks node pan deltas in screen space", () => {
  const before = placeCreatorPanel(
    { x: 180, y: 120, width: 240, height: 100 },
    { width: 1200, height: 900 },
    { width: 500 },
  );
  const after = placeCreatorPanel(
    { x: 245, y: 165, width: 240, height: 100 },
    { width: 1200, height: 900 },
    { width: 500 },
  );
  assert.equal(after.left - before.left, 65);
  assert.equal(after.top - before.top, 45);
});

test("editor remains below the target when the target is near the bottom edge", () => {
  const placement = placeCreatorPanel(
    { x: 300, y: 700, width: 240, height: 120 },
    { width: 1200, height: 900 },
    { width: 500 },
  );
  assert.equal(placement.top, 834);
  assert.deepEqual(placement, { left: 170, top: 834, width: 500 });
});
