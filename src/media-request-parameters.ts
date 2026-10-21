import type { ImageGenerationInput } from "./generation.ts";
import type { VideoSettings } from "./video-models.ts";

/** Shared by submission and estimation so API field names cannot drift. */
export function imageGenerationParameters(input: Pick<ImageGenerationInput,
  "count" | "size" | "resolutionTier" | "qualityMode" | "aspectRatio" | "outputFormat" | "responseFormat"
>) {
  return {
    n: input.count || 1,
    ...(input.size ? { size: input.size } : {}),
    ...(input.resolutionTier ? { resolution_tier: input.resolutionTier } : {}),
    ...(input.qualityMode ? { quality_mode: input.qualityMode } : {}),
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
    ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
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
