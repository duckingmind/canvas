import { captureLocalStorageScope, localDatabaseName, localStorageScope, scopedMemory } from "./local-storage-scope.ts";
/** Local image assets belong to this browser profile; exported documents remain the backup. */
import { withBrowserStorage } from "./draft-store.ts";
import { immutableImageUrlIdentity } from "./media-url-cache.ts";
import { fetchCanvasResource } from "./network-boundary.ts";

type ImageReference = { image?: string; localImage?: string; assetId?: string; taskId?: string };
type ImageNode = ImageReference & {
  assetId?: string;
  taskId?: string;
  embeddedReferences?: ImageReference[];
  videoPoster?: string;
  localVideoPoster?: string;
  submission?: { images: ImageReference[] };
  videoSubmission?: { images?: ImageReference[]; references?: Array<ImageReference & { type?: string; url?: string }> };
};
type ImageDocument = { nodes: ImageNode[] };

const DATABASE = "proxy-canvas:image-cache:v1";
const STORE = "images";
const METADATA_KEY = "__meta:total-bytes";
const KEY_PREFIX = "proxy-canvas:image:sha256:";
const IMAGE_KEY = /^proxy-canvas:image:sha256:[a-f0-9]{64}$/;
const MAX_LOCAL_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_LOCAL_IMAGE_STORE_BYTES = 256 * 1024 * 1024;
const MAX_REMOTE_IMAGE_CACHE_BYTES = 64 * 1024 * 1024;
const REMOTE_IMAGE_CACHE_TTL = 15 * 60 * 1000;
const MAX_REMOTE_IMAGES = 32;
type RemoteImage = { image: string; bytes: number; usedAt: number };
// Session-only local image data can be large. Keep the two most recently used
// account partitions so A→B→A remains seamless while repeated account
// switching cannot retain every account's full image set in page memory.
const sessionImages = scopedMemory<string, string>({ maxPartitions: 2 });
// Remote bytes are only read during explicit canvas/export operations. Normal
// image rendering uses the original URL and the browser's own image pipeline.
const remoteImages = new Map<string, RemoteImage>();
const remoteCacheResults = new Map<string, string>();
const remoteCacheRequests = new Map<string, Promise<string | null>>();
let remoteCacheScope: string | undefined;
function ensureRemoteCacheScope(): void {
  const scope = localStorageScope();
  if (remoteCacheScope === scope) return;
  // Remote bytes are a disposable tool cache. Do not retain another
  // account's full-resolution images after the user changes account.
  remoteImages.clear();
  remoteCacheResults.clear();
  remoteCacheRequests.clear();
  remoteCacheScope = scope;
}
const isInlineImage = (value: unknown): value is string =>
  typeof value === "string" && /^data:image\//i.test(value);
const isRemoteImage = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

function inlineImageBytes(value: string): number {
  const separator = value.indexOf(",");
  if (separator < 0) return value.length * 2;
  const payload = value.slice(separator + 1);
  return /;base64/i.test(value.slice(0, separator))
    ? Math.ceil(payload.replace(/\s/g, "").length * 3 / 4)
    : payload.length * 2;
}

/**
 * Read only a bounded amount of an explicit remote image request. Checking
 * `Blob.size` after `response.blob()` is too late: the browser has already
 * buffered the entire response, so a large object could bypass the cache's
 * memory budget before being rejected.
 */
async function readBoundedRemoteImage(response: Response, check: () => void): Promise<Blob | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_LOCAL_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const stream = response.body;
  if (!stream) {
    // A body-less response cannot be bounded once blob() starts buffering. If
    // the server did not provide a trustworthy size, skip the optional cache
    // rather than risking an unbounded allocation.
    if (!Number.isFinite(contentLength) || contentLength < 0) return null;
    const blob = await response.blob();
    return blob.size <= MAX_LOCAL_IMAGE_BYTES ? blob : null;
  }
  const reader = stream.getReader();
  const chunks: BlobPart[] = [];
  let bytes = 0;
  let completed = false;
  try {
    while (true) {
      check();
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_LOCAL_IMAGE_BYTES) return null;
      // Copy into a concrete ArrayBuffer. The stream reader's Uint8Array may
      // be backed by SharedArrayBuffer in newer DOM typings, while BlobPart
      // intentionally accepts only ArrayBuffer-backed chunks.
      const chunk = new ArrayBuffer(value.byteLength);
      const target = new Uint8Array(chunk);
      for (let index = 0; index < value.byteLength; index += 1) target[index] = value[index];
      chunks.push(chunk);
    }
    return new Blob(chunks, { type: response.headers.get("content-type") || "" });
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Remote data URLs are retained as JavaScript strings, not raw file bytes.
// Account for their serialized representation rather than counting only the
// decoded payload; this keeps the page cache's advertised cap conservative.
function remoteImageMemoryBytes(image: string): number {
  return image.length * 2;
}

function pruneRemoteImages(now = Date.now()): void {
  ensureRemoteCacheScope();
  const entries = remoteImages;
  let bytes = 0;
  let count = 0;
  for (const [key, value] of [...entries].sort((a, b) => b[1].usedAt - a[1].usedAt)) {
    if (
      now - value.usedAt >= REMOTE_IMAGE_CACHE_TTL ||
      count >= MAX_REMOTE_IMAGES ||
      bytes + value.bytes > MAX_REMOTE_IMAGE_CACHE_BYTES
    ) {
      entries.delete(key);
      for (const [identity, localImage] of remoteCacheResults) {
        if (localImage === key) remoteCacheResults.delete(identity);
      }
      continue;
    }
    bytes += value.bytes;
    count += 1;
  }
}

function memoryImage(localImage: string): string | null {
  pruneRemoteImages();
  const entry = remoteImages.get(localImage);
  if (!entry) return null;
  entry.usedAt = Date.now();
  return entry.image;
}

function rememberRemoteIdentity(identity: string, localImage: string): void {
  ensureRemoteCacheScope();
  const results = remoteCacheResults;
  results.delete(identity);
  results.set(identity, localImage);
  pruneRemoteImages();
}

function copyDocument<T extends ImageDocument>(document: T): T {
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      ...(node.embeddedReferences
        ? { embeddedReferences: node.embeddedReferences.map((reference) => ({ ...reference })) }
        : {}),
      ...(node.submission
        ? {
            submission: {
              ...node.submission,
              images: node.submission.images.map((image) => ({ ...image })),
            },
          }
        : {}),
      ...(node.videoSubmission
        ? {
            videoSubmission: {
              ...node.videoSubmission,
              ...(node.videoSubmission.images
                ? { images: node.videoSubmission.images.map((image) => ({ ...image })) }
                : {}),
              ...(node.videoSubmission.references
                ? { references: node.videoSubmission.references.map((reference) => ({ ...reference })) }
                : {}),
            },
          }
        : {}),
    })),
  };
}

function imageReferences(document: ImageDocument): ImageReference[] {
  return document.nodes.flatMap((node) => [
    node,
    ...(node.embeddedReferences || []),
    ...(node.submission?.images || []),
    ...(node.videoSubmission?.images || []),
    ...(node.videoSubmission?.references || []),
  ]);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器无法使用本机图片缓存。"));
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
      reject(request.error || new Error("无法打开本机图片缓存。"));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("本机图片缓存被其他页面占用，请关闭旧画布页面后重试。"));
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

async function hashedKey(prefix: string, value: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle)
    throw new Error("当前环境无法安全计算图片缓存标识。");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return (
    prefix +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}
const imageKey = (image: string) => hashedKey(KEY_PREFIX, image);

function writeImages(
  database: IDBDatabase,
  images: Map<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error || new Error("本机图片缓存写入已中止。"));
    transaction.onerror = () =>
      reject(transaction.error || new Error("本机图片缓存写入失败。"));
    const keyRequest = store.getAllKeys();
    // Once the total is recorded, autosaves only need the key list. Older
    // databases without metadata perform one compatibility scan and seed the
    // counter, avoiding a 256 MB getAll() allocation on every later save.
    const metadataRequest = store.get(METADATA_KEY);
    let existingKeys: Set<string> | undefined;
    let existingBytes: number | undefined;
    let metadataChecked = false;
    let fullScanStarted = false;
    let settled = false;
    const writeAfterValidation = () => {
      if (!existingKeys || existingBytes === undefined || settled) return;
      let bytes = existingBytes;
      for (const [key, image] of images) {
        if (!existingKeys.has(key)) bytes += inlineImageBytes(image);
      }
      if (bytes > MAX_LOCAL_IMAGE_STORE_BYTES) {
        settled = true;
        reject(new Error("本机素材总量超过 256 MB，请先导出备份或释放本机素材空间。"));
        transaction.abort();
        return;
      }
      settled = true;
      store.put({ version: 1, totalBytes: bytes }, METADATA_KEY);
      for (const [key, image] of images) {
        // Existing content-addressed assets are immutable; avoid rewriting them on every autosave.
        if (existingKeys.has(key)) continue;
        store.put(image, key);
      }
    };
    const startFullScan = () => {
      if (!metadataChecked || existingBytes !== undefined || fullScanStarted || settled) return;
      fullScanStarted = true;
      const valueRequest = store.getAll();
      valueRequest.onsuccess = () => {
        let bytes = 0;
        const values = valueRequest.result;
        const keys = [...(existingKeys || [])];
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index];
          const value = values[index];
          if (IMAGE_KEY.test(key) && typeof value === "string") bytes += inlineImageBytes(value);
        }
        existingBytes = bytes;
        writeAfterValidation();
      };
    };
    keyRequest.onsuccess = () => {
      existingKeys = new Set(keyRequest.result.filter((key): key is string => typeof key === "string"));
      startFullScan();
      writeAfterValidation();
    };
    metadataRequest.onsuccess = () => {
      metadataChecked = true;
      const metadata = metadataRequest.result as { version?: unknown; totalBytes?: unknown } | undefined;
      if (metadata?.version === 1 && typeof metadata.totalBytes === "number" && Number.isFinite(metadata.totalBytes) && metadata.totalBytes >= 0) {
        existingBytes = metadata.totalBytes;
      }
      startFullScan();
      writeAfterValidation();
    };
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const base64 = btoa(binary);
      return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("图片读取失败。"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

/**
 * Cache a loaded remote image under both its content hash and source URL. This
 * is best-effort: many image hosts allow <img> display but block fetch/CORS.
 */
async function cacheRemoteImageOnce(source: string): Promise<string | null> {
  const check = captureLocalStorageScope();
  const cached = await readCachedRemoteImage(source).catch(() => null);
  check();
  if (cached) return cached.localImage;
  const fetchOptions: RequestInit = {
    // The page-scoped runtime cache below is the only byte cache we own.
    // Do not also put the full response in the browser's persistent HTTP
    // cache; normal <img> rendering can use its own browser cache when it
    // needs to, while explicit tool/download reads stay bounded and scoped.
    cache: "no-store",
    // Signed object URLs are self-authorizing. Do not attach app cookies to
    // cross-origin storage hosts; fetchCanvasResource adds credentials only
    // when the target is the same-origin server-runtime gateway.
    credentials: "omit",
    mode: "cors",
  };
  let response: Response;
  if (typeof location !== "undefined" && new URL(source).origin !== location.origin && immutableImageUrlIdentity(source)) {
    // A displayed <img> need not have CORS permission. Probe with a one-byte
    // GET before downloading another full copy into the bounded memory cache.
    // HEAD cannot use a URL signed for GET. no-store keeps the probe's Origin
    // variant out of the browser cache used by the original <img>.
    const probe = await fetchCanvasResource(source, { ...fetchOptions, cache: "no-store", headers: { Range: "bytes=0-0" } });
    check();
    if (probe.status === 206) {
      await probe.body?.cancel();
      check();
      response = await fetchCanvasResource(source, fetchOptions);
    } else {
      // A host may ignore Range and send 200; use that complete response once.
      response = probe;
    }
  } else response = await fetchCanvasResource(source, fetchOptions);
  if (!response.ok) throw new Error("图片缓存下载失败。");
  const blob = await readBoundedRemoteImage(response, check);
  if (!blob) return null;
  if (!/^image\//i.test(blob.type)) throw new Error("远端资源不是图片。");
  if (!blob.size) throw new Error("远端图片内容为空。");
  const image = await blobToDataUrl(blob);
  if (!isInlineImage(image)) throw new Error("图片缓存格式无效。");
  const localImage = await imageKey(image);
  check();
  // Remote originals are reproducible platform assets, not browser-local originals.
  // Keep explicit tool/download bytes in bounded memory only; never write them to IndexedDB.
  ensureRemoteCacheScope();
  remoteImages.set(localImage, { image, bytes: remoteImageMemoryBytes(image), usedAt: Date.now() });
  rememberRemoteIdentity(immutableImageUrlIdentity(source) || source, localImage);
  pruneRemoteImages();
  return localImage;
}

/** Explicit tool/download cache. Remote media never becomes a persistent local asset. */
export async function cacheRemoteImage(source: string): Promise<string | null> {
  if (!isRemoteImage(source)) return null;
  ensureRemoteCacheScope();
  const identity = immutableImageUrlIdentity(source) || source;
  const cached = remoteCacheResults.get(identity);
  if (cached && memoryImage(cached)) return cached;
  const existing = remoteCacheRequests.get(identity);
  if (existing) return existing;
  const check = captureLocalStorageScope();
  const requests = remoteCacheRequests;
  const request = cacheRemoteImageOnce(source).then((localImage) => {
    check();
    return localImage;
  });
  requests.set(identity, request);
  // Failed requests remain retryable. A transient CORS/network failure should
  // not permanently disable a later explicit cache attempt.
  void request.then(
    () => { if (requests.get(identity) === request) requests.delete(identity); },
    () => { if (requests.get(identity) === request) requests.delete(identity); },
  );
  return request;
}

/**
 * Read a remote image that was explicitly warmed during this page lifetime.
 * This is synchronous on purpose: canvas cards must not wait on IndexedDB or
 * start a network request while React is rendering. The function only looks
 * in the bounded in-memory remote cache; local uploads use readCachedImage.
 */
export function getCachedRemoteImage(source: string): string | null {
  if (!isRemoteImage(source)) return null;
  ensureRemoteCacheScope();
  const identity = immutableImageUrlIdentity(source) || source;
  const localImage = remoteCacheResults.get(identity);
  if (!localImage) return null;
  const image = memoryImage(localImage);
  if (!image) remoteCacheResults.delete(identity);
  return image;
}

/**
 * Persist inline assets before the caller removes `image`/`videoPoster` for platform storage.
 * Never mutates the input or removes an image. A failed write rejects the whole operation,
 * so the caller can keep the document unsaved and offer an export instead of losing assets.
 */
export async function storeInlineImages<T extends ImageDocument>(
  document: T,
): Promise<T> {
  const check = captureLocalStorageScope();
  const copy = copyDocument(document);
  const inlineNodes = imageReferences(copy).filter((node) =>
    isInlineImage(node.image),
  );
  // Video posters are display assets, not image inputs or submission references.
  const inlineVideoNodes = copy.nodes.filter((node) =>
    isInlineImage(node.videoPoster),
  );
  if (!inlineNodes.length && !inlineVideoNodes.length) return copy;
  let database: IDBDatabase | undefined;
  try {
    const images = new Map<string, string>();
    // Share hashes for repeated images within this save without retaining large data URLs globally.
    const keys = new Map<string, Promise<string>>();
    const cacheImage = async (image: string): Promise<string> => {
      let pendingKey = keys.get(image);
      if (!pendingKey) {
        pendingKey = imageKey(image);
        keys.set(image, pendingKey);
      }
      const key = await pendingKey;
      // Inline data URLs are the only browser-local originals. Keep an explicit
      // per-image guard so a pasted/uncompressed bitmap cannot exhaust storage.
      if (inlineImageBytes(image) > MAX_LOCAL_IMAGE_BYTES) {
        throw new Error("单张本机图片不能超过 32 MB，请缩小图片后重试。");
      }
      images.set(key, image);
      return key;
    };
    await Promise.all([
      ...inlineNodes.map(async (node) => {
        node.localImage = await cacheImage(node.image!);
      }),
      ...inlineVideoNodes.map(async (node) => {
        node.localVideoPoster = await cacheImage(node.videoPoster!);
      }),
    ]);
    const incomingBytes = [...images.values()].reduce((total, image) => total + inlineImageBytes(image), 0);
    if (incomingBytes > MAX_LOCAL_IMAGE_STORE_BYTES) {
      throw new Error("本次保存的本机素材超过 256 MB，请导出备份或将素材上传为平台资产。");
    }
    check();
    await withBrowserStorage(
      async () => {
        database = await openDatabase();
        await writeImages(database, images);
      },
      () => {
        let bytes = 0;
        for (const image of sessionImages().values()) bytes += inlineImageBytes(image);
        for (const [key, image] of images) {
          if (!sessionImages().has(key)) bytes += inlineImageBytes(image);
        }
        if (bytes > MAX_LOCAL_IMAGE_STORE_BYTES) {
          throw new Error("本机素材总量超过 256 MB，请先导出备份或释放本机素材空间。");
        }
        for (const [key, image] of images) sessionImages().set(key, image);
      },
    );
    check();
    return copy;
  } catch (error) {
    throw new Error(`图片未能保存到本机素材库：${error instanceof Error ? error.message : "请导出画布备份后重试。"}`, {
      cause: error,
    });
  } finally {
    database?.close();
  }
}

function readValues(
  database: IDBDatabase,
  keys: Set<string>,
): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const images = new Map<string, string>();
    transaction.oncomplete = () => resolve(images);
    transaction.onabort = () =>
      reject(transaction.error || new Error("本机图片缓存读取已中止。"));
    transaction.onerror = () =>
      reject(transaction.error || new Error("本机图片缓存读取失败。"));
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (typeof request.result === "string") images.set(key, request.result);
      };
    }
  });
}

async function readCachedValues(
  keys: Set<string>,
  options: { includeRemoteMemory?: boolean } = {},
): Promise<Map<string, string>> {
  if (!keys.size) return new Map();
  // Explicit remote previews and downloads are cached only for this account
  // and page lifetime. Read these before consulting legacy IndexedDB entries,
  // since remote cache keys are intentionally never persisted anymore.
  const images = new Map<string, string>();
  if (options.includeRemoteMemory !== false) {
    for (const key of keys) {
      const image = memoryImage(key);
      if (image) images.set(key, image);
    }
  }
  const missingKeys = new Set([...keys].filter((key) => !images.has(key)));
  if (!missingKeys.size) return images;
  let database: IDBDatabase | undefined;
  try {
    const stored = await withBrowserStorage(
      async () => {
        database = await openDatabase();
        return readValues(database, missingKeys);
      },
      () => {
        const session = sessionImages();
        return new Map([...missingKeys].flatMap((key) => {
          const image = session.get(key);
          return image ? [[key, image] as const] : [];
        }));
      },
    );
    for (const [key, image] of stored) images.set(key, image);
    return images;
  } finally {
    database?.close();
  }
}

/** Read a content-addressed image without changing the document source URL. */
export async function readCachedImage(localImage: string): Promise<string | null> {
  if (!IMAGE_KEY.test(localImage)) return null;
  const memory = memoryImage(localImage);
  if (memory) return memory;
  const check = captureLocalStorageScope();
  const values = await readCachedValues(new Set([localImage]));
  check();
  const image = values.get(localImage);
  return isInlineImage(image) ? image : null;
}

/** Read only short-lived, account-scoped memory cache entries for remote media. */
export async function readCachedRemoteImage(source: string): Promise<{ localImage: string; image: string } | null> {
  if (!isRemoteImage(source)) return null;
  ensureRemoteCacheScope();
  const identity = immutableImageUrlIdentity(source) || source;
  const inMemory = remoteCacheResults.get(identity);
  if (inMemory) {
    const image = memoryImage(inMemory);
    if (image) return { localImage: inMemory, image };
    remoteCacheResults.delete(identity);
  }
  return null;
}

/** Restore only explicitly referenced assets. A missing/unavailable cache leaves the document usable. */
export async function restoreLocalImages<T extends ImageDocument>(
  document: T,
): Promise<T> {
  const check = captureLocalStorageScope();
  const copy = copyDocument(document);
  // Remove localImage markers left by old versions that persisted downloaded
  // remote media. Their stable remote URL or task/asset identity is the
  // source of truth; only source-less, identity-less images are browser-local.
  for (const reference of imageReferences(copy)) {
    if (isRemoteImage(reference.image) || (!reference.image && (reference.assetId || reference.taskId)))
      delete reference.localImage;
  }
  const nodes = imageReferences(copy).filter(
    (node) =>
      !node.image &&
      !node.assetId &&
      !node.taskId &&
      typeof node.localImage === "string" &&
      IMAGE_KEY.test(node.localImage),
  );
  const videoNodes = copy.nodes.filter(
    (node) =>
      !node.videoPoster &&
      typeof node.localVideoPoster === "string" &&
      IMAGE_KEY.test(node.localVideoPoster),
  );
  if (!nodes.length && !videoNodes.length) return copy;
  try {
    const explicitKeys = new Set([
      ...nodes.map((node) => node.localImage!),
      ...videoNodes.map((node) => node.localVideoPoster!),
    ]);
    // Restore only document-local uploads and posters. Remote COS bytes are
    // runtime cache entries and must never flow into a saved document draft.
    // Local restoration must never turn a page-scoped remote byte cache entry
    // into a document-local asset. Only IndexedDB/session local uploads are
    // valid here; explicit tools read remote bytes through readCachedImage.
    const images = await readCachedValues(explicitKeys, { includeRemoteMemory: false });
    check();
    for (const node of nodes) {
      const image = images.get(node.localImage!);
      if (isInlineImage(image)) node.image = image;
    }
    for (const node of videoNodes) {
      const poster = images.get(node.localVideoPoster!);
      if (isInlineImage(poster)) node.videoPoster = poster;
    }
  } catch {
    // Local assets are optional when opening an exported/shared document on another device.
  }
  return copy;
}
