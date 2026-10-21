import assert from "node:assert/strict";
import test from "node:test";
import { canvasStorageKey, captureDocumentStorageSession, listCanvasDocuments, readCanvasDocument, resetDocumentStorage, resumeDocumentStorage, saveCanvasDocument } from "../src/document-storage.ts";
import type { CloudStorage, KVOperation } from "../src/document-kv.ts";
import { ensureDocumentMigration, MIGRATION_KEY } from "../src/document-kv-migration.ts";

function storage(initial: Record<string, unknown> = {}, migrated = true) {
  const values = new Map(Object.entries({ ...(migrated ? { [MIGRATION_KEY]: { completed: true } } : {}), ...initial }));
  const revisions = new Map([...values.keys()].map((key, index) => [key, index + 1]));
  let clock = revisions.size;
  const conflict = () => Object.assign(new Error("Conflict"), { code: "APP_STORAGE_CONFLICT" });
  function commit(operations: KVOperation[]) {
    const next = new Map(values), rev = new Map(revisions);
    const results = operations.map(op => {
      if (op.expectedRevision !== undefined && op.expectedRevision !== (rev.get(op.key) ?? 0)) throw conflict();
      if (op.op === "delete") { next.delete(op.key); rev.delete(op.key); return { key: op.key, success: true }; }
      const revision = ++clock;
      next.set(op.key, structuredClone(op.value)); rev.set(op.key, revision);
      return { key: op.key, success: true, revision };
    });
    values.clear(); revisions.clear();
    for (const [k, v] of next) values.set(k, v);
    for (const [k, v] of rev) revisions.set(k, v);
    return results;
  }
  const confirmed = new Map<string, { request: string; result: { success: boolean; revision?: number } }>();
  const api: CloudStorage = {
    get: async <T>(key: string) => structuredClone(values.get(key) ?? null) as T | null,
    getMany: async <T>(keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values.get(key) ?? null)])) as Record<string, T | null>,
    getEntry: async <T>(key: string) => values.has(key)
      ? { key, value: structuredClone(values.get(key)) as T, revision: revisions.get(key)! } : null,
    set: async (key, value, options) => {
      const request = JSON.stringify({ key, value, expectedRevision: options?.expectedRevision });
      const prior = options?.idempotencyKey ? confirmed.get(options.idempotencyKey) : undefined;
      if (prior) { assert.equal(prior.request, request); return prior.result; }
      const result = commit([{ op: "put", key, value, expectedRevision: options?.expectedRevision }])[0];
      if (options?.idempotencyKey) confirmed.set(options.idempotencyKey, { request, result });
      return result;
    },
    batch: async ops => commit(ops),
    list: async ({ prefix = "", cursor, limit = 100 } = {}) => {
      const keys = [...values.keys()].filter(key => key.startsWith(prefix) && (!cursor || key > cursor)).sort();
      return { keys: keys.slice(0, limit), ...(keys.length > limit ? { nextCursor: keys[limit - 1] } : {}) };
    },
  };
  return { api, values, revisions, device: () => ({ ...api }) };
}

test("document keys stay within the generic KV grammar", () => {
  assert.equal(canvasStorageKey("a"), "canvas:doc:v1:a");
  for (const id of ["", "../x", "x/y", "a..b", "a".repeat(129)]) assert.throws(() => canvasStorageKey(id));
});

test("saving captures a snapshot and uses the loaded baseline across successive saves", async () => {
  const s = storage();
  const doc = { id: "a", name: "First" };
  const saving = saveCanvasDocument(s.api, doc);
  doc.name = "Changed";
  await saving;
  assert.equal((s.values.get(canvasStorageKey("a")) as any).name, "First");
  await saveCanvasDocument(s.api, doc);
  assert.equal((s.values.get(canvasStorageKey("a")) as any).name, "Changed");
});

test("a stale device cannot overwrite a remote save, including after listing or retry", async () => {
  const key = canvasStorageKey("a"), s = storage({ [key]: { id: "a", name: "Initial" } });
  const a = s.device(), b = s.device();
  await readCanvasDocument(a, "a"); await readCanvasDocument(b, "a");
  await saveCanvasDocument(b, { id: "a", name: "Remote" });
  await listCanvasDocuments(a);
  for (let i = 0; i < 2; i++) await assert.rejects(saveCanvasDocument(a, { id: "a", name: "Stale" }), { code: "APP_STORAGE_CONFLICT" });
  assert.equal((s.values.get(key) as any).name, "Remote");
  await readCanvasDocument(a, "a");
  await saveCanvasDocument(a, { id: "a", name: "Resolved" });
});

test("saving without loading is create-only, never an implicit overwrite", async () => {
  const key = canvasStorageKey("a"), s = storage({ [key]: { id: "a" } });
  await assert.rejects(saveCanvasDocument(s.api, { id: "a", name: "Unseen" }), { code: "APP_STORAGE_CONFLICT" });
});

test("management validation and write share a revision and close the read/write race", async () => {
  const key = canvasStorageKey("a"), s = storage({ [key]: { id: "a", name: "Initial" } });
  const a = s.device();
  a.set = async (k, value, options) => {
    await s.api.set(k, { id: "a", name: "Remote" });
    return s.api.set(k, value, options);
  };
  await assert.rejects(saveCanvasDocument(a, { id: "a", name: "Renamed" }, {
    validateCurrent: doc => assert.equal(doc?.name, "Initial"),
  }), { code: "APP_STORAGE_CONFLICT" });
  assert.equal((s.values.get(key) as any).name, "Remote");
});

test("prefix pagination loads all documents and rejects corrupt/partial reads", async () => {
  const s = storage(Object.fromEntries(Array.from({ length: 205 }, (_, i) => [canvasStorageKey(String(i)), { id: String(i) }])));
  const batches: string[][] = [];
  const getMany = s.api.getMany;
  s.api.getMany = async keys => { batches.push(keys); return getMany(keys); };
  s.api.get = async () => { throw new Error("document listing must use batch reads"); };
  assert.equal((await listCanvasDocuments(s.api)).length, 205);
  assert.deepEqual(batches.map(keys => keys.length), [100, 100, 5]);
  await s.api.set(canvasStorageKey("bad"), { id: "different" });
  await assert.rejects(listCanvasDocuments(s.api), AggregateError);
});

test("migration atomically moves documents and removes old index/keys, retaining tombstones", async () => {
  const s = storage({
    "canvas:document:v4:old": { id: "old", name: "Old", deletedAt: "2026-09-18" },
    "canvas:document:v3": { name: "Single" },
    "canvas:library:v1": { version: 1, ids: ["old"] },
  }, false);
  const docs = await listCanvasDocuments(s.api);
  assert.equal(docs.length, 2);
  assert.equal(docs.find(d => d.id === "old")?.deletedAt, "2026-09-18");
  assert.equal([...s.values.keys()].some(k => k.startsWith("canvas:document:")), false);
  assert.equal(s.values.has("canvas:library:v1"), false);
  assert.equal((s.values.get(MIGRATION_KEY) as any).completed, true);
  const count = s.values.size;
  await listCanvasDocuments(s.api);
  assert.equal(s.values.size, count);
});

test("migration preserves an existing new document and backs up its old conflicting copy", async () => {
  const key = canvasStorageKey("a"), old = { id: "a", name: "Old" };
  const s = storage({ [key]: { id: "a", name: "New", deletedAt: "now" }, "canvas:document:v4:a": old }, false);
  await ensureDocumentMigration(s.api);
  assert.equal((s.values.get(key) as any).name, "New");
  assert.equal((s.values.get(key) as any).deletedAt, "now");
  assert.deepEqual([...s.values].find(([k]) => k.startsWith("canvas:backup:"))?.[1], old);
});

test("a failed migration preserves source data and can resume without duplicate documents", async () => {
  const oldKey = "canvas:document:v4:a", s = storage({ [oldKey]: { id: "a" } }, false);
  const api = s.device();
  api.batch = async () => { throw new Error("Offline"); };
  await assert.rejects(ensureDocumentMigration(api), /Offline/);
  assert.equal(s.values.has(oldKey), true);
  assert.equal(s.values.has(MIGRATION_KEY), false);
  api.batch = s.api.batch;
  await ensureDocumentMigration(api);
  assert.equal(s.values.has(oldKey), false);
  assert.equal(s.values.has(canvasStorageKey("a")), true);
});

test("migration never deletes an old document that changed while it was being copied", async () => {
  const oldKey = "canvas:document:v4:a", s = storage({ [oldKey]: { id: "a", name: "Initial" } }, false);
  const api = s.device();
  api.batch = async ops => {
    await s.api.set(oldKey, { id: "a", name: "Newer" });
    return s.api.batch(ops);
  };
  await assert.rejects(ensureDocumentMigration(api), { code: "APP_STORAGE_CONFLICT" });
  assert.equal((s.values.get(oldKey) as any).name, "Newer");
  assert.equal(s.values.has(canvasStorageKey("a")), false);
});

test("completed migrations never read obsolete document paths again", async () => {
  const s = storage();
  const getEntry = s.api.getEntry;
  s.api.getEntry = async key => {
    assert.ok(!key.startsWith("canvas:document:") && key !== "canvas:library:v1");
    return getEntry(key);
  };
  assert.equal(await readCanvasDocument(s.api, "missing"), null);
  assert.deepEqual(await listCanvasDocuments(s.api), []);
});

test("a lost save acknowledgement replays the same mutation without creating another revision", async () => {
  const s = storage(), api = s.device(), requests: unknown[] = [];
  api.set = async (key, value, options) => {
    requests.push(structuredClone({ key, value, options }));
    const result = await s.api.set(key, value, options);
    if (requests.length === 1) throw new TypeError("Network connection lost");
    return result;
  };
  const doc = { id: "a", name: "Saved but unconfirmed" };
  await assert.rejects(saveCanvasDocument(api, doc), /Network connection lost/);
  const revision = s.revisions.get(canvasStorageKey("a"));
  await saveCanvasDocument(api, doc);
  assert.equal(s.revisions.get(canvasStorageKey("a")), revision);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests.length, 2);
});

test("a newer draft waits for the unconfirmed snapshot to replay before using its revision", async () => {
  const s = storage(), api = s.device(), requests: any[] = [];
  api.set = async (key, value, options) => {
    requests.push(structuredClone({ key, value, options }));
    const result = await s.api.set(key, value, options);
    if (requests.length === 1) throw new TypeError("Lost response");
    return result;
  };
  const draft = { id: "a", name: "First" };
  await assert.rejects(saveCanvasDocument(api, draft), /Lost response/);
  const committedRevision = s.revisions.get(canvasStorageKey("a"));
  draft.name = "Second";
  await saveCanvasDocument(api, draft);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[2].value.name, "Second");
  assert.equal(requests[2].options.expectedRevision, committedRevision);
  assert.notEqual(requests[2].options.idempotencyKey, requests[0].options.idempotencyKey);
  assert.equal((s.values.get(canvasStorageKey("a")) as any).name, "Second");
});

test("replaying an acknowledged old revision cannot overwrite a subsequent remote edit", async () => {
  const key = canvasStorageKey("a"), s = storage(), api = s.device();
  let loseResponse = true;
  api.set = async (k, value, options) => {
    const result = await s.api.set(k, value, options);
    if (loseResponse) { loseResponse = false; throw new TypeError("Lost response"); }
    return result;
  };
  await assert.rejects(saveCanvasDocument(api, { id: "a", name: "First" }));
  const remote = s.device();
  await readCanvasDocument(remote, "a");
  await saveCanvasDocument(remote, { id: "a", name: "Remote edit" });
  await assert.rejects(saveCanvasDocument(api, { id: "a", name: "Stale second edit" }), { code: "APP_STORAGE_CONFLICT" });
  assert.equal((s.values.get(key) as any).name, "Remote edit");
  await readCanvasDocument(api, "a");
  await saveCanvasDocument(api, { id: "a", name: "Resolved" });
});

test("an uncommitted failed request is replayed unchanged and a definite rejection allows corrected content", async () => {
  const s = storage(), api = s.device(), requests: any[] = [];
  api.set = async (key, value, options) => {
    requests.push(structuredClone({ key, value, options }));
    if (requests.length === 1) throw new TypeError("Offline before dispatch");
    return s.api.set(key, value, options);
  };
  await assert.rejects(saveCanvasDocument(api, { id: "a", name: "First" }));
  await saveCanvasDocument(api, { id: "a", name: "Second" });
  assert.deepEqual(requests[1], requests[0]);
  assert.equal((s.values.get(canvasStorageKey("a")) as any).name, "Second");
  api.set = async () => { throw Object.assign(new Error("Too large"), { code: "APP_STORAGE_VALUE_TOO_LARGE", status: 413 }); };
  await assert.rejects(saveCanvasDocument(api, { id: "a", name: "Too large" }));
  api.set = s.api.set;
  await saveCanvasDocument(api, { id: "a", name: "Smaller" });
  assert.equal((s.values.get(canvasStorageKey("a")) as any).name, "Smaller");
});

test("listing tolerates concurrent deletion but rejects an incomplete batch response", async () => {
  const first = canvasStorageKey("a"), second = canvasStorageKey("b");
  const s = storage({ [first]: { id: "a" }, [second]: { id: "b" } });
  const getMany = s.api.getMany;
  s.api.getMany = async keys => {
    await s.api.batch([{ op: "delete", key: first }]);
    return getMany(keys);
  };
  assert.deepEqual(await listCanvasDocuments(s.api), [{ id: "b" }]);
  s.api.getMany = async () => ({});
  await assert.rejects(listCanvasDocuments(s.api), AggregateError);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function switchingStorage(first: CloudStorage) {
  let current = first;
  const api: CloudStorage = {
    get: <T>(key: string) => current.get<T>(key),
    getMany: <T>(keys: string[]) => current.getMany<T>(keys),
    getEntry: <T>(key: string) => current.getEntry<T>(key),
    set: (...args) => current.set(...args),
    list: (...args) => current.list(...args),
    batch: (...args) => current.batch(...args),
  };
  return {
    api,
    switchTo(next: CloudStorage) {
      resetDocumentStorage(api);
      current = next;
      resumeDocumentStorage(api);
    },
  };
}

test("an explicit document load never replays a save whose acknowledgement was lost", async () => {
  const key = canvasStorageKey("a"), s = storage(), api = s.device();
  let writes = 0;
  api.set = async (...args) => {
    writes++;
    await s.api.set(...args);
    throw new TypeError("Lost response");
  };
  await assert.rejects(saveCanvasDocument(api, { id: "a", name: "Committed" }));
  await s.api.set(key, { id: "a", name: "Remote change" });
  assert.equal((await readCanvasDocument(api, "a"))?.name, "Remote change");
  assert.equal(writes, 1);
  api.set = s.api.set;
  await saveCanvasDocument(api, { id: "a", name: "After explicit load" });
});

test("changing account discards unconfirmed snapshots and loaded revision baselines", async () => {
  const key = canvasStorageKey("a"), a = storage(), b = storage(), scope = switchingStorage(a.api);
  const set = a.api.set;
  a.api.set = async (...args) => { await set(...args); throw new TypeError("Lost response"); };
  await assert.rejects(saveCanvasDocument(scope.api, { id: "a", name: "Account A only" }));
  scope.switchTo(b.api);
  assert.equal(await readCanvasDocument(scope.api, "a"), null);
  assert.equal(b.values.has(key), false);
  await saveCanvasDocument(scope.api, { id: "a", name: "Account B draft" });
  assert.equal((a.values.get(key) as any).name, "Account A only");
  assert.equal((b.values.get(key) as any).name, "Account B draft");
});

test("queued old writes and their late acknowledgements cannot enter a new account generation", async () => {
  const key = canvasStorageKey("a"), a = storage(), b = storage(), scope = switchingStorage(a.api);
  const started = deferred<void>(), acknowledge = deferred<void>(), set = a.api.set;
  a.api.set = async (...args) => {
    const result = await set(...args);
    started.resolve();
    await acknowledge.promise;
    return result;
  };
  const first = saveCanvasDocument(scope.api, { id: "a", name: "First account A" });
  const firstRejected = assert.rejects(first, { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  await started.promise;
  const queued = saveCanvasDocument(scope.api, { id: "a", name: "Queued account A" });
  const queuedRejected = assert.rejects(queued, { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  scope.switchTo(b.api);
  await saveCanvasDocument(scope.api, { id: "a", name: "Account B" });
  acknowledge.resolve();
  await Promise.all([firstRejected, queuedRejected]);
  await saveCanvasDocument(scope.api, { id: "a", name: "Account B updated" });
  assert.equal((a.values.get(key) as any).name, "First account A");
  assert.equal((b.values.get(key) as any).name, "Account B updated");
});

test("reset blocks new dispatch and invalidates work captured before asynchronous preparation", async () => {
  const s = storage(), check = captureDocumentStorageSession(s.api);
  resetDocumentStorage(s.api);
  assert.throws(() => captureDocumentStorageSession(s.api), { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  assert.throws(() => saveCanvasDocument(s.api, { id: "a" }), { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  resumeDocumentStorage(s.api);
  assert.throws(check, { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  assert.equal(s.values.has(canvasStorageKey("a")), false);
  await saveCanvasDocument(s.api, { id: "a", name: "New session" });
});

test("a migration awaiting old account data cannot copy it into a newly authenticated account", async () => {
  const oldKey = "canvas:document:v4:a", a = storage({ [oldKey]: { id: "a", name: "Private A" } }, false);
  const b = storage(), scope = switchingStorage(a.api), started = deferred<void>(), release = deferred<void>();
  const getEntry = a.api.getEntry;
  a.api.getEntry = async <T>(key: string) => {
    const result = await getEntry<T>(key);
    if (key === oldKey) { started.resolve(); await release.promise; }
    return result;
  };
  const loading = readCanvasDocument(scope.api, "a");
  const rejected = assert.rejects(loading, { code: "CANVAS_STORAGE_SESSION_CHANGED" });
  await started.promise;
  scope.switchTo(b.api);
  release.resolve();
  await rejected;
  assert.equal(await readCanvasDocument(scope.api, "a"), null);
  assert.equal(a.values.has(oldKey), true);
  assert.equal(b.values.has(canvasStorageKey("a")), false);
});
