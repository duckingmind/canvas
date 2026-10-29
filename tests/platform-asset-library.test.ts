import assert from "node:assert/strict";
import test from "node:test";
import { deletePlatformAsset, listPlatformAssets, platformAssetToRow, readPlatformAsset, readStoredPlatformAsset, removePlatformAsset, resolvePlatformVoiceIdentity, savePlatformAsset, setPlatformAssetLibraryMembership, uploadDurablePlatformAsset, type PlatformAssetApi } from "../src/platform-asset-library.ts";
import type { StoredAsset } from "../src/canvas-types.ts";

const now = "2026-09-19T00:00:00.000Z";
function dto(overrides: Partial<StoredAsset> = {}): StoredAsset {
  return {
    id: "asset-one", task_id: "task-one", type: "image", model: "image-model", size_bytes: 200,
    url: "https://cdn.example.com/a?token=temporary", created_at: now, updated_at: now,
    name: "角色三视图", category: "person", tags: ["古装"], folder: "角色", saved_to_library: true,
    metadata_revision: 0, source_app_id: "canvas", system_tags: ["app:canvas", "type:image", "source:generated"],
    ...overrides,
  };
}
function api(response: unknown | ((path: string, options?: RequestInit) => unknown)) {
  const calls: { path: string; options?: RequestInit }[] = [];
  const client: PlatformAssetApi = {
    request: async <T>(path: string, options?: RequestInit) => {
      calls.push({ path, options });
      return (typeof response === "function" ? response(path, options) : response) as T;
    },
  };
  return { client, calls };
}

test("platform metadata retains stable media identity and accepts revision zero without persisting signed URLs", () => {
  const row = platformAssetToRow(dto());
  assert.equal(row.revision, 0);
  assert.equal(row.asset.id, "media:asset-one");
  assert.deepEqual(row.asset.source, { type: "platform", assetId: "asset-one", taskId: "task-one", mediaType: "image" });
  assert.equal(row.asset.sourceAppId, "canvas");
  assert.deepEqual(row.asset.systemTags, ["app:canvas", "type:image", "source:generated"]);
  assert.equal(JSON.stringify(row).includes("temporary"), false);
  assert.equal(platformAssetToRow(dto({ saved_to_library: false, name: "" })).asset.name, "未命名图片");
});

test("platform audio model identifies voice design and TTS without classifying ordinary music", () => {
  const voice = platformAssetToRow(dto({ id: "voice-asset", type: "audio", model: "MiniMax-Voice-Design" }));
  const tts = platformAssetToRow(dto({ id: "tts-asset", type: "audio", model: "MiniMax-Speech-2.8-HD" }));
  const music = platformAssetToRow(dto({ id: "music-asset", type: "audio", model: "minimax-music-2.5" }));
  assert.equal(voice.asset.source.type, "platform");
  assert.equal(voice.asset.source.audioTaskType, "voice_design");
  assert.equal(tts.asset.source.type, "platform");
  assert.equal(tts.asset.source.audioTaskType, "tts");
  assert.equal(music.asset.source.type, "platform");
  assert.equal(music.asset.source.audioTaskType, undefined);
});

test("platform voice asset resolves voice ID from its dedicated task endpoint", async () => {
  const a = api({ id: "task-one", model: "minimax-voice-design", status: "completed", voice_id: "voice-stable" });
  const row = platformAssetToRow(dto({ type: "audio", model: "minimax-voice-design" }));
  const source = await resolvePlatformVoiceIdentity(a.client, row.asset.source);
  assert.equal(a.calls[0].path, "/voice-design/tasks/task-one");
  assert.deepEqual(source, { ...row.asset.source, voiceId: "voice-stable" });
});

test("platform voice asset does not attach an uncompleted or invalid voice identity", async () => {
  const row = platformAssetToRow(dto({ type: "audio", model: "minimax-voice-design" }));
  const pending = await resolvePlatformVoiceIdentity(api({ id: "task-one", status: "in_progress", voice_id: "not-ready" }).client, row.asset.source);
  const invalid = await resolvePlatformVoiceIdentity(api({ id: "task-one", status: "completed", voice_id: "  " }).client, row.asset.source);
  assert.equal(pending.voiceId, undefined);
  assert.equal(invalid.voiceId, undefined);
});

test("platform lists include generated media while preserving explicit library filtering", async () => {
  const a = api({ items: [dto(), dto({ id: "unsaved", saved_to_library: false })], total: 45, page: 2, limit: 20 });
  const result = await listPlatformAssets(a.client, { page: 2, limit: 20, query: " 角色 ", tag: " 古装 ", category: "person", folder: "", kind: "image" });
  const url = new URL(a.calls[0].path, "https://api.example.com");
  assert.deepEqual(Object.fromEntries(url.searchParams), { page: "2", limit: "20", query: "角色", tag: "古装", folder: "", type: "image", category: "person" });
  assert.deepEqual(result.items.map(row => row.asset.id), ["media:asset-one", "media:unsaved"]);
  assert.equal(result.hasMore, true);
  const unfiltered = api({ items: [dto({ saved_to_library: false })], total: 1, page: 1, limit: 48 });
  assert.equal((await listPlatformAssets(unfiltered.client, { taskId: "task-one", savedToLibrary: "all" })).items.length, 1);
  const query = new URL(unfiltered.calls[0].path, "https://api.example.com").searchParams;
  assert.equal(query.get("task_id"), "task-one");
  assert.equal(query.has("saved_to_library"), false);
});

test("old media responses are not silently treated as saved library assets", async () => {
  const old = dto({ saved_to_library: undefined, metadata_revision: undefined });
  assert.throws(() => platformAssetToRow(old), { code: "CANVAS_PLATFORM_ASSETS_UNSUPPORTED" });
  const a = api({ items: [old], total: 1, page: 1, limit: 48 });
  await assert.rejects(listPlatformAssets(a.client), { code: "CANVAS_PLATFORM_ASSETS_UNSUPPORTED" });
});

test("read refreshes the URL via the authorized application API", async () => {
  const thumbnailUrl = "https://cdn.example.com/a-thumb?token=temporary";
  const a = api(dto({ url_expires_at: "2026-10-08T01:00:00Z", thumbnail_url: thumbnailUrl }));
  const result = await readPlatformAsset(a.client, "asset-one");
  assert.equal(a.calls[0].path, "/media/assets/asset-one");
  assert.equal(result.url, dto().url);
  assert.equal(result.thumbnailUrl, thumbnailUrl);
  assert.equal(result.row.revision, 0);
  assert.equal(result.urlExpiresAt, "2026-10-08T01:00:00Z");
  await assert.rejects(readPlatformAsset(api(dto({ id: "wrong" })).client, "asset-one"), /错误的身份/);
});

test("permanent media deletion uses the app-scoped endpoint and requires acknowledgement", async () => {
  const a = api(() => ({ deleted: true }));
  await deletePlatformAsset(a.client, "asset-one");
  assert.deepEqual(a.calls, [{ path: "/media/assets/asset-one", options: { method: "DELETE" } }]);
  await assert.rejects(deletePlatformAsset(api(() => ({ deleted: false })).client, "asset-one"), /删除尚未确认/);
});

test("asset detail reads are shared across callers and expire after a short window", async () => {
  let calls = 0;
  let release!: (asset: StoredAsset) => void;
  const pending = new Promise<StoredAsset>(resolve => { release = resolve; });
  const a = api(() => { calls += 1; return pending; });
  const first = readStoredPlatformAsset(a.client, "asset-one");
  const second = readStoredPlatformAsset(a.client, "asset-one");
  assert.equal(calls, 1);
  release(dto({ url_expires_at: "2099-01-01T00:00:00Z" }));
  assert.equal((await first).url, dto().url);
  assert.equal((await second).url, dto().url);
  assert.equal((await readStoredPlatformAsset(a.client, "asset-one")).url, dto().url);
  assert.equal(calls, 1);
});

test("a cancelled asset waiter does not cancel another caller or poison the cache", async () => {
  let calls = 0;
  let release!: (asset: StoredAsset) => void;
  const pending = new Promise<StoredAsset>(resolve => { release = resolve; });
  const a = api(() => { calls += 1; return pending; });
  const controller = new AbortController();
  const cancelled = readStoredPlatformAsset(a.client, "asset-one", { signal: controller.signal });
  const survivor = readStoredPlatformAsset(a.client, "asset-one");
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  release(dto({ url_expires_at: "2099-01-01T00:00:00Z" }));
  await survivor;
  assert.equal(calls, 1);
  assert.equal(a.calls[0].options, undefined);
});

test("a forced refresh invalidates the old value for concurrent callers", async () => {
  let calls = 0;
  let release!: (asset: StoredAsset) => void;
  const pending = new Promise<StoredAsset>(resolve => { release = resolve; });
  const a = api(() => calls++ === 0 ? dto({ url: "https://cdn.example.com/old", url_expires_at: "2099-01-01T00:00:00Z" }) : pending);
  await readStoredPlatformAsset(a.client, "asset-one");
  const refreshing = readStoredPlatformAsset(a.client, "asset-one", { forceRefresh: true });
  let normalResolved = false;
  const normal = readStoredPlatformAsset(a.client, "asset-one").then(value => { normalResolved = true; return value; });
  await Promise.resolve();
  assert.equal(normalResolved, false);
  release(dto({ url: "https://cdn.example.com/new", url_expires_at: "2099-01-01T00:00:00Z" }));
  assert.equal((await refreshing).url, "https://cdn.example.com/new");
  assert.equal((await normal).url, "https://cdn.example.com/new");
  assert.equal(calls, 2);
});

test("a forced refresh replaces an ordinary read already in flight", async () => {
  let calls = 0;
  let releaseOld!: (asset: StoredAsset) => void;
  let releaseNew!: (asset: StoredAsset) => void;
  const oldPending = new Promise<StoredAsset>(resolve => { releaseOld = resolve; });
  const newPending = new Promise<StoredAsset>(resolve => { releaseNew = resolve; });
  const a = api(() => calls++ === 0 ? oldPending : newPending);
  const ordinary = readStoredPlatformAsset(a.client, "asset-one");
  const refreshing = readStoredPlatformAsset(a.client, "asset-one", { forceRefresh: true });
  const follower = readStoredPlatformAsset(a.client, "asset-one");
  releaseOld(dto({ url: "https://cdn.example.com/old", url_expires_at: "2099-01-01T00:00:00Z" }));
  assert.equal((await ordinary).url, "https://cdn.example.com/old");
  releaseNew(dto({ url: "https://cdn.example.com/new", url_expires_at: "2099-01-01T00:00:00Z" }));
  assert.equal((await refreshing).url, "https://cdn.example.com/new");
  assert.equal((await follower).url, "https://cdn.example.com/new");
  assert.equal(calls, 2);
  assert.equal((await readStoredPlatformAsset(a.client, "asset-one")).url, "https://cdn.example.com/new");
});

test("an explicit platform asset retry bypasses a fresh cached URL while ordinary reads reuse it", async () => {
  const old = dto({ url: "https://cdn.example.com/old", thumbnail_url: "https://cdn.example.com/old-thumb", url_expires_at: "2099-01-01T00:00:00Z" });
  const fresh = dto({ url: "https://cdn.example.com/new", thumbnail_url: "https://cdn.example.com/new-thumb", url_expires_at: "2099-01-01T00:00:00Z" });
  let reads = 0;
  const a = api(() => ++reads === 1 ? old : fresh);
  assert.equal((await readPlatformAsset(a.client, "asset-one")).url, old.url);
  assert.equal((await readPlatformAsset(a.client, "asset-one")).url, old.url);
  assert.equal(a.calls.length, 1);

  const retried = await readPlatformAsset(a.client, "asset-one", { forceRefresh: true });
  assert.equal(retried.url, fresh.url);
  assert.equal(retried.thumbnailUrl, fresh.thumbnail_url);
  assert.equal(a.calls.length, 2);
  assert.equal((await readPlatformAsset(a.client, "asset-one")).url, fresh.url);
  assert.equal(a.calls.length, 2);
});

test("a platform asset retry replaces an ordinary pending read and prevents its late URL from returning to the cache", async () => {
  let releaseOld!: (asset: StoredAsset) => void;
  let releaseNew!: (asset: StoredAsset) => void;
  const oldPending = new Promise<StoredAsset>(resolve => { releaseOld = resolve; });
  const newPending = new Promise<StoredAsset>(resolve => { releaseNew = resolve; });
  let reads = 0;
  const a = api(() => ++reads === 1 ? oldPending : newPending);
  const ordinary = readPlatformAsset(a.client, "asset-one");
  const retry = readPlatformAsset(a.client, "asset-one", { forceRefresh: true });
  const follower = readPlatformAsset(a.client, "asset-one");
  assert.equal(a.calls.length, 2);

  const fresh = dto({ url: "https://cdn.example.com/new", url_expires_at: "2099-01-01T00:00:00Z" });
  releaseNew(fresh);
  assert.equal((await retry).url, fresh.url);
  assert.equal((await follower).url, fresh.url);
  releaseOld(dto({ url: "https://cdn.example.com/old", url_expires_at: "2099-01-01T00:00:00Z" }));
  assert.equal((await ordinary).url, "https://cdn.example.com/old");
  assert.equal((await readPlatformAsset(a.client, "asset-one")).url, fresh.url);
  assert.equal(a.calls.length, 2);
});

test("save patches only editable metadata and revision, never provenance or media identity", async () => {
  const a = api(dto({ metadata_revision: 1 }));
  const row = platformAssetToRow(dto());
  const saved = await savePlatformAsset(a.client, {
    ...row.asset, name: " 角色三视图 ", tags: [" 古装 ", "古装", "Hero", "hero"], folder: " 角色 ",
    sourceAppId: "different-app", systemTags: ["app:different-app"], prompt: "private prompt",
  }, 0);
  assert.equal(saved.revision, 1);
  assert.equal(a.calls[0].path, "/media/assets/asset-one");
  assert.equal(a.calls[0].options?.method, "PATCH");
  assert.deepEqual(JSON.parse(a.calls[0].options?.body as string), {
    expected_revision: 0, name: "角色三视图", category: "person", tags: ["古装", "Hero"], folder: "角色", saved_to_library: true,
  });
});

test("save validates bounded metadata before calling the API", async () => {
  const a = api(dto()), row = platformAssetToRow(dto());
  for (const changes of [{ name: " " }, { name: "字".repeat(101) }, { folder: "字".repeat(101) }, { tags: ["字".repeat(41)] }, { tags: ["app:canvas"] }]) {
    await assert.rejects(savePlatformAsset(a.client, { ...row.asset, ...changes }, 0), { code: "CANVAS_ASSET_INVALID" });
  }
  await assert.rejects(savePlatformAsset(a.client, row.asset, -1), { code: "CANVAS_ASSET_INVALID" });
  assert.equal(a.calls.length, 0);
});

test("remove patches library membership with CAS and leaves file deletion untouched", async () => {
  const a = api(dto({ saved_to_library: false, metadata_revision: 2 }));
  const removed = await removePlatformAsset(a.client, platformAssetToRow(dto({ metadata_revision: 1 })));
  assert.equal(removed.revision, 2);
  assert.equal(a.calls[0].options?.method, "PATCH");
  assert.deepEqual(JSON.parse(a.calls[0].options?.body as string), { expected_revision: 1, saved_to_library: false });
});

test("membership actions preserve row metadata and use a narrow CAS patch", async () => {
  const a = api(dto({ saved_to_library: true, metadata_revision: 4 }));
  const row = platformAssetToRow(dto({ saved_to_library: false, metadata_revision: 3 }));
  const saved = await setPlatformAssetLibraryMembership(a.client, row, true);
  assert.equal(saved.savedToLibrary, true);
  assert.equal(saved.asset.name, row.asset.name);
  assert.deepEqual(JSON.parse(a.calls[0].options?.body as string), { expected_revision: 3, saved_to_library: true });
});

test("authorization and conflict errors propagate without a KV fallback", async () => {
  const conflict = Object.assign(new Error("Concurrent change"), { code: "media_asset_revision_conflict", status: 409 });
  const denied = Object.assign(new Error("Forbidden"), { status: 403 });
  const row = platformAssetToRow(dto());
  await assert.rejects(savePlatformAsset(api(() => { throw conflict; }).client, row.asset, 0), error => error === conflict);
  await assert.rejects(listPlatformAssets(api(() => { throw denied; }).client), error => error === denied);
  await assert.rejects(readPlatformAsset(api(() => { throw denied; }).client, "asset-one"), error => error === denied);
});

test("small durable images use the COS direct-upload handshake", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "small.png", { type: "image/png" });
  const small = dto({ id: "small-image", size_bytes: file.size, content_type: file.type });
  const a = api((path) => path === "/media/assets/upload-intents"
    ? { asset_id: small.id, status: "pending", upload_url: "https://cos.example.test/staging", size_bytes: file.size, content_type: file.type }
    : small);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    const uploaded = await uploadDurablePlatformAsset(a.client, { file, name: file.name, category: "other" });
    assert.equal(uploaded.size_bytes, file.size);
    assert.deepEqual(a.calls.map(call => [call.path, call.options?.method]), [
      ["/media/assets/upload-intents", "POST"],
      [`/media/assets/${small.id}/complete`, "POST"],
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("large durable images also use the COS direct-upload handshake", async () => {
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "large.png", { type: "image/png" });
  const direct = dto({ id: "direct-large-image", type: "image", size_bytes: file.size, content_type: file.type });
  const a = api((path) => {
    if (path === "/media/assets/upload-intents") return { asset_id: direct.id, status: "pending", upload_url: "https://cos.example.test/staging", size_bytes: file.size, content_type: file.type };
    if (path === `/media/assets/${direct.id}/complete`) return direct;
    throw new Error(`unexpected path ${path}`);
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    const uploaded = await uploadDurablePlatformAsset(a.client, { file, name: file.name, category: "other", idempotencyKey: "canvas-direct-large-image" });
    assert.equal(uploaded.id, direct.id);
    assert.deepEqual(a.calls.map(call => [call.path, call.options?.method]), [
      ["/media/assets/upload-intents", "POST"],
      [`/media/assets/${direct.id}/complete`, "POST"],
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("large and non-image uploads use the COS direct-upload handshake", async () => {
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "large.mp4", { type: "video/mp4" });
  const direct = dto({ id: "direct-video", type: "video", size_bytes: file.size, content_type: file.type, task_id: undefined });
  const a = api((path) => {
    if (path === "/media/assets/upload-intents") return { asset_id: direct.id, status: "pending", upload_url: "https://cos.example.test/staging", size_bytes: file.size, content_type: file.type };
    if (path === `/media/assets/${direct.id}/complete`) return direct;
    throw new Error(`unexpected path ${path}`);
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    const uploaded = await uploadDurablePlatformAsset(a.client, { file, name: file.name, category: "other", idempotencyKey: "canvas-direct-video" });
    assert.equal(uploaded.id, direct.id);
    assert.deepEqual(a.calls.map(call => [call.path, call.options?.method]), [
      ["/media/assets/upload-intents", "POST"],
      [`/media/assets/${direct.id}/complete`, "POST"],
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("an upload-intent 404 propagates without replaying bytes through Gateway", async () => {
  const file = new File([new Uint8Array([1])], "missing.png", { type: "image/png" });
  const missing = Object.assign(new Error("asset does not exist"), { status: 404, code: "media_asset_not_found" });
  const a = api(() => { throw missing; });
  await assert.rejects(uploadDurablePlatformAsset(a.client, { file, idempotencyKey: "canvas-missing-asset" }), error => error === missing);
  assert.deepEqual(a.calls.map(call => call.path), ["/media/assets/upload-intents"]);
});

test("direct upload does not fall back to multipart for a storage outage", async () => {
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "outage.mp4", { type: "video/mp4" });
  const unavailable = Object.assign(new Error("COS unavailable"), { status: 503, code: "media_storage_unavailable" });
  const a = api(() => { throw unavailable; });
  await assert.rejects(uploadDurablePlatformAsset(a.client, { file, idempotencyKey: "canvas-storage-outage" }), error => error === unavailable);
  assert.deepEqual(a.calls.map(call => call.path), ["/media/assets/upload-intents"]);
});

test("a transient completion failure keeps the uploaded intent for safe reconciliation", async () => {
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "reconcile.mp4", { type: "video/mp4" });
  const completionFailure = Object.assign(new Error("Gateway temporarily unavailable"), { status: 503, code: "media_storage_unavailable" });
  const a = api((path) => {
    if (path === "/media/assets/upload-intents") return { asset_id: "direct-reconcile", status: "pending", upload_url: "https://cos.example.test/staging", size_bytes: file.size, content_type: file.type };
    if (path === "/media/assets/direct-reconcile/complete") throw completionFailure;
    throw new Error(`unexpected abort or multipart path ${path}`);
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    await assert.rejects(uploadDurablePlatformAsset(a.client, { file, idempotencyKey: "canvas-complete-reconcile" }), error => error === completionFailure);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(a.calls.map(call => [call.path, call.options?.method]), [
    ["/media/assets/upload-intents", "POST"],
    ["/media/assets/direct-reconcile/complete", "POST"],
  ]);
});

test("a COS transfer failure does not replay large bytes through multipart", async () => {
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "failed.mp4", { type: "video/mp4" });
  const a = api((path) => {
    if (path === "/media/assets/upload-intents") return { asset_id: "direct-failed", status: "pending", upload_url: "https://cos.example.test/staging", size_bytes: file.size, content_type: file.type };
    if (path === "/media/assets/direct-failed/upload-intent") return { aborted: true };
    throw new Error(`unexpected multipart or completion path ${path}`);
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try {
  await assert.rejects(uploadDurablePlatformAsset(a.client, { file, idempotencyKey: "canvas-cos-failure" }), { code: "APP_MEDIA_DIRECT_UPLOAD_FAILED" });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(a.calls.map(call => [call.path, call.options?.method]), [
    ["/media/assets/upload-intents", "POST"],
    ["/media/assets/direct-failed/upload-intent", "DELETE"],
  ]);
});

test("an invalid pending upload intent is aborted so its quota reservation can be released", async () => {
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "mismatch.mp4", { type: "video/mp4" });
  const a = api((path) => {
    if (path === "/media/assets/upload-intents") return { asset_id: "direct-mismatch", status: "pending", upload_url: "https://cos.example.test/staging", size_bytes: file.size - 1, content_type: file.type };
    if (path === "/media/assets/direct-mismatch/upload-intent") return { aborted: true };
    throw new Error(`unexpected path ${path}`);
  });
  await assert.rejects(uploadDurablePlatformAsset(a.client, { file, idempotencyKey: "canvas-invalid-intent" }), { code: "APP_MEDIA_UPLOAD_PROTOCOL_ERROR" });
  assert.deepEqual(a.calls.map(call => [call.path, call.options?.method]), [
    ["/media/assets/upload-intents", "POST"],
    ["/media/assets/direct-mismatch/upload-intent", "DELETE"],
  ]);
});
