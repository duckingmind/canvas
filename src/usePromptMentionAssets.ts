import React from "react";
import { client } from "./platform-client";
import { captureDocumentStorageSession } from "./document-storage";
import { listAssets, type AssetRow, type AssetStorage } from "./asset-library";
import { listPlatformAssets, readPlatformAsset, type PlatformAssetApi, type PlatformAssetPage } from "./platform-asset-library";
import { readCachedImage } from "./image-cache";
import { taskImageResults, taskImageThumbnailResults } from "./image-recovery";

/** A lightweight candidate consumed by the creator's @ menu. */
export type PromptMentionAssetCandidate = {
  id: string;
  title: string;
  type: "image";
  source: "library" | "canvas";
  image?: string;
  imageThumbnail?: string;
  localImage?: string;
  assetCategory?: string;
  category?: string;
  assetId?: string;
  taskId?: string;
};

export type PromptMentionAssetResolved = {
  id: string;
  title: string;
  image?: string;
  imageThumbnail?: string;
  localImage?: string;
  assetId?: string;
  taskId?: string;
  resultIndex?: number;
};

export type UsePromptMentionAssetsOptions = {
  connected: boolean;
  sessionKey: number;
  /** Test/host injection; production callers use the shared application client. */
  api?: PlatformAssetApi;
  storage?: AssetStorage;
};

export type UsePromptMentionAssetsResult = {
  rows: AssetRow[];
  rowById: Map<string, AssetRow>;
  candidates: PromptMentionAssetCandidate[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  ensureLoaded: () => Promise<void>;
  load: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  resolve: (row: AssetRow) => Promise<PromptMentionAssetResolved>;
};

const messageOf = (error: unknown) => error instanceof Error ? error.message : "素材读取失败，请重试。";

// The @ picker is a compact, scrollable surface. Keep the first response
// small enough to render quickly, then let the picker request the next page
// when the user reaches the end of the list. This limit applies independently
// to platform and local storage because they use different cursors.
const MENTION_PAGE_LIMIT = 12;

function asPlatformApi(value: PlatformAssetApi | undefined): PlatformAssetApi {
  return value || client.api;
}

function asStorage(value: AssetStorage | undefined): AssetStorage {
  return value || client.storage as AssetStorage;
}

function candidateFor(row: AssetRow, platformPreviews: Map<string, { image?: string; imageThumbnail?: string }>): PromptMentionAssetCandidate | undefined {
  const asset = row.asset;
  if (asset.kind !== "image") return undefined;
  const base: PromptMentionAssetCandidate = {
    id: asset.id,
    title: asset.name,
    type: "image",
    source: "library",
    assetCategory: asset.category,
    category: asset.category,
  };
  if (asset.source.type === "platform") {
    const preview = platformPreviews.get(asset.id);
    // Keep the list thumbnail as the candidate image. The original URL is
    // intentionally resolved only after the user selects this candidate.
    return { ...base, image: preview?.imageThumbnail, imageThumbnail: preview?.imageThumbnail, assetId: asset.source.assetId, taskId: asset.source.taskId };
  }
  if (asset.source.type === "local" && asset.source.localImage) {
    const preview = platformPreviews.get(asset.id);
    return { ...base, ...(preview?.image ? { image: preview.image } : {}), localImage: asset.source.localImage };
  }
  if (asset.source.type === "task") return { ...base, taskId: asset.source.taskId };
  if (asset.source.type === "url") return base;
  return undefined;
}

/**
 * Lazily loads image assets for inline @ references. No effect performs a
 * request: callers explicitly invoke `load()` or `loadMore()` when the menu
 * is opened or when its scroll reaches the end.
 */
export function usePromptMentionAssets(options: UsePromptMentionAssetsOptions): UsePromptMentionAssetsResult {
  const api = asPlatformApi(options.api);
  const storage = asStorage(options.storage);
  const [rows, setRows] = React.useState<AssetRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [hasMore, setHasMore] = React.useState(false);
  const epoch = React.useRef(0);
  const sequence = React.useRef(0);
  const loadingRef = React.useRef(false);
  const pagination = React.useRef({ platformPage: 1, platformMore: true, localCursor: undefined as string | undefined, localMore: true, loaded: false });
  const previews = React.useRef(new Map<string, { image?: string; imageThumbnail?: string }>());
  const live = React.useRef(options);
  live.current = options;

  React.useEffect(() => {
    epoch.current += 1;
    sequence.current += 1;
    loadingRef.current = false;
    pagination.current = { platformPage: 1, platformMore: true, localCursor: undefined, localMore: true, loaded: false };
    previews.current.clear();
    setRows([]);
    setLoading(false);
    setError("");
    setHasMore(false);
    return () => { epoch.current += 1; sequence.current += 1; };
  }, [options.connected, options.sessionKey, api, storage]);

  const guard = React.useCallback(() => {
    if (!live.current.connected) throw new Error("请登录后使用引用素材。");
    const capturedEpoch = epoch.current;
    const capturedSessionKey = live.current.sessionKey;
    const checkStorage = captureDocumentStorageSession(storage);
    return () => {
      checkStorage();
      if (capturedEpoch !== epoch.current || capturedSessionKey !== live.current.sessionKey || !live.current.connected) throw new Error("登录状态已更新，请重新打开引用菜单。");
    };
  }, [storage]);

  const loadPage = React.useCallback(async (mode: "initial" | "more" | "reset") => {
    if (!live.current.connected || loadingRef.current) return;
    if (mode === "initial" && pagination.current.loaded) return;
    if (mode === "more" && (!pagination.current.loaded || (!pagination.current.platformMore && !pagination.current.localMore))) return;
    const requestSequence = ++sequence.current;
    const requestEpoch = epoch.current;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    const reset = mode === "reset";
    if (reset) {
      pagination.current = { platformPage: 1, platformMore: true, localCursor: undefined, localMore: true, loaded: false };
      previews.current.clear();
      setRows([]);
    }
    const page = pagination.current;
    try {
      const check = guard();
      const limit = MENTION_PAGE_LIMIT;
      // Reuse the platform library's validation, filtering and DTO mapping,
      // while observing its single paged response to retain the server-signed
      // thumbnails. This does not issue per-row detail requests.
      const pagePreviews = new Map<string, { image?: string; imageThumbnail?: string }>();
      const observingApi: PlatformAssetApi = {
        request: async <T,>(path: string, requestOptions?: RequestInit) => {
          const result = await api.request<unknown>(path, requestOptions);
          if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).items)) {
            for (const stored of (result as { items: Array<Record<string, unknown>> }).items) {
              if (typeof stored.id === "string" && (typeof stored.url === "string" || typeof stored.thumbnail_url === "string")) {
                pagePreviews.set(`media:${stored.id}`, {
                  ...(typeof stored.url === "string" ? { image: stored.url } : {}),
                  ...(typeof stored.thumbnail_url === "string" ? { imageThumbnail: stored.thumbnail_url } : {}),
                });
              }
            }
          }
          return result as T;
        },
      };
      const [platformResult, localResult] = await Promise.allSettled([
        page.platformMore
          ? listPlatformAssets(observingApi, { kind: "image", page: page.platformPage, limit })
          : Promise.resolve<PlatformAssetPage | null>(null),
        page.localMore
          ? listAssets(storage, { cursor: page.localCursor, limit })
          : Promise.resolve<Awaited<ReturnType<typeof listAssets>> | null>(null),
      ]);
      check();
      if (requestSequence !== sequence.current || requestEpoch !== epoch.current) return;
      const nextRows: AssetRow[] = [];
      const platform = platformResult.status === "fulfilled" ? platformResult.value : null;
      const local = localResult.status === "fulfilled" ? localResult.value : null;
      if (platform) {
        nextRows.push(...platform.items.filter(item => item.asset.kind === "image"));
        for (const [id, preview] of pagePreviews) previews.current.set(id, preview);
      }
      if (local) {
        const localImageRows = local.items.filter(item => item.asset.kind === "image");
        // KV rows hold content-addressed local keys rather than URLs. Reading
        // these browser-local previews is bounded to the current page and
        // never downloads remote media or calls one detail endpoint per row.
        const localPreviews = await Promise.allSettled(localImageRows.map(async row => {
          if (row.asset.source.type !== "local" || !row.asset.source.localImage) return [row.asset.id, undefined] as const;
          const image = await readCachedImage(row.asset.source.localImage);
          return [row.asset.id, image || undefined] as const;
        }));
        check();
        for (const result of localPreviews) {
          if (result.status === "fulfilled" && result.value[1]) previews.current.set(result.value[0], { image: result.value[1] });
        }
        nextRows.push(...localImageRows);
      }
      const merge = (old: AssetRow[], incoming: AssetRow[]) => [...new Map([...old, ...incoming].map(item => [item.asset.id, item])).values()];
      setRows(old => merge(reset ? [] : old, nextRows));
      pagination.current = {
        platformPage: platform ? page.platformPage + 1 : page.platformPage,
        platformMore: platform ? platform.hasMore : page.platformMore,
        localCursor: local?.nextCursor,
        localMore: local ? Boolean(local.nextCursor) : page.localMore,
        loaded: true,
      };
      setHasMore(pagination.current.platformMore || pagination.current.localMore);
      const failures = [platformResult, localResult].flatMap(result => result.status === "rejected" ? [messageOf(result.reason)] : []);
      if (local?.skipped) failures.push(`${local.skipped} 项本地素材格式无效，未显示。`);
      if (failures.length) setError(failures.join("；"));
    } catch (failure) {
      if (requestSequence === sequence.current && requestEpoch === epoch.current) setError(messageOf(failure));
    } finally {
      if (requestSequence === sequence.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [api, guard, storage]);

  const load = React.useCallback((reset = false) => loadPage(reset ? "reset" : "initial"), [loadPage]);
  const loadMore = React.useCallback(() => loadPage("more"), [loadPage]);

  const rowById = React.useMemo(() => new Map(rows.map(row => [row.asset.id, row])), [rows]);
  const candidates = React.useMemo(() => rows.flatMap(row => {
    const candidate = candidateFor(row, previews.current);
    // Platform list responses without a thumbnail and local rows without a
    // loaded preview remain selectable: the picker renders its neutral
    // placeholder. Platform previews never trigger N detail requests.
    return candidate ? [candidate] : [];
  }), [rows]);

  const resolve = React.useCallback(async (row: AssetRow): Promise<PromptMentionAssetResolved> => {
    const check = guard();
    if (row.asset.kind !== "image") throw new Error("此素材不能作为图片引用。");
    const source = row.asset.source;
    if (source.type === "platform") {
      const delivered = await readPlatformAsset(api, source.assetId);
      check();
      if (!delivered.url) throw new Error("素材原图暂不可用，请稍后重试。");
      return {
        id: row.asset.id,
        title: row.asset.name,
        image: delivered.url,
        imageThumbnail: delivered.thumbnailUrl,
        assetId: source.assetId,
        taskId: source.taskId,
        ...(source.resultIndex !== undefined ? { resultIndex: source.resultIndex } : {}),
      };
    }
    if (source.type === "local" && source.localImage) {
      const image = await readCachedImage(source.localImage);
      check();
      if (!image) throw new Error("本机图片已丢失，请重新上传后引用。");
      return { id: row.asset.id, title: row.asset.name, image, localImage: source.localImage };
    }
    if (source.type === "task") {
      const response = await api.request(`/images/tasks/${encodeURIComponent(source.taskId)}`);
      const index = source.resultIndex || 0;
      const image = taskImageResults(response)[index];
      const imageThumbnail = taskImageThumbnailResults(response)[index];
      check();
      if (!image) throw new Error("任务原图暂不可用，请稍后重试。");
      return { id: row.asset.id, title: row.asset.name, image, imageThumbnail, taskId: source.taskId, resultIndex: index };
    }
    if (source.type === "url") return { id: row.asset.id, title: row.asset.name, image: source.url };
    throw new Error("文本素材不能作为图片引用。");
  }, [api, guard]);

  const ensureLoaded = React.useCallback(() => loadPage("initial"), [loadPage]);
  return { rows, rowById, candidates, loading, error, hasMore, ensureLoaded, load, loadMore, resolve };
}

export default usePromptMentionAssets;
