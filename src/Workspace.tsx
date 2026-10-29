import { captureLocalStorageScope } from "./local-storage-scope.ts";
import React from "react";
import { registerCanvasCapabilities } from "./agent-registration";
import type { CanvasAgentContext } from "./agent-capabilities";
import type { AgentHandler, AgentInvocationContext } from "@ducking-mind/proxy-app-sdk";
import manifest from "../manifest.json";
import { getAgentCapabilities } from "./agent-tools.mjs";
import { LoaderCircle, PanelLeftOpen, Plus } from "lucide-react";
import App, {
  documentRevisionSignature,
  normalize,
  syncCloudDocument,
} from "./App";
import type { Document } from "./canvas-types";
import type { CanvasEditorHandle } from "./editor-contract";
import { client } from "./platform-client";
import CanvasLibrary from "./CanvasLibrary";
import {
  copyCanvasDocument,
  getCanvas,
  importCloudCanvas,
  listCanvases,
  migrateLegacy,
  listPendingCloudSync,
  getPendingCloudSync,
  queuePendingCloudSync,
  removePendingCloudSync,
  renameCanvas,
  saveCanvas,
  setCanvasDeleted,
  type CanvasSummary,
} from "./library-store";
import { listCanvasDocuments, readCanvasDocument } from "./document-storage";
import { loadCanvasPreferences } from "./canvas-preferences";
import { isSessionOnlyStorage, markSessionSynced } from "./draft-store";
import { platformFailure } from "./platform-status";
import { usePlatformAccess } from "./PlatformGate";
import CanvasLoadingIndicator from "./CanvasLoadingIndicator";
import { useTransientNotice } from "./useTransientNotice";
import { canvasContentSignature, resolveCloudDocumentVersion } from "./cloud-version";
import {
  classifyCloudAcknowledgement,
  classifyCloudDocument,
  markCloudLibraryLocalSave,
  type CloudLibraryStatusEntry,
} from "./cloud-library-status";

const freshId = () => `canvas-${crypto.randomUUID()}`;
const timestamp = () => new Date().toISOString();
const routeId = () =>
  /^#\/canvas\/([A-Za-z0-9_-]{1,100})$/.exec(location.hash)?.[1] || null;
const routeUrl = (id: string | null) => (id ? `#/canvas/${id}` : "#/canvases");
const describe = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试。";
const blankDocument = (name = "未命名画布") => {
  const at = timestamp();
  return normalize({
    id: freshId(),
    name: name.trim() || "未命名画布",
    createdAt: at,
    updatedAt: at,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
};

const CANVAS_LOADING_FADE_MS = 360;
const CANVAS_LOADING_SETTLE_MS = CANVAS_LOADING_FADE_MS + 60;
const CANVAS_SWITCH_FEEDBACK_DELAY_MS = 180;
const CANVAS_SWITCH_FADE_MS = 220;
type CanvasSwitchIndicator = {
  id: string;
  name: string;
  message: string;
  phase: "pending" | "visible" | "dismissing";
};
const WORKSPACE_CAPABILITIES = new Set(["list_documents", "open_document", "create_document"]);
const EDITOR_CAPABILITY_NAMES = getAgentCapabilities()
  .map(({ name }) => name)
  .filter((name) => name !== "read_metadata" && !WORKSPACE_CAPABILITIES.has(name));

export default function Workspace() {
  const checkAccount = React.useRef(captureLocalStorageScope()).current;
  const {
    ready: platformReady,
    revision: platformRevision,
    requireLogin,
  } = usePlatformAccess();
  const platformReadyRef = React.useRef(platformReady);
  platformReadyRef.current = platformReady;
  const platformRevisionRef = React.useRef(platformRevision);
  platformRevisionRef.current = platformRevision;
  const lastPlatformRevision = React.useRef(platformRevision);
  const [items, setItems] = React.useState<CanvasSummary[]>([]);
  const [active, setActive] = React.useState<Document | null>(null);
  const [workspaceReady, setWorkspaceReady] = React.useState(false);
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const [switchIndicator, setSwitchIndicator] = React.useState<CanvasSwitchIndicator | null>(null);
  const switchIndicatorRef = React.useRef<CanvasSwitchIndicator | null>(null);
  const [switchReadyId, setSwitchReadyId] = React.useState<string | null>(null);
  const switchTargetRef = React.useRef<string | null>(null);
  const switchFeedbackTimer = React.useRef<number | null>(null);
  const switchDismissTimer = React.useRef<number | null>(null);
  const switchReadyTimer = React.useRef<number | null>(null);
  const [reduceMotion, setReduceMotion] = React.useState(() => loadCanvasPreferences().reduceMotion);
  const [loading, setLoading] = React.useState(true);
  const [loadingDismissed, setLoadingDismissed] = React.useState(false);
  const loadingDismissTimer = React.useRef<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [cloudListing, setCloudListing] = React.useState(false);
  const [cloudListError, setCloudListError] = React.useState("");
  const [cloudStatuses, setCloudStatuses] = React.useState<Record<string, CloudLibraryStatusEntry>>({});
  const [error, setError] = React.useState("");
  const { notice, show: setNotice } = useTransientNotice(5000);
  const [mobile, setMobile] = React.useState(
    () => matchMedia("(max-width: 900px)").matches,
  );
  // Keep the canvas as the primary surface after a refresh. The library is
  // opened explicitly from the top-left control (or when the URL asks for
  // the library route).
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const panel = React.useRef<HTMLDivElement>(null);
  const editorElement = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<CanvasEditorHandle | null>(null);
  const editorAgentHandlers = React.useRef<Record<string, AgentHandler>>({});
  const registerEditorAgent = React.useCallback((handlers: Record<string, AgentHandler> | null) => {
    editorAgentHandlers.current = handlers || {};
  }, []);
  const operation = React.useRef(false);
  const pendingHistory = React.useRef<{ id: string | null } | null>(null);
  const cloudListAttempted = React.useRef(false);
  const cloudListRequest = React.useRef<Promise<boolean> | null>(null);
  const cloudListRequestRevision = React.useRef(platformRevision);
  const requestedDocument = React.useRef(routeId());
  const cloudReady = React.useRef(false);
  const pendingSyncRun = React.useRef<Promise<void> | null>(null);
  const live = React.useRef(true);
  const registerEditor = React.useCallback(
    (handler: CanvasEditorHandle | null) => {
      editor.current = handler;
    },
    [],
  );
  const reloadList = React.useCallback(async () => {
    checkAccount();
    const list = await listCanvases();
    checkAccount();
    if (live.current) setItems(list);
    return list;
  }, []);
  const markLocalSave = React.useCallback((snapshot: Document) => {
    setCloudStatuses((previous) => ({
      ...previous,
      [snapshot.id]: markCloudLibraryLocalSave(previous[snapshot.id], snapshot),
    }));
  }, []);
  const onSaved = React.useCallback((snapshot: Document) => {
    markLocalSave(snapshot);
    if (live.current)
      void reloadList().catch((cause) => setError(describe(cause)));
  }, [markLocalSave, reloadList]);
  const onCloudSynced = React.useCallback((document: Document) => {
    // A queued save can resolve after its editor has been unmounted. Read the
    // current local body before clearing the pending marker so an older cloud
    // acknowledgement cannot hide a newer local edit.
    void (async () => {
      if (!live.current) return;
      let local: Document | null = null;
      try {
        const value = await getCanvas<Document>(document.id);
        local = value ? normalize(value) : null;
      } catch (cause) {
        if (live.current) setError(describe(cause));
        return;
      }
      if (!live.current) return;
      setCloudStatuses((previous) => ({
        ...previous,
        [document.id]: classifyCloudAcknowledgement(
          local,
          normalize(document),
          previous[document.id],
          canvasContentSignature,
          documentRevisionSignature,
        ),
      }));
      void reloadList().catch((cause) => setError(describe(cause)));
    })();
  }, [reloadList]);
  const setRoute = (id: string | null, replace = false) => {
    if (location.hash !== routeUrl(id))
      history[replace ? "replaceState" : "pushState"](
        { canvasId: id },
        "",
        routeUrl(id),
      );
  };
  const setCanvasSwitchIndicator = (next: CanvasSwitchIndicator | null) => {
    switchIndicatorRef.current = next;
    setSwitchIndicator(next);
  };
  const clearCanvasSwitchTimers = () => {
    if (switchFeedbackTimer.current !== null) {
      window.clearTimeout(switchFeedbackTimer.current);
      switchFeedbackTimer.current = null;
    }
    if (switchDismissTimer.current !== null) {
      window.clearTimeout(switchDismissTimer.current);
      switchDismissTimer.current = null;
    }
    if (switchReadyTimer.current !== null) {
      window.clearTimeout(switchReadyTimer.current);
      switchReadyTimer.current = null;
    }
  };
  const beginCanvasSwitch = (id: string, name: string, message: string) => {
    clearCanvasSwitchTimers();
    setReduceMotion(loadCanvasPreferences().reduceMotion);
    switchTargetRef.current = id;
    setSwitchReadyId(null);
    setCanvasSwitchIndicator({ id, name, message, phase: "pending" });
    switchFeedbackTimer.current = window.setTimeout(() => {
      switchFeedbackTimer.current = null;
      const current = switchIndicatorRef.current;
      if (live.current && current?.id === id && current.phase === "pending")
        setCanvasSwitchIndicator({ ...current, phase: "visible" });
    }, CANVAS_SWITCH_FEEDBACK_DELAY_MS);
  };
  const updateCanvasSwitchMessage = (id: string, message: string) => {
    const current = switchIndicatorRef.current;
    if (current?.id !== id) return;
    setCanvasSwitchIndicator({ ...current, message });
  };
  const cancelCanvasSwitch = () => {
    clearCanvasSwitchTimers();
    switchTargetRef.current = null;
    setCanvasSwitchIndicator(null);
    setSwitchReadyId(null);
  };
  const onEditorReady = React.useCallback((id: string) => {
    if (switchTargetRef.current !== id) return;
    switchTargetRef.current = null;
    const stillWaitingToShow = switchFeedbackTimer.current !== null;
    if (switchFeedbackTimer.current !== null) {
      window.clearTimeout(switchFeedbackTimer.current);
      switchFeedbackTimer.current = null;
    }
    const current = switchIndicatorRef.current;
    const shouldAnimate = !stillWaitingToShow && current?.id === id && current.phase === "visible" && !reduceMotion;
    setSwitchReadyId(shouldAnimate ? id : null);
    if (!shouldAnimate) {
      setCanvasSwitchIndicator(null);
    } else {
      setCanvasSwitchIndicator({ ...current, phase: "dismissing" });
      switchDismissTimer.current = window.setTimeout(() => {
        switchDismissTimer.current = null;
        if (switchIndicatorRef.current?.id === id) setCanvasSwitchIndicator(null);
      }, CANVAS_SWITCH_FADE_MS);
      switchReadyTimer.current = window.setTimeout(() => {
        switchReadyTimer.current = null;
        setSwitchReadyId((currentId) => currentId === id ? null : currentId);
      }, CANVAS_SWITCH_FADE_MS);
    }
  }, [reduceMotion]);
  const activate = (value: Document | null, replace = false) => {
    requestedDocument.current = null;
    activeRef.current = value;
    setActive(value);
    setError("");
    setRoute(value?.id || null, replace);
    if (value && matchMedia("(max-width: 900px)").matches)
      setSidebarOpen(false);
    if (!value) setSidebarOpen(true);
  };
  const execute = async (action: () => Promise<void>) => {
    if (!platformReadyRef.current || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      // A failed write after prepareLeave must never leave the current editor frozen.
      editor.current?.resume();
      if (live.current) {
        setError(describe(cause));
        setSidebarOpen(true);
        if (!activeRef.current) setLoading(false);
      }
    } finally {
      operation.current = false;
      if (live.current) setBusy(false);
      if (pendingHistory.current) queueMicrotask(drainHistory);
    }
  };
  const readDocument = async (id: string) => {
    checkAccount();
    let value = await getCanvas<Document>(id);
    if (!value) {
      const summary = (await listCanvases()).find((item) => item.id === id);
      if (summary?.deletedAt)
        throw new Error("这张画布已移入回收站，请先恢复后再打开。");

      // A visible library card can outlive its full local body after an old
      // partial migration or browser-storage interruption. Recover that one
      // document directly instead of requiring a full cloud-library scan.
      if (platformReadyRef.current && live.current) {
        try {
          const remote = await readCanvasDocument(client.storage, id);
          if (remote) {
            await importCloudCanvas(normalize(remote));
            checkAccount();
            value = await getCanvas<Document>(id);
          }
        } catch (cause) {
          if (!live.current) throw cause;
          throw new Error(`本机画布正文缺失，且暂时无法从云端恢复：${describe(cause)}`, { cause });
        }
      }
    }
    if (!value)
      throw new Error(
        "这张画布的正文在本机和云端均未找到，可重新加载云端画布，或导入 JSON 备份。",
      );
    if (value.deletedAt)
      throw new Error("这张画布已移入回收站，请先恢复后再打开。");
    return normalize(value);
  };
  const prepareSwitch = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (editor.current && !(await editor.current.prepareLeave()))
      throw new Error("当前画布未能保存到本机，已保留在工作区。请重试或先导出备份。");
    signal?.throwIfAborted();
  };
  const navigate = async (id: string | null, fromHistory = false, signal?: AbortSignal) => {
    const previous = activeRef.current;
    // Old library links now reveal management without leaving the editor.
    if (!id || previous?.id === id) {
      requestedDocument.current = null;
      if (!id) setSidebarOpen(true);
      setRoute(previous?.id || null, true);
      if (id && matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
      return;
    }
    requestedDocument.current = id;
    const targetName = items.find((item) => item.id === id)?.name || "目标画布";
    beginCanvasSwitch(id, targetName, "正在打开画布…");
    try {
      const value = await readDocument(id);
      updateCanvasSwitchMessage(id, "正在保存当前画布…");
      await prepareSwitch(signal);
      updateCanvasSwitchMessage(id, "正在显示新画布…");
      activate(value, fromHistory);
      await reloadList();
    } catch (cause) {
      cancelCanvasSwitch();
      if (fromHistory) setRoute(previous?.id || null, true);
      throw cause;
    }
  };
  const create = async (name = "未命名画布", signal?: AbortSignal) => {
    checkAccount();
    const value = blankDocument(name);
    beginCanvasSwitch(value.id, value.name, "正在创建画布…");
    try {
      updateCanvasSwitchMessage(value.id, "正在保存当前画布…");
      await prepareSwitch(signal);
      checkAccount();
      await saveCanvas(value);
      markLocalSave(value);
      updateCanvasSwitchMessage(value.id, "正在显示新画布…");
      activate(value);
      await reloadList();
      if (isSessionOnlyStorage()) await mirrorManagement(value.id, null);
    } catch (cause) {
      cancelCanvasSwitch();
      throw cause;
    }
  };
  const workspaceAgentRef = React.useRef<Record<string, (input: any, context: CanvasAgentContext) => Promise<unknown>>>({});
  const runAgent = async (input: { expected_active_document_id: string }, context: CanvasAgentContext, action: () => Promise<void>) => {
    context.signal.throwIfAborted();
    const fail = (code: string, message: string, retryable: boolean, nextAction: { type: "wait" | "user_login" }) => {
      throw Object.assign(new Error(message), { code, executionStarted: false, retryable, nextAction });
    };
    if (!platformReadyRef.current || !live.current) fail("APP_LOGIN_REQUIRED", "请先登录后再操作画布", false, { type: "user_login" });
    if (loading || operation.current) fail("AGENT_APP_NOT_READY", "画布工作区正在加载或切换，请稍后重试", true, { type: "wait" });
    if (input.expected_active_document_id !== (activeRef.current?.id || "")) {
      throw Object.assign(new Error("当前画布已变化，请重新读取 list_documents"), { code: "CANVAS_WORKSPACE_CONFLICT", executionStarted: false });
    }
    operation.current = true; setBusy(true);
    try {
      await action();
      return { documentId: activeRef.current?.id || null, name: activeRef.current?.name || null, savedLocally: true };
    } catch (cause) { editor.current?.resume(); throw cause; }
    finally { operation.current = false; if (live.current) setBusy(false); if (pendingHistory.current) queueMicrotask(drainHistory); }
  };
  workspaceAgentRef.current = {
    list_documents: async (input: { offset?: number; limit?: number }, context) => {
      context.signal.throwIfAborted();
      if (!platformReadyRef.current || !live.current) throw Object.assign(new Error("请先登录后再读取画布"), { code: "APP_LOGIN_REQUIRED", executionStarted: false, retryable: false, nextAction: { type: "user_login" } });
      if (loading || operation.current) throw Object.assign(new Error("画布目录正在加载或切换，请稍后重试"), { code: "AGENT_APP_NOT_READY", executionStarted: false, retryable: true, nextAction: { type: "wait" } });
      const offset = input.offset ?? 0, limit = input.limit ?? 50;
      const documents = (await listCanvases()).filter(item => !item.deletedAt);
      return { activeDocumentId: activeRef.current?.id || "", documents: documents.slice(offset, offset + limit).map(({ id, name, updatedAt, nodeCount, pendingTasks }) => ({ id, name, updatedAt, nodeCount, pendingTasks })), nextOffset: offset + limit < documents.length ? offset + limit : null };
    },
    open_document: (input, context) => runAgent(input, context, () => navigate(input.document_id, false, context.signal)),
    create_document: (input, context) => runAgent(input, context, () => {
      if (!input.name?.trim()) throw Object.assign(new Error("画布名称不能为空"), { code: "CANVAS_INVALID_ARGUMENT", executionStarted: false });
      return create(input.name, context.signal);
    }),
  };
  React.useEffect(() => {
    const workspaceHandlers = Object.fromEntries(
      ["read_metadata", "list_documents", "open_document", "create_document"].map((name) => [
        name,
        name === "read_metadata"
          ? async () => ({ appId: manifest.id, version: manifest.version, name: manifest.name })
          : (input: unknown, context: AgentInvocationContext) => workspaceAgentRef.current[name](input, context),
      ]),
    );
    const editorHandlers = Object.fromEntries(
      EDITOR_CAPABILITY_NAMES.map((name) => [
        name,
        async (input: unknown, context: AgentInvocationContext) => {
          const handler = editorAgentHandlers.current[name];
          if (!handler) {
            throw Object.assign(new Error("请先打开或新建画布"), {
              code: "CANVAS_NO_DOCUMENT",
              executionStarted: false,
              retryable: true,
              nextAction: { type: "open_document", capability: "proxy_canvas_create_document" },
            });
          }
          return handler(input, context);
        },
      ]),
    );
    return registerCanvasCapabilities({ ...workspaceHandlers, ...editorHandlers });
  }, []);
  React.useEffect(() => {
    if (!platformReady) return;
    const context = active?.id ? { activeDocumentId: active.id } : {};
    if (loading || busy) return client.agent.setStatus({ state: loading ? "loading" : "busy", reason: loading ? "正在加载画布工作区" : "正在保存或切换画布", retryable: true, nextAction: { type: "wait" }, context }, { scope: "canvas.workspace", priority: 60 });
    if (!active) return client.agent.setStatus(error
      ? { state: "error", reason: "当前画布加载失败，可重新打开或新建画布", retryable: true, nextAction: { type: "open_document", capability: "proxy_canvas_open_document" }, context }
      : { state: "no_document", reason: "请打开或新建画布", retryable: false, nextAction: { type: "open_document", capability: "proxy_canvas_create_document" }, context }, { scope: "canvas.workspace", priority: 60 });
    // Once a document is active, its editor owns readiness and loading state.
  }, [platformReady, loading, busy, active?.id, Boolean(error)]);
  const importDocument = async (source: Document) => {
    const at = timestamp();
    const value = normalize({
      ...source,
      id: freshId(),
      createdAt: at,
      updatedAt: at,
      deletedAt: undefined,
    });
    beginCanvasSwitch(value.id, value.name, "正在导入画布…");
    try {
      updateCanvasSwitchMessage(value.id, "正在保存当前画布…");
      await prepareSwitch();
      checkAccount();
      await saveCanvas(value);
      markLocalSave(value);
      updateCanvasSwitchMessage(value.id, "正在显示新画布…");
      activate(value);
      await reloadList();
      if (isSessionOnlyStorage()) await mirrorManagement(value.id, null);
    } catch (cause) {
      cancelCanvasSwitch();
      throw cause;
    }
  };
  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () =>
      void execute(async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 256 * 1024 * 1024)
          throw new Error("文件超过 256 MB，请拆分后再导入。");
        const value = JSON.parse(await file.text());
        if (
          !value ||
          typeof value !== "object" ||
          !Array.isArray(value.nodes) ||
          !Array.isArray(value.edges)
        )
          throw new Error("文件不是有效画布，需要包含节点和连接。");
        if (value.schema && value.schema !== "proxy.canvas/v3")
          throw new Error("暂不支持此画布格式，请使用本应用导出的 JSON。");
        await importDocument(normalize(value));
      });
    input.click();
  };
  const refreshCloud = (): Promise<boolean> => {
    const revision = platformRevisionRef.current;
    if (cloudListRequest.current && cloudListRequestRevision.current === revision)
      return cloudListRequest.current;
    if (!platformReadyRef.current || !live.current) return Promise.resolve(false);
    const current = () => live.current && platformReadyRef.current && revision === platformRevisionRef.current;
    cloudListRequestRevision.current = revision;
    setCloudListing(true);
    setCloudListError("");
    setCloudStatuses({});
    const request = (async () => {
      try {
        checkAccount();
        // PlatformGate validates the session before the workspace mounts.
        // Reuse that admitted session for the initial cloud listing instead
        // of rotating it again and revoking the bearer used by startup calls.
        const admittedSession = client.session();
        const session = admittedSession?.access_token && admittedSession.account_scope
          ? admittedSession
          : await client.platform.createSession();
        checkAccount();
        if (!current()) return false;
        if (!session.account_scope) {
          cloudReady.current = false;
          requireLogin("平台登录已失效，请重新登录后继续。当前画布已保留。");
          return false;
        }
        const documents = await listCanvasDocuments(client.storage);
        checkAccount();
        if (!current()) return false;
        const remoteIds = new Set<string>();
        const nextStatuses: Record<string, CloudLibraryStatusEntry> = {};
        for (const raw of documents) {
          remoteIds.add(raw.id);
          const existing = await getCanvas(raw.id);
          if (!current()) return false;
          if (existing) {
            // Keep the local body intact. The editor performs the authoritative
            // recovery choice when this card is opened, while the list exposes
            // why its local and cloud copies differ.
            nextStatuses[raw.id] = classifyCloudDocument(
              normalize(existing),
              normalize(raw),
              canvasContentSignature,
              documentRevisionSignature,
            );
            continue;
          }
          const value = normalize(raw);
          checkAccount();
          if (!current()) return false;
          const imported = await importCloudCanvas(value);
          if (!current()) return false;
          if (imported) {
            markSessionSynced(value.id, JSON.stringify(value));
            nextStatuses[value.id] = classifyCloudDocument(
              value,
              value,
              canvasContentSignature,
              documentRevisionSignature,
            );
          }
        }
        if (!current()) return false;
        const localItems = await reloadList();
        for (const item of localItems) {
          if (remoteIds.has(item.id)) continue;
          const local = await getCanvas<Document>(item.id);
          if (!current()) return false;
          nextStatuses[item.id] = classifyCloudDocument(
            local ? normalize(local) : null,
            null,
            canvasContentSignature,
            documentRevisionSignature,
          );
        }
        if (!current()) return false;
        setCloudStatuses(nextStatuses);
        if (!current()) return false;
        cloudReady.current = true;
        return true;
      } catch (cause) {
        if (!current()) return false;
        cloudReady.current = false;
        setCloudStatuses({});
        if (live.current) {
          const failure = platformFailure(cause);
          if (failure.kind === "login") requireLogin(failure.message);
          setCloudListError(failure.message);
          setNotice(`${failure.message} ${isSessionOnlyStorage() ? "当前页面内容已保留，关闭前请重试同步或导出。" : "本机画布仍已保留。"}`, {
            label: "重试", run: () => void execute(retryLibrary),
          });
        }
        return false;
      }
    })().finally(() => {
      if (cloudListRequest.current === request) {
        cloudListRequest.current = null;
        if (live.current) setCloudListing(false);
      }
    });
    cloudListRequest.current = request;
    return request;
  };
  const resumePendingCloudSync = React.useCallback((): Promise<void> => {
    if (pendingSyncRun.current) return pendingSyncRun.current;
    if (!platformReadyRef.current || !navigator.onLine || !live.current || !workspaceReady)
      return Promise.resolve();
    const revision = platformRevisionRef.current;
    const current = () =>
      live.current &&
      platformReadyRef.current &&
      revision === platformRevisionRef.current;
    const request = (async () => {
      try {
        const records = await listPendingCloudSync();
        checkAccount();
        for (const record of records) {
          if (!current()) return;
          if (record.paused) continue;
          if (activeRef.current?.id === record.id) continue;
          try {
            let persisted = await getCanvas<Document>(record.id);
            checkAccount();
            if (!persisted) continue;
            await queuePendingCloudSync(persisted, { reactivatePaused: false });
            checkAccount();
            const local = normalize(persisted);
            const pending = await getPendingCloudSync(record.id);
            checkAccount();
            if (!pending || pending.paused) continue;
            if (activeRef.current?.id === record.id) continue;
            const remoteValue = await readCanvasDocument(client.storage, record.id);
            checkAccount();
            if (!current()) return;
            if (activeRef.current?.id === record.id) continue;
            const remote = remoteValue
              ? normalize({ ...(remoteValue as object), id: record.id })
              : null;
            if (remote) {
              const resolution = resolveCloudDocumentVersion(
                local,
                remote,
                canvasContentSignature,
                documentRevisionSignature,
              );
              if (resolution === "same") {
                await removePendingCloudSync(record.id, pending.revision);
                continue;
              }
              // A background outbox has no retained common ancestor. Timestamp
              // ordering alone cannot prove that the local document contains
              // the newer cloud edits, so never replace a divergent document
              // wholesale. Opening the canvas exposes its recovery/merge flow.
              continue;
            }
            const delivered = await syncCloudDocument(persisted);
            checkAccount();
            if (delivered) onCloudSynced(delivered);
          } catch (cause) {
            checkAccount();
            const failure = platformFailure(cause);
            if (failure.kind === "login") {
              requireLogin(failure.message);
              return;
            }
          }
        }
      } catch (cause) {
        if (!current()) return;
        const failure = platformFailure(cause);
        if (failure.kind === "login") requireLogin(failure.message);
      }
    })().finally(() => {
      if (pendingSyncRun.current === request) pendingSyncRun.current = null;
    });
    pendingSyncRun.current = request;
    return request;
  }, [checkAccount, onCloudSynced, requireLogin, workspaceReady]);
  React.useEffect(() => {
    if (platformReady && workspaceReady) void resumePendingCloudSync();
  }, [platformReady, platformRevision, resumePendingCloudSync, workspaceReady, active?.id]);
  React.useEffect(() => {
    const resume = () => {
      if (navigator.onLine && platformReadyRef.current && workspaceReady)
        void resumePendingCloudSync();
    };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [resumePendingCloudSync, workspaceReady]);
  React.useEffect(() => {
    if (!sidebarOpen) {
      cloudListAttempted.current = false;
      return;
    }
    if (!platformReady || cloudReady.current || cloudListAttempted.current) return;
    cloudListAttempted.current = true;
    void refreshCloud();
  }, [sidebarOpen, platformReady]);
  const mirrorManagement = async (id: string, previous: Document | null) => {
    // Persistent browser storage can sync an individual document directly;
    // only session-only storage depends on the full cloud hydration pass.
    if (!platformReadyRef.current || (isSessionOnlyStorage() && !cloudReady.current)) {
      setNotice(isSessionOnlyStorage() ? "云端未连接，当前操作仅在此页面保留。请重试同步或导出后再关闭。" : "已保存到本机。云端未连接，其他设备的画布尚未更新。");
      return;
    }
    try {
      const value = await getCanvas<Document>(id);
      const synced = value ? await syncCloudDocument(
          value,
          Promise.resolve(),
          previous || undefined,
        ) : false;
      if (synced) onCloudSynced(synced);
    } catch (cause) {
      if (live.current) {
        const failure = platformFailure(cause);
        if (failure.kind === "login") requireLogin(failure.message);
        setNotice(`${isSessionOnlyStorage() ? "当前操作尚未同步，请保留页面或导出备份" : "本机操作已完成"}；${describe(cause)}`);
      }
    }
  };
  const rename = async (id: string, name: string) => {
    const current = activeRef.current?.id === id ? editor.current : null;
    const previous = current
      ? await current.flush()
      : await getCanvas<Document>(id);
    if (current) await current.rename(name);
    else {
      await renameCanvas(id, name);
      const updated = await getCanvas<Document>(id);
      if (updated) markLocalSave(updated);
    }
    await reloadList();
    // The mounted editor keeps its own explicit cloud-version choice and autosaves it.
    if (!current) void mirrorManagement(id, previous);
  };
  const duplicate = async (id: string) => {
    const source =
      activeRef.current?.id === id && editor.current
        ? await editor.current.flush()
        : await readDocument(id);
    const copy = copyCanvasDocument(source, freshId(), timestamp());
    await saveCanvas(copy);
    markLocalSave(copy);
    await reloadList();
    setNotice(`已创建「${copy.name}」。`, { label: "打开副本", run: () => void execute(() => navigate(copy.id)) });
    void mirrorManagement(copy.id, null);
  };
  const trash = async (id: string) => {
    const isActive = activeRef.current?.id === id;
    const list = await listCanvases();
    const next = isActive
      ? list.find((item) => item.id !== id && !item.deletedAt)
      : null;
    const nextDocument = next ? await readDocument(next.id) : null;
    if (isActive) await prepareSwitch();
    const previous = await getCanvas<Document>(id);
    await setCanvasDeleted(id, true);
    const deleted = await getCanvas<Document>(id);
    if (deleted) markLocalSave(deleted);
    if (isActive) activate(nextDocument, true);
    await reloadList();
    setNotice("已移入回收站。", { label: "撤销", run: () => void execute(async () => {
      const deleted = await getCanvas<Document>(id);
      await setCanvasDeleted(id, false);
      const restored = await getCanvas<Document>(id);
      if (restored) markLocalSave(restored);
      await reloadList();
      void mirrorManagement(id, deleted);
      if (isActive) await navigate(id);
    }) });
    void mirrorManagement(id, previous);
  };
  const drainHistory = () => {
    if (
      !platformReadyRef.current ||
      operation.current ||
      !pendingHistory.current
    )
      return;
    const target = pendingHistory.current;
    pendingHistory.current = null;
    void execute(() => navigate(target.id, true));
  };
  const openInitial = async () => {
    // The platform gate already owns the initial startup state. Mark the
    // workspace busy only after admission, so the canvas loader cannot flash
    // underneath or after the gate during the same bootstrap.
    setLoading(true);
    setLoadingDismissed(false);
    if (loadingDismissTimer.current !== null) {
      window.clearTimeout(loadingDismissTimer.current);
      loadingDismissTimer.current = null;
    }
    await migrateLegacy(normalize);
    const revealLibrary = location.hash === "#/canvases";
    let list = await reloadList();
    let cloudDiscoverySucceeded = cloudReady.current;
    if (
      !cloudReady.current &&
      (isSessionOnlyStorage() || revealLibrary || !list.some(item => !item.deletedAt))
    ) {
      cloudListAttempted.current = true;
      cloudDiscoverySucceeded = await refreshCloud();
      list = await reloadList();
      if (isSessionOnlyStorage() && !cloudDiscoverySucceeded) {
        setSidebarOpen(true);
        setError("云端画布未能加载，请重试后再创建画布。");
        setLoading(false);
        throw new Error("云端画布未能加载，请重新加载后继续。");
      }
    }
    const requested = requestedDocument.current || routeId();
    let failure = "";
    let value: Document | null = null;
    if (requested) {
      try {
        value = await readDocument(requested);
      } catch (cause) {
        failure = describe(cause);
        requestedDocument.current = requested;
        // A shared canvas link may only exist in this user's cloud library.
        if (!(await getCanvas(requested)) && !cloudListAttempted.current) {
          cloudListAttempted.current = true;
          cloudDiscoverySucceeded = await refreshCloud();
          list = await reloadList();
          try {
            value = await readDocument(requested);
            failure = "";
          } catch (cause) {
            failure = describe(cause);
          }
        }
      }
    }
    const fallback = list.find((item) => !item.deletedAt)?.id;
    if (!value && fallback) value = await readDocument(fallback);
    if (
      !value &&
      list.length === 0 &&
      !requested &&
      cloudDiscoverySucceeded
    ) {
      value = blankDocument();
      await saveCanvas(value);
      await reloadList();
      if (isSessionOnlyStorage()) await mirrorManagement(value.id, null);
    }
    if (!value && !cloudDiscoverySucceeded && !cloudReady.current) {
      failure ||= "云端画布暂时无法读取，请重试后再创建画布。";
    }
    if (live.current) {
      activate(value, true);
      if (requested && value?.id !== requested) {
        requestedDocument.current = requested;
        setRoute(requested, true);
      }
      if (!value) setLoading(false);
      if (revealLibrary) setSidebarOpen(true);
      if (failure) {
        setError(failure);
        setSidebarOpen(true);
      }
    }
  };
  const retryLibrary = async () => {
    await reloadList();
    const discovered = await refreshCloud();
    // A failed open records the clicked ID. Retry that exact document even if
    // the broad cloud listing is still unavailable; the targeted read may
    // recover it while avoiding another blank/new-canvas state.
    if (requestedDocument.current) {
      await navigate(requestedDocument.current, true);
    } else if (discovered && !activeRef.current) {
      await openInitial();
    }
  };
  React.useEffect(() => {
    live.current = true;
    operation.current = true;
    void (async () => {
      try {
        await openInitial();
      } catch (cause) {
        if (live.current) {
          setError(describe(cause));
          setSidebarOpen(true);
        }
      } finally {
        operation.current = false;
        if (live.current) {
          if (!activeRef.current) {
            // There is no editor to reveal after a failed bootstrap. Show the
            // empty/error state immediately instead of fading to a blank veil.
            setLoadingDismissed(false);
            setLoading(false);
          }
        }
        if (!live.current) setLoading(false);
        drainHistory();
        if (live.current) setWorkspaceReady(true);
      }
      // Do not enumerate every cloud canvas during a normal local-storage
      // bootstrap. The active document is hydrated by App; full discovery is
      // still used for session-only storage and explicit cloud refreshes.
      if (live.current && isSessionOnlyStorage() && !cloudReady.current) void refreshCloud();
    })();
    const pop = () => {
      requestedDocument.current = routeId();
      pendingHistory.current = { id: routeId() };
      drainHistory();
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("hashchange", pop);
    return () => {
      live.current = false;
      if (loadingDismissTimer.current !== null) {
        window.clearTimeout(loadingDismissTimer.current);
        loadingDismissTimer.current = null;
      }
      window.removeEventListener("popstate", pop);
      window.removeEventListener("hashchange", pop);
    };
  }, []);
  React.useEffect(() => {
    if (!platformReady || !loading || !active) return;

    // Let React commit and paint the editor beneath the veil before starting
    // the fade. Without two frames, the loader can begin fading in the same
    // commit that mounts the editor and still look like a hard replacement.
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (!live.current || !activeRef.current) return;
        setLoadingDismissed(true);
        if (loadingDismissTimer.current !== null) {
          window.clearTimeout(loadingDismissTimer.current);
        }
        loadingDismissTimer.current = window.setTimeout(() => {
          loadingDismissTimer.current = null;
          if (live.current) {
            setLoadingDismissed(false);
            setLoading(false);
          }
        }, CANVAS_LOADING_SETTLE_MS);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [active, loading, platformReady]);
  React.useEffect(() => () => {
    clearCanvasSwitchTimers();
    switchTargetRef.current = null;
  }, []);
  React.useEffect(() => {
    if (!platformReady) {
      cloudReady.current = false;
      cloudListAttempted.current = false;
      return;
    }
    if (lastPlatformRevision.current !== platformRevision) {
      lastPlatformRevision.current = platformRevision;
      void (async () => {
        await refreshCloud();
        // In an opaque/session-only frame the first boot may have stopped at
        // the login gate. Complete the normal library bootstrap after login
        // instead of leaving the workspace on an empty screen.
        if (live.current && !activeRef.current && cloudReady.current)
          await openInitial();
        drainHistory();
      })().catch((cause) => {
        if (live.current) {
          setError(describe(cause));
          setSidebarOpen(true);
        }
      });
    }
  }, [platformReady, platformRevision]);
  React.useEffect(() => {
    const media = matchMedia("(max-width: 900px)");
    const change = () => {
      setMobile(media.matches);
      if (media.matches) setSidebarOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  React.useEffect(() => {
    const element = editorElement.current;
    if (element) element.inert = mobile && sidebarOpen;
    if (panel.current) panel.current.inert = !sidebarOpen;
    if (!mobile || !sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      panel.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      if (element) element.inert = false;
      if (previous?.isConnected) previous.focus();
    };
  }, [mobile, sidebarOpen]);
  React.useEffect(() => {
    if (!sidebarOpen || mobile) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || panel.current?.contains(target)) return;
      if (target.closest('[aria-controls="canvas-library-panel"]')) return;
      setSidebarOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [mobile, sidebarOpen]);
  const closeSidebar = () => {
    setSidebarOpen(false);
    requestAnimationFrame(() =>
      editorElement.current
        ?.querySelector<HTMLButtonElement>(
          '[aria-controls="canvas-library-panel"]',
        )
        ?.focus(),
    );
  };
  const sidebarKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeSidebar();
      return;
    }
    if (
      !mobile ||
      event.key !== "Tab" ||
      !panel.current?.contains(event.target as Node)
    )
      return;
    const elements = Array.from(
      panel.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ),
    ).filter((el) => el.getClientRects().length);
    const first = elements[0],
      last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  // The editor mounts underneath the veil as soon as the first document is
  // ready. Keeping the veil until its opacity transition completes prevents a
  // hard visual jump and still leaves the platform gate responsible for the
  // pre-login/session state.
  const showLoadingVeil = platformReady && loading;

  return (
    <div className={`canvas-workbench${sidebarOpen ? " sidebar-open" : ""}${reduceMotion ? " canvas-reduce-motion" : ""}`}>
      {notice && <div className="workspace-toast" role="status"><span>{notice.text}</span>
        {notice.action && <button type="button" className="toast-action" onClick={() => { setNotice(""); notice.action?.run(); }}>{notice.action.label}</button>}
        <button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
      {mobile && (
        <button
          className="canvas-library-scrim"
          aria-label="关闭画布列表"
          aria-hidden={!sidebarOpen}
          onClick={closeSidebar}
          tabIndex={-1}
        />
      )}
      <div
        id="canvas-library-panel"
        className="canvas-library-panel"
        aria-hidden={!sidebarOpen}
        ref={panel}
        data-canvas-management=""
        onKeyDown={sidebarKey}
      >
        <CanvasLibrary
          activeId={active?.id || null}
          onClose={closeSidebar}
          items={items}
          cloudStatuses={cloudStatuses}
          loading={loading}
          busy={busy || loading}
          discovering={cloudListing}
          discoveryError={cloudListError}
          error={error}
          notice=""
          onNotice={(text, action) => setNotice(text, action)}
          onRetry={() => void execute(retryLibrary)}
          onCreate={(name) => void execute(() => create(name))}
          onImport={importFile}
          onOpen={(id) => void execute(() => navigate(id))}
          onRename={(id, name) => void execute(() => rename(id, name))}
          onDuplicate={(id) => void execute(() => duplicate(id))}
          onTrash={(id) => void execute(() => trash(id))}
          onRestore={(id) =>
            void execute(async () => {
              const previous = await getCanvas<Document>(id);
              await setCanvasDeleted(id, false);
              const restored = await getCanvas<Document>(id);
              if (restored) markLocalSave(restored);
              await reloadList();
              setNotice("画布已恢复。", { label: "打开画布", run: () => void execute(() => navigate(id)) });
              void mirrorManagement(id, previous);
            })
          }
        />
      </div>
      <div className="canvas-workbench-editor" ref={editorElement}>
        {active && (
          <div className={`canvas-editor-enter${loadingDismissed ? " is-revealing" : ""}${switchReadyId === active.id ? " is-switching" : ""}`}>
            <App
              key={active.id}
              initialDocument={active}
              registerEditor={registerEditor}
              registerAgentHandlers={registerEditorAgent}
              libraryOpen={sidebarOpen}
              isSwitchingCanvas={Boolean(switchIndicator)}
              onToggleLibrary={() => setSidebarOpen((open) => !open)}
              onCanvasInteraction={() => {
                if (sidebarOpen) setSidebarOpen(false);
              }}
              onReady={onEditorReady}
              onSaved={onSaved}
              onCloudSynced={onCloudSynced}
            />
          </div>
        )}
        {switchIndicator && switchIndicator.phase !== "pending" && (
          <div
            className={`canvas-switch-indicator is-${switchIndicator.phase}`}
            role="status"
            aria-live="polite"
            aria-label={`${switchIndicator.message}${switchIndicator.name ? `：${switchIndicator.name}` : ""}`}
          >
            <LoaderCircle size={15} aria-hidden="true" />
            <span>{switchIndicator.message}</span>
            <strong>{switchIndicator.name}</strong>
          </div>
        )}
        {showLoadingVeil && (
          <div className={`canvas-workbench-empty is-loading${loadingDismissed ? " is-dismissing" : ""}`}>
            <CanvasLoadingIndicator />
          </div>
        )}
        {!active && !showLoadingVeil && (
          <div className="canvas-workbench-empty">
            <button
              className="library-back"
              aria-label="管理画布"
              aria-expanded={sidebarOpen}
              aria-controls="canvas-library-panel"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <PanelLeftOpen size={18} /> 我的画布
            </button>
            <div>
              <h1>开始下一张画布</h1>
              <p>在左侧打开或恢复已有画布，也可以新建开始创作。</p>
              <button
                className="library-button library-button-primary"
                disabled={busy}
                onClick={() => void execute(() => create())}
              >
                <Plus size={16} /> 新建空白画布
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
