import type { CloudStorage, CloudStorageEntry } from "./document-kv.ts";
import { captureDocumentStorageSession } from "./document-storage.ts";
import { isLocalAudioKey } from "./audio-cache.ts";
import { isLocalVideoKey } from "./video-cache.ts";

export type AssetKind = "image" | "video" | "audio" | "prompt";
export type AssetCategory = "person" | "scene" | "object" | "style" | "sound" | "other" | "prompt";
type AssetMediaType = Exclude<AssetKind, "prompt">;
export type AssetSource =
  | { type: "task"; taskId: string; mediaType: AssetMediaType; resultIndex?: number; audioTaskType?: "music" | "voice_design" | "tts"; voiceId?: string }
  | { type: "platform"; assetId: string; taskId?: string; mediaType: AssetMediaType; resultIndex?: number; audioTaskType?: "music" | "voice_design" | "tts"; voiceId?: string }
  | { type: "local"; localImage: string; localAudio?: never; localVideo?: never }
  | { type: "local"; localAudio: string; localImage?: never; localVideo?: never }
  | { type: "local"; localVideo: string; localImage?: never; localAudio?: never }
  | { type: "url"; url: string }
  | { type: "text"; text: string };

/** An asset is a reusable reference, never a copy of media bytes or a task. */
export type CanvasAsset = {
  schemaVersion: 1;
  id: string;
  name: string;
  kind: AssetKind;
  category: AssetCategory;
  tags: string[];
  folder?: string;
  /** Trusted, read-only provenance supplied by the media service. */
  sourceAppId?: string;
  systemTags?: string[];
  createdAt: string;
  updatedAt: string;
  source: AssetSource;
  prompt?: string;
  modelId?: string;
  origin?: { documentId: string; nodeId: string };
};
/**
 * A platform media row carries its canonical library-membership bit next to
 * the reusable Canvas metadata. KV-backed/local rows do not have that server
 * field, so `undefined` means the row is always treated as a local asset.
 */
export type AssetRow = { asset: CanvasAsset; revision: number; savedToLibrary?: boolean };
export type AssetStorage = CloudStorage & {
  getEntries: <T>(keys: string[]) => Promise<Record<string, CloudStorageEntry<T> | null>>;
};
export type AssetWriteOptions = { idempotencyKey?: string };
export type AssetFilters = { query?: string; kind?: AssetKind | "all"; category?: AssetCategory | "all"; tag?: string; folder?: string };
export const ASSET_PREFIX = "canvas:asset:v1:";
export const categoryLabels: Record<AssetCategory, string> = {
  person: "角色", scene: "场景", object: "物品", style: "风格", sound: "音效", other: "其它", prompt: "提示词",
};
export const kindLabels: Record<AssetKind, string> = {
  image: "图片", video: "视频", audio: "音频", prompt: "提示词",
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "CANVAS_ASSET_INVALID" });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label}格式无效。`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > max) invalid(`${label}不能为空，且不能超过 ${max} 个字符。`);
  return value.trim();
}

/** User labels are distinct from system provenance and are deduplicated after trimming. */
export function normalizeAssetTags(value: unknown, options: { maxTagLength?: number; allowReserved?: boolean } = {}): string[] {
  if (!Array.isArray(value)) invalid("素材标签格式无效。");
  const tags: string[] = [], seen = new Set<string>();
  for (const valueTag of value) {
    const tag = text(valueTag, "标签", options.maxTagLength ?? 40);
    if (!options.allowReserved && /^(app|type|source):/i.test(tag)) invalid("app:、type:、source: 为系统标签前缀，请使用其他标签。");
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) { tags.push(tag); seen.add(key); }
  }
  if (tags.length > 20) invalid("素材标签不能超过 20 个。");
  return tags;
}

export function assetKey(id: string): string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(id) || id.includes("..")) invalid("素材 ID 无效。");
  return `${ASSET_PREFIX}${id}`;
}

/** Only durable public URLs may be stored. Signed URLs are resolved from task/platform references when used. */
export function isDurableAssetUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    for (const key of url.searchParams.keys()) {
      if (/^(?:x-amz-|x-goog-|x-cos-|x-oss-|q-sign)/i.test(key)
        || /^(?:signature|sig|sign|signkey|token|access_token|auth|authorization|expires|expiry|policy|key-pair-id|ossaccesskeyid)$/i.test(key)) return false;
    }
    return true;
  } catch { return false; }
}

function timestamp(value: unknown, label: string): string {
  const input = text(value, label, 64);
  if (!Number.isFinite(Date.parse(input))) invalid(`${label}格式无效。`);
  return new Date(input).toISOString();
}

function sourceFromValue(value: unknown, kind: AssetKind): AssetSource {
  const source = record(value, "素材来源");
  if (source.type === "text") {
    if (kind !== "prompt") invalid("文本来源只能用于提示词素材。");
    return { type: "text", text: text(source.text, "提示词", 40000) };
  }
  if (kind === "prompt") invalid("提示词素材必须使用文本来源。");
  if (source.type === "local") {
    if (kind === "image" && typeof source.localImage === "string" && /^proxy-canvas:image:sha256:[a-f0-9]{64}$/.test(source.localImage) && source.localAudio === undefined && source.localVideo === undefined)
      return { type: "local", localImage: source.localImage };
    if (kind === "audio" && isLocalAudioKey(source.localAudio) && source.localImage === undefined && source.localVideo === undefined)
      return { type: "local", localAudio: source.localAudio };
    if (kind === "video" && isLocalVideoKey(source.localVideo) && source.localImage === undefined && source.localAudio === undefined)
      return { type: "local", localVideo: source.localVideo };
    invalid("本机素材需要有效且类型一致的图片、视频或音频缓存引用。");
  }
  if (source.type === "url") {
    if (!isDurableAssetUrl(source.url)) invalid("素材需要长期有效的地址，请使用任务或媒体资产引用保存临时链接。");
    return { type: "url", url: source.url.trim() };
  }
  if (source.type === "task" || source.type === "platform") {
    if (source.mediaType !== kind) invalid("素材来源与媒体类型不一致。");
    const resultIndex = source.resultIndex;
    if (resultIndex !== undefined && (!Number.isSafeInteger(resultIndex) || (resultIndex as number) < 0)) invalid("素材结果序号无效。");
    const result = resultIndex === undefined ? {} : { resultIndex: resultIndex as number };
    if (source.type === "task") {
      if (source.audioTaskType !== undefined && (kind !== "audio" || !["music", "voice_design", "tts"].includes(String(source.audioTaskType)))) invalid("音频任务类型无效。");
      if (source.voiceId !== undefined && (kind !== "audio" || !["voice_design", "tts"].includes(String(source.audioTaskType)))) invalid("音色 ID 只能用于音色相关素材。");
      return {
        type: "task", taskId: text(source.taskId, "任务 ID", 256), mediaType: kind, ...result,
        ...(source.audioTaskType === undefined ? {} : { audioTaskType: source.audioTaskType as "music" | "voice_design" | "tts" }),
        ...(source.voiceId === undefined ? {} : { voiceId: text(source.voiceId, "音色 ID", 256) }),
      };
    }
    if (source.audioTaskType !== undefined && (kind !== "audio" || !["music", "voice_design", "tts"].includes(String(source.audioTaskType)))) invalid("音频任务类型无效。");
    if (source.voiceId !== undefined && (kind !== "audio" || !["voice_design", "tts"].includes(String(source.audioTaskType)))) invalid("音色 ID 只能用于音色相关素材。");
    return {
      type: "platform", assetId: text(source.assetId, "媒体资产 ID", 256), mediaType: kind, ...result,
      ...(source.taskId === undefined ? {} : { taskId: text(source.taskId, "任务 ID", 256) }),
      ...(source.audioTaskType === undefined ? {} : { audioTaskType: source.audioTaskType as "music" | "voice_design" | "tts" }),
      ...(source.voiceId === undefined ? {} : { voiceId: text(source.voiceId, "音色 ID", 256) }),
    };
  }
  return invalid("素材来源不受支持。");
}

/** Rebuild known metadata fields, discarding unknown preview/binary fields. */
export function normalizeAsset(value: unknown, expectedId?: string): CanvasAsset {
  const input = record(value, "素材");
  if (input.schemaVersion !== 1) invalid("素材版本不受支持。");
  const id = text(input.id, "素材 ID", 128);
  assetKey(id);
  if (expectedId !== undefined && id !== expectedId) invalid("素材身份与存储键不一致。");
  if (typeof input.kind !== "string" || !Object.hasOwn(kindLabels, input.kind)) invalid("素材类型无效。");
  if (typeof input.category !== "string" || !Object.hasOwn(categoryLabels, input.category)) invalid("素材分类无效。");
  const kind = input.kind as AssetKind;
  // Existing KV records allowed 64-character tags and 160-character names.
  // Preserve their readability; platform writes enforce the current contract.
  const tags = normalizeAssetTags(input.tags, { maxTagLength: 64, allowReserved: true });
  const asset: CanvasAsset = {
    schemaVersion: 1, id, name: text(input.name, "素材名称", 160), kind,
    category: input.category as AssetCategory, tags,
    createdAt: timestamp(input.createdAt, "创建时间"), updatedAt: timestamp(input.updatedAt, "更新时间"),
    source: sourceFromValue(input.source, kind),
  };
  if (input.folder !== undefined) {
    if (typeof input.folder !== "string" || Array.from(input.folder.trim()).length > 100) invalid("素材文件夹不能超过 100 个字符。");
    asset.folder = input.folder.trim();
  }
  if (input.sourceAppId !== undefined && input.sourceAppId !== "") asset.sourceAppId = text(input.sourceAppId, "来源应用", 256);
  if (input.systemTags !== undefined) {
    if (!Array.isArray(input.systemTags)) invalid("系统标签格式无效。");
    asset.systemTags = [...new Set(input.systemTags.map(tag => text(tag, "系统标签", 256)))];
  }
  if (asset.updatedAt < asset.createdAt) invalid("素材更新时间不能早于创建时间。");
  if (input.prompt !== undefined && input.prompt !== "") asset.prompt = text(input.prompt, "创作提示词", 40000);
  if (input.modelId !== undefined && input.modelId !== "") asset.modelId = text(input.modelId, "模型 ID", 256);
  if (input.origin !== undefined) {
    const origin = record(input.origin, "素材出处");
    asset.origin = { documentId: text(origin.documentId, "画布 ID", 128), nodeId: text(origin.nodeId, "节点 ID", 128) };
  }
  if (new TextEncoder().encode(JSON.stringify(asset)).byteLength > 240 * 1024) invalid("素材描述过长，请缩短提示词或标签。");
  return asset;
}

function positiveRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision <= 0) invalid("素材版本无效，请重新读取素材。");
  return revision;
}

function mutationOptions(options?: AssetWriteOptions): Required<AssetWriteOptions> {
  const idempotencyKey = options?.idempotencyKey ?? crypto.randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) invalid("素材保存标识无效。");
  return { idempotencyKey };
}

async function guarded<T>(check: () => void, operation: () => Promise<T>): Promise<T> {
  check();
  try { const result = await operation(); check(); return result; }
  catch (error) { check(); throw error; }
}

export async function readAsset(storage: AssetStorage, id: string): Promise<AssetRow | null> {
  const check = captureDocumentStorageSession(storage), key = assetKey(id);
  const entry = await guarded(check, () => storage.getEntry<unknown>(key));
  if (!entry) return null;
  if (entry.key !== key) invalid("素材存储返回了错误的身份。");
  return { asset: normalizeAsset(entry.value, id), revision: positiveRevision(entry.revision) };
}

/** Fetch a bounded page, without an application-wide directory or per-item requests. */
export async function listAssets(storage: AssetStorage, options: { cursor?: string; limit?: number } = {}): Promise<{
  items: AssetRow[]; nextCursor?: string; skipped: number;
}> {
  const check = captureDocumentStorageSession(storage);
  const limit = options.limit ?? 48;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid("素材分页数量必须介于 1 和 100。");
  const page = await guarded(check, () => storage.list({ prefix: ASSET_PREFIX, cursor: options.cursor, limit }));
  if (page.keys.length > limit || page.keys.some(key => !key.startsWith(ASSET_PREFIX))) invalid("素材存储返回了无效的列表。");
  if (page.nextCursor && page.nextCursor === options.cursor) invalid("素材分页未能继续，请重试。");
  const keys = [...new Set(page.keys)];
  if (!keys.length) return { items: [], nextCursor: page.nextCursor, skipped: 0 };
  const entries = await guarded(check, () => storage.getEntries<unknown>(keys));
  const items: AssetRow[] = [];
  let skipped = 0;
  for (const key of keys) {
    const entry = entries[key];
    if (entry === null) continue; // Deleted between listing and hydration.
    try {
      if (!entry || entry.key !== key) invalid("素材数据缺失。");
      items.push({ asset: normalizeAsset(entry.value, key.slice(ASSET_PREFIX.length)), revision: positiveRevision(entry.revision) });
    } catch { skipped += 1; }
  }
  return { items, nextCursor: page.nextCursor, skipped };
}

async function writeAsset(storage: AssetStorage, value: CanvasAsset, expectedRevision: number, options?: AssetWriteOptions): Promise<AssetRow> {
  const check = captureDocumentStorageSession(storage), asset = normalizeAsset(value);
  const result = await guarded(check, () => storage.set(assetKey(asset.id), asset, { expectedRevision, ...mutationOptions(options) }));
  if (!result.success || !Number.isSafeInteger(result.revision) || result.revision! <= 0)
    throw new Error("素材保存尚未确认，请稍后重试。");
  return { asset, revision: result.revision! };
}

/** Keep the same asset snapshot and idempotency key when retrying an unconfirmed save. */
export function createAsset(storage: AssetStorage, asset: CanvasAsset, options?: AssetWriteOptions): Promise<AssetRow> {
  return writeAsset(storage, asset, 0, options);
}

export function updateAsset(storage: AssetStorage, asset: CanvasAsset, expectedRevision: number, options?: AssetWriteOptions): Promise<AssetRow> {
  return writeAsset(storage, asset, positiveRevision(expectedRevision), options);
}

/** Remove membership in the library only; shared media and canvas nodes remain intact. */
export async function removeAsset(storage: AssetStorage, id: string, expectedRevision: number, options?: AssetWriteOptions): Promise<void> {
  const check = captureDocumentStorageSession(storage), key = assetKey(id);
  const operation = { op: "delete" as const, key, expectedRevision: positiveRevision(expectedRevision) };
  const result = await guarded(check, () => storage.batch([operation], mutationOptions(options)));
  if (result.length !== 1 || result[0].key !== key || !result[0].success) throw new Error("素材移除尚未确认，请稍后重试。");
}

export function filterAssets(rows: AssetRow[], { query = "", kind, category, tag, folder }: AssetFilters = {}): AssetRow[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const selectedTag = tag?.trim();
  const selectedFolder = folder?.trim();
  return rows.filter(({ asset }) => {
    if (kind && kind !== "all" && asset.kind !== kind) return false;
    if (category && category !== "all" && asset.category !== category) return false;
    if (selectedTag && !asset.tags.includes(selectedTag) && !asset.systemTags?.includes(selectedTag)) return false;
    if (selectedFolder !== undefined && (asset.folder ?? "") !== selectedFolder) return false;
    const searchable = [asset.name, ...asset.tags, ...(asset.systemTags ?? []), asset.folder ?? "", asset.sourceAppId ?? "", asset.prompt ?? "", asset.source.type === "text" ? asset.source.text : ""].join(" ").toLocaleLowerCase();
    return words.every(word => searchable.includes(word));
  });
}
