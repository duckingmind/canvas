import { canvasStorageKey, documentFromValue, DOCUMENT_PREFIX, listKeys } from "./document-kv.ts";
import type { CloudStorage, CloudCanvasDocument } from "./document-kv.ts";
import { ensureDocumentMigration } from "./document-kv-migration.ts";
export { canvasStorageKey } from "./document-kv.ts";
export type { CloudStorage, CloudCanvasDocument } from "./document-kv.ts";

// Baselines are updated only by an explicit document load or a confirmed
// save. Listing the workspace cannot authorize overwriting an unseen edit.
const revisions = new WeakMap<CloudStorage, Map<string, number>>();
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
  expectedRevision: number;
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

async function confirmWrite(storage: CloudStorage, scoped: CloudStorage, check: () => void, key: string, write: PendingWrite) {
  try {
    const result = await scoped.set(key, write.snapshot, {
      expectedRevision: write.expectedRevision, idempotencyKey: write.idempotencyKey,
    });
    check();
    if (!result.success || !Number.isSafeInteger(result.revision) || result.revision! <= 0)
      throw new Error("云端尚未确认保存，请稍后重试。");
    baselines(storage).set(write.snapshot.id, result.revision!);
    pendingWrites(storage).delete(key);
  } catch (error) {
    check();
    // A timeout or lost response may hide a successful commit. Retain the
    // exact request until replay confirms it; never replace its CAS baseline.
    if (isDefiniteRejection(error)) pendingWrites(storage).delete(key);
    if ((error as { code?: string })?.code === "APP_STORAGE_CONFLICT")
      throw Object.assign(new Error("画布已在其他页面更新，当前内容已保留。请重新加载云端版本后继续。"), { code: "APP_STORAGE_CONFLICT" });
    throw error;
  }
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
    const entry = await scoped.getEntry<unknown>(key);
    check();
    const document = entry ? documentFromValue(entry.value, id) : null;
    baselines(storage).set(id, entry?.revision ?? 0);
    return document;
  });
}

export function saveCanvasDocument<T extends { id: string }>(
  storage: CloudStorage,
  document: T,
  options?: { validateCurrent: (current: CloudCanvasDocument | null) => void },
): Promise<void> {
  const snapshot = structuredClone(document);
  const key = canvasStorageKey(snapshot.id);
  const scoped = scopedStorage(storage), check = captureDocumentStorageSession(storage);
  return enqueue(storage, key, async () => {
    await ensureDocumentMigration(scoped);
    check();
    const outstanding = pendingWrites(storage).get(key);
    if (outstanding) {
      await confirmWrite(storage, scoped, check, key, outstanding);
      check();
      if (JSON.stringify(outstanding.snapshot) === JSON.stringify(snapshot)) return;
    }
    let expectedRevision = baselines(storage).get(snapshot.id) ?? 0;
    if (options) {
      // Management operations validate the exact value whose revision is
      // supplied to CAS, closing the previous check-then-read-again race.
      const entry = await scoped.getEntry<unknown>(key);
      check();
      options.validateCurrent(entry ? documentFromValue(entry.value, snapshot.id) : null);
      expectedRevision = entry?.revision ?? 0;
    }
    const write = { snapshot, expectedRevision, idempotencyKey: crypto.randomUUID() };
    pendingWrites(storage).set(key, write);
    await confirmWrite(storage, scoped, check, key, write);
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
  for (let start = 0; start < keys.length; start += 100) {
    const batch = keys.slice(start, start + 100);
    try {
      const values = await scoped.getMany<unknown>(batch);
      check();
      for (const key of batch) {
        // A document may be deleted after the key page was read.
        if (values[key] === null) continue;
        try { documents.push(documentFromValue(values[key], key.slice(DOCUMENT_PREFIX.length))); }
        catch (error) { errors.push(error); }
      }
    } catch (error) { check(); errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "云端画布未能完整读取，请重试。");
  check();
  return documents;
}
