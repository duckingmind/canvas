import type { CanvasNode, Document } from "./canvas-types.ts";
import { isLocalVideoKey, readLocalVideo, storeLocalVideo } from "./video-cache.ts";

const MAX_BACKUP_VIDEO_BYTES = 180 * 1024 * 1024;
const MAX_VIDEO_BYTES = 160 * 1024 * 1024;

type VideoBackupNode = CanvasNode & { localVideo?: string };
type VideoPayload = { mime: string; base64: string };
type VideoBackupDocument = Omit<Document, "nodes"> & {
  nodes: VideoBackupNode[];
  videoAssets?: Record<string, VideoPayload>;
  videoMissing?: string[];
};

function videoKeys(document: VideoBackupDocument): string[] {
  const keys = new Set<string>();
  for (const node of document.nodes) {
    for (const value of [
      node.localVideo,
      ...(node.embeddedReferences || []).map(reference => reference.localVideo),
      ...(node.videoSubmission?.images || []).map(reference => reference.localVideo),
    ]) {
      if (value === undefined) continue;
      if (!isLocalVideoKey(value)) throw new Error("画布中的本机视频索引无效。");
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

function fromVideoPayload(value: unknown): Blob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份中的视频数据格式无效。");
  const payload = value as Partial<VideoPayload>;
  if (
    typeof payload.mime !== "string" || !/^video\/[a-z0-9.+-]+$/i.test(payload.mime) ||
    typeof payload.base64 !== "string" || payload.base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.base64)
  ) throw new Error("备份中的视频数据格式无效。");
  if (payload.base64.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4) throw new Error("单个备份视频不能超过 160 MiB。");

  let binary: string;
  try { binary = atob(payload.base64); }
  catch { throw new Error("备份中的视频数据格式无效。"); }
  if (!binary.length || binary.length > MAX_VIDEO_BYTES || btoa(binary) !== payload.base64) {
    throw new Error("单个备份视频不能超过 160 MiB，或数据格式无效。");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: payload.mime });
}

export async function packageCanvasVideo<T extends Document>(
  document: T,
  options: { partial?: boolean; read?: (key: string) => Promise<Blob | null> } = {},
): Promise<{ document: T; videoAssets: Record<string, VideoPayload>; missing: number }> {
  const copy = structuredClone(document) as T & VideoBackupDocument;
  const assets: Record<string, VideoPayload> = {};
  const missing: string[] = [];
  let total = 0;
  const read = options.read || readLocalVideo;
  for (const key of videoKeys(copy)) {
    const blob = await read(key);
    if (!blob) { missing.push(key); continue; }
    if (!blob.size || blob.size > MAX_VIDEO_BYTES) throw new Error("单个备份视频不能超过 160 MiB。");
    if (total + blob.size > MAX_BACKUP_VIDEO_BYTES) throw new Error("本机视频总量超过 180 MiB，请精简后再导出。");
    total += blob.size;
    const mime = blob.type.split(";")[0].trim().toLowerCase();
    if (!/^video\/[a-z0-9.+-]+$/i.test(mime)) throw new Error("本机视频的媒体类型无效，无法导出备份。");
    assets[key] = { mime, base64: toBase64(new Uint8Array(await blob.arrayBuffer())) };
  }
  if (missing.length && !options.partial) throw new Error("部分本机视频已丢失，请重新添加视频，或选择仅导出可用内容。");
  delete copy.videoMissing;
  if (missing.length) copy.videoMissing = missing;
  return { document: copy, videoAssets: assets, missing: missing.length };
}

export async function restoreCanvasVideo<T extends VideoBackupDocument>(
  value: T,
  options: { store?: (blob: Blob) => Promise<string>; read?: (key: string) => Promise<Blob | null> } = {},
): Promise<Omit<T, "videoAssets">> {
  const copy = structuredClone(value);
  const assets = copy.videoAssets;
  const referenced = new Set(videoKeys(copy));
  delete copy.videoAssets;
  delete copy.videoMissing;
  if (Object.hasOwn(value, "videoAssets") && (!assets || typeof assets !== "object" || Array.isArray(assets))) {
    throw new Error("备份中的视频索引无效。");
  }

  const decoded = new Map<string, Blob>();
  let total = 0;
  if (assets) {
    for (const [key, payload] of Object.entries(assets)) {
      if (!isLocalVideoKey(key) || !referenced.has(key)) throw new Error("备份中的视频索引无效。");
      const blob = fromVideoPayload(payload);
      total += blob.size;
      if (total > MAX_BACKUP_VIDEO_BYTES) throw new Error("备份视频总量超过 180 MiB。");
      decoded.set(key, blob);
    }
  }

  const store = options.store || storeLocalVideo;
  const read = options.read || (async (key: string) => {
    try { return await readLocalVideo(key); }
    catch { return null; }
  });
  const restored = new Map<string, string>();
  for (const key of referenced) {
    const blob = decoded.get(key);
    if (blob) restored.set(key, await store(blob));
    else if (await read(key)) restored.set(key, key);
  }
  for (const node of copy.nodes) {
    if (node.localVideo) {
      const newKey = restored.get(node.localVideo);
      if (newKey) node.localVideo = newKey;
    }
    if (node.embeddedReferences) {
      node.embeddedReferences = node.embeddedReferences.map(reference => {
        const newKey = reference.localVideo ? restored.get(reference.localVideo) : undefined;
        return newKey ? { ...reference, localVideo: newKey } : reference;
      });
    }
    if (node.videoSubmission?.images) {
      node.videoSubmission.images = node.videoSubmission.images.map(reference => {
        const newKey = reference.localVideo ? restored.get(reference.localVideo) : undefined;
        return newKey ? { ...reference, localVideo: newKey } : reference;
      });
    }
  }
  const missing = [...referenced].filter(key => !restored.has(key));
  if (missing.length) copy.videoMissing = missing;
  return copy;
}

