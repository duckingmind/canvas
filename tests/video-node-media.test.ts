import assert from "node:assert/strict";
import test from "node:test";
import { canReuseVideoContent, replaceVideoNodeMedia, sameVideoNodeSource, videoAutoRecoveryKey, VideoAutoRecoveryGuard, VideoNodeSourceGuard } from "../src/video-node-media.ts";
import type { CanvasNode } from "../src/canvas-types.ts";

const node: CanvasNode = {
  id: "video-1", type: "video", title: "Original", text: "A useful note", x: 40, y: 70,
  width: 400, height: 225, color: "#f88", video: "data:video/mp4;base64,b2xk", groupId: "group-1",
};

test("video extraction reuses only durable references and materializes inline or temporary media", () => {
  assert.equal(canReuseVideoContent({ localVideo: "proxy-canvas:video:v1:local" }), true);
  assert.equal(canReuseVideoContent({ assetId: "asset-1", video: "https://cdn.test/video.mp4" }), true);
  assert.equal(canReuseVideoContent({ assetId: "asset-1", video: "data:video/mp4;base64,AAAA", videoContentUrl: "https://cdn.test/video.mp4" }), false);
  assert.equal(canReuseVideoContent({ taskId: "task-1", status: "completed", videoContentUrl: "/videos/task-1/content" }), true);
  assert.equal(canReuseVideoContent({ videoContentUrl: "/videos/task-1/content", status: "completed" }), true);
  assert.equal(canReuseVideoContent({ taskId: "task-1", status: "queued", videoContentUrl: "/videos/task-1/content" }), false);
  assert.equal(canReuseVideoContent({ assetId: "asset-1", video: "data:video/mp4;base64,AAAA" }), false);
  assert.equal(canReuseVideoContent({ video: "blob:temporary-video" }), false);
  assert.equal(canReuseVideoContent({ video: "https://cdn.test/temporary.mp4" }), false);
});

test("source identity ignores layout, title and poster changes", () => {
  assert.equal(sameVideoNodeSource(node, { ...node, title: "Renamed", x: 100, videoPoster: "cover" } as CanvasNode), true);
  for (const patch of [
    { video: "new" }, { videoContentUrl: "/new/content" }, { taskId: "new-task" }, { assetId: "new-asset" },
    { id: "other" }, { type: "prompt" as const },
  ]) assert.equal(sameVideoNodeSource(node, { ...node, ...patch }), false);
  assert.equal(sameVideoNodeSource(node, undefined), false);
});

test("automatic recovery budget survives a signed URL remount", () => {
  const guard = new VideoAutoRecoveryGuard();
  const key = videoAutoRecoveryKey({ id: "video-1", assetId: "asset-1", taskId: "task-1", video: undefined });
  assert.equal(guard.tryRecover("video-1", key), true);
  assert.equal(guard.tryRecover("video-1", key), false);
  assert.equal(guard.tryRecover("video-1", `${key}-replacement`), true);
  guard.retain([{ id: "video-1", recoveryKey: `${key}-replacement` }]);
  assert.equal(guard.tryRecover("video-1", `${key}-replacement`), false);
  guard.retain([]);
  assert.equal(guard.tryRecover("video-1", key), true);
});

test("source guard rejects another document, deleted nodes, and replaced sources", () => {
  const guard = new VideoNodeSourceGuard();
  const token = guard.capture("canvas-1", node);
  assert.equal(guard.capture("canvas-1", { ...node, title: "Renamed" }), token);
  assert.equal(guard.isCurrent(token, "canvas-1", node), true);
  assert.equal(guard.isCurrent(token, "canvas-2", node), false);
  assert.equal(guard.isCurrent(token, "canvas-1", undefined), false);
  assert.equal(guard.isCurrent(token, "canvas-1", { ...node, video: "replacement" }), false);
  const replacement = guard.capture("canvas-1", { ...node, video: "replacement" });
  assert.notEqual(replacement, token);
  assert.equal(guard.isCurrent(token, "canvas-1", node), false, "old async work cannot reclaim a reused id");
});

test("explicit replacement invalidates pending work even when the new file has identical bytes", () => {
  const guard = new VideoNodeSourceGuard();
  const token = guard.capture("canvas-1", node);
  guard.invalidate(node.id);
  const replacement = guard.capture("canvas-1", node);
  assert.notEqual(replacement, token);
  assert.equal(guard.isCurrent(token, "canvas-1", node), false);
  assert.equal(guard.isCurrent(replacement, "canvas-1", node), true);
});

test("reconciliation invalidates removal and document switches while preserving harmless edits", () => {
  const guard = new VideoNodeSourceGuard();
  const token = guard.capture("canvas-1", node);
  assert.deepEqual(guard.invalidateStale("canvas-1", [{ ...node, title: "Renamed" }]), []);
  assert.deepEqual(guard.invalidateStale("canvas-1", []), [node.id]);
  guard.capture("canvas-1", node);
  assert.equal(guard.isCurrent(token, "canvas-1", node), false, "undoing deletion must not revive old work");
  assert.deepEqual(guard.invalidateStale("canvas-2", [node]), [node.id]);
});

test("replacement preserves layout and notes while clearing all task, asset, poster and image state", () => {
  const previous: CanvasNode = {
    ...node, image: "old-image", audio: "old-audio", localImage: "cached-image", videoPoster: "old-cover",
    localVideoPoster: "cached-cover", videoContentUrl: "/old/content", assetId: "old-asset", taskId: "old-task",
    taskPrompt: "prompt", status: "completed", resultOf: "creator", resultIndex: 2, resultBatchId: "batch",
    taskDiagnostic: { status: "completed" }, inputSignature: "old-signature", modelId: "old-model",
    videoDuration: 20, videoSettings: { duration: 20 }, videoPollingPaused: true, videoPollingReason: "user",
    error: "old-error", mediaType: "video", operationId: "old-operation", operationParams: { old: true },
    submission: { key: "old", model: "old-model", prompt: "old-prompt", images: [] },
    embeddedReferences: [{ id: "ref", title: "old", image: "old-image" }], continuationOf: "old-source",
  };
  const replaced = replaceVideoNodeMedia(previous, { video: "new-video", title: "New.mp4", width: 240, height: 360 });
  assert.deepEqual(replaced, {
    id: node.id, type: "video", title: "New.mp4", text: node.text, x: node.x, y: node.y,
    width: 240, height: 360, color: node.color, groupId: node.groupId, video: "new-video",
  });
  assert.equal(previous.assetId, "old-asset", "replacement does not mutate the history snapshot");
});

test("replacement cannot turn a prompt generator into an uploaded video", () => {
  assert.throws(() => replaceVideoNodeMedia({ ...node, type: "prompt" }, {
    video: "new-video", title: "New.mp4", width: 400, height: 225,
  }), /只能替换视频素材节点/);
});
