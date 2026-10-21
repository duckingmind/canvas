import { captureLocalStorageScope, localDatabaseName, scopedMemory } from "./local-storage-scope.ts";
/** Browser-local document drafts. The caller owns scope selection and recovery decisions. */
const DATABASE = "proxy-canvas:drafts:v1";
const STORE = "documents";
let sessionOnlyStorage = false;
const sessionDrafts = scopedMemory<string, unknown>();
const pendingSessionChanges = scopedMemory<string, string>();
const syncedSessionRevisions = scopedMemory<string, string>();

/** Sandboxed apps persist through platform storage; this cache lasts only until the page closes. */
export function isSessionOnlyStorage(): boolean {
  return sessionOnlyStorage;
}

export function markSessionChange(id: string, revision: string): void {
  if (!sessionOnlyStorage) return;
  if (syncedSessionRevisions().get(id) === revision)
    pendingSessionChanges().delete(id);
  else pendingSessionChanges().set(id, revision);
}

export function markSessionSynced(id: string, revision: string): void {
  if (!sessionOnlyStorage) return;
  syncedSessionRevisions().set(id, revision);
  if (pendingSessionChanges().get(id) === revision)
    pendingSessionChanges().delete(id);
}

export function hasPendingSessionChanges(): boolean {
  return pendingSessionChanges().size > 0;
}

/** Permission denial is an environment limitation. Quota/transaction errors must still reject. */
export async function withBrowserStorage<T>(
  persistent: () => Promise<T>,
  inSession: () => T | Promise<T>,
): Promise<T> {
  const check = captureLocalStorageScope();
  const session = async () => { check(); const result = await inSession(); check(); return result; };
  if (sessionOnlyStorage) return session();
  try {
    if (typeof indexedDB === "undefined") {
      sessionOnlyStorage = true;
      return session();
    }
    const result = await persistent();
    check();
    return result;
  } catch (error) {
    check();
    let cause: unknown = error;
    const visited = new Set<unknown>();
    while (cause && typeof cause === "object" && !visited.has(cause)) {
      visited.add(cause);
      if ("name" in cause && cause.name === "SecurityError") {
        sessionOnlyStorage = true;
        return session();
      }
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  }
}

// Include reads and removals so callers always observe preceding writes in this module.
// A failed operation must not prevent a later retry for the same document.
const pending = scopedMemory<string, Promise<void>>();

function checkScope(scope: string): void {
  if (typeof scope !== "string" || !scope.trim())
    throw new Error("无法访问本机草稿：缺少画布存储范围。");
}

function enqueue<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  const check = captureLocalStorageScope();
  const jobs = pending();
  const result = (jobs.get(scope) || Promise.resolve()).then(() => { check(); return operation(); });
  const settled = result.then(
    () => {},
    () => {},
  );
  jobs.set(scope, settled);
  void settled.then(() => {
    if (jobs.get(scope) === settled) jobs.delete(scope);
  });
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器无法使用本机草稿存储。"));
      return;
    }
    const request = indexedDB.open(localDatabaseName(DATABASE), 1);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onerror = () => {
      settled = true;
      reject(new Error("无法打开本机草稿存储。", { cause: request.error }));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("本机草稿存储被其他页面占用，请关闭旧画布页面后重试。"));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

type DraftRecord<T> = { document: T };

async function transact<T>(
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest,
  resultFor: (result: unknown) => T,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      let result: unknown;
      let failure: DOMException | null = null;
      // Request success does not mean the transaction has committed to IndexedDB.
      transaction.oncomplete = () => {
        try {
          resolve(resultFor(result));
        } catch (error) {
          reject(error);
        }
      };
      transaction.onerror = () => {
        failure = transaction.error;
      };
      transaction.onabort = () =>
        reject(
          failure || transaction.error || new Error("本机草稿事务已中止。"),
        );
      try {
        const request = requestFor(transaction.objectStore(STORE));
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => {
          failure = request.error;
        };
      } catch (error) {
        // Discard any work if a synchronous IndexedDB request fails.
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

function storageError(action: "保存" | "读取" | "移除", error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("本机草稿存储被"))
    return error;
  const suffix =
    error instanceof DOMException && error.name === "QuotaExceededError"
      ? "浏览器存储空间不足，请先导出画布备份并释放空间。"
      : action === "保存"
        ? "请导出画布备份后重试。"
        : "请重试。";
  return new Error(`本机草稿${action}失败，${suffix}`, { cause: error });
}

/**
 * Capture the document now, then replace this scope's draft after all preceding operations.
 * Inline image data URLs are preserved by structured clone without localStorage's size limit.
 * Resolves only after the write transaction commits. The caller should pass document data,
 * never account credentials, SDK state, or authentication tokens.
 */
export async function writeDraft<T>(scope: string, document: T): Promise<void> {
  checkScope(scope);
  let record: DraftRecord<T>;
  try {
    record = { document: structuredClone(document) };
  } catch (error) {
    throw new Error(
      "本机草稿保存失败：画布包含无法存储的数据，请导出备份后重试。",
      { cause: error },
    );
  }
  return enqueue(scope, async () => {
    try {
      await withBrowserStorage(
        () =>
          transact(
            "readwrite",
            (store) => store.put(record, scope),
            () => {},
          ),
        () => {
          sessionDrafts().set(scope, record);
        },
      );
    } catch (error) {
      throw storageError("保存", error);
    }
  });
}

/** Read only the requested scope. A missing draft returns null; storage failures reject. */
export async function readDraft<T>(scope: string): Promise<T | null> {
  checkScope(scope);
  return enqueue(scope, async () => {
    try {
      return await withBrowserStorage(
        () =>
          transact(
            "readonly",
            (store) => store.get(scope),
            (result) => {
              if (result === undefined) return null;
              if (
                !result ||
                typeof result !== "object" ||
                !Object.hasOwn(result, "document")
              )
                throw new Error("本机草稿记录格式无效。");
              return (result as DraftRecord<T>).document;
            },
          ),
        () => {
          const record = sessionDrafts().get(scope) as DraftRecord<T> | undefined;
          return record ? structuredClone(record.document) : null;
        },
      );
    } catch (error) {
      throw storageError("读取", error);
    }
  });
}

/** Remove only this scope after its preceding writes have completed. */
export async function removeDraft(scope: string): Promise<void> {
  checkScope(scope);
  return enqueue(scope, async () => {
    try {
      await withBrowserStorage(
        () =>
          transact(
            "readwrite",
            (store) => store.delete(scope),
            () => {},
          ),
        () => {
          sessionDrafts().delete(scope);
        },
      );
    } catch (error) {
      throw storageError("移除", error);
    }
  });
}
