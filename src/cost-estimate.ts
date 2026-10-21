import type { ImageSettings } from "./image-models.ts";
import type { VideoSettings } from "./video-models.ts";
import { imageGenerationParameters, videoGenerationParameters } from "./media-request-parameters.ts";

export type MediaEstimateRequest = {
  model: string;
  model_type: "image" | "video";
  operation: "generation" | "edit";
  parameters: Record<string, string | number | boolean>;
};

type EstimateInput = { model: string; referenceCount: number } & (
  | { kind: "image"; settings: ImageSettings }
  | { kind: "video"; settings: VideoSettings }
);

/** Pricing uses the same resolved catalog settings as the generation request. */
export function mediaEstimateRequest(input: EstimateInput): MediaEstimateRequest {
  const parameters = input.kind === "video"
    ? videoGenerationParameters(input.settings)
    : imageGenerationParameters({
        count: input.settings.count,
        size: input.settings.size,
        resolutionTier: input.settings.resolution,
        qualityMode: input.settings.quality,
        aspectRatio: input.settings.aspectRatio,
        outputFormat: input.settings.outputFormat,
      });
  return {
    model: input.model,
    model_type: input.kind,
    operation: input.kind === "image" && input.referenceCount > 0 ? "edit" : "generation",
    parameters: { ...parameters, input_image_count: input.referenceCount },
  };
}

export type CostEstimate =
  | { status: "loading" }
  | { status: "unavailable"; reasonCode?: string }
  | { status: "error"; reasonCode?: string }
  | { status: "ready"; amount: number; currency: string };

const reasonCodeFrom = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  const nested = body.error && typeof body.error === "object"
    ? body.error as Record<string, unknown>
    : undefined;
  const details = body.details && typeof body.details === "object"
    ? body.details as Record<string, unknown>
    : undefined;
  const detailsError = details?.error && typeof details.error === "object"
    ? details.error as Record<string, unknown>
    : undefined;
  const candidates = [
    body.reason_code,
    body.reasonCode,
    body.code,
    nested?.reason_code,
    nested?.reasonCode,
    nested?.code,
    details?.reason_code,
    details?.reasonCode,
    details?.code,
    detailsError?.reason_code,
    detailsError?.reasonCode,
    detailsError?.code,
  ];
  const code = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  return code?.trim().toLowerCase();
};

/** Keep server reason codes visible to the UI instead of collapsing every miss into one state. */
export function readCostEstimateError(error: unknown): CostEstimate {
  const body = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = [body.status, body.statusCode]
    .find((value): value is number => typeof value === "number");
  const reasonCode = reasonCodeFrom(error) || (
    body.name === "AbortError" || body.code === "ETIMEDOUT" ? "timeout" :
      typeof status === "number" && status >= 500 ? "service_unavailable" : "network_error"
  );
  return { status: "error", reasonCode };
}

/** Treat unknown or malformed prices as unavailable, never as a free request. */
export function readCostEstimate(value: unknown): CostEstimate {
  const reasonCode = reasonCodeFrom(value);
  if (!value || typeof value !== "object") return { status: "unavailable", ...(reasonCode ? { reasonCode } : {}) };
  const result = value as Record<string, unknown>;
  if (result.known !== true || typeof result.amount !== "number" || !Number.isFinite(result.amount) || result.amount < 0 ||
    typeof result.currency !== "string" || !/^[A-Z]{3}$/.test(result.currency)) {
    return { status: "unavailable", ...(reasonCode ? { reasonCode } : {}) };
  }
  return { status: "ready", amount: result.amount, currency: result.currency };
}

const reasonLabels: Record<string, string> = {
  unsupported_parameters: "当前参数组合不支持估价",
  model_unavailable: "当前模型暂不可用",
  no_eligible_provider: "暂无匹配的供应商",
  no_eligible_supplier: "暂无匹配的供应商",
  supply_unavailable: "供应商暂时不可用",
  duration_required: "请设置视频时长后再估价",
  billing_subject_required: "账户信息未就绪，暂时无法估价",
  pricing_unavailable: "价格配置暂未就绪",
  invalid_request: "当前参数无法估价",
  model_type_not_allowed: "当前平台凭证缺少估价所需权限",
  insufficient_scope: "当前平台凭证缺少估价所需权限",
  service_unavailable: "估价服务暂时不可用",
  timeout: "估价请求超时",
  network_error: "估价服务暂时不可用",
  request_failed: "估价服务暂时不可用",
  app_session_expired: "平台授权已过期，请重新连接账户",
  credential_invalid: "平台授权已失效，请重新连接账户",
};

export function estimatedCostReason(estimate: CostEstimate): string | undefined {
  if (estimate.status !== "unavailable" && estimate.status !== "error") return undefined;
  return estimate.reasonCode ? reasonLabels[estimate.reasonCode] : undefined;
}

export function estimatedCostLabel(estimate: CostEstimate): string {
  if (estimate.status === "loading") return "估算中…";
  if (estimate.status === "unavailable" || estimate.status === "error") return estimatedCostReason(estimate) || "暂无法估价";
  const minimum = 0.000001;
  const formatter = new Intl.NumberFormat("zh-CN", {
    style: "currency", currency: estimate.currency, currencyDisplay: "symbol",
    minimumFractionDigits: 2, maximumFractionDigits: 6,
  });
  const belowMinimum = estimate.amount > 0 && estimate.amount < minimum;
  return `预估 ${belowMinimum ? "<" : ""}${formatter.format(belowMinimum ? minimum : estimate.amount)}`;
}
