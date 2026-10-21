import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasNode, Document } from "../src/canvas-types.ts";
import { getNodeInteraction, nodeHasMediaContent } from "../src/node-interaction.ts";
import { mediaNavigation } from "../src/media-navigation.ts";
import { resolveCanvasNodeRole } from "../src/creator-node-role.ts";
import { createCanvasAgent } from "../src/agent-capabilities.ts";
import { completedVideoMedia, hasRecoverableVideoIdentity, VideoNodeSourceGuard } from "../src/video-node-media.ts";

const video = (extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id: "video", type: "video", title: "Saved video", text: "", x: 0, y: 0,
  width: 420, height: 260, color: "#ffffff", assetId: "asset-video", ...extra,
});

test("a new generated video replaces old local bytes, identity and cover together", () => {
  const previous = video({ video: "data:video/mp4;base64,OLD", videoPoster: "data:image/png;base64,OLD", localVideoPoster: "old-cover", localImage: "old-image", image: "old.png", audio: "old.wav" });
  const result = { contentUrl: "https://cos.test/new.mp4?signature=new", contentUrlExpiresAt: "2026-10-09T00:00:00Z", assetId: "new-asset" };
  const current = { ...previous, ...completedVideoMedia(result) };
  assert.equal(current.videoContentUrl, result.contentUrl);
  assert.equal(current.videoContentUrlExpiresAt, result.contentUrlExpiresAt);
  assert.equal(current.assetId, "new-asset");
  for (const key of ["video", "videoPoster", "localVideoPoster", "localImage", "image", "audio"] as const) assert.equal(current[key], undefined);
  assert.equal(previous.video, "data:video/mp4;base64,OLD");
});

test("asset-only cloud videos retain preview actions and creator presentation", () => {
  const assetOnly = video();
  assert.equal(nodeHasMediaContent(assetOnly), true);
  assert.equal(getNodeInteraction(assetOnly).primaryAction, "preview");
  const creator = video({ type: "prompt", mediaType: "video", status: "completed", taskId: "task-video" });
  assert.equal(getNodeInteraction(creator).visualType, "video");
  assert.equal(getNodeInteraction(creator).canPreview, true);
  assert.deepEqual(resolveCanvasNodeRole(creator, [creator]), { kind: "creator", creator, presentation: "generated-media" });
  for (const status of ["queued", "running", "failed"]) {
    assert.equal(hasRecoverableVideoIdentity(video({ status: status as CanvasNode["status"] })), false);
  }
  assert.equal(hasRecoverableVideoIdentity(video({ assetId: undefined, taskId: "task-video" })), false);
  assert.equal(hasRecoverableVideoIdentity(video({ assetId: undefined, taskId: "task-video", status: "completed" })), true);
});

test("asset-only restored videos stay in their creator's result gallery", () => {
  const creator = video({ id: "creator", type: "prompt", mediaType: "video", assetId: undefined });
  const first = video({ id: "first", resultOf: creator.id, resultIndex: 0 });
  const second = video({ id: "second", resultOf: creator.id, resultIndex: 1, assetId: undefined, taskId: "second-task", status: "completed" });
  const pending = video({ id: "pending", resultOf: creator.id, status: "queued" });
  assert.deepEqual(mediaNavigation([creator, first, second, pending], [], first).items, [first, second]);
});

test("agent summaries retain media availability without exposing signed addresses", () => {
  const node = video();
  const doc: Document = { id: "doc", name: "Saved", nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: "now", updatedAt: "now" };
  const agent = createCanvasAgent({ getDocument: () => doc, beforeWrite() {}, commit() {}, persist: async () => {}, canWrite: () => true });
  const result = agent.read_node({ node_id: node.id });
  assert.equal(result.node.hasMedia, true);
  assert.equal("videoContentUrl" in result.node, false);
});

test("a changed delivery expiry or media kind invalidates in-flight decoder work", () => {
  const node = video({ videoContentUrl: "https://cos.test/video.mp4", videoContentUrlExpiresAt: "2026-10-08T12:00:00Z" });
  const guard = new VideoNodeSourceGuard();
  const token = guard.capture("doc", node);
  assert.equal(guard.isCurrent(token, "doc", { ...node, title: "Renamed" }), true);
  assert.equal(guard.isCurrent(token, "doc", { ...node, videoContentUrlExpiresAt: "2026-10-08T13:00:00Z" }), false);
  assert.equal(guard.isCurrent(token, "doc", { ...node, mediaType: "image" }), false);
});
