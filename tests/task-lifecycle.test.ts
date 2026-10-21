import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMediaReferences,
  normalizeVideoSubmission,
  resolveTaskId,
  taskRecoveryKey,
} from "../src/task-lifecycle.ts";

test("task IDs migrate legacy video aliases and reject malformed values", () => {
  assert.equal(resolveTaskId({ taskId: "task-1" }), "task-1");
  assert.equal(resolveTaskId({ videoTaskId: "video-1" }), "video-1");
  assert.equal(resolveTaskId({ video_task_id: "video-2" }), "video-2");
  assert.equal(resolveTaskId({ taskId: "../outside", videoTaskId: "ok" }), "ok");
  assert.equal(resolveTaskId({ taskId: "../outside" }), undefined);
});

test("video submission snapshots normalize old strings and gateway references", () => {
  assert.deepEqual(normalizeMediaReferences([
    "https://cdn.test/a.png",
    { image_url: { url: "https://cdn.test/b.png" } },
    { localImage: "proxy-canvas:image:sha256:abc" },
    null,
  ]), [
    { image: "https://cdn.test/a.png" },
    { image: "https://cdn.test/b.png" },
    { localImage: "proxy-canvas:image:sha256:abc" },
  ]);
  assert.deepEqual(normalizeVideoSubmission({
    key: "video-submit",
    model: "video-model",
    prompt: "a cat",
    input_references: [{ type: "image_url", image_url: { url: "https://cdn.test/c.png" } }],
    generate_audio: false,
  }), {
    key: "video-submit",
    model: "video-model",
    prompt: "a cat",
    images: [{ image: "https://cdn.test/c.png" }],
    generate_audio: false,
  });
});

test("video submission normalization accepts asset-only typed references", () => {
  assert.deepEqual(normalizeVideoSubmission({
    key: "video-submit",
    model: "video-model",
    prompt: "animate",
    references: [
      { type: "video_url", assetId: "asset-video", mediaType: "video" },
      { type: "audio_url", assetId: "asset-audio", mediaType: "audio" },
    ],
  })?.references, [
    { type: "video_url", assetId: "asset-video", mediaType: "video" },
    { type: "audio_url", assetId: "asset-audio", mediaType: "audio" },
  ]);
});

test("task recovery keys isolate canvas, node and retry identity", () => {
  assert.notEqual(
    taskRecoveryKey("canvas-a", "node-1", "task-1"),
    taskRecoveryKey("canvas-b", "node-1", "task-1"),
  );
  assert.notEqual(
    taskRecoveryKey("canvas-a", "node-1", "task-1"),
    taskRecoveryKey("canvas-a", "node-1", "task-2"),
  );
  assert.equal(
    taskRecoveryKey("canvas-a", "node-1", undefined, "submit-1"),
    taskRecoveryKey("canvas-a", "node-1", undefined, "submit-1"),
  );
});
