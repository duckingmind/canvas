import { validateMusicContentBlob, type MusicRequest } from "./music-generation.ts";
import { platformFailure } from "./platform-status.ts";
import { mediaTaskPublicState, mediaTaskState } from "./shared/media-task-state.ts";

export type VoiceDesignInput = {
  model?: string;
  prompt: string;
  previewText: string;
  taskId?: string;
  idempotencyKey?: string;
};

export type VoiceDesignSnapshot = {
  taskId: string;
  status: string;
  voiceId?: string;
  contentUrl?: string;
  assetId?: string;
  error?: string;
  code?: string;
  phase?: string;
  trialAudioAvailable?: boolean;
};

export class VoiceDesignError extends Error {
  readonly taskId?: string;
  readonly pending: boolean;
  readonly terminalTask: boolean;
  readonly code: string;
  constructor(message: string, options: { taskId?: string; pending?: boolean; terminalTask?: boolean; code?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VoiceDesignError";
    this.taskId = options.taskId;
    this.pending = options.pending ?? false;
    this.terminalTask = options.terminalTask ?? false;
    this.code = options.code ?? "VOICE_DESIGN_FAILED";
  }
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
const validId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const taskRecord = (value: unknown) => { const body = record(value); return Object.keys(record(body.task)).length ? record(body.task) : record(body.data); };
const taskIdFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value);
  const id = string(body.task_id) || string(body.id) || string(task.task_id) || string(task.id);
  return validId(id) ? id : undefined;
};
const statusFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value);
  return (string(body.task_status) || string(task.task_status) || string(task.status) || string(body.status)).trim().toLowerCase();
};
const codeFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value), details = record(body.details);
  return string(task.error_code) || string(record(task.error).code) || string(record(body.error).code) || string(body.code) || string(body.error_code) || string(details.code) || string(record(details.error).code);
};
const messageFrom = (value: unknown) => {
  const body = record(value), task = taskRecord(value);
  return string(record(task.error).message) || string(task.error_message) || string(record(body.error).message) || string(body.error_message) || string(body.message);
};
const statusCode = (value: unknown) => {
  const body = record(value), details = record(body.details);
  return Number(body.status || body.statusCode || body.status_code || details.status || details.statusCode) || 0;
};
const lifecycleFor = (snapshot: VoiceDesignSnapshot) => ({ status: snapshot.status, code: snapshot.code, phase: snapshot.phase });

export function voiceDesignSnapshot(value: unknown, expectedTaskId?: string): VoiceDesignSnapshot {
  const body = record(value), task = taskRecord(value), trialAudio = record(body.trial_audio || task.trial_audio);
  const taskId = taskIdFrom(value) || expectedTaskId || "";
  return {
    taskId,
    status: statusFrom(value),
    ...(string(body.voice_id || task.voice_id) ? { voiceId: string(body.voice_id || task.voice_id) } : {}),
    ...(string(body.content_url || task.content_url || trialAudio.url) ? { contentUrl: string(body.content_url || task.content_url || trialAudio.url) } : {}),
    ...(string(body.asset_id || task.asset_id) ? { assetId: string(body.asset_id || task.asset_id) } : {}),
    ...(messageFrom(value) ? { error: messageFrom(value) } : {}),
    ...(codeFrom(value) ? { code: codeFrom(value) } : {}),
    ...(string(body.phase || task.phase) ? { phase: string(body.phase || task.phase) } : {}),
    ...(typeof trialAudio.available === "boolean" ? { trialAudioAvailable: trialAudio.available } : {}),
  };
}

const abortCheck = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new VoiceDesignError("已暂停查询，音色任务仍在后台运行。", { pending: true, code: "VOICE_DESIGN_PAUSED", cause: signal.reason });
};
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
  const abort = () => { clearTimeout(timer); reject(signal?.reason); };
  signal?.addEventListener("abort", abort, { once: true });
});
/** Stop local observation even if a transport shim ignores AbortSignal. */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

export async function readVoiceDesignTask(request: MusicRequest, taskId: string, signal?: AbortSignal): Promise<VoiceDesignSnapshot> {
  if (!validId(taskId)) throw new VoiceDesignError("音色任务 ID 无效。", { code: "VOICE_DESIGN_INVALID_ID" });
  abortCheck(signal);
  const snapshot = voiceDesignSnapshot(await withAbort(request(`/voice-design/tasks/${taskId}`, { signal }), signal), taskId);
  if (snapshot.taskId !== taskId) throw new VoiceDesignError("音色服务返回了错误的任务身份。", { taskId, pending: true, code: "VOICE_DESIGN_INVALID_RESPONSE" });
  return snapshot;
}

/** Only explicit task-not-found permits replay of the same frozen submission. */
export async function readVoiceDesignTaskByIdempotencyKey(request: MusicRequest, key: string, signal?: AbortSignal): Promise<VoiceDesignSnapshot | null> {
  if (!validId(key)) throw new VoiceDesignError("原音色提交标识无效，请联系平台处理。", { pending: true, code: "VOICE_DESIGN_INVALID_KEY" });
  let value: unknown;
  try { value = await withAbort(request(`/voice-design/by-idempotency-key/${key}`, { signal }), signal); }
  catch (cause) {
    if (signal?.aborted) throw new VoiceDesignError("已暂停确认音色任务，请稍后继续。", { pending: true, code: "VOICE_DESIGN_LOOKUP_PAUSED", cause });
    if (statusCode(cause) === 404 && codeFrom(cause) === "voice_design_task_not_found") return null;
    throw new VoiceDesignError("暂时无法确认原音色任务，请稍后恢复。", { pending: true, code: codeFrom(cause) || "VOICE_DESIGN_LOOKUP_FAILED", cause });
  }
  const taskId = taskIdFrom(value);
  if (!taskId) throw new VoiceDesignError("原音色任务信息暂时不可用，请稍后恢复。", { pending: true, code: "VOICE_DESIGN_LOOKUP_INVALID" });
  return voiceDesignSnapshot(value, taskId);
}

export async function cancelVoiceDesign(request: MusicRequest, taskId: string, idempotencyKey?: string): Promise<VoiceDesignSnapshot> {
  if (!validId(taskId)) throw new VoiceDesignError("音色任务 ID 无效。", { code: "VOICE_DESIGN_INVALID_ID" });
  const response = await request(`/voice-design/tasks/${taskId}`, { method: "DELETE", headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined });
  const snapshot = voiceDesignSnapshot(response, taskId);
  if (snapshot.taskId !== taskId) throw new VoiceDesignError("音色服务返回了错误的任务身份。", { taskId, pending: true, code: "VOICE_DESIGN_INVALID_RESPONSE" });
  return snapshot;
}

export async function readVoiceDesignContent(request: MusicRequest, taskId: string, contentUrl?: string, signal?: AbortSignal): Promise<Blob> {
  if (!validId(taskId)) throw new VoiceDesignError("音色任务 ID 无效。", { code: "VOICE_DESIGN_INVALID_ID" });
  const fallback = `/voice-design/tasks/${taskId}/content`;
  let path = fallback;
  if (contentUrl) {
    let parsed: URL;
    try { parsed = new URL(contentUrl, "https://canvas.invalid"); }
    catch { throw new VoiceDesignError("试听音频地址无效。", { taskId, code: "VOICE_DESIGN_CONTENT_URL_INVALID" }); }
    const match = /^\/(?:v1\/)?voice-design\/tasks\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/content$/.exec(parsed.pathname);
    const indexes = parsed.searchParams.getAll("index");
    if (parsed.hash || match?.[1] !== taskId || [...parsed.searchParams.keys()].some(key => key !== "index") || indexes.length > 1 || indexes.some(index => !/^\d+$/.test(index))) throw new VoiceDesignError("试听音频地址与任务不匹配。", { taskId, code: "VOICE_DESIGN_CONTENT_URL_INVALID" });
    path = `${fallback}${indexes.length ? `?index=${indexes[0]}` : ""}`;
  }
  abortCheck(signal);
  try {
    const blob = await withAbort(request(path, { responseType: "blob", signal }), signal) as Blob;
    return await withAbort(validateMusicContentBlob(blob), signal);
  } catch (cause) {
    throw new VoiceDesignError(signal?.aborted ? "已暂停读取音色试听音频。" : "音色试听音频暂时不可用。", { taskId, pending: true, code: signal?.aborted ? "VOICE_DESIGN_CONTENT_PAUSED" : "VOICE_DESIGN_CONTENT_INVALID", cause });
  }
}

/** Create or recover one voice design; only the original frozen prompt is replayed. */
export async function generateVoiceDesign(
  request: MusicRequest,
  input: VoiceDesignInput,
  onTask?: (taskId: string) => void | Promise<void>,
  options: {
    signal?: AbortSignal; recovery?: boolean; delay?: (ms: number) => Promise<void>; intervalMs?: number;
    reconciliationIntervalMs?: number; maxConsecutiveReadFailures?: number;
    onStatus?: (snapshot: VoiceDesignSnapshot) => void | Promise<void>;
  } = {},
): Promise<VoiceDesignSnapshot> {
  let taskId = input.taskId;
  if (taskId && !validId(taskId)) throw new VoiceDesignError("音色任务 ID 无效。", { code: "VOICE_DESIGN_INVALID_ID" });
  const delay = options.delay || ((ms: number) => wait(ms, options.signal));
  const checkAbort = () => {
    if (options.signal?.aborted) throw new VoiceDesignError("已暂停查询，音色任务仍可恢复。", { taskId, pending: Boolean(taskId || input.idempotencyKey), code: "VOICE_DESIGN_PAUSED", cause: options.signal.reason });
  };
  const remember = async (id: string) => {
    try { await onTask?.(id); }
    catch (cause) { throw new VoiceDesignError("音色任务已提交，但恢复信息未能保存。", { taskId: id, pending: true, code: "VOICE_DESIGN_PERSIST_FAILED", cause }); }
  };
  const observe = async (snapshot: VoiceDesignSnapshot) => {
    await options.onStatus?.(snapshot);
    checkAbort();
    const state = mediaTaskPublicState(lifecycleFor(snapshot));
    if (state === "failed") throw new VoiceDesignError(snapshot.error || "音色生成失败。", { taskId, terminalTask: true, code: snapshot.code || "VOICE_DESIGN_FAILED" });
    if (state === "succeeded") {
      if (!snapshot.voiceId) throw new VoiceDesignError("音色结果尚未包含音色 ID，请稍后恢复。", { taskId, pending: true, code: "VOICE_DESIGN_RESULT_INCOMPLETE" });
      return true;
    }
    if (!snapshot.status) throw new VoiceDesignError("音色任务状态暂时不可用，请稍后恢复。", { taskId, pending: true, code: "VOICE_DESIGN_STATUS_MISSING" });
    return false;
  };
  checkAbort();
  if (!taskId && options.recovery) {
    const found = await readVoiceDesignTaskByIdempotencyKey(request, input.idempotencyKey || "", options.signal);
    if (found) {
      taskId = found.taskId;
      await remember(taskId);
      if (await observe(found)) return found;
    }
  }
  if (!taskId) {
    checkAbort();
    if (!input.prompt.trim() || !input.previewText.trim()) throw new VoiceDesignError("请填写音色描述和试听文本。", { code: "VOICE_DESIGN_INPUT_REQUIRED" });
    if ([...input.previewText].length > 500) throw new VoiceDesignError("试听文本最多 500 个字符。", { code: "VOICE_DESIGN_PREVIEW_TOO_LONG" });
    if (input.idempotencyKey && !validId(input.idempotencyKey)) throw new VoiceDesignError("音色提交标识无效。", { code: "VOICE_DESIGN_INVALID_KEY" });
    let response: unknown;
    try {
      // Preserve a late accepted ID before returning a local pause. Explicit
      // gateway cancellation is separate from stopping observation.
      response = await request("/voice-design/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
        body: JSON.stringify({ model: input.model || "minimax-voice-design", prompt: input.prompt, preview_text: input.previewText }),
      });
    } catch (cause) {
      const existing = taskIdFrom(record(cause).details) || taskIdFrom(cause);
      if (!existing) {
        const status = statusCode(cause), details = record(record(cause).details);
        const lifecycle = mediaTaskState({ status: statusFrom(details) || statusFrom(cause), code: codeFrom(cause) });
        const rejected = !lifecycle.requiresReconciliation && status >= 400 && status < 500 && ![408, 499].includes(status);
        throw new VoiceDesignError(rejected ? platformFailure(cause).message : "音色提交结果尚未确认，请恢复原提交。", { pending: !rejected && Boolean(input.idempotencyKey), terminalTask: rejected, code: codeFrom(cause) || "VOICE_DESIGN_SUBMISSION_FAILED", cause });
      }
      taskId = existing;
      response = cause;
    }
    taskId ||= taskIdFrom(response);
    if (taskId) await remember(taskId);
    checkAbort();
    if (!taskId) throw new VoiceDesignError("平台未返回音色任务编号，可在稍后恢复原提交。", { pending: Boolean(input.idempotencyKey), code: "VOICE_DESIGN_RESPONSE_INVALID" });
    const snapshot = voiceDesignSnapshot(response, taskId);
    // HTTP error responses can carry only an accepted ID. Read the durable
    // task before treating those responses as execution failure.
    if (snapshot.status && await observe(snapshot)) return snapshot;
  }
  if (!taskId) throw new VoiceDesignError("音色任务尚未获得编号。", { pending: Boolean(input.idempotencyKey), code: "VOICE_DESIGN_NO_TASK_ID" });
  const interval = Math.max(0, options.intervalMs ?? 1800);
  const reconciliationInterval = Math.max(interval, options.reconciliationIntervalMs ?? 15000);
  const maxFailures = Math.max(1, Math.min(10, Math.floor(options.maxConsecutiveReadFailures ?? 5)));
  let pollDelay = interval;
  let failures = 0;
  for (let attempt = 0; ; attempt += 1) {
    checkAbort();
    if (attempt > 0) {
      try { await withAbort(delay(pollDelay), options.signal); }
      catch (cause) { checkAbort(); throw cause; }
    }
    checkAbort();
    let snapshot: VoiceDesignSnapshot;
    try { snapshot = await readVoiceDesignTask(request, taskId, options.signal); }
    catch (cause) {
      checkAbort();
      if (cause instanceof VoiceDesignError) throw cause;
      const code = codeFrom(cause);
      if (statusCode(cause) === 404 && code === "voice_design_task_not_found") throw new VoiceDesignError("原音色任务已不存在，请重新生成。", { taskId, terminalTask: true, code, cause });
      const status = statusCode(cause);
      const retryable = platformFailure(cause).kind !== "login" && (status === 0 || [408, 425, 429].includes(status) || status >= 500);
      failures += 1;
      if (!retryable || failures >= maxFailures) throw new VoiceDesignError("暂时无法读取音色任务，请稍后恢复。", { taskId, pending: true, code: code || "VOICE_DESIGN_READ_UNAVAILABLE", cause });
      pollDelay = Math.min(8000, Math.max(interval, interval * 2 ** Math.max(0, failures - 1)));
      continue;
    }
    failures = 0;
    if (await observe(snapshot)) return snapshot;
    pollDelay = mediaTaskState(lifecycleFor(snapshot)).requiresReconciliation ? reconciliationInterval : interval;
  }
}
