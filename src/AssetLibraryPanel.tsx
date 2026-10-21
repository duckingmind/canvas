import React from "react";
import { ArrowLeft, FileText, Film, Folder, Image, Library, LoaderCircle, Music2, Pencil, Plus, RefreshCw, Search, Tag, Trash2, X } from "lucide-react";
import { categoryLabels, filterAssets, kindLabels, type AssetCategory, type AssetFilters, type AssetKind, type AssetRow, type CanvasAsset } from "./asset-library";
import CanvasMediaPlayer from "./CanvasMediaPlayer";
import "./asset-library.css";

export type AssetPreview = {
  urlExpiresAt?: string;
  url?: string;
  thumbnailUrl?: string;
  poster?: string;
  /** Release an object URL created specifically for this preview. */
  release?: () => void;
  availability: "ready" | "local-missing" | "unavailable";
  message?: string;
};

export type AssetLibraryPanelProps = {
  rows: AssetRow[];
  loading: boolean;
  error?: string;
  busyId?: string;
  hasMore?: boolean;
  knownTags?: string[];
  knownFolders?: string[];
  onFiltersChange?: (filters: AssetFilters) => void;
  onLoadMore?: () => void;
  onRefresh: () => void;
  onNotice?: (text: string, action?: { label: string; run: () => void }) => void;
  onInsert: (row: AssetRow) => void;
  onEdit: (row: AssetRow) => void;
  onSave?: (row: AssetRow) => void;
  onRemove: (row: AssetRow) => void;
  resolvePreview: (asset: CanvasAsset) => Promise<AssetPreview>;
  onBackToCreator?: () => void;
  /** A creator can open the library specifically to choose a Cover source. */
  audioReferenceSelection?: boolean;
};

export function AssetKindIcon({ kind, size = 22 }: { kind: AssetKind; size?: number }) {
  const Icon = kind === "video" ? Film : kind === "audio" ? Music2 : kind === "prompt" ? FileText : Image;
  return <Icon size={size} aria-hidden="true" />;
}

function AssetCard({ row, busy, onInsert, onEdit, onSave, onRemove, resolvePreview, audioReferenceSelection }: {
  row: AssetRow;
  busy: boolean;
  onInsert: () => void;
  onEdit: () => void;
  onSave?: () => void;
  onRemove: () => void;
  resolvePreview: AssetLibraryPanelProps["resolvePreview"];
  audioReferenceSelection?: boolean;
}) {
  const { asset } = row;
  const card = React.useRef<HTMLElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [preview, setPreview] = React.useState<AssetPreview | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!card.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    let active = true;
    let resolvedPreview: AssetPreview | undefined;
    setPreview(null);
    setFailed(false);
    if (asset.kind === "prompt") {
      setPreview({ availability: "ready" });
      return;
    }
    void resolvePreview(asset).then((value) => {
      if (active) { resolvedPreview = value; setPreview(value); }
      else value.release?.();
    }).catch(() => {
      if (active) setPreview({ availability: "unavailable", message: "暂时无法打开此素材" });
    });
    return () => { active = false; resolvedPreview?.release?.(); };
  }, [asset, resolvePreview, visible, attempt]);

  const missing = preview?.availability === "local-missing";
  const unavailable = preview?.availability === "unavailable";
  // Platform images are backed by COS. Their canonical URL is for opening or
  // downloading only; cards must wait for the independently signed thumbnail
  // instead of silently downloading the full object when an older response
  // has not been refreshed yet.
  const image = asset.kind === "image"
    ? (preview?.thumbnailUrl || (asset.source.type === "platform" ? undefined : preview?.url))
    : asset.kind === "video" ? preview?.poster : undefined;
  const text = asset.source.type === "text" ? asset.source.text : asset.prompt;
  const ready = preview?.availability === "ready";
  const savedToLibrary = row.savedToLibrary !== false;
  const handleMembershipAction = () => {
    if (!savedToLibrary) setConfirmRemove(false);
    (savedToLibrary ? onRemove : onSave)?.();
  };

  return <article ref={card} className="asset-library-card" aria-labelledby={titleId} aria-busy={busy || undefined}>
    <div className={`asset-library-cover is-${asset.kind}`}>
      {image && !failed ? <img src={image} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
        : asset.kind === "prompt" ? <p className="asset-library-prompt">{text || asset.name}</p>
          : <AssetKindIcon kind={asset.kind} size={26} />}
      <span className="asset-library-kind"><AssetKindIcon kind={asset.kind} size={12} />{kindLabels[asset.kind]}</span>
      {!preview && visible && <span className="asset-library-cover-loading" aria-label="正在加载预览"><LoaderCircle size={17} className="spin" /></span>}
    </div>
    <div className="asset-library-card-info">
      <h3 id={titleId} title={asset.name}>{asset.name}</h3>
      <p className="asset-library-card-category">{asset.category === "person" ? "角色" : categoryLabels[asset.category]}{asset.source.type === "local" && <span> · 本机文件</span>}</p>
      <p className="asset-library-card-folder" title={asset.folder || "默认文件夹"}><Folder size={11} />{asset.folder || "默认文件夹"}</p>
      {!!asset.tags.length && <p className="asset-library-tags" title={asset.tags.join("、")}>{asset.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}{asset.tags.length > 3 && <span>+{asset.tags.length - 3}</span>}</p>}
      {asset.kind === "audio" && ready && preview.url && !failed && <div className="asset-library-audio-preview"><CanvasMediaPlayer kind="audio" src={preview.url} label={`试听 ${asset.name}`} preload="none" onError={() => setFailed(true)} /></div>}
      {(missing || unavailable || failed) && <div className="asset-library-availability">
        <p>{missing ? "此素材保存在原设备，请在原设备打开" : unavailable ? preview?.message || "素材暂不可用" : "预览暂不可用"}</p>
        <button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={12} />重新加载</button>
      </div>}
    </div>
    {confirmRemove ? <div className="asset-library-remove-confirm">
      <p>{savedToLibrary ? "从资产库移除？原始媒体和已添加到画布的内容都会保留。" : "保存到资产库？保存后可在其他 Canvas 画布中继续使用。"}</p>
      <div><button type="button" disabled={busy} onClick={() => setConfirmRemove(false)}>取消</button><button type="button" className={savedToLibrary ? "asset-library-danger" : "asset-library-insert"} disabled={busy || (!savedToLibrary && !onSave)} onClick={handleMembershipAction}>{busy ? (savedToLibrary ? "正在移除…" : "正在保存…") : savedToLibrary ? "移除" : "保存"}</button></div>
    </div> : <div className="asset-library-card-actions">
      <button type="button" className="asset-library-insert" disabled={busy || !ready} aria-label={audioReferenceSelection ? `选择 ${asset.name} 作为参考音频` : `添加 ${asset.name} 到画布`} onClick={onInsert}>{busy ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />}{audioReferenceSelection ? "用作参考音频" : "添加到画布"}</button>
      <button type="button" className="asset-library-icon-button" disabled={busy} title="编辑资产信息" aria-label={`编辑 ${asset.name} 的信息`} onClick={onEdit}><Pencil size={14} /></button>
      <button type="button" className="asset-library-icon-button" disabled={busy} title={savedToLibrary ? "从资产库移除" : "保存为资产"} aria-label={`${savedToLibrary ? "从资产库移除" : "保存为资产"} ${asset.name}`} onClick={() => setConfirmRemove(true)}>{savedToLibrary ? <Trash2 size={14} /> : <Library size={14} />}</button>
    </div>}
  </article>;
}

export default function AssetLibraryPanel({ rows, loading, error, busyId, hasMore, knownTags, knownFolders, onFiltersChange, onLoadMore, onRefresh, onNotice, onInsert, onEdit, onSave, onRemove, resolvePreview, onBackToCreator, audioReferenceSelection }: AssetLibraryPanelProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = React.useRef<HTMLDivElement>(null);
  const onLoadMoreRef = React.useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const [query, setQuery] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [kind, setKind] = React.useState<AssetKind | "all">("all");
  const [category, setCategory] = React.useState<AssetCategory | "all">("all");
  const [tag, setTag] = React.useState("");
  const [folder, setFolder] = React.useState<string | undefined>();
  const filters = React.useMemo<AssetFilters>(() => ({
    query: search,
    kind: audioReferenceSelection ? "audio" : kind === "all" ? undefined : kind,
    category: category === "all" ? undefined : category,
    tag: tag || undefined,
    folder,
  }), [search, kind, category, tag, folder, audioReferenceSelection]);
  const onFiltersChangeRef = React.useRef(onFiltersChange);
  onFiltersChangeRef.current = onFiltersChange;
  const externalFiltering = Boolean(onFiltersChange);
  React.useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);
  React.useEffect(() => { onFiltersChangeRef.current?.(filters); }, [filters, externalFiltering]);
  // The platform page is filtered on the server, while local KV rows are
  // already loaded in the browser. Apply the same predicate to the merged
  // page so a search or folder/tag filter never leaks unrelated local rows.
  const filtered = React.useMemo(() => filterAssets(rows, filters), [rows, filters]);
  // Keep discovered options when a server-side filter narrows the current page.
  const [discoveredTags, setDiscoveredTags] = React.useState<string[]>([]);
  const [discoveredFolders, setDiscoveredFolders] = React.useState<string[]>([]);
  React.useEffect(() => {
    setDiscoveredTags(previous => [...new Set([...previous, ...(knownTags ?? []), ...rows.flatMap(row => row.asset.tags)])].sort());
    setDiscoveredFolders(previous => [...new Set([...previous, ...(knownFolders ?? []), ...rows.map(row => row.asset.folder || "")])].sort());
  }, [rows, knownTags, knownFolders]);
  const hasFilters = Boolean(query.trim() || kind !== "all" || category !== "all" || tag || folder !== undefined);
  const clearFilters = () => { setQuery(""); setSearch(""); setKind("all"); setCategory("all"); setTag(""); setFolder(undefined); };
  const lastNotifiedError = React.useRef("");
  React.useEffect(() => {
    if (!error) {
      lastNotifiedError.current = "";
      return;
    }
    if (!onNotice || error === lastNotifiedError.current) return;
    lastNotifiedError.current = error;
    onNotice(error, { label: "重试", run: onRefresh });
  }, [error, onNotice, onRefresh]);

  // Fetch the next page as the user reaches the end of the scroll container.
  // Keep the button below as an accessible fallback for browsers without
  // IntersectionObserver and for keyboard users who prefer an explicit action.
  React.useEffect(() => {
    const root = scrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || !hasMore || loading || error || !onLoadMoreRef.current || typeof IntersectionObserver === "undefined") return;
    let requested = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || requested) return;
      requested = true;
      onLoadMoreRef.current?.();
    }, { root, rootMargin: "240px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, error]);

  return <section className="asset-library" data-canvas-management aria-label="Canvas 资产库" aria-busy={loading || undefined}>
    <div className="asset-library-heading">
      <span><Library size={16} />{audioReferenceSelection ? "选择参考音频" : "Canvas 资产"}</span>
      <span className="asset-library-heading-actions">
        <span className="asset-library-scope">当前应用</span>
        {onBackToCreator && <button type="button" className="asset-library-back" onClick={onBackToCreator}><ArrowLeft size={13} />返回创作</button>}
      </span>
    </div>
    <div className="asset-library-toolbar">
      <label className="asset-library-search"><Search size={15} aria-hidden="true" /><input aria-label="搜索资产库" placeholder="搜索名称、标签或文件夹" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="清空资产搜索" onClick={() => { setQuery(""); setSearch(""); }}><X size={14} /></button>}</label>
      <button type="button" className="asset-library-icon-button" aria-label="刷新资产库" title="刷新资产库" disabled={loading} onClick={onRefresh}><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
    </div>
    {!audioReferenceSelection && <div className="asset-library-kind-filters" role="group" aria-label="素材类型">
      <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>全部</button>
      {(Object.keys(kindLabels) as AssetKind[]).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{kindLabels[value]}</button>)}
    </div>}
    <div className="asset-library-category-filters" role="group" aria-label="素材分类">
      <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>全部分类</button>
      {(Object.keys(categoryLabels) as AssetCategory[]).map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value === "person" ? "角色" : categoryLabels[value]}</button>)}
    </div>
    <div className="asset-library-organize-filters">
      <label><Folder size={13} /><select aria-label="按文件夹筛选资产" value={folder === undefined ? "" : `folder:${folder}`} onChange={event => setFolder(event.target.value === "" ? undefined : event.target.value.slice(7))}><option value="">全部文件夹</option>{[...new Set(["", ...discoveredFolders])].map(value => <option key={value} value={`folder:${value}`}>{value || "默认文件夹"}</option>)}</select></label>
      <label><Tag size={13} /><select aria-label="按标签筛选资产" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{discoveredTags.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      {hasFilters && <button type="button" className="asset-library-clear" onClick={clearFilters}>重置</button>}
    </div>
    <div ref={scrollRef} className="asset-library-scroll">
      {filtered.length > 0 ? <div className="asset-library-grid">{filtered.map(row => <AssetCard key={row.asset.id} row={row} busy={busyId === row.asset.id} onInsert={() => onInsert(row)} onEdit={() => onEdit(row)} onSave={onSave ? () => onSave(row) : undefined} onRemove={() => onRemove(row)} resolvePreview={resolvePreview} audioReferenceSelection={audioReferenceSelection} />)}</div>
        : loading ? <div className="asset-library-empty" role="status"><LoaderCircle size={24} className="spin" /><p>正在加载资产…</p></div>
          : <div className="asset-library-empty"><Library size={26} aria-hidden="true" /><strong>{hasFilters ? "没有找到符合条件的资产" : "还没有云端媒体资产"}</strong><p>{hasFilters ? hasMore ? "可继续加载更多资产，或调整筛选条件。" : "试试其他名称、标签或文件夹。" : "生成完成的图片、视频和音频会先出现在这里；保存为资产后，可在其他 Canvas 画布中长期使用。"}</p>{hasFilters && <button type="button" onClick={clearFilters}>清除筛选</button>}</div>}
      {hasMore && onLoadMore && <>
        <div ref={loadMoreSentinelRef} className="asset-library-load-sentinel" aria-hidden="true" />
        <button type="button" className="asset-library-load-more" disabled={loading} onClick={onLoadMore}>{loading ? <><LoaderCircle size={14} className="spin" />正在加载…</> : "加载更多资产"}</button>
      </>}
    </div>
    <div className="asset-library-foot" aria-live="polite">{externalFiltering ? `${hasMore ? "已加载 " : ""}${rows.length} 项${hasFilters ? "符合筛选的" : ""}资产` : hasMore ? `已加载 ${rows.length} 项${hasFilters ? ` · 符合筛选 ${filtered.length} 项` : ""}` : hasFilters ? `${filtered.length} / ${rows.length} 项资产` : `${rows.length} 项资产`}{!externalFiltering && hasMore && hasFilters && <span>筛选当前已加载资产</span>}</div>
  </section>;
}
