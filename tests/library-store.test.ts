import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
// Vite resolves extensionless TS imports; Node's native TS runner needs the explicit suffix.
const resolveHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./draft-store" &&
      context.parentURL?.endsWith("/src/library-store.ts")
    )
      return nextResolve("./draft-store.ts", context);
    return nextResolve(specifier, context);
  },
});
const {
  getCanvas,
  saveCanvas,
  importCloudCanvas,
  listCanvases,
  setCanvasDeleted,
  renameCanvas,
  copyCanvasDocument,
  migrateLegacy,
} = await import("../src/library-store.ts");
resolveHook.deregister();
const { writeDraft, readDraft } = await import("../src/draft-store.ts");
import type { LibraryDocument } from "../src/library-store.ts";

const LIBRARY = "proxy-canvas:library:v1";
type Operation = {
  database: string;
  store: string;
  action: string;
  key?: unknown;
};

/** Transactional IndexedDB double: staged changes only become visible on atomic commit. */
function installDatabase() {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();
  const operations: Operation[] = [];
  const heldCommits: Array<() => void> = [];
  let hold = false;
  let fail: ((operation: Operation) => boolean) | null = null;
  const keyFor = (key: unknown) => JSON.stringify(key);
  function databaseFor(name: string) {
    let stores = databases.get(name);
    if (!stores) {
      stores = new Map();
      databases.set(name, stores);
    }
    const data = stores;
    return {
      onversionchange: null,
      close() {},
      objectStoreNames: { contains: (store: string) => data.has(store) },
      createObjectStore: (store: string) => data.set(store, new Map()),
      transaction: (storeNames: string[] | string, mode: string) => {
        const scope = Array.isArray(storeNames) ? storeNames : [storeNames];
        const staged = new Map(
          scope.map((store) => [store, new Map(data.get(store))]),
        );
        let pending = 0,
          ended = false;
        const transaction = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
          error: null as DOMException | null,
          abort() {
            if (ended) return;
            ended = true;
            queueMicrotask(() => transaction.onabort?.());
          },
          objectStore: (store: string) => {
            if (!staged.has(store))
              throw new Error("store outside transaction");
            const requestFor = (
              action: string,
              key?: unknown,
              value?: unknown,
            ) => {
              if (ended) throw new Error("transaction ended");
              const captured = structuredClone(value);
              pending++;
              const request = {
                result: undefined as unknown,
                error: null as DOMException | null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
              };
              queueMicrotask(() => {
                if (ended) return;
                const operation = { database: name, store, action, key };
                operations.push(operation);
                if (fail?.(operation)) {
                  fail = null;
                  request.error = transaction.error = new DOMException(
                    "quota",
                    "QuotaExceededError",
                  );
                  request.onerror?.();
                  transaction.onerror?.();
                  transaction.abort();
                  return;
                }
                const records = staged.get(store)!;
                if (action === "get")
                  request.result = structuredClone(records.get(keyFor(key)));
                else if (action === "getAll")
                  request.result = structuredClone([...records.values()]);
                else if (action === "delete") records.delete(keyFor(key));
                else {
                  if (action === "add" && records.has(keyFor(key))) {
                    transaction.error = new DOMException(
                      "duplicate",
                      "ConstraintError",
                    );
                    transaction.onerror?.();
                    transaction.abort();
                    return;
                  }
                  records.set(keyFor(key), captured);
                  request.result = key;
                }
                try {
                  request.onsuccess?.();
                } catch (error) {
                  transaction.error = new DOMException(String(error));
                  transaction.abort();
                  return;
                }
                pending--;
                queueMicrotask(() => {
                  if (pending || ended) return;
                  const commit = () => {
                    if (ended) return;
                    ended = true;
                    if (mode === "readwrite")
                      for (const [storeName, records] of staged)
                        data.set(storeName, records);
                    transaction.oncomplete?.();
                  };
                  if (hold) heldCommits.push(commit);
                  else commit();
                });
              });
              return request;
            };
            return {
              get: (key: unknown) => requestFor("get", key),
              getAll: () => requestFor("getAll"),
              put: (value: unknown, key: unknown) =>
                requestFor("put", key, value),
              add: (value: unknown, key: unknown) =>
                requestFor("add", key, value),
              delete: (key: unknown) => requestFor("delete", key),
            };
          },
        };
        return transaction;
      },
    };
  }
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open(name: string) {
        const existing = databases.has(name);
        const request = {
          result: databaseFor(name),
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null,
          onblocked: null,
        };
        queueMicrotask(() => {
          if (!existing) request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
  });
  return {
    operations,
    inspect: (store: string, key: unknown, database = LIBRARY) =>
      structuredClone(databases.get(database)?.get(store)?.get(keyFor(key))),
    failNext: (predicate: (operation: Operation) => boolean) => {
      fail = predicate;
    },
    holdCommits: () => {
      hold = true;
    },
    releaseCommits: () => {
      hold = false;
      heldCommits.splice(0).forEach((commit) => commit());
    },
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const node = (
  id: string,
  extra: Partial<LibraryDocument["nodes"][number]> = {},
) => ({
  id,
  type: "note",
  title: id,
  text: "edit me",
  x: 0,
  y: 0,
  width: 300,
  height: 180,
  ...extra,
});
const document = (
  id: string,
  extra: Partial<LibraryDocument> = {},
): LibraryDocument => ({
  id,
  name: `画布 ${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  nodes: [node(`${id}-1`)],
  edges: [],
  ...extra,
});
const normalize = (value: unknown) =>
  document("ignored", value as Partial<LibraryDocument>);

test("independent canvases retain full documents while listing only bounded summaries", async () => {
  const database = installDatabase();
  const largeImage = "data:image/png;base64," + "x".repeat(120_000);
  const a = document("A", {
    nodes: [
      node("too-large", { type: "image", image: largeImage }),
      node("cover", {
        type: "image",
        image: "https://images.example/cover.png",
      }),
      node("task", {
        type: "prompt",
        text: "  " + "实际预览".repeat(50) + "  ",
        status: "queued",
        submission: { key: "original" },
      }),
      node("done", { type: "prompt", status: "completed", taskId: "done" }),
    ],
  });
  const b = document("B", {
    name: "B original",
    updatedAt: "2026-09-03T00:00:00.000Z",
  });
  await Promise.all([saveCanvas(a), saveCanvas(b)]);
  assert.deepEqual(await getCanvas("A"), a);
  assert.deepEqual(await getCanvas("B"), b);
  assert.equal(await getCanvas("missing"), null);
  const listed = await listCanvases();
  assert.deepEqual(
    listed.map((summary) => summary.id),
    ["B", "A"],
  );
  assert.equal(listed[1].cover, "https://images.example/cover.png");
  assert.equal(listed[1].nodeCount, 4);
  assert.equal(listed[1].pendingTasks, 1);
  assert.equal(listed[1].previewText, "实际预览".repeat(40));
  assert.equal(listed[1].previewText?.length, 160);
  assert.equal("nodes" in listed[1], false);
  assert.equal(JSON.stringify(listed).includes(largeImage), false);
  assert.ok(
    database.operations.every((operation) => operation.database === LIBRARY),
  );
});

test("call-time snapshots and queued reads see the last save only after transaction commit", async () => {
  const database = installDatabase();
  database.holdCommits();
  const value = document("A");
  let resolved = false;
  const first = saveCanvas(value).then(() => {
    resolved = true;
  });
  value.name = "newest";
  const second = saveCanvas(value);
  value.name = "mutated after save";
  const read = getCanvas("A");
  await tick();
  assert.equal(resolved, false);
  assert.equal(database.inspect("documents", "A"), undefined);
  assert.equal(database.inspect("metadata", "A"), undefined);
  database.releaseCommits();
  await Promise.all([first, second]);
  assert.equal((await read)?.name, "newest");
  assert.equal((await listCanvases())[0].name, "newest");
});

test("a metadata failure rolls back the document and does not poison later operations", async () => {
  const database = installDatabase();
  const original = document("A");
  await saveCanvas(original);
  const before = await listCanvases();
  database.failNext(
    (operation) => operation.store === "metadata" && operation.action === "put",
  );
  await assert.rejects(
    saveCanvas({ ...original, name: "uncommitted", nodes: [] }),
    /存储空间不足/,
  );
  assert.deepEqual(await getCanvas("A"), original);
  assert.deepEqual(await listCanvases(), before);
  await renameCanvas("A", "renamed");
  assert.equal((await getCanvas("A"))?.name, "renamed");
  assert.equal((await listCanvases())[0].name, "renamed");
});

test("late autosaves never resurrect deleted items and only explicit restore clears deletion", async () => {
  installDatabase();
  const original = document("A");
  await saveCanvas(original);
  await setCanvasDeleted("A", true);
  const deletedAt = (await listCanvases())[0].deletedAt;
  assert.ok(deletedAt);
  await saveCanvas({ ...original, name: "late edit" });
  assert.equal((await getCanvas("A"))?.deletedAt, deletedAt);
  assert.equal((await listCanvases())[0].deletedAt, deletedAt);
  await renameCanvas("A", "trash rename");
  assert.equal((await getCanvas("A"))?.name, "trash rename");
  assert.equal((await listCanvases())[0].deletedAt, deletedAt);
  await setCanvasDeleted("A", true);
  assert.equal((await listCanvases())[0].deletedAt, deletedAt);
  const staleDeleted = (await getCanvas("A"))!;
  await setCanvasDeleted("A", false);
  await saveCanvas(staleDeleted);
  assert.equal((await getCanvas("A"))?.deletedAt, undefined);
  assert.equal((await listCanvases())[0].deletedAt, undefined);
});

test("cloud imports retain remote deletion and revision times without overwriting local records", async () => {
  installDatabase();
  const remoteDeleted = document("cloud-trash", {
    updatedAt: "2026-09-03T00:00:00.000Z",
    deletedAt: "2026-09-03T00:00:00.000Z",
  });
  assert.equal(await importCloudCanvas(remoteDeleted), true);
  assert.deepEqual(await getCanvas(remoteDeleted.id), remoteDeleted);
  const importedSummary = (await listCanvases())[0];
  assert.equal(importedSummary.updatedAt, remoteDeleted.updatedAt);
  assert.equal(importedSummary.deletedAt, remoteDeleted.deletedAt);

  // Repeated discovery cannot resurrect an existing tombstone.
  const remoteRestored = { ...remoteDeleted, deletedAt: undefined, name: "cloud restored" };
  assert.equal(await importCloudCanvas(remoteRestored), false);
  assert.deepEqual(await getCanvas(remoteDeleted.id), remoteDeleted);

  // A later stale cloud tombstone cannot delete a locally restored canvas.
  await setCanvasDeleted(remoteDeleted.id, false);
  const locallyRestored = await getCanvas(remoteDeleted.id);
  assert.equal(await importCloudCanvas(remoteDeleted), false);
  assert.deepEqual(await getCanvas(remoteDeleted.id), locallyRestored);

  const local = document("local", { name: "unsynced local edits" });
  await saveCanvas(local);
  assert.equal(await importCloudCanvas({ ...local, name: "cloud version" }), false);
  assert.deepEqual(await getCanvas(local.id), local);
});

test("cloud import captures its snapshot and commits document and summary atomically", async () => {
  const database = installDatabase();
  const remote = document("cloud", { deletedAt: "2026-09-02T00:00:00.000Z" });
  const expected = structuredClone(remote);
  database.failNext(
    (operation) => operation.store === "metadata" && operation.action === "add",
  );
  const importAttempt = importCloudCanvas(remote);
  remote.name = "mutated after import";
  await assert.rejects(importAttempt, /存储空间不足/);
  assert.equal(await getCanvas(remote.id), null);
  assert.deepEqual(await listCanvases(), []);

  const retrySnapshot = structuredClone(expected);
  const retry = importCloudCanvas(expected);
  expected.name = "mutated after retry";
  assert.equal(await retry, true);
  assert.deepEqual(await getCanvas(remote.id), retrySnapshot);
  assert.equal((await listCanvases())[0].name, retrySnapshot.name);
});

test("small inline image covers are included while oversized and unsafe covers are omitted", async () => {
  installDatabase();
  await saveCanvas(
    document("small", {
      nodes: [
        node("image", { type: "image", image: "data:image/png;base64,YQ==" }),
      ],
    }),
  );
  await saveCanvas(
    document("invalid", {
      nodes: [
        node("unsafe", { type: "image", image: "javascript:alert(1)" }),
        node("large", {
          type: "image",
          image: "data:image/png;base64," + "a".repeat(120_000),
        }),
      ],
    }),
  );
  const summaries = await listCanvases();
  assert.equal(
    summaries.find((value) => value.id === "small")?.cover,
    "data:image/png;base64,YQ==",
  );
  assert.equal(
    summaries.find((value) => value.id === "invalid")?.cover,
    undefined,
  );
});

test("copy preserves edit content, images, and graph but removes all task identity", () => {
  const original = document("A", {
    deletedAt: "yesterday",
    nodes: [
      node("prompt", {
        type: "prompt",
        taskId: "task",
        taskPrompt: "snapshot",
        inputSignature: "v1:1111111111111111",
        submission: { key: "key" },
        status: "running",
        error: "error",
      }),
      node("output", {
        type: "image",
        image: "data:image/png;base64,YQ==",
        status: "completed",
        taskId: "result-task",
        inputSignature: "v1:2222222222222222",
      }),
    ],
    edges: [{ from: "prompt", to: "output" }],
  });
  const before = structuredClone(original),
    now = "2026-09-10T00:00:00.000Z";
  const copied = copyCanvasDocument(original, "B", now);
  assert.equal(copied.id, "B");
  assert.equal(copied.name, "画布 A 副本");
  assert.equal(copied.createdAt, now);
  assert.equal(copied.updatedAt, now);
  assert.equal(copied.deletedAt, undefined);
  for (const value of copied.nodes)
    for (const field of [
      "taskId",
      "taskPrompt",
      "inputSignature",
      "submission",
      "status",
      "error",
    ])
      assert.equal(field in value, false);
  assert.equal(copied.nodes[0].text, "edit me");
  assert.equal(copied.nodes[1].image, original.nodes[1].image);
  assert.deepEqual(copied.edges, original.edges);
  assert.notEqual(copied.edges, original.edges);
  assert.deepEqual(original, before);
});

test("copy clears audio task submissions and diagnosis while retaining reusable local audio", () => {
  const original = document("audio", {
    nodes: [node("voice", {
      type: "prompt", mediaType: "audio", audioMode: "voice_design", audioTaskType: "voice_design",
      localAudio: "proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789012",
      voicePreviewText: "试听文本", musicLyrics: "歌词", voiceId: "created-voice",
      taskId: "voice-task", musicSubmission: { key: "music-key" }, voiceDesignSubmission: { key: "voice-key" },
      taskDiagnostic: { status: "running", code: "creation_result_unknown" }, taskStage: "running",
      videoPollingPaused: true, videoPollingReason: "reconciliation", cancelRequested: true,
    })],
  });
  const copied = copyCanvasDocument(original, "audio-copy", "2026-10-14T00:00:00.000Z");
  for (const field of ["taskId", "musicSubmission", "voiceDesignSubmission", "voiceId", "taskDiagnostic", "taskStage", "cancelRequested", "videoPollingPaused", "videoPollingReason"]) {
    assert.equal(field in copied.nodes[0], false);
  }
  assert.equal(copied.nodes[0].localAudio, original.nodes[0].localAudio);
  assert.equal(copied.nodes[0].voicePreviewText, "试听文本");
  assert.equal(copied.nodes[0].musicLyrics, "歌词");
});

test("legacy migration is atomic and idempotent without deleting or overwriting old records", async () => {
  const database = installDatabase();
  await writeDraft("workspace", { name: "旧工作区", nodes: [node("old-a")] });
  await writeDraft("recovery", { name: "旧恢复点", nodes: [node("old-b")] });
  database.failNext(
    (operation) =>
      operation.database === LIBRARY &&
      operation.store === "metadata" &&
      operation.action === "add" &&
      operation.key === "legacy-recovery",
  );
  await assert.rejects(migrateLegacy(normalize), /迁移失败/);
  assert.deepEqual(await listCanvases(), []);
  assert.equal(await getCanvas("legacy-workspace"), null);
  await migrateLegacy(normalize);
  assert.deepEqual((await listCanvases()).map((value) => value.id).sort(), [
    "legacy-recovery",
    "legacy-workspace",
  ]);
  assert.equal((await getCanvas("legacy-workspace"))?.name, "旧工作区");
  assert.equal(
    (await getCanvas("legacy-recovery"))?.name,
    "旧恢复点 · 恢复备份",
  );
  assert.equal(
    (await readDraft<{ name: string }>("workspace"))?.name,
    "旧工作区",
  );
  await setCanvasDeleted("legacy-workspace", true);
  await writeDraft("workspace", { name: "不应重新导入" });
  let normalizations = 0;
  await migrateLegacy((value) => {
    normalizations++;
    return normalize(value);
  });
  assert.equal(normalizations, 0);
  assert.equal((await getCanvas("legacy-workspace"))?.name, "旧工作区");
  assert.ok((await getCanvas("legacy-workspace"))?.deletedAt);
});

test("migration preserves every existing same-ID canvas, including deleted ones", async () => {
  installDatabase();
  await saveCanvas(document("legacy-workspace", { name: "现有内容" }));
  await setCanvasDeleted("legacy-workspace", true);
  await writeDraft("workspace", { name: "不能覆盖" });
  await writeDraft("recovery", { name: "可以导入" });
  await Promise.all([migrateLegacy(normalize), migrateLegacy(normalize)]);
  assert.equal((await getCanvas("legacy-workspace"))?.name, "现有内容");
  assert.ok((await getCanvas("legacy-workspace"))?.deletedAt);
  assert.equal(
    (await getCanvas("legacy-recovery"))?.name,
    "可以导入 · 恢复备份",
  );
  assert.equal((await listCanvases()).length, 2);
});

test("failed legacy reads leave migration retryable and missing items are never fabricated", async () => {
  const database = installDatabase();
  await writeDraft("workspace", { name: "仍可恢复" });
  database.failNext(
    (operation) => operation.database !== LIBRARY && operation.action === "get",
  );
  await assert.rejects(migrateLegacy(normalize), /迁移失败/);
  await migrateLegacy(normalize);
  assert.equal((await getCanvas("legacy-workspace"))?.name, "仍可恢复");
  assert.equal(await getCanvas("legacy-recovery"), null);
  assert.equal((await listCanvases()).length, 1);
});

test("missing canvases and invalid names fail without creating phantom summaries", async () => {
  installDatabase();
  await assert.rejects(renameCanvas("missing", "new"), /画布不存在/);
  await assert.rejects(setCanvasDeleted("missing", true), /画布不存在/);
  await assert.rejects(renameCanvas("missing", "  "), /名称不能为空/);
  await assert.rejects(
    saveCanvas({ ...document("A"), nodes: (() => {}) as never }),
    /格式无效/,
  );
  assert.deepEqual(await listCanvases(), []);
});

test("persistent IndexedDB partitions accounts and never adopts unowned legacy documents", async () => {
  const { setLocalStorageScope } = await import("../src/local-storage-scope.ts");
  installDatabase();
  await saveCanvas(document("legacy-unowned"));
  setLocalStorageScope("persist-A");
  assert.deepEqual(await listCanvases(), []);
  await saveCanvas({ ...document("same-id"), name: "A only" });
  await writeDraft("recovery:same-id", { name: "A recovery" });
  setLocalStorageScope("persist-B");
  assert.equal(await getCanvas("same-id"), null);
  assert.equal(await readDraft("recovery:same-id"), null);
  await saveCanvas({ ...document("same-id"), name: "B only" });
  setLocalStorageScope("persist-A");
  assert.equal((await getCanvas("same-id"))?.name, "A only");
  assert.deepEqual(await readDraft("recovery:same-id"), { name: "A recovery" });
});

test("copy of a completed task-only audio preserves playback identity without submitting work", () => {
  const original = document("audio", { nodes: [node("result", { type: "prompt", mediaType: "audio", audioTaskType: "voice_design", taskId: "voice-task", status: "completed", voiceId: "voice-id", audio: "/voice-design/tasks/voice-task/content" })] });
  const copied = copyCanvasDocument(original, "copy", "2026-10-14T00:00:00.000Z");
  assert.equal(copied.nodes[0].taskId, "voice-task");
  assert.equal(copied.nodes[0].status, "completed");
  assert.equal((copied.nodes[0] as any).voiceId, "voice-id");
  assert.equal((copied.nodes[0] as any).audioTaskType, "voice_design");
});

test("session-only cloud imports preserve remote tombstones and protect existing local changes", async () => {
  const { setLocalStorageScope } = await import("../src/local-storage-scope.ts");
  setLocalStorageScope("session-cloud-import");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        throw new DOMException("IndexedDB access denied", "SecurityError");
      },
    },
  });
  const remote = document("remote-trash", { deletedAt: "2026-09-02T00:00:00.000Z" });
  const expected = structuredClone(remote);
  const pending = importCloudCanvas(remote);
  remote.name = "mutated after import";
  assert.equal(await pending, true);
  assert.deepEqual(await getCanvas(remote.id), expected);
  assert.equal((await listCanvases())[0].deletedAt, expected.deletedAt);
  assert.equal((await listCanvases())[0].updatedAt, expected.updatedAt);

  await setCanvasDeleted(remote.id, false);
  const restored = await getCanvas(remote.id);
  assert.equal(await importCloudCanvas(expected), false);
  assert.deepEqual(await getCanvas(remote.id), restored);
  const local = document("local", { name: "session local edits" });
  await saveCanvas(local);
  assert.equal(await importCloudCanvas({ ...local, name: "cloud version" }), false);
  assert.deepEqual(await getCanvas(local.id), local);
});
