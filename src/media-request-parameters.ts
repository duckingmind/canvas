import type { ImageGenerationInput } from "./generation.ts";
import type { VideoSettings } from "./video-models.ts";

type ImageParameterInput = Pick<ImageGenerationInput,
  "count" | "size" | "resolutionTier" | "qualityMode" | "aspectRatio" | "outputFormat"
>;

/** Pricing dimensions shared by generation and estimate requests. */
export function imageEstimateParameters(input: ImageParameterInput) {
  return {
    n: input.count || 1,
    ...(input.size ? { size: input.size } : {}),
    ...(input.resolutionTier ? { resolution_tier: input.resolutionTier } : {}),
    ...(input.qualityMode ? { quality_mode: input.qualityMode } : {}),
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
  };
}

/** Generation additionally chooses the response delivery format. */
export function imageGenerationParameters(input: ImageParameterInput) {
  return {
    ...imageEstimateParameters(input),
    // Canvas persists and renders media by its platform/COS URL. Never allow
    // a legacy b64_json preference to select an inline response.
    response_format: "url" as const,
  };
}

/** Preserve explicit false/zero values for frozen, idempotent video retries. */
export function videoGenerationParameters(input: VideoSettings) {
  const parameters: Record<string, string | number | boolean> = {};
  if (input.generate_audio !== undefined) parameters.generate_audio = input.generate_audio;
  for (const key of ["duration", "size", "resolution", "aspect_ratio"] as const) {
    const value = input[key];
    if (value !== undefined && value !== "") parameters[key] = value;
  }
  return parameters;
}
