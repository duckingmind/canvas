import { captureLocalStorageScope, localDatabaseName, localStorageScope, scopedMemory } from "./local-storage-scope.ts";
import {
  markSessionChange,
  readDraft,
  withBrowserStorage,
} from "./draft-store.ts";

export type LibraryDocument = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  nodes: Array<{
    id: string;
    type: string;
    title?: string;
    text?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    image?: string;
    imageThumbnail?: string;
    status?: string;
    taskId?: string;
    taskPrompt?: string;
    inputSignature?: string;
    modelId?: string;
    modelSelection?: "user" | "default";
    submission?: unknown;
    error?: string;
  }>;
  edges: unknown[];
};

export type CanvasSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  pendingTasks: number;
  cover?: string;
  previewText?: string;
  deletedAt?: string;
};

const DATABASE = "proxy-canvas:library:v1";
const DOCUMENTS = "documents";
const METADATA = "metadata";
const PENDING_SYNC = "pendingSync";
const DATABASE_VERSION = 2;
// Array keys never collide with the string IDs used by canvas documents.
const LEGACY_MARKER = ["migration", "legacy:v1"];
const queues = scopedMemory<string, Promise<void>>();
const sessionDocuments = scopedMemory<string, LibraryDocument>();
export type PendingCloudSync = {
  id: string;
  /** Opaque delivery token. A late acknowledgement cannot clear a newer save. */
  revision: string;
  updatedAt: string;
  contentHash?: string;
  /** A user's local-only choice survives reloads and suppresses background delivery. */
  paused?: boolean;
};
const sessionPendingSync = scopedMemory<string, PendingCloudSync>();

async function documentHash(document: LibraryDocument): Promise<string> {
  const value = JSON.stringify(document);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (item) =>
      item.toString(16).padStart(2, "0"),
    ).join("");
  }
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `fallback:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function cacheSessionDocument(document: LibraryDocument): void {
  const snapshot = structuredClone(document);
  const revision = JSON.stringify(snapshot);
  sessionDocuments().set(snapshot.id, snapshot);
  markSessionChange(snapshot.id, revision);
}

function enqueue<T>(action: string, operation: () => Promise<T>): Promise<T> {
  const check = captureLocalStorageScope();
  const jobs = queues();
  const result = (jobs.get("queue") || Promise.resolve()).then(() => { check(); return operation(); }).then(value => { check(); return value; }).catch((cause: unknown) => {
    const detail =
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "浏览器存储空间不足，请先导出备份并释放空间。"
        : cause instanceof Error
          ? cause.message
          : "请重试。";
    throw new Error(`本机画布${action}失败：${detail}`, { cause });
  });
  jobs.set("queue", result.then(
    () => {},
    () => {},
  ));
  return result;
}

function checkId(id: string) {
  if (typeof id !== "string" || !id.trim()) throw new Error("缺少画布 ID。");
}
function checkDocument(document: LibraryDocument) {
  checkId(document.id);
  if (
    typeof document.name !== "string" ||
    typeof document.createdAt !== "string" ||
    typeof document.updatedAt !== "string" ||
    !Array.isArray(document.nodes) ||
    !Array.isArray(document.edges)
  )
    throw new Error("画布文档格式无效。");
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined")
      return reject(new Error("当前浏览器无法使用画布资料库。"));
    const request = indexedDB.open(localDatabaseName(DATABASE), DATABASE_VERSION);
    let failed = false;
    request.onupgradeneeded = () => {
      for (const store of [DOCUMENTS, METADATA, PENDING_SYNC])
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onerror = () => {
      failed = true;
      reject(request.error || new Error("无法打开画布资料库。"));
    };
    request.onblocked = () => {
      failed = true;
      reject(new Error("画布资料库被其他页面占用，请关闭旧页面后重试。"));
    };
    request.onsuccess = () => {
      if (failed) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

type Stores = {
  documents: IDBObjectStore;
  metadata: IDBObjectStore;
  pendingSync: IDBObjectStore;
};
async function transact<T>(
  mode: IDBTransactionMode,
  action: (
    stores: Stores,
    setResult: (value: T) => void,
    abort: (error: unknown) => void,
  ) => void,
  inSession: () => T,
): Promise<T> {
  return withBrowserStorage(async () => {
    const database = await openDatabase();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(
          [DOCUMENTS, METADATA, PENDING_SYNC],
          mode,
        );
        let result: T;
        let failure: unknown;
        const abort = (error: unknown) => {
          failure = error;
          transaction.abort();
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => {
          failure ||= transaction.error;
        };
        transaction.onabort = () =>
          reject(
            failure || transaction.error || new Error("画布存储事务已中止。"),
          );
        try {
          action(
            {
              documents: transaction.objectStore(DOCUMENTS),
              metadata: transaction.objectStore(METADATA),
              pendingSync: transaction.objectStore(PENDING_SYNC),
            },
            (value) => {
              result = value;
            },
            abort,
          );
        } catch (error) {
          abort(error);
        }
      });
    } finally {
      database.close();
    }
  }, inSession);
}

function summary(document: LibraryDocument): CanvasSummary {
  const previewText = document.nodes
    .find(
      (node) =>
        node.type !== "image" &&
        typeof node.text === "string" &&
        node.text.trim(),
    )
    ?.text?.trim()
    .slice(0, 160);
  const coverNode = document.nodes.find(
    (node) =>
      node.type === "image" &&
      typeof (node.imageThumbnail || node.image) === "string" &&
      /^https?:\/\//i.test(node.imageThumbnail || node.image || ""),
  );
  const cover = coverNode?.imageThumbnail || coverNode?.image;
  return {
    id: document.id,
    name: document.name,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    nodeCount: document.nodes.length,
    pendingTasks: document.nodes.filter(
      (node) =>
        ["running", "queued"].includes(node.status || "") &&
        Boolean(node.taskId || node.submission),
    ).length,
    ...(cover ? { cover } : {}),
    ...(previewText ? { previewText } : {}),
    ...(document.deletedAt ? { deletedAt: document.deletedAt } : {}),
  };
}
function preserveDeletion<T extends LibraryDocument>(
  document: T,
  existing?: CanvasSummary,
): T {
  const value = { ...document };
  delete value.deletedAt;
  if (existing?.deletedAt) value.deletedAt = existing.deletedAt;
  return value;
}

/** All reads include deleted canvases; callers choose how to present the recycle bin. */
export async function getCanvas<T extends LibraryDocument>(
  id: string,
): Promise<T | null> {
  checkId(id);
  return enqueue("读取", () =>
    transact<T | null>(
      "readonly",
      ({ documents }, result) => {
        const request = documents.get(id);
        request.onsuccess = () => result(request.result ?? null);
      },
      () => structuredClone(sessionDocuments().get(id) as T | undefined) ?? null,
    ),
  );
}

/** Snapshot immediately; document and summary become visible together only at commit. */
export async function saveCanvas<T extends LibraryDocument>(
  document: T,
  options: { queueCloudSync?: true } = {},
): Promise<void> {
  checkDocument(document);
  const checkScope = captureLocalStorageScope();
  let snapshot: T;
  try {
    snapshot = structuredClone(document);
  } catch (cause) {
    throw new Error("本机画布保存失败：文档包含无法存储的数据。", { cause });
  }
  const contentHash = options.queueCloudSync
    ? await documentHash(snapshot)
    : undefined;
  checkScope();
  return enqueue("保存", () =>
    transact<void>(
      "readwrite",
      ({ documents, metadata, pendingSync }, _result, abort) => {
        const existing = metadata.get(snapshot.id);
        existing.onsuccess = () => {
          try {
            const value = preserveDeletion(snapshot, existing.result);
            documents.put(value, value.id);
            metadata.put(summary(value), value.id);
            if (options.queueCloudSync) {
              const queued = pendingSync.get(snapshot.id);
              queued.onsuccess = () => {
                try {
                  const record: PendingCloudSync = {
                    id: value.id,
                    revision: crypto.randomUUID(),
                    updatedAt: value.updatedAt,
                    contentHash,
                  };
                  pendingSync.put(record, record.id);
                } catch (error) {
                  abort(error);
                }
              };
            }
          } catch (error) {
            abort(error);
          }
        };
      },
      () => {
        const existing = sessionDocuments().get(snapshot.id);
        const value = preserveDeletion(snapshot, existing ? summary(existing) : undefined);
        cacheSessionDocument(value);
        if (options.queueCloudSync === true) {
          const record: PendingCloudSync = {
            id: value.id,
            revision: crypto.randomUUID(),
            updatedAt: value.updatedAt,
            contentHash,
          };
          sessionPendingSync().set(value.id, record);
        }
      },
    ),
  );
}

/** Read queued revision markers; the full document remains in the local library store. */
export async function listPendingCloudSync(): Promise<PendingCloudSync[]> {
  return enqueue("待读同步", () =>
    transact<PendingCloudSync[]>(
      "readonly",
      ({ pendingSync }, result) => {
        const request = pendingSync.getAll();
        request.onsuccess = () =>
          result(
            (request.result as unknown[]).filter(
              (item): item is PendingCloudSync =>
                Boolean(
                  item &&
                    typeof item === "object" &&
                    typeof (item as PendingCloudSync).id === "string" &&
                    typeof (item as PendingCloudSync).revision === "string" &&
                    typeof (item as PendingCloudSync).updatedAt === "string",
                ),
            ),
          );
      },
      () => [...sessionPendingSync().values()].map((item) => structuredClone(item)),
    ),
  ).then((records) => records.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)));
}

/** Queue only if this exact snapshot is still the committed local document. */
export async function queuePendingCloudSync<T extends LibraryDocument>(
  document: T,
  options: { reactivatePaused?: boolean } = {},
): Promise<string | null> {
  checkDocument(document);
  const checkScope = captureLocalStorageScope();
  const snapshot = structuredClone(document);
  const contentHash = await documentHash(snapshot);
  checkScope();
  return enqueue("待同步版本写入", () =>
    transact<string | null>(
      "readwrite",
      ({ documents, pendingSync }, result) => {
        const local = documents.get(snapshot.id);
        local.onsuccess = () => {
          if (JSON.stringify(local.result) !== JSON.stringify(snapshot)) {
            result(null);
            return;
          }
          const queued = pendingSync.get(snapshot.id);
          queued.onsuccess = () => {
            const previous = queued.result as PendingCloudSync | undefined;
            if (previous?.paused && options.reactivatePaused === false) {
              result(null);
              return;
            }
            if (
              !previous?.paused &&
              previous?.updatedAt === snapshot.updatedAt &&
              previous.contentHash === contentHash
            ) {
              result(previous.revision);
              return;
            }
            const revision = crypto.randomUUID();
            pendingSync.put(
              { id: snapshot.id, revision, updatedAt: snapshot.updatedAt, contentHash, paused: false },
              snapshot.id,
            );
            result(revision);
          };
        };
      },
      () => {
        const local = sessionDocuments().get(snapshot.id);
        if (JSON.stringify(local) !== JSON.stringify(snapshot)) return null;
        const previous = sessionPendingSync().get(snapshot.id);
        if (previous?.paused && options.reactivatePaused === false) return null;
        if (
          !previous?.paused &&
          previous?.updatedAt === snapshot.updatedAt &&
          previous.contentHash === contentHash
        ) return previous.revision;
        const revision = crypto.randomUUID();
        sessionPendingSync().set(snapshot.id, {
          id: snapshot.id,
          revision,
          updatedAt: snapshot.updatedAt,
          contentHash,
          paused: false,
        });
        return revision;
      },
    ),
  );
}

/** Persist a local-only choice for this exact committed canvas version. */
export async function pausePendingCloudSync<T extends LibraryDocument>(
  document: T,
): Promise<boolean> {
  checkDocument(document);
  const checkScope = captureLocalStorageScope();
  const snapshot = structuredClone(document);
  const contentHash = await documentHash(snapshot);
  checkScope();
  return enqueue("本机保留状态写入", () =>
    transact<boolean>(
      "readwrite",
      ({ documents, pendingSync }, result) => {
        const local = documents.get(snapshot.id);
        local.onsuccess = () => {
          if (JSON.stringify(local.result) !== JSON.stringify(snapshot)) {
            result(false);
            return;
          }
          pendingSync.put(
            {
              id: snapshot.id,
              revision: crypto.randomUUID(),
              updatedAt: snapshot.updatedAt,
              contentHash,
              paused: true,
            } satisfies PendingCloudSync,
            snapshot.id,
          );
          result(true);
        };
      },
      () => {
        const local = sessionDocuments().get(snapshot.id);
        if (JSON.stringify(local) !== JSON.stringify(snapshot)) return false;
        sessionPendingSync().set(snapshot.id, {
          id: snapshot.id,
          revision: crypto.randomUUID(),
          updatedAt: snapshot.updatedAt,
          contentHash,
          paused: true,
        });
        return true;
      },
    ),
  );
}

export async function getPendingCloudSync(
  id: string,
): Promise<PendingCloudSync | null> {
  checkId(id);
  return enqueue("待同步状态读取", () =>
    transact<PendingCloudSync | null>(
      "readonly",
      ({ pendingSync }, result) => {
        const request = pendingSync.get(id);
        request.onsuccess = () => {
          const value = request.result as PendingCloudSync | undefined;
          result(value ? structuredClone(value) : null);
        };
      },
      () => {
        const value = sessionPendingSync().get(id);
        return value ? structuredClone(value) : null;
      },
    ),
  );
}

/** Remove only the revision that the cloud has acknowledged. */
export async function removePendingCloudSync(
  id: string,
  revision?: string,
): Promise<boolean> {
  checkId(id);
  return enqueue("待同步状态更新", () =>
    transact<boolean>(
      "readwrite",
      ({ pendingSync }, result) => {
        const request = pendingSync.get(id);
        request.onsuccess = () => {
          const record = request.result as PendingCloudSync | undefined;
          if (!record || (revision !== undefined && record.revision !== revision)) {
            result(false);
            return;
          }
          pendingSync.delete(id);
          result(true);
        };
      },
      () => {
        const record = sessionPendingSync().get(id);
        if (!record || (revision !== undefined && record.revision !== revision))
          return false;
        sessionPendingSync().delete(id);
        return true;
      },
    ),
  );
}

/** Import an unseen cloud snapshot verbatim; repair orphan summaries without overwriting documents or tombstones. */
export async function importCloudCanvas<T extends LibraryDocument>(
  document: T,
): Promise<boolean> {
  checkDocument(document);
  let snapshot: T;
  try {
    snapshot = structuredClone(document);
  } catch (cause) {
    throw new Error("本机画布导入失败：文档包含无法存储的数据。", { cause });
  }
  return enqueue("导入", () =>
    transact<boolean>(
      "readwrite",
      ({ documents, metadata }, result, abort) => {
        const existingDocument = documents.get(snapshot.id);
        const existingSummary = metadata.get(snapshot.id);
        existingDocument.onsuccess = () => {
          existingSummary.onsuccess = () => {
            try {
              if (existingDocument.result || existingSummary.result?.deletedAt) {
                result(false);
                return;
              }
              if (existingSummary.result) {
                // The list is backed by metadata while opening reads the full
                // document store. Older/corrupt partial writes can leave a card
                // with no body; a remote snapshot repairs that exact case.
                documents.put(snapshot, snapshot.id);
                metadata.put(summary(snapshot), snapshot.id);
              } else {
                documents.add(snapshot, snapshot.id);
                metadata.add(summary(snapshot), snapshot.id);
              }
              result(true);
            } catch (error) {
              abort(error);
            }
          };
        };
      },
      () => {
        if (sessionDocuments().has(snapshot.id)) return false;
        cacheSessionDocument(snapshot);
        return true;
      },
    ),
  );
}

/** Lightweight summaries, including soft-deleted items, newest first. */
export async function listCanvases(): Promise<CanvasSummary[]> {
  return enqueue("列表读取", () =>
    transact<CanvasSummary[]>(
      "readonly",
      ({ metadata }, result) => {
        const request = metadata.getAll();
        request.onsuccess = () =>
          result(
            (request.result as unknown[])
              .filter((item): item is CanvasSummary =>
                Boolean(
                  item &&
                    typeof item === "object" &&
                    typeof (item as CanvasSummary).id === "string",
                ),
              )
              .sort(
                (a, b) =>
                  b.updatedAt.localeCompare(a.updatedAt) ||
                  a.id.localeCompare(b.id),
              ),
          );
      },
      () =>
        [...sessionDocuments().values()]
          .map(summary)
          .sort(
            (a, b) =>
              b.updatedAt.localeCompare(a.updatedAt) ||
              a.id.localeCompare(b.id),
          ),
    ),
  );
}

function changeCanvas(
  id: string,
  action: string,
  change: (
    document: LibraryDocument,
    meta: CanvasSummary | undefined,
  ) => LibraryDocument,
): Promise<void> {
  return enqueue(action, () =>
    transact<void>(
      "readwrite",
      ({ documents, metadata }, _result, abort) => {
        const doc = documents.get(id),
          meta = metadata.get(id);
        meta.onsuccess = () => {
          try {
            if (!doc.result)
              throw new Error("画布不存在，可能已被其他页面移除。");
            const value = change(doc.result, meta.result);
            documents.put(value, id);
            metadata.put(summary(value), id);
          } catch (error) {
            abort(error);
          }
        };
      },
      () => {
        const document = sessionDocuments().get(id);
        if (!document) throw new Error("画布不存在，可能已被其他页面移除。");
        cacheSessionDocument(
          change(structuredClone(document), summary(document)),
        );
      },
    ),
  );
}

export async function setCanvasDeleted(
  id: string,
  deleted: boolean,
): Promise<void> {
  checkId(id);
  return changeCanvas(id, deleted ? "移入回收站" : "恢复", (document, meta) => {
    const value = preserveDeletion(document, meta);
    // Repeating the same operation must not change the original deletion timestamp.
    if (Boolean(value.deletedAt) === deleted) return value;
    value.updatedAt = new Date().toISOString();
    if (deleted) value.deletedAt = value.updatedAt;
    else delete value.deletedAt;
    return value;
  });
}

export async function renameCanvas(id: string, name: string): Promise<void> {
  checkId(id);
  if (typeof name !== "string" || !name.trim())
    throw new Error("画布名称不能为空。");
  const title = name.trim();
  return changeCanvas(id, "重命名", (document, meta) => ({
    ...preserveDeletion(document, meta),
    name: title,
    updatedAt: new Date().toISOString(),
  }));
}

/** Copies editable content and images, without transferring running or completed task identity. */
export function copyCanvasDocument<T extends LibraryDocument>(
  document: T,
  newId: string,
  now: string,
): T {
  checkDocument(document);
  checkId(newId);
  const copy = structuredClone(document);
  copy.id = newId;
  copy.name = `${document.name} 副本`;
  copy.createdAt = now;
  copy.updatedAt = now;
  delete copy.deletedAt;
  copy.nodes = copy.nodes.map((node) => {
    const value = { ...node };
    const original = node as Record<string, unknown>;
    const completedTaskAudio = (node.type === "audio" || original.mediaType === "audio") && node.status === "completed" && node.taskId && !original.assetId && !original.localAudio;
    for (const key of [
      "taskId",
      "taskPrompt",
      "inputSignature",
      "submission",
      "videoSubmission",
      "musicSubmission",
      "voiceDesignSubmission",
      "ttsSubmission",
      "voiceId",
      "taskDiagnostic",
      "taskStage",
      "cancelRequested",
      "videoPollingPaused",
      "videoPollingReason",
      "video",
      "videoContentUrl",
      "videoContentUrlExpiresAt",
      "status",
      "error",
    ] as const)
      delete (value as Record<string, unknown>)[key];
    if (completedTaskAudio) {
      Object.assign(value, { taskId: node.taskId, status: "completed", ...(original.voiceId ? { voiceId: original.voiceId } : {}) });
    } else if (typeof original.audio === "string" && /\/(?:music|voice-design|tts)\/tasks\/[^/]+\/content/.test(original.audio) && !original.assetId) {
      delete (value as Record<string, unknown>).audio;
    }
    return value;
  });
  return copy;
}

/**
 * Import both old draft scopes once. Old records stay untouched; existing library IDs always win.
 * The marker and inserts share a transaction, so an interrupted migration can safely be retried.
 */
export async function migrateLegacy<T extends LibraryDocument>(
  normalize: (value: unknown) => T,
): Promise<void> {
  // Ownership of the original unscoped stores is unknown; never auto-import them.
  if (localStorageScope()) return;
  const check = captureLocalStorageScope();
  return enqueue("旧画布迁移", async () => {
    const migrated = await transact<boolean>(
      "readonly",
      ({ metadata }, result) => {
        const request = metadata.get(LEGACY_MARKER);
        request.onsuccess = () => result(Boolean(request.result));
      },
      // An opaque iframe cannot contain legacy browser drafts. Do not block cloud discovery.
      () => true,
    );
    check();
    if (migrated) return;
    const values = await Promise.all([
      readDraft<unknown>("workspace"),
      readDraft<unknown>("recovery"),
    ]);
    check();
    const documents = values
      .map((value, index) => {
        if (value === null) return null;
        const normalized = structuredClone(normalize(value));
        const time = new Date().toISOString();
        normalized.id = index === 0 ? "legacy-workspace" : "legacy-recovery";
        if (index === 1) normalized.name += " · 恢复备份";
        normalized.createdAt ||= normalized.updatedAt || time;
        normalized.updatedAt ||= normalized.createdAt;
        delete normalized.deletedAt;
        checkDocument(normalized);
        return normalized;
      })
      .filter((value): value is T => value !== null);
    await transact<void>(
      "readwrite",
      (stores, _result, abort) => {
        const marker = stores.metadata.get(LEGACY_MARKER);
        marker.onsuccess = () => {
          if (marker.result) return;
          for (const document of documents) {
            const existing = stores.documents.get(document.id),
              existingMeta = stores.metadata.get(document.id);
            existingMeta.onsuccess = () => {
              if (
                existing.result !== undefined ||
                existingMeta.result !== undefined
              )
                return;
              try {
                stores.documents.add(document, document.id);
                stores.metadata.add(summary(document), document.id);
              } catch (error) {
                abort(error);
              }
            };
          }
          try {
            stores.metadata.add(
              { migratedAt: new Date().toISOString() },
              LEGACY_MARKER,
            );
          } catch (error) {
            abort(error);
          }
        };
      },
      () => {
        for (const document of documents) {
          if (!sessionDocuments().has(document.id))
            cacheSessionDocument(document);
        }
      },
    );
  });
}
