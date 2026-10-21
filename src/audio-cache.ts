import { captureLocalStorageScope, localDatabaseName, scopedMemory } from "./local-storage-scope.ts";
import { withBrowserStorage } from "./draft-store.ts";

const DATABASE = "proxy-canvas:audio-cache:v1";
const STORE = "audio";
const PREFIX = "proxy-canvas:audio:v1:";
const KEY = /^proxy-canvas:audio:v1:[A-Za-z0-9-]{16,80}$/;
const sessionAudio = scopedMemory<string, Blob>({ maxPartitions: 2 });

export const LOCAL_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export function isLocalAudioKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("当前浏览器无法使用本机音频缓存。"));
    const request = indexedDB.open(localDatabaseName(DATABASE), 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onerror = () => reject(request.error || new Error("无法打开本机音频缓存。"));
    request.onblocked = () => reject(new Error("本机音频缓存被其他页面占用，请关闭旧画布页面后重试。"));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

function writeAudio(database: IDBDatabase, key: string, blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("本机音频缓存写入失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("本机音频缓存写入已中止。"));
  });
}

function removeAudio(database: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("本机音频缓存删除失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("本机音频缓存删除已中止。"));
  });
}

/** Persist local audio bytes outside the canvas document and return a small stable key. */
export async function storeLocalAudio(blob: Blob): Promise<string> {
  if (typeof Blob === "undefined" || !(blob instanceof Blob) || !blob.size) throw new Error("录音或音频文件为空。 ");
  if (blob.size > LOCAL_AUDIO_MAX_BYTES) throw new Error("音频文件不能超过 50 MiB。 ");
  const check = captureLocalStorageScope();
  const key = `${PREFIX}${crypto.randomUUID()}`;
  let database: IDBDatabase | undefined;
  try {
    await withBrowserStorage(
      async () => { database = await openDatabase(); await writeAudio(database, key, blob); },
      () => { sessionAudio().set(key, blob); },
    );
    check();
    return key;
  } catch (cause) {
    throw new Error(`音频未能保存到本机素材库：${cause instanceof Error ? cause.message : "请重试。"}`, { cause });
  } finally { database?.close(); }
}

/** Read local audio by its scoped key without creating a lasting object URL. */
export async function readLocalAudio(key: string): Promise<Blob | null> {
  if (!isLocalAudioKey(key)) return null;
  const check = captureLocalStorageScope();
  let database: IDBDatabase | undefined;
  try {
    const blob = await withBrowserStorage(
      () => new Promise<Blob | null>(async (resolve, reject) => {
        try {
          database = await openDatabase();
          const transaction = database.transaction(STORE, "readonly");
          const request = transaction.objectStore(STORE).get(key);
          request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
          request.onerror = () => reject(request.error || new Error("本机音频缓存读取失败。"));
        } catch (error) { reject(error); }
      }),
      () => sessionAudio().get(key) || null,
    );
    check();
    return blob;
  } finally { database?.close(); }
}

/** Remove local audio bytes by their scoped key. */
export async function deleteLocalAudio(key: string): Promise<void> {
  if (!isLocalAudioKey(key)) return;
  const check = captureLocalStorageScope();
  let database: IDBDatabase | undefined;
  try {
    await withBrowserStorage(
      async () => { database = await openDatabase(); await removeAudio(database, key); },
      () => { sessionAudio().delete(key); },
    );
    check();
  } finally { database?.close(); }
}
