import {
  canvasStorageKey,
  canvasSyncMarkerKey,
  documentFromValue,
  DOCUMENT_PREFIX,
  listKeys,
  syncMarkerFromValue,
} from "./document-kv.ts";
import type { CanvasSyncMarker, CloudStorage, CloudCanvasDocument } from "./document-kv.ts";
import { ensureDocumentMigration } from "./document-kv-migration.ts";
import { publishCanvasSync, subscribeCanvasSync } from "./document-sync.ts";
import { CanvasDocumentTooLargeError, MAX_CANVAS_DOCUMENT_BYTES, MAX_DIRECT_STORAGE_BYTES } from "./cloud-document-limits.ts";
export { canvasStorageKey } from "./document-kv.ts";
export type { CloudStorage, CloudCanvasDocument } from "./document-kv.ts";

/**
 * Canvas is a document, while Gateway KV is a generic small-value store. A
 * document that fits in one value keeps the old representation. Larger
 * documents are stored as immutable string chunks and this small manifest is
 * committed together with the sync marker.
 */
const CHUNK_PREFIX = "canvas:chunk:v1:";
const CHUNK_RETIREMENT_PREFIX = "canvas:chunk-retired:v1:";
const CHUNK_TARGET_BYTES = 180 * 1024;
const CHUNK_BATCH_SIZE = 4;
const CHUNK_READ_BATCH_SIZE = 4;
const CHUNK_READ_CONCURRENCY = 4;
const MAX_CHUNK_COUNT = 1000;
/**
 * Keep a retired generation long enough for an already-running reader to
 * finish.  This is deliberately short: retired chunks are account-scoped KV
 * data and retaining them for days lets frequent autosaves consume the
 * account quota even though only the latest manifest is reachable.
 */
export const CANVAS_CHUNK_GC_GRACE_MS = 2 * 60 * 1000;
const CHUNK_GC_MAX_KEYS_PER_PASS = 100;

type CanvasChunkManifest = {
  kind: "canvas-document-chunks";
  version: 1;
  id: string;
  bytes: number;
  checksum: string;
  chunks: string[];
  updatedAt: string;
};

type CanvasChunk = { key: string; value: string };
type CanvasChunkPlan = {
  manifest: CanvasChunkManifest;
  chunks: CanvasChunk[];
  batchIdempotencyKeys: string[];
};
type RetiredChunkRecord = {
  kind: "canvas-retired-chunks";
  version: 1;
  retiredAt: number;
  chunks: string[];
};
const textEncoder = new TextEncoder();

function encodedBytes(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function encodedJsonBytes(value: unknown): number {
  return encodedBytes(JSON.stringify(value));
}

/** A short stable namespace keeps chunk keys valid even for a 128-char canvas ID. */
function documentNamespace(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function chunkKey(id: string, hash: string, generation: string): string {
  return `${CHUNK_PREFIX}${documentNamespace(id)}:${hash}:${generation}`;
}

function generationForKey(key: string): string | null {
  const parts = key.split(":");
  if (!key.startsWith(CHUNK_PREFIX) || parts.length !== 6) return null;
  const legacyGeneration = parts[4] || "";
  const contentGeneration = parts[5] || "";
  if (/^[a-z0-9]+-[a-f0-9-]{36}$/i.test(legacyGeneration)) return legacyGeneration;
  return /^[a-z0-9]+-[a-f0-9-]{36}$/i.test(contentGeneration) ? contentGeneration : null;
}

function validChunkKey(key: string): boolean {
  const parts = key.split(":");
  if (!key.startsWith(CHUNK_PREFIX) || parts.length !== 6 || generationForKey(key) === null) return false;
  if (!/^[a-f0-9]{8}$/i.test(parts[3])) return false;
  return (/^[a-z0-9]+-[a-f0-9-]{36}$/i.test(parts[4]) && /^\d+$/.test(parts[5]) && Number(parts[5]) < MAX_CHUNK_COUNT) ||
    (/^[a-f0-9]{64}$/i.test(parts[4]) && /^[a-z0-9]+-[a-f0-9-]{36}$/i.test(parts[5]));
}

function chunkContentHash(key: string): string | null {
  if (!validChunkKey(key) || !/^[a-f0-9]{64}$/i.test(key.split(":")[4])) return null;
  return key.split(":")[4];
}

function chunkCreatedAt(key: string): number | null {
  const generation = generationForKey(key);
  if (!generation) return null;
  const timestamp = Number.parseInt(generation.split("-")[0], 36);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function isChunkKeyForDocument(key: string, id: string): boolean {
  return validChunkKey(key) && key.startsWith(`${CHUNK_PREFIX}${documentNamespace(id)}:`);
}

function isManifest(value: unknown, id: string): value is CanvasChunkManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CanvasChunkManifest>;
  const bytes = candidate.bytes;
  return candidate.kind === "canvas-document-chunks" && candidate.version === 1 &&
    candidate.id === id && typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0 &&
    typeof candidate.checksum === "string" && /^[a-f0-9]{64}$/i.test(candidate.checksum) &&
    Array.isArray(candidate.chunks) && candidate.chunks.length > 0 && candidate.chunks.length <= MAX_CHUNK_COUNT &&
    candidate.chunks.every((key) => typeof key === "string" && isChunkKeyForDocument(key, id)) &&
    typeof candidate.updatedAt === "string";
}

function hasManifestMarker(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "canvas-document-chunks");
}

function splitSerializedDocument(serialized: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < serialized.length) {
    let low = start + 1;
    let high = serialized.length;
    let best = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (encodedJsonBytes(serialized.slice(start, middle)) <= CHUNK_TARGET_BYTES) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    // Never split a UTF-16 surrogate pair. A single code point is far below
    // the chunk limit, so moving the boundary back is always safe.
    if (best < serialized.length && best > start &&
      serialized.charCodeAt(best - 1) >= 0xd800 && serialized.charCodeAt(best - 1) <= 0xdbff &&
      serialized.charCodeAt(best) >= 0xdc00 && serialized.charCodeAt(best) <= 0xdfff) {
      best -= 1;
    }
    if (best <= start) throw new Error("画布分块失败，请减少画布内容后重试。");
    chunks.push(serialized.slice(start, best));
    start = best;
  }
  return chunks;
}

async function checksum(serialized: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(serialized));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function chunkPlanFor<T extends { id: string }>(snapshot: T, previousChunkKeys: string[]): Promise<CanvasChunkPlan | null> {
  const serialized = JSON.stringify(snapshot);
  const bytes = encodedBytes(serialized);
  if (bytes <= MAX_DIRECT_STORAGE_BYTES) return null;
  if (bytes > MAX_CANVAS_DOCUMENT_BYTES) throw new CanvasDocumentTooLargeError(bytes);
  const pieces = splitSerializedDocument(serialized);
  if (pieces.length > MAX_CHUNK_COUNT) throw new CanvasDocumentTooLargeError(bytes, MAX_CHUNK_COUNT * CHUNK_TARGET_BYTES);
  const generation = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  const previousByHash = new Map<string, string>();
  for (const key of previousChunkKeys) {
    const hash = chunkContentHash(key);
    if (hash) previousByHash.set(hash, key);
  }
  const manifestChunkKeys: string[] = [];
  const uploadByKey = new Map<string, string>();
  for (const piece of pieces) {
    const hash = await checksum(piece);
    const key = previousByHash.get(hash) ?? chunkKey(snapshot.id, hash, generation);
    manifestChunkKeys.push(key);
    if (!previousByHash.has(hash)) uploadByKey.set(key, piece);
  }
  const chunks = [...uploadByKey].map(([key, value]) => ({ key, value }));
  const manifest: CanvasChunkManifest = {
    kind: "canvas-document-chunks",
    version: 1,
    id: snapshot.id,
    bytes,
    checksum: await checksum(serialized),
    chunks: manifestChunkKeys,
    updatedAt: String((snapshot as { updatedAt?: unknown }).updatedAt ?? ""),
  };
  // The manifest is itself a KV value. This assertion protects the protocol
  // if a future change makes chunk keys or metadata unexpectedly verbose.
  if (encodedJsonBytes(manifest) > MAX_DIRECT_STORAGE_BYTES)
    throw new Error("画布分块清单过大，请减少节点数量后重试。");
  return { manifest, chunks, batchIdempotencyKeys: Array.from({ length: Math.ceil(chunks.length / CHUNK_BATCH_SIZE) }, () => `canvas-chunks-${crypto.randomUUID()}`) };
}

async function hydrateDocumentValue(
  scoped: CloudStorage,
  id: string,
  value: unknown,
): Promise<CloudCanvasDocument> {
  if (hasManifestMarker(value) && !isManifest(value, id))
    throw Object.assign(new Error("云端画布分块清单无效，请稍后重试。"), { code: "CANVAS_STORAGE_CHUNK_CORRUPT" });
  if (!isManifest(value, id)) return documentFromValue(value, id);
  let serialized = "";
  // Keep each request below the platform batch limit, but read a few batches
  // concurrently. A 16 MiB document can contain around ninety chunks; a
  // serial read would make a two-minute retirement window unnecessarily easy
  // to exceed on a high-latency connection.
  const batches: string[][] = [];
  for (let start = 0; start < value.chunks.length; start += CHUNK_READ_BATCH_SIZE)
    batches.push(value.chunks.slice(start, start + CHUNK_READ_BATCH_SIZE));
  for (let start = 0; start < batches.length; start += CHUNK_READ_CONCURRENCY) {
    const group = batches.slice(start, start + CHUNK_READ_CONCURRENCY);
    const values = await Promise.all(group.map((keys) => scoped.getMany<string>(keys)));
    for (let batchIndex = 0; batchIndex < group.length; batchIndex += 1) {
      for (const key of group[batchIndex]) {
        const chunk = values[batchIndex][key];
        if (typeof chunk !== "string") throw Object.assign(new Error("云端画布分块缺失，请稍后重试。"), { code: "CANVAS_STORAGE_CHUNK_MISSING" });
        serialized += chunk;
      }
    }
  }
  if (encodedBytes(serialized) !== value.bytes || await checksum(serialized) !== value.checksum)
    throw Object.assign(new Error("云端画布分块校验失败，请稍后重试。"), { code: "CANVAS_STORAGE_CHUNK_CORRUPT" });
  try {
    return documentFromValue(JSON.parse(serialized), id);
  } catch (error) {
    throw Object.assign(new Error("云端画布分块内容无效，请稍后重试。", { cause: error }), { code: "CANVAS_STORAGE_CHUNK_CORRUPT" });
  }
}

function chunksInValue(value: unknown, id: string): string[] {
  if (hasManifestMarker(value) && !isManifest(value, id))
    throw Object.assign(new Error("云端画布分块清单无效，请稍后重试。"), { code: "CANVAS_STORAGE_CHUNK_CORRUPT" });
  return isManifest(value, id) ? value.chunks : [];
}

function retirementKey(id: string): string {
  return `${CHUNK_RETIREMENT_PREFIX}${documentNamespace(id)}:${crypto.randomUUID()}`;
}

function parseRetiredChunkRecord(value: unknown): RetiredChunkRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<RetiredChunkRecord>;
  if (record.kind !== "canvas-retired-chunks" || record.version !== 1 ||
    !Number.isSafeInteger(record.retiredAt) || (record.retiredAt as number) <= 0 ||
    !Array.isArray(record.chunks) || record.chunks.length > MAX_CHUNK_COUNT ||
    record.chunks.some((key) => typeof key !== "string" || !validChunkKey(key))) return null;
  return record as RetiredChunkRecord;
}

async function deleteChunkKeys(scoped: CloudStorage, keys: string[]): Promise<boolean> {
  const unique = [...new Set(keys.filter(validChunkKey))];
  for (let start = 0; start < unique.length; start += 100) {
    const operations = unique.slice(start, start + 100).map((key) => ({ op: "delete" as const, key }));
    try { await scoped.batch(operations); } catch { return false; }
  }
  return true;
}

async function collectRetiredChunks(
  scoped: CloudStorage,
  referencedChunks: Set<string>,
  documentId?: string,
): Promise<void> {
  const now = Date.now();
  const namespacePrefix = documentId ? `${documentNamespace(documentId)}:` : "";
  const retirementKeys = await listKeys(scoped, `${CHUNK_RETIREMENT_PREFIX}${namespacePrefix}`);
  const recentChunks = new Set<string>();
  const expiredRecords: Array<{ key: string; record: RetiredChunkRecord }> = [];
  for (let start = 0; start < retirementKeys.length; start += 100) {
    const keys = retirementKeys.slice(start, start + 100);
    const records = await scoped.getMany<unknown>(keys);
    for (const key of keys) {
      const record = parseRetiredChunkRecord(records[key]);
      if (!record) continue;
      if (now - record.retiredAt < CANVAS_CHUNK_GC_GRACE_MS) {
        for (const chunk of record.chunks) recentChunks.add(chunk);
      } else {
        expiredRecords.push({ key, record });
      }
    }
  }

  const chunkKeys = await listKeys(scoped, `${CHUNK_PREFIX}${namespacePrefix}`);
  const retiredChunks = new Set(expiredRecords.flatMap(({ record }) => record.chunks));
  const stale = chunkKeys.filter((key) => {
    if (referencedChunks.has(key) || recentChunks.has(key)) return false;
    if (retiredChunks.has(key)) return true;
    const createdAt = chunkCreatedAt(key);
    return createdAt !== null && now - createdAt >= CANVAS_CHUNK_GC_GRACE_MS;
  });
  // Bound cleanup work on the save path. Any remainder is harmless and will
  // be reclaimed by the next large save or library listing.
  if (!(await deleteChunkKeys(scoped, stale.slice(0, CHUNK_GC_MAX_KEYS_PER_PASS)))) return;

  // Drop expired retirement records only after all requested chunk deletions
  // succeed. Failed cleanup remains discoverable and is retried next listing.
  const expiredKeys = expiredRecords.map(({ key }) => key).filter((key) => key.startsWith(CHUNK_RETIREMENT_PREFIX)).slice(0, CHUNK_GC_MAX_KEYS_PER_PASS);
  for (let start = 0; start < expiredKeys.length; start += 100) {
    const operations = expiredKeys.slice(start, start + 100).map((key) => ({ op: "delete" as const, key }));
    try { await scoped.batch(operations); } catch { /* retry on a later document listing */ }
  }
}

async function uploadChunks(
  scoped: CloudStorage,
  check: () => void,
  plan: CanvasChunkPlan | null,
): Promise<void> {
  if (!plan) return;
  try {
    for (let start = 0, batchIndex = 0; start < plan.chunks.length; start += CHUNK_BATCH_SIZE, batchIndex += 1) {
      check();
      const batch = plan.chunks.slice(start, start + CHUNK_BATCH_SIZE);
      const results = await scoped.batch(batch.map(({ key, value }) => ({
        op: "put" as const,
        key,
        value,
        expectedRevision: 0,
      })), { idempotencyKey: plan.batchIdempotencyKeys[batchIndex] });
      check();
      for (const chunk of batch) resultFor(results, chunk.key);
    }
  } catch (error) {
    check();
    // Only a definite rejection proves that this idempotency key did not
    // commit the batch. Preserve chunks after transport ambiguity so replaying
    // the same key cannot report a prior success for already-deleted data.
    if (isDefiniteRejection(error))
      await deleteChunkKeys(scoped, plan.chunks.map(({ key }) => key));
    throw error;
  }
}

export type CanvasDocumentSyncState = {
  document: CloudCanvasDocument | null;
  marker: CanvasSyncMarker | null;
  documentRevision: number;
  markerRevision: number;
};

export type CanvasDocumentSaveResult = {
  marker: CanvasSyncMarker;
  documentRevision: number;
  markerRevision: number;
};

// Baselines are updated only by an explicit document load or a confirmed
// save. Listing the workspace cannot authorize overwriting an unseen edit.
type DocumentBaseline = { documentRevision: number; markerRevision: number };
const revisions = new WeakMap<CloudStorage, Map<string, DocumentBaseline>>();
const sessions = new WeakMap<CloudStorage, { generation: number; ready: boolean; scoped?: CloudStorage }>();
function sessionFor(storage: CloudStorage) {
  let session = sessions.get(storage);
  if (!session) { session = { generation: 0, ready: true }; sessions.set(storage, session); }
  return session;
}

/** Capture before any asynchronous preparation, so an old queued save cannot
 * enter the storage layer after the application's singleton changes account. */
export function captureDocumentStorageSession(storage: CloudStorage): () => void {
  const session = sessionFor(storage), generation = session.generation;
  const check = () => {
    if (!session.ready || generation !== session.generation)
      throw Object.assign(new Error("登录状态已更新，请重新打开云端画布后继续。"), { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  };
  check();
  return check;
}

/** Suspend immediately, before starting authentication or replacing credentials. */
export function resetDocumentStorage(storage: CloudStorage) {
  const session = sessionFor(storage);
  session.generation += 1;
  session.ready = false;
  session.scoped = undefined;
  revisions.delete(storage);
  pending.delete(storage);
  queues.delete(storage);
}

export function resumeDocumentStorage(storage: CloudStorage) {
  sessionFor(storage).ready = true;
}

function scopedStorage(storage: CloudStorage): CloudStorage {
  const session = sessionFor(storage);
  const check = captureDocumentStorageSession(storage);
  if (session.scoped) return session.scoped;
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    try { const result = await operation(); check(); return result; }
    catch (error) { check(); throw error; }
  };
  // Migration can issue several reads and writes. Guard every dispatch and
  // completion, not only the final document write.
  session.scoped = {
    get: <T>(key: string) => run(() => storage.get<T>(key)),
    getMany: <T>(keys: string[]) => run(() => storage.getMany<T>(keys)),
    getEntry: <T>(key: string) => run(() => storage.getEntry<T>(key)),
    set: (...args) => run(() => storage.set(...args)),
    list: (...args) => run(() => storage.list(...args)),
    batch: (...args) => run(() => storage.batch(...args)),
  };
  return session.scoped;
}

function baselines(storage: CloudStorage) {
  let values = revisions.get(storage);
  if (!values) { values = new Map(); revisions.set(storage, values); }
  return values;
}

type PendingWrite = {
  snapshot: CloudCanvasDocument;
  sourceSnapshot: CloudCanvasDocument;
  chunkPlan: CanvasChunkPlan | null;
  retiredChunkRecord?: RetiredChunkRecord;
  retiredChunkKey?: string;
  expectedDocumentRevision: number;
  expectedMarkerRevision: number;
  marker: CanvasSyncMarker;
  idempotencyKey: string;
};
const pending = new WeakMap<CloudStorage, Map<string, PendingWrite>>();
function pendingWrites(storage: CloudStorage) {
  let values = pending.get(storage);
  if (!values) { values = new Map(); pending.set(storage, values); }
  return values;
}

const queues = new WeakMap<CloudStorage, Map<string, Promise<unknown>>>();
function enqueue<T>(storage: CloudStorage, key: string, operation: () => Promise<T>): Promise<T> {
  const check = captureDocumentStorageSession(storage);
  let queue = queues.get(storage);
  if (!queue) { queue = new Map(); queues.set(storage, queue); }
  const jobs = queue;
  const next = (jobs.get(key) ?? Promise.resolve()).catch(() => {}).then(() => { check(); return operation(); });
  jobs.set(key, next);
  const clear = () => { if (jobs.get(key) === next) jobs.delete(key); };
  void next.then(clear, clear);
  return next;
}

function isDefiniteRejection(error: unknown): boolean {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  return (typeof status === "number" && status >= 400 && status < 500 && status !== 408)
    || code === "APP_STORAGE_CONFLICT"
    || code === "APP_STORAGE_IDEMPOTENCY_CONFLICT"
    || code === "APP_STORAGE_QUOTA_EXCEEDED"
    || code === "APP_STORAGE_VALUE_TOO_LARGE"
    || code === "PAYLOAD_TOO_LARGE"
    || code === "APP_INVALID_REQUEST"
    || code?.startsWith("APP_STORAGE_INVALID_") === true;
}

function resultFor(results: Array<{ key: string; success: boolean; revision?: number }>, key: string) {
  const result = results.find((item) => item.key === key);
  if (result && !result.success)
    throw Object.assign(new Error("画布已在其他页面更新，当前内容已保留。"), { code: "APP_STORAGE_CONFLICT" });
  if (!result || !Number.isSafeInteger(result.revision) || result.revision! <= 0)
    throw new Error("云端尚未确认保存，请稍后重试。");
  return result;
}

async function confirmWrite(
  storage: CloudStorage,
  scoped: CloudStorage,
  check: () => void,
  key: string,
  write: PendingWrite,
): Promise<CanvasDocumentSaveResult> {
  try {
    await uploadChunks(scoped, check, write.chunkPlan);
    const markerKey = canvasSyncMarkerKey(write.snapshot.id);
    const operations = [
      {
        op: "put" as const,
        key,
        value: write.snapshot,
        expectedRevision: write.expectedDocumentRevision,
      },
      {
        op: "put" as const,
        key: markerKey,
        value: write.marker,
        expectedRevision: write.expectedMarkerRevision,
      },
      ...(write.retiredChunkRecord && write.retiredChunkKey ? [{
        op: "put" as const,
        key: write.retiredChunkKey,
        value: write.retiredChunkRecord,
        expectedRevision: 0,
      }] : []),
    ];
    const results = await scoped.batch(operations, { idempotencyKey: write.idempotencyKey });
    check();
    const documentResult = resultFor(results, key);
    const markerResult = resultFor(results, markerKey);
    baselines(storage).set(write.snapshot.id, {
      documentRevision: documentResult.revision!,
      markerRevision: markerResult.revision!,
    });
    pendingWrites(storage).delete(key);
    publishCanvasSync(write.snapshot.id, write.marker);
    if (write.chunkPlan || write.retiredChunkRecord) {
      try {
        await collectRetiredChunks(
          scoped,
          new Set(chunksInValue(write.snapshot, write.snapshot.id)),
          write.snapshot.id,
        );
      } catch { /* successful saves stay successful when best-effort GC fails */ }
    }
    return {
      marker: write.marker,
      documentRevision: documentResult.revision!,
      markerRevision: markerResult.revision!,
    };
  } catch (error) {
    check();
    // A timeout or lost response may hide a successful commit. Retain the
    // exact request until replay confirms it; never replace its CAS baseline.
    if (isDefiniteRejection(error)) {
      pendingWrites(storage).delete(key);
      // The final manifest+marker batch was definitely rejected, so staged
      // chunks cannot be visible to readers and can be reclaimed immediately.
      if (write.chunkPlan) await deleteChunkKeys(scoped, write.chunkPlan.chunks.map(({ key: chunk }) => chunk));
    }
    if ((error as { code?: string })?.code === "APP_STORAGE_CONFLICT")
      throw Object.assign(new Error("画布已在其他页面更新，当前内容已保留。请重新加载云端版本后继续。"), { code: "APP_STORAGE_CONFLICT" });
    throw error;
  }
}

async function readState(
  scoped: CloudStorage,
  id: string,
): Promise<CanvasDocumentSyncState> {
  const key = canvasStorageKey(id);
  const markerKey = canvasSyncMarkerKey(id);
  let latest: CanvasDocumentSyncState | null = null;
  // A batch write commits both entries together. Bracket the document read
  // with marker reads so a concurrent save cannot produce a mixed snapshot.
  for (let attempt = 0; attempt < 4; attempt++) {
    const markerBefore = await scoped.getEntry<unknown>(markerKey);
    const entry = await scoped.getEntry<unknown>(key);
    const markerEntry = await scoped.getEntry<unknown>(markerKey);
    if ((markerBefore?.revision ?? 0) !== (markerEntry?.revision ?? 0)) continue;
    const document = entry ? await hydrateDocumentValue(scoped, id, entry.value) : null;
    let marker: CanvasSyncMarker | null = null;
    if (markerEntry) {
      try { marker = syncMarkerFromValue(markerEntry.value, id); }
      catch { /* a malformed hint must not hide an otherwise valid document */ }
    }
    latest = {
      document,
      marker,
      documentRevision: entry?.revision ?? 0,
      markerRevision: markerEntry?.revision ?? 0,
    };
    if (document && marker && marker.documentUpdatedAt !== String(document.updatedAt ?? "")) continue;
    return latest;
  }
  // Older clients can update the document key without its marker. Preserve
  // availability in that mixed-version window; the next atomic save will
  // repair the marker while CAS still protects both keys. A stable marker
  // revision is still required by the watcher before it emits a change.
  if (latest) return latest;
  throw new Error("云端画布版本读取不一致，请稍后重试。");
}

export function readCanvasDocument(storage: CloudStorage, id: string) {
  const key = canvasStorageKey(id);
  const scoped = scopedStorage(storage), check = captureDocumentStorageSession(storage);
  return enqueue(storage, key, async () => {
    // Explicit loading abandons an unconfirmed request. It must not replay
    // an old draft as a hidden side effect of viewing the remote version.
    pendingWrites(storage).delete(key);
    await ensureDocumentMigration(scoped);
    check();
    const state = await readState(scoped, id);
    check();
    baselines(storage).set(id, {
      documentRevision: state.documentRevision,
      markerRevision: state.markerRevision,
    });
    return state.document;
  });
}

/** Read a document for change detection without changing the save baseline. */
export function peekCanvasDocument(storage: CloudStorage, id: string) {
  const key = canvasStorageKey(id);
  const scoped = scopedStorage(storage), check = captureDocumentStorageSession(storage);
  return enqueue(storage, `${key}:peek`, async () => {
    await ensureDocumentMigration(scoped);
    check();
    const state = await readState(scoped, id);
    check();
    return state;
  });
}

export function acceptCanvasDocumentState(
  storage: CloudStorage,
  id: string,
  state: CanvasDocumentSyncState,
): void {
  captureDocumentStorageSession(storage)();
  if (state.document && state.document.id !== id)
    throw new Error("云端画布版本与当前画布不匹配。");
  baselines(storage).set(id, {
    documentRevision: state.documentRevision,
    markerRevision: state.markerRevision,
  });
}

export function watchCanvasDocumentChanges(
  storage: CloudStorage,
  id: string,
  onChange: (state: CanvasDocumentSyncState) => Promise<void> | void,
  options: { pollIntervalMs?: number } = {},
): () => void {
  const markerKey = canvasSyncMarkerKey(id);
  const scoped = scopedStorage(storage);
  const checkSession = captureDocumentStorageSession(storage);
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let active = true;
  let running = false;
  let observedRevision = baselines(storage).get(id)?.markerRevision ?? 0;

  const inspect = async () => {
    if (!active || running) return;
    running = true;
    try {
      checkSession();
      const markerEntry = await scoped.getEntry<unknown>(markerKey);
      checkSession();
      const markerRevision = markerEntry?.revision ?? 0;
      if (markerRevision <= observedRevision) return;
      const state = await enqueue(storage, `${canvasStorageKey(id)}:watch`, async () => {
        checkSession();
        return readState(scoped, id);
      });
      checkSession();
      if (!active || state.markerRevision <= observedRevision) return;
      await onChange(state);
      if (active) observedRevision = state.markerRevision;
    } catch {
      // A transient read error leaves the observed revision unchanged so the
      // next foreground poll or window event retries it.
    } finally {
      running = false;
    }
  };

  const unsubscribe = subscribeCanvasSync((event) => {
    if (event.id === id) void inspect();
  });
  const timer = window.setInterval(() => {
    if (document.visibilityState !== "hidden") void inspect();
  }, Math.max(1000, options.pollIntervalMs ?? 5000));
  const onVisibility = () => {
    if (document.visibilityState !== "hidden") void inspect();
  };
  document.addEventListener("visibilitychange", onVisibility);
  void inspect();

  return () => {
    active = false;
    unsubscribe();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function saveCanvasDocument<T extends { id: string }>(
  storage: CloudStorage,
  document: T,
  options?: { validateCurrent: (current: CloudCanvasDocument | null) => void },
): Promise<CanvasDocumentSaveResult> {
  const snapshot = structuredClone(document);
  const key = canvasStorageKey(snapshot.id);
  const scoped = scopedStorage(storage), check = captureDocumentStorageSession(storage);
  return enqueue(storage, key, async () => {
    await ensureDocumentMigration(scoped);
    check();
    const outstanding = pendingWrites(storage).get(key);
    if (outstanding) {
      const confirmed = await confirmWrite(storage, scoped, check, key, outstanding);
      check();
      if (JSON.stringify(outstanding.sourceSnapshot) === JSON.stringify(snapshot)) return confirmed;
    }
    let expectedDocumentRevision = baselines(storage).get(snapshot.id)?.documentRevision ?? 0;
    let expectedMarkerRevision = baselines(storage).get(snapshot.id)?.markerRevision ?? 0;
    if (options) {
      // Management operations validate the exact value whose revision is
      // supplied to CAS, closing the previous check-then-read-again race.
      const state = await readState(scoped, snapshot.id);
      check();
      options.validateCurrent(state.document);
      expectedDocumentRevision = state.documentRevision;
      expectedMarkerRevision = state.markerRevision;
    }
    check();
    const currentEntry = await scoped.getEntry<unknown>(key);
    check();
    const previousChunkKeys = currentEntry && currentEntry.revision === expectedDocumentRevision
      ? chunksInValue(currentEntry.value, snapshot.id)
      : [];
    // Reclaim already-expired generations before staging a new generation.
    // Otherwise a full account quota can reject the new chunks before the
    // post-save cleanup path gets a chance to run. The live manifest protects
    // the chunks needed by the current document; cleanup remains best effort.
    if (previousChunkKeys.length) {
      try {
        await collectRetiredChunks(scoped, new Set(previousChunkKeys), snapshot.id);
      } catch {
        // A cleanup outage must not turn a valid save into a hard failure.
      }
      check();
    }
    // v2 keys are immutable content-addressed values. Reuse their keys
    // without downloading the whole previous document; reads verify the
    // complete checksum and surface any pre-existing corruption explicitly.
    const reusableChunkKeys = previousChunkKeys.filter(key => chunkContentHash(key) !== null);
    const chunkPlan = await chunkPlanFor(snapshot, reusableChunkKeys);
    check();
    const nextChunkKeys = new Set(chunkPlan?.manifest.chunks ?? []);
    const retiredChunkKeys = previousChunkKeys.filter(key => !nextChunkKeys.has(key));
    const retiredChunkRecord = retiredChunkKeys.length
      ? { kind: "canvas-retired-chunks" as const, version: 1 as const, retiredAt: Date.now(), chunks: retiredChunkKeys }
      : undefined;
    const storedSnapshot = (chunkPlan?.manifest ?? snapshot) as CloudCanvasDocument;
    const write = {
      snapshot: storedSnapshot,
      sourceSnapshot: snapshot as CloudCanvasDocument,
      chunkPlan,
      ...(retiredChunkRecord ? { retiredChunkRecord, retiredChunkKey: retirementKey(snapshot.id) } : {}),
      expectedDocumentRevision,
      expectedMarkerRevision,
      marker: {
        version: 1 as const,
        documentUpdatedAt: String((snapshot as { updatedAt?: unknown }).updatedAt ?? ""),
        syncId: crypto.randomUUID(),
      },
      idempotencyKey: crypto.randomUUID(),
    };
    pendingWrites(storage).set(key, write);
    return confirmWrite(storage, scoped, check, key, write);
  });
}

export async function listCanvasDocuments(storage: CloudStorage): Promise<CloudCanvasDocument[]> {
  const scoped = scopedStorage(storage), check = captureDocumentStorageSession(storage);
  await ensureDocumentMigration(scoped);
  check();
  const keys = await listKeys(scoped, DOCUMENT_PREFIX);
  check();
  const documents: CloudCanvasDocument[] = [];
  const errors: unknown[] = [];
  const referencedChunks = new Set<string>();
  for (let start = 0; start < keys.length; start += 100) {
    const batch = keys.slice(start, start + 100);
    try {
      const values = await scoped.getMany<unknown>(batch);
      check();
      for (const key of batch) {
        // A document may be deleted after the key page was read.
        if (values[key] === null) continue;
        try {
          const id = key.slice(DOCUMENT_PREFIX.length);
          for (const chunk of chunksInValue(values[key], id)) referencedChunks.add(chunk);
          documents.push(await hydrateDocumentValue(scoped, id, values[key]));
        }
        catch (error) { errors.push(error); }
      }
    } catch (error) { check(); errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "云端画布未能完整读取，请重试。");
  // Chunk writes are immutable and the live manifest is the only source of
  // truth. Reclaim stale generations after the short grace period so a tab
  // that was suspended during a read can still finish using its old manifest.
  try { await collectRetiredChunks(scoped, referencedChunks); }
  catch { /* canvas reads stay available when best-effort chunk GC fails */ }
  check();
  return documents;
}
