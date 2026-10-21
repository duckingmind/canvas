import { kindLabels, normalizeAsset, normalizeAssetTags, type AssetFilters, type AssetRow, type AssetSource, type CanvasAsset } from "./asset-library.ts";
import type { StoredAsset } from "./canvas-types.ts";
import { readVoiceDesignTask } from "./voice-design.ts";

/** Requests use the signed-in application session; app/user identity never comes from asset metadata. */
export type PlatformAssetApi = {
  request<T = unknown>(path: string, options?: RequestInit): Promise<T>;
};
export type PlatformAssetListOptions = AssetFilters & { page?: number; limit?: number; savedToLibrary?: boolean | "all"; taskId?: string };
export type PlatformAssetPage = { items: AssetRow[]; page: number; limit: number; total: number; hasMore: boolean };
export type PlatformAssetRead = { row: AssetRow; url?: string; thumbnailUrl?: string; urlExpiresAt?: string; storedAsset: StoredAsset };
export type PlatformAssetUploadInput = {
  file: File;
  name?: string;
  category?: string;
  folder?: string;
  tags?: string[];
  idempotencyKey?: string;
};

type AssetReadOptions = { signal?: AbortSignal; forceRefresh?: boolean };
type AssetReadApi = { request(path: string, options?: RequestInit): Promise<unknown> };
type AssetCacheEntry = {
  value?: StoredAsset;
  freshUntil?: number;
  pending?: Promise<StoredAsset>;
  pendingForce?: boolean;
  /** Prevent an older in-flight read from overwriting a completed mutation. */
  generation?: number;
};

// Asset details contain short-lived signed URLs. Keep a small per-client cache
// so canvas cards, previews and downloads share one authorized read while a
// URL is still usable. The WeakMap prevents one signed-in client from sharing
// metadata with another session.
const assetReadCaches = new WeakMap<object, Map<string, AssetCacheEntry>>();
const ASSET_CACHE_TTL_MS = 30_000;
const SIGNED_URL_SAFETY_MS = 30_000;
const ASSET_CACHE_MAX_ENTRIES = 128;
const VOICE_DESIGN_MODEL = "minimax-voice-design";
const TTS_MODEL_PREFIX = "minimax-speech-";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "CANVAS_ASSET_INVALID" });
}

function metadataRevision(revision: unknown): number {
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) invalid("媒体资产版本无效，请重新读取资产。");
  return revision as number;
}

function requireMetadata(asset: StoredAsset): void {
  if (!asset || typeof asset.saved_to_library !== "boolean" || asset.metadata_revision === undefined) {
    throw Object.assign(new Error("当前平台尚未支持媒体资产库元数据，请升级媒体服务后重试。"), {
      code: "CANVAS_PLATFORM_ASSETS_UNSUPPORTED",
    });
  }
  metadataRevision(asset.metadata_revision);
}

function assetPath(id: string): string {
  if (typeof id !== "string" || !id.trim() || id !== id.trim() || id.length > 256) invalid("媒体资产 ID 无效。");
  return `/media/assets/${encodeURIComponent(id)}`;
}

function cacheFor(api: AssetReadApi): Map<string, AssetCacheEntry> {
  const key = api as object;
  let cache = assetReadCaches.get(key);
  if (!cache) {
    cache = new Map();
    assetReadCaches.set(key, cache);
  }
  return cache;
}

function trimCache(cache: Map<string, AssetCacheEntry>, preserve: string): void {
  if (cache.size <= ASSET_CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (cache.size <= ASSET_CACHE_MAX_ENTRIES) break;
    if (key === preserve || entry.pending) continue;
    cache.delete(key);
  }
}

function assetFreshUntil(asset: StoredAsset, now: number): number {
  const expiryCandidates = [asset.url_expires_at, asset.expires_at]
    .map(value => value ? Date.parse(value) : NaN)
    .filter(Number.isFinite);
  const signedExpiry = expiryCandidates.length ? Math.min(...expiryCandidates) - SIGNED_URL_SAFETY_MS : undefined;
  const freshUntil = Math.max(now, Math.min(signedExpiry ?? (now + ASSET_CACHE_TTL_MS), now + ASSET_CACHE_TTL_MS));
  return freshUntil;
}

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("媒体资产读取已取消", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("媒体资产读取已取消", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

/**
 * Read the server-owned media record once per client and asset ID. Callers
 * still validate the response for their own domain (video vs. image and
 * metadata support), while all of them share the same in-flight request.
 */
export async function readStoredPlatformAsset(api: AssetReadApi, assetId: string, options: AssetReadOptions = {}): Promise<StoredAsset> {
  const path = assetPath(assetId);
  const cache = cacheFor(api);
  const now = Date.now();
  const entry = cache.get(assetId) || {};
  entry.generation = entry.generation || 0;
  cache.set(assetId, entry);
  if (!options.forceRefresh && entry.value && (entry.freshUntil || 0) > now) return entry.value;
  // A forced refresh invalidates the previously delivered signed URL before
  // starting the replacement read. Otherwise a concurrent non-forced caller
  // could observe the stale value while the refresh is still in flight.
  // A forced read must not join an ordinary stale read already in flight. It
  // starts a replacement generation; existing waiters may finish their old
  // read, but that result cannot repopulate this cache entry.
  if (options.forceRefresh && (!entry.pending || !entry.pendingForce)) {
    entry.generation = (entry.generation || 0) + 1;
    entry.value = undefined;
    entry.freshUntil = undefined;
    entry.pending = undefined;
    entry.pendingForce = undefined;
  }
  if (!entry.pending) {
    const generation = entry.generation || 0;
    entry.generation = generation;
    // The request is shared by all callers. Do not pass one caller's signal to
    // the transport: cancelling that caller must not abort every other waiter.
    // Each caller remains independently abortable through waitForSignal.
    const request = api.request(path) as Promise<StoredAsset>;
    const pending = request.then(value => {
      // Do not retain malformed responses. This lets the next attempt receive
      // a fresh response instead of repeating a bad identity from the cache.
      if (entry.generation === generation && value?.id === assetId) {
        entry.value = value;
        entry.freshUntil = assetFreshUntil(value, Date.now());
      } else if (entry.generation === generation) {
        entry.value = undefined;
        entry.freshUntil = undefined;
      }
      return value;
    }).finally(() => {
      if (entry.pending === pending) {
        entry.pending = undefined;
        entry.pendingForce = undefined;
      }
      if (!entry.value && !entry.pending && cache.get(assetId) === entry) cache.delete(assetId);
    });
    entry.pending = pending;
    entry.pendingForce = Boolean(options.forceRefresh);
    trimCache(cache, assetId);
  }
  return waitForSignal(entry.pending, options.signal);
}

/** Drop a cached delivery after an external delete or account reset. */
export function invalidateStoredPlatformAsset(api: AssetReadApi, assetId: string): void {
  const cache = cacheFor(api);
  const entry = cache.get(assetId);
  if (!entry) return;
  // Keep the entry object alive while a shared read is pending, but make its
  // result unable to repopulate the cache after this invalidation.
  entry.generation = (entry.generation || 0) + 1;
  entry.value = undefined;
  entry.freshUntil = undefined;
  entry.pending = undefined;
  entry.pendingForce = undefined;
  cache.delete(assetId);
}

/** URLs are intentionally absent from the reusable record; refresh them by stable media ID when used. */
export function platformAssetToRow(storedAsset: StoredAsset): AssetRow {
  requireMetadata(storedAsset);
  const kind = storedAsset.type;
  if (kind !== "image" && kind !== "video" && kind !== "audio") invalid("媒体资产类型不受支持。");
  assetPath(storedAsset.id);
  const asset = normalizeAsset({
    schemaVersion: 1,
    id: `media:${storedAsset.id}`,
    name: storedAsset.name?.trim() || `未命名${kindLabels[kind]}`,
    kind,
    category: storedAsset.category || "other",
    tags: normalizeAssetTags(storedAsset.tags ?? []),
    folder: storedAsset.folder ?? "",
    sourceAppId: storedAsset.source_app_id,
    systemTags: storedAsset.system_tags ?? [],
    createdAt: storedAsset.created_at,
    updatedAt: storedAsset.updated_at || storedAsset.created_at,
    source: {
      type: "platform", assetId: storedAsset.id, mediaType: kind,
      ...(storedAsset.task_id ? { taskId: storedAsset.task_id } : {}),
      ...(kind === "audio" && storedAsset.model?.trim().toLowerCase() === VOICE_DESIGN_MODEL
        ? { audioTaskType: "voice_design" as const }
        : kind === "audio" && storedAsset.model?.trim().toLowerCase().startsWith(TTS_MODEL_PREFIX)
          ? { audioTaskType: "tts" as const }
          : {}),
    },
    ...(storedAsset.model ? { modelId: storedAsset.model } : {}),
  });
  return {
    asset,
    revision: metadataRevision(storedAsset.metadata_revision),
    savedToLibrary: storedAsset.saved_to_library,
  };
}

/** Recover the durable voice identity from the dedicated task API when a platform asset is inserted. */
export async function resolvePlatformVoiceIdentity(api: PlatformAssetApi, source: AssetSource): Promise<AssetSource> {
  if (source.type !== "platform" || source.mediaType !== "audio" || source.audioTaskType !== "voice_design" || !source.taskId || source.voiceId) return source;
  try {
    const snapshot = await readVoiceDesignTask((path, init) => api.request(path, init), source.taskId);
    const voiceId = snapshot.voiceId?.trim();
    return ["completed", "succeeded", "success"].includes(snapshot.status.toLowerCase()) && voiceId && Array.from(voiceId).length <= 256
      ? { ...source, voiceId }
      : source;
  } catch {
    // The audio asset remains usable if its task record has expired or is temporarily unavailable.
    return source;
  }
}

/** The backend scopes this list to the current application; no caller-controlled ownership filters exist. */
export async function listPlatformAssets(api: PlatformAssetApi, options: PlatformAssetListOptions = {}): Promise<PlatformAssetPage> {
  const page = options.page ?? 1, limit = options.limit ?? 48;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid("媒体资产分页参数无效。");
  if (options.kind === "prompt" || options.category === "prompt") return { items: [], page, limit, total: 0, hasMore: false };
  // Generated media is durable and quota-accounted before the user chooses
  // library metadata. Show it in the asset browser by default; the explicit
  // save action still controls whether it is marked as a curated library
  // item and survives a future saved-only filter.
  const savedToLibrary = options.savedToLibrary ?? "all";
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (savedToLibrary !== "all") params.set("saved_to_library", String(savedToLibrary));
  if (options.taskId?.trim()) params.set("task_id", options.taskId.trim());
  if (options.query?.trim()) params.set("query", options.query.trim());
  if (options.tag?.trim()) params.set("tag", options.tag.trim());
  if (options.folder !== undefined) params.set("folder", options.folder.trim());
  if (options.kind && options.kind !== "all") params.set("type", options.kind);
  if (options.category && options.category !== "all") params.set("category", options.category);
  const result = await api.request<{ items: StoredAsset[]; total: number; page: number; limit: number }>(`/media/assets?${params}`);
  if (!result || !Array.isArray(result.items) || result.items.length > limit || !Number.isSafeInteger(result.total) || result.total < 0) {
    invalid("媒体资产服务返回了无效的列表。");
  }
  for (const asset of result.items) requireMetadata(asset);
  // An older server may ignore a filter. Never promote generated media into library membership.
  const items = result.items.filter(asset => savedToLibrary === "all" || asset.saved_to_library === savedToLibrary).map(platformAssetToRow);
  return { items, page, limit, total: result.total, hasMore: page * limit < result.total };
}

export async function readPlatformAsset(api: PlatformAssetApi, assetId: string, options: AssetReadOptions = {}): Promise<PlatformAssetRead> {
  const storedAsset = await readStoredPlatformAsset(api, assetId, options);
  if (storedAsset?.id !== assetId) invalid("媒体资产服务返回了错误的身份。");
  return { row: platformAssetToRow(storedAsset), url: storedAsset.url, thumbnailUrl: storedAsset.thumbnail_url, urlExpiresAt: storedAsset.url_expires_at, storedAsset };
}

/**
 * Stream a user supplied or locally derived media file to the Gateway-owned
 * asset store. The response is validated here so callers never persist an
 * arbitrary URL or an asset belonging to another media type.
 */
export async function uploadPlatformAsset(api: PlatformAssetApi, input: PlatformAssetUploadInput): Promise<StoredAsset> {
  if (!(input.file instanceof File) || input.file.size <= 0) invalid("上传文件为空，请重新选择媒体文件。");
  if (input.file.size > 100 * 1024 * 1024) invalid("媒体文件不能超过 100 MB。");
  const idempotencyKey = input.idempotencyKey || (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `canvas-upload-${Date.now().toString(36)}`);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) invalid("上传标识无效。");
  const form = new FormData();
  form.append("file", input.file, input.file.name || "media");
  if (input.name?.trim()) form.append("name", input.name.trim());
  if (input.category?.trim()) form.append("category", input.category.trim());
  if (input.folder?.trim()) form.append("folder", input.folder.trim());
  if (input.tags?.length) form.append("tags", JSON.stringify(normalizeAssetTags(input.tags)));
  const asset = await api.request<StoredAsset>("/media/assets", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: form,
  });
  if (!asset || typeof asset.id !== "string" || !asset.id.trim() ||
    !["image", "video", "audio"].includes(asset.type) ||
    asset.size_bytes !== input.file.size || typeof asset.content_type !== "string") {
    invalid("媒体资产服务返回了无效的上传结果。");
  }
  requireMetadata(asset);
  const expectedType = input.file.type.split("/", 1)[0];
  if (expectedType && asset.type !== expectedType) invalid("上传文件类型与平台返回结果不一致。");
  return asset;
}

function platformId(asset: CanvasAsset): string {
  if (asset.source.type !== "platform") invalid("该资产不是平台媒体资产。");
  assetPath(asset.source.assetId);
  return asset.source.assetId;
}

function metadataText(value: unknown, label: string, required: boolean): string {
  if (typeof value !== "string" || (required && !value.trim()) || Array.from(value.trim()).length > 100) {
    invalid(`${label}${required ? "不能为空，且" : ""}不能超过 100 个字符。`);
  }
  return value.trim();
}

async function patchPlatformAsset(api: PlatformAssetApi, assetId: string, payload: Record<string, unknown>): Promise<AssetRow> {
  const result = await api.request<StoredAsset>(assetPath(assetId), {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (result?.id !== assetId) invalid("媒体资产服务返回了错误的身份。");
  // A successful metadata mutation is authoritative for subsequent previews.
  const cache = cacheFor(api);
  const entry = cache.get(assetId) || {};
  entry.generation = (entry.generation || 0) + 1;
  entry.value = result;
  entry.freshUntil = assetFreshUntil(result, Date.now());
  cache.set(assetId, entry);
  return platformAssetToRow(result);
}

/** Media-library metadata has a single source of truth in the media API; never mirror this write into KV. */
export async function savePlatformAsset(api: PlatformAssetApi, asset: CanvasAsset, expectedRevision: number): Promise<AssetRow> {
  const assetId = platformId(asset);
  const expected_revision = metadataRevision(expectedRevision);
  if (!["person", "scene", "object", "style", "sound", "other"].includes(asset.category)) invalid("媒体资产分类无效。");
  return patchPlatformAsset(api, assetId, {
    expected_revision,
    name: metadataText(asset.name, "资产名称", true),
    category: asset.category,
    tags: normalizeAssetTags(asset.tags),
    folder: metadataText(asset.folder ?? "", "资产文件夹", false),
    saved_to_library: true,
  });
}

/** Change only the server-owned library membership bit with CAS semantics. */
export async function setPlatformAssetLibraryMembership(api: PlatformAssetApi, row: AssetRow, savedToLibrary: boolean): Promise<AssetRow> {
  return patchPlatformAsset(api, platformId(row.asset), {
    expected_revision: metadataRevision(row.revision), saved_to_library: savedToLibrary,
  });
}

/** Removing library membership does not delete shared media bytes or canvas references. */
export async function removePlatformAsset(api: PlatformAssetApi, row: AssetRow): Promise<AssetRow> {
  return setPlatformAssetLibraryMembership(api, row, false);
}

/** Permanently remove one app-owned media object and invalidate its signed delivery cache. */
export async function deletePlatformAsset(api: PlatformAssetApi, assetId: string): Promise<void> {
  const result = await api.request<{ deleted?: boolean }>(assetPath(assetId), { method: "DELETE" });
  if (result?.deleted !== true) invalid("媒体删除尚未确认，请刷新列表后重试。");
  invalidateStoredPlatformAsset(api, assetId);
}
