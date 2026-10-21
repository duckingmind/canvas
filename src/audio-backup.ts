import type { Document } from "./canvas-types.ts";
import { isLocalAudioKey, readLocalAudio, storeLocalAudio } from "./audio-cache.ts";

const MAX_BACKUP_AUDIO_BYTES = 180 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
type AudioBackupNode = Document["nodes"][number] & {
  musicReference?: { localAudio?: string; assetId?: string; title: string; duration: number; size: number; nodeId?: string };
  musicSubmission?: { referenceLocalAudio?: string; referenceAssetId?: string; referenceNodeId?: string; referenceTitle?: string; referenceDuration?: number; referenceSize?: number; key: string; model: string; prompt: string };
};
type AudioPayload = { mime: string; base64: string };
type AudioBackupDocument = Omit<Document, "nodes"> & { nodes: AudioBackupNode[]; audioAssets?: Record<string, AudioPayload>; audioMissing?: string[] };

function audioKeys(document: AudioBackupDocument): string[] {
  const keys = new Set<string>();
  for (const node of document.nodes) {
    for (const value of [
      node.localAudio,
      node.musicReference?.localAudio,
      node.musicSubmission?.referenceLocalAudio,
      ...(node.embeddedReferences || []).map(reference => reference.localAudio),
      ...(node.videoSubmission?.images || []).map(reference => reference.localAudio),
    ]) {
      if (value === undefined) continue;
      if (!isLocalAudioKey(value)) throw new Error("画布中的本机音频索引无效。");
      keys.add(value);
    }
  }
  return [...keys];
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromAudioPayload(value: unknown): Blob {
  if (!value || typeof value !== "object") throw new Error("备份中的音频数据格式无效。");
  const payload = value as Partial<AudioPayload>;
  if (typeof payload.mime !== "string" || !/^audio\/[a-z0-9.+-]+$/i.test(payload.mime) || typeof payload.base64 !== "string" || payload.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)) throw new Error("备份中的音频数据格式无效。");
  if (payload.base64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) throw new Error("单个备份音频不能超过 50 MiB。");
  const binary = atob(payload.base64);
  if (!binary.length || binary.length > MAX_AUDIO_BYTES) throw new Error("单个备份音频不能超过 50 MiB。");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: payload.mime });
}

export async function packageCanvasAudio<T extends Document>(
  document: T,
  options: { partial?: boolean; read?: (key: string) => Promise<Blob | null> } = {},
): Promise<{ document: T; audioAssets: Record<string, AudioPayload>; missing: number }> {
  const copy = structuredClone(document) as T & AudioBackupDocument;
  const assets: Record<string, AudioPayload> = {};
  let total = 0;
  const missing: string[] = [];
  const read = options.read || readLocalAudio;
  for (const key of audioKeys(copy)) {
    const blob = await read(key);
    if (!blob) { missing.push(key); continue; }
    if (blob.size > 50 * 1024 * 1024 || total + blob.size > MAX_BACKUP_AUDIO_BYTES) throw new Error("本机音频总量超过 180 MiB，请精简后再导出。");
    total += blob.size;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = blob.type.split(";")[0];
    assets[key] = { mime: mime.startsWith("audio/") ? mime : "audio/octet-stream", base64: toBase64(bytes) };
  }
  if (missing.length && !options.partial) throw new Error("部分本机音频已丢失，请重新添加音频，或选择仅导出可用内容。");
  if (missing.length) copy.audioMissing = missing;
  return { document: copy, audioAssets: assets, missing: missing.length };
}

export async function restoreCanvasAudio<T extends AudioBackupDocument>(
  value: T,
  options: { store?: (blob: Blob) => Promise<string>; read?: (key: string) => Promise<Blob | null> } = {},
): Promise<Omit<T, "audioAssets">> {
  const copy = structuredClone(value);
  const assets = copy.audioAssets;
  const referenced = new Set(audioKeys(copy));
  delete copy.audioAssets;
  delete copy.audioMissing;
  if (Object.hasOwn(value, "audioAssets") && (!assets || typeof assets !== "object" || Array.isArray(assets))) {
    throw new Error("备份中的音频索引无效。");
  }
  const restored = new Map<string, string>();
  const decoded = new Map<string, Blob>();
  let total = 0;
  if (assets) {
    for (const [key, payload] of Object.entries(assets)) {
      if (!referenced.has(key)) continue;
      if (!isLocalAudioKey(key)) throw new Error("备份中的音频索引无效。");
      const blob = fromAudioPayload(payload);
      total += blob.size;
      if (total > MAX_BACKUP_AUDIO_BYTES) throw new Error("备份音频总量超过 180 MiB。");
      decoded.set(key, blob);
    }
  }
  const store = options.store || storeLocalAudio;
  const read = options.read || (async (key: string) => {
    try { return await readLocalAudio(key); }
    catch { return null; }
  });
  for (const key of referenced) {
    const blob = decoded.get(key);
    if (blob) restored.set(key, await store(blob));
    else if (await read(key)) restored.set(key, key);
  }
  for (const key of referenced) {
    const newKey = restored.get(key);
    if (newKey && newKey !== key) {
      for (const node of copy.nodes) {
        if (node.localAudio === key) node.localAudio = newKey;
        if (node.musicReference?.localAudio === key) node.musicReference.localAudio = newKey;
        if (node.musicSubmission?.referenceLocalAudio === key) node.musicSubmission.referenceLocalAudio = newKey;
        if (node.embeddedReferences) {
          node.embeddedReferences = node.embeddedReferences.map(reference =>
            reference.localAudio === key ? { ...reference, localAudio: newKey } : reference,
          );
        }
        if (node.videoSubmission?.images) {
          node.videoSubmission.images = node.videoSubmission.images.map(reference =>
            reference.localAudio === key ? { ...reference, localAudio: newKey } : reference,
          );
        }
      }
    }
  }
  const missing = [...referenced].filter(key => !restored.has(key));
  if (missing.length) {
    for (const node of copy.nodes) {
      if (node.musicReference?.localAudio && missing.includes(node.musicReference.localAudio) && !node.musicReference.assetId) node.musicReference = undefined;
    }
    copy.audioMissing = missing;
  }
  return copy;
}
