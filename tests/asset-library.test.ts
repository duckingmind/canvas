import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSET_PREFIX,
  assetKey,
  createAsset,
  filterAssets,
  isDurableAssetUrl,
  listAssets,
  normalizeAsset,
  normalizeAssetTags,
  readAsset,
  removeAsset,
  updateAsset,
  type AssetStorage,
  type CanvasAsset,
} from "../src/asset-library.ts";
import type { KVOperation } from "../src/document-kv.ts";

function storage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const revisions = new Map([...values.keys()].map((key, index) => [key, index + 1]));
  let clock = revisions.size;
  const idempotent = new Map<string, { request: string; result: { success: boolean; revision?: number } }>();
  const conflict = () => Object.assign(new Error("Conflict"), { code: "APP_STORAGE_CONFLICT" });
  const commit = (ops: KVOperation[]) => {
    const next = new Map(values), nextRevisions = new Map(revisions);
    const result = ops.map((op) => {
      const current = nextRevisions.get(op.key) ?? 0;
      if (op.expectedRevision !== undefined && op.expectedRevision !== current) throw conflict();
      if (op.op === "delete") {
        next.delete(op.key); nextRevisions.delete(op.key);
        return { key: op.key, success: true };
      }
      const revision = ++clock;
      next.set(op.key, structuredClone(op.value)); nextRevisions.set(op.key, revision);
      return { key: op.key, success: true, revision };
    });
    values.clear(); revisions.clear();
    for (const [key, value] of next) values.set(key, value);
    for (const [key, revision] of nextRevisions) revisions.set(key, revision);
    return result;
  };
  const api: AssetStorage = {
    get: async <T>(key: string) => structuredClone(values.get(key) ?? null) as T | null,
    getMany: async <T>(keys: string[]) => Object.fromEntries(keys.map((key) => [key, structuredClone(values.get(key) ?? null)])) as Record<string, T | null>,
    getEntry: async <T>(key: string) => values.has(key)
      ? { key, value: structuredClone(values.get(key)) as T, revision: revisions.get(key)! }
      : null,
    getEntries: async <T>(keys: string[]) => Object.fromEntries(keys.map((key) => [key, values.has(key)
      ? { key, value: structuredClone(values.get(key)) as T, revision: revisions.get(key)! }
      : null])) as Record<string, any>,
    set: async (key, value, options) => {
      const request = JSON.stringify({ key, value, expectedRevision: options?.expectedRevision });
      const prior = options?.idempotencyKey ? idempotent.get(options.idempotencyKey) : undefined;
      if (prior) { assert.equal(prior.request, request); return prior.result; }
      const result = commit([{ op: "put", key, value, expectedRevision: options?.expectedRevision }])[0];
      if (options?.idempotencyKey) idempotent.set(options.idempotencyKey, { request, result });
      return result;
    },
    batch: async (ops) => commit(ops),
    list: async ({ prefix = "", cursor, limit = 100 } = {}) => {
      const keys = [...values.keys()].filter((key) => key.startsWith(prefix) && (!cursor || key > cursor)).sort();
      return { keys: keys.slice(0, limit), ...(keys.length > limit ? { nextCursor: keys[limit - 1] } : {}) };
    },
  };
  return { api, values, revisions };
}

const now = "2026-09-19T00:00:00.000Z";
function imageAsset(id = "asset-one"): CanvasAsset {
  return {
    schemaVersion: 1, id, name: "Sunset", kind: "image", category: "scene", tags: ["warm", "sunset"],
    createdAt: now, updatedAt: now,
    source: { type: "platform", assetId: "media-one", mediaType: "image" },
    prompt: "warm sunset over the sea", modelId: "image-model",
  };
}

 test("asset keys enforce the generic KV grammar", () => {
  assert.equal(assetKey("asset-one"), ASSET_PREFIX + "asset-one");
  for (const id of ["", "../x", "a..b", "x/y", "a".repeat(129)]) assert.throws(() => assetKey(id), { code: "CANVAS_ASSET_INVALID" });
});

test("durable URL checks reject signed links, credentials and authenticated task content routes", () => {
  assert.equal(isDurableAssetUrl("https://cdn.example.com/image.png"), true);
  for (const url of [
    "data:image/png;base64,abc",
    "https://cdn.example.com/a?X-Amz-Signature=x",
    "https://u:p@example.com/a",
    "https://app.example.com/v1/videos/task-1/content",
    "https://app.example.com/v1/music/tasks/task-2/content?index=0",
    "not a url",
  ]) assert.equal(isDurableAssetUrl(url), false);
});

test("normalization validates source semantics and strips unknown fields", () => {
  const asset = normalizeAsset({ ...imageAsset(), extraPreview: "discard" });
  assert.equal("extraPreview" in asset, false);
  assert.throws(() => normalizeAsset({ ...imageAsset(), source: { type: "text", text: "prompt" } }), /只能用于提示词/);
  assert.throws(() => normalizeAsset({ ...imageAsset(), kind: "prompt", category: "prompt", source: { type: "url", url: "https://cdn.example.com/a" } }), /必须使用文本来源/);
  assert.throws(() => normalizeAsset({ ...imageAsset(), source: { type: "local", localImage: "data:image/png;base64,abc" } }), /本机素材需要有效/);
  assert.throws(() => normalizeAsset({ ...imageAsset(), source: { type: "url", url: "https://cdn.example.com/a?token=x" } }), /长期有效/);
});

test("local audio assets store only a valid cache reference, never audio bytes", async () => {
  const s = storage();
  const localAudio = "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc";
  const asset = normalizeAsset({ ...imageAsset("recording"), kind: "audio", category: "sound", source: { type: "local", localAudio, audio_base64: "discarded" }, audio: "blob:discarded", bytes: [1, 2] });
  await createAsset(s.api, asset);
  const restored = (await readAsset(s.api, asset.id))!.asset;
  assert.deepEqual(restored.source, { type: "local", localAudio });
  assert.equal(JSON.stringify(restored).includes("discarded"), false);
  assert.throws(() => normalizeAsset({ ...asset, source: { type: "local", localAudio: "data:audio/mpeg;base64,SUQzAA==" } }), /缓存引用/);
  assert.throws(() => normalizeAsset({ ...asset, source: { type: "local", localAudio: "blob:temporary" } }), /缓存引用/);
  assert.throws(() => normalizeAsset({ ...imageAsset(), source: { type: "local", localAudio } }), /类型一致/);
  assert.throws(() => normalizeAsset({ ...asset, source: { type: "local", localAudio, localImage: `proxy-canvas:image:sha256:${"a".repeat(64)}` } }), /类型一致/);
});

test("local video assets store only a valid cache reference and enforce video kind", async () => {
  const s = storage();
  const localVideo = "proxy-canvas:video:v1:12345678-1234-1234-1234-123456789abc";
  const asset = normalizeAsset({ ...imageAsset("local-video"), kind: "video", source: { type: "local", localVideo, video_base64: "discarded" }, video: "blob:discarded", bytes: [1, 2] });
  await createAsset(s.api, asset);
  const restored = (await readAsset(s.api, asset.id))!.asset;
  assert.deepEqual(restored.source, { type: "local", localVideo });
  assert.equal(JSON.stringify(restored).includes("discarded"), false);
  assert.throws(() => normalizeAsset({ ...asset, source: { type: "local", localVideo: "blob:temporary" } }), /缓存引用/);
  assert.throws(() => normalizeAsset({ ...imageAsset(), source: { type: "local", localVideo } }), /类型一致/);
  assert.throws(() => normalizeAsset({ ...asset, source: { type: "local", localVideo, localAudio: "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc" } }), /类型一致/);
  assert.throws(() => normalizeAsset({ ...imageAsset(), source: { type: "local", localImage: `proxy-canvas:image:sha256:${"a".repeat(64)}`, localVideo } }), /类型一致/);
  assert.throws(() => normalizeAsset({ ...asset, kind: "audio", source: { type: "local", localAudio: "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789abc", localVideo } }), /类型一致/);
});

test("audio task assets validate and retain voice-design provenance", () => {
  const source = { type: "task", taskId: "voice-task", mediaType: "audio", audioTaskType: "voice_design", voiceId: "voice-one" };
  const voice = { ...imageAsset(), kind: "audio", category: "sound", source };
  assert.deepEqual(normalizeAsset(voice).source, source);
  assert.throws(() => normalizeAsset({ ...voice, source: { ...source, audioTaskType: "unsupported" } }), /任务类型/);
  assert.throws(() => normalizeAsset({ ...voice, source: { ...source, audioTaskType: "music" } }), /音色 ID/);
  assert.throws(() => normalizeAsset({ ...imageAsset(), source: { ...source, mediaType: "image" } }), /任务类型/);
  assert.deepEqual(normalizeAsset({ ...voice, source: { type: "task", taskId: "old-music", mediaType: "audio" } }).source,
    { type: "task", taskId: "old-music", mediaType: "audio" });
});

test("platform voice provenance is retained only for audio voice-design assets", () => {
  const asset = {
    schemaVersion: 1, id: "platform-voice", name: "音色", kind: "audio", category: "sound", tags: [],
    createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
    source: { type: "platform", assetId: "voice-asset", taskId: "voice-task", mediaType: "audio", audioTaskType: "voice_design", voiceId: "voice-id" },
  };
  const normalized = normalizeAsset(asset);
  assert.equal(normalized.source.type, "platform");
  assert.equal(normalized.source.audioTaskType, "voice_design");
  assert.equal(normalized.source.voiceId, "voice-id");
  assert.throws(() => normalizeAsset({ ...asset, source: { ...asset.source, mediaType: "video" } }), { code: "CANVAS_ASSET_INVALID" });
  assert.throws(() => normalizeAsset({ ...asset, source: { ...asset.source, audioTaskType: "music" } }), { code: "CANVAS_ASSET_INVALID" });
});

test("user tags are trimmed, deduplicated and constrained independently from system tags", () => {
  assert.deepEqual(normalizeAssetTags([" scene ", "Scene", "角色"]), ["scene", "角色"]);
  assert.deepEqual(normalizeAssetTags(Array(21).fill("same")), ["same"]);
  assert.deepEqual(normalizeAssetTags(["🌅".repeat(40)]), ["🌅".repeat(40)]);
  for (const tags of [[" "], ["x".repeat(41)], Array.from({ length: 21 }, (_, i) => String(i)), ["APP:canvas"], ["type:image"], ["source:generated"]]) {
    assert.throws(() => normalizeAssetTags(tags), { code: "CANVAS_ASSET_INVALID" });
  }
  const asset = normalizeAsset({ ...imageAsset(), folder: " 角色库 ", sourceAppId: "canvas", systemTags: ["app:canvas", "type:image"] });
  assert.equal(asset.folder, "角色库");
  assert.equal(asset.sourceAppId, "canvas");
  assert.deepEqual(asset.systemTags, ["app:canvas", "type:image"]);
  assert.deepEqual(normalizeAsset({ ...imageAsset(), tags: ["app:legacy", "x".repeat(64)] }).tags, ["app:legacy", "x".repeat(64)]);
});

test("create, read, update and remove use revisions and preserve metadata", async () => {
  const s = storage();
  const created = await createAsset(s.api, imageAsset(), { idempotencyKey: "save-one" });
  assert.equal(created.revision, 1);
  assert.deepEqual((await readAsset(s.api, "asset-one"))?.asset, imageAsset());
  const updated = await updateAsset(s.api, { ...imageAsset(), name: "Dawn", updatedAt: "2026-09-20T00:00:00.000Z" }, created.revision, { idempotencyKey: "update-one" });
  assert.equal(updated.asset.name, "Dawn");
  await removeAsset(s.api, "asset-one", updated.revision, { idempotencyKey: "remove-one" });
  assert.equal(await readAsset(s.api, "asset-one"), null);
});

test("CAS conflicts protect concurrent edits and removal", async () => {
  const s = storage();
  const created = await createAsset(s.api, imageAsset());
  await assert.rejects(updateAsset(s.api, { ...imageAsset(), name: "Stale", updatedAt: "2026-09-20T00:00:00.000Z" }, created.revision + 1), { code: "APP_STORAGE_CONFLICT" });
  await assert.rejects(removeAsset(s.api, "asset-one", created.revision + 1), { code: "APP_STORAGE_CONFLICT" });
});

test("listAssets paginates, batch-hydrates and skips corrupt records", async () => {
  const initial: Record<string, unknown> = {};
  for (let i = 0; i < 3; i++) initial[assetKey("asset-" + i)] = imageAsset("asset-" + i);
  initial[assetKey("bad")] = { ...imageAsset("different") };
  const s = storage(initial);
  const page = await listAssets(s.api, { limit: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.skipped, 0);
  assert.ok(page.nextCursor);
  const rest = await listAssets(s.api, { cursor: page.nextCursor, limit: 10 });
  assert.equal(rest.items.length, 1);
  assert.equal(rest.skipped, 1);
  assert.deepEqual([...page.items, ...rest.items].map((row) => row.asset.id), ["asset-0", "asset-1", "asset-2"]);
});

test("listAssets rejects invalid pagination responses", async () => {
  const s = storage();
  s.api.list = async () => ({ keys: [ASSET_PREFIX + "a"], nextCursor: "same" });
  await assert.rejects(listAssets(s.api, { cursor: "same" }), /分页未能继续/);
  s.api.list = async () => ({ keys: ["other:key"] });
  await assert.rejects(listAssets(s.api), /无效的列表/);
});

test("filterAssets searches metadata and combines kind/category filters", () => {
  const rows = [imageAsset("a"), { ...imageAsset("b"), name: "Voice", kind: "audio", category: "sound", tags: ["ambient"], prompt: "ocean waves" }].map((asset) => ({ asset, revision: 1 }));
  assert.deepEqual(filterAssets(rows, { query: "warm sunset" }).map((row) => row.asset.id), ["a"]);
  assert.deepEqual(filterAssets(rows, { kind: "audio", category: "sound" }).map((row) => row.asset.id), ["b"]);
  assert.deepEqual(filterAssets(rows, { query: "ocean", kind: "image" }), []);
});

test("filterAssets combines labels, folders and read-only provenance", () => {
  const rows = [
    { ...imageAsset("a"), folder: "角色库", sourceAppId: "canvas", systemTags: ["app:canvas", "type:image"] },
    { ...imageAsset("b"), folder: "", tags: ["cool"] },
  ].map(asset => ({ asset, revision: 1 }));
  assert.deepEqual(filterAssets(rows, { tag: "warm", folder: "角色库", query: "canvas" }).map(row => row.asset.id), ["a"]);
  assert.deepEqual(filterAssets(rows, { tag: "app:canvas" }).map(row => row.asset.id), ["a"]);
  assert.deepEqual(filterAssets(rows, { folder: "" }).map(row => row.asset.id), ["b"]);
  assert.deepEqual(filterAssets(rows, { tag: "cool", folder: "角色库" }), []);
});

test("session changes abort asset reads and writes", async () => {
  const s = storage();
  const original = s.api.getEntry;
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  s.api.getEntry = async (...args) => { await paused; return original(...args); };
  const reading = readAsset(s.api, "missing");
  const { resetDocumentStorage, resumeDocumentStorage } = await import("../src/document-storage.ts");
  resetDocumentStorage(s.api);
  release();
  await assert.rejects(reading, { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  resumeDocumentStorage(s.api);
});
