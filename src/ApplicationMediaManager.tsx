import React from "react";
import { Film, Image, LoaderCircle, Music2, RefreshCw, Trash2 } from "lucide-react";
import { client } from "./platform-client";
import { deletePlatformAsset } from "./platform-asset-library";
import type { StoredAsset } from "./canvas-types";

const PAGE_SIZE = 16;
const mediaLabels: Record<string, string> = { image: "图片", video: "视频", audio: "音频" };

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isAssetPage(value: unknown): value is { items: StoredAsset[]; total: number; page: number; limit: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Partial<{ items: StoredAsset[]; total: number; page: number; limit: number }>;
  return Array.isArray(page.items)
    && Number.isSafeInteger(page.total) && Number(page.total) >= 0
    && Number.isSafeInteger(page.page) && Number(page.page) > 0
    && Number.isSafeInteger(page.limit) && Number(page.limit) > 0
    && page.items.every(asset => asset && typeof asset.id === "string" && asset.id.length > 0
      && typeof asset.type === "string" && Number.isFinite(asset.size_bytes) && asset.size_bytes >= 0);
}

function MediaKindIcon({ type }: { type: string }) {
  const Icon = type === "video" ? Film : type === "audio" ? Music2 : Image;
  return <Icon size={14} aria-hidden="true" />;
}

export default function ApplicationMediaManager({
  connected,
  onUsageRefresh,
  onNotice,
}: {
  connected: boolean;
  onUsageRefresh: () => Promise<unknown>;
  onNotice: (text: string, action?: { label: string; run: () => void }) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [assets, setAssets] = React.useState<StoredAsset[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState("");
  const [confirmId, setConfirmId] = React.useState("");
  const [deletingId, setDeletingId] = React.useState("");
  const pageRef = React.useRef(1);
  const sequence = React.useRef(0);
  const loadingRef = React.useRef(false);
  const lastNotifiedError = React.useRef("");

  const load = React.useCallback(async (reset = false) => {
    if (!connected || (loadingRef.current && !reset)) return false;
    if (loadingRef.current && reset) sequence.current += 1;
    loadingRef.current = true;
    const current = ++sequence.current;
    const requestedPage = reset ? 1 : pageRef.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(requestedPage), limit: String(PAGE_SIZE) });
      const response: unknown = await client.api.request(`/media/assets?${query}`);
      if (!isAssetPage(response)) throw new Error("媒体列表返回的数据无效，请刷新后重试。");
      if (current !== sequence.current) return;
      setAssets(previous => reset
        ? response.items
        : [...new Map([...previous, ...response.items].map(asset => [asset.id, asset])).values()]);
      pageRef.current = response.page + 1;
      setHasMore(response.page * response.limit < response.total);
      return true;
    } catch (cause) {
      if (current === sequence.current) setError(cause instanceof Error ? cause.message : "媒体列表暂时无法读取，请重试。");
      return false;
    } finally {
      if (current === sequence.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [connected]);

  React.useEffect(() => {
    if (expanded && connected) void load(true);
  }, [expanded, connected, load]);

  React.useEffect(() => {
    if (!error) {
      lastNotifiedError.current = "";
      return;
    }
    if (error === lastNotifiedError.current) return;
    lastNotifiedError.current = error;
    onNotice(error, { label: "重试", run: () => void load(true) });
  }, [error, load, onNotice]);

  React.useEffect(() => {
    if (connected) return;
    sequence.current += 1;
    loadingRef.current = false;
    pageRef.current = 1;
    setAssets([]);
    setHasMore(false);
    setLoading(false);
    setError("");
    setConfirmId("");
    setDeletingId("");
  }, [connected]);

  React.useEffect(() => () => {
    sequence.current += 1;
    loadingRef.current = false;
  }, []);

  const deleteAsset = async (asset: StoredAsset) => {
    if (!connected || deletingId || confirmId !== asset.id) return;
    setDeletingId(asset.id);
    setError("");
    try {
      await deletePlatformAsset(client.api, asset.id);
      setAssets(previous => previous.filter(item => item.id !== asset.id));
      setConfirmId("");
      const [listUpdated, usageUpdated] = await Promise.all([
        load(true),
        Promise.resolve().then(onUsageRefresh).then(Boolean, () => false),
      ]);
      const name = asset.name?.trim() || mediaLabels[asset.type] || "媒体";
      if (listUpdated) onNotice(`${name}已删除。${usageUpdated ? "媒体空间用量已更新。" : "媒体空间用量暂未更新，请刷新后重试。"}`, usageUpdated ? undefined : { label: "刷新用量", run: () => void onUsageRefresh() });
      if (!listUpdated) setError(current => current || "媒体已删除，但列表暂未刷新，请重试。");
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "删除媒体失败，请刷新后重试。", { label: "重试删除", run: () => void deleteAsset(asset) });
    } finally {
      setDeletingId("");
    }
  };

  return <div className="storage-manager" data-canvas-management>
    <button
      className="text-button storage-manager-toggle"
      type="button"
      aria-expanded={expanded}
      disabled={!connected}
      onClick={() => { setExpanded(value => !value); setError(""); }}
    >
      {expanded ? "收起 Canvas 媒体" : "管理 Canvas 生成媒体"}
    </button>
    {expanded && <div className="storage-manager-panel" aria-busy={loading || undefined}>
      <p className="storage-manager-help">
		会员期间创建的媒体长期保留；普通媒体会按到期日清理。收录到资产库不会延长保留期限。删除会移除媒体并释放空间，引用它的画布也将无法再使用；此操作无法撤销。此处仅管理 Canvas 媒体，其他应用的媒体请在对应应用中清理。
      </p>
      {assets.length > 0 && <div className="storage-manager-list" aria-label="Canvas 生成媒体">
        {assets.map(asset => {
          const name = asset.name?.trim() || `未命名${mediaLabels[asset.type] || "媒体"}`;
          return <div className="storage-manager-item" key={asset.id}>
            <span className="storage-manager-kind"><MediaKindIcon type={asset.type} /></span>
            <span className="storage-manager-item-info">
              <strong title={name}>{name}</strong>
              <span>{mediaLabels[asset.type] || "媒体"} · {formatBytes(asset.size_bytes)} · {asset.expires_at ? `保留至 ${new Date(asset.expires_at).toLocaleDateString()}` : "长期保留"}</span>
            </span>
            {confirmId === asset.id ? (
              <span className="storage-manager-confirm">
                <button type="button" disabled={Boolean(deletingId)} onClick={() => setConfirmId("")}>取消</button>
                <button type="button" className="is-danger" disabled={Boolean(deletingId)} onClick={() => void deleteAsset(asset)}>
                  {deletingId === asset.id ? <LoaderCircle size={13} className="spin" /> : null}确认删除
                </button>
              </span>
            ) : <button
              type="button"
              className="storage-manager-delete"
              disabled={Boolean(deletingId)}
              aria-label={`删除 ${name} 并释放空间`}
              title="删除媒体并释放空间"
              onClick={() => setConfirmId(asset.id)}
            ><Trash2 size={14} /></button>}
          </div>;
        })}
      </div>}
      {!assets.length && !loading && !error && <p className="storage-manager-empty">Canvas 暂无已生成媒体；共享空间也可能被其他应用占用。</p>}
      {loading && <p className="storage-manager-loading" role="status"><LoaderCircle size={14} className="spin" />{assets.length ? "正在更新列表…" : "正在加载媒体…"}</p>}
      {hasMore && <button className="storage-manager-more" type="button" disabled={loading || Boolean(deletingId)} onClick={() => void load()}>
        {loading ? "正在加载…" : "加载更多媒体"}
      </button>}
      <button className="storage-manager-refresh" type="button" disabled={loading || Boolean(deletingId)} onClick={() => { setError(""); void load(true); }}>
        <RefreshCw size={12} className={loading ? "spin" : ""} />刷新媒体列表
      </button>
    </div>}
  </div>;
}
