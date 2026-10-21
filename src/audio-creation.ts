import { isLocalAudioKey } from "./audio-cache.ts";
export { isLocalAudioKey } from "./audio-cache.ts";
import type { CanvasNode, MusicReference, MusicSubmission, TTSSettings, TTSSubmission, VoiceDesignSubmission } from "./canvas-types.ts";
import { creationInputSignature } from "./creation-state.ts";
import { compatibleMusicModels, preferredMusicModel, resolveMusicSettings, type MusicModel } from "./music-models.ts";
import { compatibleVoiceDesignModels, preferredVoiceDesignModel } from "./voice-design-models.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : undefined;
/** Durable output/task identity takes priority; an idle creator uses its selected mode. */
export const isVoiceDesignNode = (node: Pick<CanvasNode, "audioMode" | "audioTaskType" | "voiceDesignSubmission">) => node.audioTaskType === "voice_design" || Boolean(node.voiceDesignSubmission) || !node.audioTaskType && node.audioMode === "voice_design";
/** Legacy documents retain TTS identity for read-only media and recovery data. */
export const isTTSNode = (node: Pick<CanvasNode, "audioMode" | "audioTaskType"> & { ttsSubmission?: unknown }) => node.audioTaskType === "tts" || Boolean(node.ttsSubmission) || node.audioMode === "tts";

const ttsText = (value: unknown, limit: number) => typeof value === "string" ? [...value].slice(0, limit).join("") : undefined;
export function normalizeTTSSettings(value: unknown): TTSSettings | undefined {
  const source = record(value);
  const result: TTSSettings = {};
  for (const key of ["speed", "vol", "pitch", "sample_rate", "bitrate"] as const) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
  }
  for (const key of ["voice_id", "emotion", "output_format", "language_boost", "pronunciation_rules"] as const) {
    const raw = ttsText(source[key], key === "pronunciation_rules" ? 2000 : 256);
    if (raw) result[key] = raw;
  }
  return Object.keys(result).length ? result : undefined;
}

export function normalizeTTSSubmission(value: unknown): TTSSubmission | undefined {
  const source = record(value);
  if (typeof source.key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.key) || typeof source.model !== "string" || !source.model || typeof source.text !== "string") return undefined;
  const settings = normalizeTTSSettings(source.settings);
  if (!settings?.voice_id) return undefined;
  return { key: source.key, model: source.model.slice(0, 160), text: ttsText(source.text, 50000) || "", settings };
}

export function normalizeMusicReference(value: unknown): MusicReference | undefined {
  const source = record(value);
  const localAudio = isLocalAudioKey(source.localAudio) ? source.localAudio : undefined;
  const assetId = text(source.assetId, 256);
  if ((!localAudio && !assetId) || typeof source.duration !== "number" || !Number.isFinite(source.duration) || source.duration < 6 || source.duration > 360 || typeof source.size !== "number" || !Number.isFinite(source.size) || source.size <= 0 || source.size > 50 * 1024 * 1024) return undefined;
  return { ...(localAudio ? { localAudio } : {}), ...(assetId ? { assetId } : {}), title: text(source.title, 160) || "参考音频", duration: source.duration, size: source.size, ...(text(source.nodeId, 120) ? { nodeId: text(source.nodeId, 120) } : {}) };
}

export function normalizeMusicSubmission(value: unknown): MusicSubmission | undefined {
  const source = record(value);
  if (typeof source.key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.key) || typeof source.model !== "string" || !source.model || typeof source.prompt !== "string") return undefined;
  return {
    key: source.key, model: source.model.slice(0, 160), prompt: source.prompt.slice(0, 20000),
    ...(typeof source.lyrics === "string" ? { lyrics: source.lyrics.slice(0, 20000) } : {}),
    ...(typeof source.audio_mode === "string" ? { audio_mode: source.audio_mode } : {}),
    ...(typeof source.output_format === "string" ? { output_format: source.output_format } : {}),
    ...(typeof source.duration === "number" && Number.isFinite(source.duration) ? { duration: source.duration } : {}),
    ...(typeof source.lyrics_optimizer === "boolean" ? { lyrics_optimizer: source.lyrics_optimizer } : {}),
    ...(isLocalAudioKey(source.referenceLocalAudio) ? { referenceLocalAudio: source.referenceLocalAudio } : {}),
    ...(text(source.referenceAssetId, 256) ? { referenceAssetId: text(source.referenceAssetId, 256) } : {}),
    ...(text(source.referenceNodeId, 120) ? { referenceNodeId: text(source.referenceNodeId, 120) } : {}),
    ...(source.referenceLocalAudio || source.referenceAssetId ? { referenceTitle: text(source.referenceTitle, 160), referenceDuration: typeof source.referenceDuration === "number" ? source.referenceDuration : undefined, referenceSize: typeof source.referenceSize === "number" ? source.referenceSize : undefined } : {}),
  };
}

export function normalizeVoiceDesignSubmission(value: unknown): VoiceDesignSubmission | undefined {
  const source = record(value);
  if (typeof source.key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.key) || typeof source.model !== "string" || !source.model || typeof source.prompt !== "string" || typeof source.previewText !== "string") return undefined;
  return { key: source.key, model: source.model.slice(0, 160), prompt: source.prompt.slice(0, 20000), previewText: [...source.previewText].slice(0, 500).join("") };
}

/** Same effective audio inputs drive completion tracking and the next submission. */
export function audioCreationInputs(node: CanvasNode, models: MusicModel[]) {
  if (node.audioMode === "voice_design") {
    const available = compatibleVoiceDesignModels(models);
    const selected = available.find(model => model.id === node.modelId) || preferredVoiceDesignModel(available);
    return { model: selected?.id || node.modelId || "", settings: { audioMode: "voice_design", previewText: node.voicePreviewText || "" } };
  }
  if (node.audioMode === "tts") {
    // Fingerprint historical data without looking up a synthesis model or
    // allowing it to fall through to music generation.
    return { model: node.modelId || "", settings: { audioMode: "tts", text: node.text || "", ...(node.ttsSettings || {}) } };
  }
  const mode = node.musicReference ? "reference_audio" : "text";
  const available = compatibleMusicModels(models, mode);
  const selected = available.find(model => model.id === node.modelId) || preferredMusicModel(available, mode);
  const settings = resolveMusicSettings(selected, node.musicSettings);
  return { model: selected?.id || node.modelId || "", settings: { audioMode: node.audioMode || "music", ...settings, lyrics: settings.audio_mode === "instrumental" ? "" : node.musicLyrics?.trim() || "", referenceLocalAudio: node.musicReference?.localAudio || "", referenceAssetId: node.musicReference?.assetId || "" } };
}

export function audioCreationSignature(node: CanvasNode, models: MusicModel[], prompt: string): string {
  const input = audioCreationInputs(node, models);
  return creationInputSignature({ prompt, model: input.model, settings: input.settings, references: [] });
}
