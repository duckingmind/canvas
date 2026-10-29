import assert from "node:assert/strict";
import test from "node:test";
import { storageDocument } from "../src/cloud-document.ts";
import { MAX_CANVAS_DOCUMENT_BYTES } from "../src/cloud-document-limits.ts";
import type { CanvasNode, Document } from "../src/canvas-types.ts";
const doc = (patch: Partial<CanvasNode>): Document => ({ id: "canvas", name: "test", createdAt: "now", updatedAt: "now", viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "media", type: "image", title: "image", text: "", x: 0, y: 0, width: 100, height: 100, color: "", ...patch }] });

test("cloud DTO strips generated media bytes and signed URLs while keeping stable identities", () => {
  const source = doc({ taskId: "task-1", assetId: "asset-1", image: "data:image/png;base64," + "A".repeat(200000), localImage: "proxy-canvas:image:sha256:" + "a".repeat(64), video: "https://cdn.test/video.mp4?X-Amz-Signature=secret", videoPoster: "data:image/jpeg;base64,QQ==", localVideoPoster: "proxy-canvas:image:sha256:" + "b".repeat(64), videoContentUrl: "https://cdn.test/video?token=secret" });
  const saved = storageDocument(source);
  assert.equal(saved.nodes[0].taskId, "task-1");
  assert.equal(saved.nodes[0].assetId, "asset-1");
  assert.equal(saved.nodes[0].image, undefined);
  assert.equal(saved.nodes[0].video, undefined);
  assert.equal(saved.nodes[0].videoPoster, undefined);
  assert.equal(saved.nodes[0].localImage, undefined);
  assert.equal(saved.nodes[0].localVideoPoster, undefined);
  assert.equal(saved.nodes[0].videoContentUrl, undefined);
  assert(!JSON.stringify(saved).includes("base64"));
  assert(source.nodes[0].image?.startsWith("data:"), "original local/export snapshot retains media");
});

test("cloud DTO preserves explicit group membership so load repair cannot undo user changes", () => {
  const saved = storageDocument(doc({ groupId: "manual-group", groupMembershipOverride: true }));
  assert.equal(saved.nodes[0].groupId, "manual-group");
  assert.equal(saved.nodes[0].groupMembershipOverride, true);
});

test("cloud document projection accepts values above one KV value and rejects the Canvas guard", () => {
  const maxBytes = 240 * 1024;
  const empty = doc({ text: "" });
  const emptyBytes = new TextEncoder().encode(JSON.stringify(storageDocument(empty))).byteLength;
  const textBytes = maxBytes - emptyBytes;
  assert(textBytes > 0);

  const atLimit = doc({ text: "x".repeat(textBytes) });
  assert.equal(new TextEncoder().encode(JSON.stringify(storageDocument(atLimit))).byteLength, maxBytes);

  const overDirectLimit = doc({ text: "x".repeat(textBytes + 1) });
  assert.doesNotThrow(() => storageDocument(overDirectLimit));

  const overCanvasLimit = doc({ text: "x".repeat(MAX_CANVAS_DOCUMENT_BYTES + 1) });
  assert.throws(() => storageDocument(overCanvasLimit), /超过云端画布上限/);
});

test("cloud DTO omits derived group frame geometry but retains node membership", () => {
  const source = doc({ groupId: "manual-group" });
  source.groups = [{ id: "manual-group", x: 10, y: 20, width: 300, height: 200 }];
  const saved = storageDocument(source);
  assert.equal(saved.groups, undefined);
  assert.equal(saved.nodes[0].groupId, "manual-group");
});

test("cloud DTO removes local keys from durable input references", () => {
  const source = doc({
    image: "https://assets.example.test/input.png",
    submission: {
      key: "submission",
      model: "image",
      prompt: "test",
      images: [{
        image: "https://assets.example.test/reference.png",
        localImage: "proxy-canvas:image:sha256:" + "c".repeat(64),
      }],
    },
  });
  const saved = storageDocument(source);
  assert.equal(saved.nodes[0].submission?.images[0].localImage, undefined);
});

test("cloud DTO preserves safe inline prompt segments without media bytes", () => {
  const saved = storageDocument(doc({
    image: "https://assets.example.test/result.png",
    promptSegments: [
      { type: "text", text: "保持构图 " },
      { type: "reference", referenceId: "image-source", label: "主角" },
    ],
  }));
  assert.deepEqual(saved.nodes[0].promptSegments, [
    { type: "text", text: "保持构图 " },
    { type: "reference", referenceId: "image-source", label: "主角" },
  ]);
  assert(!JSON.stringify(saved).includes("base64"));
});

test("cloud DTO stores matching structured prompt text only once", () => {
  const source = doc({
    type: "prompt",
    text: "保持构图 @主角",
    promptSegments: [
      { type: "text", text: "保持构图 " },
      { type: "reference", referenceId: "image-source", label: "主角" },
    ],
  });
  const saved = storageDocument(source);
  assert.equal(saved.nodes[0].text, "");
  assert.deepEqual(saved.nodes[0].promptSegments, source.nodes[0].promptSegments);
});

test("cloud DTO retains prompt text when it differs from structured segments", () => {
  const saved = storageDocument(doc({
    type: "prompt",
    text: "latest prompt text",
    promptSegments: [
      { type: "text", text: "stale prompt text " },
      { type: "reference", referenceId: "image-source", label: "主角" },
    ],
  }));
  assert.equal(saved.nodes[0].text, "latest prompt text");
});

test("cloud DTO keeps readable text when segment normalization changes an opaque reference label", () => {
  const opaqueId = "a0d7709a-0aef-4ae6-a75e-2656c51baada";
  const saved = storageDocument(doc({
    type: "prompt",
    text: `use @${opaqueId}`,
    promptSegments: [
      { type: "text", text: "use @" },
      { type: "reference", referenceId: opaqueId, label: opaqueId },
    ],
  }));
  assert.equal(saved.nodes[0].text, `use @${opaqueId}`);
});

test("video recovery persists stable identity without signed URLs, expiry metadata or legacy content proxies", () => {
  for (const videoContentUrl of ["/videos/task-1/content", "https://app.test/api/app-runtime/v1/gateway/videos/task-1/content", "https://cdn.test/a.mp4?q-signature=secret"]) {
    const saved = storageDocument(doc({ type: "video", taskId: "task-1", assetId: "asset-1", videoContentUrl, videoContentUrlExpiresAt: "2026-10-08T01:00:00Z" }));
    assert.equal(saved.nodes[0].taskId, "task-1");
    assert.equal(saved.nodes[0].assetId, "asset-1");
    assert.equal(saved.nodes[0].videoContentUrl, undefined);
    assert.equal(saved.nodes[0].videoContentUrlExpiresAt, undefined);
  }
  const assetOnly = storageDocument(doc({ type: "video", assetId: "asset-1", video: "https://cdn.test/private.mp4", videoContentUrlExpiresAt: "2026-10-08T01:00:00Z" }));
  assert.equal(assetOnly.nodes[0].video, undefined);
  assert.equal(assetOnly.nodes[0].assetId, "asset-1");
});

test("cloud projection does not validate temporary inputs or mutate the local draft", () => {
  const localAudio = "proxy-canvas:audio:v1:11111111-1111-4111-8111-111111111111";
  for (const patch of [
    { image: "data:image/png;base64,QQ==" },
    { video: "blob:local" },
    { audio: "data:audio/wav;base64,QQ==" },
    { image: "https://cdn.test/image?signature=temporary" },
    { localImage: "proxy-canvas:image:sha256:abc" },
    { musicReference: { localAudio, title: "reference", duration: 8, size: 100 } },
    { musicSubmission: { key: "unaccepted-music-submit", model: "cover", prompt: "cover", referenceLocalAudio: localAudio } },
  ]) {
    const source = doc(patch);
    const before = structuredClone(source);
    const saved = storageDocument(source);
    assert.doesNotThrow(() => storageDocument(source));
    assert(!JSON.stringify(saved).includes("proxy-canvas:"));
    assert(!JSON.stringify(saved).match(/(?:data:|blob:|signature=temporary)/));
    assert.deepEqual(source, before);
  }
});

test("durable input URLs remain usable and temporary reference bytes are projected out", () => {
  const source = doc({ image: "https://assets.example.test/public.png" });
  assert.equal(storageDocument(source).nodes[0].image, source.nodes[0].image);
  const saved = storageDocument(doc({ submission: { key: "submission", model: "image", prompt: "test", images: [{ image: "data:image/png;base64,QQ==" }] } }));
  assert.deepEqual(saved.nodes[0].submission?.images, [{}]);
});

test("video submission references never persist signed, data or blob URLs", () => {
  const source = doc({
    videoSubmission: {
      key: "video-submission",
      model: "video-model",
      prompt: "test",
      references: [
        { type: "image_url", url: "https://assets.example.test/reference.png" },
        { type: "video_url", url: "https://cdn.example.test/video.mp4?X-Amz-Signature=secret", assetId: "asset-video-reference" },
        { type: "audio_url", url: "data:audio/wav;base64,QQ==" },
      ],
    },
  });
  const saved = storageDocument(source);
  assert.deepEqual(saved.nodes[0].videoSubmission?.references, [
    { type: "image_url", url: "https://assets.example.test/reference.png" },
    { type: "video_url", assetId: "asset-video-reference" },
  ]);
  assert.equal(source.nodes[0].videoSubmission?.references?.length, 3);
});

test("recoverable video tasks keep durable references and drop temporary media URLs", () => {
  const saved = storageDocument(doc({
    taskId: "task-1",
    videoSubmission: {
      key: "video-submission",
      model: "video-model",
      prompt: "test",
      references: [
        { type: "image_url", url: "https://assets.example.test/reference.png" },
        { type: "video_url", url: "https://cdn.example.test/video.mp4?X-Amz-Signature=secret", assetId: "asset-video-reference" },
      ],
      images: [{ video: "blob:canvas-video", assetId: "asset-video" }],
    },
    embeddedReferences: [{
      id: "embedded-video",
      title: "video",
      video: "https://cdn.example.test/video.mp4?token=secret",
      audio: "data:audio/wav;base64,QQ==",
      assetId: "asset-video",
    }],
  }));
  const node = saved.nodes[0];
  assert.deepEqual(node.videoSubmission?.references, [
    { type: "image_url", url: "https://assets.example.test/reference.png" },
    { type: "video_url", assetId: "asset-video-reference" },
  ]);
  assert.deepEqual(node.videoSubmission?.images, [{ assetId: "asset-video" }]);
  assert.deepEqual(node.embeddedReferences, [{
    id: "embedded-video",
    title: "video",
    assetId: "asset-video",
  }]);
  const serialized = JSON.stringify(saved);
  assert(!serialized.includes("X-Amz-Signature"));
  assert(!serialized.includes("blob:canvas-video"));
  assert(!serialized.includes("data:audio"));
});

test("task identity does not make a temporary frozen input recoverable", () => {
  const saved = storageDocument(doc({
    type: "prompt",
    taskId: "accepted-task",
    videoSubmission: {
      key: "video-submit",
      model: "video-model",
      prompt: "test",
      references: [{ type: "video_url", url: "https://cdn.example.test/video.mp4?token=temporary" }],
    },
  }));
  assert.equal(saved.nodes[0].videoSubmission?.references, undefined);
});

test("video task references retain stable asset IDs when signed URLs are removed", () => {
  const saved = storageDocument(doc({
    type: "prompt", mediaType: "video",
    videoSubmission: {
      key: "video-submit",
      model: "video-model",
      prompt: "animate",
      references: [
        { type: "video_url", url: "https://cdn.example/video.mp4?token=temporary", assetId: "asset-video", mediaType: "video" },
        { type: "audio_url", assetId: "asset-audio", mediaType: "audio" },
      ],
    },
  }));
  assert.deepEqual(saved.nodes[0].videoSubmission?.references, [
    { type: "video_url", assetId: "asset-video", mediaType: "video" },
    { type: "audio_url", assetId: "asset-audio", mediaType: "audio" },
  ]);
  assert(!JSON.stringify(saved).includes("token=temporary"));
});

test("cloud snapshots strip local audio/video reference keys and keep stable asset identities", () => {
  const localAudio = "proxy-canvas:audio:v1:11111111-1111-4111-8111-111111111111";
  const localVideo = "proxy-canvas:video:v1:22222222-2222-4222-8222-222222222222";
  const saved = storageDocument(doc({
    type: "prompt",
    mediaType: "video",
    taskId: "video-task",
    videoSubmission: {
      key: "video-submit",
      model: "video-model",
      prompt: "test",
      images: [{ localVideo, assetId: "video-input" }, { localAudio, assetId: "audio-input" }],
    },
    embeddedReferences: [
      { id: "video", title: "video", localVideo, assetId: "video-input" },
      { id: "audio", title: "audio", localAudio, assetId: "audio-input" },
    ],
  }));
  assert.deepEqual(saved.nodes[0].videoSubmission?.images, [{ assetId: "video-input" }, { assetId: "audio-input" }]);
  assert.deepEqual(saved.nodes[0].embeddedReferences, [
    { id: "video", title: "video", assetId: "video-input" },
    { id: "audio", title: "audio", assetId: "audio-input" },
  ]);
  assert.equal(JSON.stringify(saved).includes("proxy-canvas:"), false);
  const unaccepted = storageDocument(doc({
    type: "prompt",
    mediaType: "video",
    videoSubmission: {
      key: "unaccepted-video-submit",
      model: "video-model",
      prompt: "test",
      images: [{ localVideo }],
    },
  }));
  assert.deepEqual(unaccepted.nodes[0].videoSubmission?.images, [{}]);
  const localOnly = storageDocument(doc({ type: "video", localVideo, status: "completed" }));
  assert.equal(localOnly.nodes[0].localVideo, undefined);
  const acceptedTask = storageDocument(doc({
    type: "prompt",
    taskId: "video-task",
    videoSubmission: {
      key: "accepted-video-submit",
      model: "video-model",
      prompt: "test",
      images: [{ localVideo }],
    },
  }));
  assert.deepEqual(acceptedTask.nodes[0].videoSubmission?.images, [{}]);
});

test("music and voice recovery retain frozen metadata while excluding reference bytes from cloud storage", () => {
  const localAudio = "proxy-canvas:audio:v1:11111111-1111-4111-8111-111111111111";
  const source = doc({
    type: "prompt", mediaType: "audio", audioMode: "music", taskId: "music-task",
    musicReference: { localAudio, assetId: "reference-asset", title: "参考音频", duration: 30, size: 100 },
    musicSubmission: { key: "cover-submit", model: "cover", prompt: "原始音乐描述", lyrics: "原始歌词", referenceLocalAudio: localAudio, referenceAssetId: "reference-asset", referenceDuration: 30, referenceSize: 100, audio_base64: "FORBIDDEN_AUDIO_BYTES", referenceUrl: "data:audio/wav;base64,FORBIDDEN_AUDIO_BYTES" } as any,
    voiceDesignSubmission: { key: "voice-submit", model: "custom-voice", prompt: "原始音色描述", previewText: "原始试听文本", audio: "FORBIDDEN_AUDIO_BYTES" } as any,
  });
  const saved = storageDocument(source);
  assert.equal(saved.nodes[0].musicSubmission?.referenceLocalAudio, undefined);
  assert.equal(saved.nodes[0].musicSubmission?.referenceAssetId, "reference-asset");
  assert.equal(saved.nodes[0].musicSubmission?.prompt, "原始音乐描述");
  assert.equal(saved.nodes[0].musicSubmission?.lyrics, "原始歌词");
  assert.equal(saved.nodes[0].musicReference?.localAudio, undefined);
  assert.equal(saved.nodes[0].musicReference?.assetId, "reference-asset");
  assert.deepEqual(saved.nodes[0].voiceDesignSubmission, { key: "voice-submit", model: "custom-voice", prompt: "原始音色描述", previewText: "原始试听文本" });
  assert(!JSON.stringify(saved).includes("FORBIDDEN_AUDIO_BYTES"));
  assert(!JSON.stringify(saved).includes("proxy-canvas:"));
  assert(JSON.stringify(source).includes("FORBIDDEN_AUDIO_BYTES"), "local snapshots remain untouched");
});

test("TTS cloud snapshots retain frozen synthesis inputs and discard transient audio fields", () => {
  const source = doc({
    type: "prompt", mediaType: "audio", audioMode: "tts", audioTaskType: "tts", taskId: "tts-task-1",
    audio: "/tts/tasks/tts-task-1/content", status: "queued",
    ttsSettings: { voice_id: "voice-stable", output_format: "mp3" },
    ttsSubmission: { key: "tts-submit", model: "minimax-speech-2.8-hd", text: "你好", settings: { voice_id: "voice-stable", speed: 1.1, audio_base64: "FORBIDDEN_AUDIO_BYTES" } } as any,
  });
  const saved = storageDocument(source);
  assert.equal(saved.nodes[0].audio, undefined);
  assert.equal(saved.nodes[0].taskId, "tts-task-1");
  assert.deepEqual(saved.nodes[0].ttsSettings, { voice_id: "voice-stable", output_format: "mp3" });
  assert.deepEqual(saved.nodes[0].ttsSubmission, { key: "tts-submit", model: "minimax-speech-2.8-hd", text: "你好", settings: { voice_id: "voice-stable", speed: 1.1 } });
  assert(!JSON.stringify(saved).includes("FORBIDDEN_AUDIO_BYTES"));
});
