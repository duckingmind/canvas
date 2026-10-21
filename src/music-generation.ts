import { platformFailure } from "./platform-status.ts";
import { mediaTaskPublicState, mediaTaskState, type MediaTaskStateInput } from "./shared/media-task-state.ts";

/** Client for the gateway's asynchronous `/music` contract. */
export type MusicRequest = (
  path: string,
  init?: {
    method?: string;
    body?: BodyInit;
    headers?: Record<string, string>;
    responseType?: "blob" | "arrayBuffer" | "json" | "auto";
    signal?: AbortSignal;
  },
) => Promise<unknown>;

export type MusicAudioMode = "song" | "instrumental";
export type MusicAudioSetting = {
  format?: string;
  sample_rate?: number;
  bitrate?: number;
  [key: string]: unknown;
};
export type MusicGenerationInput = {
  model: string;
  prompt: string;
  lyrics?: string;
  /** Raw base64 reference audio for Music Cover. Persist the source file locally, not in the cloud document. */
  audio_base64?: string;
  lyrics_optimizer?: boolean;
  audio_mode?: MusicAudioMode;
  is_instrumental?: boolean;
  instrumental?: boolean;
  duration?: number;
  audio_format?: string;
  output_format?: string;
  sample_rate?: number;
  bitrate?: number;
  audio_setting?: MusicAudioSetting;
  metadata?: Record<string, unknown>;
  stream?: false;
  taskId?: string;
  /** Persist together with the exact input before submission; recovery reuses both. */
  idempotencyKey?: string;
};

export type MusicGenerationResult = {
  taskId: string;
  contentUrl: string;
  assetId?: string;
  contentUrlExpiresAt?: string;
};

export type MusicTaskSnapshot = MusicGenerationResult & {
  status: string;
  code: string;
  message: string;
  phase?: string;
  assetStatus?: string;
  requestId?: string;
  supplierConfirmation?: {
    state?: string;
    status?: string;
    source?: string;
    reason?: string;
  };
};

export type MusicGenerationOptions = {
  intervalMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  /** Resolve a previously persisted submission before replaying its frozen POST. */
  recovery?: boolean;
  /** Read local Cover bytes only if lookup proves the original task needs a POST. */
  loadReferenceAudio?: () => Promise<string>;
  maxConsecutiveReadFailures?: number;
  /** Continue observing a task while the provider result is being reconciled. */
  observeUnknown?: boolean;
  reconciliationIntervalMs?: number;
  onStatus?: (snapshot: MusicTaskSnapshot) => void | Promise<void>;
};

export type MusicContentOptions = {
  attempts?: number;
  delay?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  /** Authenticated URL returned in the task's `data[0].url`. */
  contentUrl?: string;
};

export class MusicGenerationError extends Error {
  readonly taskId?: string;
  readonly requestId?: string;
  readonly status?: string;
  readonly pending: boolean;
  readonly terminalTask: boolean;
  readonly code: string;

  constructor(message: string, options: {
    taskId?: string;
    requestId?: string;
    status?: string;
    pending?: boolean;
    terminalTask?: boolean;
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MusicGenerationError";
    this.taskId = options.taskId;
    this.requestId = options.requestId || requestIdFrom(options.cause);
    this.status = options.status;
    this.pending = options.pending ?? false;
    this.terminalTask = options.terminalTask ?? false;
    this.code = options.code ?? "MUSIC_GENERATION_FAILED";
  }
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
const taskRecord = (value: unknown) => {
  const body = record(value);
  return Object.keys(record(body.task)).length
    ? record(body.task)
    : Array.isArray(body.data) ? {} : record(body.data);
};
const statusFrom = (value: unknown) => {
  const body = record(value);
  const task = taskRecord(value);
  return (string(body.task_status) || string(task.task_status) || string(task.status) || string(body.status)).trim().toLowerCase();
};
const taskIdFrom = (value: unknown) => {
  const body = record(value);
  const task = taskRecord(value);
  const id = string(body.task_id) || string(body.id) || string(task.task_id) || string(task.id);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : undefined;
};
const codeFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value), details = record(body.details);
  return string(task.error_code) || string(record(task.error).code) || string(body.code) ||
    string(body.error_code) || string(record(body.error).code) || string(details.code) ||
    string(details.error_code) || string(record(details.error).code);
};
const messageFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value), details = record(body.details);
  return string(task.error_message) || string(record(task.error).message) ||
    string(record(body.error).message) || string(body.error_message) || string(body.message) ||
    string(details.message) || string(body.error);
};
const requestIdFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value), details = record(body.details);
  return string(body.request_id) || string(body.requestId) || string(task.request_id) ||
    string(task.requestId) || string(details.request_id) || string(details.requestId) || undefined;
};
const supplierConfirmationFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value);
  const confirmation = record(task.supplier_confirmation || body.supplier_confirmation || record(body.details).supplier_confirmation);
  return {
    state: string(confirmation.state) || undefined,
    status: string(confirmation.status) || undefined,
    source: string(confirmation.source) || undefined,
    reason: string(confirmation.reason) || undefined,
  };
};
const statusCode = (value: unknown) => {
  const body = record(value);
  const status = body.status ?? body.statusCode ?? body.status_code;
  return typeof status === "number" ? status : 0;
};
const terminalStatus = (status: string) =>
  ["failed", "cancelled", "canceled", "expired", "refunded", "unknown_resolution_expired"].includes(status);
const runningStatus = (status: string) =>
  ["created", "quoted", "funds_reserved", "accepted", "pending", "queued", "submitted", "in_progress", "running", "dispatching", "collecting", "cancel_requested", "cancel_pending", "canceling"].includes(status);

function assetsFrom(value: unknown): RecordValue[] {
  const body = record(value), task = taskRecord(value);
  const data = Array.isArray(body.data) ? body.data : [];
  const assets = Array.isArray(body.assets) ? body.assets : Array.isArray(task.assets) ? task.assets : [];
  // The gateway's data entries carry authenticated task-content routes; assets
  // may carry temporary object-storage URLs for other delivery clients.
  return [...data, ...assets].map(record).filter(item => Object.keys(item).length > 0);
}

function contentFrom(value: unknown, taskId: string): MusicGenerationResult {
  const body = record(value), task = taskRecord(value);
  const assets = assetsFrom(value).filter(asset => {
    const type = string(asset.type) || string(asset.content_type);
    return !type || type === "audio" || type.startsWith("audio/");
  });
  const direct = string(body.content_url) || string(body.url) || string(task.content_url) || string(task.url);
  const assetId = string(body.asset_id) || string(task.asset_id);
  const asset = assets.find(item => assetId && (string(item.asset_id) === assetId || string(item.id) === assetId)) ||
    assets.find(item => string(item.url) === direct) || assets.find(item => string(item.url));
  const selectedAssetId = assetId || string(asset?.asset_id) || string(asset?.id);
  const matchingAssets = selectedAssetId
    ? assets.filter(item => {
      const id = string(item.asset_id) || string(item.id);
      return !id || id === selectedAssetId;
    })
    : assets;
  const contentAsset = matchingAssets.find(item => {
    const url = string(item.url);
    if (!url) return false;
    try { musicContentRequestPath(taskId, url); return true; }
    catch { return false; }
  });
  let authenticatedDirect = "";
  if (direct) {
    try { musicContentRequestPath(taskId, direct); authenticatedDirect = direct; }
    catch { /* Use the durable task route when only a delivery URL is present. */ }
  }
  const contentUrl = string(contentAsset?.url) || authenticatedDirect || `/music/tasks/${taskId}/content`;
  // A signed delivery URL's expiry does not apply to the authenticated route.
  const expires = contentUrl === direct
    ? string(body.content_url_expires_at) || string(body.url_expires_at) || string(task.content_url_expires_at) || string(task.url_expires_at)
    : string(contentAsset?.url_expires_at);
  return {
    taskId,
    contentUrl,
    ...(selectedAssetId ? { assetId: selectedAssetId } : {}),
    ...(expires ? { contentUrlExpiresAt: expires } : {}),
  };
}

function taskSnapshot(value: unknown, taskId: string): MusicTaskSnapshot {
  const body = record(value), task = taskRecord(value), supplierConfirmation = supplierConfirmationFrom(value);
  return {
    ...contentFrom(value, taskId),
    status: statusFrom(value),
    code: codeFrom(value),
    message: messageFrom(value),
    phase: string(task.phase) || string(body.phase) || undefined,
    assetStatus: string(task.asset_status) || string(body.asset_status) || undefined,
    requestId: requestIdFrom(value),
    ...(supplierConfirmation.state ? { supplierConfirmation } : {}),
  };
}

const lifecycleFor = (snapshot: MusicTaskSnapshot): MediaTaskStateInput => ({
  status: snapshot.status,
  code: snapshot.code,
  message: snapshot.message,
  phase: snapshot.phase,
  assetStatus: snapshot.assetStatus,
  supplierConfirmationState: snapshot.supplierConfirmation?.state,
});
const phaseFor = (snapshot: MusicTaskSnapshot) => {
  const lifecycle = mediaTaskState(lifecycleFor(snapshot));
  const publicState = mediaTaskPublicState(lifecycleFor(snapshot));
  if (publicState === "failed") return "failed";
  if (lifecycle.requiresReconciliation) return "unknown";
  if (publicState === "succeeded") return "completed";
  if (runningStatus(snapshot.status) || publicState === "running" || snapshot.phase === "queued") return "running";
  return "unknown";
};
const retryableReadFailure = (value: unknown) => {
  if (platformFailure(value).kind === "login") return false;
  const status = statusCode(value);
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
};
const deterministicFailureCodes = new Set([
  "invalid_request", "invalid_model", "no_eligible_provider", "no_eligible_supplier",
  "provider_rejected_request", "unknown_resolution_expired", "media_routing_disabled", "media_task_create_failed",
]);
const submissionRejected = (error: unknown) => {
  const details = record(record(error).details);
  const status = statusCode(error), code = codeFrom(error).toLowerCase();
  const message = messageFrom(error).toLowerCase();
  const confirmation = supplierConfirmationFrom(error);
  const lifecycle = mediaTaskState({
    status: statusFrom(details) || statusFrom(error),
    code,
    supplierConfirmationState: confirmation.state,
  });
  // A 4xx wrapper is not authoritative when it carries an unresolved provider
  // result. Keep the frozen key so the caller can safely replay the same body.
  if (lifecycle.requiresReconciliation && !lifecycle.isTerminal) return false;
  if (status === 408 || status === 499) return false;
  return deterministicFailureCodes.has(code) || /no eligible|unsupported value|not supported|routing is not enabled/.test(message) ||
    terminalStatus(statusFrom(details)) || terminalStatus(statusFrom(error)) ||
    status >= 400 && status < 500 && status !== 408 && status !== 499;
};
const validTaskId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("音乐请求已停止", "AbortError");
}

/** Locally stop waiting even when a transport shim does not implement AbortSignal. */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener("abort", onAbort); resolve(value); },
      error => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function musicContentRequestPath(taskId: string, contentUrl?: string): string {
  const fallback = `/music/tasks/${taskId}/content`;
  if (!contentUrl) return fallback;
  let parsed: URL;
  try { parsed = new URL(contentUrl, "https://canvas.invalid"); }
  catch { throw new MusicGenerationError("音乐内容地址无效", { taskId, code: "MUSIC_CONTENT_URL_INVALID" }); }
  const match = /^\/(?:v1\/)?music\/tasks\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/content$/.exec(parsed.pathname);
  if (parsed.hash || match?.[1] !== taskId) throw new MusicGenerationError("音乐内容地址与任务不匹配", { taskId, code: "MUSIC_CONTENT_URL_INVALID" });
  const indexes = parsed.searchParams.getAll("index");
  if ([...parsed.searchParams.keys()].some(key => key !== "index") || indexes.length > 1 || indexes.some(index => !/^\d+$/.test(index))) {
    throw new MusicGenerationError("音乐内容地址参数无效", { taskId, code: "MUSIC_CONTENT_URL_INVALID" });
  }
  return `/music/tasks/${taskId}/content${indexes.length ? `?index=${indexes[0]}` : ""}`;
}

/** Reject empty/error payloads while allowing encoded audio and raw PCM. */
export async function validateMusicContentBlob(value: Blob): Promise<Blob> {
  if (typeof Blob === "undefined" || !(value instanceof Blob) || value.size === 0) throw new Error("音乐内容为空或不可用");
  const prefix = new Uint8Array(await value.slice(0, 128).arrayBuffer());
  const declaredType = value.type.trim().toLowerCase().split(";", 1)[0];
  const textStart = new TextDecoder().decode(prefix).trimStart().toLowerCase();
  if (/^(<!doctype\s+html|<html\b|<\?xml\b|<error\b)/.test(textStart) || textStart.startsWith("{") || textStart.startsWith("[")) {
    throw new Error("音乐接口返回的不是音频内容");
  }
  if (declaredType && !declaredType.startsWith("audio/") && !["application/octet-stream", "binary/octet-stream"].includes(declaredType)) {
    throw new Error(`音乐接口返回的不是音频内容（${declaredType}）`);
  }
  return value;
}

export async function readMusicTask(request: MusicRequest, taskId: string, signal?: AbortSignal): Promise<MusicTaskSnapshot> {
  if (!validTaskId(taskId)) throw new MusicGenerationError("音乐任务 ID 无效", { code: "MUSIC_TASK_INVALID_ID" });
  if (signal?.aborted) throw abortError(signal);
  const value = await withAbort(request(`/music/tasks/${taskId}`, { signal }), signal);
  const returnedTaskId = taskIdFrom(value);
  if (returnedTaskId && returnedTaskId !== taskId) throw new MusicGenerationError("音乐服务返回了错误的任务身份", { code: "MUSIC_TASK_INVALID_RESPONSE" });
  return taskSnapshot(value, taskId);
}

/** Request cancellation. The gateway may return cancel_pending; callers keep polling. */
export async function cancelMusic(request: MusicRequest, taskId: string, idempotencyKey?: string): Promise<MusicTaskSnapshot> {
  if (!validTaskId(taskId)) throw new MusicGenerationError("音乐任务 ID 无效", { code: "MUSIC_TASK_INVALID_ID" });
  const value = await request(`/music/tasks/${taskId}`, {
    method: "DELETE",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
  const returnedTaskId = taskIdFrom(value);
  if (returnedTaskId && returnedTaskId !== taskId) throw new MusicGenerationError("音乐服务返回了错误的任务身份", { taskId, pending: true, code: "MUSIC_TASK_INVALID_RESPONSE" });
  return taskSnapshot(value, taskId);
}

/** Read completed audio bytes through the authenticated task content route. */
export async function readMusicContent(request: MusicRequest, taskId: string, options: MusicContentOptions = {}): Promise<Blob> {
  if (!validTaskId(taskId)) throw new MusicGenerationError("音乐任务 ID 无效", { code: "MUSIC_TASK_INVALID_ID" });
  const attempts = Math.max(1, Math.min(8, Math.floor(options.attempts ?? 6)));
  const delay = options.delay || ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const path = musicContentRequestPath(taskId, options.contentUrl);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw new MusicGenerationError("已停止读取音乐内容", { taskId, pending: true, code: "MUSIC_CONTENT_READ_STOPPED" });
    try {
      if (attempt > 0) await withAbort(delay(Math.min(3000, 400 * attempt)), options.signal);
      const value = await withAbort(request(path, { responseType: "blob", signal: options.signal }), options.signal);
      return await withAbort(validateMusicContentBlob(value as Blob), options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw new MusicGenerationError("已停止读取音乐内容", { taskId, pending: true, code: "MUSIC_CONTENT_READ_STOPPED", cause: error });
      lastError = error;
      const code = codeFrom(error).toLowerCase(), message = messageFrom(error).toLowerCase();
      if (!/not.?ready|asset.*pending|content.*pending|media_asset_not_ready/.test(`${code} ${message}`) || attempt === attempts - 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("音乐内容为空或不可用");
}

/** Resolve a frozen music submission without creating a replacement task. */
export async function readMusicTaskByIdempotencyKey(request: MusicRequest, key: string, signal?: AbortSignal): Promise<MusicTaskSnapshot | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
    throw new MusicGenerationError("原音乐提交标识无效，请联系平台处理。", { pending: true, code: "MUSIC_SUBMISSION_INVALID_KEY" });
  }
  let value: unknown;
  try { value = await withAbort(request(`/music/by-idempotency-key/${key}`, { signal }), signal); }
  catch (cause) {
    if (signal?.aborted) throw new MusicGenerationError("已暂停确认音乐任务，请稍后继续。", { pending: true, code: "MUSIC_SUBMISSION_LOOKUP_PAUSED", cause });
    // A missing row does not prove that an in-flight POST was never accepted.
    // The caller may replay only the same frozen body and key.
    if (statusCode(cause) === 404 && codeFrom(cause) === "music_task_not_found") return null;
    throw new MusicGenerationError("暂时无法确认原音乐任务，请稍后重试。", {
      pending: true, code: codeFrom(cause) || "MUSIC_SUBMISSION_LOOKUP_UNAVAILABLE", cause,
    });
  }
  const taskId = taskIdFrom(value);
  if (!taskId) throw new MusicGenerationError("原音乐任务信息暂时不可用，请稍后重试。", { pending: true, code: "MUSIC_SUBMISSION_LOOKUP_INVALID" });
  return taskSnapshot(value, taskId);
}

/**
 * Recover by task ID when present. Otherwise, a persisted submission first
 * resolves its idempotency key and only replays the exact frozen POST after an
 * explicit not-found response.
 */
export async function generateMusic(
  request: MusicRequest,
  input: MusicGenerationInput,
  onTask?: (taskId: string) => void | Promise<void>,
  options: MusicGenerationOptions = {},
): Promise<MusicGenerationResult> {
  const intervalMs = Math.max(0, options.intervalMs ?? 2000);
  const reconciliationIntervalMs = Math.max(intervalMs, options.reconciliationIntervalMs ?? 15000);
  const delay = options.delay || ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  let taskId = input.taskId;
  let initialUnknown = false;
  let taskRemembered = false;
  if (taskId && !validTaskId(taskId)) throw new MusicGenerationError("音乐任务 ID 无效", { code: "MUSIC_TASK_INVALID_ID" });
  const stopError = () => new MusicGenerationError(taskId ? "已暂停查询，音乐任务仍在后台运行" : "已停止提交音乐任务", {
    taskId, pending: Boolean(taskId), code: taskId ? "MUSIC_TASK_PAUSED" : "MUSIC_SUBMISSION_STOPPED",
  });
  const checkAbort = () => { if (options.signal?.aborted) throw stopError(); };
  const rememberTask = async (id: string) => {
    try { await onTask?.(id); taskRemembered = true; }
    catch (cause) { throw new MusicGenerationError("音乐任务已提交，恢复信息暂时无法保存，请保留当前页面后重试。", { taskId: id, pending: true, code: "MUSIC_TASK_PERSIST_FAILED", cause }); }
  };
  const wait = async (milliseconds: number) => {
    if (!options.signal) return delay(milliseconds);
    const signal = options.signal;
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(stopError());
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try { await Promise.race([delay(milliseconds), aborted]); }
    finally { signal.removeEventListener("abort", onAbort); }
  };
  const read = async () => withAbort(request(`/music/tasks/${taskId}`, { signal: options.signal }), options.signal);

  if (!taskId && options.recovery) {
    checkAbort();
    const recovered = await readMusicTaskByIdempotencyKey(request, input.idempotencyKey || "", options.signal);
    checkAbort();
    if (recovered) {
      taskId = recovered.taskId;
      await rememberTask(taskId);
      await options.onStatus?.(recovered);
      const phase = phaseFor(recovered);
      if (phase === "failed") throw new MusicGenerationError(recovered.message || "音乐生成失败", {
        taskId, terminalTask: true, status: recovered.status, code: recovered.code || "MUSIC_TASK_FAILED", requestId: recovered.requestId,
      });
      if (phase === "completed") return {
        taskId, contentUrl: recovered.contentUrl,
        ...(recovered.assetId ? { assetId: recovered.assetId } : {}),
        ...(recovered.contentUrlExpiresAt ? { contentUrlExpiresAt: recovered.contentUrlExpiresAt } : {}),
      };
      if (mediaTaskState(lifecycleFor(recovered)).requiresReconciliation) {
        if (!options.observeUnknown) throw new MusicGenerationError(recovered.message || "原音乐任务正在核对中。", {
          taskId, pending: true, status: recovered.status, code: recovered.code || "MUSIC_TASK_UNKNOWN",
        });
        initialUnknown = true;
      }
    }
  }

  if (!taskId) {
    checkAbort();
    if (!input.model.trim() || !input.prompt.trim()) throw new MusicGenerationError("请选择音乐模型并填写提示词", { code: "MUSIC_INPUT_REQUIRED" });
    // Validate whitespace without rewriting the frozen request. The Gateway
    // binds the idempotency key to the original payload fingerprint.
    const body: RecordValue = { model: input.model, prompt: input.prompt };
    const optional = ["lyrics", "audio_base64", "lyrics_optimizer", "audio_mode", "is_instrumental", "instrumental", "duration", "audio_format", "output_format", "sample_rate", "bitrate", "audio_setting", "metadata", "stream"] as const;
    for (const key of optional) if (input[key] !== undefined) body[key] = input[key];
    if (options.loadReferenceAudio) body.audio_base64 = await options.loadReferenceAudio();
    checkAbort();
    let response: unknown;
    try {
      response = await request("/music/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const existing = taskIdFrom(record(error).details) || taskIdFrom(error);
      if (existing) { taskId = existing; response = error; }
      else {
        const rejected = submissionRejected(error);
        throw new MusicGenerationError(rejected ? messageFrom(error) || "音乐请求被拒绝" : input.idempotencyKey ? `提交结果尚未确认，可恢复原提交。${messageFrom(error)}` : messageFrom(error) || "无法提交音乐任务", {
          pending: !rejected && Boolean(input.idempotencyKey), terminalTask: rejected, code: codeFrom(error) || "MUSIC_SUBMISSION_FAILED", cause: error,
        });
      }
    }
    if (!taskId) taskId = taskIdFrom(response);
    if (taskId) await rememberTask(taskId);
    // Creation is intentionally allowed to settle after local cancellation so
    // the task ID can be persisted before returning a resumable pause.
    checkAbort();
    const snapshot = taskSnapshot(response, taskId || "");
    await options.onStatus?.(snapshot);
    const phase = phaseFor(snapshot);
    if (phase === "failed") throw new MusicGenerationError(messageFrom(response) || "音乐生成失败", { taskId, terminalTask: true, status: snapshot.status, code: codeFrom(response) || "MUSIC_TASK_FAILED", requestId: snapshot.requestId });
    if (!taskId) throw new MusicGenerationError(input.idempotencyKey ? "平台响应未包含音乐任务 ID，可恢复原提交。" : "提交结果未知：平台没有返回音乐任务 ID。", { pending: Boolean(input.idempotencyKey), code: "MUSIC_RESPONSE_INVALID", requestId: snapshot.requestId });
    if (phase === "completed") return contentFrom(response, taskId);
    if (mediaTaskState(lifecycleFor(snapshot)).requiresReconciliation) {
      if (!options.observeUnknown) throw new MusicGenerationError(snapshot.message || "音乐提交异常：平台正在确认任务状态，请勿重复提交。", { taskId, pending: true, status: snapshot.status, code: snapshot.code || "MUSIC_TASK_UNKNOWN" });
      initialUnknown = true;
    }
  } else if (!taskRemembered) await rememberTask(taskId);

  const maxFailures = Math.max(1, Math.min(10, Math.floor(options.maxConsecutiveReadFailures ?? 5)));
  let failures = 0;
  let pollDelay = initialUnknown ? reconciliationIntervalMs : intervalMs;
  for (let attempt = 0; ; attempt += 1) {
    checkAbort();
    if (attempt > 0 || initialUnknown) await wait(pollDelay);
    let response: unknown;
    try { response = await read(); }
    catch (error) {
      if (options.signal?.aborted) throw stopError();
      const code = codeFrom(error).toLowerCase();
      if (code === "music_task_not_found" || code === "music_not_found" || code === "task_not_found") {
        throw new MusicGenerationError("原音乐任务已不存在，请重新生成。", { taskId, terminalTask: true, code, cause: error });
      }
      if (!retryableReadFailure(error)) throw new MusicGenerationError(messageFrom(error) || "无法读取音乐任务状态", { taskId, pending: true, code: codeFrom(error) || "MUSIC_TASK_READ_FAILED", cause: error });
      failures += 1;
      if (failures >= maxFailures) throw new MusicGenerationError("暂时无法读取音乐任务状态，请稍后继续查询。", { taskId, pending: true, code: "MUSIC_TASK_READ_UNAVAILABLE", cause: error });
      pollDelay = Math.min(8000, Math.max(intervalMs, intervalMs * 2 ** Math.max(0, failures - 1)));
      continue;
    }
    checkAbort();
    failures = 0; pollDelay = intervalMs;
    const returnedTaskId = taskIdFrom(response);
    if (returnedTaskId && returnedTaskId !== taskId) throw new MusicGenerationError("音乐服务返回了错误的任务身份", { taskId, pending: true, code: "MUSIC_TASK_INVALID_RESPONSE" });
    const snapshot = taskSnapshot(response, taskId!);
    await options.onStatus?.(snapshot);
    checkAbort();
    const phase = phaseFor(snapshot);
    if (phase === "completed") return contentFrom(response, taskId!);
    if (phase === "failed") throw new MusicGenerationError(messageFrom(response) || "音乐生成失败", { taskId, terminalTask: true, status: snapshot.status, requestId: snapshot.requestId, code: codeFrom(response) || `MUSIC_TASK_${snapshot.status.toUpperCase()}` });
    if (mediaTaskState(lifecycleFor(snapshot)).requiresReconciliation) {
      if (!options.observeUnknown) throw new MusicGenerationError(snapshot.message || "音乐任务正在核对中，请勿重复提交。", { taskId, pending: true, status: snapshot.status, code: snapshot.code || "MUSIC_TASK_UNKNOWN" });
      pollDelay = reconciliationIntervalMs;
      continue;
    }
    if (!snapshot.status || phase === "unknown") throw new MusicGenerationError("音乐任务状态暂时不可用，请稍后继续查询。", { taskId, pending: true, code: snapshot.status ? "MUSIC_TASK_UNKNOWN" : "MUSIC_TASK_STATUS_MISSING" });
  }
}

