import test from "node:test";
import assert from "node:assert/strict";
import { matchNodeMediaAsset, nodeFromLibraryAsset, reusableNodeKind } from "../src/asset-nodes.ts";
import type { CanvasNode, StoredAsset } from "../src/canvas-types.ts";
import type { CanvasAsset } from "../src/asset-library.ts";
import { deleteLocalVideo, storeLocalVideo } from "../src/video-cache.ts";
import { readVideoSourceBlob, resolveVideoSource } from "../src/video-source.ts";

const node: CanvasNode = { id: "node", type: "prompt", title: "角色三视图", text: "portrait", x: 0, y: 0, width: 300, height: 200, color: "red", mediaType: "image", image: "https://cdn.test/a.png?signature=old", taskId: "task-1", resultIndex: 1 };
const stored = (id: string, url: string): StoredAsset => ({ id, task_id: "task-1", type: "image", url, size_bytes: 10, created_at: "2026-09-19T00:00:00Z" });

test("a completed creator saves its media while a text-only creator saves its prompt", () => {
  assert.equal(reusableNodeKind(node), "image");
  assert.equal(reusableNodeKind({ ...node, image: undefined }), "prompt");
  assert.equal(reusableNodeKind({ ...node, type: "image", image: undefined, text: "" }), null);
});

test("media matching survives signed URL refresh and never chooses by result list order", () => {
  const target = stored("asset-2", "https://cdn.test/a.png?signature=new");
  const others = [stored("asset-1", "https://cdn.test/b.png"), target];
  assert.equal(matchNodeMediaAsset(node, others)?.id, "asset-2");
  assert.equal(matchNodeMediaAsset({ ...node, image: "https://cdn.test/unknown.png" }, others), undefined);
  assert.equal(matchNodeMediaAsset({ ...node, image: "https://cdn.test/unknown.png" }, [target]), undefined);
  assert.equal(matchNodeMediaAsset({ ...node, image: "https://cdn.test/unknown.png", resultIndex: 0 }, [target])?.id, "asset-2");
  assert.equal(matchNodeMediaAsset({ ...node, image: "https://cdn.test/unknown.png", resultIndex: 0 }, [target], false), undefined);
  assert.equal(matchNodeMediaAsset(node, [{ ...target, task_id: "another-task" }]), undefined);
});

test("inserting a reusable result preserves the asset identity without creating a running task", () => {
  const asset: CanvasAsset = {
    schemaVersion: 1, id: "media:asset-2", name: "女主", kind: "image", category: "person", tags: ["三视图"],
    createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z",
    source: { type: "platform", assetId: "asset-2", taskId: "task-1", mediaType: "image" },
  };
  const result = nodeFromLibraryAsset(asset, "https://cdn.test/a.png?signature=fresh", undefined, "https://cdn.test/a.png?thumbnail=480x480&signature=fresh");
  assert.equal(result.assetId, "asset-2");
  assert.equal(result.type, "image");
  assert.equal(result.title, "女主");
  assert.equal(result.imageThumbnail, "https://cdn.test/a.png?thumbnail=480x480&signature=fresh");
  assert.equal(result.status, undefined);
  assert.equal(result.submission, undefined);
  assert.throws(() => nodeFromLibraryAsset(asset), /暂不可用/);
});

test("platform voice assets keep the task type and reusable voice ID on insertion", () => {
  const asset: CanvasAsset = {
    schemaVersion: 1, id: "media:voice-asset", name: "温柔女声", kind: "audio", category: "sound", tags: [],
    createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
    source: { type: "platform", assetId: "voice-asset", taskId: "voice-task-1", mediaType: "audio", audioTaskType: "voice_design", voiceId: "voice-reusable" },
  };
  const result = nodeFromLibraryAsset(asset, "cdn.test/voice.mp3");
  assert.equal(result.assetId, "voice-asset");
  assert.equal(result.taskId, "voice-task-1");
  assert.equal(result.audioTaskType, "voice_design");
  assert.equal(result.voiceId, "voice-reusable");
});

test("prompt assets insert as text nodes without requesting a media URL", () => {
  const asset: CanvasAsset = { schemaVersion: 1, id: "text", name: "风格", kind: "prompt", category: "prompt", tags: [], createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z", source: { type: "text", text: "水墨风格" } };
  assert.deepEqual(nodeFromLibraryAsset(asset), { type: "note", title: "风格", text: "水墨风格", modelId: undefined });
});

test("asset-only videos remain reusable after cloud restoration clears the signed URL", () => {
  assert.equal(reusableNodeKind({ ...node, type: "video", mediaType: undefined, image: undefined, taskId: undefined, assetId: "video-1" }), "video");
  const asset: CanvasAsset = { schemaVersion: 1, id: "media:video-1", name: "视频", kind: "video", category: "other", tags: [], createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", source: { type: "platform", assetId: "video-1", mediaType: "video" } };
  const result = nodeFromLibraryAsset(asset, "https://cdn.test/video.mp4?signature=valid", "2026-10-08T01:00:00Z");
  assert.equal(result.videoContentUrlExpiresAt, "2026-10-08T01:00:00Z");
  assert.equal(result.assetId, "video-1");
});

test("task-backed audio nodes retain task identity instead of a temporary preview URL", () => {
  const asset: CanvasAsset = {
    schemaVersion: 1, id: "task-audio", name: "配乐", kind: "audio", category: "sound", tags: [],
    createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z",
    source: { type: "task", taskId: "music-task-1", mediaType: "audio" },
  };
  const result = nodeFromLibraryAsset(asset, "blob:temporary-preview");
  assert.equal(result.audio, undefined);
  assert.equal(result.taskId, "music-task-1");
  assert.equal(result.status, "completed");
  assert.equal(reusableNodeKind({ id: "music-node", ...result, text: "", x: 0, y: 0, width: 320, height: 160, color: "" } as CanvasNode), "audio");
});

test("local recordings are rejected by the node conversion boundary until promoted to a platform asset", () => {
  const localAudio = "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc";
  const asset: CanvasAsset = {
    schemaVersion: 1, id: "recording", name: "人声录音", kind: "audio", category: "sound", tags: [],
    createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
    source: { type: "local", localAudio },
  };
  assert.throws(() => nodeFromLibraryAsset(asset, "blob:temporary-recording-preview"), /必须先上传/);
});

test("local video assets are rejected by the node conversion boundary", () => {
  const localVideo = "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc";
  const asset: CanvasAsset = {
    schemaVersion: 1, id: "local-video", name: "提取视频", kind: "video", category: "other", tags: [],
    createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z",
    source: { type: "local", localVideo },
  };
  assert.throws(() => nodeFromLibraryAsset(asset, "blob:temporary-video-preview"), /必须先上传/);
});

test("a local video draft remains readable from its cache without a platform request", async () => {
  const bytes = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 97, 118, 99, 49]);
  const localVideo = await storeLocalVideo(new Blob([bytes], { type: "video/mp4" }));
  const api = { request: async () => { assert.fail("local video reuse must not contact the media gateway"); } };
  let playerSource: Awaited<ReturnType<typeof resolveVideoSource>> | undefined;
  try {
    const preview = await resolveVideoSource(api, { localVideo });
    assert.match(preview.url, /^blob:/);
    playerSource = preview;
    const blob = await readVideoSourceBlob(api, { localVideo });
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  } finally {
    playerSource?.release?.();
    await deleteLocalVideo(localVideo);
  }
});

test("voice preview assets preserve their task route and reusable voice ID", () => {
  const asset: CanvasAsset = {
    schemaVersion: 1, id: "voice-result", name: "温柔女声", kind: "audio", category: "sound", tags: [],
    createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
    source: { type: "task", taskId: "voice-task-1", mediaType: "audio", audioTaskType: "voice_design", voiceId: "designed-voice-1" },
  };
  const result = nodeFromLibraryAsset(asset, "blob:temporary-voice-preview");
  assert.equal(result.audioTaskType, "voice_design");
  assert.equal(result.voiceId, "designed-voice-1");
  assert.equal(result.taskId, "voice-task-1");
  assert.equal(result.audio, undefined);
});

test("TTS assets preserve task routing and reusable voice identity", () => {
  const asset: CanvasAsset = {
    schemaVersion: 1, id: "tts-result", name: "旁白", kind: "audio", category: "sound", tags: [],
    createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
    source: { type: "task", taskId: "tts-task-1", mediaType: "audio", audioTaskType: "tts", voiceId: "voice-reusable" },
  };
  const result = nodeFromLibraryAsset(asset, "blob:temporary-tts-preview");
  assert.equal(result.audioTaskType, "tts");
  assert.equal(result.voiceId, "voice-reusable");
  assert.deepEqual(result.ttsSettings, { voice_id: "voice-reusable" });
  assert.equal(result.taskId, "tts-task-1");
  assert.equal(result.audio, undefined);
});
