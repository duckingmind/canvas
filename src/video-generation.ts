import { platformFailure } from "./platform-status.ts";
import { videoGenerationParameters } from "./media-request-parameters.ts";
import { mediaTaskPublicState, mediaTaskState, type MediaTaskStateInput } from "./shared/media-task-state.ts";

/** Client for the gateway's asynchronous `/videos` contract. */
export type VideoRequest = (path: string, init?: { method?: string; body?: BodyInit; headers?: Record<string, string>; responseType?: "blob" | "arrayBuffer" | "json" | "auto"; signal?: AbortSignal }) => Promise<unknown>;
export type VideoReference = { type: "image_url" | "audio_url" | "video_url"; url: string };
export type VideoReferenceInput = { type: "image_url" | "audio_url" | "video_url"; url?: string; assetId?: string; mediaType?: "image" | "video" | "audio"; localImage?: string; localVideo?: string; localAudio?: string };
export type VideoGenerationInput = { model: string; prompt: string; images?: string[]; references?: VideoReferenceInput[]; resolveReferences?: (references: VideoReferenceInput[]) => Promise<VideoReference[]>; duration?: number; size?: string; resolution?: string; aspect_ratio?: string; generate_audio?: boolean; taskId?: string; idempotencyKey?: string };
export type VideoGenerationResult = { taskId: string; contentUrl: string; assetId?: string; contentUrlExpiresAt?: string };
export type VideoGenerationOptions = {
  intervalMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  maxConsecutiveReadFailures?: number;
  /** Observe the existing task while the platform resolves an ambiguous submission. */
  observeUnknown?: boolean;
  reconciliationIntervalMs?: number;
  onStatus?: (snapshot: VideoTaskSnapshot) => void | Promise<void>;
  /** Frozen submissions are looked up before any replay, including after lost local media. */
  recovery?: { inputReferencesAvailable: boolean };
};
export type VideoContentOptions = { attempts?: number; delay?: (milliseconds: number) => Promise<void> };
type VideoContainer = { mime: string; name: string };
export type VideoContentDiagnostic = { contentType: string; size: number; container: string; codec: string; signature: string };
const videoContentDiagnostics = new WeakMap<Blob, VideoContentDiagnostic>();

export class VideoGenerationError extends Error {
  readonly taskId?: string; readonly requestId?: string; readonly status?: string; readonly pending: boolean; readonly terminalTask: boolean; readonly code: string;
  constructor(message: string, options: { taskId?: string; requestId?: string; status?: string; pending?: boolean; terminalTask?: boolean; code?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause }); this.name = "VideoGenerationError";
    this.taskId = options.taskId; this.pending = options.pending ?? false; this.terminalTask = options.terminalTask ?? false; this.code = options.code ?? "VIDEO_GENERATION_FAILED";
    const source = record(options.cause), details = record(source.details);
    this.requestId = options.requestId || string(source.requestId) || string(source.request_id) || string(details.request_id) || undefined;
    this.status = options.status || string(source.status) || string(source.task_status) || string(details.status) || undefined;
  }
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" ? value as RecordValue : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
const taskRecord = (value: unknown) => { const body = record(value); return record(body.task || body.data); };
const supplierConfirmationFrom = (value: unknown) => {
  const confirmation = record(taskRecord(value).supplier_confirmation || record(value).supplier_confirmation);
  return {
    state: string(confirmation.state) || undefined,
    status: string(confirmation.status) || undefined,
    source: string(confirmation.source) || undefined,
    reason: string(confirmation.reason) || undefined,
  };
};
const taskIdFrom = (value: unknown) => { const body = record(value), task = taskRecord(value); const id = string(body.task_id) || string(body.id) || string(task.task_id) || string(task.id); return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : undefined; };
const codeFrom = (value: unknown) => { const body = record(value), task = taskRecord(value); const details = record(body.details); return string(task.error_code) || string(record(task.error).code) || string(body.code) || string(body.error_code) || string(record(body.error).code) || string(details.code) || string(details.error_code) || string(record(details.error).code); };
const messageFrom = (value: unknown) => { const body = record(value), task = taskRecord(value); return string(task.error_message) || string(record(task.error).message) || string(record(body.error).message) || string(body.error_message) || string(body.message) || string(record(body.details).message) || string(body.error); };
// Cancellation is asynchronous. Keep the task observable while the provider
// acknowledges the request; only the final cancelled/canceled state is
// terminal.
const terminalStatus = (status: string) => ["failed", "cancelled", "canceled", "expired", "refunded", "unknown_resolution_expired"].includes(status);
const runningStatus = (status: string) => ["created", "quoted", "funds_reserved", "accepted", "pending", "queued", "submitted", "in_progress", "running", "dispatching", "collecting", "cancel_requested", "cancel_pending", "canceling"].includes(status);
const statusCode = (value: unknown) => { const body = record(value); const status = body.status ?? body.statusCode ?? body.status_code; return typeof status === "number" ? status : 0; };
const retryableReadFailure = (value: unknown) => {
  if (platformFailure(value).kind === "login") return false;
  const status = statusCode(value);
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
};
const deterministicFailureCodes = new Set(["invalid_request", "no_eligible_provider", "no_eligible_supplier", "provider_rejected_request", "unknown_resolution_expired", "media_routing_disabled", "media_task_create_failed"]);
function submissionRejected(error: unknown) {
  const body = record(error), details = record(body.details);
  const code = codeFrom(error);
  const message = messageFrom(error).toLowerCase();
  const status = statusCode(error);
  const lifecycle = mediaTaskState({
    status: statusFrom(details) || statusFrom(error),
    code,
    supplierConfirmationState: supplierConfirmationFrom(error).state,
  });
  // A reconciliation response is evidence of an unresolved submission even
  // when a relay wraps it in 4xx or says that lookup is "not supported".
  // Keep the frozen key until an authoritative terminal observation arrives.
  if (lifecycle.requiresReconciliation && !lifecycle.isTerminal) return false;
  // A gateway/client timeout leaves provider admission unknown even when the
  // relay attached a generic error code. Preserve the frozen submission so
  // the same idempotency key can be observed later.
  if (status === 408 || status === 499) return false;
  return deterministicFailureCodes.has(code) || /no eligible|unsupported value|not supported|routing is not enabled|capability verification failed/.test(message) || terminalStatus(string(details.status)) || terminalStatus(string(body.task_status)) || status >= 400 && status < 500 && status !== 408 && status !== 499;
}
function contentFrom(value: unknown, taskId: string): VideoGenerationResult {
  const body = record(value), task = taskRecord(value);
  const assets = Array.isArray(body.assets) ? body.assets : Array.isArray(task.assets) ? task.assets : [];
  const assetId = string(body.asset_id) || string(task.asset_id);
  const candidates = assets.map(record).filter(asset => {
    const type = string(asset.type) || string(asset.content_type);
    return !type || type === "video" || type.startsWith("video/");
  });
  const url = string(body.content_url) || string(body.url) || string(task.content_url) || string(task.url);
  const asset = candidates.find(candidate => assetId && candidate.id === assetId) || candidates.find(candidate => url && candidate.url === url) || candidates[0] || {};
  // Prefer delivered object-store URLs even when an older wrapper still sets
  // content_url to the legacy authenticated content proxy.
  const direct = /^https?:\/\//i.test(url) && !/(?:^|\/)videos\/[^/?]+\/content(?:[?#]|$)/.test(url);
  const contentUrl = direct ? url : string(asset.url) || url || `/videos/${taskId}/content`;
  const selectedId = assetId || string(asset.id);
  const expires = contentUrl === string(asset.url)
    ? string(asset.url_expires_at) || string(body.content_url_expires_at) || string(task.content_url_expires_at)
    : string(body.content_url_expires_at) || string(task.content_url_expires_at) || string(asset.url_expires_at);
  return { taskId, contentUrl, ...(selectedId ? { assetId: selectedId } : {}), ...(expires ? { contentUrlExpiresAt: expires } : {}) };
}
const statusFrom = (value: unknown) => { const body = record(value), task = taskRecord(value); return (string(body.task_status) || string(task.status) || string(body.status)).trim().toLowerCase(); };
const requestIdFrom = (value: unknown) => { const body = record(value), details = record(body.details); return string(body.request_id) || string(body.requestId) || string(details.request_id) || string(details.requestId) || undefined; };
export const isVideoContentNotReady = (value: unknown) => {
  const code = codeFrom(value).toLowerCase();
  const message = messageFrom(value).toLowerCase();
  return code === "media_asset_not_ready" || /media asset is not ready|asset not ready|content is not ready/.test(message);
};

function inspectVideoContainer(bytes: Uint8Array): VideoContainer | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    return ascii(8, 12) === "qt  " ? { mime: "video/quicktime", name: "QuickTime" } : { mime: "video/mp4", name: "MP4" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { mime: "video/webm", name: "WebM/EBML" };
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return { mime: "video/ogg", name: "Ogg" };
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return { mime: "video/x-msvideo", name: "AVI" };
  return null;
}

async function inspectVideoBlob(blob: Blob): Promise<{ blob: Blob; diagnostic: VideoContentDiagnostic }> {
  const prefix = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const container = inspectVideoContainer(prefix);
  const signature = Array.from(prefix.subarray(0, 12), byte => byte.toString(16).padStart(2, "0")).join("");
  const declaredType = blob.type.trim().toLowerCase().split(";", 1)[0];
  const textStart = new TextDecoder().decode(prefix).trimStart().toLowerCase();
  if (!container && (/^(<!doctype\s+html|<html\b|<\?xml\b|<error\b)/.test(textStart) || textStart.startsWith("{") || textStart.startsWith("["))) {
    throw new Error(`视频接口返回的不是视频内容（${declaredType || "未声明类型"}，${blob.size} 字节）。请检查线上接口响应。`);
  }
  if (!container && declaredType && !declaredType.startsWith("video/") && !["application/octet-stream", "binary/octet-stream"].includes(declaredType)) {
    throw new Error(`视频接口返回的不是视频内容（${declaredType}，${blob.size} 字节）。请检查线上接口响应。`);
  }

  const normalized = container && declaredType !== container.mime ? new Blob([blob], { type: container.mime }) : blob;
  let codec = "未识别";
  if (container) {
    const sampleSize = 1024 * 1024;
    const [head, tail] = await Promise.all([
      blob.slice(0, sampleSize).arrayBuffer(),
      blob.size > sampleSize ? blob.slice(Math.max(sampleSize, blob.size - sampleSize)).arrayBuffer() : Promise.resolve(new ArrayBuffer(0)),
    ]);
    const sample = `${new TextDecoder().decode(head)}${new TextDecoder().decode(tail)}`;
    if (/hvc1|hev1/i.test(sample)) codec = "H.265/HEVC";
    else if (/avc1|avc3/i.test(sample)) codec = "H.264/AVC";
    else if (/av01|V_AV1/i.test(sample)) codec = "AV1";
    else if (/vp09|V_VP9/i.test(sample)) codec = "VP9";
    else if (/V_VP8/i.test(sample)) codec = "VP8";
  }
  const diagnostic: VideoContentDiagnostic = {
    contentType: normalized.type || declaredType || "未声明",
    size: normalized.size,
    container: container?.name || "容器未知",
    codec,
    signature: signature || "空",
  };
  videoContentDiagnostics.set(normalized, diagnostic);
  return { blob: normalized, diagnostic };
}

export function videoContentDiagnostic(blob: Blob): string | undefined {
  const value = videoContentDiagnostics.get(blob);
  if (!value) return undefined;
  const size = value.size >= 1024 * 1024
    ? `${(value.size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value.size / 1024))} KB`;
  const signature = value.container === "容器未知" ? ` · 签名 ${value.signature}` : "";
  return `接口成功 · ${value.contentType} · ${size} · ${value.container} · ${value.codec}${signature}`;
}

/** Shared validation for proxy compatibility reads and direct object-store downloads. */
export async function validateVideoContentBlob(value: Blob): Promise<Blob> {
  if (typeof Blob === "undefined" || !(value instanceof Blob) || value.size === 0) throw new Error("视频内容为空或不可用");
  return (await inspectVideoBlob(value)).blob;
}

export type VideoTaskSnapshot = VideoGenerationResult & { status: string; code: string; message: string; phase?: string; assetStatus?: string; requestId?: string; supplierConfirmation?: { state?: string; status?: string; source?: string; reason?: string } };

export function videoTaskPhase(status: string, observation: Omit<MediaTaskStateInput, "status"> = {}): "completed" | "failed" | "running" | "queued" | "unknown" {
  const input = { ...observation, status };
  const lifecycle = mediaTaskState(input);
  const publicState = mediaTaskPublicState(input);
  if (publicState === "failed") return "failed";
  if (lifecycle.requiresReconciliation) return "unknown";
  if (publicState === "succeeded") return "completed";
  if (runningStatus(status) || publicState === "running" || observation.phase === "queued") return publicState === "queued" ? "queued" : "running";
  return "unknown";
}

function snapshotPhase(snapshot: VideoTaskSnapshot) {
  return videoTaskPhase(snapshot.status, {
    code: snapshot.code, phase: snapshot.phase, assetStatus: snapshot.assetStatus,
    supplierConfirmationState: snapshot.supplierConfirmation?.state,
  });
}

function snapshotRequiresReconciliation(snapshot: VideoTaskSnapshot) {
  return mediaTaskState({
    status: snapshot.status, code: snapshot.code, phase: snapshot.phase, assetStatus: snapshot.assetStatus,
    supplierConfirmationState: snapshot.supplierConfirmation?.state,
  }).requiresReconciliation;
}

function taskSnapshot(value: unknown, taskId: string): VideoTaskSnapshot {
  const body = record(value), task = taskRecord(value);
  const supplierConfirmation = supplierConfirmationFrom(value);
  return {
    ...contentFrom(value, taskId),
    status: statusFrom(value),
    code: codeFrom(value),
    message: messageFrom(value),
    phase: string(task.phase) || string(body.phase) || undefined,
    assetStatus: string(task.asset_status) || string(body.asset_status) || undefined,
    requestId: string(task.request_id) || requestIdFrom(value),
    ...(supplierConfirmation.state ? { supplierConfirmation } : {}),
  };
}

/** Read one durable task snapshot for recovery surfaces outside the poll loop. */
export async function readVideoTask(request: VideoRequest, taskId: string): Promise<VideoTaskSnapshot> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId)) throw new VideoGenerationError("视频任务 ID 无效", { code: "VIDEO_TASK_INVALID_ID" });
  const value = await request(`/videos/${taskId}`);
  const returnedTaskId = taskIdFrom(value);
  if (returnedTaskId && returnedTaskId !== taskId) throw new VideoGenerationError("视频服务返回了错误的任务身份", { code: "VIDEO_TASK_INVALID_RESPONSE" });
  return taskSnapshot(value, taskId);
}

/** Resolve a frozen submission without needing its original media or creating a task. */
export async function readVideoTaskByIdempotencyKey(request: VideoRequest, key: string): Promise<VideoTaskSnapshot | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
    throw new VideoGenerationError("原提交标识无效，请联系平台处理。", { pending: true, code: "VIDEO_SUBMISSION_INVALID_KEY" });
  }
  let value: unknown;
  // The validated alphabet is path-safe and shared with the SDK allowlist.
  try { value = await request(`/videos/by-idempotency-key/${key}`); }
  catch (cause) {
    // A missing route, an unavailable service, or expired authorization cannot
    // establish that the original submission was never accepted.
    if (statusCode(cause) === 404 && codeFrom(cause) === "video_task_not_found") return null;
    throw new VideoGenerationError("暂时无法确认原视频任务，请稍后重试。", {
      pending: true, code: codeFrom(cause) || "VIDEO_SUBMISSION_LOOKUP_UNAVAILABLE", cause,
    });
  }
  const taskId = taskIdFrom(value);
  if (!taskId) throw new VideoGenerationError("原视频任务信息暂时不可用，请稍后重试。", { pending: true, code: "VIDEO_SUBMISSION_LOOKUP_INVALID" });
  return taskSnapshot(value, taskId);
}

/** Fetch completed video bytes for a player. Generation deliberately never downloads bytes. */
export async function readVideoContent(request: VideoRequest, taskId: string, options: VideoContentOptions = {}): Promise<Blob> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId)) throw new Error("视频任务 ID 无效");
  const attempts = Math.max(1, Math.min(8, Math.floor(options.attempts ?? 8)));
  const delay = options.delay || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await delay(Math.min(3000, 500 * attempt));
    try {
      const value = await request(`/videos/${taskId}/content`, { responseType: "blob" });
      // Some providers omit or mislabel the MIME type. Detect common containers
      // from a bounded prefix before handing bytes to the browser decoder.
      return await validateVideoContentBlob(value as Blob);
    } catch (error) {
      lastError = error;
      // The task can be completed before the object store/CDN is readable.
      // Retry this explicit consistency window, while surfacing auth, access,
      // and permanent task errors immediately.
      if (!isVideoContentNotReady(error) || attempt === attempts - 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("视频内容为空或不可用");
}
/** Request cancellation. The key makes retries of DELETE idempotent. */
export async function cancelVideo(request: VideoRequest, taskId: string, idempotencyKey?: string): Promise<VideoTaskSnapshot> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId)) throw new VideoGenerationError("视频任务 ID 无效", { code: "VIDEO_TASK_INVALID_ID" });
  return taskSnapshot(await request(`/videos/${taskId}`, { method: "DELETE", headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }), taskId);
}

export async function generateVideo(request: VideoRequest, input: VideoGenerationInput, onTask?: (taskId: string) => void | Promise<void>, options: VideoGenerationOptions = {}): Promise<VideoGenerationResult> {
  // Video completion is owned by the durable media task. The browser may stop
  // observing when the user pauses or leaves, but it must never invent a
  // timeout state after a fixed number of polls.
  const intervalMs = Math.max(0, options.intervalMs ?? 2000); const delay = options.delay || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))); let taskId = input.taskId;
  const reconciliationIntervalMs = Math.max(intervalMs, options.reconciliationIntervalMs ?? 15000);
  let initialUnknown = false;
  let taskRemembered = false;
  const validTask = (id: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
  if (taskId && !validTask(taskId)) throw new VideoGenerationError("视频任务 ID 无效", { code: "VIDEO_TASK_INVALID_ID" });
  const pauseError = () => new VideoGenerationError(taskId ? "已暂停查询，视频任务仍在后台运行" : "已停止提交视频任务", { taskId, pending: Boolean(taskId), code: taskId ? "VIDEO_TASK_PAUSED" : "VIDEO_SUBMISSION_STOPPED" });
  const checkAbort = () => { if (options.signal?.aborted) throw pauseError(); };
  const rememberTask = async (id: string) => {
    try { await onTask?.(id); taskRemembered = true; }
    catch (cause) {
      throw new VideoGenerationError("视频任务已提交，恢复信息暂时无法保存，请保留当前页面后重试。", { taskId: id, pending: true, code: "VIDEO_TASK_PERSIST_FAILED", cause });
    }
  };
  const waitForPoll = async (milliseconds: number) => {
    if (!options.signal) return delay(milliseconds);
    const signal = options.signal;
    let onAbort: () => void = () => {};
    const aborted = new Promise<void>(resolve => {
      onAbort = resolve;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) resolve();
    });
    try { await Promise.race([delay(milliseconds), aborted]); }
    finally { signal.removeEventListener("abort", onAbort); }
  };
  const readTask = async (path = `/videos/${taskId}`) => {
    // A stopped observer must not wait for a hanging GET or apply its late
    // response. The POST remains outside this race so its identity is saved.
    const response = request(path);
    const signal = options.signal;
    if (!signal) return response;
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(pauseError());
      signal.addEventListener("abort", onAbort, { once: true });
      // A synchronously settled response remains authoritative. A genuinely
      // pending read loses the race as soon as observation is stopped.
      if (signal.aborted) queueMicrotask(onAbort);
    });
    // Promise.race keeps rejection handlers on both inputs after settlement,
    // so a late transport failure cannot become an unhandled rejection.
    try { return await Promise.race([response, aborted]); }
    finally { signal.removeEventListener("abort", onAbort); }
  };
  if (!taskId && options.recovery) {
    checkAbort();
    const recovered = await readVideoTaskByIdempotencyKey(path => readTask(path), input.idempotencyKey || "");
    checkAbort();
    if (recovered) {
      taskId = recovered.taskId;
      await rememberTask(taskId);
      await options.onStatus?.(recovered);
      const phase = snapshotPhase(recovered);
      if (phase === "failed") throw new VideoGenerationError(recovered.message || "视频生成失败", {
        taskId, terminalTask: true, status: recovered.status, code: recovered.code || "VIDEO_TASK_FAILED", requestId: recovered.requestId,
      });
      if (phase === "completed") return { taskId, contentUrl: recovered.contentUrl, ...(recovered.assetId ? { assetId: recovered.assetId } : {}), ...(recovered.contentUrlExpiresAt ? { contentUrlExpiresAt: recovered.contentUrlExpiresAt } : {}) };
      checkAbort();
      if (snapshotRequiresReconciliation(recovered)) {
        if (!options.observeUnknown) throw new VideoGenerationError(recovered.message || "原视频任务正在核对中。", { taskId, pending: true, status: recovered.status, code: recovered.code || "VIDEO_TASK_UNKNOWN" });
        initialUnknown = true;
      }
    } else if (!options.recovery.inputReferencesAvailable) {
      // This is a local recovery failure, not a terminal provider state. A
      // concurrent original POST could still settle after this read. Keep the
      // frozen identity in the canvas so every later retry checks it again.
      throw new VideoGenerationError("参考图片缺失，请恢复原图片后重试。", { code: "VIDEO_SUBMISSION_INPUT_MISSING" });
    }
  }
  if (!taskId) {
    checkAbort(); if (!input.model.trim() || !input.prompt.trim()) throw new VideoGenerationError("请选择视频模型并填写提示词", { code: "VIDEO_INPUT_REQUIRED" });
    // New submissions arrive here with catalog-resolved defaults. Preserve
    // the field exactly for frozen/idempotent retries so the retry payload is
    // byte-for-byte equivalent to the original request.
    const body: RecordValue = { model: input.model, prompt: input.prompt, ...videoGenerationParameters(input) };
    const referenceInputs: VideoReferenceInput[] = input.references?.length
      ? input.references
      : [...new Set(input.images || [])].map(url => ({ type: "image_url" as const, url }));
    const references = input.resolveReferences
      ? await input.resolveReferences(referenceInputs)
      : referenceInputs.flatMap(reference => reference.url ? [{ type: reference.type, url: reference.url }] : []);
    if (references.length !== referenceInputs.length) {
      throw new VideoGenerationError("视频参考素材尚未恢复，请从素材库重新选择后重试。", { code: "VIDEO_SUBMISSION_INPUT_MISSING" });
    }
    const seenReferenceKeys = new Set<string>();
    const uniqueReferences = references.filter(reference => {
      const key = `${reference.type}:${reference.url}`;
      if (seenReferenceKeys.has(key)) return false;
      seenReferenceKeys.add(key);
      return true;
    });
    if (uniqueReferences.length) body.input_references = uniqueReferences.map(reference => reference.type === "video_url"
      ? { type: "video_url", video_url: { url: reference.url } }
      : reference.type === "audio_url"
        ? { type: "audio_url", audio_url: { url: reference.url } }
        : { type: "image_url", image_url: { url: reference.url } });
    let response: unknown;
    try { response = await request("/videos", { method: "POST", headers: { "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) }, body: JSON.stringify(body) }); }
    catch (error) {
      const existing = taskIdFrom(record(error).details) || taskIdFrom(error);
      if (existing) {
        // Any durable identity means the gateway accepted the task, even if
        // its HTTP response reports a scheduling/configuration error.
        taskId = existing;
        response = taskIdFrom(record(error).details) ? { ...record(error), ...record(record(error).details) } : error;
      }
      else {
        const rejected = submissionRejected(error);
        const accessFailure = [401, 403].includes(statusCode(error)) || platformFailure(error).kind === "login";
        throw new VideoGenerationError(rejected ? messageFrom(error) || "视频请求被拒绝" : (input.idempotencyKey ? `提交结果尚未确认，可恢复原提交。${messageFrom(error)}` : messageFrom(error) || "无法提交视频任务"), {
          // Refusing this retry for authorization does not settle an earlier
          // uncertain attempt submitted under the same idempotency key.
          taskId: existing, pending: !rejected && Boolean(existing || input.idempotencyKey), terminalTask: rejected && !accessFailure,
          code: codeFrom(error) || "VIDEO_SUBMISSION_FAILED", cause: error,
        });
      }
    }
    // A local abort does not cancel the POST. Capture its durable identity
    // before stopping observation, including a response arriving after logout.
    if (!taskId) taskId = taskIdFrom(response);
    if (taskId) await rememberTask(taskId);
    const snapshot = taskSnapshot(response, taskId || "");
    const status = snapshot.status;
    const phase = snapshotPhase(snapshot);
    if (taskId) await options.onStatus?.(snapshot);
    if (phase === "failed") throw new VideoGenerationError(messageFrom(response) || "视频生成失败", { taskId, terminalTask: true, status, code: codeFrom(response) || "VIDEO_TASK_FAILED", cause: response });
    if (!taskId) throw new VideoGenerationError(input.idempotencyKey ? "平台响应未包含视频任务 ID，可恢复原提交。" : "提交结果未知：平台没有返回视频任务 ID，暂时无法确认是否已创建。", { status, requestId: requestIdFrom(response), pending: Boolean(input.idempotencyKey), code: "VIDEO_RESPONSE_INVALID", cause: response });
    if (phase === "completed") return contentFrom(response, taskId);
    checkAbort();
    if (snapshotRequiresReconciliation(snapshot)) {
      if (!options.observeUnknown) throw new VideoGenerationError(messageFrom(response) || "视频提交异常：平台无法确认任务是否已创建，请勿重复提交。", { taskId, pending: true, terminalTask: false, status, code: codeFrom(response) || "VIDEO_TASK_UNKNOWN", cause: response });
      initialUnknown = true;
    }
  } else if (!taskRemembered) await rememberTask(taskId);
  const maxConsecutiveReadFailures = Math.max(1, Math.min(10, Math.floor(options.maxConsecutiveReadFailures ?? 5)));
  let consecutiveReadFailures = 0;
  let pollDelay = initialUnknown ? reconciliationIntervalMs : intervalMs;
  for (let attempt = 0; ; attempt++) {
    checkAbort(); if (attempt > 0 || initialUnknown) await waitForPoll(pollDelay); checkAbort(); let response: unknown;
    try { response = await readTask(); } catch (error) {
      const code = codeFrom(error); const missing = code === "video_not_found" || code === "video_task_not_found";
      if (missing) throw new VideoGenerationError("原视频任务已不存在，请重新生成。", { taskId, terminalTask: true, code, cause: error });
      // An HTTP failure while reading is not a task state. Only continue
      // polling for transport/transient failures; otherwise surface a query
      // error instead of rewriting the durable task to "processing".
      const observed = taskSnapshot({ ...record(error), ...record(record(error).details) }, taskId!);
      if (snapshotPhase(observed) === "failed") throw new VideoGenerationError(messageFrom(error) || "视频任务已结束", { taskId, terminalTask: true, status: observed.status, code: code || `VIDEO_TASK_${observed.status.toUpperCase()}`, cause: error });
      checkAbort();
      if (!retryableReadFailure(error)) throw new VideoGenerationError(messageFrom(error) || "无法读取视频任务状态", { taskId, pending: true, code: code || "VIDEO_TASK_READ_FAILED", cause: error });
      consecutiveReadFailures += 1;
      if (consecutiveReadFailures >= maxConsecutiveReadFailures) {
        throw new VideoGenerationError("暂时无法读取视频任务状态，请稍后继续查询。", { taskId, pending: true, code: "VIDEO_TASK_READ_UNAVAILABLE", cause: error });
      }
      // A read failure says nothing about the durable task. Keep querying the
      // same task through a bounded recovery window so a transient outage
      // cannot become a duplicate submission or a high-frequency poll loop.
      pollDelay = Math.min(8000, Math.max(intervalMs, intervalMs * 2 ** Math.max(0, consecutiveReadFailures - 1)));
      continue;
    }
    consecutiveReadFailures = 0;
    pollDelay = intervalMs;
    const snapshot = taskSnapshot(response, taskId!);
    await options.onStatus?.(snapshot);
    const status = snapshot.status;
    const phase = snapshotPhase(snapshot);
    if (phase === "completed") return contentFrom(response, taskId);
    if (phase === "failed") throw new VideoGenerationError(messageFrom(response) || "视频生成失败", { taskId, terminalTask: true, status, code: codeFrom(response) || `VIDEO_TASK_${status.toUpperCase()}` });
    checkAbort();
    if (snapshotRequiresReconciliation(snapshot)) {
      if (!options.observeUnknown) throw new VideoGenerationError(messageFrom(response) || "视频提交异常：平台无法确认任务是否已创建，请勿重复提交。", { taskId, pending: true, terminalTask: false, status, code: codeFrom(response) || "VIDEO_TASK_UNKNOWN", cause: response });
      pollDelay = reconciliationIntervalMs;
      continue;
    }
    if (!status) {
      // A successful HTTP response without a task state is not evidence that
      // the job is still running. Treat it as a recoverable query failure so
      // the UI can stop polling and let the user retry the same task later.
      throw new VideoGenerationError("视频任务状态暂时不可用，请稍后继续查询。", { taskId, pending: true, code: "VIDEO_TASK_STATUS_MISSING" });
    }
    if (phase === "unknown") throw new VideoGenerationError("视频任务状态无法识别，请联系平台查看任务状态", { taskId, pending: true, code: "VIDEO_TASK_UNKNOWN" });
  }
}
