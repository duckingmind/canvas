export type MusicSettings = {
  audio_mode?: string;
  output_format?: string;
  duration?: number;
  lyrics_optimizer?: boolean;
};

export type MusicModel = {
  id?: string;
  name?: string;
  type?: string;
  model_type?: string;
  is_default?: boolean;
  available?: boolean;
  audio_modes?: string[];
  supported_durations?: (number | string)[];
  duration_constraints?: { min_seconds?: number; max_seconds?: number; step_seconds?: number };
  output_formats?: string[];
  supported_reference_types?: string[];
  supported_input_modes?: string[];
  supported_operations?: string[];
  supported_parameters?: Record<string, unknown>;
  default_parameters?: Record<string, unknown>;
  platform_capabilities?: Record<string, unknown>;
};

const list = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))]
  : [];

const capability = (model: MusicModel | undefined, key: string): unknown => {
  const value = model as Record<string, unknown> | undefined;
  if (value && value[key] !== undefined) return value[key];
  return model?.platform_capabilities?.[key];
};

const parameterCapability = (model: MusicModel | undefined, key: string): Record<string, unknown> | undefined => {
  const parameters = capability(model, "supported_parameters");
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return undefined;
  const value = (parameters as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
};

const modelName = (model: MusicModel): string => `${model.id || ""} ${model.name || ""}`.trim().toLowerCase();
const isMusicCoverModel = (model: MusicModel): boolean => /music[- ]cover|翻唱/i.test(modelName(model));
const isSpeechModel = (model: MusicModel): boolean => {
  const parameters = capability(model, "supported_parameters");
  return /tts|speech|文本转语音|语音合成/i.test(modelName(model)) || Boolean(
    parameters && typeof parameters === "object" && !Array.isArray(parameters) &&
    ("voice_setting" in parameters || "voice_id" in parameters),
  );
};
const isVoiceDesignModel = (model: MusicModel): boolean => {
  if (/(?:voice[- ]design|音色)/i.test(modelName(model))) return true;
  const parameters = capability(model, "supported_parameters");
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return false;
  const names = Object.keys(parameters as Record<string, unknown>).map(value => value.toLowerCase());
  return names.includes("preview_text") && !names.includes("lyrics") && list(capability(model, "audio_modes")).length === 0;
};

export function supportsMusicParameter(model: MusicModel | undefined, key: string, expectedType?: string): boolean {
  const parameter = parameterCapability(model, key);
  if (!parameter) return false;
  if (expectedType) return parameter.type === expectedType;
  return ["boolean", "string", "number", "integer"].includes(String(parameter.type)) || Array.isArray(parameter.enum);
}

/** Return a user-facing reason when Canvas cannot submit to a catalog model. */
export function musicModelUnavailableReason(model: MusicModel, inputMode: "text" | "reference_audio" = "text"): string {
  if (model.available === false) return "暂不可用";
  if (isSpeechModel(model)) return "不支持音乐生成";
  if (isVoiceDesignModel(model)) return "音色合成使用独立的音色设计功能";
  if (isMusicCoverModel(model) && inputMode !== "reference_audio") return "请先添加参考音频";
  const operations = capability(model, "supported_operations");
  if (Array.isArray(operations) && !operations.includes("generation")) return "不支持音乐生成";
  const modes = capability(model, "supported_input_modes");
  if (!Array.isArray(modes) || modes.length === 0) return inputMode === "reference_audio" && !isMusicCoverModel(model) ? "未声明参考音频支持" : "";
  const normalized = modes.map(value => String(value).trim().toLowerCase());
  if (inputMode === "text" && (normalized.includes("text") || normalized.includes("lyrics") || normalized.includes("prompt"))) return "";
  if (inputMode === "reference_audio" && normalized.includes("reference_audio")) return "";
  if (normalized.includes("reference_audio")) return "请先添加参考音频";
  return inputMode === "reference_audio" ? "不支持参考音频" : "不支持文字生成";
}

export function compatibleMusicModels(models: MusicModel[], inputMode: "text" | "reference_audio" = "text"): MusicModel[] {
  return musicModels(models).filter(model => !musicModelUnavailableReason(model, inputMode));
}

export function catalogMusicModels(value: unknown): MusicModel[] {
  const body = value as { data?: unknown; items?: unknown } | null;
  const items = Array.isArray(value) ? value : Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : [];
  return items
    .filter((item): item is MusicModel => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && String((item as { id: string }).id).trim()))
    .map(item => ({ ...item, type: "audio" }));
}

export function musicModels(models: MusicModel[]): MusicModel[] {
  return models.filter(model => {
    if ((model.type || model.model_type || "audio") !== "audio") return false;
    // Voice design has a separate creator workflow. Cover compatibility is
    // resolved from the creator's actual reference-audio input.
    return !isVoiceDesignModel(model) && !isSpeechModel(model);
  });
}

export function musicOptions(model?: MusicModel) {
  const modes = list(capability(model, "audio_modes"));
  const durations = list(capability(model, "supported_durations"));
  const constraints = capability(model, "duration_constraints") as MusicModel["duration_constraints"];
  if (!durations.length && constraints) {
    const min = Number(constraints.min_seconds), max = Number(constraints.max_seconds), step = Number(constraints.step_seconds || 1);
    if ([min, max, step].every(Number.isFinite) && min > 0 && max >= min && step > 0)
      for (let value = min; value <= max; value += step) durations.push(String(value));
  }
  const formats = list(capability(model, "output_formats")).map(value => value.toLowerCase());
  const defaults = (capability(model, "default_parameters") || {}) as Record<string, unknown>;
  return { modes, durations, formats, defaults, supportsLyricsOptimizer: supportsMusicParameter(model, "lyrics_optimizer", "boolean") };
}

export function resolveMusicSettings(model: MusicModel | undefined, settings: MusicSettings = {}): MusicSettings {
  const options = musicOptions(model);
  const select = (values: string[], preferred: unknown, fallback: unknown) => values.find(value => value === String(preferred)) || values.find(value => value === String(fallback)) || values[0];
  const mode = select(options.modes, settings.audio_mode, options.defaults.audio_mode);
  const format = select(options.formats, settings.output_format?.toLowerCase(), typeof options.defaults.output_format === "string" ? options.defaults.output_format.toLowerCase() : undefined);
  const hasDuration = settings.duration !== undefined || options.defaults.duration !== undefined;
  const durationValue = Number(settings.duration ?? options.defaults.duration);
  const defaultDuration = Number(options.defaults.duration);
  const duration = hasDuration && options.durations.length && Number.isFinite(durationValue)
    ? Number(options.durations.find(value => Number(value) === durationValue) || options.durations.find(value => Number(value) === defaultDuration) || options.durations[0])
    : undefined;
  return {
    ...(mode ? { audio_mode: mode } : {}),
    ...(format ? { output_format: format } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(options.supportsLyricsOptimizer && typeof settings.lyrics_optimizer === "boolean"
      ? { lyrics_optimizer: settings.lyrics_optimizer }
      : options.supportsLyricsOptimizer && typeof options.defaults.lyrics_optimizer === "boolean"
        ? { lyrics_optimizer: options.defaults.lyrics_optimizer }
        : {}),
  };
}

export function preferredMusicModel(models: MusicModel[], inputMode: "text" | "reference_audio" = "text"): MusicModel | undefined {
  const available = compatibleMusicModels(models, inputMode);
  return available.find(model => model.is_default === true) || available[0];
}
