export type VideoSettings = { duration?: number; size?: string; resolution?: string; aspect_ratio?: string; generate_audio?: boolean };
export type MediaModel = {
  id?: string; name?: string; model?: string; canonical_name?: string; type?: string; model_type?: string;
  /** Platform catalog default marker used when a new Canvas node has no saved selection. */
  is_default?: boolean;
  available?: boolean;
  supported_operations?: string[]; supported_input_modes?: string[];
  supported_durations?: (number | string)[]; duration_constraints?: { min_seconds?: number; max_seconds?: number; step_seconds?: number };
  supported_sizes?: string[]; supported_resolutions?: string[]; resolution_tiers?: string[]; supported_aspect_ratios?: string[];
  output_formats?: string[];
  supports_audio_generation?: boolean; platform_capabilities?: Record<string, unknown>; max_input_images?: number; max_reference_images?: number;
  supported_reference_types?: string[];
  quality_modes?: string[]; max_output_count?: number;
  resolution_sizes?: Record<string, string[]>; default_parameters?: Record<string, unknown>;
};
type ModelSelectionNode = {
  modelId?: string;
  modelSelection?: "user" | "default";
  taskId?: string;
  status?: string;
  image?: string;
  video?: string;
  audio?: string;
  submission?: unknown;
  videoSubmission?: unknown;
  musicSubmission?: unknown;
  voiceDesignSubmission?: unknown;
  ttsSubmission?: unknown;
};
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
const capability = (model: MediaModel | undefined, key: string): unknown => {
  const value = model as Record<string, unknown> | undefined;
  return value?.[key] !== undefined ? value[key] : model?.platform_capabilities?.[key];
};

/**
 * Keep the catalog authoritative. The gateway already returns the platform
 * contract after provider capability filtering, so a model-specific fallback
 * here could reintroduce values that the current contract has withdrawn (for
 * example a supplier-only 720p option). Compatibility is handled by reading
 * both flat and nested capability fields below; no model name is special.
 */
export function normalizeVideoModel(model?: MediaModel): MediaModel | undefined {
  return model;
}
export function catalogModels(value: unknown, kind: "image" | "video"): MediaModel[] {
  const body = value as { data?: unknown; items?: unknown } | null;
  const items = Array.isArray(value) ? value : Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : [];
  return items.filter((item): item is MediaModel => Boolean(item && typeof item === "object" && typeof item.id === "string" && item.id.trim()))
    .map(item => normalizeVideoModel({ ...item, type: kind }) || ({ ...item, type: kind }));
}
export function modelsForType(models: MediaModel[], kind: "image" | "video") {
  return models.filter(model => (model.type || model.model_type || "image") === kind);
}
export function mediaReferenceLimit(model?: MediaModel) {
  // The gateway currently serializes the optional max_reference_images field
  // as 0 when it is absent. A positive reference-specific limit is
  // authoritative; zero means "not declared" in that response shape, so
  // fall back to the platform's max_input_images contract.
  const referenceDeclared = capability(model, "max_reference_images");
  const referenceLimit = Number(referenceDeclared);
  if (referenceDeclared != null && Number.isInteger(referenceLimit) && referenceLimit > 0)
    return referenceLimit;
  const inputDeclared = capability(model, "max_input_images");
  const inputLimit = Number(inputDeclared);
  if (inputDeclared != null && Number.isInteger(inputLimit) && inputLimit >= 0)
    return inputLimit;
  return referenceDeclared != null && Number.isInteger(referenceLimit) && referenceLimit >= 0
    ? referenceLimit
    : undefined;
}
export function modelUnavailableReason(model: MediaModel, kind: "image" | "video", referenceCount = 0): string {
  if (model.available === false) return "暂不可用";
  const operations = capability(model, "supported_operations");
  if (Array.isArray(operations) && !operations.includes(kind === "image" && referenceCount > 0 ? "edit" : "generation"))
    return referenceCount > 0 ? "不支持参考图创作" : "不支持文字生成";
  const modes = capability(model, "supported_input_modes");
  if (!referenceCount) return Array.isArray(modes) && !modes.includes("text") ? "需要参考图" : "";
  const limit = mediaReferenceLimit(model);
  const imageModes = ["image", "reference_image", "single_reference", "multi_reference"];
  // Some published image catalogs expose the operation contract
  // (generation/edit) without repeating supported_input_modes. For image
  // models, `edit` is the platform-level declaration that references are
  // accepted. An explicit input-mode list still wins when it intentionally
  // removes reference support.
  const supportsImages = Array.isArray(modes) ? modes.some(mode => imageModes.includes(String(mode)))
    : (kind === "image" && Array.isArray(operations) && operations.includes("edit")) ||
      (limit !== undefined && limit > 0) ||
      list(capability(model, "supported_reference_types")).includes("image");
  if (!supportsImages || limit === 0) return "不支持参考图";
  return limit !== undefined && referenceCount > limit ? `最多 ${limit} 张参考图` : "";
}
export function compatibleModels(models: MediaModel[], kind: "image" | "video", references: boolean | number = false): MediaModel[] {
  return modelsForType(models, kind).filter(model => !modelUnavailableReason(model, kind, Number(references)));
}

/** Select the platform-designated default, falling back deterministically to the first compatible model. */
export function preferredModel(models: MediaModel[], kind: "image" | "video", references: boolean | number = false): MediaModel | undefined {
  const compatible = compatibleModels(models, kind, references);
  return compatible.find(model => model.is_default === true) || compatible[0];
}

/**
 * Return a saved model only when it represents an intentional choice or a
 * durable task/result. Older Canvas documents stored the platform default on
 * an idle prompt node without recording its source, so that value must be
 * refreshed when the platform default changes.
 */
export function selectedModelIdForNode(node: ModelSelectionNode | undefined): string | undefined {
  const modelId = typeof node?.modelId === "string" ? node.modelId.trim() : "";
  if (!modelId) return undefined;
  if (node?.modelSelection === "user") return modelId;
  const hasDurableTask = Boolean(
    node?.taskId || node?.submission || node?.videoSubmission ||
      node?.musicSubmission || node?.voiceDesignSubmission || node?.ttsSubmission ||
      node?.image || node?.video || node?.audio ||
      ["queued", "running", "completed"].includes(String(node?.status || "").toLowerCase()),
  );
  return hasDurableTask ? modelId : undefined;
}

/** Resolve a node model consistently across the editor, submitter and state checks. */
export function preferredModelForNode(
  models: MediaModel[],
  kind: "image" | "video",
  references: boolean | number,
  node?: ModelSelectionNode,
): MediaModel | undefined {
  const compatible = compatibleModels(models, kind, references);
  const saved = selectedModelIdForNode(node);
  return compatible.find(model => model.id === saved) || compatible.find(model => model.is_default === true) || compatible[0];
}
export function videoOptions(model?: MediaModel) {
  const normalized = normalizeVideoModel(model);
  const durations = list(capability(normalized, "supported_durations"));
  const constraints = capability(normalized, "duration_constraints") as MediaModel["duration_constraints"];
  if (!durations.length && constraints) {
    const min = Number(constraints.min_seconds), max = Number(constraints.max_seconds), step = Number(constraints.step_seconds ?? 1);
    if ([min, max, step].every(Number.isFinite) && min > 0 && max >= min && step > 0)
      for (let n = min; n <= max; n += step) durations.push(String(n));
  }
  const resolutions = list(capability(normalized, "supported_resolutions") ?? capability(normalized, "resolution_tiers"));
  const sizes = list(capability(normalized, "supported_sizes"));
  const aspectRatios = list(capability(normalized, "supported_aspect_ratios"));
  return { durations, resolutions, sizes, aspectRatios, audio: Boolean(capability(normalized, "supports_audio_generation")) };
}
export function resolveVideoSettings(model: MediaModel | undefined, settings: VideoSettings): VideoSettings {
  const normalized = normalizeVideoModel(model);
  const options = videoOptions(normalized);
  const defaults = capability(normalized, "default_parameters") as Record<string, unknown> | undefined;
  const select = (values: string[], preferred: unknown, fallback: unknown) => values.find(value => value === String(preferred)) || values.find(value => value === String(fallback)) || values[0];
  const duration = Number(select(options.durations, settings.duration, defaults?.duration));
  const resolution = select(options.resolutions, settings.resolution, defaults?.resolution);
  return {
    ...(Number.isFinite(duration) ? { duration } : {}),
    ...(resolution ? { resolution } : { size: select(options.sizes, settings.size, defaults?.size) }),
    aspect_ratio: select(options.aspectRatios, settings.aspect_ratio, defaults?.aspect_ratio),
    // Audio is a model capability, not a user-facing video option. Supported
    // models always use the product default and legacy saved false values do
    // not disable the generated audio track.
    ...(options.audio ? { generate_audio: true } : {}),
  };
}
export const videoReferenceLimit = mediaReferenceLimit;
