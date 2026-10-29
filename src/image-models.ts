export type ImageSettings = {
  quality?: string;
  resolution?: string;
  aspectRatio?: string;
  size?: string;
  count?: number;
  /** Encoded image artifact format (png/jpeg/webp), when declared by the model. */
  outputFormat?: string;
};

export type ImageModel = {
  quality_modes?: string[];
  resolution_tiers?: string[];
  available_resolution_tiers?: string[] | null;
  resolution_sizes?: Record<string, string[]>;
  supported_sizes?: string[];
  supported_aspect_ratios?: string[];
  output_formats?: string[];
  max_output_count?: number;
  default_parameters?: Record<string, unknown>;
  platform_capabilities?: Record<string, unknown>;
  parameter_options?: {
    image_sizes?: Array<{ value?: string; ratio?: string; label?: string }>;
    image_qualities?: Array<{ value?: string; label?: string; image_sizes?: string[] }>;
  };
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(item => item.trim()))]
    : [];
const select = (values: string[], preferred: unknown, fallback: unknown) =>
  values.find(value => value === preferred) ||
  values.find(value => value === fallback) || values[0];
const orderedQualities = (values: string[]) => {
  const rank = new Map(["high", "medium", "low"].map((value, index) => [value, index]));
  return values
    .filter(value => value.toLowerCase() !== "auto")
    .sort((left, right) => {
      const leftRank = rank.get(left.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
};
const defaultQuality = (values: string[], backendDefault: unknown) =>
  values.find(value => value.toLowerCase() === "high") ||
  values.find(value => value === backendDefault) ||
  values[0];

/**
 * Read a capability from the model response. A field explicitly returned by
 * the model (including an empty array) is authoritative; the nested platform
 * capability snapshot is used only when the model omitted that field.
 */
const capability = (model: ImageModel | undefined, caps: Record<string, unknown>, key: string) => {
  if (model && Object.prototype.hasOwnProperty.call(model, key)) return (model as Record<string, unknown>)[key];
  return caps[key];
};

export function imageOptions(model?: ImageModel) {
  const caps = model?.platform_capabilities || {};
  const defaults = record(capability(model, caps, "default_parameters"));
  const qualities = orderedQualities(list(capability(model, caps, "quality_modes")));
  const availableResolutions = capability(model, caps, "available_resolution_tiers");
  const hasAvailableResolutions = Array.isArray(availableResolutions);
  const resolutions = hasAvailableResolutions
    ? list(availableResolutions)
    : list(capability(model, caps, "resolution_tiers"));
  const ratios = list(capability(model, caps, "supported_aspect_ratios"));
  const declaredSizes = list(capability(model, caps, "supported_sizes"));
  // Keep output formats capability driven. An omitted field means the model
  // does not expose this choice to Canvas; do not invent a platform default in
  // the browser. Values are normalized only for stable request serialization.
  const outputFormats = [...new Set(list(capability(model, caps, "output_formats")).map(value => value.toLowerCase()))];
  const legacySizes = model?.parameter_options?.image_sizes?.map(item => item?.value).filter((value): value is string => typeof value === "string") || [];
  const sizes = Object.prototype.hasOwnProperty.call(model || {}, "supported_sizes") || Object.prototype.hasOwnProperty.call(caps, "supported_sizes") ? declaredSizes : list(legacySizes);
  const qualityLabels = Object.fromEntries(
    (model?.parameter_options?.image_qualities || [])
      .filter(item => typeof item?.value === "string" && typeof item?.label === "string" && item.label.trim())
      .map(item => [item.value!.trim(), item.label!.trim()]),
  );
  const rawMapping = record(capability(model, caps, "resolution_sizes"));
  const resolutionSizes = Object.fromEntries(
    Object.entries(rawMapping).map(([tier, values]) => [tier, list(values)]),
  );
  const maximum = Number(capability(model, caps, "max_output_count"));
  const maxCount = Number.isInteger(maximum) && maximum > 0 ? maximum : 1;
  return {
    qualities, qualityLabels, resolutions, ratios, sizes, resolutionSizes, outputFormats, defaults,
    maxCount,
    // The server contract owns the quantity limit. Do not truncate this list
    // to a UI-specific value; a model may legitimately expose more outputs.
    countOptions: Array.from({ length: maxCount }, (_, index) => index + 1),
  };
}

/** Match the published size map exactly; unsupported tier/ratio pairs fail upstream. */
export function imageAspectRatios(model?: ImageModel, resolution?: string) {
  const options = imageOptions(model);
  const sizes = options.resolutionSizes[resolution || ""];
  if (!sizes?.length) return options.ratios;
  return options.ratios.filter(ratio => {
    const [numerator, denominator] = ratio.split(":").map(Number);
    return numerator > 0 && denominator > 0 && sizes.some(size => {
      const [width, height] = size.split("x").map(Number);
      return width > 0 && height > 0 && width * denominator === height * numerator;
    });
  });
}

/** Resolve defaults and stale saved settings against the selected model contract. */
export function resolveImageSettings(model?: ImageModel, settings: ImageSettings = {}): ImageSettings {
  const options = imageOptions(model);
  const quality = select(options.qualities, settings.quality, defaultQuality(options.qualities, options.defaults.quality_mode));
  const resolution = select(options.resolutions, settings.resolution, options.defaults.resolution_tier);
  const aspectRatio = select(imageAspectRatios(model, resolution), settings.aspectRatio, options.defaults.aspect_ratio);
  const sizes = options.resolutionSizes[resolution || ""] || options.sizes;
  // Tier + ratio is the public abstraction. Let the platform select its mapped
  // dimensions, avoiding a stale explicit size overriding either selection.
  const size = !resolution || !aspectRatio
    ? select(sizes, settings.size, options.defaults.size)
    : undefined;
  const requestedCount = Number(settings.count ?? options.defaults.n ?? 1);
  const count = Number.isFinite(requestedCount)
    ? Math.max(1, Math.min(options.maxCount, Math.floor(requestedCount)))
    : 1;
  const requestedOutputFormat = typeof settings.outputFormat === "string"
    ? settings.outputFormat.trim().toLowerCase()
    : settings.outputFormat;
  const defaultOutputFormat = typeof options.defaults.output_format === "string"
    ? options.defaults.output_format.trim().toLowerCase()
    : options.defaults.output_format;
  const outputFormat = select(
    options.outputFormats,
    requestedOutputFormat,
    defaultOutputFormat,
  );
  return {
    ...(quality ? { quality } : {}),
    ...(resolution ? { resolution } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(size ? { size } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    count,
  };
}

export function imageQualityLabel(value: string) {
  const labels: Record<string, string> = {
    high: "高画质",
    medium: "标准画质",
    low: "低画质",
    ultra: "超高画质",
    extreme: "极致画质",
    standard: "标准画质",
  };
  return labels[value.trim().toLowerCase()] || value;
}

export function imageSettingsSummary(settings: ImageSettings, model?: ImageModel) {
  const labels = imageOptions(model).qualityLabels;
  return [settings.aspectRatio || settings.size, settings.quality && (labels[settings.quality] || imageQualityLabel(settings.quality)), settings.resolution?.toUpperCase(), `${settings.count || 1} 张`].filter(Boolean).join(" · ");
}
