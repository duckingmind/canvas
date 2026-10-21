import { captureLocalStorageScope, localDatabaseName, scopedMemory } from "./local-storage-scope.ts";
import { withBrowserStorage } from "./draft-store.ts";

const DATABASE = "proxy-canvas:video-cache:v1";
const STORE = "video";
const PREFIX = "proxy-canvas:video:v1:";
const KEY = /^proxy-canvas:video:v1:[A-Za-z0-9-]{16,80}$/;
const sessionVideo = scopedMemory<string, Blob>({ maxPartitions: 2 });

export const LOCAL_VIDEO_MAX_BYTES = 160 * 1024 * 1024;

export function isLocalVideoKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("当前浏览器无法使用本机视频缓存。"));
    const request = indexedDB.open(localDatabaseName(DATABASE), 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error || new Error("无法打开本机视频缓存。"));
    request.onblocked = () => reject(new Error("本机视频缓存被其他页面占用，请关闭旧画布页面后重试。"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function writeVideo(database: IDBDatabase, key: string, blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("本机视频缓存写入失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("本机视频缓存写入已中止。"));
  });
}

function readVideo(database: IDBDatabase, key: string): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error || new Error("本机视频缓存读取失败。"));
  });
}

function removeVideo(database: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("本机视频缓存删除失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("本机视频缓存删除已中止。"));
  });
}

/** Persist local video bytes outside the canvas document and return a stable key. */
export async function storeLocalVideo(blob: Blob): Promise<string> {
  if (typeof Blob === "undefined" || !(blob instanceof Blob) || !blob.size) throw new Error("视频文件为空。 ");
  if (blob.size > LOCAL_VIDEO_MAX_BYTES) throw new Error("视频文件不能超过 160 MiB。 ");
  const check = captureLocalStorageScope();
  const key = `${PREFIX}${crypto.randomUUID()}`;
  let database: IDBDatabase | undefined;
  try {
    await withBrowserStorage(
      async () => { database = await openDatabase(); await writeVideo(database, key, blob); },
      () => { sessionVideo().set(key, blob); },
    );
    check();
    return key;
  } catch (cause) {
    throw new Error(`视频未能保存到本机素材库：${cause instanceof Error ? cause.message : "请重试。"}`, { cause });
  } finally { database?.close(); }
}

/** Read local video by its scoped key without creating a lasting object URL. */
export async function readLocalVideo(key: string): Promise<Blob | null> {
  if (!isLocalVideoKey(key)) return null;
  const check = captureLocalStorageScope();
  let database: IDBDatabase | undefined;
  try {
    const blob = await withBrowserStorage(
      async () => { database = await openDatabase(); return readVideo(database, key); },
      () => sessionVideo().get(key) || null,
    );
    check();
    return blob;
  } finally { database?.close(); }
}

/** Remove local video bytes by their scoped key. */
export async function deleteLocalVideo(key: string): Promise<void> {
  if (!isLocalVideoKey(key)) return;
  const check = captureLocalStorageScope();
  let database: IDBDatabase | undefined;
  try {
    await withBrowserStorage(
      async () => { database = await openDatabase(); await removeVideo(database, key); },
      () => { sessionVideo().delete(key); },
    );
    check();
  } finally { database?.close(); }
}
