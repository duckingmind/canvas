import React from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpDown,
  Clock3,
  MoreHorizontal,
  PanelLeftClose,
  Copy,
  FolderOpen,
  Layers,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { CanvasSummary } from "./library-store";
import type { CloudLibraryStatusEntry } from "./cloud-library-status";
import "./library.css";

export type CanvasLibraryProps = {
  items: CanvasSummary[];
  cloudStatuses?: Record<string, CloudLibraryStatusEntry>;
  activeId: string | null;
  onClose: () => void;
  loading: boolean;
  busy: boolean;
  discovering: boolean;
  discoveryError: string;
  error: string;
  notice: string;
  /** Surface transient library failures through the workbench toast. */
  onNotice?: (text: string, action?: { label: string; run: () => void }) => void;
  onRetry: () => void;
  onCreate: (name: string) => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
};

type NameDialog = { kind: "create" } | { kind: "rename"; item: CanvasSummary };

function dateLabel(value: string, suffix: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    return suffix === "移入回收站" ? "已移入回收站" : suffix === "创建" ? "创建时间未知" : "尚未编辑";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 60_000),
  );
  if (minutes < 1) return `刚刚${suffix}`;
  if (minutes < 60) return `${minutes} 分钟前${suffix}`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前${suffix}`;
  return `${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })}${suffix}`;
}

function cloudStatusLabel(status?: CloudLibraryStatusEntry) {
  switch (status?.state) {
    case "local-only":
      return "仅本机";
    case "local-newer":
      return "待同步";
    case "cloud-newer":
      return "云端有新版本";
    case "cloud-deleted":
      return "云端已删除";
    case "local-deleted":
      return "仅本机回收站";
    case "conflict":
      return "版本冲突";
    default:
      return "";
  }
}

function Cover({ item }: { item: CanvasSummary }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [item.cover]);
  return (
    <span
      className={`library-cover ${item.cover && !failed ? "library-cover-has-image" : ""}`}
    >
      {item.cover && !failed ? (
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : item.previewText?.trim() ? (
        <span className="library-cover-note" aria-hidden="true">
          <span>{item.previewText}</span>
        </span>
      ) : (
        <span className="library-cover-fallback" aria-hidden="true">
          <span className="library-cover-symbol">
            <Layers size={20} />
          </span>
          <span>空白画布</span>
        </span>
      )}
    </span>
  );
}

function CanvasNameDialog({
  dialog,
  busy,
  operationError,
  onClose,
  onSubmit,
}: {
  dialog: NameDialog;
  busy: boolean;
  operationError: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = React.useState(
    dialog.kind === "rename" ? dialog.item.name : "",
  );
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const observedBusy = React.useRef(false);
  const errorBeforeSubmit = React.useRef("");
  const container = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  const inputId = React.useId();
  const helpId = React.useId();
  const canSubmit = name.trim().length > 0 && !busy && !pending;

  React.useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    input.current?.focus();
    input.current?.select();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  React.useEffect(() => {
    if (!pending) return;
    if (busy) {
      observedBusy.current = true;
      return;
    }
    if (
      operationError &&
      (observedBusy.current || operationError !== errorBeforeSubmit.current)
    ) {
      // The parent workbench surfaces operation failures through its toast.
      // Keep the naming dialog focused without duplicating that message in
      // the form body.
      setError("");
      setPending(false);
      input.current?.focus();
    } else if (observedBusy.current) {
      setPending(false);
      onClose();
    }
  }, [busy, operationError, pending, onClose]);

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy && !pending) onClose();
    }
    if (event.key !== "Tab") return;
    const elements = container.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
    );
    if (!elements?.length) return;
    const first = elements[0],
      last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="library-dialog-backdrop"
      data-canvas-management
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy && !pending) onClose();
      }}
    >
      <div
        className="library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        aria-busy={busy || pending}
        ref={container}
        onKeyDown={handleKey}
      >
        <div className="library-dialog-head">
          <h2 id={titleId}>
            {dialog.kind === "create" ? "新建画布" : "重命名画布"}
          </h2>
          <button
            type="button"
            className="library-icon-button"
            aria-label="关闭对话框"
            onClick={onClose}
            disabled={busy || pending}
          >
            <X size={19} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || pending) return;
            const value = name.trim();
            if (!value) {
              setError("请填写画布名称");
              input.current?.focus();
              return;
            }
            setError("");
            observedBusy.current = false;
            errorBeforeSubmit.current = operationError;
            setPending(true);
            try {
              onSubmit(value);
            } catch (failure) {
              setPending(false);
              setError(
                failure instanceof Error
                  ? failure.message
                  : "操作未完成，请重试",
              );
            }
          }}
        >
          <label className="library-name-label" htmlFor={inputId}>
            画布名称
          </label>
          <input
            id={inputId}
            ref={input}
            className="library-name-input"
            value={name}
            maxLength={160}
            autoComplete="off"
            readOnly={pending || busy}
            placeholder="例如：城市海报灵感"
            aria-describedby={helpId}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
          />
          <p
            id={helpId}
            className={error ? "library-form-error" : "library-form-help"}
            role={error ? "alert" : undefined}
          >
            {error ||
              (dialog.kind === "create"
                ? "从一张空白画布开始，随时添加文字、图片和提示词。"
                : "一个好找的名字，方便下次继续创作。")}
          </p>
          <div className="library-dialog-actions">
            <button
              type="button"
              className="library-button library-button-secondary"
              onClick={onClose}
              disabled={busy || pending}
            >
              取消
            </button>
            <button
              type="submit"
              className="library-button library-button-primary"
              disabled={!canSubmit}
            >
              {(busy || pending) && (
                <LoaderCircle size={16} className="library-spin" />
              )}
              {pending
                ? "正在保存…"
                : dialog.kind === "create"
                  ? "创建画布"
                  : "保存名称"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CanvasActions({
  item,
  anchor,
  disabled,
  onClose,
  onRename,
  onDuplicate,
  onTrash,
}: {
  item: CanvasSummary;
  anchor: HTMLButtonElement;
  disabled: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
}) {
  const menu = React.useRef<HTMLDivElement>(null);
  const rect = anchor.getBoundingClientRect();
  const menuHeight = window.matchMedia("(max-width: 900px)").matches
    ? 160
    : 142;
  const top = Math.max(
    8,
    Math.min(rect.bottom + 5, window.innerHeight - menuHeight - 8),
  );
  const left = Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198));

  React.useLayoutEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !anchor.contains(event.target)
      )
        onClose();
    };
    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target))
        return;
      onClose();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      if (
        anchor.isConnected &&
        (document.activeElement === document.body ||
          menu.current?.contains(document.activeElement))
      )
        anchor.focus();
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={menu}
      className="library-row-menu"
      data-canvas-management
      role="menu"
      aria-label={`画布操作：${item.name}`}
      style={{ top, left }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = Array.from(
          menu.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) || [],
        );
        if (!buttons.length) return;
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        aria-label={`重命名画布：${item.name}`}
        onClick={onRename}
      >
        <Pencil size={15} />
        重命名
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        aria-label={`复制画布：${item.name}`}
        onClick={onDuplicate}
      >
        <Copy size={15} />
        复制画布
      </button>
      <div className="library-menu-separator" />
      <button
        type="button"
        role="menuitem"
        className="library-trash-action"
        disabled={disabled}
        aria-label={`将画布 ${item.name} 移入回收站`}
        onClick={onTrash}
      >
        <Trash2 size={15} />
        移入回收站
      </button>
    </div>,
    document.body,
  );
}

export default function CanvasLibrary(props: CanvasLibraryProps) {
  const {
    items,
    cloudStatuses,
    activeId,
    onClose,
    loading,
    busy,
    discovering,
    discoveryError,
    error,
    notice,
    onNotice,
    onRetry,
    onCreate,
    onImport,
    onOpen,
    onRename,
    onDuplicate,
    onTrash,
    onRestore,
  } = props;
  const [tab, setTab] = React.useState<"all" | "trash">("all");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<"created" | "updated" | "deleted" | "name">("created");
  const [dialog, setDialog] = React.useState<NameDialog | null>(null);
  const [menu, setMenu] = React.useState<{
    item: CanvasSummary;
    anchor: HTMLButtonElement;
  } | null>(null);
  const allTab = React.useRef<HTMLButtonElement>(null);
  const trashTab = React.useRef<HTMLButtonElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const activeRow = React.useRef<HTMLLIElement>(null);
  const baseId = React.useId();
  const lastNotifiedError = React.useRef("");
  const allCount = items.filter((item) => !item.deletedAt).length;
  const trashCount = items.length - allCount;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const effectiveSort = tab === "trash"
    ? sort === "name" ? "name" : "deleted"
    : sort === "deleted" ? "created" : sort;
  const filtered = React.useMemo(
    () =>
      items
        .filter(
          (item) =>
            Boolean(item.deletedAt) === (tab === "trash") &&
            item.name.toLocaleLowerCase().includes(normalizedQuery),
        )
        .sort((left, right) => {
          if (effectiveSort === "name")
            return left.name.localeCompare(right.name, "zh-CN", { numeric: true }) || left.id.localeCompare(right.id);
          const leftTimestamp = effectiveSort === "deleted" ? left.deletedAt : effectiveSort === "created" ? left.createdAt : left.updatedAt;
          const rightTimestamp = effectiveSort === "deleted" ? right.deletedAt : effectiveSort === "created" ? right.createdAt : right.updatedAt;
          return (Date.parse(rightTimestamp || "") || 0) - (Date.parse(leftTimestamp || "") || 0) || left.id.localeCompare(right.id);
        }),
    [items, normalizedQuery, effectiveSort, tab],
  );

  // Loading/operation failures are transient feedback. Keep the library
  // usable without reserving space for an inline banner, and give the toast
  // the same retry action that the old banner exposed.
  React.useEffect(() => {
    const failure = error || discoveryError;
    if (!failure) {
      lastNotifiedError.current = "";
      return;
    }
    if (!onNotice || failure === lastNotifiedError.current) return;
    lastNotifiedError.current = failure;
    onNotice(failure, { label: "重试", run: onRetry });
  }, [discoveryError, error, onNotice, onRetry]);
  const disabled = busy || loading;
  const create = () => {
    setMenu(null);
    setDialog({ kind: "create" });
  };
  const closeMenu = React.useCallback(() => setMenu(null), []);
  const clearSearch = () => {
    setQuery("");
    search.current?.focus();
  };

  React.useEffect(() => {
    setTab("all");
    setQuery("");
    setMenu(null);
  }, [activeId]);
  React.useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeId, tab]);
  React.useEffect(() => {
    if (busy) setMenu(null);
  }, [busy]);

  return (
    <aside
      data-canvas-management
      className="library-shell"
      aria-label="我的画布"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !dialog && !menu) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="library-page" aria-hidden={dialog ? true : undefined}>
        <header className="library-heading-row">
          <h1>
            <Layers size={17} />
            我的画布
          </h1>
          <div className="library-heading-actions">
            {trashCount > 0 && (
              <button
                type="button"
                className="library-icon-button library-trash-short"
                id={`${baseId}-trash-shortcut`}
                aria-label={`回收站 · ${trashCount}`}
                aria-pressed={tab === "trash"}
                title={`回收站 · ${trashCount}`}
                onClick={() => { setTab("trash"); setMenu(null); }}
              >
                <Trash2 size={16} />
                <span>{trashCount}</span>
              </button>
            )}
            <button
              type="button"
              className="library-icon-button library-close"
              aria-label="收起画布列表"
              title="收起画布列表"
              onClick={onClose}
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
        </header>
        <div className="library-create-actions">
          <button
            type="button"
            className="library-button library-button-primary"
            onClick={create}
            disabled={disabled || discovering}
          >
            <Plus size={18} />
            新建画布
          </button>
          <button
            type="button"
            className="library-icon-button library-import"
            onClick={onImport}
            disabled={disabled || discovering}
            aria-label="导入画布"
            title="导入画布 JSON"
          >
            <Upload size={17} />
          </button>
        </div>
        <div className="library-search">
          <Search size={15} />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索画布"
            aria-label="搜索画布名称"
          />
          {query && (
            <button
              type="button"
              className="library-search-clear"
              onClick={clearSearch}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div
          className="library-tabs"
          role="tablist"
          aria-label="画布分类"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next = event.key === "Home" || event.key === "ArrowLeft" ? "all" : "trash";
            if (next === "all") {
              setTab("all");
              setMenu(null);
              allTab.current?.focus();
            } else {
              setTab("trash");
              setMenu(null);
              trashTab.current?.focus();
            }
          }}
        >
          <button
            type="button"
            ref={allTab}
            role="tab"
            id={`${baseId}-all`}
            aria-selected={tab === "all"}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === "all" ? 0 : -1}
            className={`library-tab ${tab === "all" ? "library-tab-active" : ""}`}
            onClick={() => {
              setTab("all");
              setMenu(null);
            }}
          >
            全部<span>{allCount}</span>
          </button>
          <button
            type="button"
            ref={trashTab}
            role="tab"
            id={`${baseId}-trash`}
            aria-selected={tab === "trash"}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === "trash" ? 0 : -1}
            className={`library-tab ${tab === "trash" ? "library-tab-active" : ""}`}
            onClick={() => {
              setTab("trash");
              setMenu(null);
            }}
          >
            回收站<span>{trashCount}</span>
          </button>
        </div>
        <section
          className="library-results"
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-${tab === "trash" ? "trash" : "all"}`}
          aria-busy={loading || busy || discovering}
        >
          <div className="library-results-caption">
            <span>
              {busy ? (
                <span className="library-working" role="status">
                  <LoaderCircle size={12} className="library-spin" />
                  正在处理…
                </span>
              ) : normalizedQuery ? (
                `${filtered.length} 个搜索结果`
              ) : tab === "trash" ? (
                "可随时恢复"
              ) : (
                "所有画布"
              )}
            </span>
            <label className="library-sort">
              <ArrowUpDown size={12} />
              <span className="library-sr-only">画布排序</span>
              <select
                value={effectiveSort}
                onChange={(event) =>
                  setSort(event.target.value as "created" | "updated" | "deleted" | "name")
                }
              >
                {tab === "trash" ? (
                  <option value="deleted">最近移入</option>
                ) : (
                  <>
                    <option value="created">最近创建</option>
                    <option value="updated">最近更新</option>
                  </>
                )}
                <option value="name">名称排序</option>
              </select>
            </label>
          </div>
          {tab === "all" && !normalizedQuery && discovering && !loading && (
            <div className="library-discovery-status" role="status">
              <LoaderCircle size={13} className="library-spin" />
              正在检查云端画布…
            </div>
          )}
          <div className="library-list-scroll">
            {loading || (discovering && tab === "all" && !normalizedQuery && !filtered.length) ? (
              <div className="library-loading" role="status">
                <span className="library-sr-only">正在加载画布</span>
                <div className="library-cards" aria-hidden="true">
                  {[0, 1, 2, 3].map((key) => (
                    <div className="library-skeleton" key={key}>
                      <span />
                      <i />
                      <i />
                    </div>
                  ))}
                </div>
              </div>
            ) : filtered.length ? (
              <ul className="library-cards">
                {filtered.map((item) => {
                  const timestamp = item.deletedAt || (effectiveSort === "created" ? item.createdAt : item.updatedAt);
                  const timestampSuffix = item.deletedAt ? "移入回收站" : effectiveSort === "created" ? "创建" : "更新";
                  const isActive = activeId === item.id && !item.deletedAt;
                  const details = (
                    <>
                      <Cover item={item} />
                      <span className="library-card-info">
                        <span className="library-card-title" title={item.name}>
                          {item.name}
                        </span>
                        <time dateTime={timestamp}>
                          {dateLabel(timestamp, timestampSuffix)}
                        </time>
                        {cloudStatusLabel(cloudStatuses?.[item.id]) && (
                          <span
                            className={`library-cloud-status library-cloud-status-${cloudStatuses?.[item.id]?.state}`}
                            title="云端状态；打开画布可查看版本选择"
                          >
                            {cloudStatusLabel(cloudStatuses?.[item.id])}
                          </span>
                        )}
                        {item.pendingTasks > 0 && (
                          <span
                            className="library-pending"
                            title="打开画布查看生成结果"
                          >
                            <Clock3 size={11} />
                            正在生成 {item.pendingTasks} 项
                          </span>
                        )}
                      </span>
                    </>
                  );
                  return (
                    <li
                      className={`library-card ${item.deletedAt ? "library-card-deleted" : ""} ${isActive ? "library-card-active" : ""}`}
                      data-canvas-id={item.id}
                      ref={isActive ? activeRow : undefined}
                      key={item.id}
                    >
                      {item.deletedAt ? (
                        <div className="library-card-content">{details}</div>
                      ) : (
                        <button
                          type="button"
                          className="library-card-open"
                          disabled={disabled}
                          onClick={() => onOpen(item.id)}
                          aria-label={`打开画布：${item.name}`}
                          aria-current={isActive ? "page" : undefined}
                          title={`${item.name} · ${item.nodeCount} 个节点`}
                        >
                          {details}
                        </button>
                      )}
                      {item.deletedAt ? (
                        <button
                          type="button"
                          className="library-icon-button library-restore"
                          onClick={() => onRestore(item.id)}
                          disabled={disabled}
                          aria-label={`恢复画布：${item.name}`}
                          title="恢复画布"
                        >
                          <RotateCcw size={16} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`library-icon-button library-card-more ${menu?.item.id === item.id ? "is-open" : ""}`}
                          disabled={disabled}
                          aria-label={`画布操作：${item.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menu?.item.id === item.id}
                          title="画布操作"
                          onClick={(event) =>
                            setMenu(
                              menu?.item.id === item.id
                                ? null
                                : { item, anchor: event.currentTarget },
                            )
                          }
                        >
                          <MoreHorizontal size={17} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="library-empty">
                <span className="library-empty-icon">
                  {normalizedQuery ? (
                    <Search size={25} />
                  ) : tab === "trash" ? (
                    <Trash2 size={25} />
                  ) : (
                    <FolderOpen size={26} />
                  )}
                </span>
                <h2>
                  {normalizedQuery
                    ? "没有找到相关画布"
                      : tab === "trash"
                      ? "回收站是空的"
                    : discoveryError
                      ? "暂时没有可显示的画布"
                      : "还没有画布"}
                </h2>
                <p>
                  {normalizedQuery
                    ? "试试其他名称，或清除搜索。"
                    : tab === "trash"
                      ? "移入回收站的画布会显示在这里。"
                      : discoveryError
                        ? ""
                        : "新建画布，开始记录灵感。"}
                </p>
                {normalizedQuery ? (
                  <button
                    type="button"
                    className="library-button library-button-secondary"
                    onClick={clearSearch}
                  >
                    清除搜索
                  </button>
                ) : tab === "trash" ? (
                  <button
                    type="button"
                    className="library-button library-button-secondary"
                    onClick={() => {
                      setTab("all");
                      allTab.current?.focus();
                    }}
                  >
                    返回全部画布
                  </button>
                ) : (
                  <button
                    type="button"
                    className="library-button library-button-secondary"
                    onClick={onImport}
                    disabled={disabled}
                  >
                    <Upload size={15} />
                    导入已有画布
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
        <footer className="library-footer">
          <span>画布独立保存</span>
          <button
            type="button"
            className="library-icon-button library-refresh"
            onClick={onRetry}
            disabled={disabled || discovering}
            aria-label="刷新列表"
            title="刷新列表并检查云端画布"
          >
            <RotateCcw
              size={14}
              className={loading || discovering ? "library-spin" : undefined}
            />
          </button>
        </footer>
      </div>
      {menu && (
        <CanvasActions
          item={menu.item}
          anchor={menu.anchor}
          disabled={disabled}
          onClose={closeMenu}
          onRename={() => {
            setDialog({ kind: "rename", item: menu.item });
            setMenu(null);
          }}
          onDuplicate={() => {
            onDuplicate(menu.item.id);
            setMenu(null);
          }}
          onTrash={() => {
            onTrash(menu.item.id);
            setMenu(null);
          }}
        />
      )}
      {dialog &&
        createPortal(
          <CanvasNameDialog
            dialog={dialog}
            busy={busy}
            operationError={error}
            onClose={() => setDialog(null)}
            onSubmit={(name) => {
              if (dialog.kind === "create") onCreate(name);
              else onRename(dialog.item.id, name);
            }}
          />,
          document.body,
        )}
    </aside>
  );
}
