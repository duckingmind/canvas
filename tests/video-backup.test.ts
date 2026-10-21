import assert from "node:assert/strict";
import test from "node:test";
import { packageCanvasVideo, restoreCanvasVideo } from "../src/video-backup.ts";
import type { Document } from "../src/canvas-types.ts";

const key = "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789012";
const document: Document = {
  id: "canvas", name: "video", createdAt: "now", updatedAt: "now", viewport: { x: 0, y: 0, zoom: 1 }, edges: [],
  nodes: [
    { id: "video", type: "video", mediaType: "video", title: "clip", text: "", x: 0, y: 0, width: 320, height: 180, color: "", video: "blob:session", localVideo: key, status: "completed" } as Document["nodes"][number],
    { id: "copy", type: "video", mediaType: "video", title: "clip copy", text: "", x: 0, y: 0, width: 320, height: 180, color: "", localVideo: key, embeddedReferences: [{ id: "embedded-video", title: "clip", localVideo: key }], videoSubmission: { key: "video-submit", model: "video-model", prompt: "video", images: [{ localVideo: key }] }, status: "completed" } as Document["nodes"][number],
  ],
};

test("video backups package duplicate local references once and restore them with a fresh key", async () => {
  const packed = await packageCanvasVideo(document, { read: async value => value === key ? new Blob(["MP4"], { type: "video/mp4" }) : null });
  assert.equal(packed.missing, 0);
  assert.deepEqual(Object.keys(packed.videoAssets), [key]);
  const restoredKey = "proxy-canvas:video:v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let stored: Blob | undefined;
  const restored = await restoreCanvasVideo({ ...packed.document, videoAssets: packed.videoAssets } as typeof packed.document & { videoAssets: typeof packed.videoAssets }, {
    store: async blob => { stored = blob; return restoredKey; },
  });
  assert.equal(stored?.type, "video/mp4");
  assert.equal(restored.nodes[0].localVideo, restoredKey);
  assert.equal(restored.nodes[1].localVideo, restoredKey);
  assert.equal(restored.nodes[1].embeddedReferences?.[0].localVideo, restoredKey);
  assert.equal(restored.nodes[1].videoSubmission?.images?.[0].localVideo, restoredKey);
  assert.equal("videoAssets" in restored, false);
});

test("missing local videos block full backups and remain explicit in partial and legacy imports", async () => {
  await assert.rejects(packageCanvasVideo(document, { read: async () => null }), /本机视频已丢失/);
  const partial = await packageCanvasVideo(document, { partial: true, read: async () => null });
  assert.equal(partial.missing, 1);
  assert.deepEqual((partial.document as typeof partial.document & { videoMissing?: string[] }).videoMissing, [key]);
  const importedPartial = await restoreCanvasVideo({ ...partial.document, videoAssets: partial.videoAssets } as typeof partial.document & { videoAssets: typeof partial.videoAssets }, { read: async () => null });
  assert.deepEqual(importedPartial.videoMissing, [key]);

  const legacy = await restoreCanvasVideo(document as typeof document & { localVideo?: string }, { read: async () => null });
  assert.deepEqual(legacy.videoMissing, [key]);
});

test("video backup payloads and indexes are validated strictly", async () => {
  const restore = (payload: unknown) => restoreCanvasVideo({ ...document, videoAssets: { [key]: payload } } as typeof document & { videoAssets: Record<string, unknown> }, { store: async () => key });
  await assert.rejects(restore("https://example.test/video.mp4"), /格式无效/);
  await assert.rejects(restore({ mime: "application/json", base64: "TVA=" }), /格式无效/);
  await assert.rejects(restore({ mime: "video/mp4", base64: "%%??" }), /格式无效/);
  await assert.rejects(restore({ mime: "video/mp4", base64: "TVA" }), /格式无效/);
  await assert.rejects(restoreCanvasVideo({ ...document, videoAssets: [] } as typeof document & { videoAssets: unknown }), /索引无效/);
  await assert.rejects(restoreCanvasVideo({ ...document, videoAssets: { "invalid-key": { mime: "video/mp4", base64: "TVA=" } } } as typeof document & { videoAssets: Record<string, unknown> }), /索引无效/);
});

test("single-file and aggregate video backup limits are enforced", async () => {
  const oversized = new Blob([new Uint8Array(160 * 1024 * 1024 + 1)], { type: "video/mp4" });
  await assert.rejects(packageCanvasVideo(document, { read: async () => oversized }), /160 MiB/);
  const manyKeys = Array.from({ length: 2 }, (_, index) => `proxy-canvas:video:v1:00000000-0000-4000-8000-00000000000${index}`);
  const multi: Document = { ...document, nodes: manyKeys.map((localVideo, index) => ({ ...document.nodes[0], id: `video-${index}`, localVideo })) as Document["nodes"] };
  const chunk = new Blob([new Uint8Array(91 * 1024 * 1024)], { type: "video/mp4" });
  await assert.rejects(packageCanvasVideo(multi, { read: async () => chunk }), /180 MiB/);
});

