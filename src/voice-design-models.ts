export type VoiceDesignModel = {
  id?: string;
  name?: string;
  type?: string;
  model_type?: string;
  is_default?: boolean;
  available?: boolean;
  supported_operations?: string[];
  supported_input_modes?: string[];
  supported_parameters?: Record<string, unknown>;
  default_parameters?: Record<string, unknown>;
  platform_capabilities?: Record<string, unknown>;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String).map(item => item.trim().toLowerCase()).filter(Boolean) : [];
const capability = (model: VoiceDesignModel, key: string): unknown => {
  const flat = (model as Record<string, unknown>)[key];
  return flat !== undefined ? flat : model.platform_capabilities?.[key];
};
const modelName = (model: VoiceDesignModel) => `${model.id || ""} ${model.name || ""}`.trim().toLowerCase();
const parameterNames = (model: VoiceDesignModel) => {
  const parameters = record(capability(model, "supported_parameters"));
  return Object.keys(parameters).map(value => value.toLowerCase());
};

/** Parse the public `{data: [...]}`, `{items: [...]}` or direct-list catalog shapes. */
export function catalogVoiceDesignModels(value: unknown): VoiceDesignModel[] {
  const body = record(value);
  const items = Array.isArray(value) ? value : Array.isArray(body.data) ? body.data : Array.isArray(body.items) ? body.items : [];
  return items.filter((item): item is VoiceDesignModel => {
    const candidate = record(item);
    return typeof candidate.id === "string" && Boolean(candidate.id.trim());
  }).map(model => ({ ...model, type: typeof model.type === "string" && model.type.trim() ? model.type : typeof model.model_type === "string" && model.model_type.trim() ? model.model_type : "audio" }));
}

/** Voice design is separate from generic song generation and must expose both required text fields. */
export function isVoiceDesignModel(model: VoiceDesignModel): boolean {
  const name = modelName(model), parameters = parameterNames(model);
  return /(?:voice[-_ ]design|音色)/i.test(name) || parameters.includes("preview_text") && !parameters.includes("lyrics");
}

export function voiceDesignModelUnavailableReason(model: VoiceDesignModel): string {
  if (model.available === false) return "暂不可用";
  const operations = capability(model, "supported_operations");
  if (Array.isArray(operations) && !operations.map(String).map(value => value.toLowerCase()).includes("generation")) return "不支持音色生成";
  const modes = capability(model, "supported_input_modes");
  if (Array.isArray(modes) && modes.length && !list(modes).some(mode => ["text", "prompt"].includes(mode))) return "不支持文字描述";
  const parameters = parameterNames(model);
  if (parameters.length && (!parameters.includes("prompt") || !parameters.includes("preview_text"))) return "模型参数不完整";
  return "";
}

export function compatibleVoiceDesignModels(models: VoiceDesignModel[]): VoiceDesignModel[] {
  return models.filter(model => String(model.type || model.model_type || "audio").toLowerCase() === "audio")
    .filter(isVoiceDesignModel)
    .filter(model => !voiceDesignModelUnavailableReason(model));
}

export function preferredVoiceDesignModel(models: VoiceDesignModel[]): VoiceDesignModel | undefined {
  const compatible = compatibleVoiceDesignModels(models);
  return compatible.find(model => model.is_default === true) || compatible[0];
}
