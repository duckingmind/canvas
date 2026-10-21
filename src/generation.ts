import { platformFailure } from "./platform-status.ts";
import { fetchCanvasResource } from "./network-boundary.ts";
import { imageGenerationParameters } from "./media-request-parameters.ts";

export type ImageRequest = (
  path: string,
  init?: { method?: string; body?: BodyInit; headers?: Record<string, string> },
) => Promise<unknown>;
export type ImageGenerationInput = {
  model: string;
  prompt: string;
  /** Resolved image data/HTTP URLs; the caller checks the model's edit support. */
  images?: string[];
  taskId?: string;
  /** Persist with the exact request before POST, and reuse after an uncertain submission. */
  idempotencyKey?: string;
  count?: number;
  size?: string;
  resolutionTier?: string;
  qualityMode?: string;
  aspectRatio?: string;
  /** Encoded artifact format, separate from responseFormat (URL/base64). */
  outputFormat?: string;
  /** Freeze with the submission; absence preserves legacy request bodies. */
  responseFormat?: "url" | "b64_json";
};
export type ImageGenerationResult = { image: string; images?: string[]; thumbnails?: Array<string | undefined>; taskId?: string; assetIds?: string[] };
export type ImageGenerationOptions = {
  attempts?: number;
  intervalMs?: number;
  /** Bound transient GET recovery without ever repeating the creation request. */
  maxConsecutiveReadFailures?: number;
  delay?: (milliseconds: number) => Promise<void>;
  /** Stop local observation only. An already submitted task keeps running. */
  signal?: AbortSignal;
  /** Injectable image reader for testing; never used while resuming a task. */
  loadReference?: (url: string) => Promise<Blob>;
  /** Look up a frozen submission before replaying its creation request. */
  recovery?: { inputReferencesAvailable: boolean };
};

/** A pending task can be resumed with taskId; it must not be submitted again. */
export class ImageGenerationError extends Error {
  readonly taskId?: string;
  /** Provider/control-plane observation used to distinguish unknown from running. */
  readonly status?: string;
  /** Correlation id returned by the gateway when no task id is available. */
  readonly requestId?: string;
  readonly pending: boolean;
  readonly code: string;
  /** The platform confirmed the task ended, is absent, or rejected submission. */
  readonly terminalTask: boolean;

  constructor(
    message: string,
    options: {
      taskId?: string;
      status?: string;
      requestId?: string;
      pending?: boolean;
      code?: string;
      terminalTask?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ImageGenerationError";
    this.taskId = options.taskId;
    const source = record(options.cause), details = record(source.details);
    this.status = options.status || string(source.status) || string(source.task_status) || string(details.status) || undefined;
    this.requestId = options.requestId || string(source.requestId) || string(source.request_id) || string(details.requestId) || string(details.request_id) || undefined;
    this.pending = options.pending ?? false;
    this.code = options.code ?? "IMAGE_GENERATION_FAILED";
    this.terminalTask = options.terminalTask ?? false;
  }
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" ? (value as RecordValue) : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const taskRecord = (value: unknown) => {
  const body = record(value);
  return record(body.task || body.data);
};
const supplierConfirmationFrom = (value: unknown) => {
  const confirmation = record(taskRecord(value).supplier_confirmation);
  return {
    state: string(confirmation.state).trim().toLowerCase(),
    status: string(confirmation.status).trim().toLowerCase(),
    reason: string(confirmation.reason),
  };
};
const taskIdFrom = (value: unknown) => {
  const body = record(value),
    id = string(body.task_id) || string(body.id);
  // This is the public SDK route grammar. Valid colons must remain unescaped;
  // encodeURIComponent would turn them into a route the SDK rejects.
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : undefined;
};
const codeFrom = (value: unknown) =>
  string(record(value).code) || string(record(record(value).error).code);
const statusFrom = (value: unknown) => {
  const body = record(value), details = record(body.details);
  const status = string(body.status || body.task_status || details.status).trim().toLowerCase();
  if (status) return status;
  const phase = string(body.phase || record(body.task).phase || record(body.data).phase).trim().toLowerCase();
  switch (phase) {
    case "completed": return "completed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "canceling": return "cancel_pending";
    case "reconciling": return "unknown";
    case "running":
    case "dispatching":
    case "collecting": return "in_progress";
    default: return phase;
  }
};
const requestIdFrom = (value: unknown) => {
  const body = record(value), details = record(body.details);
  return string(body.request_id) || string(body.requestId) || string(details.request_id) || string(details.requestId) || undefined;
};
const statusCode = (value: unknown) => {
  const body = record(value), status = body.status ?? body.statusCode ?? body.status_code;
  return typeof status === "number" ? status : 0;
};
const messageFrom = (value: unknown) => {
  const body = record(value);
  return (
    string(record(body.error).message) ||
    string(body.error_message) ||
    string(body.message) ||
    string(body.error)
  );
};
type ImageResultEntry = { image: string; thumbnail?: string };
const imageResultsFrom = (value: unknown): ImageResultEntry[] => {
  const data = record(value).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const item = record(entry), url = string(item.url), base64 = string(item.b64_json);
    const image = /^https?:\/\//i.test(url) ? url : base64 ? `data:image/png;base64,${base64}` : "";
    if (!image) return [];
    const thumbnail = string(item.thumbnail_url) || string(item.thumbnailUrl);
    return [{ image, ...( /^https?:\/\//i.test(thumbnail) ? { thumbnail } : {}) }];
  });
};
const terminalFailure = (status: string) =>
  ["failed", "cancelled", "canceled", "expired", "refunded"].includes(status);

function retryableReadFailure(error: unknown): boolean {
  const kind = platformFailure(error).kind;
  if (kind === "login" || kind === "runtime" || kind === "developer" || kind === "permission") return false;
  const body = record(error);
  const status = body.status ?? body.statusCode ?? body.status_code;
  return typeof status !== "number" || status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function submissionRejection(error: unknown): "terminal" | "local" | undefined {
  const body = record(error),
    details = record(body.details),
    status = typeof body.status === "number" ? body.status : 0;
  if (
    terminalFailure(string(details.status)) ||
    terminalFailure(string(body.status))
  )
    return "terminal";
  // Being unable to authenticate or access this retry says nothing about an
  // earlier attempt with the same key. Keep its recovery identity available.
  if (status === 401 || status === 403 || ["login", "permission"].includes(platformFailure(error).kind))
    return "local";
  // An explicit client rejection cannot have started a valid task. Timeouts
  // and a closed client connection do not establish whether it was accepted.
  if (status >= 400 && status < 500 && status !== 408 && status !== 499)
    return "terminal";
  // These errors stop this local attempt before a POST, but do not settle a
  // previous uncertain submission restored with the same idempotency key.
  return [
    "APP_SESSION_UNAVAILABLE",
    "APP_API_PATH_NOT_ALLOWED",
    "LOCAL_DEV_RUNTIME_NOT_CONFIGURED",
    "APP_LOGIN_CANCELLED",
  ].includes(codeFrom(error) || codeFrom(details)) ? "local" : undefined;
}

function readResult(
  value: unknown,
  taskId?: string,
): ImageGenerationResult | undefined {
  const status = statusFrom(value);
  const supplierConfirmation = supplierConfirmationFrom(value);
  if (["unconfirmed", "unconfirmed_after_timeout"].includes(supplierConfirmation.state)) {
    throw new ImageGenerationError(
      supplierConfirmation.reason || "供应商结果尚未确认，平台不会重复提交。",
      {
        taskId,
        status: supplierConfirmation.status || status,
        code: "IMAGE_RESULT_UNCONFIRMED",
        pending: true,
      },
    );
  }
  if (terminalFailure(status)) {
    throw new ImageGenerationError(
      messageFrom(value) ||
        (["cancelled", "canceled"].includes(status) ? "图片任务已取消" : "图片生成失败"),
      {
        taskId,
        status,
        requestId: requestIdFrom(value),
        code: codeFrom(value) || `IMAGE_TASK_${status.toUpperCase()}`,
        terminalTask: true,
      },
    );
  }
  const results = imageResultsFrom(value);
  const images = results.map((item) => item.image);
  const image = images[0];
  if (image) {
    const data = record(value).data;
    // Keep asset IDs in the same result-slot order as imageResultsFrom. A
    // malformed provider entry is omitted from both arrays; filtering IDs in
    // a separate pass could otherwise attach result 2's asset to result 1.
    const assetIds = Array.isArray(data)
      ? data.flatMap((entry) => {
          const item = record(entry);
          const image = /^https?:\/\//i.test(string(item.url)) || Boolean(string(item.b64_json));
          return image ? [string(item.asset_id)] : [];
        })
      : [];
    const thumbnails = results.map((item) => item.thumbnail);
    return {
      image,
      ...(images.length > 1 ? { images } : {}),
      ...(thumbnails.some(Boolean) ? { thumbnails } : {}),
      ...(taskId ? { taskId } : {}),
      ...(assetIds.some(Boolean) ? { assetIds } : {}),
    };
  }
  if (status === "completed") {
    throw new ImageGenerationError("图片任务已完成，但没有返回可用图片", {
      taskId,
      code: "IMAGE_TASK_EMPTY_RESULT",
      terminalTask: true,
    });
  }
  return undefined;
}

async function readReference(url: string): Promise<Blob> {
  if (!/^(https?:\/\/|data:image\/|blob:)/i.test(url))
    throw new Error("图片地址无效");
  const response = await fetchCanvasResource(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  return response.blob();
}

/** Resolve a frozen image submission without issuing another creation POST. */
export async function readImageTaskByIdempotencyKey(
  request: ImageRequest,
  key: string,
): Promise<RecordValue | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
    throw new ImageGenerationError("原图片提交标识无效，请联系平台处理。", {
      pending: true,
      code: "IMAGE_SUBMISSION_INVALID_KEY",
    });
  }
  let value: unknown;
  try {
    value = await request(`/images/by-idempotency-key/${key}`);
  } catch (cause) {
    // Only the explicit not-found contract proves that no durable task exists.
    // A missing route, auth failure, or control-plane outage leaves the
    // original submission unresolved and must not trigger a replay.
    if (statusCode(cause) === 404 && codeFrom(cause) === "image_task_not_found")
      return null;
    throw new ImageGenerationError("暂时无法确认原图片任务，请稍后重试。", {
      pending: true,
      code: codeFrom(cause) || "IMAGE_SUBMISSION_LOOKUP_UNAVAILABLE",
      cause,
    });
  }
  const taskId = taskIdFrom(value);
  if (!taskId) {
    throw new ImageGenerationError("原图片任务信息暂时不可用，请稍后重试。", {
      pending: true,
      code: "IMAGE_SUBMISSION_LOOKUP_INVALID",
    });
  }
  return record(value);
}

async function editBody(
  input: ImageGenerationInput,
  loadReference: (url: string) => Promise<Blob>,
): Promise<FormData> {
  const form = new FormData();
  form.append("model", input.model);
  form.append("prompt", input.prompt);
  for (const [key, value] of Object.entries(imageGenerationParameters(input))) form.append(key, String(value));
  const images = [...new Set(input.images)];
  const files = await Promise.all(
    images.map(async (url, index) => {
      try {
        const blob = await loadReference(url);
        if (!blob.size) throw new Error("图片内容为空");
        if (
          !/^image\//i.test(blob.type) &&
          blob.type !== "application/octet-stream"
        )
          throw new Error("返回的内容不是图片");
        return blob;
      } catch (cause) {
        throw new ImageGenerationError(
          `第 ${index + 1} 张参考图无法读取，请重新上传图片后重试。${messageFrom(cause)}`,
          {
            code: "IMAGE_REFERENCE_UNAVAILABLE",
            cause,
          },
        );
      }
    }),
  );
  for (let index = 0; index < files.length; index++) {
    const blob = files[index];
    const extension =
      (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
        } as Record<string, string>
      )[blob.type] || "image";
    form.append("image[]", blob, `reference-${index + 1}.${extension}`);
  }
  return form;
}

/**
 * The image API normally returns images synchronously. A slow task instead
 * throws media_task_timeout with its task_id in AppSdkError.details. That
 * response means execution continues: switch to reads, never repeat the POST.
 */
export async function generateImage(
  request: ImageRequest,
  input: ImageGenerationInput,
  onTask?: (taskId: string) => void | Promise<void>,
  options: ImageGenerationOptions = {},
): Promise<ImageGenerationResult> {
  const attempts = Math.max(
    0,
    Math.floor(Number.isFinite(options.attempts) ? options.attempts! : 80),
  );
  const intervalMs = Math.max(
    0,
    Number.isFinite(options.intervalMs) ? options.intervalMs! : 1500,
  );
  const delay =
    options.delay ||
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let taskId = input.taskId;
  const rememberTask = async (id: string) => {
    try { await onTask?.(id); }
    catch (cause) {
      throw new ImageGenerationError("图片任务已提交，恢复信息暂时无法保存，请保留当前页面后重试。", {
        taskId: id, pending: true, code: "IMAGE_TASK_PERSIST_FAILED", cause,
      });
    }
  };
  const checkPaused = () => {
    if (options.signal?.aborted)
      throw new ImageGenerationError(
        taskId ? "已暂停查询，任务仍在后台运行" : "已停止提交图片任务",
        {
          taskId,
          pending: Boolean(taskId),
          code: taskId ? "IMAGE_TASK_PAUSED" : "IMAGE_SUBMISSION_STOPPED",
        },
      );
  };
  const waitForPoll = async (milliseconds: number) => {
    if (!options.signal) return delay(milliseconds);
    const signal = options.signal;
    let onAbort: () => void = () => {};
    const aborted = new Promise<void>((resolve) => {
      onAbort = resolve;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) resolve();
    });
    try {
      await Promise.race([delay(milliseconds), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
  if (taskId && !taskIdFrom({ id: taskId }))
    throw new ImageGenerationError("图片任务 ID 无效", {
      code: "IMAGE_TASK_INVALID_ID",
    });

  if (!taskId && options.recovery && input.idempotencyKey) {
    checkPaused();
    const recovered = await readImageTaskByIdempotencyKey(
      request,
      input.idempotencyKey,
    );
    checkPaused();
    if (recovered) {
      taskId = taskIdFrom(recovered);
      if (!taskId) {
        throw new ImageGenerationError("原图片任务信息暂时不可用，请稍后重试。", {
          pending: true,
          code: "IMAGE_SUBMISSION_LOOKUP_INVALID",
        });
      }
      await rememberTask(taskId);
      const result = readResult(recovered, taskId);
      if (result) return result;
    } else if (!options.recovery.inputReferencesAvailable) {
      // A missing frozen task plus missing source images is not safe to replay:
      // the caller cannot reproduce the original request byte-for-byte.
      throw new ImageGenerationError("原提交的参考图片缺失，请恢复原图片后重试。", {
        code: "IMAGE_SUBMISSION_INPUT_MISSING",
        pending: true,
      });
    }
  }

  if (!taskId) {
    checkPaused();
    if (!input.model.trim() || !input.prompt.trim())
      throw new ImageGenerationError("请选择图片模型并填写提示词", {
        code: "IMAGE_INPUT_REQUIRED",
      });
    const hasReferences = Boolean(input.images?.length);
    const body = hasReferences
      ? await editBody(input, options.loadReference || readReference)
      : JSON.stringify({ model: input.model, prompt: input.prompt, ...imageGenerationParameters(input) });
    checkPaused();
    let response: unknown;
    try {
      response = await request(
        hasReferences ? "/images/edits" : "/images/generations",
        {
          method: "POST",
          ...(!hasReferences || input.idempotencyKey
            ? {
                headers: {
                  ...(!hasReferences
                    ? { "Content-Type": "application/json" }
                    : {}),
                  ...(input.idempotencyKey
                    ? { "Idempotency-Key": input.idempotencyKey }
                    : {}),
                },
              }
            : {}),
          // Omit size: each catalog model defines its own supported defaults.
          // Fetch supplies the multipart boundary for reference image files.
          body,
        },
      );
    } catch (error) {
      const details = record(error).details,
        code = codeFrom(error) || codeFrom(details);
      const existingTask = taskIdFrom(details) || taskIdFrom(error);
      if (!existingTask) {
        const rejection = submissionRejection(error);
        const pending =
          Boolean(existingTask || input.idempotencyKey) && !rejection;
        const message =
          messageFrom(details) || messageFrom(error) || "无法提交图片任务";
        throw new ImageGenerationError(
          pending ? `提交结果尚未确认，可恢复原提交。${message}` : message,
          {
            code,
            taskId: existingTask,
            pending,
            terminalTask: rejection === "terminal",
            cause: error,
          },
        );
      }
      response = taskIdFrom(details) ? { ...record(error), ...record(details) } : error;
    }
    taskId = taskIdFrom(response);
    // Capture an accepted task even if observation was paused while POST was
    // pending. The caller must retain this identity rather than create again.
    if (taskId) await rememberTask(taskId);
    const result = readResult(response, taskId);
    if (result) return result;
    if (!taskId)
      throw new ImageGenerationError(
        input.idempotencyKey
          ? "平台响应未包含图片或任务 ID，可恢复原提交。"
          : "提交结果未知：平台没有返回图片或任务 ID，暂时无法确认是否已创建。",
        {
          status: statusFrom(response),
          requestId: requestIdFrom(response),
          code: "IMAGE_RESPONSE_INVALID",
          pending: Boolean(input.idempotencyKey),
        },
      );
  } else {
    await rememberTask(taskId);
  }

  const maxConsecutiveReadFailures = Math.max(1, Math.min(10, Math.floor(
    Number.isFinite(options.maxConsecutiveReadFailures) ? options.maxConsecutiveReadFailures! : 5,
  )));
  let consecutiveReadFailures = 0;
  let pollDelay = intervalMs;
  let lastObservedStatus: string | undefined;
  let lastRequestId: string | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    checkPaused();
    // Read immediately when resuming; subsequent observations are paced.
    if (attempt > 0) await waitForPoll(pollDelay);
    checkPaused();
    let response: unknown;
    try {
      response = await request(`/images/tasks/${taskId}`);
    } catch (error) {
      const code = codeFrom(error) || codeFrom(record(error).details);
      const missing = code === "image_task_not_found";
      const confirmedTerminal = terminalFailure(string(record(record(error).details).status)) || terminalFailure(string(record(error).status));
      if (!missing && !confirmedTerminal) checkPaused();
      if (!missing && !confirmedTerminal && retryableReadFailure(error)) {
        consecutiveReadFailures += 1;
        if (consecutiveReadFailures < maxConsecutiveReadFailures && attempt + 1 < attempts) {
          // A failed read does not change the durable task. Retry only its GET
          // through a bounded window, preserving the original submission.
          pollDelay = Math.min(8000, Math.max(intervalMs, intervalMs * 2 ** Math.max(0, consecutiveReadFailures - 1)));
          continue;
        }
      }
      const failure = platformFailure(error);
      const diagnostic = failure.kind === "service" ? messageFrom(error) : failure.message;
      throw new ImageGenerationError(
        missing
          ? "原图片任务已不存在，请重新生成。"
          : confirmedTerminal ? messageFrom(error) || "图片任务已结束。"
          : `暂时无法查询图片任务，可继续查询原任务。${diagnostic}`,
        {
          taskId,
          pending: !missing && !confirmedTerminal,
          terminalTask: missing || confirmedTerminal,
          code: code || "IMAGE_TASK_READ_FAILED",
          cause: error,
        },
      );
    }
    consecutiveReadFailures = 0;
    pollDelay = intervalMs;
    lastObservedStatus = statusFrom(response) || lastObservedStatus;
    lastRequestId = requestIdFrom(response) || lastRequestId;
    const result = readResult(response, taskId);
    if (result) return result;
  }
  checkPaused();
  throw new ImageGenerationError(
    "图片任务仍在处理中，可继续查询原任务，无需重新生成",
    {
      taskId,
      status: lastObservedStatus,
      requestId: lastRequestId,
      pending: true,
      code: "IMAGE_TASK_PENDING",
    },
  );
}
