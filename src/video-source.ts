import type { CanvasNode } from "./canvas-types.ts";
import { readVideoTask, validateVideoContentBlob, videoTaskPhase, type VideoRequest, type VideoTaskSnapshot } from "./video-generation.ts";
import { readStoredPlatformAsset } from "./platform-asset-library.ts";
import { readLocalVideo } from "./video-cache.ts";

export type VideoSourceApi = { request: VideoRequest };
export type VideoSourceNode = Partial<Pick<CanvasNode, "video" | "localVideo" | "videoContentUrl" | "videoContentUrlExpiresAt" | "taskId" | "assetId" | "status" | "type" | "mediaType">>;
export type ResolvedVideoSource = { url: string; assetId?: string; urlExpiresAt?: string; release?: () => void };
export type VideoSourceOptions = { forceRefresh?: boolean; now?: number; minValidityMs?: number; signal?: AbortSignal };
export type VideoSourceReadProgress = { loadedBytes: number; totalBytes?: number };
export type VideoSourceBlobOptions = VideoSourceOptions & {
  fetchResource?: typeof fetch;
  maxBytes?: number;
  onProgress?: (progress: VideoSourceReadProgress) => void;
};

export class VideoSourceError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VideoSourceError"; this.code = code; this.status = options.status;
  }
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" ? value as RecordValue : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const local = (url: string) => url.startsWith("blob:") || /^data:video\//i.test(url);
const contentTask = (url: string): string | undefined => /(?:^|\/)videos\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/content(?:[?#]|$)/.exec(url)?.[1];
const stableTask = (node: VideoSourceNode) => node.taskId || contentTask(node.videoContentUrl || "") || contentTask(node.video || "");
function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("视频读取已取消", "AbortError");
}

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("视频读取已取消", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("视频读取已取消", "AbortError"));
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

function directUrl(url: string): boolean {
  if (local(url)) return true;
  if (contentTask(url)) return false;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

/** Older documents did not retain expiry metadata; recognize COS/S3 signed URL clocks too. */
function inferredExpiration(url: string): number | undefined {
  try {
    const params = new Map([...new URL(url).searchParams].map(([key, value]) => [key.toLowerCase(), value]));
    const signTime = params.get("q-sign-time") || params.get("q-key-time");
    if (signTime) {
      const value = Number(signTime.split(";")[1]);
      if (Number.isFinite(value) && value > 0) return value * 1000;
    }
    const signedDate = params.get("x-amz-date") || params.get("x-goog-date");
    const duration = Number(params.get("x-amz-expires") || params.get("x-goog-expires"));
    if (signedDate && Number.isFinite(duration) && duration > 0) {
      const date = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(signedDate);
      if (date) return Date.UTC(+date[1], +date[2] - 1, +date[3], +date[4], +date[5], +date[6]) + duration * 1000;
    }
    const value = Number(params.get("expires"));
    if (Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  } catch { /* Invalid URLs are handled by the caller. */ }
  return undefined;
}

export function videoSourceNeedsRefresh(source: ResolvedVideoSource, now = Date.now(), minValidityMs = 30_000): boolean {
  if (local(source.url)) return false;
  if (!directUrl(source.url)) return true;
  const explicit = source.urlExpiresAt ? Date.parse(source.urlExpiresAt) : undefined;
  if (explicit !== undefined && !Number.isFinite(explicit)) return true;
  const inferred = inferredExpiration(source.url);
  const expiry = explicit === undefined ? inferred : inferred === undefined ? explicit : Math.min(explicit, inferred);
  return expiry !== undefined && expiry <= now + Math.max(0, minValidityMs);
}

function metadataError(error: unknown): unknown {
  const body = record(error), details = record(body.details), nested = record(body.error);
  const code = text(body.code) || text(nested.code) || text(details.code);
  const status = Number(body.status || body.statusCode || body.status_code);
  if ([404, 410].includes(status) || ["media_asset_not_found", "media_asset_expired", "video_task_not_found", "video_not_found"].includes(code)) {
    return new VideoSourceError("视频资产已删除或过期，无法读取。", "VIDEO_ASSET_NOT_FOUND", { status: status || 404, cause: error });
  }
  return error;
}

// Multiple canvas nodes can point at the same platform asset. Keep the last
// delivered URL per API session so viewport warming and gallery recovery do
// not issue duplicate metadata reads for the same asset. The cache is scoped
// by API object, so a different authenticated session cannot reuse it.
const deliveredSourceCache = new WeakMap<VideoSourceApi, Map<string, ResolvedVideoSource>>();
const DELIVERED_SOURCE_CACHE_MAX_ENTRIES = 128;
type PendingTaskRead = { promise: Promise<VideoTaskSnapshot>; force: boolean };
const pendingTaskReads = new WeakMap<VideoSourceApi, Map<string, PendingTaskRead>>();
const sourceCacheKey = (node: VideoSourceNode, taskId: string | undefined) =>
  node.assetId ? `asset:${node.assetId}` : taskId ? `task:${taskId}` : undefined;
function readCachedSource(api: VideoSourceApi, key: string | undefined, options: VideoSourceOptions): ResolvedVideoSource | undefined {
  if (!key || options.forceRefresh) return undefined;
  const cached = deliveredSourceCache.get(api)?.get(key);
  if (!cached || videoSourceNeedsRefresh(cached, options.now, options.minValidityMs)) return undefined;
  const cache = deliveredSourceCache.get(api);
  cache?.delete(key);
  cache?.set(key, cached);
  return cached;
}
function writeCachedSource(api: VideoSourceApi, key: string | undefined, source: ResolvedVideoSource): void {
  if (!key) return;
  let cache = deliveredSourceCache.get(api);
  if (!cache) { cache = new Map(); deliveredSourceCache.set(api, cache); }
  cache.delete(key);
  cache.set(key, source);
  while (cache.size > DELIVERED_SOURCE_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

function readVideoTaskShared(api: VideoSourceApi, taskId: string, force: boolean, signal?: AbortSignal): Promise<VideoTaskSnapshot> {
  let pending = pendingTaskReads.get(api);
  if (!pending) {
    pending = new Map();
    pendingTaskReads.set(api, pending);
  }
  const current = pending.get(taskId);
  // A forced refresh replaces an ordinary stale read, while all callers still
  // await the same transport request for the current generation.
  if (current && (!force || current.force)) return waitForSignal(current.promise, signal);
  const promise = readVideoTask(api.request, taskId);
  const entry = { promise, force } satisfies PendingTaskRead;
  pending.set(taskId, entry);
  void promise.then(
    () => { if (pending?.get(taskId) === entry) pending.delete(taskId); },
    () => { if (pending?.get(taskId) === entry) pending.delete(taskId); },
  );
  return waitForSignal(promise, signal);
}

/** Reuse a delivered URL; when necessary refresh the existing business resource, never a signing endpoint. */
export async function resolveVideoSource(api: VideoSourceApi, node: VideoSourceNode, options: VideoSourceOptions = {}): Promise<ResolvedVideoSource> {
  aborted(options.signal);
  if (node.localVideo) {
    const blob = await readLocalVideo(node.localVideo);
    aborted(options.signal);
    if (blob) {
      const url = URL.createObjectURL(blob);
      return { url, release: () => URL.revokeObjectURL(url) };
    }
    // Cache keys are browser-local hints. A task/asset identity remains the
    // cross-device source of truth when this browser has no matching bytes.
    if (!node.assetId && !stableTask(node))
      throw new VideoSourceError("本机视频未找到，请回到添加时使用的浏览器或重新导入完整画布备份。", "VIDEO_LOCAL_MISSING");
  }
  const candidates = [node.videoContentUrl, node.video].filter((url): url is string => Boolean(url));
  // Local imported/exported bytes do not belong to the remote task lifecycle.
  const localUrl = candidates.find(local);
  if (localUrl) return { url: localUrl };
  if (!options.forceRefresh) {
    for (const url of candidates) {
      const source = { url, ...(node.assetId ? { assetId: node.assetId } : {}), ...(node.videoContentUrlExpiresAt ? { urlExpiresAt: node.videoContentUrlExpiresAt } : {}) };
      if (!videoSourceNeedsRefresh(source, options.now, options.minValidityMs)) {
        writeCachedSource(api, sourceCacheKey(node, stableTask(node)), source);
        return source;
      }
    }
  }
  const taskId = stableTask(node);
  if (!node.assetId && !taskId) {
    // A public URL has no metadata identity to refresh. Retrying the same URL
    // is valid, but an expired signed URL without identity cannot be repaired.
    const url = candidates.find(candidate => !videoSourceNeedsRefresh({ url: candidate, urlExpiresAt: node.videoContentUrlExpiresAt }, options.now, options.minValidityMs));
    if (url) return { url, ...(node.videoContentUrlExpiresAt ? { urlExpiresAt: node.videoContentUrlExpiresAt } : {}) };
    throw new VideoSourceError("视频地址已失效或缺失，且没有可恢复的资产或任务标识。", "VIDEO_SOURCE_MISSING");
  }
  const cacheKey = sourceCacheKey(node, taskId);
  const cached = readCachedSource(api, cacheKey, options);
  if (cached) return cached;
  if (options.forceRefresh && cacheKey) deliveredSourceCache.get(api)?.delete(cacheKey);
  let source: ResolvedVideoSource;
  try {
    if (node.assetId) {
      if (!node.assetId.trim() || node.assetId !== node.assetId.trim() || node.assetId.length > 256) throw new VideoSourceError("视频资产 ID 无效。", "VIDEO_ASSET_INVALID_ID");
      // Share the short-lived asset detail read with previews, downloads and
      // asset-library panels. Each caller still gets an abortable wait, while
      // one in-flight request serves all consumers of the same asset ID.
      const asset = record(await readStoredPlatformAsset(api, node.assetId, { forceRefresh: options.forceRefresh, signal: options.signal }));
      aborted(options.signal);
      if (asset.id !== node.assetId) throw new VideoSourceError("媒体资产服务返回了错误的身份。", "VIDEO_ASSET_INVALID_RESPONSE");
      const kind = text(asset.type) || text(asset.content_type);
      if (kind && kind !== "video" && !kind.startsWith("video/")) throw new VideoSourceError("该资产不是视频。", "VIDEO_ASSET_INVALID_TYPE");
      const status = text(asset.status || asset.asset_status).toLowerCase();
      if (["deleted", "expired"].includes(status)) throw new VideoSourceError("视频资产已删除或过期，无法读取。", "VIDEO_ASSET_NOT_FOUND");
      if (status && !["ready", "active", "completed", "succeeded"].includes(status)) throw new VideoSourceError("视频资产尚未就绪，请稍后重试。", "VIDEO_ASSET_NOT_READY");
      source = { url: text(asset.url), assetId: node.assetId, ...(text(asset.url_expires_at) ? { urlExpiresAt: text(asset.url_expires_at) } : {}) };
    } else {
      const snapshot = await readVideoTaskShared(api, taskId!, Boolean(options.forceRefresh), options.signal);
      aborted(options.signal);
      const phase = videoTaskPhase(snapshot.status, { code: snapshot.code, phase: snapshot.phase, assetStatus: snapshot.assetStatus, supplierConfirmationState: snapshot.supplierConfirmation?.state });
      if (phase !== "completed") throw new VideoSourceError(snapshot.message || (phase === "failed" ? "视频任务未成功完成，暂无可读取的视频。" : "视频资产尚未就绪，请稍后重试。"), phase === "failed" ? "VIDEO_TASK_FAILED" : "VIDEO_ASSET_NOT_READY");
      source = { url: snapshot.contentUrl, ...(snapshot.assetId ? { assetId: snapshot.assetId } : {}), ...(snapshot.contentUrlExpiresAt ? { urlExpiresAt: snapshot.contentUrlExpiresAt } : {}) };
    }
  } catch (error) {
    aborted(options.signal);
    throw metadataError(error);
  }
  if (!directUrl(source.url)) throw new VideoSourceError("媒体服务尚未返回可直接访问的视频地址，请升级媒体服务后重试。", "VIDEO_SOURCE_UNAVAILABLE");
  // Do not loop if the server itself supplies an already expired address.
  if (videoSourceNeedsRefresh(source, options.now, 0)) throw new VideoSourceError("媒体服务返回的视频地址已过期，请稍后重试。", "VIDEO_SOURCE_EXPIRED");
  writeCachedSource(api, cacheKey, source);
  return source;
}

async function readBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal, onProgress?: VideoSourceBlobOptions["onProgress"]): Promise<Blob> {
  const length = Number(response.headers.get("content-length"));
  const encoding = response.headers.get("content-encoding");
  const totalBytes = (!encoding || encoding === "identity") && Number.isSafeInteger(length) && length > 0 ? length : undefined;
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new VideoSourceError("视频大小超过本次操作的限制。", "VIDEO_CONTENT_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new VideoSourceError("视频内容为空或不可用。", "VIDEO_CONTENT_EMPTY");
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  let lastProgressAt = 0;
  const reportProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 100) return;
    lastProgressAt = now;
    try { onProgress?.({ loadedBytes: size, ...(totalBytes ? { totalBytes } : {}) }); } catch { /* Progress observers must not interrupt media reads. */ }
  };
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      aborted(signal);
      const { done, value } = await reader.read();
      aborted(signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new VideoSourceError("视频大小超过本次操作的限制。", "VIDEO_CONTENT_TOO_LARGE");
      chunks.push(new Uint8Array(value).buffer);
      reportProgress();
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  reportProgress(true);
  if ((!encoding || encoding === "identity") && length > 0 && size !== length) throw new VideoSourceError("视频下载不完整，请重试。", "VIDEO_CONTENT_TRUNCATED");
  return validateVideoContentBlob(new Blob(chunks, { type: response.headers.get("content-type") || "" }));
}

/** For explicit download/export only. Players consume resolveVideoSource().url directly. */
export async function readVideoSourceBlob(api: VideoSourceApi, node: VideoSourceNode, options: VideoSourceBlobOptions = {}): Promise<Blob> {
  const maxBytes = options.maxBytes ?? 500 * 1024 * 1024;
  if (!(maxBytes > 0)) throw new VideoSourceError("视频下载大小限制无效。", "VIDEO_CONTENT_INVALID_LIMIT");
  if (node.localVideo) {
    aborted(options.signal);
    const blob = await readLocalVideo(node.localVideo);
    aborted(options.signal);
    if (blob) {
      if (blob.size > maxBytes) throw new VideoSourceError("视频大小超过本次操作的限制。", "VIDEO_CONTENT_TOO_LARGE");
      try { options.onProgress?.({ loadedBytes: blob.size, totalBytes: blob.size }); } catch { /* Progress observers must not interrupt media reads. */ }
      return validateVideoContentBlob(blob);
    }
    if (!node.assetId && !stableTask(node))
      throw new VideoSourceError("本机视频未找到，请重新导入完整画布备份。", "VIDEO_LOCAL_MISSING");
  }
  const fetchResource = options.fetchResource || fetch;
  let source = await resolveVideoSource(api, node, options);
  const canRefresh = Boolean(node.assetId || stableTask(node) || source.assetId) && !local(source.url);
  for (let attempt = 0; ; attempt++) {
    aborted(options.signal);
    try {
      // The signed URL is the only authorization COS needs. Never forward the
      // app session, cookies, SDK headers or the signed page URL as a referrer.
      const response = await fetchResource(source.url, { signal: options.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (options.signal?.aborted) await response.body?.cancel().catch(() => {});
      aborted(options.signal);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new VideoSourceError(`视频下载失败（HTTP ${response.status}）。`, "VIDEO_CONTENT_HTTP_ERROR", { status: response.status });
      }
      return await readBoundedResponse(response, maxBytes, options.signal, options.onProgress);
    } catch (error) {
      aborted(options.signal);
      if (attempt > 0 || !canRefresh || (error instanceof VideoSourceError && error.code === "VIDEO_CONTENT_TOO_LARGE")) throw error;
      // A signature may have expired during a long-running view. Refresh at
      // most once through the same authorized detail endpoint, never POST.
      source = await resolveVideoSource(api, { ...node, assetId: source.assetId || node.assetId }, { ...options, forceRefresh: true });
    }
  }
}
