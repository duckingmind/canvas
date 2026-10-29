import { validateMusicContentBlob, type MusicRequest } from "./music-generation.ts";
import { readLocalAudio } from "./audio-cache.ts";
import { readPlatformAsset } from "./platform-asset-library.ts";
import type { StoredAsset } from "./canvas-types.ts";

export type AudioNodeSource = { id?: string; type?: string; mediaType?: string; audio?: unknown; localAudio?: string; audioTaskType?: "music" | "voice_design" | "tts"; voiceTrialAudioAvailable?: boolean; assetId?: string; taskId?: string; resultIndex?: number; status?: string };
export function hasRecoverableAudioIdentity(node: AudioNodeSource): boolean {
  const audio = node.type === "audio" || node.type === "prompt" && node.mediaType === "audio";
  return audio && Boolean(node.localAudio || node.assetId || node.taskId && node.voiceTrialAudioAvailable !== false) && (node.type === "audio" || node.status === "completed");
}
export function canLoadAudioContent(node: AudioNodeSource): boolean {
  return (node.type === "audio" || node.type === "prompt" && node.mediaType === "audio") && [undefined, "", "idle", "completed"].includes(node.status) &&
    Boolean(typeof node.audio === "string" && node.audio || node.localAudio || hasRecoverableAudioIdentity(node));
}
export function audioSourceIdentity(node: AudioNodeSource): string {
  return JSON.stringify([node.type, node.mediaType, node.taskId, node.assetId, node.audio, node.localAudio, node.audioTaskType, node.voiceTrialAudioAvailable, node.status]);
}

async function readTaskAudioAsset(api: { request: MusicRequest }, node: AudioNodeSource, options: {
  signal?: AbortSignal;
  fetchResource: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<Blob> {
  if (!node.taskId || node.audioTaskType === "tts") throw new Error("音频资源信息缺失");
  const route = node.audioTaskType === "voice_design" ? "voice-design" : "music";
  const result = await api.request(`/${route}/tasks/${encodeURIComponent(node.taskId)}`, { signal: options.signal }) as Record<string, any>;
  options.signal?.throwIfAborted();
  const candidates = [
    ...(Array.isArray(result?.assets) ? result.assets : []),
    ...(Array.isArray(result?.data) ? result.data : []),
  ].filter((asset: any) => asset && typeof asset === "object");
  const matching = node.assetId
    ? candidates.find((asset: any) => (asset.id || asset.asset_id) === node.assetId)
    : candidates.filter((asset: any) => {
      const type = String(asset.type || asset.content_type || "");
      return !type || type === "audio" || type.startsWith("audio/");
    })[node.resultIndex || 0];
  const trialAudio = result?.trial_audio && typeof result.trial_audio === "object" ? result.trial_audio : undefined;
  const url = String(matching?.url || trialAudio?.url || result?.content_url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("任务没有可用的对象存储音频地址");
  const response = await options.fetchResource(url, { signal: options.signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("音频暂时无法读取");
  return validateMusicContentBlob(await response.blob());
}

/** Task content is authenticated; only complete bytes become browser playback URLs. */
export async function readAudioSourceBlob(api: { request: MusicRequest }, node: AudioNodeSource, options: {
  signal?: AbortSignal; forceRefresh?: boolean; maxBytes?: number;
  fetchResource: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<Blob> {
  if (!canLoadAudioContent(node)) throw new Error("音频尚未生成完成或已不可用");
  options.signal?.throwIfAborted();
  let source = typeof node.audio === "string" ? node.audio : undefined;
  const legacyTTS = node.audioTaskType === "tts" || /\/(?:v1\/)?tts\/tasks\/[^/]+\/content/.test(source || "");
  let assetId = node.assetId;
  if (node.localAudio) {
    const local = await readLocalAudio(node.localAudio);
    options.signal?.throwIfAborted();
    if (local) {
      if (options.maxBytes && local.size > options.maxBytes) throw Object.assign(new Error("音频超过读取大小限制"), { code: "AUDIO_CONTENT_TOO_LARGE" });
      return validateMusicContentBlob(local);
    }
    if (!source && !node.assetId && !node.taskId) throw new Error("本机音频未找到，请回到录音或上传时使用的浏览器，或重新添加音频。");
  }
  // Inline imports already contain their bytes. Asset-backed audio refreshes
  // its signed delivery address before fetching; it may come from any audio API.
  // Retired synthesis results are ordinary audio assets. Resolve old task-only
  // records through the shared asset service without invoking the TTS API.
  if (legacyTTS && !assetId && node.taskId && (!source || /\/(?:v1\/)?tts\/tasks\//.test(source))) {
    const query = new URLSearchParams({ task_id: node.taskId, type: "audio", page: "1", limit: "100" });
    const result = await api.request(`/media/assets?${query}`, { signal: options.signal }) as { items?: StoredAsset[] };
    options.signal?.throwIfAborted();
    const matches = result?.items?.filter(asset => asset.task_id === node.taskId && asset.type === "audio" && asset.id);
    if (matches?.length !== 1) throw new Error("历史音频资产暂不可用，请从素材库重新选择音频。");
    assetId = matches[0].id;
  }
  if (assetId && !/^(?:data|blob):/i.test(source || "")) {
    try {
      const asset = await readPlatformAsset({ request: <T,>(path: string, init?: RequestInit) => api.request(path, init as Parameters<MusicRequest>[1]) as Promise<T> }, assetId, { signal: options.signal, forceRefresh: options.forceRefresh });
      if (asset.storedAsset.type !== "audio" || asset.storedAsset.id !== assetId) throw new Error("音频资产身份无效");
      source = asset.url;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!node.taskId || legacyTTS) throw error;
      source = undefined;
    }
  }
  let blob: Blob;
  if (source && /^(?:https?:|blob:|data:audio\/)/i.test(source) && !/\/(?:v1\/)?(?:music|voice-design|tts)\/tasks\/[^/]+\/content/.test(source)) {
    try {
      const response = await options.fetchResource(source, { signal: options.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("音频暂时无法读取");
      const length = Number(response.headers.get("content-length"));
      if (options.maxBytes && length > options.maxBytes) throw Object.assign(new Error("音频超过读取大小限制"), { code: "AUDIO_CONTENT_TOO_LARGE" });
      blob = await validateMusicContentBlob(await response.blob());
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!node.taskId || legacyTTS) throw error;
      blob = await readTaskAudioAsset(api, node, options);
    }
  } else if (node.taskId) {
    if (legacyTTS) throw new Error("历史音频资产暂不可用，请从素材库重新选择音频。");
    blob = await readTaskAudioAsset(api, node, options);
  } else throw new Error("音频资源信息缺失");
  options.signal?.throwIfAborted();
  if (options.maxBytes && blob.size > options.maxBytes) throw Object.assign(new Error("音频超过读取大小限制"), { code: "AUDIO_CONTENT_TOO_LARGE" });
  return blob;
}
