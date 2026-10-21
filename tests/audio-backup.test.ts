import assert from "node:assert/strict";
import test from "node:test";
import { packageCanvasAudio, restoreCanvasAudio } from "../src/audio-backup.ts";
import type { Document } from "../src/canvas-types.ts";

const key = "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789012";
const document: Document = {
  id: "canvas", name: "audio", createdAt: "now", updatedAt: "now", viewport: { x: 0, y: 0, zoom: 1 }, edges: [],
  nodes: [{ id: "audio", type: "audio", mediaType: "audio", title: "recording", text: "", x: 0, y: 0, width: 320, height: 180, color: "", localAudio: key, status: "completed" },
    { id: "music", type: "prompt", mediaType: "audio", title: "cover", text: "", x: 0, y: 0, width: 320, height: 180, color: "", musicReference: { localAudio: key, title: "recording", duration: 8, size: 4 }, musicSubmission: { key: "submit", model: "cover", prompt: "music", referenceLocalAudio: key, referenceDuration: 8, referenceSize: 4 }, embeddedReferences: [{ id: "embedded-audio", title: "recording", localAudio: key }], videoSubmission: { key: "video-submit", model: "video-model", prompt: "video", images: [{ localAudio: key }] }, status: "queued" }],
};

test("audio backups package local bytes once and restore every stable reference with a new local key", async () => {
  const packed = await packageCanvasAudio(document, { read: async value => value === key ? new Blob(["RIFF"], { type: "audio/wav" }) : null });
  assert.equal(packed.missing, 0);
  assert.equal(Object.keys(packed.audioAssets).length, 1);
  const restoredKey = "proxy-canvas:audio:v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let stored: Blob | undefined;
  const restored = await restoreCanvasAudio({ ...packed.document, audioAssets: packed.audioAssets }, { store: async blob => { stored = blob; return restoredKey; } });
  assert.equal(stored?.type, "audio/wav");
  assert.equal(restored.nodes[0].localAudio, restoredKey);
  assert.equal(restored.nodes[1].musicReference?.localAudio, restoredKey);
  assert.equal(restored.nodes[1].musicSubmission?.referenceLocalAudio, restoredKey);
  assert.equal(restored.nodes[1].embeddedReferences?.[0].localAudio, restoredKey);
  assert.equal(restored.nodes[1].videoSubmission?.images?.[0].localAudio, restoredKey);
  assert.equal("audioAssets" in restored, false);
  const partial = await packageCanvasAudio(document, { partial: true, read: async () => null });
  const importedPartial = await restoreCanvasAudio({ ...partial.document, audioAssets: partial.audioAssets }, { read: async () => null });
  assert.deepEqual(importedPartial.audioMissing, [key]);
  assert.equal(importedPartial.nodes[1].musicReference, undefined);
  assert.equal(importedPartial.nodes[1].musicSubmission?.referenceLocalAudio, key);
});

test("a missing local audio key blocks full backup and remains explicit in a partial backup", async () => {
  await assert.rejects(packageCanvasAudio(document, { read: async () => null }), /本机音频已丢失/);
  const partial = await packageCanvasAudio(document, { partial: true, read: async () => null });
  assert.equal(partial.missing, 1);
  assert.equal(partial.document.nodes[0].localAudio, key);
  assert.equal(partial.document.nodes[1].musicReference?.localAudio, key);
  assert.equal(partial.document.nodes[1].musicSubmission?.referenceLocalAudio, key);
  assert.equal(partial.document.nodes[1].embeddedReferences?.[0].localAudio, key);
  assert.deepEqual(partial.document.audioMissing, [key]);
});

test("legacy backups detect missing local bytes and reuse audio still present in the current browser", async () => {
  const missing = await restoreCanvasAudio(document, { read: async () => null });
  assert.deepEqual(missing.audioMissing, [key]);
  assert.equal(missing.nodes[1].musicReference, undefined);

  const retained = await restoreCanvasAudio(document, { read: async () => new Blob(["RIFF"], { type: "audio/wav" }) });
  assert.equal(retained.audioMissing, undefined);
  assert.equal(retained.nodes[0].localAudio, key);
  assert.equal(retained.nodes[1].musicReference?.localAudio, key);
  assert.equal(retained.nodes[1].embeddedReferences?.[0].localAudio, key);
});

test("invalid audio payloads are rejected during import", async () => {
  const restore = (payload: unknown) => restoreCanvasAudio({ ...document, audioAssets: { [key]: payload } }, { store: async () => key });
  await assert.rejects(restore("https://example.test/audio.wav"), /格式无效/);
  await assert.rejects(restore({ mime: "application/json", base64: "UklGRg==" }), /格式无效/);
  await assert.rejects(restore({ mime: "audio/wav", base64: "%%??" }), /格式无效/);
  await assert.rejects(restoreCanvasAudio({ ...document, audioAssets: [] as unknown as Record<string, { mime: string; base64: string }> }), /索引无效/);
});

test("invalid local audio keys are rejected during export instead of being omitted", async () => {
  const invalid = { ...document, nodes: [{ ...document.nodes[0], localAudio: "blob:temporary" }] };
  await assert.rejects(
    packageCanvasAudio(invalid, { read: async () => null }),
    /本机音频索引无效/,
  );
});
