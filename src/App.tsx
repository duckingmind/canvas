import { storageDocument } from "./cloud-document.ts";
export { storageDocument } from "./cloud-document.ts";
import { beforeLocalAccountChange, captureLocalStorageScope } from "./local-storage-scope.ts";
import React from "react";
import { registerCanvasCapabilities } from "./agent-registration";
import { createCanvasAgent, type CanvasAgentAdapter } from "./agent-capabilities";
import { boundedMediaBlob, mediaFailure, AGENT_MEDIA_MAX_BYTES } from "./agent-media";
import { flushSync } from "react-dom";
import { agent, type AppProfile, type AppSdkError } from "@ducking-mind/proxy-app-sdk";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Copy,
  FileImage,
  Film,
  Music2,
  FolderOpen,
  Hand,
  ImagePlus,
  Link2,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Redo2,
  Upload,
  X,
  Layers,
  Layers2,
  SlidersHorizontal,
  Scan,
  LocateFixed,
  LayoutGrid,
  Map as MapIcon,
  Images,
  Keyboard,
  MoreHorizontal,
  RefreshCw,
  ArrowRight,
  Clock3,
  Download,
  PanelLeftClose,
  Image as ImageIcon,
  ImageOff,
  CircleAlert,
} from "lucide-react";
import { clampZoom, displayGridStep, fitViewport, zoomAt, zoomIndicatorPosition, minimapBounds, arrangeNodes, connectorPath, connectorPortSide, magneticPortDistance, magneticRadiusForZoom, nearestMagneticPort, dragThreshold, wheelViewport, pinchViewport, isRectInViewport, MAX_ZOOM, MIN_ZOOM, type PortSide } from "./geometry";
import { ViewportMotion, type ViewportMotionMode } from "./viewport-motion";
import { generateImage, ImageGenerationError } from "./generation";
import { resolveImageSettings } from "./image-models";
import { catalogModels, compatibleModels, mediaReferenceLimit, modelsForType, preferredModel, preferredModelForNode, resolveVideoSettings } from "./video-models";
import { cancelVideo, generateVideo, readVideoTask, VideoGenerationError } from "./video-generation";
import { cancelMusic, generateMusic, MusicGenerationError } from "./music-generation";
import { catalogMusicModels, compatibleMusicModels, musicModelUnavailableReason, musicModels, preferredMusicModel, resolveMusicSettings } from "./music-models";
import { catalogVoiceDesignModels, compatibleVoiceDesignModels, preferredVoiceDesignModel } from "./voice-design-models";
import { cancelVoiceDesign, generateVoiceDesign, VoiceDesignError } from "./voice-design";
import { LOCAL_AUDIO_MAX_BYTES, storeLocalAudio, readLocalAudio, deleteLocalAudio } from "./audio-cache";
import { packageCanvasAudio } from "./audio-backup";
import { isLocalVideoKey, LOCAL_VIDEO_MAX_BYTES, storeLocalVideo, readLocalVideo, deleteLocalVideo } from "./video-cache";
import { packageCanvasVideo } from "./video-backup";
import { readMusicReferenceAudioBase64, readMusicReferenceAudioDuration, validateMusicReferenceAudio } from "./music-reference-audio";
import { localMediaDataUrl } from "./local-media-reference";
import { audioCreationInputs, audioCreationSignature, isLocalAudioKey, isTTSNode, isVoiceDesignNode, normalizeMusicReference, normalizeMusicSubmission, normalizeTTSSettings, normalizeTTSSubmission, normalizeVoiceDesignSubmission } from "./audio-creation";
import { generateMusicLyrics } from "./music-lyrics";
import { mediaTaskPublicState } from "./shared/media-task-state.ts";
import type { VoiceDesignSubmission } from "./canvas-types";
import type { VideoReference, VideoReferenceInput } from "./video-generation";
import { readVideoSourceBlob, resolveVideoSource, videoSourceNeedsRefresh, type ResolvedVideoSource } from "./video-source";
import { canCreateNewCanvasTask, canLoadVideoContent, canvasTaskRetryPolicy, canvasTaskState, isTaskCancelled, pendingTaskLabel, videoTaskSnapshotPatch } from "./video-task-state";
import { extractVideoPoster } from "./video-poster";
import { completedVideoMedia, replaceVideoNodeMedia, sameVideoNodeSource, VideoAutoRecoveryGuard, VideoNodeSourceGuard, videoAutoRecoveryKey, type VideoNodeSourceToken } from "./video-node-media";
import { fitVideoNodeSize, videoAspectRatio } from "./video-layout";
import { formatVideoTime, isVideoPlayerGlobalShortcut, type CapturedVideoFrame } from "./video-player";
import { cacheRemoteImage, getCachedRemoteImage, readCachedImage, storeInlineImages, restoreLocalImages } from "./image-cache";
import { immutableImageUrlIdentity, isTemporaryMediaUrl, mediaUrlNeedsRefresh } from "./media-url-cache.ts";
import { readHostCachedImage } from "./host-image-cache";
import { recoverImageDelivery, recoveredImageOriginal } from "./image-delivery";
import {
  ImageRecoveryGuard,
  mapTaskImageResults,
  matchStoredImageAsset,
  mediaUrlIdentity,
} from "./image-recovery";
import CreatorPanel from "./CreatorPanel";
import TaskFailureNotice from "./TaskFailureNotice";
import { TaskRecoverySchedule } from "./task-recovery";
import NoteNodePreview from "./NoteNodePreview";
import HandDrawModal from "./HandDrawModal";
import MediaPreview from "./MediaPreview";
import { imageOriginalURL, imagePreviewURL, isCosImageURL } from "./image-variants";
import ImageTools, { type ImageToolOutput } from "./ImageTools";
import VideoTools from "./VideoTools";
import MediaToolMenu, { type MediaToolMenuGroup } from "./MediaToolMenu";
import { videoOutputExtension, type VideoEditOptions } from "./video-editing";
import AudioTools from "./AudioTools";
import { exportAudioEdit, MAX_AUDIO_EDIT_INPUT_BYTES } from "./audio-editing";
import { decodeAudioWaveform, MAX_AUDIO_WAVEFORM_DURATION_SECONDS, MAX_AUDIO_WAVEFORM_INPUT_BYTES } from "./audio-waveform-browser";
import { isDurableAssetUrl } from "./asset-library";
import { mediaNavigation } from "./media-navigation";
import { touchRetainedMediaNode } from "./media-retention";
import { mediaTaskUserFailure } from "./shared/media-diagnostics.ts";
import { isComposingKey, zoomShortcutDirection } from "./keyboard";
import CanvasVideo, { type VideoProcessRequest } from "./CanvasVideo";
import CanvasMediaPlayer from "./CanvasMediaPlayer";
import { audioSourceIdentity, canLoadAudioContent } from "./audio-source";
import { useAudioSources } from "./useAudioSources";
import { alignmentGuides } from "./alignment-guides";
import { createCanvasNotificationGate } from "./canvas-notifications";
import { useTransientNotice } from "./useTransientNotice";
import { cloudSyncFeedback, initialCloudSyncFeedback } from "./cloud-sync-feedback";
import { creationInputSignature, placeCreatorPanel } from "./creation-state";
import { resolveCanvasNodeRole } from "./creator-node-role";
import { platformFailure } from "./platform-status";
import { normalizePlatformProfile } from "./platform-profile";
import { diagnosticErrorFields, recordCanvasDiagnostic } from "./client-diagnostics.ts";
import { resolveCloudDocumentVersion } from "./cloud-version";
import { usePlatformAccess } from "./PlatformGate";
import { client } from "./platform-client";
import { fetchCanvasResource, setCanvasGatewayURL } from "./network-boundary.ts";
import { composePrompt, composePromptWithIndex, createWorkflowIndex, findFreePosition, isWorkflowTextReference } from "./workflow";
import {
  normalizeVideoSubmission,
  resolveTaskId,
  taskRecoveryKey,
  type VideoSubmission,
} from "./task-lifecycle";
import {
  canReceiveNodeConnection,
  canStartNodeConnection,
  getNodeInteraction,
  hasPendingNodeTask,
  isCompletedMediaNode as isCompletedMediaNodeByPolicy,
  nodeHasMediaContent,
  canUseNodePortSide,
  type NodeInteractionContext,
} from "./node-interaction";
import {
  frameForGroupNodes,
  rebuildGroupState as rebuildGroupStateFromNodes,
  regroupNodes,
  selectionForGroupMember,
  ungroupNodes,
} from "./group-interaction";
import type {
  CanvasNode,
  Document,
  Edge,
  GroupFrame,
  Model,
  MediaType,
  NodeType,
  Point,
  StorageUsage,
  StoredAsset,
  Tool,
  Viewport,
} from "./canvas-types";
import type { CanvasEditorHandle } from "./editor-contract";
import { writeDraft, readDraft, isSessionOnlyStorage, markSessionSynced } from "./draft-store";
import { reconcileHistoryNodes, restoreGeometry } from "./history";
import { saveCanvas } from "./library-store";
import { PresenceLayer } from "./motion";
import { useDockPanelPosition } from "./useDockPanelPosition";
import CanvasSettingsPanel from "./CanvasSettingsPanel";
import ClientDiagnosticsPanel from "./ClientDiagnosticsPanel";
import AssetLibraryPanel from "./AssetLibraryPanel";
import ApplicationMediaManager from "./ApplicationMediaManager";
import AssetSaveModal from "./AssetSaveModal";
import { useAssetLibrary } from "./useAssetLibrary";
import { usePromptMentionAssets, type PromptMentionAssetCandidate } from "./usePromptMentionAssets";
import { nodeFromLibraryAsset, reusableNodeKind } from "./asset-nodes";
import { readPlatformAsset, uploadPlatformAsset } from "./platform-asset-library";
import { loadCanvasPreferences, resetCanvasPreferences, saveCanvasPreferences, type CanvasPreferences } from "./canvas-preferences";
import {
  captureDocumentStorageSession,
  readCanvasDocument,
  saveCanvasDocument,
} from "./document-storage";
export { client } from "./platform-client";

const DEFAULT_AUDIO_NODE_SIZE = { width: 360, height: 132 } as const;

async function imageDataBlob(source: string): Promise<Blob> {
  const response = await fetchCanvasResource(source, undefined, { gatewayURL: client.session()?.gateway_url });
  if (!response.ok) throw new Error("图片内容读取失败");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || !blob.size) throw new Error("图片内容无效");
  return blob;
}

async function imageBlobAsPNG(blob: Blob): Promise<Blob> {
  if (blob.type.toLowerCase() === "image/png") return blob;
  const bitmap = typeof createImageBitmap === "function"
    ? await createImageBitmap(blob)
    : await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(blob);
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片解码失败")); };
        image.src = url;
      });
  const width = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
  const height = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
  if (!width || !height) {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
    throw new Error("图片尺寸无效");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
    throw new Error("当前浏览器不支持图片复制");
  }
  context.drawImage(bitmap, 0, 0);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  const png = await new Promise<Blob | undefined>((resolve) => canvas.toBlob(
    (value) => resolve(value || undefined),
    "image/png",
  ));
  if (!png) throw new Error("图片转换失败");
  return png;
}

type AudioWaveformState = { id: string; identity: string; peaks: number[] };

function portPoint(
  node: Pick<CanvasNode, "x" | "y" | "width" | "height">,
  side: PortSide,
  position?: Point | number,
): Point {
  if (
    position &&
    typeof position === "object" &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y)
  ) {
    return { x: position.x, y: position.y };
  }
  const y = typeof position === "number" ? position : node.y + node.height / 2;
  return {
    x: side === "left" ? node.x : node.x + node.width,
    y: Math.max(node.y, Math.min(node.y + node.height, y)),
  };
}

/**
 * Keep a transient port anchored to the midpoint of its side and express the
 * magnetic position as a local transform offset.  Using left/top for the
 * pointer position makes the handle jump when the hover state is cleared;
 * transform is interpolated in both directions, so it returns to the edge
 * midpoint before opacity hides it.
 */
function transientPortStyle(
  node: Pick<CanvasNode, "x" | "y" | "width" | "height">,
  side: PortSide,
  position?: Point | null,
): React.CSSProperties {
  const centerY = node.y + node.height / 2;
  const edgeX = side === "left" ? node.x : node.x + node.width;
  const offsetX = position && Number.isFinite(position.x)
    ? position.x - edgeX
    : 0;
  const offsetY = position && Number.isFinite(position.y)
    ? position.y - centerY
    : 0;
  return {
    top: `${node.height / 2}px`,
    ["--port-offset-x" as string]: `${offsetX}px`,
    ["--port-offset-y" as string]: `${offsetY}px`,
  };
}
export type { CanvasNode, Document, Edge, GroupFrame, Model, NodeType, Point, StorageUsage, StoredAsset, Tool, Viewport } from "./canvas-types";
export type { CanvasEditorHandle } from "./editor-contract";

const W = 300,
  H = 180,
  COLORS = ["#e9b86f", "#72c9bb", "#8eb3e6", "#c19be8", "#ef8e88", "#c4ccd4"];

type ShortcutItem = { label: string; keys: string[] };
type ShortcutGroup = { title: string; items: ShortcutItem[] };

function isStorageUsage(value: unknown): value is StorageUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Partial<StorageUsage>;
  return [usage.used_bytes, usage.reserved_bytes, usage.quota_bytes, usage.available_bytes]
    .every(item => typeof item === "number" && Number.isFinite(item) && item >= 0)
    && typeof usage.status === "string" && usage.status.trim() !== "";
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "创作",
    items: [
      { label: "打开选中节点", keys: ["Enter"] },
      { label: "生成图片 / 视频", keys: ["⌘ / Ctrl", "Enter"] },
      { label: "添加文本节点", keys: ["T"] },
      { label: "重命名选中节点", keys: ["F2"] },
      { label: "创建节点副本", keys: ["⌘ / Ctrl", "D"] },
      { label: "复制 / 粘贴节点", keys: ["⌘ / Ctrl", "C / V"] },
      { label: "打组", keys: ["⌘ / Ctrl", "G"] },
      { label: "取消分组", keys: ["⌘ / Ctrl", "⇧ + G"] },
      { label: "追加选择", keys: ["Shift + 点击 / 框选"] },
    ],
  },
  {
    title: "缩放",
    items: [
      { label: "缩放画布", keys: ["双指捏合", "Ctrl / ⌘ + 滚轮"] },
      { label: "放大 / 缩小", keys: ["⌘ / Ctrl", "+ / −"] },
      { label: "适应画布", keys: ["⌘ / Ctrl", "0"] },
      { label: "触控板", keys: ["双指平移与缩放"] },
      { label: "鼠标", keys: ["⌘ / Ctrl + 滚轮"] },
    ],
  },
  {
    title: "移动画布",
    items: [
      { label: "移动 / 抓手", keys: ["V / H"] },
      { label: "临时平移画布", keys: ["Space + 拖动"] },
      { label: "平移画布", keys: ["双指滑动 / 滚轮 / 中键拖动"] },
      { label: "横向平移", keys: ["Shift + 滚轮"] },
      { label: "触屏操作", keys: ["单指移动 · 双指平移与缩放"] },
      { label: "自动整理", keys: ["⌥ / Alt", "⇧ + F"] },
    ],
  },
  {
    title: "其他",
    items: [
      { label: "撤销", keys: ["⌘ / Ctrl", "Z"] },
      { label: "重做", keys: ["⌘ / Ctrl", "⇧ + Z / Y"] },
      { label: "删除选中", keys: ["Delete / Backspace"] },
      { label: "取消手势 / 关闭面板", keys: ["Esc"] },
      { label: "保存画布", keys: ["⌘ / Ctrl", "S"] },
      { label: "全选", keys: ["⌘ / Ctrl", "A"] },
      { label: "创作描述换行", keys: ["Enter / Shift + Enter"] },
    ],
  },
];
// Keep viewport motion open long enough for the longest canvas entrance
// animation to resume on the next frame after a zoom/pan settles.
const VIEWPORT_MOTION_SETTLE_MS = 240;
const VIEWPORT_EXIT_DURATION_MS = 180;
const GROUP_EXIT_DURATION_MS = 180;
const PORT_EXIT_DURATION_MS = 180;
const viewportChanged = (previous: Viewport, next: Viewport) =>
  Math.abs((next.x || 0) - (previous.x || 0)) > 0.01 ||
  Math.abs((next.y || 0) - (previous.y || 0)) > 0.01 ||
  Math.abs((next.zoom || 1) - (previous.zoom || 1)) > 0.0005;
// Magnetic handles live in the canvas world, so their visual size and high-zoom
// activation range grow with the viewport, while low zoom keeps a usable
// minimum screen affordance.
const MAGNETIC_ENTER_RADIUS = 44;
const MAGNETIC_EXIT_RADIUS = 60;
const IMAGE_NODE_MAX_WIDTH = 360;
const IMAGE_NODE_MAX_HEIGHT = 600;
const ZOOM_RULER_TICKS = Array.from({ length: 25 }, (_, index) => index);
const ZOOM_FEEDBACK_DURATION = 850;
const now = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * Keep background media recovery from turning one canvas open into an
 * unbounded burst of requests. Results retain input order so callers can keep
 * their existing update logic while the transport stays bounded.
 */
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return [];
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Math.min(Math.max(1, Math.floor(concurrency)), values.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

/** Drag events expose a file payload inconsistently across browsers. During
 * dragenter/dragover the FileList can still be empty, so inspect both the
 * advertised types and DataTransferItem kinds. */
function hasFilePayload(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer) return false;
  if (dataTransfer.files?.length) return true;
  if (Array.from(dataTransfer.types || []).some((type) => type.toLowerCase() === "files")) return true;
  return Array.from(dataTransfer.items || []).some((item) => item.kind === "file");
}

function fitImageNodeSize(naturalWidth: number, naturalHeight: number) {
  const ratio = Number.isFinite(naturalWidth) && naturalWidth > 0 && Number.isFinite(naturalHeight) && naturalHeight > 0
    ? naturalHeight / naturalWidth
    : 1;
  let width = IMAGE_NODE_MAX_WIDTH;
  let height = width * ratio;
  if (height > IMAGE_NODE_MAX_HEIGHT) {
    height = IMAGE_NODE_MAX_HEIGHT;
    width = height / ratio;
  }
  return {
    width: Math.round(Math.max(120, width)),
    height: Math.round(Math.max(120, height)),
  };
}

type ImageNodeSize = { width: number; height: number };
const IMAGE_NODE_SIZE_CACHE_LIMIT = 128;
const imageNodeSizeRequests = new Map<string, Promise<ImageNodeSize>>();
const imageNodeSizeCache = new Map<string, ImageNodeSize>();

function imageNodeSizeCacheKey(src: string): string | undefined {
  if (!/^https?:\/\//i.test(src)) return undefined;
  // Signed URLs for the same immutable COS object share one measurement.
  return immutableImageUrlIdentity(src) || src;
}

function rememberImageNodeSize(key: string, size: ImageNodeSize): void {
  imageNodeSizeCache.delete(key);
  imageNodeSizeCache.set(key, size);
  while (imageNodeSizeCache.size > IMAGE_NODE_SIZE_CACHE_LIMIT) {
    const oldest = imageNodeSizeCache.keys().next().value;
    if (oldest === undefined) break;
    imageNodeSizeCache.delete(oldest);
  }
}

function readImageNodeSize(src: string): Promise<ImageNodeSize> {
  const key = imageNodeSizeCacheKey(src);
  if (key) {
    const cached = imageNodeSizeCache.get(key);
    if (cached) {
      imageNodeSizeCache.delete(key);
      imageNodeSizeCache.set(key, cached);
      return Promise.resolve(cached);
    }
    const existing = imageNodeSizeRequests.get(key);
    if (existing) return existing;
  }
  const request = new Promise<ImageNodeSize>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const size = fitImageNodeSize(image.naturalWidth, image.naturalHeight);
      if (key) rememberImageNodeSize(key, size);
      resolve(size);
    };
    // Keep the historical safe fallback for callers that need layout to
    // continue, but do not retain a failed URL forever. A later refresh can
    // retry the source instead of being stuck with a 1×1 measurement.
    image.onerror = () => resolve(fitImageNodeSize(1, 1));
    image.src = src;
  });
  if (key) {
    imageNodeSizeRequests.set(key, request);
    void request.then(
      () => imageNodeSizeRequests.delete(key),
      () => imageNodeSizeRequests.delete(key),
    );
  }
  return request;
}

const initial: Document = {
  id: "legacy-workspace",
  createdAt: now(),
  name: "未命名画布",
  nodes: [
    {
      id: "brief",
      type: "note",
      title: "创作 brief",
      text: "把想法拆成可执行的画面与生成任务。",
      x: 70,
      y: 70,
      width: W,
      height: H,
      color: COLORS[0],
    },
    {
      id: "prompt",
      type: "prompt",
      title: "提示词",
      text: "一张有电影感的城市黄昏海报，留出标题区域。",
      x: 490,
      y: 170,
      width: W,
      height: H,
      color: COLORS[2],
    },
  ],
  edges: [{ id: "edge-1", from: "brief", to: "prompt" }],
  viewport: { x: 0, y: 0, zoom: 1 },
  updatedAt: now(),
};

export function normalize(value: unknown): Document {
  if (!value || typeof value !== "object") return clone(initial);
  const source = value as Partial<Document> & { title?: string };
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const usedIds = new Set<string>();
  const nodes: CanvasNode[] = rawNodes
    .filter((node): node is CanvasNode =>
      Boolean(node && typeof node === "object"),
    )
    .map((raw, index): CanvasNode => {
      const node = raw as CanvasNode & {
        kind?: string;
        videoTaskId?: unknown;
        video_task_id?: unknown;
      };
      const requestedId =
        typeof node.id === "string" && node.id ? node.id : `node-${index}`;
      const id = usedIds.has(requestedId) ? uid("node") : requestedId;
      usedIds.add(id);
      const rawType = node.type || node.kind;
      const type: NodeType =
        rawType === "prompt"
          ? "prompt"
          : rawType === "image"
            ? "image"
            : rawType === "video"
              ? "video"
              : rawType === "audio"
                ? "audio"
            : "note";
      const {
        image: rawImage,
        video: rawVideo,
        audio: rawAudio,
        videoTaskId: _legacyVideoTaskId,
        video_task_id: _legacyVideoTaskIdSnake,
        ...rest
      } = node;
      const hasStoredMedia =
        ((type === "image" || type === "prompt") && typeof rawImage === "string" && rawImage.length > 0) ||
        ((type === "video" || type === "prompt") && typeof rawVideo === "string" && rawVideo.length > 0) ||
        ((type === "video" || type === "prompt") && isLocalVideoKey(node.localVideo)) ||
        ((type === "video" || type === "prompt") && typeof node.videoContentUrl === "string" && node.videoContentUrl.length > 0) ||
        (["image", "video", "audio", "prompt"].includes(type) && typeof node.assetId === "string" && node.assetId.length > 0) ||
        ((type === "audio" || (type === "prompt" && node.mediaType === "audio")) && (typeof rawAudio === "string" && rawAudio.length > 0 || isLocalAudioKey(node.localAudio)));
      const legacyTaskSize = (node.width === 300 && node.height === 180) || (node.width === 480 && node.height === 270);
      const legacyVideoTaskId = resolveTaskId({
        videoTaskId: node.videoTaskId,
        video_task_id: node.video_task_id,
      });
      const normalizedVideoSubmission = normalizeVideoSubmission(node.videoSubmission);
      const normalizedMusicSubmission = normalizeMusicSubmission(node.musicSubmission);
      const normalizedVoiceSubmission = normalizeVoiceDesignSubmission(node.voiceDesignSubmission);
      const normalizedTTSSubmission = normalizeTTSSubmission(node.ttsSubmission);
      const hasVideoSnapshot = type === "video" ||
        isLocalVideoKey(node.localVideo) ||
        typeof rawVideo === "string" ||
        typeof node.videoContentUrl === "string" ||
        Boolean(normalizedVideoSubmission) ||
        Boolean(legacyVideoTaskId);
      const normalizedTaskId = resolveTaskId(node);
      const hasImageSubmission = Boolean(node.submission &&
        typeof node.submission.key === "string" &&
        typeof node.submission.model === "string" &&
        typeof node.submission.prompt === "string" &&
        Array.isArray(node.submission.images));
      const hasTaskSnapshot = Boolean(normalizedTaskId || normalizedVideoSubmission || normalizedMusicSubmission || normalizedVoiceSubmission || normalizedTTSSubmission || hasImageSubmission);
      const normalizedStatus = ["idle", "queued", "running", "completed", "failed"].includes(node.status || "")
        ? node.status
        : hasTaskSnapshot
          ? hasStoredMedia ? "completed" as const : "queued" as const
          : undefined;
      const mediaWidth = type === "prompt" && hasStoredMedia && legacyTaskSize
        ? node.mediaType === "video" || typeof rawVideo === "string" || typeof node.videoContentUrl === "string" ? 420 : 360
        : Number.isFinite(node.width) ? node.width : W;
      const mediaHeight = type === "prompt" && hasStoredMedia && legacyTaskSize
        ? node.mediaType === "video" || typeof rawVideo === "string" || typeof node.videoContentUrl === "string" ? 260 : 360
        : Number.isFinite(node.height) ? node.height : H;
      return {
        ...rest,
        id,
        type,
        title:
          typeof node.title === "string"
            ? node.title.slice(0, 160)
            : "未命名节点",
        text: typeof node.text === "string" ? node.text.slice(0, 50000) : "",
        x: Number.isFinite(node.x) ? node.x : 80,
        y: Number.isFinite(node.y) ? node.y : 80,
        width: Math.min(1600, Math.max(120, mediaWidth)),
        height: Math.min(1200, Math.max(80, mediaHeight)),
        color: typeof node.color === "string" ? node.color : COLORS[0],
        ...((type === "image" || type === "prompt") && typeof rawImage === "string"
          ? { image: rawImage }
          : {}),
        ...((type === "video" || type === "prompt") && typeof rawVideo === "string" && !rawVideo.startsWith("blob:")
          ? { video: rawVideo }
          : {}),
        localVideo: (type === "video" || type === "prompt") && isLocalVideoKey(node.localVideo) ? node.localVideo : undefined,
        ...((type === "audio" || (type === "prompt" && node.mediaType === "audio")) && typeof rawAudio === "string" && !rawAudio.startsWith("blob:") ? { audio: rawAudio } : {}),
        videoContentUrl: typeof node.videoContentUrl === "string" ? node.videoContentUrl : undefined,
        videoContentUrlExpiresAt: typeof node.videoContentUrlExpiresAt === "string" ? node.videoContentUrlExpiresAt : undefined,
        videoPoster: typeof node.videoPoster === "string" && node.videoPoster.startsWith("data:image/") ? node.videoPoster : undefined,
        imageThumbnail: typeof node.imageThumbnail === "string" && /^https?:\/\//i.test(node.imageThumbnail) ? node.imageThumbnail : undefined,
        localVideoPoster: typeof node.localVideoPoster === "string" ? node.localVideoPoster : undefined,
        embeddedReferences: Array.isArray(node.embeddedReferences)
          ? node.embeddedReferences.filter((ref): ref is { id: string; title: string; image?: string; imageThumbnail?: string; localImage?: string; video?: string; localVideo?: string; audio?: string; localAudio?: string; videoContentUrl?: string; videoContentUrlExpiresAt?: string; mediaType?: MediaType; assetId?: string } => Boolean(ref && typeof ref === "object" && typeof ref.id === "string" && typeof ref.title === "string" && (typeof ref.image === "string" || typeof ref.localImage === "string" || typeof ref.video === "string" || isLocalVideoKey(ref.localVideo) || typeof ref.audio === "string" || isLocalAudioKey(ref.localAudio) || typeof ref.videoContentUrl === "string" || typeof ref.assetId === "string"))).map((ref) => ({
              id: ref.id.slice(0, 120),
              title: ref.title.slice(0, 160),
              ...(ref.image ? { image: ref.image } : {}),
              ...(ref.imageThumbnail ? { imageThumbnail: ref.imageThumbnail } : {}),
              ...(ref.localImage ? { localImage: ref.localImage } : {}),
              ...(ref.video ? { video: ref.video } : {}),
              ...(isLocalVideoKey(ref.localVideo) ? { localVideo: ref.localVideo } : {}),
              ...(ref.audio ? { audio: ref.audio } : {}),
              ...(isLocalAudioKey(ref.localAudio) ? { localAudio: ref.localAudio } : {}),
              ...(ref.videoContentUrl ? { videoContentUrl: ref.videoContentUrl } : {}),
              ...(ref.videoContentUrlExpiresAt ? { videoContentUrlExpiresAt: ref.videoContentUrlExpiresAt } : {}),
              ...(ref.mediaType ? { mediaType: ref.mediaType } : {}),
              ...(ref.assetId ? { assetId: ref.assetId } : {}),
            }))
          : undefined,
        promptSegments: Array.isArray(node.promptSegments)
          ? node.promptSegments.filter((segment): segment is { type: "text"; text: string } | { type: "reference"; referenceId: string; label: string } => Boolean(segment && typeof segment === "object" && ((segment as { type?: unknown }).type === "text" && typeof (segment as { text?: unknown }).text === "string" || (segment as { type?: unknown }).type === "reference" && typeof (segment as { referenceId?: unknown }).referenceId === "string" && typeof (segment as { label?: unknown }).label === "string"))).map((segment) => segment.type === "text"
              ? { type: "text" as const, text: segment.text.slice(0, node.audioMode === "tts" ? 50000 : 20000) }
              : { type: "reference" as const, referenceId: segment.referenceId.slice(0, 120), label: segment.label.slice(0, 160) })
          : undefined,
        taskPrompt:
          typeof node.taskPrompt === "string" ? node.taskPrompt : undefined,
        generationBatchId:
          typeof node.generationBatchId === "string" && node.generationBatchId.length <= 120
            ? node.generationBatchId
            : undefined,
        inputSignature:
          typeof node.inputSignature === "string" &&
          /^v1:[a-f0-9]{16}$/.test(node.inputSignature)
            ? node.inputSignature
            : undefined,
        error: typeof node.error === "string" ? node.error : undefined,
        modelId: typeof node.modelId === "string" ? node.modelId : undefined,
        modelSelection: node.modelSelection === "user" || node.modelSelection === "default" ? node.modelSelection : undefined,
        mediaType:
          type === "audio" || node.mediaType === "audio"
            ? "audio"
            : node.mediaType === "video" ||
                (node.mediaType !== "image" && hasVideoSnapshot)
              ? "video"
              : "image",
        imageSettings: node.imageSettings && typeof node.imageSettings === "object" ? node.imageSettings : undefined,
        videoDuration: Number.isFinite(node.videoDuration) ? node.videoDuration : undefined,
        videoSize: typeof node.videoSize === "string" ? node.videoSize : undefined,
        videoResolution: typeof node.videoResolution === "string" ? node.videoResolution : undefined,
        videoAspectRatio: typeof node.videoAspectRatio === "string" ? node.videoAspectRatio : undefined,
        videoAudio: typeof node.videoAudio === "boolean" ? node.videoAudio : undefined,
        videoSettings: node.videoSettings && typeof node.videoSettings === "object" ? node.videoSettings : undefined,
        ignoreImageRefs: node.ignoreImageRefs === true,
        taskId: normalizedTaskId,
        submission:
          node.submission &&
          typeof node.submission.key === "string" &&
          typeof node.submission.model === "string" &&
          typeof node.submission.prompt === "string" &&
          Array.isArray(node.submission.images)
            ? {
                key: node.submission.key,
                model: node.submission.model,
                prompt: node.submission.prompt,
                images: node.submission.images.map((ref) => ({
                  image: typeof ref?.image === "string" ? ref.image : undefined,
                  localImage:
                    typeof ref?.localImage === "string"
                      ? ref.localImage
                      : undefined,
                  assetId: typeof ref?.assetId === "string" ? ref.assetId : undefined,
                })),
                ...(Number.isFinite(node.submission.count) ? { count: node.submission.count } : {}),
                ...(typeof node.submission.size === "string" ? { size: node.submission.size } : {}),
                ...(typeof node.submission.resolution === "string" ? { resolution: node.submission.resolution } : {}),
                ...(typeof node.submission.quality === "string" ? { quality: node.submission.quality } : {}),
                ...(typeof node.submission.aspectRatio === "string" ? { aspectRatio: node.submission.aspectRatio } : {}),
                ...(typeof node.submission.outputFormat === "string" ? { outputFormat: node.submission.outputFormat } : {}),
                ...(typeof node.submission.resultBatchId === "string" ? { resultBatchId: node.submission.resultBatchId } : {}),
              }
            : undefined,
        videoSubmission: normalizedVideoSubmission,
        musicSubmission: normalizedMusicSubmission,
        ttsSubmission: normalizedTTSSubmission,
        musicSettings: node.musicSettings && typeof node.musicSettings === "object" ? node.musicSettings : undefined,
        ttsSettings: normalizeTTSSettings(node.ttsSettings),
        musicLyrics: typeof node.musicLyrics === "string" ? node.musicLyrics.slice(0, 20000) : undefined,
        audioMode: ["music", "voice_design", "tts", "recording"].includes(node.audioMode || "") ? node.audioMode : normalizedTTSSubmission || node.audioTaskType === "tts" ? "tts" : normalizedVoiceSubmission || node.audioTaskType === "voice_design" ? "voice_design" : undefined,
        audioTaskType: node.audioTaskType === "tts" || normalizedTTSSubmission ? "tts" : node.audioTaskType === "voice_design" || normalizedVoiceSubmission ? "voice_design" : node.audioTaskType === "music" ? "music" : undefined,
        localAudio: isLocalAudioKey(node.localAudio) ? node.localAudio : undefined,
        musicReference: normalizeMusicReference(node.musicReference),
        voicePreviewText: typeof node.voicePreviewText === "string" ? [...node.voicePreviewText].slice(0, 500).join("") : undefined,
        voiceId: typeof node.voiceId === "string" ? node.voiceId.slice(0, 160) : undefined,
        voiceTrialAudioAvailable: typeof node.voiceTrialAudioAvailable === "boolean" ? node.voiceTrialAudioAvailable : undefined,
        voiceDesignSubmission: normalizedVoiceSubmission,
        videoPollingPaused: node.videoPollingPaused === true,
        videoPollingReason: node.videoPollingReason === "user" || node.videoPollingReason === "reconciliation" ? node.videoPollingReason : undefined,
        resultOf: typeof node.resultOf === "string" ? node.resultOf : undefined,
        resultIndex: typeof node.resultIndex === "number" && Number.isInteger(node.resultIndex) && node.resultIndex >= 0 ? node.resultIndex : undefined,
        resultBatchId: typeof node.resultBatchId === "string" && node.resultBatchId.length <= 120 ? node.resultBatchId : undefined,
        operationId: typeof node.operationId === "string" && node.operationId.length <= 80 ? node.operationId : undefined,
        operationParams: node.operationParams && typeof node.operationParams === "object"
          ? Object.fromEntries(Object.entries(node.operationParams).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))) as Record<string, string | number | boolean>
          : undefined,
        continuationOf: typeof node.continuationOf === "string" ? node.continuationOf : undefined,
        groupId: typeof node.groupId === "string" && node.groupId.length <= 120 ? node.groupId : undefined,
        status: normalizedStatus,
      };
    });
  // Inline @ references are durable only when they point at an image value
  // that still exists in the normalized document. Drop stale IDs while
  // loading a document so the editor cannot render a ghost chip or submit a
  // reference that the workflow can no longer resolve.
  const referenceImageIds = new Set(
    nodes
      .filter((node) => Boolean(
        (node.type === "image" || (node.type === "prompt" && (node.mediaType || "image") === "image")) &&
        (node.image || node.localImage || node.assetId || node.taskId),
      ))
      .map((node) => node.id),
  );
  const cleanedNodes = nodes.map((node) => {
    if (!node.promptSegments) return node;
    const embeddedIds = new Set((node.embeddedReferences || []).map((reference) => reference.id));
    const promptSegments = node.promptSegments.filter((segment) =>
      segment.type !== "reference" || referenceImageIds.has(segment.referenceId) || embeddedIds.has(segment.referenceId),
    );
    return promptSegments.length === node.promptSegments.length
      ? node
      : { ...node, promptSegments: promptSegments.length ? promptSegments : undefined };
  });
  const safeNodes = Array.isArray(source.nodes) ? cleanedNodes : clone(initial).nodes;
  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  const edges = Array.isArray(source.edges)
    ? source.edges
        .filter((edge): edge is Edge =>
          Boolean(edge && typeof edge === "object"),
        )
        .map((raw, index) => {
          const edge = raw as Edge & { source?: string; target?: string };
          const from = edge.from || edge.source || "",
            to = edge.to || edge.target || "",
            requestedId = edge.id || `edge-${index}`;
          if (
            !from ||
            !to ||
            from === to ||
            !safeNodes.some((node) => node.id === from) ||
            !safeNodes.some((node) => node.id === to) ||
            edgeIds.has(requestedId)
            || edgePairs.has(`${from}\u0000${to}`)
          )
            return null;
          edgeIds.add(requestedId);
          edgePairs.add(`${from}\u0000${to}`);
          return { id: requestedId, from, to };
        })
        .filter((edge): edge is Edge => Boolean(edge))
    : [];
  // Media nodes are produced values or source assets, so they never accept
  // incoming workflow edges. Keep the creator -> generated-result edge for
  // legacy multi-output canvases, while dropping stale image -> image/video
  // links that made the graph appear to connect unrelated cards.
  const validEdges = edges.filter((edge) => {
    const target = safeNodes.find((node) => node.id === edge.to);
    if (!target || (target.type !== "image" && target.type !== "video")) return true;
    const sourceNode = safeNodes.find((node) => node.id === edge.from);
    if (target.resultOf) return sourceNode?.type === "prompt" && edge.from === target.resultOf;
    // Older canvases may not have resultOf or stable result titles. An
    // outgoing prompt -> media edge with actual content is unambiguously a
    // generated result; reference images point in the opposite direction.
    return Boolean(sourceNode?.type === "prompt" && (
      hasMediaContent(target) ||
      target.title.startsWith(`${sourceNode.title} · 结果`) ||
      target.title === `${sourceNode.title} · 视频结果`
    ));
  });
  const repairedNodes = repairGeneratedLayout(
    inheritGeneratedGroupIds(safeNodes),
    validEdges,
  );
  const groups = normalizeGroupFrames(repairedNodes, source.groups);
  const viewport = source.viewport || initial.viewport;
  return {
    id:
      typeof source.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(source.id)
        ? source.id
        : uid("canvas"),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : now(),
    deletedAt:
      typeof source.deletedAt === "string" ? source.deletedAt : undefined,
    name:
      typeof source.name === "string" && source.name
        ? source.name
        : typeof source.title === "string" && source.title
          ? source.title
          : "未命名画布",
    nodes: repairedNodes,
    edges: validEdges,
    groups,
    viewport: {
      x: Number.isFinite(viewport.x) ? viewport.x : 0,
      y: Number.isFinite(viewport.y) ? viewport.y : 0,
      zoom: clampZoom(viewport.zoom),
    },
    updatedAt: source.updatedAt || now(),
  };
}
function isCachedDisplayImage(value: unknown) {
  return typeof value === "string" && /^data:image\//i.test(value);
}

function comparableDocument(value: Document) {
  const normal = normalize(value);
  return {
    ...normal,
    nodes: normal.nodes.map((node) => {
      const imageIsRuntimeOnly =
        ((node.assetId || node.taskId) && isTemporaryMediaUrl(node.image)) ||
        (node.localImage && isCachedDisplayImage(node.image));
      const posterIsRuntimeOnly =
        Boolean(node.videoPoster) &&
        Boolean(node.localVideoPoster || (node.assetId || node.taskId) && !isDurableAssetUrl(node.videoPoster));
      return imageIsRuntimeOnly || posterIsRuntimeOnly
        ? {
            ...node,
            ...(imageIsRuntimeOnly ? { image: undefined } : {}),
            ...(posterIsRuntimeOnly ? { videoPoster: undefined } : {}),
            imageThumbnail: undefined,
          }
        : node;
    }),
  };
}

function comparableJson(value: unknown) {
  return JSON.stringify(
    value,
    (key, item) =>
      key === "localImage" || key === "localVideoPoster" || key === "imageThumbnail"
        ? undefined
        : item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
            )
          : item,
  );
}

export function documentSignature(value: Document) {
  const normal = comparableDocument(value);
  return comparableJson([normal.name, normal.nodes, normal.edges]);
}

export function documentRevisionSignature(value: Document) {
  return comparableJson(comparableDocument(value));
}

function errorText(error: unknown) {
  const value = error as Partial<AppSdkError> & {
    code?: string;
    error_code?: string;
    error?: { code?: string; message?: string };
    details?: { message?: string; error?: { message?: string } };
  };
  const details = value.details as { code?: string; error?: { code?: string } } | undefined;
  const code = String(
    value.code || value.error_code || value.error?.code || details?.code || details?.error?.code || "",
  ).toUpperCase();
  if (code === "MEDIA_STORAGE_QUOTA_EXCEEDED")
    return "可用媒体空间不足。请在设置中删除不需要的 Canvas 媒体后重试；取消收藏不会释放空间。";
  return (
    value.message ||
    value.details?.message ||
    value.details?.error?.message ||
    "平台连接失败，请稍后重试。"
  );
}
function errorCode(error: unknown) {
  const value = error as Partial<AppSdkError> & {
    code?: string;
    error_code?: string;
    error?: { code?: string };
    details?: { code?: string; error?: { code?: string } };
  };
  return String(
    value.code || value.error_code || value.error?.code || value.details?.code || value.details?.error?.code || "",
  ).toUpperCase();
}
function isStorageQuotaError(error: unknown) {
  const code = errorCode(error);
  return code === "MEDIA_STORAGE_QUOTA_EXCEEDED" || code === "MEDIA_STORAGE_QUOTA_FULL";
}
function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
const savedStatus = (synced: boolean) => isSessionOnlyStorage()
  ? synced ? "已保存到云端" : "尚未同步 · 仅当前页面保留"
  : synced ? "已保存到本机与云端" : "已保存到本机";
const syncFailureStatus = (localSaved = true) => isSessionOnlyStorage()
  ? "云端保存失败 · 请导出备份后再关闭"
  : localSaved ? "已保存本机 · 云端同步失败" : "保存未完成 · 请导出备份";

type ImageLoadState = {
  source: string;
  status: "loading" | "recovering" | "failed";
  attempt: number;
  message?: string;
};

type ImageRecoveryResult = {
  image: string;
  thumbnail?: string;
};

type StoredAssetPage = {
  items?: StoredAsset[];
  total?: number;
  page?: number;
  limit?: number;
};

// Keep ordering per canvas. A slow upload for one document must not block an
// unrelated canvas opened in the same tab. KV revisions protect each document.
const cloudSaveQueues = new Map<string, { promise: Promise<void>; checkSession: () => void }>();
export function syncCloudDocument(
  value: Document,
  local: Promise<unknown> = Promise.resolve(),
  expected?: Document,
) {
  const snapshot = clone(value);
  void local.catch(() => {});
  const checkSession = captureDocumentStorageSession(client.storage);
  let previous = Promise.resolve();
  const queued = cloudSaveQueues.get(snapshot.id);
  if (queued) {
    // A timed-out request from the previous account must not block saves in
    // the current account while its underlying transport is still settling.
    try { queued.checkSession(); previous = queued.promise; } catch { /* obsolete session */ }
  }
  const next = previous
    .catch(() => {})
    .then(async () => {
      checkSession();
      await local;
      checkSession();
      const prepared = storageDocument(await storeInlineImages(snapshot));
      checkSession();
      await saveCanvasDocument(
        client.storage,
        prepared,
        expected ? { validateCurrent: (remote) => {
          if (remote && (documentRevisionSignature(normalize(remote)) !==
            documentRevisionSignature(expected))) {
            throw new Error("云端有不同版本，当前操作已保留。请打开画布后选择要继续的版本。");
          }
        } } : undefined,
      );
      checkSession();
      markSessionSynced(snapshot.id, JSON.stringify(snapshot));
    });
  const job = { promise: next, checkSession };
  cloudSaveQueues.set(snapshot.id, job);
  void next.then(
    () => {
      if (cloudSaveQueues.get(snapshot.id) === job) cloudSaveQueues.delete(snapshot.id);
    },
    () => {
      if (cloudSaveQueues.get(snapshot.id) === job) cloudSaveQueues.delete(snapshot.id);
    },
  );
  return next;
}
function icon(type: NodeType) {
  return type === "prompt" ? (
    <Sparkles size={14} />
  ) : type === "image" ? (
    <FileImage size={14} />
  ) : type === "video" ? (
    <Film size={14} />
  ) : type === "audio" ? (
    <Music2 size={14} />
  ) : (
    <Type size={14} />
  );
}
function label(type: NodeType, mediaType?: MediaType) {
  return type === "prompt"
    ? mediaType === "audio" ? "音频创作" : mediaType === "video" ? "视频创作" : "图片提示词"
    : type === "image"
      ? "图片素材"
      : type === "video"
        ? "视频素材"
        : type === "audio"
          ? "音频素材"
      : "文本";
}

/** Keep generated outputs visually distinct from their creator task. */
function displayNodeTitle(node: CanvasNode) {
  if (node.resultOf && (node.type === "image" || node.type === "video" || node.type === "audio")) {
    const kind = node.type === "video" ? "视频结果" : node.type === "audio" ? "音频结果" : "图片结果";
    return typeof node.resultIndex === "number" ? `${kind} · ${node.resultIndex + 1}` : kind;
  }
  if (isCompletedMediaNode(node)) {
    return node.mediaType === "video" ? "视频结果" : node.mediaType === "audio" ? "音频结果" : "图片结果";
  }
  return node.title;
}

/** Normalize persisted or server supplied audio formats for the compact player badge. */
function audioFormat(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  const mime = normalized.split(";", 1)[0];
  const knownMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/opus": "opus",
    "audio/pcm": "pcm",
  };
  if (knownMime[mime]) return knownMime[mime];
  const valueWithoutMime = mime.includes("/") ? mime.slice(mime.lastIndexOf("/") + 1) : mime;
  const extension = valueWithoutMime.split(".").pop()?.replace(/[^a-z0-9_-]/g, "");
  return extension || undefined;
}

function audioFormatForNode(node: CanvasNode): string | undefined {
  return [
    node.operationParams?.mimeType,
    node.musicSettings?.output_format,
    node.ttsSettings?.output_format,
    node.musicSubmission?.output_format,
    node.ttsSubmission?.settings?.output_format,
  ].map(audioFormat).find(Boolean);
}

function hasGeneratedResult(node: CanvasNode, nodes: CanvasNode[], edges: Edge[]) {
  if (node.type !== "prompt") return false;
  return hasMediaContent(node) || generatedResultsFor(node.id, nodes, edges).some(hasMediaContent);
}

const hasMediaContent = nodeHasMediaContent;
const hasRetainableMedia = (node: CanvasNode) =>
  hasMediaContent(node) || Boolean(node.videoPoster);

// A generated image keeps the persisted `prompt` type so its task history and
// inline editor remain available. Treat that completed image exactly like an
// imported image while reference-picking; video results are intentionally
// excluded even when an old record happens to carry an image field.
const isCanvasReferenceImage = (node: CanvasNode) => Boolean(
  (node.image || node.localImage) && (
    node.type === "image" ||
    (node.type === "prompt" && (node.mediaType || "image") === "image")
  ),
);

const isCanvasReferenceVideo = (node: CanvasNode) => Boolean(
  (node.video || node.localVideo || node.videoContentUrl || node.assetId) && (
    node.type === "video" ||
    (node.type === "prompt" && node.mediaType === "video")
  ),
);

const isCanvasReferenceAudio = (node: CanvasNode) => Boolean(
  (node.audio || node.localAudio) && (
    node.type === "audio" ||
    (node.type === "prompt" && node.mediaType === "audio")
  ),
);

const hasUsableCanvasReferenceImage = (node: CanvasNode) =>
  isCanvasReferenceImage(node) && Boolean(node.image);

const hasUsableCanvasReferenceVideo = (node: CanvasNode) =>
  isCanvasReferenceVideo(node) && Boolean(node.video || node.localVideo || node.videoContentUrl || node.assetId);

const hasUsableCanvasReferenceAudio = (node: CanvasNode) =>
  isCanvasReferenceAudio(node) && Boolean(node.audio || node.localAudio);

const canUseCanvasReferenceFor = (source: CanvasNode, target: CanvasNode | undefined) =>
  hasUsableCanvasReferenceImage(source) || Boolean(
    target?.mediaType === "video" &&
    (hasUsableCanvasReferenceVideo(source) || hasUsableCanvasReferenceAudio(source)),
  );

const sameCanvasReferenceValue = (source: CanvasNode, reference: {
  nodeId?: string; image?: string; localImage?: string; video?: string; localVideo?: string;
  audio?: string; localAudio?: string; videoContentUrl?: string; assetId?: string;
}) => reference.nodeId === source.id ||
  Boolean(source.image && reference.image === source.image) ||
  Boolean(source.localImage && reference.localImage === source.localImage) ||
  Boolean(source.video && reference.video === source.video) ||
  Boolean(source.localVideo && reference.localVideo === source.localVideo) ||
  Boolean(source.videoContentUrl && reference.videoContentUrl === source.videoContentUrl) ||
  Boolean(source.audio && reference.audio === source.audio) ||
  Boolean(source.localAudio && reference.localAudio === source.localAudio) ||
  Boolean(source.assetId && reference.assetId === source.assetId);

const isCanvasTextReference = (node: CanvasNode) => isWorkflowTextReference(node);

const isCanvasAsset = (node: CanvasNode) =>
  node.type === "image" || node.type === "video" || node.type === "audio" || (node.type === "prompt" && hasMediaContent(node));

const assetType = (node: CanvasNode) =>
  node.type === "prompt" ? (node.mediaType || "image") : node.type;

function canvasTaskDisplayState(node: CanvasNode, active = false) {
  const state = canvasTaskState(node, active);
  return {
    state,
    label: pendingTaskLabel(node, active),
    active: ["queued", "running", "unknown", "reconciliation", "no_task_id"].includes(state),
  };
}

/**
 * A completed creator owns a media asset, but its persisted type remains
 * `prompt` so the task history and editor can still find it. The canvas must
 * render that asset exactly like an imported image/video node.
 */
function isCompletedMediaNode(node: CanvasNode) {
  return isCompletedMediaNodeByPolicy(node, { hasMediaContent: hasMediaContent(node) });
}

function nodeInteraction(
  node: CanvasNode,
  nodes: CanvasNode[] = [],
  edges: Edge[] = [],
  context: NodeInteractionContext = {},
) {
  return getNodeInteraction(node, {
    hasMediaContent: hasMediaContent(node),
    hasGeneratedResult:
      node.type === "prompt" && nodes.length > 0
        ? hasGeneratedResult(node, nodes, edges)
        : false,
    ...context,
  });
}

/**
 * Generated nodes carry resultOf so a reference image connected to a prompt
 * can never be mistaken for an output. The title/edge check keeps old
 * canvases (created before resultOf was introduced) readable.
 */
function isGeneratedResult(
  sourceId: string,
  target: CanvasNode,
  edges: Edge[],
  sourceTitle?: string,
) {
  if (target.type !== "image" && target.type !== "video") return false;
  if (target.resultOf === sourceId) return true;
  if (target.resultOf || !sourceTitle) return false;
  const connected = edges.some((edge) => edge.from === sourceId && edge.to === target.id);
  if (!connected) return false;
  return hasMediaContent(target) ||
    target.title.startsWith(`${sourceTitle} · 结果`) ||
    target.title === `${sourceTitle} · 视频结果`;
}

type CanvasRelationCache = {
  nodeById: Map<string, CanvasNode>;
  outgoing: Map<string, Edge[]>;
  generatedBySource: Map<string, CanvasNode[]>;
  collapsedById: Map<string, boolean>;
  visibleEdges?: Edge[];
};

// A document's node and edge arrays are immutable snapshots. Cache graph
// derivations by those array identities so one render does not repeatedly
// scan the full document for every node, group frame, and edge calculation.
const canvasRelationCaches = new WeakMap<CanvasNode[], WeakMap<Edge[], CanvasRelationCache>>();

function canvasRelationCache(nodes: CanvasNode[], edges: Edge[]): CanvasRelationCache {
  let byEdges = canvasRelationCaches.get(nodes);
  if (!byEdges) {
    byEdges = new WeakMap<Edge[], CanvasRelationCache>();
    canvasRelationCaches.set(nodes, byEdges);
  }
  const existing = byEdges.get(edges);
  if (existing) return existing;
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) || [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const cache: CanvasRelationCache = {
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    outgoing,
    generatedBySource: new Map(),
    collapsedById: new Map(),
  };
  byEdges.set(edges, cache);
  return cache;
}

function generatedResultsFor(
  sourceId: string,
  nodes: CanvasNode[],
  edges: Edge[],
) {
  const cache = canvasRelationCache(nodes, edges);
  const cached = cache.generatedBySource.get(sourceId);
  if (cached) return cached;
  const source = cache.nodeById.get(sourceId);
  const batchId = source?.submission?.resultBatchId || source?.generationBatchId;
  const connectedIds = new Set((cache.outgoing.get(sourceId) || []).map((edge) => edge.to));
  const results = nodes
    .filter((target) => {
      if (isGeneratedResult(sourceId, target, edges, source?.title)) return true;
      if (batchId && target.resultBatchId === batchId && hasMediaContent(target)) return true;
      // A few early canvas versions persisted the prompt -> result edge but
      // omitted both resultOf and the generated title. Direction plus actual
      // media content is enough to identify the output and never matches a
      // reference image (references point into the prompt).
      return (
        (target.type === "image" || target.type === "video") &&
        hasMediaContent(target) &&
        connectedIds.has(target.id)
      );
    })
    ;
  // Nodes are appended in generation order. Keep that order across batches,
  // while preserving resultIndex ordering for legacy single-batch canvases.
  const hasBatches = results.some((result) => result.resultBatchId);
  const ordered = hasBatches
    ? results
    : results.sort((a, b) => (a.resultIndex ?? Number.MAX_SAFE_INTEGER) - (b.resultIndex ?? Number.MAX_SAFE_INTEGER));
  cache.generatedBySource.set(sourceId, ordered);
  return ordered;
}

function latestGeneratedResultsFor(
  sourceId: string,
  nodes: CanvasNode[],
  edges: Edge[],
) {
  const results = generatedResultsFor(sourceId, nodes, edges);
  const latestBatchId = [...results].reverse().find((result) => result.resultBatchId)?.resultBatchId;
  return latestBatchId
    ? results.filter((result) => result.resultBatchId === latestBatchId)
    : results;
}

/**
 * A single output is kept on the creator node. Multiple outputs and legacy
 * outputs remain separate nodes so each asset can still be positioned and
 * connected independently.
 */
function creatorResultsFor(
  sourceId: string,
  nodes: CanvasNode[],
  edges: Edge[],
) {
  const source = nodes.find((node) => node.id === sourceId);
  const generated = generatedResultsFor(sourceId, nodes, edges);
  return source && hasMediaContent(source) ? [source, ...generated] : generated;
}

function latestCreatorResultsFor(
  sourceId: string,
  nodes: CanvasNode[],
  edges: Edge[],
) {
  const source = nodes.find((node) => node.id === sourceId);
  const generated = generatedResultsFor(sourceId, nodes, edges);
  const generatedBatchId = [...generated].reverse().find((result) => result.resultBatchId)?.resultBatchId;
  if (generatedBatchId) return generated.filter((result) => result.resultBatchId === generatedBatchId);
  if (source && hasMediaContent(source)) return [source];
  const results = generated;
  const latestBatchId = [...results].reverse().find((result) => result.resultBatchId)?.resultBatchId;
  return latestBatchId
    ? results.filter((result) => result.resultBatchId === latestBatchId)
    : results;
}

/**
 * A task with at least one real result is represented by its result assets on
 * the canvas. The task record remains in the task drawer for history, retry,
 * and recovery, but it no longer adds a duplicate middle card between the
 * source and the generated assets. This also covers failed/retried tasks
 * whose previous result batch is still visible.
 */
function isCollapsedResultTask(
  node: CanvasNode,
  nodes: CanvasNode[],
  edges: Edge[],
) {
  const cache = canvasRelationCache(nodes, edges);
  const cached = cache.collapsedById.get(node.id);
  if (cached !== undefined) return cached;
  const results = generatedResultsFor(node.id, nodes, edges);
  const collapsed = Boolean(
    node.type === "prompt" &&
      results.some((result) => result.id !== node.id && hasMediaContent(result)),
  );
  cache.collapsedById.set(node.id, collapsed);
  return collapsed;
}

/** Bridge edges across hidden completed task metadata. */
function visibleCanvasEdges(nodes: CanvasNode[], edges: Edge[]) {
  const cache = canvasRelationCache(nodes, edges);
  if (cache.visibleEdges) return cache.visibleEdges;
  const hidden = new Set(
    nodes
      .filter((node) => isCollapsedResultTask(node, nodes, edges))
      .map((node) => node.id),
  );
  const visible = nodes.filter((node) => !hidden.has(node.id));
  const visibleIDs = new Set(visible.map((node) => node.id));
  const outgoing = new Map<string, Edge[]>();
  edges.forEach((edge) => {
    const list = outgoing.get(edge.from) || [];
    list.push(edge);
    outgoing.set(edge.from, list);
  });
  const result: Edge[] = [];
  for (const source of visible) {
    const queue = [...(outgoing.get(source.id) || [])];
    const visited = new Set<string>();
    while (queue.length) {
      const edge = queue.shift()!;
      const key = `${edge.from}\u0000${edge.to}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (hidden.has(edge.to)) {
        queue.push(...(outgoing.get(edge.to) || []));
      } else if (visibleIDs.has(edge.to)) {
        result.push(
          edge.from === source.id
            ? edge
            : { id: `collapsed:${source.id}:${edge.to}`, from: source.id, to: edge.to },
        );
      }
    }
  }
  const visibleEdges = result.filter(
    (edge, index, all) =>
      all.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to) === index,
  );
  cache.visibleEdges = visibleEdges;
  return visibleEdges;
}

function resultsNeedRelayout(results: CanvasNode[]) {
  for (let index = 0; index < results.length; index += 1) {
    const left = results[index];
    for (let other = index + 1; other < results.length; other += 1) {
      const right = results[other];
      if (
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
      )
        return true;
    }
  }
  return false;
}

function repairGeneratedLayout(nodes: CanvasNode[], edges: Edge[]) {
  const next = nodes.map((node) => ({ ...node }));
  for (const source of next.filter((node) => node.type === "prompt")) {
    const results = generatedResultsFor(source.id, next, edges);
    const resultIds = new Set(results.map((result) => result.id));
    const occupied = next
      .filter((node) => !resultIds.has(node.id))
      .map(({ x, y, width, height }) => ({ x, y, width, height }));
    const overlapsOther = results.some((result) => occupied.some((rect) =>
      result.x < rect.x + rect.width &&
      result.x + result.width > rect.x &&
      result.y < rect.y + rect.height &&
      result.y + result.height > rect.y,
    ));
    // Repair imported/legacy scenes where generated cards overlap each other
    // or their creator. Deliberate spacing is preserved when the batch is
    // already readable.
    if (!results.length || (!resultsNeedRelayout(results) && !overlapsOther)) continue;
    const width = results[0].width || 360;
    const height = results[0].height || 360;
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(results.length))));
    results.forEach((result, index) => {
      const position = findFreePosition(occupied, {
        x: source.x + source.width + 100 + (index % columns) * (width + 32),
        y: source.y + Math.floor(index / columns) * (height + 32),
        width,
        height,
      });
      const target = next.find((node) => node.id === result.id);
      if (target) {
        target.x = position.x;
        target.y = position.y;
        occupied.push({ x: position.x, y: position.y, width, height });
      }
    });
  }
  return next;
}

function uniqueResultEdges(
  sourceId: string,
  resultNodes: CanvasNode[],
  existingEdges: Edge[],
  staleIds = new Set<string>(),
) {
  const resultIds = new Set(resultNodes.map((node) => node.id));
  const preserved = existingEdges.filter(
    (edge) =>
      !staleIds.has(edge.from) &&
      !staleIds.has(edge.to) &&
      !(edge.from === sourceId && resultIds.has(edge.to)),
  );
  const links = resultNodes.map((node) => {
    const existing = existingEdges.find(
      (edge) => edge.from === sourceId && edge.to === node.id,
    );
    return existing || { id: uid("edge"), from: sourceId, to: node.id };
  });
  return [...preserved, ...links];
}

/**
 * Generated assets belong to the same visual workspace as their creator.
 * Older documents gave every multi-output batch its own group, which made
 * results from a manually grouped creator appear outside that group. Repair
 * that relationship while loading old documents and keep the operation
 * idempotent for subsequent saves.
 */
function inheritGeneratedGroupIds(nodes: CanvasNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const sourceId = node.resultOf || node.continuationOf;
    if (!sourceId) return node;
    const source = byId.get(sourceId);
    const generatedBatchGroup = Boolean(
      node.groupId &&
        (node.groupId.startsWith("image-batch-") ||
          node.groupId.startsWith("video-batch-")),
    );
    const shouldInherit = Boolean(
      source?.groupId &&
        (!node.groupId || generatedBatchGroup || Boolean(node.resultOf)),
    );
    if (!source?.groupId || !shouldInherit || source.groupId === node.groupId) return node;
    return { ...node, groupId: source.groupId };
  });
}

function isGeneratedBatchGroup(groupId: string, nodes: CanvasNode[]) {
  return (
    (groupId.startsWith("image-batch-") || groupId.startsWith("video-batch-")) &&
    nodes.every((node) => Boolean(node.resultOf))
  );
}

const GROUP_PADDING = 18;

function frameForNodes(id: string, nodes: CanvasNode[]): GroupFrame | null {
  return frameForGroupNodes(id, nodes, GROUP_PADDING);
}

function visibleGroupMembers(nodes: CanvasNode[], id: string) {
  return nodes.filter((node) =>
    node.groupId === id &&
    !(node.type === "prompt" && nodes.some((candidate) =>
      candidate.resultOf === node.id && hasMediaContent(candidate),
    )),
  );
}

function expandWholeGroupSelection(nodes: CanvasNode[], ids: readonly string[]) {
  const selected = new Set(ids);
  const groups = new Set(
    nodes
      .map((node) => node.groupId)
      .filter((id): id is string => Boolean(id))
      .filter((id) => {
        const members = visibleGroupMembers(nodes, id);
        return members.length > 1 && members.every((node) => selected.has(node.id));
      }),
  );
  nodes.forEach((node) => {
    if (node.groupId && groups.has(node.groupId)) selected.add(node.id);
  });
  return [...selected];
}

function normalizeGroupFrames(nodes: CanvasNode[], _rawGroups: unknown): GroupFrame[] {
  const ids = [...new Set(nodes.map((node) => node.groupId).filter((id): id is string => Boolean(id)))];
  // Frame geometry is derived from the current visible members. Persisted
  // frames are accepted for document compatibility, but never trusted as a
  // hit target after a member moved, resized, collapsed, or left the group.
  return ids
    .map((id) => frameForNodes(id, visibleGroupMembers(nodes, id)))
    .filter((group): group is GroupFrame => Boolean(group));
}

function expandFrameToNodes(frame: GroupFrame, nodes: CanvasNode[]): GroupFrame {
  const visible = nodes.filter((node) =>
    !(node.type === "prompt" && nodes.some((candidate) => candidate.resultOf === node.id)),
  );
  const next = frameForNodes(frame.id, visible);
  if (!next) return frame;
  return next;
}

function expandGroupFrames(nodes: CanvasNode[], groups: GroupFrame[] | undefined) {
  return normalizeGroupFrames(nodes, groups).map((frame) =>
    expandFrameToNodes(frame, nodes.filter((node) => node.groupId === frame.id)),
  );
}

function pointInsideFrame(node: CanvasNode, frame: GroupFrame) {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  return centerX >= frame.x && centerX <= frame.x + frame.width && centerY >= frame.y && centerY <= frame.y + frame.height;
}

function restoreDraggedNodes(current: CanvasNode[], before: CanvasNode[], ids: string[]) {
  const targets = new Set(ids);
  const previous = new Map(before.map((node) => [node.id, node]));
  return current.map((node) => {
    const old = targets.has(node.id) ? previous.get(node.id) : undefined;
    return old ? { ...node, x: old.x, y: old.y, groupId: old.groupId } : node;
  });
}

function reconcileGroupMembership(
  nodes: CanvasNode[],
  frameNodes: CanvasNode[],
  movedIds: string[],
) {
  // Membership is tested against the frames from pointer-down. If frames were
  // rebuilt from the already moved node, its own group would expand around it
  // and the node could never be dragged out.
  const frames = normalizeGroupFrames(frameNodes, undefined);
  const moved = new Set(movedIds);
  const nextNodes = nodes.map((node) => {
    if (!moved.has(node.id)) return node;
    const candidates = frames
      .filter((frame) => pointInsideFrame(node, frame))
      .sort((a, b) => a.width * a.height - b.width * b.height);
    const groupId = candidates[0]?.id;
    return node.groupId === groupId
      ? node
      : { ...node, groupId };
  });
  return rebuildGroupStateFromNodes(nextNodes, GROUP_PADDING);
}

type NearConnection = { nodeId: string; side: PortSide; x: number; y: number };
type CanvasGroupFrame = GroupFrame & {
  count: number;
  selected: boolean;
  label: string;
};
type Picker = {
  screen: Point;
  world: Point;
  nodeId?: string;
  sourceId?: string;
  edgeId?: string;
  dock?: boolean;
} | null;

function LayoutPopover({
  scope,
  count,
  rows,
  sort,
  onRowsChange,
  onSortChange,
  onFlow,
  onGrid,
  onCustom,
}: {
  scope: "all" | "selected";
  count: number;
  rows: number;
  sort: "position" | "time" | "name" | "custom";
  onRowsChange: (rows: number) => void;
  onSortChange: (sort: "position" | "time" | "name" | "custom") => void;
  onFlow: () => void;
  onGrid: () => void;
  onCustom: () => void;
}) {
  const popover = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const element = popover.current;
    const anchor = element?.parentElement;
    const board = element?.closest<HTMLElement>(".canvas-board");
    if (!element || !anchor || !board) return;
    const place = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const gap = 10;
      const min = boardRect.left + 12;
      const max = Math.max(min, boardRect.right - width - 12);
      const desired = anchorRect.left + anchorRect.width / 2 - width / 2;
      const left = Math.max(min, Math.min(max, desired));
      element.style.left = `${left - anchorRect.left}px`;
      element.style.transform = "none";
      const spaceAbove = anchorRect.top - boardRect.top;
      const spaceBelow = boardRect.bottom - anchorRect.bottom;
      const below = spaceAbove < height + gap && spaceBelow > spaceAbove;
      element.classList.toggle("is-below", below);
      element.style.setProperty("--layout-menu-arrow", `${anchorRect.left + anchorRect.width / 2 - left}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(board);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  return (
    <div ref={popover} className="popover layout-menu" role="dialog" aria-label="整理布局">
      <div className="layout-menu-modes">
        <button className="layout-mode" disabled={count < 2} onClick={onFlow}>
          <span className="layout-mode-icon layout-flow-icon"><i /><i /><i /></span>
          <strong>顺着连线</strong>
          <small>按工作流方向排列节点</small>
        </button>
        <button className="layout-mode" disabled={count < 2} onClick={onGrid}>
          <span className="layout-mode-icon layout-grid-icon"><i /><i /><i /><i /></span>
          <strong>自动网格</strong>
          <small>按规则整理为整齐网格</small>
        </button>
      </div>
      <div className="layout-menu-section">
        <div className="layout-menu-label"><span>排序方式</span><span>{scope === "selected" ? "已选节点" : "全部节点"}</span></div>
        <div className="layout-sort" role="radiogroup" aria-label="网格排序方式">
          {([["position", "位置"], ["time", "时间"], ["name", "名称"]] as const).map(([value, label]) => (
            <button key={value} role="radio" aria-checked={sort === value} className={sort === value ? "active" : ""} onClick={() => onSortChange(value)}>{label}{value === "position" && <span aria-hidden="true">↑</span>}</button>
          ))}
        </div>
        <div className="layout-menu-label"><span>行数</span><strong>{rows} 行 × {Math.max(1, Math.ceil(count / rows))} 列</strong></div>
        <input aria-label="网格行数" type="range" min="1" max={Math.min(6, Math.max(1, count))} step="1" value={Math.min(rows, Math.max(1, count))} onChange={(event) => onRowsChange(Number(event.target.value))} />
      </div>
      {count < 2 && <p className="layout-empty-hint" role="status">至少需要 2 个节点才能整理布局。</p>}
      <button className="layout-custom" disabled={count < 2} onClick={onCustom}>
        <span className="layout-custom-icon">⌗</span>
        <span><strong>自定义排序</strong><small>按当前选择顺序排列节点</small></span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function Field({
  value,
  onCommit,
  multiline = false,
  label: fieldLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  label: string;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const props = {
    value: draft,
    "aria-label": fieldLabel,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(event.target.value),
    onBlur: () => {
      if (draft !== value) onCommit(draft);
    },
  };
  return (
    <label className="field">
      <span>{fieldLabel}</span>
      {multiline ? (
        <textarea {...props} rows={6} maxLength={20000} />
      ) : (
        <input {...props} maxLength={160} />
      )}
    </label>
  );
}

function IconButton({
  label: title,
  children,
  active,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      aria-pressed={active}
      className={`icon-button ${active ? "active" : ""} ${className}`}
      {...props}
    >
      {children}
      <span className="tooltip" aria-hidden="true">
        {title}
      </span>
    </button>
  );
}

type EditorProps = {
  initialDocument: Document;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  onCanvasInteraction?: () => void;
  onSaved: (document: Document) => void;
  onCloudSynced?: (document: Document) => void;
  registerEditor: (handler: CanvasEditorHandle | null) => void;
};

type KeyboardContext = {
  connecting: string | null;
  referencePickTarget: string | null;
  preview: CanvasNode | null;
  overlay: "help" | "settings" | "restore" | null;
  toolMenu: boolean;
  setToolMenu: React.Dispatch<React.SetStateAction<boolean>>;
  primary?: CanvasNode;
  selected: string[];
  performNodeAction: (
    node: CanvasNode,
    options?: {
      action?: ReturnType<typeof nodeInteraction>["primaryAction"];
      focusCreator?: boolean;
    },
  ) => ReturnType<typeof nodeInteraction>["primaryAction"];
  focusToolSwitch: () => void;
  closeMenus: () => void;
  closeInspector: () => void;
  setOverlay: React.Dispatch<React.SetStateAction<"help" | "settings" | "restore" | null>>;
  setPreview: React.Dispatch<React.SetStateAction<CanvasNode | null>>;
  setEditing: React.Dispatch<React.SetStateAction<string | null>>;
  cancelGesture: (keepTouches?: boolean) => void;
  setSpace: React.Dispatch<React.SetStateAction<boolean>>;
  undo: () => void;
  redo: () => void;
  duplicate: () => void;
  copyNodes: () => void;
  pasteNodes: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedEdge: React.Dispatch<React.SetStateAction<string | null>>;
  save: () => Promise<void>;
  focusNodes: (nodes?: CanvasNode[]) => void;
  stepZoom: (direction: number) => void;
  arrange: () => void;
  renameNode: (node: CanvasNode) => void;
  selectedEdge: string | null;
  removeEdge: (edgeId?: string | null) => void;
  remove: (ids?: string[]) => void;
  changeTool: (next: Tool) => void;
  add: (
    type: NodeType,
    at?: Point,
    sourceId?: string,
    text?: string,
    mediaType?: MediaType,
    continuationOf?: string,
  ) => void;
};

export default function App({
  initialDocument,
  libraryOpen,
  onToggleLibrary,
  onCanvasInteraction,
  onSaved,
  onCloudSynced,
  registerEditor,
}: EditorProps) {
  const {
    ready: platformReady,
    revision: platformRevision,
    requireLogin,
  } = usePlatformAccess();
  const platformReadyRef = React.useRef(platformReady);
  platformReadyRef.current = platformReady;
  const platformRevisionRef = React.useRef(platformRevision);
  platformRevisionRef.current = platformRevision;
  React.useEffect(() => {
    setCanvasGatewayURL(platformReady ? client.session()?.gateway_url : undefined);
    return () => setCanvasGatewayURL(undefined);
  }, [platformReady, platformRevision]);
  const [doc, setDoc] = React.useState<Document>(() => clone(initialDocument));
  const docRef = React.useRef(doc);
  docRef.current = doc;
  // Geometry-only frames deliberately do not advance this revision. Derived
  // workflow state can then stay stable while a node is being dragged, while
  // content, edge, or node membership edits still invalidate it explicitly.
  const [workflowRevision, setWorkflowRevision] = React.useState(0);
  const [selected, setSelected] = React.useState<string[]>([]);
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const [creatorFocusRequest, setCreatorFocusRequest] = React.useState(0);
  const [referenceRequest, setReferenceRequest] = React.useState(0);
  const [referencePickTarget, setReferencePickTarget] = React.useState<string | null>(null);
  const [referencePickKind, setReferencePickKind] = React.useState<"image" | "text">("image");
  const referencePickTargetRef = React.useRef<string | null>(null);
  referencePickTargetRef.current = referencePickTarget;
  const [handDrawTargetId, setHandDrawTargetId] = React.useState<string | null>(null);
  // Keep removed graph items mounted for one short frame so they can shrink
  // back to their own center before the document is mutated. The outer node
  // still owns only world-space coordinates; the motion lives on its surface.
  const [removingNodeIds, setRemovingNodeIds] = React.useState<string[]>([]);
  const [removingEdgeIds, setRemovingEdgeIds] = React.useState<string[]>([]);
  const pendingRemovalNodes = React.useRef(new Set<string>());
  const pendingRemovalEdges = React.useRef(new Set<string>());
  const removalTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Viewport culling has its own short-lived exit lifecycle. A node leaving
  // the buffered viewport must remain mounted long enough to play its center
  // shrink animation; this is separate from a real delete so history and
  // task state are never mutated by navigation.
  const [viewportExitingNodeIds, setViewportExitingNodeIds] = React.useState<string[]>([]);
  const [viewportExitingEdgeIds, setViewportExitingEdgeIds] = React.useState<string[]>([]);
  const viewportExitNodeTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const viewportExitEdgeTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null);
  const [tool, setTool] = React.useState<Tool>("select");
  const [models, setModels] = React.useState<Model[]>([]);
  const [status, setStatus] = React.useState("正在连接…");
  const { notice, show: setMessage } = useTransientNotice();
  const [activeIds, setActiveIds] = React.useState<string[]>([]);
  const [cancelingIds, setCancelingIds] = React.useState<string[]>([]);
  const taskStatusChecks = React.useRef(new Set<string>());
  const activeRequests = React.useRef(new Map<string, AbortController>());
  // Recovery is scoped to a concrete task, rather than only a node ID. A
  // node can be reused after a retry and the same node ID can exist in a
  // different canvas, so a node-only guard could suppress valid recovery.
  const taskRecovery = React.useRef(new TaskRecoverySchedule());
  const [recoveryRevision, setRecoveryRevision] = React.useState(0);
  const [hydrated, setHydrated] = React.useState(false);
  const [drawer, setDrawer] = React.useState<
    "layers" | "assets" | "tasks" | null
  >(null);
  const [assetView, setAssetView] = React.useState<"canvas" | "library">("canvas");
  const assetReferenceTarget = React.useRef<{ nodeId: string; documentId: string; kind?: "audio" }>();
  React.useEffect(() => {
    // Keep the creator target while moving between the canvas-assets tab and
    // the full library. Explicit close/back handlers decide whether to return
    // to the creator; unrelated drawer changes simply discard the target.
    if (drawer !== "assets") assetReferenceTarget.current = undefined;
  }, [drawer]);
  const lastAssetTab = React.useRef<"layers" | "assets">("assets");
  if (drawer === "layers" || drawer === "assets") lastAssetTab.current = drawer;
  const [inspectorMode, setInspectorMode] = React.useState<"edit" | null>(null);
  const inspectorOpen = inspectorMode === "edit";
  const setInspectorOpen = (open: boolean) => setInspectorMode(open ? "edit" : null);
  const [creationError, setCreationError] = React.useState<{ id: string; message: string } | null>(null);
  const [draftReady, setDraftReady] = React.useState(false);
  const [syncEnabled, setSyncEnabled] = React.useState(false);
  const syncStateRef = React.useRef({ syncEnabled, hydrated });
  syncStateRef.current = { syncEnabled, hydrated };
  const [platformLoading, setPlatformLoading] = React.useState(false);
  const [authState, setAuthState] = React.useState<
    "checking" | "required" | "connected" | "error"
  >("checking");
  const [platformProfile, setPlatformProfile] = React.useState<AppProfile | null>(null);
  const [platformProfileError, setPlatformProfileError] = React.useState("");
  const imageRecoveryReadyRef = React.useRef(false);
  imageRecoveryReadyRef.current =
    hydrated && authState === "connected" && !platformLoading;
  const platformRequest = React.useRef(false);
  const platformRefreshQueued = React.useRef(false);
  const lastPlatformRevision = React.useRef(platformRevision);
  const [catalogState, setCatalogState] = React.useState<
    "idle" | "ready" | "empty" | "error"
  >("idle");
  const [connectionError, setConnectionError] = React.useState("");
  const [videoCatalogError, setVideoCatalogError] = React.useState("");
  const [musicCatalogError, setMusicCatalogError] = React.useState("");
  const [voiceCatalogError, setVoiceCatalogError] = React.useState("");
  const [cloudError, setCloudError] = React.useState("");
  const [cloudSync, dispatchCloudSync] = React.useReducer(cloudSyncFeedback, initialCloudSyncFeedback);
  const cloudSyncAttempt = React.useRef(0);
  const [cloudCandidate, setCloudCandidate] = React.useState<Document | null>(
    null,
  );
  const [recovery, setRecovery] = React.useState<Document | null>(null);
  const [exportError, setExportError] = React.useState("");
  const lastLocalSave = React.useRef(initialDocument.updatedAt);
  const saveStatus = cloudSync.error ? syncFailureStatus(lastLocalSave.current === doc.updatedAt) : status;
  const alive = React.useRef(true);
  const leaving = React.useRef(false);
  const [navigating, setNavigating] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [assetFilter, setAssetFilter] = React.useState<"all" | "image" | "video" | "audio">("all");
  const [picker, setPicker] = React.useState<Picker>(null);
  const [pickerQuery, setPickerQuery] = React.useState("");
  const [zoomMenu, setZoomMenu] = React.useState(false);
  const [zoomSliderActive, setZoomSliderActive] = React.useState(false);
  const [zoomDraft, setZoomDraft] = React.useState<number | null>(null);
  const [zoomIndicatorActive, setZoomIndicatorActive] = React.useState(false);
  const zoomIndicatorTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealZoomIndicator = React.useCallback(() => {
    setZoomIndicatorActive(true);
    if (zoomIndicatorTimer.current !== null) clearTimeout(zoomIndicatorTimer.current);
    zoomIndicatorTimer.current = setTimeout(() => {
      zoomIndicatorTimer.current = null;
      setZoomIndicatorActive(false);
    }, ZOOM_FEEDBACK_DURATION);
  }, []);
  React.useEffect(() => () => {
    if (zoomIndicatorTimer.current !== null) clearTimeout(zoomIndicatorTimer.current);
  }, []);
  const clearZoomDraft = () => {
    setZoomSliderActive(false);
    setZoomDraft(null);
  };
  const closeZoomMenu = () => {
    setZoomMenu(false);
    clearZoomDraft();
  };
  const [toolMenu, setToolMenu] = React.useState(false);
  const [layoutMenu, setLayoutMenu] = React.useState(false);
  // Keep the layout menu attached to the control that opened it. The same
  // action is available in the canvas utilities and in the selection toolbar;
  // rendering it only in the utilities made it appear detached (and clipped)
  // when opened from a selection.
  const [layoutMenuAnchor, setLayoutMenuAnchor] = React.useState<"utility" | "selection">("utility");
  const [layoutRows, setLayoutRows] = React.useState(3);
  const [layoutSort, setLayoutSort] = React.useState<"position" | "time" | "name" | "custom">("position");
  const toolMenuAnchor = React.useRef<HTMLDivElement>(null);
  const toolMenuPanel = React.useRef<HTMLDivElement>(null);
  const toolMenuId = React.useId();
  React.useLayoutEffect(() => {
    if (!toolMenu) return;
    const panel = toolMenuPanel.current;
    const anchor = toolMenuAnchor.current;
    if (!panel || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const editor = anchor.closest(".canvas-workbench-editor")?.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const width = panel.offsetWidth;
      const left = Math.max((editor?.left || 0) + 8,
        Math.min(center - width / 2, (editor?.right || innerWidth) - width - 8));
      panel.style.left = `${left - rect.left}px`;
      panel.style.setProperty("--tool-menu-arrow", `${center - left}px`);
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(anchor.closest(".canvas-workbench-editor") || anchor);
    window.addEventListener("resize", place);
    (panel.querySelector<HTMLElement>('[aria-checked="true"]') || panel.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    return () => { resize.disconnect(); window.removeEventListener("resize", place); };
  }, [toolMenu]);
  const [canvasPreferences, setCanvasPreferences] = React.useState<CanvasPreferences>(() => loadCanvasPreferences());
  const updateCanvasPreferences = React.useCallback((patch: Partial<CanvasPreferences>) => {
    setCanvasPreferences(current => ({ ...current, ...patch }));
  }, []);
  const notificationGate = React.useRef(createCanvasNotificationGate());
  const preferencesRef = React.useRef(canvasPreferences);
  preferencesRef.current = canvasPreferences;
  const showMinimap = canvasPreferences.showMinimap;
  const showEdges = canvasPreferences.showEdges;
  const snapToGrid = canvasPreferences.snapToGrid;
  React.useEffect(() => { saveCanvasPreferences(canvasPreferences); }, [canvasPreferences]);
  const [overlay, setOverlay] = React.useState<
    "help" | "settings" | "restore" | null
  >(null);
  const [storageUsage, setStorageUsage] = React.useState<StorageUsage | null>(null);
  const [storageLoading, setStorageLoading] = React.useState(false);
  const [storageActionError, setStorageActionError] = React.useState("");
  const storageRequest = React.useRef<Promise<boolean> | null>(null);
  const storageRequestRevision = React.useRef<number | null>(null);
  const storageRequestSequence = React.useRef(0);
  const announcedSettingsErrors = React.useRef(new Map<string, string>());
  React.useEffect(() => {
    const notices: Array<[string, string, { label: string; run: () => void }?]> = [
      ["connection", connectionError],
      ["video-catalog", videoCatalogError],
      ["music-catalog", musicCatalogError],
      ["voice-catalog", voiceCatalogError],
      ["cloud", cloudError],
      ["storage", storageActionError, { label: "重试", run: () => void loadStorage() }],
      ["sync", cloudSync.error || "", { label: "重试云端同步", run: () => void persist(docRef.current, true).catch(() => {}) }],
      ["export", exportError, { label: "仅导出可用内容", run: () => downloadDocument(docRef.current, true) }],
    ];
    for (const [key, text, action] of notices) {
      if (!text) {
        announcedSettingsErrors.current.delete(key);
        continue;
      }
      if (announcedSettingsErrors.current.get(key) === text) continue;
      announcedSettingsErrors.current.set(key, text);
      setMessage(text, action);
    }
  }, [cloudError, cloudSync.error, connectionError, exportError, setMessage, storageActionError, videoCatalogError, musicCatalogError, voiceCatalogError]);
  const [preview, setPreview] = React.useState<CanvasNode | null>(null);
  const audioSources = useAudioSources({
    document: doc, getDocument: () => docRef.current, ready: platformReady && draftReady,
    api: client.api,
    canRead: () => { try { checkLocalAccount(); return alive.current && !leaving.current && platformReadyRef.current; } catch { return false; } },
    fetchResource: (url, init) => fetchCanvasResource(url, init, { gatewayURL: client.session()?.gateway_url }),
  });
  const [validatingAudioIds, setValidatingAudioIds] = React.useState<Set<string>>(() => new Set());
  const [audioEditBusyIds, setAudioEditBusyIds] = React.useState<Set<string>>(() => new Set());
  const [audioEditErrors, setAudioEditErrors] = React.useState<Record<string, string>>({});
  const audioEditJobs = React.useRef(new Map<string, { controller: AbortController; documentId: string; identity: string }>());
  const [audioPlaybackStates, setAudioPlaybackStates] = React.useState<Record<string, { duration: number; time: number }>>({});
  const [audioWaveform, setAudioWaveform] = React.useState<AudioWaveformState | null>(null);
  const clearAudioEditError = React.useCallback((nodeId: string) => {
    setAudioEditErrors(current => {
      if (!(nodeId in current)) return current;
      const next = { ...current };
      delete next[nodeId];
      return next;
    });
  }, []);
  const cancelAudioEdit = React.useCallback((nodeId: string) => {
    audioEditJobs.current.get(nodeId)?.controller.abort();
  }, []);
  React.useEffect(() => {
    for (const [nodeId, job] of audioEditJobs.current) {
      const current = doc.nodes.find(node => node.id === nodeId);
      if (doc.id !== job.documentId || !current || audioSourceIdentity(current) !== job.identity) job.controller.abort();
    }
  }, [doc]);
  React.useEffect(() => () => {
    audioEditJobs.current.forEach(job => job.controller.abort());
    audioEditJobs.current.clear();
  }, []);
  React.useEffect(() => {
    for (const node of doc.nodes) {
      if (!canLoadAudioContent(node) || audioSources.errors[node.id] || audioSources.urls[node.id] || audioSources.loading.includes(node.id)) continue;
      // Default-load only mounted/selected audio nodes. This keeps the node
      // immediately useful while avoiding requests for off-screen assets.
      if (selected.length === 1 && selected[0] === node.id || preview?.id === node.id) void audioSources.load(node);
    }
  }, [doc, selected, preview?.id, audioSources.load, audioSources.errors, audioSources.urls, audioSources.loading]);
  const previewAudio = preview && (preview.type === "audio" || preview.mediaType === "audio") ? preview : undefined;
  const selectedAudio = selected.length === 1 ? doc.nodes.find(node => node.id === selected[0] && (node.type === "audio" || node.mediaType === "audio")) : undefined;
  const waveformTargetId = previewAudio?.id || selectedAudio?.id;
  const waveformTarget = waveformTargetId ? doc.nodes.find(node => node.id === waveformTargetId) : undefined;
  const waveformIdentity = waveformTarget ? audioSourceIdentity(waveformTarget) : "";
  const waveformDuration = waveformTargetId ? audioPlaybackStates[waveformTargetId]?.duration || 0 : 0;
  const waveformSource = waveformTargetId ? audioSources.urls[waveformTargetId] : undefined;
  React.useEffect(() => {
    if (!waveformTargetId || !waveformTarget || !waveformSource || !canLoadAudioContent(waveformTarget) ||
      waveformDuration <= 0 || waveformDuration > MAX_AUDIO_WAVEFORM_DURATION_SECONDS) {
      setAudioWaveform(current => current ? null : current);
      return;
    }
    const nodeId = waveformTargetId;
    const identity = waveformIdentity;
    const controller = new AbortController();
    setAudioWaveform(current => current?.id === nodeId && current.identity === identity ? current : null);
    void (async () => {
      try {
        const current = docRef.current.nodes.find(node => node.id === nodeId);
        if (!current || audioSourceIdentity(current) !== identity) return;
        const blob = await audioSources.read(current, controller.signal, MAX_AUDIO_WAVEFORM_INPUT_BYTES);
        const peaks = await decodeAudioWaveform(blob, waveformDuration, { signal: controller.signal });
        if (!controller.signal.aborted && docRef.current.nodes.some(node => node.id === nodeId && audioSourceIdentity(node) === identity)) {
          setAudioWaveform({ id: nodeId, identity, peaks });
        }
      } catch {
        if (!controller.signal.aborted) setAudioWaveform(current => current?.id === nodeId && current.identity === identity ? null : current);
      }
    })();
    return () => controller.abort();
  }, [audioSources.read, waveformDuration, waveformIdentity, waveformSource, waveformTarget, waveformTargetId]);
  const galleryFocusRestorePending = React.useRef(false);
  const taskFeedbackContext = React.useRef({ selected, inspectorMode, overlay, preview });
  taskFeedbackContext.current = { selected, inspectorMode, overlay, preview };
  // A completion toast adds no value while the user is still looking at the
  // task's creation panel: the inline result state is already visible there.
  // Keep consuming the event in the notification gate so a muted/suppressed
  // result is not replayed when the panel closes later.
  const completionNoticeContext = (
    resultNodes: Array<Pick<CanvasNode, "id" | "x" | "y" | "width" | "height">>,
    selectedNodeIds?: string[],
  ) => {
    const context = taskFeedbackContext.current;
    const selectedIds = selectedNodeIds ?? context.selected;
    return {
      userViewingResult: !context.overlay && !context.preview && resultNodes.some(node =>
        selectedIds.includes(node.id) && isRectInViewport(node, docRef.current.viewport, boardSize),
      ),
    };
  };
  const [imageLoadStates, setImageLoadStates] = React.useState<Record<string, ImageLoadState>>({});
  // Keep a small LRU window of successfully loaded media mounted across
  // viewport culling. Visible and selected nodes are pinned independently;
  // this bounded window avoids mounting every media node visited over time.
  const [loadedMediaNodeIds, setLoadedMediaNodeIds] = React.useState<Set<string>>(() => new Set());
  const markMediaNodeLoaded = React.useCallback((nodeId: string) => {
    setLoadedMediaNodeIds((current) => touchRetainedMediaNode(current, nodeId));
  }, []);
  const onAudioPlaybackStateChange = React.useCallback((nodeId: string, state: { duration: number; time: number }) => {
    setAudioPlaybackStates(current => {
      const previous = current[nodeId];
      if (previous?.duration === state.duration && previous.time === state.time) return current;
      const next = { ...current, [nodeId]: state };
      const keys = Object.keys(next);
      if (keys.length > 24) delete next[keys[0]!];
      return next;
    });
  }, []);
  const imageRecoveryGuard = React.useRef(new ImageRecoveryGuard());
  const imageRecoveryRequests = React.useRef(new Map<string, { source: string; promise: Promise<ImageRecoveryResult | undefined> }>());
  const imageRecoveryEpoch = React.useRef(0);
  const imageTaskRecoveryRequests = React.useRef(new Map<string, Promise<unknown>>());
  const pendingRecoveredSync = React.useRef<Document | null>(null);
  const [runtimeVideoUrls, setRuntimeVideoUrls] = React.useState<Record<string, string>>({});
  const [videoCaptureRequests, setVideoCaptureRequests] = React.useState<Record<string, number>>({});
  const [videoCaptureReadyIds, setVideoCaptureReadyIds] = React.useState<Set<string>>(() => new Set());
  const [videoPlaybackStates, setVideoPlaybackStates] = React.useState<Record<string, { duration: number; time: number; ready: boolean }>>({});
  const [videoProcessRequests, setVideoProcessRequests] = React.useState<Record<string, VideoProcessRequest>>({});
  const videoProcessJobs = React.useRef(new Map<string, VideoProcessRequest>());
  const videoProcessAbortControllers = React.useRef(new Map<string, AbortController>());
  const saveVideoProcessResultRef = React.useRef<((blob: Blob, request: VideoProcessRequest, signal: AbortSignal) => Promise<void>)>();
  const videoProcessSequence = React.useRef(0);
  const [videoProcessBusyIds, setVideoProcessBusyIds] = React.useState<Set<string>>(() => new Set());
  const [videoProcessProgress, setVideoProcessProgress] = React.useState<Record<string, number>>({});
  const [videoProcessErrors, setVideoProcessErrors] = React.useState<Record<string, string>>({});
  const [videoProcessCancels, setVideoProcessCancels] = React.useState<Record<string, number>>({});
  const onVideoCaptureReadyChange = React.useCallback((nodeId: string, ready: boolean) => {
    setVideoCaptureReadyIds(current => {
      if (current.has(nodeId) === ready) return current;
      const next = new Set(current);
      if (ready) next.add(nodeId); else next.delete(nodeId);
      return next;
    });
  }, []);
  const onVideoPlaybackStateChange = React.useCallback((nodeId: string, state: { duration: number; time: number; ready: boolean; processing: boolean }) => {
    setVideoPlaybackStates(current => {
      const next = { duration: state.duration, time: state.time, ready: state.ready };
      const previous = current[nodeId];
      if (previous && previous.duration === next.duration && previous.time === next.time && previous.ready === next.ready) return current;
      return { ...current, [nodeId]: next };
    });
  }, []);
  const startVideoProcess = React.useCallback((nodeId: string, options: VideoEditOptions) => {
    const node = docRef.current.nodes.find(item => item.id === nodeId);
    if (!alive.current || leaving.current || pendingRemovalNodes.current.has(nodeId) || !node || !canLoadVideoContent(node) || videoProcessJobs.current.has(nodeId)) return;
    const request: VideoProcessRequest = { id: ++videoProcessSequence.current, options: { ...options }, source: videoSources.current.capture(docRef.current.id, node) };
    videoProcessJobs.current.set(nodeId, request);
    setVideoProcessErrors(current => { if (!(nodeId in current)) return current; const next = { ...current }; delete next[nodeId]; return next; });
    setVideoProcessBusyIds(current => new Set(current).add(nodeId));
    setVideoProcessProgress(current => ({ ...current, [nodeId]: 0 }));
    if (options.operation === "extract-video") {
      const controller = new AbortController();
      videoProcessAbortControllers.current.set(nodeId, controller);
      setVideoProcessProgress(current => ({ ...current, [nodeId]: 10 }));
      void (async () => {
        try {
          const source = docRef.current.nodes.find(item => item.id === nodeId);
          if (!source || !videoSources.current.isCurrent(request.source, docRef.current.id, source)) throw new DOMException("原视频或画布已变化，提取已停止。", "AbortError");
          const delivery = runtimeVideoSources.current.get(nodeId);
          const deliveryNode = delivery && videoSources.current.isCurrent(request.source, docRef.current.id, source)
            ? { ...source, video: delivery.url, videoContentUrl: delivery.url, assetId: source.assetId || delivery.assetId, videoContentUrlExpiresAt: delivery.urlExpiresAt }
            : source;
          const blob = await readVideoSourceBlob(client.api, deliveryNode, { signal: controller.signal, maxBytes: LOCAL_VIDEO_MAX_BYTES });
          controller.signal.throwIfAborted();
          if (videoProcessJobs.current.get(nodeId) !== request) throw new DOMException("提取已停止。", "AbortError");
          setVideoProcessProgress(current => ({ ...current, [nodeId]: 90 }));
          if (!saveVideoProcessResultRef.current) throw new Error("视频提取暂不可用，请重试。");
          await saveVideoProcessResultRef.current(blob, request, controller.signal);
        } catch (error) {
          clearVideoProcess(nodeId, request);
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            const message = error instanceof Error ? error.message : "提取视频失败，请稍后重试。";
            setVideoProcessErrors(current => ({ ...current, [nodeId]: message }));
            setMessage(message);
          }
        } finally {
          if (videoProcessAbortControllers.current.get(nodeId) === controller) videoProcessAbortControllers.current.delete(nodeId);
        }
      })();
      return;
    }
    setVideoProcessRequests(current => ({ ...current, [nodeId]: request }));
  }, []);
  const clearVideoProcess = React.useCallback((nodeId: string, request?: VideoProcessRequest) => {
    if (request && videoProcessJobs.current.get(nodeId) !== request) return;
    videoProcessAbortControllers.current.get(nodeId)?.abort();
    videoProcessAbortControllers.current.delete(nodeId);
    videoProcessJobs.current.delete(nodeId);
    setVideoProcessRequests(current => { if (!current[nodeId]) return current; const next = { ...current }; delete next[nodeId]; return next; });
    setVideoProcessBusyIds(current => { if (!current.has(nodeId)) return current; const next = new Set(current); next.delete(nodeId); return next; });
    setVideoProcessProgress(current => { if (!(nodeId in current)) return current; const next = { ...current }; delete next[nodeId]; return next; });
    setVideoProcessErrors(current => { if (!(nodeId in current)) return current; const next = { ...current }; delete next[nodeId]; return next; });
  }, []);
  const cancelVideoProcess = React.useCallback((nodeId: string) => {
    const controller = videoProcessAbortControllers.current.get(nodeId);
    if (controller) controller.abort();
    else setVideoProcessCancels(current => ({ ...current, [nodeId]: (current[nodeId] || 0) + 1 }));
  }, []);
  const clearVideoProcessError = React.useCallback((nodeId: string) => {
    setVideoProcessErrors(current => { if (!(nodeId in current)) return current; const next = { ...current }; delete next[nodeId]; return next; });
  }, []);
  const [videoLoadingIds, setVideoLoadingIds] = React.useState<string[]>([]);
  const [videoLoadErrors, setVideoLoadErrors] = React.useState<Record<string, string>>({});
  const runtimeVideoUrlsRef = React.useRef(new Map<string, string>());
  const runtimeVideoSources = React.useRef(new Map<string, ResolvedVideoSource>());
  const videoSources = React.useRef(new VideoNodeSourceGuard());
  const videoRequests = React.useRef(new Map<string, { source: VideoNodeSourceToken; controller: AbortController }>());
  const videoRefreshRequests = React.useRef(new Map<string, Promise<boolean>>());
  const videoAutoRecovery = React.useRef(new VideoAutoRecoveryGuard());
  const videoWarmups = React.useRef(new Set<string>());
  const clearVideoNodeRuntime = React.useCallback((nodeId: string) => {
    videoSources.current.invalidate(nodeId);
    videoRequests.current.get(nodeId)?.controller.abort();
    videoRequests.current.delete(nodeId);
    videoWarmups.current.delete(nodeId);
    runtimeVideoSources.current.get(nodeId)?.release?.();
    runtimeVideoUrlsRef.current.delete(nodeId);
    runtimeVideoSources.current.delete(nodeId);
    setRuntimeVideoUrls((urls) => {
      if (!(nodeId in urls)) return urls;
      const next = { ...urls };
      delete next[nodeId];
      return next;
    });
    setVideoLoadingIds((ids) => ids.includes(nodeId) ? ids.filter(id => id !== nodeId) : ids);
    setVideoLoadErrors((errors) => {
      if (!(nodeId in errors)) return errors;
      const next = { ...errors };
      delete next[nodeId];
      return next;
    });
  }, []);
  const previewNavigation = React.useMemo(() => preview ? mediaNavigation(doc.nodes, doc.edges, preview) : null, [doc.nodes, doc.edges, preview]);
  const displayImageSource = React.useCallback((source?: string) => {
    const original = imageOriginalURL(source);
    if (!original) return original;
    // Display never swaps a loaded remote URL for a data URL. The latter is
    // reserved for explicit canvas/download operations; swapping it here
    // would decode the same image a second time and make layer thumbnails
    // retain full-resolution bytes unnecessarily.
    return original;
  }, []);
  const displayImageThumbnail = React.useCallback((source?: string, explicitThumbnail?: string) => {
    // Do not use cached full-resolution bytes for canvas cards. COS performs
    // the resize at the edge and the original is requested only by detail or
    // download flows.
    const preview = imagePreviewURL(source, explicitThumbnail);
    if (preview) return preview;
    // A COS signature covers the complete query string. If the media service
    // has not supplied a separately signed preview yet, do not silently put
    // the original object URL into a card; refreshPersistedImageUrls will
    // obtain the thumbnail by stable task/asset identity.
    return undefined;
  }, []);
  const resolveImageToolSource = async (node: CanvasNode) => {
    const source = node.image;
    if (!source && node.localImage) {
      const local = await readCachedImage(node.localImage).catch(() => null);
      if (local) return local;
    }
    if (!source) return undefined;
    if (/^data:image\//i.test(source)) return source;
    const original = imageOriginalURL(source) || source;
    const cached = getCachedRemoteImage(source) || getCachedRemoteImage(original);
    if (cached) return cached;
    if (!/^https?:\/\//i.test(original)) return source;
    // Tool operations export a canvas. Warm the existing content-addressed
    // cache first so COS signed URLs do not become a tainted canvas source.
    const localImage = await cacheRemoteImage(original).catch(() => null);
    if (!localImage) return original;
    const local = await readCachedImage(localImage).catch(() => null);
    if (!local) return original;
    return local;
  };
  /**
   * Resolve bytes for an explicit download. Canvas cards may still display a
   * stale signed URL because their local cache already has the image. Prefer
   * those durable bytes, then refresh reusable media by its stable asset ID
   * before falling back to the URL stored in the document.
   */
  const resolveImageDownloadSource = async (node: CanvasNode) => {
    let source = node.image;
    if (source && /^(?:data|blob):/i.test(source)) return source;
    if (!source && node.localImage) {
      const local = await readCachedImage(node.localImage).catch(() => null);
      if (local) return local;
    }

    // Desktop/opaque-iframe hosts can retain the original bytes outside the
    // page's IndexedDB. Reuse that cache before requesting a new signed URL.
    if (node.assetId || node.taskId) {
      const hostCached = await readHostCachedImage({
        assetId: node.assetId,
        taskId: node.taskId,
        resultIndex: node.resultIndex,
      }).catch(() => undefined);
      if (hostCached?.image) return hostCached.image;
    }

    // Inline and runtime blob sources are already complete; refreshing an
    // optional platform asset for them would only introduce another failure
    // path for a download that can be fulfilled locally.
    if (node.assetId) {
      try {
        const asset = await readPlatformAsset(client.api, node.assetId);
        if (asset.url) source = asset.url;
      } catch {
        // The persisted image URL remains a useful fallback when the asset
        // index is temporarily unavailable.
      }
    }
    if (!source) return undefined;

    const original = imageOriginalURL(source) || source;
    const cached = getCachedRemoteImage(source) || getCachedRemoteImage(original);
    if (cached) return cached;
    if (!/^https?:\/\//i.test(original)) return original;

    // Resolve through the content-addressed cache first. This both avoids
    // downloading the same image twice and repairs an expired signed URL when
    // the browser already has the bytes locally.
    const localImage = await cacheRemoteImage(original).catch(() => null);
    if (!localImage) return original;
    const local = await readCachedImage(localImage).catch(() => null);
    if (!local) return original;
    return local;
  };
  const selectPreview = (node: CanvasNode, options: { preserveInspector?: boolean } = {}) => {
    cancelDeferredCreator();
    setExportError("");
    // A gallery is a viewing surface. Do not leave the creator editor active
    // underneath it when a media node is opened by double-click or toolbar.
    // Reference previews opt out so the user can inspect an input and return
    // to the same draft without losing the editing context.
    if (!options.preserveInspector) setInspectorOpen(false);
    // Signed delivery URLs are runtime data; stable task/asset identities are
    // sufficient to restore them through the existing detail APIs.
    const delivery = runtimeVideoSources.current.get(node.id);
    setPreview(delivery ? { ...node, video: delivery.url, videoContentUrl: delivery.url, videoContentUrlExpiresAt: delivery.urlExpiresAt } : node);
  };
  const selectGalleryPreview = (node: CanvasNode, options: { preserveInspector?: boolean } = {}) => {
    const active = document.activeElement as HTMLElement | null;
    galleryFocusRestorePending.current = Boolean(active?.closest(".media-preview-stage,.media-preview-gallery"));
    selectPreview(node, options);
  };
  const loadVideoNode = React.useCallback(async (node: CanvasNode, forceRefresh = false) => {
    const current = docRef.current.nodes.find(candidate => candidate.id === node.id);
    if (!alive.current || leaving.current || !canLoadVideoContent(node) || !sameVideoNodeSource(node, current)) return false;
    const documentId = docRef.current.id;
    const previousSource = videoSources.current.get(node.id);
    if (previousSource && !videoSources.current.isCurrent(previousSource, documentId, current)) {
      clearVideoNodeRuntime(node.id);
    }
    const cached = runtimeVideoSources.current.get(node.id);
    if (!forceRefresh && cached && !videoSourceNeedsRefresh(cached, Date.now(), 0)) return true;
    if (!forceRefresh && videoRequests.current.has(node.id)) return true;
    if (forceRefresh) {
      // Keep the current URL mounted while obtaining its replacement. If the
      // element unmounts here, its local retry budget resets on every failure.
      videoRequests.current.get(node.id)?.controller.abort();
      videoRequests.current.delete(node.id);
    } else if (cached) {
      clearVideoNodeRuntime(node.id);
    }
    const source = videoSources.current.capture(documentId, node);
    const request = { source, controller: new AbortController() };
    const ownsSource = () => {
      const current = docRef.current.nodes.find(candidate => candidate.id === node.id);
      return alive.current && !leaving.current && Boolean(current && canLoadVideoContent(current)) &&
        videoSources.current.isCurrent(source, docRef.current.id, current);
    };
    const isCurrent = () => ownsSource() && videoRequests.current.get(node.id) === request;
    videoRequests.current.set(node.id, request);
    setVideoLoadingIds((ids) => ids.includes(node.id) ? ids : [...ids, node.id]);
    setVideoLoadErrors((errors) => {
      if (!errors[node.id]) return errors;
      const next = { ...errors };
      delete next[node.id];
      return next;
    });
    const startedAt = Date.now();
    try {
      recordCanvasDiagnostic("info", forceRefresh ? "video.source.refresh_started" : "video.source.resolve_started", {
        component: "video", operation: forceRefresh ? "source_refresh" : "source_resolve", phase: "metadata",
      });
      const resolved = await resolveVideoSource(client.api, node, { forceRefresh, signal: request.controller.signal });
      if (!isCurrent()) { resolved.release?.(); return false; }
      const url = resolved.url;
      runtimeVideoSources.current.get(node.id)?.release?.();
      runtimeVideoSources.current.set(node.id, resolved);
      runtimeVideoUrlsRef.current.set(node.id, url);
      setRuntimeVideoUrls((urls) => ({ ...urls, [node.id]: url }));
      // A refreshed source must also replace an expired URL in an open gallery.
      setPreview((current) => ownsSource() && current?.id === node.id && (current.video !== url || current.videoContentUrlExpiresAt !== resolved.urlExpiresAt)
        ? { ...current, video: url, videoContentUrl: url, videoContentUrlExpiresAt: resolved.urlExpiresAt }
        : current);
      markMediaNodeLoaded(node.id);
      if (!node.videoPoster && !forceRefresh) {
        // Poster extraction can trigger another metadata/byte read. Let the
        // player and first paint win, then derive a poster during an idle
        // window. It is optional and must never keep the source request in a
        // loading state.
        const idleWindow = typeof window !== "undefined" ? window as Window & {
          requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        } : undefined;
        const run = () => {
          void extractVideoPoster(url)
            .then((poster) => {
              const currentNode = docRef.current.nodes.find((candidate) => candidate.id === node.id);
              const stillCurrent = alive.current && !leaving.current && currentNode &&
                videoSources.current.isCurrent(source, docRef.current.id, currentNode);
              if (poster && stillCurrent && currentNode && !currentNode.videoPoster) {
                patchTask(node.id, { videoPoster: poster });
                void persist(docRef.current, false).catch(() => {});
              }
            })
            .catch(() => {});
        };
        if (idleWindow?.requestIdleCallback) idleWindow.requestIdleCallback(run, { timeout: 1200 });
        else setTimeout(run, 300);
      }
      recordCanvasDiagnostic("info", forceRefresh ? "video.source.refresh_finished" : "video.source.resolve_finished", {
        component: "video", operation: forceRefresh ? "source_refresh" : "source_resolve", phase: "metadata", result: "succeeded", duration_ms: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      recordCanvasDiagnostic("error", forceRefresh ? "video.source.refresh_failed" : "video.source.resolve_failed", {
        component: "video", operation: forceRefresh ? "source_refresh" : "source_resolve", phase: "metadata",
        duration_ms: Date.now() - startedAt, ...diagnosticErrorFields(error),
      });
      if (isCurrent()) {
        const knownContentError = error instanceof Error && "code" in error && String(error.code).startsWith("VIDEO_")
          ? error.message : "视频暂时无法加载，请稍后重试。";
        setVideoLoadErrors((errors) => ({ ...errors, [node.id]: knownContentError }));
      }
      return false;
    } finally {
      // A previous decoder/fetch must not clear a replacement's loading state.
      if (videoRequests.current.get(node.id) === request) {
        videoRequests.current.delete(node.id);
        setVideoLoadingIds((ids) => ids.includes(node.id) ? ids.filter((id) => id !== node.id) : ids);
      }
    }
  }, [clearVideoNodeRuntime, markMediaNodeLoaded]);
  React.useEffect(() => {
    const selectedNode = selected.length === 1
      ? doc.nodes.find((node) => node.id === selected[0])
      : undefined;
    if (selectedNode && canLoadVideoContent(selectedNode)) {
      void loadVideoNode(selectedNode);
    }
  }, [doc.nodes, selected, loadVideoNode]);
  React.useEffect(() => {
    // Resolve sources only for videos near the viewport. This keeps large
    // canvases cheap while making visible video nodes ready without a click.
    const slots = Math.max(0, 2 - videoRequests.current.size);
    if (!slots) return;
    const { x: vx, y: vy, zoom } = doc.viewport;
    const margin = 240;
    const candidates = doc.nodes.filter((node) => {
      if (videoWarmups.current.has(node.id) || videoRequests.current.has(node.id) || runtimeVideoSources.current.has(node.id) || videoLoadErrors[node.id]) return false;
      if (!canLoadVideoContent(node)) return false;
      const left = node.x * zoom + vx;
      const top = node.y * zoom + vy;
      return left < window.innerWidth + margin && top < window.innerHeight + margin && left + node.width * zoom > -margin && top + node.height * zoom > -margin;
    }).slice(0, slots);
    candidates.forEach((node) => {
      videoWarmups.current.add(node.id);
      void loadVideoNode(node).finally(() => videoWarmups.current.delete(node.id));
    });
  }, [doc.nodes, doc.viewport, loadVideoNode, videoLoadErrors, videoLoadingIds]);
  React.useLayoutEffect(() => {
    const nodeIds = new Set(doc.nodes.map((node) => node.id));
    const staleIds = new Set(videoSources.current.invalidateStale(doc.id, doc.nodes));
    for (const id of runtimeVideoUrlsRef.current.keys()) if (!nodeIds.has(id)) staleIds.add(id);
    for (const id of staleIds) { clearVideoNodeRuntime(id); clearVideoProcess(id); }
    if (staleIds.size) {
      setPreview((active) => active && staleIds.has(active.id)
        ? docRef.current.nodes.find(node => node.id === active.id) || null
        : active);
    }
  }, [clearVideoNodeRuntime, clearVideoProcess, doc.id, doc.nodes]);
  React.useEffect(() => {
    const nodeIds = new Set(doc.nodes.map((node) => node.id));
    setImageLoadStates((states) => {
      const removed = Object.keys(states).filter((id) => !nodeIds.has(id));
      if (!removed.length) return states;
      const next = { ...states };
      removed.forEach((id) => {
        delete next[id];
        imageRecoveryGuard.current.reset(id);
      });
      return next;
    });
  }, [doc.nodes]);
  React.useEffect(() => {
    // Retain only media that still belongs to the current document. A node
    // can lose its source after an edit, and keeping that id pinned would
    // gradually defeat viewport culling on a large canvas.
    const retainableIds = new Set(
      doc.nodes
        .filter((node) => hasRetainableMedia(node))
        .map((node) => node.id),
    );
    setLoadedMediaNodeIds((current) => {
      let changed = false;
      const next = new Set<string>();
      current.forEach((id) => {
        if (retainableIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : current;
    });
  }, [doc.nodes]);
  React.useEffect(() => {
    videoAutoRecovery.current.retain(doc.nodes
      .filter(node => node.type === "video" || node.mediaType === "video")
      .map(node => ({ id: node.id, recoveryKey: videoAutoRecoveryKey(node) })));
  }, [doc.nodes]);
  React.useEffect(() => () => {
    videoRequests.current.forEach(request => request.controller.abort());
    videoRequests.current.clear();
    videoRefreshRequests.current.clear();
    runtimeVideoUrlsRef.current.clear();
    runtimeVideoSources.current.forEach(source => source.release?.());
    runtimeVideoSources.current.clear();
  }, []);
  React.useEffect(() => {
    if (!preview) return;
    const current = doc.nodes.find((node) => node.id === preview.id);
    if (!current) return;
    const delivery = runtimeVideoSources.current.get(current.id);
    const runtimeVideo = delivery && !videoSourceNeedsRefresh(delivery, Date.now(), 0) ? delivery.url : undefined;
    if (runtimeVideo) {
      setPreview((active) => active?.id === current.id && (active.video !== runtimeVideo || active.videoContentUrlExpiresAt !== delivery?.urlExpiresAt)
        ? { ...active, video: runtimeVideo, videoContentUrl: runtimeVideo, videoContentUrlExpiresAt: delivery?.urlExpiresAt }
        : active);
      return;
    }
    if (current.videoContentUrl && !/^(https?:|blob:|data:)/i.test(current.videoContentUrl) && !current.taskId && !current.assetId && !current.video) {
      const message = "视频任务信息缺失，请重新生成。";
      setVideoLoadErrors((errors) => errors[current.id] === message ? errors : { ...errors, [current.id]: message });
      return;
    }
    if (current.status === "failed" && !current.video && !runtimeVideo) {
      const message = current.error || "视频任务已失败，请重新生成。";
      setVideoLoadErrors((errors) => errors[current.id] === message ? errors : { ...errors, [current.id]: message });
      return;
    }
    if (canLoadVideoContent(current) && !runtimeVideo) void loadVideoNode(current);
  }, [doc.nodes, loadVideoNode, preview?.id, preview?.taskId, preview?.video, preview?.videoContentUrl]);
  const retryVideoNode = React.useCallback((nodeId: string) => {
    const pending = videoRefreshRequests.current.get(nodeId);
    if (pending) return pending;
    const current = docRef.current.nodes.find((node) => node.id === nodeId);
    if (!current) return Promise.resolve(false);
    if (!canLoadVideoContent(current)) return Promise.resolve(false);
    const request = loadVideoNode(current, true);
    videoRefreshRequests.current.set(nodeId, request);
    const clear = () => {
      if (videoRefreshRequests.current.get(nodeId) === request) videoRefreshRequests.current.delete(nodeId);
    };
    void request.then(clear, clear);
    return request;
  }, [loadVideoNode]);
  const autoRetryVideoNode = React.useCallback((nodeId: string, recoveryKey: string) => {
    if (!videoAutoRecovery.current.tryRecover(nodeId, recoveryKey)) return Promise.resolve(false);
    return retryVideoNode(nodeId);
  }, [retryVideoNode]);
  const videoDeliveryNode = React.useCallback((node: CanvasNode) => {
    const source = videoSources.current.get(node.id);
    const delivery = runtimeVideoSources.current.get(node.id);
    if (!source || !delivery || !videoSources.current.isCurrent(source, docRef.current.id, node)) return node;
    return { ...node, video: delivery.url, videoContentUrl: delivery.url, assetId: node.assetId || delivery.assetId, videoContentUrlExpiresAt: delivery.urlExpiresAt };
  }, []);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [space, setSpace] = React.useState(false);
  const [gesturing, setGesturing] = React.useState(false);
  // Any viewport navigation can change the culling set. Keep entrance
  // animation paused until the viewport settles, so fast zoom/pan gestures do
  // not make nodes flash in and out.
  const [viewportMoving, setViewportMoving] = React.useState(false);
  const [viewportMovingMode, setViewportMovingMode] = React.useState<ViewportMotionMode | null>(null);
  const viewportMoveTimer = React.useRef<number | null>(null);
  const markViewportMoving = React.useCallback((mode: ViewportMotionMode = "direct") => {
    setViewportMoving(true);
    setViewportMovingMode(mode);
    if (viewportMoveTimer.current !== null) {
      window.clearTimeout(viewportMoveTimer.current);
    }
    viewportMoveTimer.current = window.setTimeout(() => {
      viewportMoveTimer.current = null;
      setViewportMoving(false);
      setViewportMovingMode(null);
    }, VIEWPORT_MOTION_SETTLE_MS);
  }, []);
  const freezeViewportCulling = gesturing || Boolean(viewportMoving && viewportMovingMode !== "navigate");
  // Nested dragenter/dragleave events fire as the pointer crosses nodes. A
  // depth counter keeps the file drop affordance visible until the pointer
  // really leaves the board, without reacting to node pointer drags.
  const [fileDragActive, setFileDragActive] = React.useState(false);
  const fileDragDepth = React.useRef(0);
  const clearFileDrag = React.useCallback(() => {
    fileDragDepth.current = 0;
    setFileDragActive(false);
  }, []);
  const [marquee, setMarquee] = React.useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [connecting, setConnecting] = React.useState<string | null>(null);
  // Snapshot the source port when a connection starts. The preview endpoint
  // changes as the pointer moves, but the source handle must stay anchored to
  // the exact side and y that the user grabbed.
  const [wireOrigin, setWireOrigin] = React.useState<Point | null>(null);
  const [wirePoint, setWirePoint] = React.useState<Point | null>(null);
  const [wireTarget, setWireTarget] = React.useState<string | null>(null);
  // A magnetic port follows the pointer inside the nearest outside
  // semicircle. Keeping one complete position in state prevents both ports
  // from lighting up together and keeps the hit target under the cursor.
  const [nearConnection, setNearConnection] = React.useState<NearConnection | null>(null);
  // Keep the previous magnetic handle mounted for one short exit phase. The
  // live hover state can disappear between React renders, so CSS alone cannot
  // animate the handle back to the edge midpoint reliably.
  const [exitingNearConnection, setExitingNearConnection] = React.useState<NearConnection | null>(null);
  const previousNearConnection = React.useRef<NearConnection | null>(null);
  const nearConnectionExitTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [past, setPast] = React.useState<Document[]>([]);
  const [future, setFuture] = React.useState<Document[]>([]);
  const [boardSize, setBoardSize] = React.useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const board = React.useRef<HTMLDivElement>(null);
  const appShell = React.useRef<HTMLDivElement>(null);
  const selectionActions = React.useRef<HTMLDivElement>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const imageDestination = React.useRef<{
    at: Point;
    replace?: string;
    sourceId?: string;
    targetId?: string;
    embeddedReference?: boolean;
    documentId?: string;
    videoReplacement?: VideoNodeSourceToken;
  } | null>(null);
  const nodeClipboard = React.useRef<CanvasNode[]>([]);
  const modal = React.useRef<HTMLDivElement>(null);
  const dockDrawer = React.useRef<HTMLElement>(null);
  const dockPicker = React.useRef<HTMLDivElement>(null);
  useDockPanelPosition(dockPicker, appShell, picker?.dock ? "添加节点" : null);
  React.useLayoutEffect(() => {
    if (!zoomMenu) return;
    const shell = appShell.current;
    const trigger = shell?.querySelector<HTMLElement>(".zoom-toggle");
    const panel = shell?.querySelector<HTMLElement>(".zoom-menu");
    if (!shell || !trigger || !panel) return;
    const place = () => {
      const shellBounds = shell.getBoundingClientRect();
      const dock = trigger.closest<HTMLElement>(".canvas-utilities")!.getBoundingClientRect();
      panel.style.setProperty("--zoom-menu-max-height", `${Math.max(64, dock.top - shellBounds.top - 36)}px`);
      const a = trigger.getBoundingClientRect();
      const b = panel.getBoundingClientRect();
      panel.style.setProperty("--dock-arrow-x", `${Math.max(16, Math.min(b.width - 16, a.left + a.width / 2 - b.left))}px`);
    };
    place();
    panel.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(shell);
    observer.observe(trigger);
    return () => {
      observer.disconnect();
      if (panel.contains(document.activeElement)) trigger.focus({ preventScroll: true });
    };
  }, [zoomMenu]);
  const floatingOverlay = !preview && (overlay === "help" || overlay === "settings");
  // Retain presentation during the exit animation; a closing floating panel must
  // never flash a full-screen backdrop.
  const overlayPresentation = React.useRef(false);
  if (overlay || preview) overlayPresentation.current = floatingOverlay;
  useDockPanelPosition(modal, appShell, floatingOverlay ? overlay === "settings" ? "自定义画布" : "快捷键与帮助" : null);
  useDockPanelPosition(dockDrawer, appShell, (drawer === "layers" || drawer === "assets") ? "素材与图层" : null);

  const dirty = React.useRef(false);
  const saveTimer = React.useRef<number | null>(null);
  const cloudSaveTimer = React.useRef<number | null>(null);
  const drag = React.useRef<{
    start: Point;
    ids: string[];
    // A group drag moves every logical member, including collapsed task
    // metadata, while React selection only contains visible cards.
    selectionIds?: string[];
    before: Document;
    origins: Map<string, Point>;
    moved: boolean;
    groupId?: string;
    groupOrigin?: GroupFrame;
    inspectId?: string;
    deferInspect?: boolean;
    clickId?: string;
    keepSelectionOnClick?: boolean;
    previousSelection?: string[];
    movedIdSet: Set<string>;
  } | null>(null);
  const resize = React.useRef<{
    start: Point;
    node: CanvasNode;
    before: Document;
    moved: boolean;
  } | null>(null);
  const pan = React.useRef<{ start: Point; viewport: Viewport; moved: boolean; tapToClear?: boolean } | null>(null);
  const box = React.useRef<{ start: Point; base: string[]; before: string[]; inspector: typeof inspectorMode } | null>(null);
  const wireDrag = React.useRef<{
    from: string;
    start: Point;
    moved: boolean;
  } | null>(null);
  const spacePressed = React.useRef(false);
  // The global keyboard listener is mounted once. This ref is refreshed on
  // every render so shortcuts always operate on current state and handlers.
  const keyboardContextRef = React.useRef<KeyboardContext | null>(null);
  const gesturePointer = React.useRef<{ id: number; type: string } | null>(null);
  const capturedPointers = React.useRef(new Map<number, Element>());
  const touches = React.useRef(new Map<number, Point>());
  const pinch = React.useRef<{ ids: [number, number]; start: [Point, Point]; viewport: Viewport } | null>(null);
  // Keep the last pointer location in board coordinates so viewport changes
  // can refresh the magnetic handle even when the pointer itself is still.
  const pointerScreen = React.useRef<Point | null>(null);
  const pointerInside = React.useRef(false);
  // Pointer events can arrive faster than React can paint a large graph. Keep
  // only the latest drag/resize position and project it once per animation
  // frame; pointer-up flushes the pending frame before committing history.
  const geometryFrame = React.useRef<number | null>(null);
  const pendingGeometryPoint = React.useRef<Point | null>(null);
  const magneticFrame = React.useRef<number | null>(null);
  const pendingMagneticPoint = React.useRef<Point | null>(null);
  const magneticUpdateRef = React.useRef<(p: Point) => void>(() => {});
  const connectingRef = React.useRef<string | null>(connecting);
  connectingRef.current = connecting;
  const touchSelection = React.useRef<{ selected: string[]; inspector: typeof inspectorMode } | null>(null);
  const suppressClick = React.useRef(false);
  const clickSequence = React.useRef<{ key: string; at: number; count: number } | null>(null);
  const deferredCreatorTimer = React.useRef<number | null>(null);
  const editCancelled = React.useRef(false);
  const cancelDeferredCreator = () => {
    if (deferredCreatorTimer.current !== null) {
      window.clearTimeout(deferredCreatorTimer.current);
      deferredCreatorTimer.current = null;
    }
  };
  const deferCreatorOpen = (nodeId: string) => {
    cancelDeferredCreator();
    deferredCreatorTimer.current = window.setTimeout(() => {
      deferredCreatorTimer.current = null;
      if (preview || referencePickTarget || tool !== "select") return;
      if (selectedRef.current.length === 1 && selectedRef.current[0] === nodeId) setInspectorMode("edit");
    }, 320);
  };
  React.useEffect(() => () => cancelDeferredCreator(), []);
  React.useEffect(() => {
    if (preview || overlay || referencePickTarget || tool !== "select") cancelDeferredCreator();
  }, [preview, overlay, referencePickTarget, tool]);
  const focusCanvas = () => {
    setCreatorFocusRequest(0);
    board.current?.focus({ preventScroll: true });
  };
  const closeInspector = () => {
    cancelDeferredCreator();
    setInspectorOpen(false);
    setReferenceRequest(0);
    // Return focus before the editor's exit animation, so the next key acts
    // on the selected node instead of the still-mounted prompt textarea.
    focusCanvas();
  };
  const blurCreator = () => {
    setCreatorFocusRequest(0);
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.closest(".context-creator,.inspector,.context-settings-popover")) focusCanvas();
  };
  const isPending = hasPendingNodeTask;
  const chosen = React.useMemo(
    () => doc.nodes.filter((node) => selected.includes(node.id)),
    [doc.nodes, selected],
  );
  const primary = chosen.length === 1 ? chosen[0] : undefined;
  const primaryInteraction = primary
    ? nodeInteraction(primary, doc.nodes, doc.edges, {
        hasPendingTask: isPending(primary),
      })
    : null;
  const groupFrames = React.useMemo<CanvasGroupFrame[]>(() => {
    const frames = normalizeGroupFrames(doc.nodes, doc.groups);
    return frames.map((frame) => {
      const nodes = doc.nodes.filter((node) =>
        node.groupId === frame.id && !isCollapsedResultTask(node, doc.nodes, doc.edges),
      );
      return {
        ...frame,
        count: nodes.length,
        selected: nodes.some((node) => selected.includes(node.id)),
        label: isGeneratedBatchGroup(frame.id, nodes)
          ? `生成结果 · ${nodes.length}`
          : `节点组 · ${nodes.length}`,
      };
    }).filter((frame) => frame.count > 1);
  }, [doc.nodes, doc.groups, doc.edges, selected]);
  const selectedWholeGroup = React.useMemo(() => {
    if (chosen.length < 2) return false;
    const ids = new Set(chosen.map((node) => node.groupId).filter((id): id is string => Boolean(id)));
    if (ids.size !== 1 || chosen.some((node) => !node.groupId)) return false;
    const groupId = [...ids][0];
    const members = doc.nodes.filter((node) =>
      node.groupId === groupId && !isCollapsedResultTask(node, doc.nodes, doc.edges),
    );
    return members.length === chosen.length && members.every((node) => selected.includes(node.id));
  }, [chosen, doc.nodes, doc.edges, selected]);
  const canvasNodes = React.useMemo(
    () => doc.nodes.filter((node) => !isCollapsedResultTask(node, doc.nodes, doc.edges)),
    [doc.nodes, doc.edges],
  );
  const nodeById = React.useMemo(
    () => new Map(doc.nodes.map((node) => [node.id, node])),
    [doc.nodes],
  );
  const canvasEdges = React.useMemo(
    () => visibleCanvasEdges(doc.nodes, doc.edges),
    // Geometry-only drag frames do not change graph visibility or edge
    // identity. Reuse the semantic edge list and let path calculation read
    // the current node positions separately.
    [workflowRevision],
  );
  const edgeTopologyByNodeId = React.useMemo(() => {
    const topology = new Map<string, { incomingSource?: CanvasNode; outgoingTarget?: CanvasNode }>();
    for (const node of canvasNodes) topology.set(node.id, {});
    for (const edge of canvasEdges) {
      const source = nodeById.get(edge.from);
      const target = nodeById.get(edge.to);
      if (source && target) {
        const targetTopology = topology.get(target.id);
        if (targetTopology && !targetTopology.incomingSource) targetTopology.incomingSource = source;
        const sourceTopology = topology.get(source.id);
        if (sourceTopology && !sourceTopology.outgoingTarget) sourceTopology.outgoingTarget = target;
      }
    }
    return topology;
  }, [canvasEdges, canvasNodes, nodeById]);
  const nodeInteractionById = React.useMemo(() => {
    const interactions = new Map<string, ReturnType<typeof nodeInteraction>>();
    for (const node of canvasNodes) {
      interactions.set(node.id, nodeInteraction(node, doc.nodes, doc.edges, {
        hasPendingTask: isPending(node),
      }));
    }
    return interactions;
  }, [workflowRevision]);
  // Magnetic hit testing runs for ordinary pointer movement. Keep its
  // candidate list and identity lookup stable for the current graph instead
  // of filtering every node on every pointer event.
  const magneticNodes = React.useMemo(
    () => [...canvasNodes].reverse().filter((node) => {
      const interaction = nodeInteractionById.get(node.id);
      return Boolean(interaction?.canReceiveConnection || interaction?.canStartConnection);
    }),
    [canvasNodes, nodeInteractionById],
  );
  const magneticNodeById = React.useMemo(
    () => new Map(magneticNodes.map((node) => [node.id, node])),
    [magneticNodes],
  );
  const connectionCountsByNodeId = React.useMemo(() => {
    const counts = new Map<string, { incoming: number; outgoing: number }>();
    for (const node of canvasNodes) counts.set(node.id, { incoming: 0, outgoing: 0 });
    for (const edge of canvasEdges) {
      const source = counts.get(edge.from);
      const target = counts.get(edge.to);
      if (source) source.outgoing += 1;
      if (target) target.incoming += 1;
    }
    return counts;
  }, [workflowRevision]);
  // NeoWOW keeps a generous screen-space buffer around the viewport so
  // panning does not reveal blank frames, while avoiding a full DOM tree for
  // large imported canvases. Interaction state and successfully loaded media
  // pin content that should remain stable even when it moves outside view.
  const viewportRenderMargin = doc.nodes.length > 50 ? 640 : 320;
  const renderedNodeIdsRef = React.useRef<Set<string>>(new Set());
  const settledNodeIdsRef = React.useRef<Set<string>>(new Set());
  const renderedEdgeIdsRef = React.useRef<Set<string>>(new Set());
  const settledEdgeIdsRef = React.useRef<Set<string>>(new Set());
  const retainedMediaNodeIds = React.useMemo(
    () => [...loadedMediaNodeIds].filter((id) => {
      const node = nodeById.get(id);
      return Boolean(node && hasRetainableMedia(node));
    }),
    [loadedMediaNodeIds, nodeById],
  );
  const pinnedNodeIds = React.useMemo(() => new Set(
    [
      ...selected,
      ...removingNodeIds,
      connecting,
      wireTarget,
      primary?.id,
      ...retainedMediaNodeIds,
    ].filter((id): id is string => Boolean(id)),
  ), [connecting, primary?.id, removingNodeIds, retainedMediaNodeIds, selected, wireTarget]);
  const renderedNodeIds = React.useMemo(() => {
    // Keep the current render set while a gesture is in flight so a fast pan
    // does not rebuild the DOM on every intermediate frame. Once the viewport
    // settles, only visible, pinned, and exit-animation nodes remain mounted;
    // previously visited nodes are deliberately allowed to unmount.
    if (freezeViewportCulling) {
      const next = new Set(renderedNodeIdsRef.current);
      pinnedNodeIds.forEach((id) => next.add(id));
      viewportExitingNodeIds.forEach((id) => next.add(id));
      return next;
    }
    const next = new Set(
      canvasNodes
        .filter((node) =>
          pinnedNodeIds.has(node.id) ||
          isRectInViewport(node, doc.viewport, boardSize, viewportRenderMargin),
        )
        .map((node) => node.id),
    );
    // An exit state is visual only. Keep these nodes mounted until their
    // timer removes them, while the culling set above remains the source of
    // truth for the next settled viewport.
    viewportExitingNodeIds.forEach((id) => next.add(id));
    return next;
  }, [boardSize, canvasNodes, doc.viewport, freezeViewportCulling, pinnedNodeIds, viewportExitingNodeIds, viewportRenderMargin]);
  const settledNodeIds = React.useMemo(() => {
    if (freezeViewportCulling) {
      const next = new Set(settledNodeIdsRef.current);
      pinnedNodeIds.forEach((id) => next.add(id));
      return next;
    }
    return new Set(
      canvasNodes
        .filter((node) =>
          pinnedNodeIds.has(node.id) ||
          isRectInViewport(node, doc.viewport, boardSize, viewportRenderMargin),
        )
        .map((node) => node.id),
    );
  }, [boardSize, canvasNodes, doc.viewport, freezeViewportCulling, pinnedNodeIds, viewportRenderMargin]);
  React.useLayoutEffect(() => {
    // If an exit candidate comes back into the buffered viewport before its
    // timer fires, cancel the exit immediately (including during a new
    // gesture) so it never reappears on its final faded frame.
    const returned = viewportExitingNodeIds.filter((id) => settledNodeIds.has(id));
    if (returned.length) {
      returned.forEach((id) => {
        const timer = viewportExitNodeTimers.current.get(id);
        if (timer) clearTimeout(timer);
        viewportExitNodeTimers.current.delete(id);
      });
      setViewportExitingNodeIds((current) => current.filter((id) => !returned.includes(id)));
    }
    // Only compare settled viewport sets. During a gesture the previous set
    // is deliberately held, so an intermediate frame cannot trigger exit
    // timers for nodes that may immediately return into the buffer.
    if (!viewportMoving && !gesturing) {
      const leaving = [...settledNodeIdsRef.current].filter((id) =>
        !settledNodeIds.has(id) &&
        !removingNodeIds.includes(id) &&
        canvasNodes.some((node) => node.id === id),
      );
      if (leaving.length) {
        setViewportExitingNodeIds((current) => [...new Set([...current, ...leaving])]);
        leaving.forEach((id) => {
          if (viewportExitNodeTimers.current.has(id)) return;
          const timer = setTimeout(() => {
            viewportExitNodeTimers.current.delete(id);
            setViewportExitingNodeIds((current) => current.filter((item) => item !== id));
          }, VIEWPORT_EXIT_DURATION_MS);
          viewportExitNodeTimers.current.set(id, timer);
        });
      }
      settledNodeIdsRef.current = settledNodeIds;
    }
    renderedNodeIdsRef.current = renderedNodeIds;
  }, [canvasNodes, gesturing, removingNodeIds, renderedNodeIds, settledNodeIds, viewportExitingNodeIds, viewportMoving]);
  const renderedNodes = React.useMemo(
    () => canvasNodes.filter((node) => renderedNodeIds.has(node.id)),
    [canvasNodes, renderedNodeIds],
  );
  const settledEdgeIds = React.useMemo(() => {
    if (freezeViewportCulling) {
      const next = new Set(settledEdgeIdsRef.current);
      if (selectedEdge) next.add(selectedEdge);
      return next;
    }
    return new Set(
      canvasEdges
        .filter((edge) =>
          (settledNodeIds.has(edge.from) || settledNodeIds.has(edge.to)) || edge.id === selectedEdge,
        )
        .map((edge) => edge.id),
    );
  }, [canvasEdges, freezeViewportCulling, selectedEdge, settledNodeIds]);
  const renderedEdgeIds = React.useMemo(() => {
    if (freezeViewportCulling) {
      const ids = new Set(renderedEdgeIdsRef.current);
      if (selectedEdge) ids.add(selectedEdge);
      viewportExitingEdgeIds.forEach((id) => ids.add(id));
      return ids;
    }
    const ids = new Set(
      canvasEdges
        .filter((edge) => renderedNodeIds.has(edge.from) || renderedNodeIds.has(edge.to) || edge.id === selectedEdge)
        .map((edge) => edge.id),
    );
    viewportExitingEdgeIds.forEach((id) => ids.add(id));
    return ids;
  }, [canvasEdges, freezeViewportCulling, renderedNodeIds, selectedEdge, viewportExitingEdgeIds]);
  React.useLayoutEffect(() => {
    const returned = viewportExitingEdgeIds.filter((id) => settledEdgeIds.has(id));
    if (returned.length) {
      returned.forEach((id) => {
        const timer = viewportExitEdgeTimers.current.get(id);
        if (timer) clearTimeout(timer);
        viewportExitEdgeTimers.current.delete(id);
      });
      setViewportExitingEdgeIds((current) => current.filter((id) => !returned.includes(id)));
    }
    if (!viewportMoving && !gesturing) {
      const leaving = [...settledEdgeIdsRef.current].filter((id) =>
        !settledEdgeIds.has(id) &&
        !removingEdgeIds.includes(id) &&
        canvasEdges.some((edge) => edge.id === id),
      );
      if (leaving.length) {
        setViewportExitingEdgeIds((current) => [...new Set([...current, ...leaving])]);
        leaving.forEach((id) => {
          if (viewportExitEdgeTimers.current.has(id)) return;
          const timer = setTimeout(() => {
            viewportExitEdgeTimers.current.delete(id);
            setViewportExitingEdgeIds((current) => current.filter((item) => item !== id));
          }, VIEWPORT_EXIT_DURATION_MS);
          viewportExitEdgeTimers.current.set(id, timer);
        });
      }
      settledEdgeIdsRef.current = settledEdgeIds;
    }
    renderedEdgeIdsRef.current = renderedEdgeIds;
  }, [canvasEdges, gesturing, removingEdgeIds, renderedEdgeIds, settledEdgeIds, viewportExitingEdgeIds, viewportMoving]);
  const renderedEdges = React.useMemo(
    () => canvasEdges.filter((edge) => renderedEdgeIds.has(edge.id)),
    [canvasEdges, renderedEdgeIds],
  );
  const [viewportExitingGroupIds, setViewportExitingGroupIds] = React.useState<string[]>([]);
  const viewportExitGroupTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [exitingGroupFrames, setExitingGroupFrames] = React.useState<CanvasGroupFrame[]>([]);
  const previousGroupFramesRef = React.useRef(new Map<string, CanvasGroupFrame>());
  const groupFrameExitTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const renderedGroupFrameIdsRef = React.useRef<Set<string>>(new Set());
  const settledGroupFrameIdsRef = React.useRef<Set<string>>(new Set());
  const settledGroupFrameIds = React.useMemo(() => {
    if (freezeViewportCulling) {
      const next = new Set(settledGroupFrameIdsRef.current);
      return next;
    }
    return new Set(
      groupFrames
        .filter((frame) =>
          isRectInViewport(frame, doc.viewport, boardSize, viewportRenderMargin) ||
          frame.selected,
        )
        .map((frame) => frame.id),
    );
  }, [boardSize, doc.viewport, freezeViewportCulling, groupFrames, viewportRenderMargin]);
  const renderedGroupFrameIds = React.useMemo(() => {
    if (freezeViewportCulling) {
      const next = new Set(renderedGroupFrameIdsRef.current);
      viewportExitingGroupIds.forEach((id) => next.add(id));
      return next;
    }
    const next = new Set(
      settledGroupFrameIds,
    );
    viewportExitingGroupIds.forEach((id) => next.add(id));
    return next;
  }, [freezeViewportCulling, renderedGroupFrameIdsRef, settledGroupFrameIds, viewportExitingGroupIds]);
  React.useLayoutEffect(() => {
    const currentById = new Map(groupFrames.map((frame) => [frame.id, frame]));
    const removed = [...previousGroupFramesRef.current.entries()]
      .filter(([id]) => !currentById.has(id))
      .map(([, frame]) => frame);
    if (removed.length) {
      setExitingGroupFrames((current) => {
        const existing = new Set(current.map((frame) => frame.id));
        return [...current, ...removed.filter((frame) => !existing.has(frame.id))];
      });
      removed.forEach((frame) => {
        if (groupFrameExitTimers.current.has(frame.id)) return;
        const timer = setTimeout(() => {
          groupFrameExitTimers.current.delete(frame.id);
          setExitingGroupFrames((current) => current.filter((item) => item.id !== frame.id));
        }, GROUP_EXIT_DURATION_MS);
        groupFrameExitTimers.current.set(frame.id, timer);
      });
    }
    const returnedFrames = exitingGroupFrames.filter((frame) => currentById.has(frame.id));
    if (returnedFrames.length) {
      returnedFrames.forEach((frame) => {
        const timer = groupFrameExitTimers.current.get(frame.id);
        if (timer) clearTimeout(timer);
        groupFrameExitTimers.current.delete(frame.id);
      });
      setExitingGroupFrames((current) => current.filter((frame) => !returnedFrames.some((item) => item.id === frame.id)));
    }
    previousGroupFramesRef.current = currentById;
    const returned = viewportExitingGroupIds.filter((id) => settledGroupFrameIds.has(id));
    if (returned.length) {
      returned.forEach((id) => {
        const timer = viewportExitGroupTimers.current.get(id);
        if (timer) clearTimeout(timer);
        viewportExitGroupTimers.current.delete(id);
      });
      setViewportExitingGroupIds((current) => current.filter((id) => !returned.includes(id)));
    }
    if (!viewportMoving && !gesturing) {
      const leaving = [...settledGroupFrameIdsRef.current].filter((id) =>
        !settledGroupFrameIds.has(id) && groupFrames.some((frame) => frame.id === id),
      );
      if (leaving.length) {
        setViewportExitingGroupIds((current) => [...new Set([...current, ...leaving])]);
        leaving.forEach((id) => {
          if (viewportExitGroupTimers.current.has(id)) return;
          const timer = setTimeout(() => {
            viewportExitGroupTimers.current.delete(id);
            setViewportExitingGroupIds((current) => current.filter((item) => item !== id));
          }, GROUP_EXIT_DURATION_MS);
          viewportExitGroupTimers.current.set(id, timer);
        });
      }
      settledGroupFrameIdsRef.current = settledGroupFrameIds;
    }
    renderedGroupFrameIdsRef.current = renderedGroupFrameIds;
  }, [exitingGroupFrames, gesturing, groupFrames, renderedGroupFrameIds, settledGroupFrameIds, viewportExitingGroupIds, viewportMoving]);
  const renderedGroupFrames = React.useMemo(
    () => [
      ...groupFrames.filter((frame) => renderedGroupFrameIds.has(frame.id)),
      ...exitingGroupFrames.filter((frame) => !renderedGroupFrameIds.has(frame.id)),
    ],
    [exitingGroupFrames, groupFrames, renderedGroupFrameIds],
  );
  const aspectRepairing = React.useRef(new Set<string>());
  React.useEffect(() => {
    // Aspect repair is an automatic migration. Wait until platform hydration
    // has selected the working document so it cannot manufacture a version
    // conflict while local and cloud snapshots are being compared.
    if (!draftReady || (platformReady && (authState === "checking" || platformLoading)))
      return;
    // Image nodes are always rendered at the source aspect ratio. Repair old
    // square/default cards as well as any completed prompt whose dimensions no
    // longer match its bitmap; the resize handle below preserves this ratio.
    const candidates = doc.nodes.filter((node) =>
      Boolean(node.image) &&
      (node.type === "image" || node.type === "prompt") &&
      // Geometry probing creates an image request even when the node is far
      // outside the current canvas. Probe only the buffered viewport; the
      // browser's thumbnail onLoad callback still repairs a node when it is
      // actually brought into view.
      (isRectInViewport(node, doc.viewport, boardSize, viewportRenderMargin) ||
        selected.includes(node.id) || preview?.id === node.id) &&
      // A COS original is not a valid geometry probe for a card. Wait for the
      // signed thumbnail to arrive through task/asset recovery instead of
      // downloading the full-resolution object just to measure it.
      (!isCosImageURL(node.image) || Boolean(node.imageThumbnail)) &&
      !aspectRepairing.current.has(node.id),
    );
    if (!candidates.length) return;
    candidates.forEach((node) => aspectRepairing.current.add(node.id));
    let cancelled = false;
    void Promise.all(candidates.map(async (node) => [node.id, await readImageNodeSize(node.imageThumbnail || node.image!)] as const)).then((sizes) => {
      if (cancelled) return;
      const byId = new Map(sizes);
      const nodes = docRef.current.nodes.map((node) => {
        const size = byId.get(node.id);
        if (!size) return node;
        const sourceRatio = size.height / Math.max(1, size.width);
        const nodeRatio = node.height / Math.max(1, node.width);
        return Math.abs(sourceRatio - nodeRatio) > 0.02
          ? { ...node, width: size.width, height: size.height }
          : node;
      });
      if (nodes.some((node, index) => node.width !== docRef.current.nodes[index].width || node.height !== docRef.current.nodes[index].height)) {
        dirty.current = true;
        replaceDoc({
          ...docRef.current,
          nodes,
          groups: expandGroupFrames(nodes, docRef.current.groups),
          updatedAt: now(),
        });
      }
    });
    return () => { cancelled = true; };
  }, [boardSize, doc.nodes, doc.viewport, draftReady, platformReady, authState, platformLoading, preview?.id, selected, viewportRenderMargin]);
  React.useEffect(() => {
    const hidden = new Set(
      doc.nodes
        .filter((node) => isCollapsedResultTask(node, doc.nodes, doc.edges))
        .map((node) => node.id),
    );
    // The task drawer may intentionally inspect a hidden completed task. It
    // remains selectable in details and its editor, while the canvas itself
    // never renders it. Closing the inspector restores normal selection.
    if (inspectorMode && selected.length === 1 && hidden.has(selected[0])) return;
    if (!selected.some((id) => hidden.has(id))) return;
    setSelected((ids) => ids.filter((id) => !hidden.has(id)));
    setSelectedEdge(null);
    setInspectorMode(null);
  }, [doc.nodes, doc.edges, selected, inspectorMode]);

  const stopRemovedNodeRequests = (ids: readonly string[]) => {
    if (!ids.length) return;
    const removed = new Set(ids);
    // Invalidate ownership before aborting: even an accepted POST or image
    // decode that finishes later must not write into an undone/restored node.
    ids.forEach((id) => {
      const controller = activeRequests.current.get(id);
      activeRequests.current.delete(id);
      controller?.abort("deleted");
      clearVideoProcess(id);
      clearVideoNodeRuntime(id);
      imageRecoveryRequests.current.delete(id);
      imageRecoveryGuard.current.reset(id);
    });
    setActiveIds((current) => current.some((id) => removed.has(id))
      ? current.filter((id) => !removed.has(id)) : current);
    setPreview((current) => current && removed.has(current.id) ? null : current);
  };
  const replaceDoc = (
    next: Document,
    motionFrame = false,
    motionMode: ViewportMotionMode = "direct",
    nodesStructureUnchanged = false,
  ) => {
    // All document mutations, including Agent deletion, share this cleanup.
    // Viewport-only frames retain the immutable node array. Avoid rebuilding
    // the full node-ID set and scanning every node while panning or zooming.
    // Geometry/content edits replace the array and still take the complete
    // cleanup path so deleted nodes cannot keep writing late results.
    const current = docRef.current;
    const graphChanged = current.nodes !== next.nodes || current.edges !== next.edges;
    if (graphChanged && !nodesStructureUnchanged) {
      setWorkflowRevision((revision) => revision + 1);
    }
    if (!nodesStructureUnchanged && (current.id !== next.id || current.nodes !== next.nodes)) {
      const nextIds = new Set(next.nodes.map((node) => node.id));
      const removedIds = current.nodes
        .filter((node) => current.id !== next.id || !nextIds.has(node.id))
        .map((node) => node.id);
      stopRemovedNodeRequests(removedIds);
    }
    // A few document operations (history restore and fit-after-layout) replace
    // the snapshot directly instead of calling `view()`. Keep those paths in
    // the same viewport animation lifecycle so a newly visible node can never
    // be left paused by an untracked zoom.
    const cameraChanged = viewportChanged(current.viewport, next.viewport);
    if (!motionFrame && (current.id !== next.id || cameraChanged)) viewportMotion.cancel();
    if (current.id === next.id && cameraChanged) {
      markViewportMoving(motionMode);
    }
    docRef.current = next;
    setDoc(next);
  };
  const commit = (change: (value: Document) => Document) => {
    const current = docRef.current,
      next = change(current);
    if (next === current || JSON.stringify(next) === JSON.stringify(current))
      return;
    dirty.current = true;
    setPast((items) => [...items.slice(-49), clone(current)]);
    setFuture([]);
    replaceDoc({ ...next, updatedAt: now() });
  };
  const [viewportMotion] = React.useState(() => new ViewportMotion({
    read: () => docRef.current.viewport,
    render: (viewport, edited, mode) => {
      // The scheduler already limits camera work to one update per frame.
      // Commit before that paint; deferring again through React adds a second
      // frame of input lag and lets overlays temporarily trail the world.
      flushSync(() => {
        if (edited) dirty.current = true;
        replaceDoc({
          ...docRef.current, viewport,
          updatedAt: edited ? now() : docRef.current.updatedAt,
        }, true, mode);
      });
    },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    now: () => performance.now(),
    reducedMotion: () => preferencesRef.current.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  React.useEffect(() => () => viewportMotion.cancel(), [viewportMotion]);
  const view = (viewport: Viewport, edited = true) => viewportMotion.move(viewport, { edited });
  const navigateView = (viewport: Viewport) => viewportMotion.move(viewport, { mode: docRef.current.nodes.length > preferencesRef.current.locateAnimationLimit ? "direct" : "navigate" });
  const point = (x: number, y: number): Point => {
    const rect = board.current!.getBoundingClientRect(),
      v = docRef.current.viewport;
    return {
      x: (x - rect.left - v.x) / v.zoom,
      y: (y - rect.top - v.y) / v.zoom,
    };
  };
  const applyGeometryMove = (clientX: number, clientY: number) => {
    const p = point(clientX, clientY);
    const r = resize.current;
    if (r?.moved) {
      const dx = p.x - r.start.x;
      const dy = p.y - r.start.y;
      let width = Math.min(1600, Math.max(120, r.node.width + dx));
      let height = Math.min(1200, Math.max(80, r.node.height + dy));
      if (r.node.type === "image" || (r.node.type === "prompt" && Boolean(r.node.image))) {
        const ratio =
          Math.abs(dx / r.node.width) > Math.abs(dy / r.node.height)
            ? 1 + dx / r.node.width
            : 1 + dy / r.node.height;
        const scale = Math.max(
          120 / r.node.width,
          80 / r.node.height,
          Math.min(1600 / r.node.width, 1200 / r.node.height, ratio),
        );
        width = r.node.width * scale;
        height = r.node.height * scale;
      }
      replaceDoc({
        ...docRef.current,
        nodes: docRef.current.nodes.map((node) =>
          node.id === r.node.id ? { ...node, width, height } : node,
        ),
      }, false, "direct", true);
      return;
    }
    const d = drag.current;
    if (!d?.moved) return;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const origin = d.origins.get(d.ids[0]);
    if (!origin) return;
    const gridSize = canvasPreferences.gridSize;
    const tx = snapToGrid
        ? Math.round((origin.x + dx) / gridSize) * gridSize - origin.x
        : dx,
      ty = snapToGrid ? Math.round((origin.y + dy) / gridSize) * gridSize - origin.y : dy;
    const movedIds = d.selectionIds || d.ids;
    const movedIdSet = d.movedIdSet || new Set(movedIds);
    const movedNodes = docRef.current.nodes.map((node) => {
      const original = d.origins.get(node.id);
      return movedIdSet.has(node.id) && original
        ? { ...node, x: original.x + tx, y: original.y + ty }
        : node;
    });
    replaceDoc({
      ...docRef.current,
      nodes: movedNodes,
      groups: d.groupId
        ? normalizeGroupFrames(movedNodes, undefined)
        : docRef.current.groups || [],
    }, false, "direct", true);
  };
  const cancelGeometryFrame = () => {
    if (geometryFrame.current !== null) {
      window.cancelAnimationFrame(geometryFrame.current);
      geometryFrame.current = null;
    }
    pendingGeometryPoint.current = null;
  };
  const flushGeometryFrame = () => {
    if (geometryFrame.current !== null) {
      window.cancelAnimationFrame(geometryFrame.current);
      geometryFrame.current = null;
    }
    const pending = pendingGeometryPoint.current;
    pendingGeometryPoint.current = null;
    if (pending) applyGeometryMove(pending.x, pending.y);
  };
  const scheduleGeometryMove = (clientX: number, clientY: number) => {
    pendingGeometryPoint.current = { x: clientX, y: clientY };
    if (geometryFrame.current !== null) return;
    geometryFrame.current = window.requestAnimationFrame(() => {
      geometryFrame.current = null;
      const pending = pendingGeometryPoint.current;
      pendingGeometryPoint.current = null;
      if (pending) applyGeometryMove(pending.x, pending.y);
    });
  };
  const screenPoint = (x: number, y: number): Point => {
    const rect = board.current!.getBoundingClientRect();
    return { x: x - rect.left, y: y - rect.top };
  };
  const centerPoint = () => {
    const rect = board.current!.getBoundingClientRect();
    return point(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  React.useLayoutEffect(() => {
    const toolbar = selectionActions.current;
    const canvas = board.current;
    if (!toolbar || !canvas) return;
    if (chosen.length < 2) {
      // The same toolbar is reused for a selected edge. Clear the previous
      // multi-selection coordinates so the edge actions return to CSS layout.
      toolbar.style.removeProperty("left");
      toolbar.style.removeProperty("top");
      toolbar.style.removeProperty("bottom");
      toolbar.dataset.positioned = "true";
      toolbar.dataset.placement = "default";
      return;
    }
    toolbar.dataset.positioned = "false";
    const rect = canvas.getBoundingClientRect();
    const zoom = docRef.current.viewport.zoom || 1;
    const top = Math.min(...chosen.map((node) => node.y * zoom + docRef.current.viewport.y));
    const bottom = Math.max(...chosen.map((node) => (node.y + node.height) * zoom + docRef.current.viewport.y));
    const toolbarRect = toolbar.getBoundingClientRect();
    const inset = 12;
    const gap = 12;
    // Keep the action bar anchored to the canvas center. Following the
    // selection center makes the bar drift to the side when the selection is
    // near an edge, especially when it is placed below the nodes.
    const center = rect.width / 2;
    const minCenter = inset + toolbarRect.width / 2;
    const maxCenter = Math.max(minCenter, rect.width - inset - toolbarRect.width / 2);
    const x = Math.max(minCenter, Math.min(maxCenter, center));
    const above = top - toolbarRect.height - gap;
    const below = bottom + gap;
    const canPlaceAbove = above >= inset;
    const canPlaceBelow = below + toolbarRect.height <= rect.height - inset;
    const y = canPlaceAbove ? above : canPlaceBelow ? below : Math.max(inset, rect.height - toolbarRect.height - inset);
    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${y}px`;
    toolbar.style.bottom = "auto";
    toolbar.dataset.placement = canPlaceAbove ? "above" : "below";
    toolbar.dataset.positioned = "true";
  }, [selected.join("|"), doc.nodes, doc.viewport.x, doc.viewport.y, doc.viewport.zoom, boardSize.width, boardSize.height, chosen.length]);
  const update = (ids: string[], patch: Partial<CanvasNode>) =>
    commit((value) => ({
      ...value,
      nodes: value.nodes.map((node) => {
        if (!ids.includes(node.id)) return node;
        const next = { ...node, ...patch };
        if ("image" in patch && patch.image !== node.image && !("localImage" in patch)) delete next.localImage;
        if ("image" in patch && patch.image !== node.image && !("imageThumbnail" in patch)) delete next.imageThumbnail;
        if (patch.type && patch.type !== "image") {
          delete next.image;
          delete next.imageThumbnail;
          delete next.localImage;
        }
        return next;
      }),
    }));
  const patchTask = (id: string, patch: Partial<CanvasNode>) => {
    if (pendingRemovalNodes.current.has(id) || !docRef.current.nodes.some((node) => node.id === id)) return;
    dirty.current = true;
    replaceDoc({
      ...docRef.current,
      nodes: docRef.current.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              ...patch,
              ...("image" in patch && patch.image !== node.image && !("imageThumbnail" in patch) ? { imageThumbnail: undefined } : {}),
            }
          : node,
      ),
      updatedAt: now(),
    });
  };
  const syncSnapshot = React.useCallback(async (snapshot: Document, local = Promise.resolve()) => {
    const attempt = ++cloudSyncAttempt.current;
    dispatchCloudSync({ type: "start", attempt });
    if (docRef.current.updatedAt === snapshot.updatedAt) setStatus("正在同步云端…");
    try {
      await syncCloudDocument(snapshot, local);
      // The editor may have been unmounted while a queued cloud write was in
      // flight. The workspace still needs the acknowledgement to update the
      // library card for this document, while editor-local state must remain
      // scoped to the mounted instance.
      if (alive.current) dispatchCloudSync({ type: "success", attempt });
      onCloudSynced?.(snapshot);
      if (!alive.current) return;
      if (attempt === cloudSyncAttempt.current && docRef.current.updatedAt === snapshot.updatedAt)
        setStatus(savedStatus(true));
    } catch (error) {
      if (alive.current) {
        dispatchCloudSync({ type: "failure", attempt, error: errorText(error) });
        const failure = platformFailure(error);
        if (failure.kind === "login") requireAuthentication(failure.message);
      }
      throw error;
    }
  }, []);
  const checkLocalAccount = React.useRef(captureLocalStorageScope()).current;
  const persist = (value: Document, sync = syncEnabled && hydrated) => {
    checkLocalAccount();
    const snapshot = clone(value);
    // Cloud latency must never hold later local drafts behind a network request.
    const local = saveCanvas(snapshot).then(() => {
      lastLocalSave.current = snapshot.updatedAt;
      // A save can finish after a newer edit. Only clear the unsaved marker
      // when this exact snapshot is still current; otherwise before-unload and
      // cloud hydration must continue to treat the newer edit as dirty.
      if (
        docRef.current.id === snapshot.id &&
        docRef.current.updatedAt === snapshot.updatedAt
      ) {
        dirty.current = false;
      }
      onSaved(snapshot);
    });
    if (!sync || !platformReadyRef.current) return local;
    // Keep the complete snapshot here. syncCloudDocument owns the single
    // conversion pipeline: cache inline assets first, then strip temporary
    // values before publishing the platform DTO.
    return syncSnapshot(snapshot, local);
  };
  const preserveAccountDraft = React.useRef<() => Promise<void>>(async () => {});
  preserveAccountDraft.current = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    // The SDK may already hold the next account session. Save only to the old
    // local namespace before the gate remounts the new account workspace.
    if (draftReady) await persist(docRef.current, false);
  };
  React.useEffect(() => beforeLocalAccountChange(() => preserveAccountDraft.current()), []);
  const scheduleCloudSync = React.useCallback((snapshot: Document) => {
    if (!syncEnabled || !hydrated || !platformReadyRef.current) return;
    if (cloudSaveTimer.current !== null) window.clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = window.setTimeout(() => {
      cloudSaveTimer.current = null;
      // A newer edit or a canvas switch supersedes this delayed snapshot.
      // Skipping it avoids an old autosave racing the explicit leave save.
      if (
        docRef.current.id !== snapshot.id ||
        docRef.current.updatedAt !== snapshot.updatedAt
      ) return;
      // Failure stays in the save indicator and settings, without repeated toasts.
      void syncSnapshot(clone(snapshot)).catch(() => {});
    }, 2200);
  }, [hydrated, syncEnabled, syncSnapshot]);
  const requireAuthentication = (message: string) => {
    setAuthState("required");
    setHydrated(false);
    setSyncEnabled(false);
    setModels([]);
    requireLogin(message);
  };
  const rememberVersion = async (value: Document) => {
    await writeDraft(`recovery:${initialDocument.id}`, value);
    setRecovery(clone(value));
  };
  const refreshPlatform = async (
    loadDocument = false,
    local: Document | null = null,
  ) => {
    if (!platformReadyRef.current) return;
    if (platformRequest.current) {
      platformRefreshQueued.current = true;
      return;
    }
    platformRequest.current = true;
    imageRecoveryEpoch.current += 1;
    imageRecoveryRequests.current.clear();
    imageRecoveryGuard.current.resetAll();
    imageRecoveryReadyRef.current = false;
    setPlatformLoading(true);
    setConnectionError("");
    setVideoCatalogError("");
    setMusicCatalogError("");
    setVoiceCatalogError("");
    setCloudError("");
    setPlatformProfileError("");
    try {
      // Session creation already performs the authorization check and
      // returns the account scope. Avoid issuing a second status request.
      const session = await client.platform.createSession();
      if (!alive.current || !platformReadyRef.current) return;
      if (!session.account_scope) {
        setAuthState("required");
        setModels([]);
        setCatalogState("idle");
        setHydrated(false);
        setSyncEnabled(false);
        setStorageUsage(null);
        setPlatformProfile(null);
        const message = platformFailure({ code: "APP_LOGIN_REQUIRED" }).message;
        setConnectionError(message);
        requireAuthentication(message);
        return;
      }
      setAuthState("connected");
      const [catalog, videoCatalog, musicCatalog, voiceCatalog, saved, profile] = await Promise.allSettled([
        client.api.request("/images/models"),
        client.api.request("/videos/models"),
        client.api.request("/music/models"),
        client.api.request("/voice-design/models"),
        readCanvasDocument(client.storage, initialDocument.id),
        client.user.getProfile(),
      ]);
      if (!alive.current || !platformReadyRef.current) return;
      const normalizedProfile = profile.status === "fulfilled"
        ? normalizePlatformProfile(profile.value)
        : null;
      setPlatformProfile(normalizedProfile);
      if (profile.status === "rejected") {
        setPlatformProfileError("账户资料暂不可用，模型和画布仍可继续使用。");
      } else if (!normalizedProfile) {
        setPlatformProfileError("平台未返回账户资料，模型和画布仍可继续使用。");
      }
      const available =
        catalog.status === "fulfilled"
          ? catalogModels(catalog.value, "image")
          : [];
      const videos = videoCatalog.status === "fulfilled"
        ? catalogModels(videoCatalog.value, "video")
        : [];
      const music = musicCatalog.status === "fulfilled" ? catalogMusicModels(musicCatalog.value) : [];
      const voices = voiceCatalog.status === "fulfilled" ? catalogVoiceDesignModels(voiceCatalog.value) : [];
      setModels([...available, ...videos, ...music, ...voices] as typeof models);
      setCatalogState(
        catalog.status === "rejected"
          ? "error"
          : available.length
            ? "ready"
            : "empty",
      );
      if (catalog.status === "rejected") {
        const failure = platformFailure(catalog.reason);
        if (failure.kind === "login") setAuthState("required");
        setConnectionError(`图片模型加载失败：${failure.message}`);
      } else if (!available.length)
        setConnectionError(
          "当前账户没有可用图片模型，请在平台中确认模型权限后重新检测。",
        );
      if (videoCatalog.status === "rejected") {
        setVideoCatalogError(`视频模型加载失败：${platformFailure(videoCatalog.reason).message}`);
      }
      if (musicCatalog.status === "rejected") setMusicCatalogError(`音乐模型加载失败：${platformFailure(musicCatalog.reason).message}`);
      else if (!music.length) setMusicCatalogError("当前账户没有可用音乐模型，请在平台中确认模型权限后重新检测。");
      if (voiceCatalog.status === "rejected") setVoiceCatalogError(`音色模型加载失败：${platformFailure(voiceCatalog.reason).message}`);
      else if (!voices.length) setVoiceCatalogError("当前账户没有可用音色模型，请在平台中确认模型权限后重新检测。");
      const cloudHydrated = saved.status === "fulfilled";
      if (saved.status === "rejected") {
        const failure = platformFailure(saved.reason);
        if (failure.kind === "login") setAuthState("required");
        setCloudError(
          `云端画布加载失败：${failure.message} ${isSessionOnlyStorage() ? "当前内容仅在此页面保留，请重试或导出备份。" : "本机画布仍可编辑和保存。"}`,
        );
      }
      const authorizationFailure = [catalog, videoCatalog, musicCatalog, voiceCatalog, saved, profile]
        .filter((result) => result.status === "rejected")
        .map((result) => platformFailure(result.reason))
        .find((failure) => failure.kind === "login");
      if (authorizationFailure) {
        setModels([]);
        setHydrated(false);
        setSyncEnabled(false);
        setStorageUsage(null);
        setPlatformProfile(null);
        setConnectionError(authorizationFailure.message);
        requireAuthentication(authorizationFailure.message);
        return;
      }
      if (saved.status === "fulfilled" && saved.value) {
        const restored = await restoreLocalImages(
          normalize({ ...(saved.value as object), id: initialDocument.id }),
        );
        if (!alive.current || !platformReadyRef.current) return;
        const current = normalize({ ...docRef.current, id: initialDocument.id });
        const resolution = resolveCloudDocumentVersion(
          current,
          restored,
          documentSignature,
          documentRevisionSignature,
        );
        const initialLoadCanHydrate = loadDocument && !local && !dirty.current;
        if (
          resolution === "prefer-cloud" ||
          (initialLoadCanHydrate && resolution === "same")
        ) {
          if (resolution === "prefer-cloud") await rememberVersion(current);
          replaceDoc(restored);
          setSyncEnabled(true);
          setCloudCandidate(null);
          await saveCanvas(restored);
          markSessionSynced(restored.id, JSON.stringify(restored));
          onCloudSynced?.(restored);
          lastLocalSave.current = restored.updatedAt;
          dirty.current = false;
          dispatchCloudSync({ type: "success", attempt: cloudSyncAttempt.current });
          setStatus(savedStatus(true));
        } else if (resolution === "same") {
          const sameRevision =
            documentRevisionSignature(current) ===
            documentRevisionSignature(restored);
          if (sameRevision) {
            markSessionSynced(restored.id, JSON.stringify(restored));
            dispatchCloudSync({ type: "success", attempt: cloudSyncAttempt.current });
            onCloudSynced?.(restored);
          }
          setStatus(savedStatus(sameRevision));
          setSyncEnabled(true);
          setCloudCandidate(null);
        } else if (resolution === "prefer-local") {
          setSyncEnabled(true);
          setCloudCandidate(null);
          setStatus("正在同步云端…");
          void syncSnapshot(clone(current)).catch(() => {});
        } else {
          setSyncEnabled(false);
          setCloudCandidate(restored);
          setStatus(savedStatus(false));
        }
      } else if (saved.status === "fulfilled") {
        setSyncEnabled(true);
        setCloudCandidate(null);
        const current = normalize({ ...docRef.current, id: initialDocument.id });
        void syncSnapshot(clone(current)).catch(() => {});
      }
      // Image URL recovery may mutate the local document. Do not expose the
      // recovery effects until the remote document has been restored, matched,
      // or retained as an explicit conflict candidate.
      setHydrated(cloudHydrated);
    } catch (error) {
      if (alive.current) {
        const failure = platformFailure(error);
        setAuthState(failure.kind === "login" ? "required" : "error");
        setModels([]);
        setCatalogState("idle");
        setHydrated(false);
        setSyncEnabled(false);
        setStorageUsage(null);
        setPlatformProfile(null);
        setPlatformProfileError("");
        setConnectionError(failure.message);
        if (failure.kind === "login") requireAuthentication(failure.message);
      }
    } finally {
      platformRequest.current = false;
      if (alive.current) {
        if (platformRefreshQueued.current) {
          platformRefreshQueued.current = false;
          void refreshPlatform();
        } else setPlatformLoading(false);
      }
    }
  };
  const loadStorage = React.useCallback((force = false): Promise<boolean> => {
    if (authState !== "connected" || !platformReadyRef.current) return Promise.resolve(false);
    if (storageRequest.current && storageRequestRevision.current === platformRevision && !force) return storageRequest.current;
    const requestSequence = ++storageRequestSequence.current;
    const sessionRevision = platformRevision;
    const isCurrentRequest = () => requestSequence === storageRequestSequence.current
      && sessionRevision === platformRevisionRef.current
      && authState === "connected" && platformReadyRef.current;
    setStorageLoading(true);
    setStorageActionError("");
    const request = (async (): Promise<boolean> => {
      try {
        const usage = await client.api.request<StorageUsage>("/media/storage/usage");
        if (!isStorageUsage(usage)) throw new Error("媒体空间服务返回了无效的数据，请稍后重试。");
        if (!isCurrentRequest()) return false;
        setStorageUsage(usage);
        return true;
      } catch (error) {
        // Do not leave the panel looking as if the user has no storage. A
        // rejected usage request is materially different from an empty
        // account and needs a visible retry path.
        if (!isCurrentRequest()) return false;
        setStorageUsage(null);
        setStorageActionError(errorText(error));
        return false;
      } finally {
        if (isCurrentRequest()) setStorageLoading(false);
      }
    })();
    storageRequest.current = request;
    storageRequestRevision.current = sessionRevision;
    request.then(
      () => {
        if (storageRequest.current === request) {
          storageRequest.current = null;
          storageRequestRevision.current = null;
        }
      },
      () => {
        if (storageRequest.current === request) {
          storageRequest.current = null;
          storageRequestRevision.current = null;
        }
      },
    );
    return request;
  }, [authState, platformRevision]);
  React.useEffect(() => {
    // Storage usage is settings data. Defer it until the settings panel is
    // visible instead of blocking every canvas bootstrap with a Gateway request.
    if (overlay !== "settings" || authState !== "connected" || !platformReady) return;
    void loadStorage();
  }, [authState, loadStorage, overlay, platformReady]);
  const assetLibrary = useAssetLibrary({
    active: drawer === "assets" && assetView === "library",
    connected: authState === "connected" && platformReady,
    sessionKey: platformRevision,
    documentId: doc.id,
    onNotify: setMessage,
    onInsert: async (asset, preview) => {
      const documentId = docRef.current.id;
      const referenceTarget = assetReferenceTarget.current;
      const checkSession = captureDocumentStorageSession(client.storage);
      // Carry the server-signed bounded preview into the canvas node. The
      // original URL is retained only for opening/downloading the asset;
      // dropping thumbnailUrl here makes the newly inserted card fetch COS's
      // full-resolution object immediately.
      const content = nodeFromLibraryAsset(asset, preview.url, preview.urlExpiresAt, preview.thumbnailUrl);
      const imageProbe = asset.kind === "image"
        ? preview.thumbnailUrl || (asset.source.type === "platform" ? undefined : preview.url)
        : undefined;
      const size = asset.kind === "image" && imageProbe ? await readImageNodeSize(imageProbe)
        : asset.kind === "image" ? fitImageNodeSize(480, 480)
        : asset.kind === "video" ? { width: 360, height: 240 }
          : asset.kind === "audio" ? DEFAULT_AUDIO_NODE_SIZE : { width: W, height: H };
      checkSession();
      if (docRef.current.id !== documentId) throw new Error("画布已切换，请重新选择资产。");
      if (assetReferenceTarget.current !== referenceTarget) throw new Error("资产选择已更新，请重新选择资产。");
      const target = referenceTarget?.documentId === documentId ? docRef.current.nodes.find(node => node.id === referenceTarget.nodeId && node.type === "prompt") : undefined;
      if (referenceTarget && !target) throw new Error("创作节点已变化，请返回画布后重新选择参考素材。");
      if (target?.mediaType === "audio" && (target.audioMode || "music") !== "music") throw new Error("请切换到音乐生成后选择参考音频。");
      // Validate the creator before inserting a reference it cannot submit.
      const musicTarget = target?.mediaType === "audio" && (target.audioMode || "music") === "music";
      if (target) {
        const accepted = musicTarget ? asset.kind === "audio" : target.mediaType === "video"
          ? asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"
          : asset.kind === "image";
        if (!accepted) {
          throw new Error(musicTarget ? "音乐创作只支持音频资产作为参考音频。" : target.mediaType === "video"
            ? "视频创作只支持图片、视频或音频资产作为参考素材。"
            : "图片创作只支持图片资产作为参考图。");
        }
        if (musicTarget && (target.musicReference || hasPendingNodeTask(target))) throw new Error("音乐创作状态已变化，请返回创作后重新选择参考音频。");
      }
      const at = target ? { x: target.x - size.width - 80, y: target.y } : centerPoint();
      const node: CanvasNode = {
        ...content, id: uid(content.type), color: COLORS[asset.kind === "prompt" ? 0 : asset.kind === "audio" ? 3 : 1],
        ...size, ...findFreePosition(docRef.current.nodes, { x: at.x - (target ? 0 : size.width / 2), y: at.y - (target ? 0 : size.height / 2), ...size }),
        groupId: target?.groupId,
      };
      let musicReference: CanvasNode["musicReference"];
      let insertedNode = node;
      if (musicTarget && target) {
        const blob = await audioSources.read(node, undefined, 50 * 1024 * 1024);
        const duration = await readMusicReferenceAudioDuration(blob);
        const [localResult, uploadResult] = await Promise.allSettled([
          storeLocalAudio(blob),
          node.assetId ? Promise.resolve(undefined) : uploadPlatformAsset(client.api, { file: new File([blob], asset.name || "reference-audio.mp3", { type: blob.type || "audio/mpeg" }), name: asset.name, category: "sound" }),
        ]);
        const localAudio = localResult.status === "fulfilled" ? localResult.value : node.localAudio;
        const uploaded = uploadResult.status === "fulfilled" ? uploadResult.value : undefined;
        const assetId = node.assetId || uploaded?.id;
        if (!localAudio && !assetId) throw new Error("参考音频未能保存到本机或云端，请检查存储空间和网络后重试。");
        checkSession();
        const currentTarget = docRef.current.nodes.find(item => item.id === target.id);
        if (!alive.current || leaving.current || docRef.current.id !== documentId || assetReferenceTarget.current !== referenceTarget || !currentTarget || currentTarget.mediaType !== "audio" || (currentTarget.audioMode || "music") !== "music" || currentTarget.musicReference || hasPendingNodeTask(currentTarget)) throw new Error("音乐创作状态已变化，请重新选择参考音频。");
        musicReference = { ...(localAudio ? { localAudio } : {}), ...(assetId ? { assetId } : {}), title: asset.name, duration, size: blob.size, nodeId: node.id };
        insertedNode = { ...node, ...(uploaded?.id ? { assetId: uploaded.id } : {}), ...(uploaded?.url ? { audio: uploaded.url } : {}) };
      }
      commit(value => {
        const nodes = [...value.nodes.map(item => item.id === target?.id ? { ...item, ...(musicReference ? { musicReference } : { ignoreImageRefs: false }) } : item), insertedNode];
        return { ...value, nodes, groups: expandGroupFrames(nodes, value.groups), edges: target ? [...value.edges, { id: uid("edge"), from: node.id, to: target.id }] : value.edges };
      });
      setSelected([target?.id || node.id]); setSelectedEdge(null); setEditing(null);
      setInspectorOpen(Boolean(target));
      assetReferenceTarget.current = undefined;
      if (target || boardSize.width < 700) setDrawer(null);
      reveal(target ? [target, node] : [node]);
      if (musicReference && !musicReference.assetId) setMessage("参考音频仅保存在本机，换设备后无法恢复。", undefined, 3500);
    },
  });
  const promptMentionAssets = usePromptMentionAssets({
    connected: authState === "connected" && platformReady,
    sessionKey: platformRevision,
  });

  const readImageTaskForRecovery = React.useCallback((taskId: string) => {
    const existing = imageTaskRecoveryRequests.current.get(taskId);
    if (existing) return existing;
    const request = client.api.request<unknown>(`/images/tasks/${taskId}`)
      .finally(() => imageTaskRecoveryRequests.current.delete(taskId));
    imageTaskRecoveryRequests.current.set(taskId, request);
    return request;
  }, []);
  const findStoredImageMatches = React.useCallback(async (
    nodes: readonly CanvasNode[],
  ) => {
    const pending = new Map(
      nodes
        .filter((node) => Boolean(node.image))
        .map((node) => [node.id, node] as const),
    );
    const matches = new Map<string, ReturnType<typeof matchStoredImageAsset>>();
    const limit = 100;
    // Old synchronous image responses did not expose task_id. Walk the
    // application-scoped asset list and compare stable object paths instead
    // of expired signing parameters. This is only used for unresolved nodes.
    for (let page = 1; pending.size && page <= 100; page++) {
      const response = await client.api.request<StoredAssetPage>(
        `/media/assets?page=${page}&limit=${limit}`,
      );
      const assets = Array.isArray(response?.items) ? response.items : [];
      if (!assets.length) break;
      for (const [id, node] of pending) {
        const match = matchStoredImageAsset(node.image, assets);
        if (!match) continue;
        matches.set(id, match);
        pending.delete(id);
      }
      const total = Number.isFinite(response?.total) ? Number(response.total) : undefined;
      const pageSize = Number.isFinite(response?.limit) && Number(response.limit) > 0
        ? Number(response.limit)
        : limit;
      if ((total !== undefined && page * pageSize >= total) || assets.length < pageSize) break;
    }
    return matches;
  }, []);

  type PendingImageUpdate = {
    id: string;
    image: string;
    thumbnail?: string;
    localImage?: string;
    assetId?: string;
    taskId?: string;
    expectedImage: string | undefined;
    expectedTaskId: string | undefined;
  };
  const applyRecoveredImageUpdates = async (
    updates: readonly PendingImageUpdate[],
    expectedEpoch: number,
  ) => {
    if (!updates.length) return false;
    // A renewed signature may already have cached bytes. Resolve them before
    // changing <img src>, so the browser never downloads the same object just
    // to discover the local cache in its load callback.
    const restored = await restoreLocalImages({ nodes: [...updates] });
    await Promise.all(restored.nodes.map(async update => {
      if (isCachedDisplayImage(update.image)) return;
      const node = docRef.current.nodes.find(node => node.id === update.id);
      if (!node || node.image !== update.expectedImage || node.taskId !== update.expectedTaskId) return;
      const cached = await readHostCachedImage({ assetId: node.assetId, taskId: update.taskId || node.taskId, resultIndex: node.resultIndex });
      if (cached) Object.assign(update, cached);
    }));
    if (
      !alive.current ||
      expectedEpoch !== imageRecoveryEpoch.current ||
      !imageRecoveryReadyRef.current
    ) return false;
    const byId = new Map(restored.nodes.map((update) => [update.id, update]));
    const current = docRef.current;
    let changed = false;
    const nodes = current.nodes.map((node) => {
      // A real delete removes the node from the document after the exit
      // animation. Treat the animation window as deleted as well so a late
      // recovery response cannot patch a card that is already leaving.
      if (pendingRemovalNodes.current.has(node.id)) return node;
      const update = byId.get(node.id);
      if (
        !update ||
        node.image !== update.expectedImage ||
        node.taskId !== update.expectedTaskId
      ) return node;
      if (
        node.image === update.image &&
        (!update.taskId || node.taskId === update.taskId) &&
        (!update.thumbnail || node.imageThumbnail === update.thumbnail)
      ) return node;
      changed = true;
      const oldIdentity = node.image && immutableImageUrlIdentity(node.image);
      const sameImage = node.image === update.image || Boolean(
        oldIdentity && oldIdentity === immutableImageUrlIdentity(update.image),
      );
      const thumbnail = update.thumbnail || (sameImage ? node.imageThumbnail : undefined);
      return {
        ...node,
        image: update.image,
        imageThumbnail: thumbnail,
        localImage: update.localImage || (sameImage ? node.localImage : undefined),
        ...(update.assetId ? { assetId: update.assetId } : {}),
        ...(update.taskId ? { taskId: update.taskId } : {}),
      };
    });
    if (!changed) return false;
    dirty.current = true;
    const next = { ...current, nodes, updatedAt: now() };
    replaceDoc(next);
    const syncNow = syncStateRef.current.syncEnabled && syncStateRef.current.hydrated;
    if (!syncNow) pendingRecoveredSync.current = next;
    void persist(next, syncNow)
      .then(() => {
        if (
          alive.current &&
          docRef.current.id === next.id &&
          docRef.current.updatedAt === next.updatedAt
        ) setStatus(savedStatus(syncNow));
      })
      .catch((error) => {
        pendingRecoveredSync.current = next;
        setStatus(`图片已恢复 · 云端同步失败：${errorText(error)}`);
      });
    return true;
  };

  const refreshPersistedImageUrls = React.useCallback(async () => {
    // A platform refresh owns version selection. Repairing the local document
    // during that comparison can turn a legacy URL migration into a false
    // local/cloud conflict.
    if (!imageRecoveryReadyRef.current) return;
    const recoveryEpoch = imageRecoveryEpoch.current;
    const documentId = docRef.current.id;
    const recoveryViewport = {
      width: typeof window === "undefined" ? 1280 : window.innerWidth,
      height: typeof window === "undefined" ? 720 : window.innerHeight,
    };
    const recoveryMargin = docRef.current.nodes.length > 50 ? 640 : 320;
    const selectedIds = new Set(selectedRef.current);
    const nearRecoveryViewport = (node: CanvasNode) =>
      selectedIds.has(node.id) || isRectInViewport(node, docRef.current.viewport, recoveryViewport, recoveryMargin);
    // Reused library media is identified by file ID, not a task's result order.
    // Reuse cached images and valid signed URLs. Missing/expiring media near
    // the current viewport still refreshes by asset ID; off-screen media waits
    // until it becomes visible instead of delaying the first canvas paint.
    // Video delivery is restored by loadVideoNode using the same source
    // resolver as playback/download, including nodes with no current URL.
    const libraryNodes = docRef.current.nodes.filter(node => {
      if (!nearRecoveryViewport(node)) return false;
      if (!node.assetId || node.type === "video" || node.mediaType === "video" || node.type === "audio" || node.mediaType === "audio") return false;
      const imageNode = node.type === "image" || node.type === "prompt" && (node.mediaType || "image") === "image";
      // The original and the server-signed thumbnail have independent
      // lifetimes. Refresh when either existing URL is near expiry. Legacy
      // nodes without a thumbnail must also be refreshed: otherwise the
      // canvas keeps rendering the persisted full-resolution COS URL forever,
      // even after the media service learned how to sign a bounded preview.
      return mediaUrlNeedsRefresh(node.image || node.video || node.audio) ||
        (imageNode && (!node.imageThumbnail || mediaUrlNeedsRefresh(node.imageThumbnail)));
    });
    const assetIds = [...new Set(libraryNodes.map(node => node.assetId!))];
    const libraryFileEntries = await mapWithConcurrency(assetIds, 4, async (assetId) => {
      try {
        const asset = await readPlatformAsset(client.api, assetId);
        return [assetId, { url: asset.url, thumbnail: asset.thumbnailUrl }] as const;
      }
      catch { return [assetId, undefined] as const; }
    });
    const libraryFiles = new Map(libraryFileEntries);
    if (!alive.current || recoveryEpoch !== imageRecoveryEpoch.current || documentId !== docRef.current.id || !imageRecoveryReadyRef.current) return;
    const libraryImageUpdates: PendingImageUpdate[] = libraryNodes.flatMap(node => {
      const image = libraryFiles.get(node.assetId!);
      const imageNode = node.type === "image" || (node.type === "prompt" && (node.mediaType || "image") === "image");
      return imageNode && image?.url ? [{ id: node.id, image: image.url, thumbnail: image.thumbnail, expectedImage: node.image, expectedTaskId: node.taskId }] : [];
    });
    const playable = new Map(libraryNodes.filter(node => node.video || node.audio).map(node => [node.id, node]));
    let playableChanged = false;
    const refreshedNodes = docRef.current.nodes.map(node => {
      const previous = playable.get(node.id);
      if (!previous || previous.assetId !== node.assetId) return node;
      const url = libraryFiles.get(node.assetId!)?.url;
      const field = previous.video ? "video" : "audio";
      if (!url || node[field] !== previous[field] || node[field] === url) return node;
      playableChanged = true;
      if (field === "video") {
        runtimeVideoUrlsRef.current.set(node.id, url);
        setRuntimeVideoUrls(urls => ({ ...urls, [node.id]: url }));
      }
      return { ...node, [field]: url };
    });
    if (playableChanged) {
      dirty.current = true;
      const next = { ...docRef.current, nodes: refreshedNodes, updatedAt: now() };
      replaceDoc(next);
      const syncNow = syncStateRef.current.syncEnabled && syncStateRef.current.hydrated;
      if (!syncNow) pendingRecoveredSync.current = next;
      void persist(next, syncNow).catch(error => {
        pendingRecoveredSync.current = next;
        setStatus(`媒体地址已恢复 · 云端同步失败：${errorText(error)}`);
      });
    }
    const snapshot = docRef.current.nodes.filter((node) => {
      // Video prompts share the `prompt` node type but their task IDs belong
      // to `/videos`, never `/images/tasks`.
      const imageNode = node.type === "image" ||
        (node.type === "prompt" && (node.mediaType || "image") === "image");
      return imageNode && node.status !== "failed" && nearRecoveryViewport(node);
    });
    const legacy = snapshot.filter((node) =>
      !node.assetId && !node.taskId && isTemporaryMediaUrl(node.image),
    );
    let legacyMatches = new Map<string, ReturnType<typeof matchStoredImageAsset>>();
    if (legacy.length) {
      try {
        legacyMatches = await findStoredImageMatches(legacy);
      } catch {
        // Task-backed nodes below can still recover if storage listing is
        // temporarily unavailable.
      }
    }

    const candidates = snapshot.filter((node) =>
      Boolean(
        !node.assetId && node.taskId &&
        (!node.imageThumbnail || mediaUrlNeedsRefresh(node.image) ||
          (node.imageThumbnail && mediaUrlNeedsRefresh(node.imageThumbnail))),
      ),
    );
    const byTask = new Map<string, CanvasNode[]>();
    candidates.forEach((node) => {
      const taskId = node.taskId!;
      const group = byTask.get(taskId) || [];
      group.push(node);
      byTask.set(taskId, group);
    });
    const taskUpdates = await mapWithConcurrency([...byTask], 4, async ([taskId, nodes]) => {
      try {
        // Omitting response_format lets old inline tasks return b64_json while
        // current application tasks continue returning newly signed URLs.
        const response = await readImageTaskForRecovery(taskId);
        return mapTaskImageResults(taskId, nodes, response).map((update) => ({
          ...update,
          expectedImage: nodes.find((node) => node.id === update.id)?.image,
          expectedTaskId: taskId,
        }));
      } catch {
        return [] as PendingImageUpdate[];
      }
    });
    const legacyUpdates = legacy.flatMap((node) => {
      const match = legacyMatches.get(node.id);
      return match
        ? [{
            id: node.id,
            image: mediaUrlNeedsRefresh(node.image) ? match.image : node.image!,
            ...(match.thumbnail ? { thumbnail: match.thumbnail } : {}),
            ...(match.assetId ? { assetId: match.assetId } : {}),
            taskId: match.taskId,
            expectedImage: node.image,
            expectedTaskId: undefined,
          }]
        : [];
    });
    await applyRecoveredImageUpdates(
      [...libraryImageUpdates, ...legacyUpdates, ...taskUpdates.flat()],
      recoveryEpoch,
    );
  }, [findStoredImageMatches, readImageTaskForRecovery]);

  const recoverImageNodeOnce = React.useCallback(async (
    requested: CanvasNode,
    failedSource = requested.image || "",
    force = false,
  ): Promise<ImageRecoveryResult | undefined> => {
    const node = docRef.current.nodes.find((candidate) => candidate.id === requested.id);
    // A restored asset can retain only its bounded thumbnail while the
    // canonical image URL is absent. Detail recovery intentionally passes an
    // empty source in that case, so accept that exact state while keeping the
    // stale-source guard for ordinary retries.
    const imageSourceMatches = (candidate: CanvasNode | undefined) => Boolean(
      candidate && (failedSource ? candidate.image === failedSource : !candidate.image),
    );
    if (!node) return;
    if (!imageSourceMatches(node) || pendingRemovalNodes.current.has(node.id)) return;
    if (!imageRecoveryReadyRef.current) {
      setImageLoadStates((states) => ({
        ...states,
        [node.id]: {
          source: failedSource,
          status: "recovering",
          attempt: states[node.id]?.attempt || 0,
        },
      }));
      return;
    }
    const recoveryEpoch = imageRecoveryEpoch.current;
    if (force) imageRecoveryGuard.current.reset(node.id);
    const identity = node.taskId || node.localImage || mediaUrlIdentity(failedSource) || "unbound";
    const fingerprint = `${identity}\0${failedSource}`;
    const recoveryAttempt = imageRecoveryGuard.current.begin(node.id, fingerprint);
    if (!recoveryAttempt) {
      // A parallel request already owns recovery for this node. If the guard
      // rejected an exhausted/repeated attempt instead, expose the retry UI
      // instead of leaving the browser's broken-image glyph on the canvas.
      setImageLoadStates((states) => {
        const current = states[node.id];
        if (current?.source === failedSource && current.status === "recovering") return states;
        return {
          ...states,
          [node.id]: {
            source: failedSource,
            status: "failed",
            attempt: current?.attempt || 1,
            message: node.taskId || node.localImage
              ? "暂时无法恢复图片"
              : "图片地址已失效",
          },
        };
      });
      return;
    }
    setImageLoadStates((states) => ({
      ...states,
      [node.id]: {
        source: failedSource,
        status: "recovering",
        attempt: (states[node.id]?.attempt || 0) + 1,
      },
    }));
    try {
      let image: string | undefined;
      let localImage: string | undefined;
      let taskId = node.taskId;
      let batchUpdates: PendingImageUpdate[] = [];
      if (node.localImage && !/^https?:\/\//i.test(failedSource)) {
        const recoverable: { nodes: Array<{ image?: string; localImage?: string }> } = {
          nodes: [{ localImage: node.localImage }],
        };
        const restored = await restoreLocalImages(recoverable);
        image = restored.nodes[0]?.image;
        if (image) localImage = node.localImage;
      }
      if (!image && (node.assetId || taskId)) {
        const siblings = docRef.current.nodes.filter(candidate => candidate.type === "image" ||
          (candidate.type === "prompt" && (candidate.mediaType || "image") === "image"));
        const delivery = await recoverImageDelivery(node, siblings, {
          readAsset: async assetId => (await readPlatformAsset(client.api, assetId, { forceRefresh: force })).storedAsset,
          readTask: readImageTaskForRecovery,
        });
        if (delivery) {
          image = delivery.image;
          taskId = delivery.taskId;
          batchUpdates = delivery.updates.map(update => {
            const previous = siblings.find(candidate => candidate.id === update.id);
            return { ...update, expectedImage: previous?.image, expectedTaskId: previous?.taskId };
          });
        }
      }
      if (!image && failedSource) {
        const stored = await findStoredImageMatches([node]);
        const match = stored.get(node.id);
        const original = match && recoveredImageOriginal(match.image, match.thumbnail);
        if (match && original) {
          image = original;
          taskId = match.taskId;
          batchUpdates = [{
            id: node.id,
            image: original,
            ...(match.thumbnail ? { thumbnail: match.thumbnail } : {}),
            ...(match.assetId ? { assetId: match.assetId } : {}),
            taskId: match.taskId,
            expectedImage: failedSource,
            expectedTaskId: node.taskId,
          }];
        }
      }
      if (!image) throw new Error("图片原始资源已失效");
      if (recoveryEpoch !== imageRecoveryEpoch.current) return;
      const latest = docRef.current.nodes.find((candidate) => candidate.id === node.id);
      if (!imageSourceMatches(latest) || pendingRemovalNodes.current.has(node.id)) return;
      const applied = await applyRecoveredImageUpdates(
        batchUpdates.length ? batchUpdates : [{
            id: node.id,
            image,
            localImage,
            taskId,
            expectedImage: failedSource,
            expectedTaskId: node.taskId,
          }],
        recoveryEpoch,
      );
      if (!applied) {
        const current = docRef.current.nodes.find((candidate) => candidate.id === node.id);
        if (
          recoveryEpoch === imageRecoveryEpoch.current &&
          imageRecoveryReadyRef.current &&
          current &&
          imageSourceMatches(current)
        ) {
          // Recovery can legitimately return the same signed URL and thumbnail
          // after an explicit retry. Bump the attempt so the main node key
          // remounts the image instead of leaving its hidden failed element.
          if (displayImageThumbnail(current.image, current.imageThumbnail)) {
            const recoveredCurrent = current;
            setImageLoadStates((states) => ({
              ...states,
              [node.id]: {
                source: recoveredCurrent.image!,
                status: "loading",
                attempt: (states[node.id]?.attempt || 0) + 1,
              },
            }));
            return recoveredCurrent.image ? { image: recoveredCurrent.image, thumbnail: recoveredCurrent.imageThumbnail } : undefined;
          }
          throw new Error("图片暂时无法恢复");
        }
        return;
      }
      setImageLoadStates((states) => ({
        ...states,
        [node.id]: {
          source: docRef.current.nodes.find(candidate => candidate.id === node.id)?.image || image!,
          status: "loading",
          attempt: (states[node.id]?.attempt || 0) + 1,
        },
      }));
      const current = docRef.current.nodes.find((candidate) => candidate.id === node.id);
      return current?.image ? { image: current.image, thumbnail: current.imageThumbnail } : undefined;
    } catch {
      if (
        recoveryEpoch === imageRecoveryEpoch.current &&
        imageRecoveryReadyRef.current &&
        docRef.current.nodes.some((candidate) =>
          candidate.id === node.id && imageSourceMatches(candidate)
        )
      ) {
        setImageLoadStates((states) => ({
          ...states,
          [node.id]: {
            source: failedSource,
            status: "failed",
            attempt: states[node.id]?.attempt || 1,
            message: node.taskId || node.localImage
              ? "暂时无法恢复图片"
              : "图片地址已失效",
          },
        }));
      }
    } finally {
      imageRecoveryGuard.current.finish(node.id, recoveryAttempt);
    }
  }, [displayImageThumbnail, findStoredImageMatches, readImageTaskForRecovery]);

  const recoverImageNode = React.useCallback((
    requested: CanvasNode,
    failedSource = requested.image || "",
    force = false,
  ): Promise<ImageRecoveryResult | undefined> => {
    const existing = imageRecoveryRequests.current.get(requested.id);
    if (existing?.source === failedSource) return existing.promise;
    if (existing) imageRecoveryGuard.current.reset(requested.id);
    const entry = { source: failedSource, promise: recoverImageNodeOnce(requested, failedSource, force) };
    imageRecoveryRequests.current.set(requested.id, entry);
    void entry.promise.finally(() => {
      if (imageRecoveryRequests.current.get(requested.id) === entry) imageRecoveryRequests.current.delete(requested.id);
    }).catch(() => {});
    return entry.promise;
  }, [recoverImageNodeOnce]);

  const imageLoaded = React.useCallback((
    nodeId: string,
    source: string,
    naturalWidth?: number,
    naturalHeight?: number,
  ) => {
    if (pendingRemovalNodes.current.has(nodeId)) return;
    markMediaNodeLoaded(nodeId);
    imageRecoveryGuard.current.reset(nodeId);
    setImageLoadStates((states) => {
      if (
        !states[nodeId] ||
        docRef.current.nodes.find((node) => node.id === nodeId)?.image !== source
      ) return states;
      const next = { ...states };
      delete next[nodeId];
      return next;
    });
    // A legacy card can retain its old default rectangle even though the
    // bitmap has loaded successfully. Prefer the dimensions the browser just
    // decoded over a second remote probe, then only repair a mismatched ratio
    // so a user's proportional resize remains intact.
    if (
      Number.isFinite(naturalWidth) && naturalWidth! > 0 &&
      Number.isFinite(naturalHeight) && naturalHeight! > 0
    ) {
      const current = docRef.current;
      const node = current.nodes.find((candidate) => candidate.id === nodeId);
      if (node?.type === "image" && node.image === source) {
        const ratio = naturalHeight! / naturalWidth!;
        const nodeRatio = node.height / Math.max(1, node.width);
        if (Math.abs(ratio - nodeRatio) > 0.02) {
          const size = fitImageNodeSize(naturalWidth!, naturalHeight!);
          const nodes = current.nodes.map((candidate) =>
            candidate.id === nodeId ? { ...candidate, ...size } : candidate,
          );
          dirty.current = true;
          replaceDoc({
            ...current,
            nodes,
            groups: expandGroupFrames(nodes, current.groups),
            updatedAt: now(),
          });
        }
      }
    }
  }, [markMediaNodeLoaded]);
  React.useEffect(() => {
    if (!imageRecoveryReadyRef.current) return;
    for (const [id, state] of Object.entries(imageLoadStates)) {
      if (state.status !== "recovering") continue;
      const node = docRef.current.nodes.find((candidate) => candidate.id === id);
      if (node?.image === state.source)
        void recoverImageNode(node, state.source);
    }
  }, [hydrated, authState, platformLoading, imageLoadStates, recoverImageNode]);
  React.useEffect(() => {
    if (!preview) return;
    const current = doc.nodes.find((node) => node.id === preview.id);
    if (!current) return;
    // Keep the refreshed runtime URL in preference to an older persisted URL.
    const delivery = runtimeVideoSources.current.get(current.id);
    const effectiveCurrent = current.mediaType === "audio" || current.type === "audio"
      ? { ...current, audio: audioSources.urls[current.id] }
      : delivery
      ? { ...current, video: delivery.url, videoContentUrl: delivery.url, videoContentUrlExpiresAt: delivery.urlExpiresAt }
      : current;
    if (
      effectiveCurrent.image !== preview.image ||
      effectiveCurrent.imageThumbnail !== preview.imageThumbnail ||
      effectiveCurrent.taskId !== preview.taskId ||
      effectiveCurrent.audio !== preview.audio ||
      effectiveCurrent.video !== preview.video ||
      effectiveCurrent.videoContentUrl !== preview.videoContentUrl ||
      effectiveCurrent.videoContentUrlExpiresAt !== preview.videoContentUrlExpiresAt
    ) setPreview(effectiveCurrent);
  }, [doc.nodes, preview?.id, preview?.image, preview?.taskId, preview?.audio, preview?.video, preview?.videoContentUrl, audioSources.urls]);
  React.useEffect(() => {
    if (!platformReady || !imageRecoveryReadyRef.current || viewportMoving) return;
    // Cloud URL repair is useful but non-critical for first paint. Schedule it
    // after the canvas has rendered so recovery traffic cannot compete with
    // visible thumbnails and the initial document interaction.
    let cancelled = false;
    const run = () => {
      if (!cancelled) void refreshPersistedImageUrls();
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleCallback = idleWindow.requestIdleCallback;
    const usedIdleCallback = Boolean(idleCallback);
    const idle = idleCallback
      ? idleCallback(run, { timeout: 900 })
      : window.setTimeout(run, 120);
    return () => {
      cancelled = true;
      if (idleWindow.cancelIdleCallback && usedIdleCallback) idleWindow.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [doc.viewport.x, doc.viewport.y, doc.viewport.zoom, hydrated, platformReady, authState, platformLoading, refreshPersistedImageUrls, viewportMoving]);
  React.useEffect(() => {
    if (
      !hydrated ||
      !syncEnabled ||
      authState !== "connected" ||
      !pendingRecoveredSync.current
    ) return;
    const snapshot = clone(docRef.current);
    pendingRecoveredSync.current = null;
    void persist(snapshot, true)
      .then(() => {
        if (
          alive.current &&
          docRef.current.id === snapshot.id &&
          docRef.current.updatedAt === snapshot.updatedAt
        ) setStatus(savedStatus(syncStateRef.current.syncEnabled && syncStateRef.current.hydrated));
      })
      .catch((error) => {
        pendingRecoveredSync.current = snapshot;
        setStatus(`图片已恢复 · 云端同步失败：${errorText(error)}`);
      });
  }, [hydrated, syncEnabled, authState]);
  React.useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && overlay === "settings" && authState === "connected") void loadStorage();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [authState, loadStorage, overlay]);
  const openStoragePortal = (kind: "subscription" | "storage") => {
    const configured = kind === "subscription"
      ? storageUsage?.upgrade_url
      : storageUsage?.storage_pack_url;
    if (kind === "storage" && !configured) {
      setMessage("当前没有可直接购买的存储包，请在会员方案页确认空间权益。");
      return;
    }
    const fallback = `${window.location.origin}/#/console/subscription?tab=subscription&source=canvas_storage`;
    const destination = new URL(configured || fallback, window.location.origin);
    const popup = window.open(destination.toString(), "_blank", "noopener,noreferrer");
    if (!popup) setMessage("请允许打开平台套餐页面后继续。");
  };
  const platformAction = () => {
    if (authState === "required") requireLogin(connectionError);
    else void refreshPlatform();
  };
  const platformActionLabel = platformLoading
    ? "正在检查并更新…"
    : authState === "required"
      ? "重新登录"
      : authState === "connected"
        ? "检查并刷新"
        : "重新检测平台连接";
  const platformAccountName = platformProfile?.username?.trim()
    || platformProfile?.name?.trim()
    || platformProfile?.email?.trim()
    || "已连接平台账户";
  const platformAccountEmail = platformProfile?.email?.trim()
    && platformProfile.email.trim() !== platformAccountName
    ? platformProfile.email.trim()
    : "";
  const platformAccountInitial = (platformAccountName || "平").slice(0, 1).toUpperCase();
  const modelPlaceholder = platformLoading
    ? "正在检测模型…"
    : authState === "required"
      ? "重新登录后加载模型"
      : authState !== "connected"
        ? "平台连接异常"
        : catalogState === "error"
          ? "模型加载失败"
          : catalogState === "empty"
            ? "暂无可用图片模型"
            : "选择模型";
  const clearConnection = () => {
    wireDrag.current = null;
    setConnecting(null);
    setWireOrigin(null);
    setWirePoint(null);
    setWireTarget(null);
    setNearConnection(null);
  };
  const cancelReferencePick = (restoreEditor = true) => {
    // The global keyboard handler is installed once, so read the current
    // target from a ref instead of the render that created that handler.
    const targetId = referencePickTargetRef.current;
    // A pick session owns the next canvas pointer. Clear every transient
    // gesture/hover state when it ends so a cancelled session cannot leave a
    // stale marquee, pan capture, or magnetic handle active underneath the
    // editor.
    cancelGesture();
    setNearConnection(null);
    setReferencePickTarget(null);
    setReferencePickKind("image");
    if (restoreEditor && targetId && docRef.current.nodes.some((node) => node.id === targetId && node.type === "prompt")) {
      setSelected([targetId]);
      setInspectorOpen(true);
    }
  };
  const beginReferencePick = (targetId: string, kind: "image" | "text" = "image") => {
    closeMenus();
    cancelGesture();
    setReferencePickKind(kind);
    setReferencePickTarget(targetId);
    setInspectorOpen(false);
    setSelected([targetId]);
    focusCanvas();
  };
  const chooseCanvasReference = (sourceId: string) => {
    const targetId = referencePickTarget;
    if (!targetId || sourceId === targetId) return;
    const source = docRef.current.nodes.find((node) => node.id === sourceId);
    const composition = composePrompt(docRef.current.nodes, docRef.current.edges, targetId);
    const alreadyAttached = Boolean(
      source && (
        docRef.current.edges.some((edge) => edge.from === sourceId && edge.to === targetId) ||
        [...composition.imageReferences, ...composition.videoReferences].some(reference => sameCanvasReferenceValue(source, reference))
      ),
    );
    if (alreadyAttached) {
      // Keep the picker active so a duplicate click is recoverable: the user
      // can immediately choose another image without reopening the creator
      // menu. Candidate styling already marks this card as unavailable.
      setMessage("该素材已添加为创作参考，请选择其他素材。");
      return;
    }
    // Keep the pick session open when the candidate is rejected (for example
    // because it is already connected or the target changed while the canvas
    // was rendering). Closing here used to make a failed click look like a
    // successful selection and forced the user to reopen the picker.
    if (!addReference(targetId, sourceId)) {
      setMessage("该素材已添加，或当前节点暂时不能接收此类参考。请选择其他素材。");
      return;
    }
    cancelReferencePick();
  };
  const chooseCanvasTextReference = (sourceId: string) => {
    const targetId = referencePickTarget;
    if (!targetId || sourceId === targetId) return;
    const source = docRef.current.nodes.find((node) => node.id === sourceId);
    const composition = composePrompt(docRef.current.nodes, docRef.current.edges, targetId);
    const alreadyAttached = Boolean(
      source && (
        docRef.current.edges.some((edge) => edge.from === sourceId && edge.to === targetId) ||
        composition.textReferences.some((reference) => reference.nodeId === sourceId)
      ),
    );
    if (!source || !isCanvasTextReference(source)) {
      setMessage("请选择有内容的文本节点。图片结果节点需要作为参考图引用。");
      return;
    }
    if (alreadyAttached) {
      setMessage("这段文本已被当前创作引用，请选择其他文本节点。");
      return;
    }
    if (!canConnect(sourceId, targetId, { allowCompletedPrompt: true })) {
      setMessage("当前节点不能引用这段文本，请选择其他文本节点。");
      return;
    }
    commit((value) => ({
      ...value,
      edges: [...value.edges, { id: uid("edge"), from: sourceId, to: targetId }],
    }));
    clearConnection();
    setSelected([targetId]);
    setInspectorOpen(true);
    cancelReferencePick();
  };
  const attachMusicReference = async (targetId: string, blob: Blob, title: string, sourceId?: string) => {
    const documentId = docRef.current.id;
    const previousReference = docRef.current.nodes.find(node => node.id === targetId)?.musicReference?.localAudio;
    const duration = await readMusicReferenceAudioDuration(blob);
    const source = sourceId ? docRef.current.nodes.find(node => node.id === sourceId) : undefined;
    const [localResult, uploadResult] = await Promise.all([
      storeLocalAudio(blob).then(value => ({ value })).catch(() => ({ value: undefined })),
      source?.assetId
        ? Promise.resolve({ value: undefined })
        : uploadPlatformAsset(client.api, { file: new File([blob], title || "reference-audio", { type: blob.type || "audio/mpeg" }), name: title, category: "sound" }).then(value => ({ value })).catch(() => ({ value: undefined })),
    ]);
    const localAudio = localResult.value;
    const assetId = source?.assetId || uploadResult.value?.id;
    if (!localAudio && !assetId) throw new Error("参考音频未能保存到本机或云端，请检查存储空间和网络后重试。");
    checkLocalAccount();
    const target = docRef.current.nodes.find(node => node.id === targetId);
    if (!alive.current || leaving.current || docRef.current.id !== documentId || !target || target.mediaType !== "audio" || (target.audioMode || "music") !== "music" || hasPendingNodeTask(target) || target.musicReference?.localAudio !== previousReference) throw new Error("创作节点已变化，请重新选择参考音频。");
    update([targetId], { musicReference: { ...(localAudio ? { localAudio } : {}), ...(assetId ? { assetId } : {}), title: title.slice(0, 160), duration, size: blob.size, ...(sourceId ? { nodeId: sourceId } : {}) } });
    await persist(docRef.current, false);
    if (!assetId) setMessage("云端保存失败，参考音频仅保存在本机，换设备后无法恢复。");
  };
  const selectMusicReference = async (targetId: string, sourceId: string) => {
    const source = docRef.current.nodes.find(node => node.id === sourceId);
    if (!source || !canLoadAudioContent(source)) throw new Error("请选择已完成的音频素材。");
    const blob = await audioSources.read(source, undefined, 50 * 1024 * 1024);
    await attachMusicReference(targetId, blob, source.title, sourceId);
  };
  const saveRecording = async (targetId: string, file: File) => {
    const documentId = docRef.current.id;
    const [localResult, uploadResult] = await Promise.allSettled([
      storeLocalAudio(file),
      uploadPlatformAsset(client.api, { file, name: file.name, category: "sound" }),
    ]);
    const localAudio = localResult.status === "fulfilled" ? localResult.value : undefined;
    const uploaded = uploadResult.status === "fulfilled" ? uploadResult.value : undefined;
    if (!localAudio && !uploaded) throw new Error("录音未能保存到本机或云端，请检查存储空间和网络后重试。");
    checkLocalAccount();
    const target = docRef.current.nodes.find(node => node.id === targetId);
    if (!alive.current || leaving.current || docRef.current.id !== documentId || !target) throw new Error("画布已变化，请在原画布保存录音。");
    if (hasPendingNodeTask(target)) throw new Error("请先等待当前任务完成，再保存录音。");
    update([targetId], { localAudio, audio: uploaded?.url, assetId: uploaded?.id, taskId: undefined, audioTaskType: undefined,
      voiceId: undefined, voiceTrialAudioAvailable: undefined, musicSubmission: undefined, voiceDesignSubmission: undefined, ttsSubmission: undefined,
      taskDiagnostic: undefined, taskPrompt: undefined, error: undefined, status: "completed", audioMode: "recording", ...DEFAULT_AUDIO_NODE_SIZE });
    await persist(docRef.current, false);
    if (!uploaded) setMessage("云端保存失败，当前录音仅保存在本机。完成上传后才能在其他设备恢复。");
  };
  const createLyrics = async (targetId: string, prompt: string) => {
    const documentId = docRef.current.id;
    const result = await generateMusicLyrics((path, init) => client.api.request(path, init), prompt);
    checkLocalAccount();
    const target = docRef.current.nodes.find(node => node.id === targetId);
    if (!alive.current || leaving.current || docRef.current.id !== documentId || !target || (target.audioMode || "music") !== "music" || hasPendingNodeTask(target)) throw new Error("创作状态已变化，请在音乐模式中重新生成歌词。");
    return result;
  };
  const generateVoiceDesignTask = async (requested = primary, inputChanged = false) => {
    if (!requested || leaving.current || pendingRemovalNodes.current.has(requested.id)) return;
    const node = docRef.current.nodes.find(item => item.id === requested.id);
    if (!node || node.type !== "prompt" || node.mediaType !== "audio" || activeRequests.current.has(node.id)) return;
    const resumable = hasPendingNodeTask(node);
    if (!resumable && !canCreateNewCanvasTask(node, inputChanged)) return;
    const taskId = node.taskId && resumable ? node.taskId : undefined;
    const previous = !taskId && resumable ? node.voiceDesignSubmission : undefined;
    const prompt = previous?.prompt || (taskId && node.taskPrompt ? node.taskPrompt : composePrompt(docRef.current.nodes, docRef.current.edges, node.id).prompt);
    const available = compatibleVoiceDesignModels(models);
    const selected = available.find(model => model.id === node.modelId) || preferredVoiceDesignModel(available);
    if (!taskId && !previous && (!selected || !prompt.trim() || !node.voicePreviewText?.trim() || [...node.voicePreviewText].length > 500)) {
      setCreationError({ id: node.id, message: !selected ? "没有可用的音色模型。" : !prompt.trim() ? "请描述希望生成的音色。" : !node.voicePreviewText?.trim() ? "请填写试听文本。" : "试听文本最多 500 个字符。" });
      setInspectorOpen(true); return;
    }
    const submission: VoiceDesignSubmission | undefined = taskId ? undefined : previous || { key: uid("canvas-voice-submit"), model: selected!.id!, prompt, previewText: node.voicePreviewText!.trim() };
    const controller = new AbortController();
    const documentId = docRef.current.id;
    activeRequests.current.set(node.id, controller);
    const currentNode = () => alive.current && !leaving.current && !controller.signal.aborted && docRef.current.id === documentId && activeRequests.current.get(node.id) === controller ? docRef.current.nodes.find(item => item.id === node.id) : undefined;
    setActiveIds(ids => [...ids, node.id]);
    patchTask(node.id, { status: "running", taskId, taskPrompt: prompt, error: undefined, audioTaskType: "voice_design", voiceDesignSubmission: submission, musicSubmission: undefined,
      ...(!taskId && !previous ? { modelId: selected!.id, audio: undefined, localAudio: undefined, assetId: undefined, voiceId: undefined, taskDiagnostic: { status: "running", phase: "submitting", createdAt: new Date().toISOString() }, inputSignature: audioCreationSignature({ ...node, audioMode: "voice_design" }, models as any, prompt) } : {}) });
    try {
      await persist(docRef.current, false);
      if (!currentNode()) return;
      const result = await generateVoiceDesign((path, init) => client.api.request(path, init), {
        model: submission?.model || node.modelId, prompt, previewText: submission?.previewText || node.voicePreviewText || "", taskId, idempotencyKey: submission?.key,
      }, id => { if (!currentNode()) return; patchTask(node.id, { taskId: id, status: "running", voiceDesignSubmission: undefined }); return persist(docRef.current, false); }, {
        signal: controller.signal, recovery: Boolean(previous),
        onStatus: snapshot => {
          const current = currentNode(); if (!current) return;
          patchTask(node.id, { status: mediaTaskPublicState(snapshot) === "failed" ? "failed" : "running", taskDiagnostic: { ...current.taskDiagnostic, status: snapshot.status, code: snapshot.code, phase: snapshot.phase }, ...(snapshot.voiceId ? { voiceId: snapshot.voiceId } : {}) });
        },
      });
      const current = currentNode(); if (!current) return;
      patchTask(node.id, { status: "completed", taskId: result.taskId, voiceId: result.voiceId, audioTaskType: "voice_design", assetId: result.assetId, voiceTrialAudioAvailable: result.trialAudioAvailable !== false,
        audio: result.trialAudioAvailable === false ? undefined : result.contentUrl || `/voice-design/tasks/${result.taskId}/content`,
        voiceDesignSubmission: undefined, error: undefined, taskDiagnostic: { ...current.taskDiagnostic, status: "completed", phase: "completed", assetStatus: result.trialAudioAvailable === false ? "unavailable" : "ready", code: undefined } });
      await persist(docRef.current, false);
      setCreationError(null);
      const notice = notificationGate.current.generation({ canvasId: documentId, nodeId: node.id, title: node.title, outcome: "completed", taskId: result.taskId, submissionKey: submission?.key }, preferencesRef.current, completionNoticeContext([node]));
      if (notice) setMessage("音色已生成，可复制音色 ID 并试听。", undefined, 3500);
    } catch (error) {
      if (!currentNode() || controller.signal.reason === "cancelled" || controller.signal.reason === "replaced") return;
      const voiceError = error instanceof VoiceDesignError ? error : undefined;
      const pending = voiceError ? voiceError.pending || Boolean(submission && !voiceError.terminalTask) : Boolean(taskId || submission);
      patchTask(node.id, { status: pending ? "queued" : "failed", error: errorText(error), ...(!pending ? { voiceDesignSubmission: undefined } : {}), ...(voiceError?.taskId ? { taskId: voiceError.taskId } : {}), taskDiagnostic: { ...currentNode()?.taskDiagnostic, code: voiceError?.code, status: pending ? "pending" : "failed" } });
      void persist(docRef.current, false).catch(() => setStatus("任务恢复信息保存失败 · 请保留页面并导出备份"));
      if (!pending) reportTaskFailure(node, error, submission?.key);
    } finally {
      if (activeRequests.current.get(node.id) === controller) { activeRequests.current.delete(node.id); if (alive.current) setActiveIds(ids => ids.filter(id => id !== node.id)); }
    }
  };
  const cancelVoiceDesignCreator = async (requested: CanvasNode) => {
    const node = docRef.current.nodes.find(item => item.id === requested.id);
    if (!node?.taskId || cancelingIds.includes(node.id)) return;
    const taskId = node.taskId, documentId = docRef.current.id;
    setCancelingIds(ids => [...ids, node.id]);
    try {
      const snapshot = await cancelVoiceDesign((path, init) => client.api.request(path, init), taskId, node.voiceDesignSubmission?.key);
      const current = docRef.current.nodes.find(item => item.id === node.id);
      if (docRef.current.id !== documentId || !current || current.taskId !== taskId) return;
      const cancelled = ["cancelled", "canceled"].includes(snapshot.status);
      if (cancelled) activeRequests.current.get(node.id)?.abort("cancelled");
      patchTask(node.id, { status: cancelled ? "failed" : current.status === "completed" ? "completed" : "queued", ...(cancelled ? { voiceDesignSubmission: undefined, error: undefined } : {}), taskDiagnostic: { ...current.taskDiagnostic, status: snapshot.status, code: snapshot.code, phase: snapshot.phase } });
      if (!cancelled && !activeRequests.current.has(node.id)) void generateVoiceDesignTask(current);
      await persist(docRef.current, false);
      if (cancelled) setMessage("音色生成已取消。", undefined, 2500);
    } catch (error) {
      if (docRef.current.id === documentId) setMessage(`取消音色生成失败：${errorText(error)}`);
    } finally { if (alive.current) setCancelingIds(ids => ids.filter(id => id !== node.id)); }
  };
  const generateMusicTask = async (requested = primary, inputChanged = false) => {
    if (!requested || leaving.current || pendingRemovalNodes.current.has(requested.id)) return;
    const node = docRef.current.nodes.find(item => item.id === requested.id);
    if (!node || node.type !== "prompt" || node.mediaType !== "audio" || activeRequests.current.has(node.id)) return;
    const resumable = hasPendingNodeTask(node);
    const previous = !node.taskId && resumable ? node.musicSubmission : undefined;
    if (!resumable && !canCreateNewCanvasTask(node, inputChanged)) return;
    const taskId = node.taskId && resumable ? node.taskId : undefined;
    const composition = composePrompt(docRef.current.nodes, docRef.current.edges, node.id);
    const effectivePrompt = previous?.prompt || (taskId && node.taskPrompt ? node.taskPrompt : composition.prompt);
    const inputMode = (previous?.referenceLocalAudio || node.musicReference) ? "reference_audio" : "text";
    const available = compatibleMusicModels(models as any, inputMode);
    const selected = available.find(model => model.id === node.modelId) || preferredMusicModel(available, inputMode);
    const settings = resolveMusicSettings(selected, node.musicSettings);
    if (!taskId && !previous && (!effectivePrompt.trim() || !selected)) {
      setCreationError({ id: node.id, message: !effectivePrompt.trim() ? "请先填写音乐描述。" : "没有可用的音乐模型。" });
      setInspectorOpen(true);
      return;
    }
    const submission = taskId ? undefined : previous || {
      key: uid("canvas-music-submit"), model: selected!.id!, prompt: effectivePrompt,
      ...(settings.audio_mode !== "instrumental" && node.musicLyrics?.trim() ? { lyrics: node.musicLyrics.trim() } : {}),
      ...(node.musicReference ? { referenceLocalAudio: node.musicReference.localAudio, referenceAssetId: node.musicReference.assetId, referenceNodeId: node.musicReference.nodeId, referenceTitle: node.musicReference.title, referenceDuration: node.musicReference.duration, referenceSize: node.musicReference.size } : {}),
      ...(settings.audio_mode ? { audio_mode: settings.audio_mode } : {}),
      ...(settings.output_format ? { output_format: settings.output_format } : {}),
      ...(settings.duration !== undefined ? { duration: settings.duration } : {}),
      ...(settings.audio_mode === "song" && !node.musicLyrics?.trim() && Boolean((selected as any)?.supported_parameters?.lyrics_optimizer?.type === "boolean" || (selected as any)?.platform_capabilities?.supported_parameters?.lyrics_optimizer?.type === "boolean") ? { lyrics_optimizer: true } : {}),
    };
    const controller = new AbortController();
    activeRequests.current.set(node.id, controller);
    const currentNode = () => alive.current && !leaving.current && !controller.signal.aborted && activeRequests.current.get(node.id) === controller
      ? docRef.current.nodes.find(item => item.id === node.id) : undefined;
    setActiveIds(ids => [...ids, node.id]);
    patchTask(node.id, { status: "running", taskId, taskPrompt: effectivePrompt, error: undefined, musicSubmission: submission, audioTaskType: "music", voiceDesignSubmission: undefined,
      ...(!taskId && !previous ? { voiceId: undefined, voiceTrialAudioAvailable: undefined, audio: undefined, assetId: undefined, localAudio: undefined, taskDiagnostic: { status: "running", phase: "submitting", createdAt: new Date().toISOString() }, inputSignature: audioCreationSignature(node, models as any, effectivePrompt) } : {}),
      ...(selected?.id && !taskId && !previous ? { modelId: selected.id, musicSettings: settings } : {}) });
    try {
      await persist(docRef.current, false);
      if (!currentNode()) return;
      const result = await generateMusic((path, init) => client.api.request(path, init), {
        model: submission?.model || node.modelId || "", prompt: effectivePrompt,
        lyrics: submission?.lyrics, audio_mode: submission?.audio_mode as any,
        lyrics_optimizer: submission?.lyrics_optimizer,
        output_format: submission?.output_format, duration: submission?.duration,
        idempotencyKey: submission?.key, taskId,
      }, id => { if (!currentNode()) return; patchTask(node.id, { taskId: id, status: "running", musicSubmission: undefined }); return persist(docRef.current, false); }, {
        signal: controller.signal, observeUnknown: true, recovery: Boolean(previous),
        loadReferenceAudio: submission?.referenceLocalAudio || submission?.referenceAssetId ? async () => {
          const local = submission.referenceLocalAudio ? await readLocalAudio(submission.referenceLocalAudio) : null;
          const blob = local || (submission.referenceAssetId
            ? await audioSources.read({ type: "audio", status: "completed", assetId: submission.referenceAssetId }, controller.signal, 50 * 1024 * 1024)
            : null);
          if (!blob) throw new MusicGenerationError("原 Cover 提交尚未被平台受理，且参考音频已无法恢复。请重新添加参考音频后再生成。", { terminalTask: true, code: "MUSIC_REFERENCE_MISSING" });
          validateMusicReferenceAudio(blob, submission.referenceDuration || 0);
          return readMusicReferenceAudioBase64(blob);
        } : undefined,
        onStatus: snapshot => { if (!currentNode()) return; patchTask(node.id, { status: mediaTaskPublicState({ status: snapshot.status, code: snapshot.code, phase: snapshot.phase, assetStatus: snapshot.assetStatus }) === "failed" ? "failed" : "running", taskDiagnostic: { ...docRef.current.nodes.find(item => item.id === node.id)?.taskDiagnostic, status: snapshot.status, phase: snapshot.phase, assetStatus: snapshot.assetStatus, code: snapshot.code || undefined, requestId: snapshot.requestId, supplierConfirmation: snapshot.supplierConfirmation }, ...(snapshot.assetId ? { assetId: snapshot.assetId } : {}) }); },
      });
      const source = currentNode(); if (!source) return;
      patchTask(node.id, { status: "completed", error: undefined, audio: result.contentUrl, assetId: result.assetId, taskId: result.taskId, musicSubmission: undefined, taskDiagnostic: { ...source.taskDiagnostic, status: "completed", phase: "completed", assetStatus: "ready", code: undefined } });
      await persist(docRef.current, false);
      setInspectorMode(null); setCreationError(null);
      const notice = notificationGate.current.generation({ canvasId: docRef.current.id, nodeId: node.id, title: node.title, outcome: "completed", taskId: result.taskId, submissionKey: submission?.key }, preferencesRef.current, completionNoticeContext([node]));
      if (notice) setMessage(notice.text, undefined, 3500);
    } catch (error) {
      if (!currentNode() || controller.signal.reason === "cancelled" || controller.signal.reason === "replaced") return;
      const musicError = error instanceof MusicGenerationError ? error : undefined;
      const pending = musicError ? musicError.pending || Boolean(submission && !musicError.terminalTask) : Boolean(taskId || submission);
      patchTask(node.id, { status: pending ? "queued" : "failed", ...(!pending ? { musicSubmission: undefined } : {}), error: errorText(error), ...(musicError?.taskId ? { taskId: musicError.taskId } : {}), taskDiagnostic: { ...docRef.current.nodes.find(item => item.id === node.id)?.taskDiagnostic, ...(musicError ? { code: musicError.code, status: musicError.status || (pending ? "pending" : "failed"), requestId: musicError.requestId } : {}) } });
      void persist(docRef.current, false).catch(() => setStatus("任务恢复信息保存失败 · 请保留页面并导出备份"));
      if (!pending) reportTaskFailure(node, error, submission?.key);
    } finally {
      if (activeRequests.current.get(node.id) === controller) { activeRequests.current.delete(node.id); if (alive.current) setActiveIds(ids => ids.filter(id => id !== node.id)); }
    }
  };
  const cancelMusicCreator = async (requested: CanvasNode) => {
    if (cancelingIds.includes(requested.id)) return;
    const node = docRef.current.nodes.find(item => item.id === requested.id);
    if (!node || node.type !== "prompt" || node.mediaType !== "audio" || !node.taskId) return;
    const taskId = node.taskId;
    const documentId = docRef.current.id;
    setCancelingIds(ids => ids.includes(node.id) ? ids : [...ids, node.id]);
    try {
      const snapshot = await cancelMusic((path, init) => client.api.request(path, init), taskId, node.musicSubmission?.key);
      const current = docRef.current.nodes.find(item => item.id === node.id);
      if (docRef.current.id !== documentId || !current || current.taskId !== taskId) return;
      const cancelled = ["cancelled", "canceled"].includes(snapshot.status);
      if (cancelled) activeRequests.current.get(node.id)?.abort("cancelled");
      patchTask(node.id, {
        status: cancelled ? "failed" : current.status === "completed" ? "completed" : "queued",
        ...(cancelled ? { error: undefined, musicSubmission: undefined } : {}),
        taskDiagnostic: {
          ...current.taskDiagnostic,
          status: snapshot.status,
          phase: snapshot.phase,
          code: snapshot.code || undefined,
          requestId: snapshot.requestId,
          ...(cancelled ? { assetStatus: undefined } : {}),
        },
      });
      if (!cancelled && !activeRequests.current.has(node.id)) void generateMusicTask(current);
      await persist(docRef.current, false);
      if (cancelled) setMessage("音乐生成已取消。", undefined, 2500);
    } catch (error) {
      if (docRef.current.id === documentId && docRef.current.nodes.some(item => item.id === node.id && item.taskId === taskId)) {
        setMessage(`取消音乐生成失败：${errorText(error)}`);
      }
    } finally {
      if (alive.current) setCancelingIds(ids => ids.filter(id => id !== node.id));
    }
  };
  React.useEffect(() => {
    if (referencePickTarget && !doc.nodes.some((node) => node.id === referencePickTarget && node.type === "prompt")) {
      cancelReferencePick(false);
    }
  }, [doc.nodes, referencePickTarget]);
  const changeTool = (next: Tool) => {
    cancelGesture();
    setTool(next);
    setToolMenu(false);
  };
  const focusToolSwitch = () => toolMenuAnchor.current?.querySelector<HTMLButtonElement>(".tool-switch")?.focus({ preventScroll: true });
  const selectNavigationTool = (next: Tool) => {
    focusToolSwitch();
    changeTool(next);
  };
  const closeMenus = () => {
    setPicker(null);
    closeZoomMenu();
    setToolMenu(false);
    setLayoutMenu(false);
  };
  const closeDockPanels = () => {
    setOverlay(current => current === "help" || current === "settings" ? null : current);
    if (drawer === "assets" && assetReferenceTarget.current) returnToCreatorFromAssetLibrary();
    else setDrawer(null);
  };
  const toggleDockPanel = (panel: "help" | "settings" | "layers" | "assets") => {
    closeMenus();
    if (panel === "help" || panel === "settings") {
      if (drawer === "assets" && assetReferenceTarget.current) returnToCreatorFromAssetLibrary();
      else setDrawer(null);
      setOverlay(overlay === panel ? null : panel);
    } else {
      setOverlay(null);
      if (drawer === panel && panel === "assets" && assetReferenceTarget.current) returnToCreatorFromAssetLibrary();
      else setDrawer(drawer === panel ? null : panel);
    }
  };
  const focusNodes = (nodes = docRef.current.nodes) => {
    clearZoomDraft();
    navigateView(fitViewport(nodes, boardSize, boardSize.width < 700 ? 45 : 110, 1));
  };
  const zoomTo = (zoom: number, closeMenu = true) => {
    // Read the in-flight navigation target so rapid slider/preset changes
    // accumulate instead of repeatedly starting from the last painted frame.
    const current = viewportMotion.target("navigate");
    navigateView(
      zoomAt(current, clampZoom(zoom), {
        x: boardSize.width / 2,
        y: boardSize.height / 2,
      }),
    );
    revealZoomIndicator();
    if (closeMenu) {
      closeZoomMenu();
    }
  };
  const stepZoom = (direction: number) => {
    clearZoomDraft();
    zoomTo(viewportMotion.target("navigate").zoom * Math.pow(1.2, direction), false);
  };
  React.useEffect(() => {
    const element = board.current!;
    let lastSize = { width: element.clientWidth, height: element.clientHeight };
    const observer = new ResizeObserver(([entry]) => {
      const nextSize = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      if (
        nextSize.width !== lastSize.width ||
        nextSize.height !== lastSize.height
      ) {
        const current = docRef.current.viewport;
        view(
          {
            ...current,
            x: current.x + (nextSize.width - lastSize.width) / 2,
            y: current.y + (nextSize.height - lastSize.height) / 2,
          },
          false,
        );
      }
      lastSize = nextSize;
      setBoardSize(nextSize);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Trackpad pinch events are delivered as Ctrl/Meta + wheel. The board owns
  // that gesture when the pointer is over the canvas, but the browser would
  // otherwise zoom the whole page when the pointer is over the header,
  // library, inspector, or task panels. Keep browser zoom scoped out of the
  // canvas app while preserving ordinary wheel handling in editable fields.
  React.useEffect(() => {
    const preventPageZoom = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as Element | null;
      if (!target || !appShell.current?.contains(target)) return;
      event.preventDefault();
    };
    window.addEventListener("wheel", preventPageZoom, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", preventPageZoom, true);
  }, []);
  React.useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const backup = await readDraft<Document>(
          `recovery:${initialDocument.id}`,
        );
        if (!alive.current) return;
        if (backup)
          setRecovery(normalize({ ...backup, id: initialDocument.id }));
        setStatus(isSessionOnlyStorage() ? "正在确认云端保存状态…" : "已打开本机画布");
      } catch (error) {
        setMessage(errorText(error));
      }
      if (!alive.current) return;
      setDraftReady(true);
      void refreshPlatform(true, initialDocument);
    })();
    return () => {
      alive.current = false;
      for (const controller of activeRequests.current.values())
        controller.abort();
    };
  }, []);
  React.useEffect(() => {
    if (platformReady) return;
    for (const controller of activeRequests.current.values())
      controller.abort();
    setPlatformProfile(null);
    setPlatformProfileError("");
    setHydrated(false);
    setSyncEnabled(false);
  }, [platformReady]);
  React.useEffect(() => {
    if (lastPlatformRevision.current === platformRevision) return;
    lastPlatformRevision.current = platformRevision;
    taskRecovery.current.clear();
    void refreshPlatform();
  }, [platformRevision]);
  React.useEffect(() => {
    if (!draftReady || !dirty.current || gesturing || viewportMoving || leaving.current) return;
    setStatus("正在保存…");
    const snapshot = doc;
    const timer = window.setTimeout(() => {
      if (leaving.current) return;
      void persist(snapshot, false)
        .then(() => {
          scheduleCloudSync(snapshot);
          if (docRef.current.updatedAt === snapshot.updatedAt)
            setStatus(
              syncEnabled && hydrated
                ? isSessionOnlyStorage() ? "等待云端同步 · 仅当前页面保留" : "已保存本机 · 等待云端同步"
                : savedStatus(false),
            );
        })
        .catch((error) => {
          setStatus(
            lastLocalSave.current === snapshot.updatedAt
              ? syncFailureStatus()
              : "保存失败 · 请导出备份",
          );
          setMessage(errorText(error));
        });
    }, 450);
    saveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [doc, draftReady, gesturing, viewportMoving, syncEnabled, hydrated, scheduleCloudSync]);
  React.useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (cloudSaveTimer.current !== null) window.clearTimeout(cloudSaveTimer.current);
    if (removalTimer.current !== null) clearTimeout(removalTimer.current);
    if (viewportMoveTimer.current !== null) window.clearTimeout(viewportMoveTimer.current);
    viewportExitNodeTimers.current.forEach((timer) => clearTimeout(timer));
    viewportExitNodeTimers.current.clear();
    viewportExitEdgeTimers.current.forEach((timer) => clearTimeout(timer));
    viewportExitEdgeTimers.current.clear();
    viewportExitGroupTimers.current.forEach((timer) => clearTimeout(timer));
    viewportExitGroupTimers.current.clear();
    groupFrameExitTimers.current.forEach((timer) => clearTimeout(timer));
    groupFrameExitTimers.current.clear();
  }, []);

  const undo = () => {
    clearConnection();
    const value = past.at(-1);
    if (!value) return;
    const nodes = reconcileHistoryNodes(
      value.nodes,
      docRef.current.nodes,
      new Set(activeRequests.current.keys()),
    );
    if (!nodes) {
      setMessage("无法恢复：正在生成的节点类型已改变，请先完成生成后再试。");
      return;
    }
    // React may run a state updater after replaceDoc mutates docRef. Freeze
    // the leaving document now, or redo would save the already-undone state.
    const current = clone(docRef.current);
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [...items, current]);
    replaceDoc({
      ...clone(value),
      nodes,
      viewport: current.viewport,
      updatedAt: now(),
    });
    setSelected([]);
    setSelectedEdge(null);
    setEditing(null);
    dirty.current = true;
  };
  const redo = () => {
    clearConnection();
    const value = future.at(-1);
    if (!value) return;
    const nodes = reconcileHistoryNodes(
      value.nodes,
      docRef.current.nodes,
      new Set(activeRequests.current.keys()),
    );
    if (!nodes) {
      setMessage("无法恢复：正在生成的节点类型已改变，请先完成生成后再试。");
      return;
    }
    const current = clone(docRef.current);
    setFuture((items) => items.slice(0, -1));
    setPast((items) => [...items, current]);
    replaceDoc({
      ...clone(value),
      nodes,
      viewport: current.viewport,
      updatedAt: now(),
    });
    setSelected([]);
    setSelectedEdge(null);
    setEditing(null);
    dirty.current = true;
  };
  const remove = (ids = selected) => {
    const requestedIds = [...new Set(ids)].filter((id) =>
      docRef.current.nodes.some((node) => node.id === id),
    );
    // A normal group selection represents the whole visible group. Include
    // collapsed task metadata in destructive actions so deleting the cards
    // cannot resurrect an orphaned prompt at the old location.
    const selectedSet = new Set(requestedIds);
    const wholeGroups = new Set(
      docRef.current.nodes
        .map((node) => node.groupId)
        .filter((id): id is string => Boolean(id))
        .filter((groupId) => {
          const members = visibleGroupMembers(docRef.current.nodes, groupId);
          return members.length > 1 && members.every((node) => selectedSet.has(node.id));
        }),
    );
    const nodeIds = [...new Set([
      ...requestedIds,
      ...docRef.current.nodes
        .filter((node) => node.groupId && wholeGroups.has(node.groupId))
        .map((node) => node.id),
    ])];
    clearConnection();
    const edgeId = selectedEdge;
    if (!nodeIds.length && !edgeId) return;
    nodeIds.forEach((id) => pendingRemovalNodes.current.add(id));
    // The surface remains mounted only for its 180ms exit animation; it is
    // already deleted for task observation and automatic recovery purposes.
    stopRemovedNodeRequests(nodeIds);
    if (edgeId) pendingRemovalEdges.current.add(edgeId);
    nodeIds.forEach((id) => {
      const timer = viewportExitNodeTimers.current.get(id);
      if (timer) clearTimeout(timer);
      viewportExitNodeTimers.current.delete(id);
    });
    if (edgeId) {
      const timer = viewportExitEdgeTimers.current.get(edgeId);
      if (timer) clearTimeout(timer);
      viewportExitEdgeTimers.current.delete(edgeId);
    }
    setViewportExitingNodeIds((current) => current.filter((id) => !nodeIds.includes(id)));
    if (edgeId) setViewportExitingEdgeIds((current) => current.filter((id) => id !== edgeId));
    setRemovingNodeIds([...pendingRemovalNodes.current]);
    setRemovingEdgeIds([...pendingRemovalEdges.current]);
    setSelected([]);
    setSelectedEdge(null);
    setInspectorOpen(false);
    closeMenus();
    // Batch deletes that happen in the same animation window into one history
    // entry. The document remains unchanged during the exit frame, so the
    // node surface can scale back to its center without moving its anchor.
    if (removalTimer.current === null) {
      removalTimer.current = setTimeout(() => {
        removalTimer.current = null;
        const removeNodes = [...pendingRemovalNodes.current];
        const removeEdges = [...pendingRemovalEdges.current];
        pendingRemovalNodes.current.clear();
        pendingRemovalEdges.current.clear();
        setRemovingNodeIds([]);
        setRemovingEdgeIds([]);
        if (!removeNodes.length && !removeEdges.length) return;
        const nodeSet = new Set(removeNodes);
        const edgeSet = new Set(removeEdges);
        commit((value) => {
          const remaining = value.nodes.filter((node) => !nodeSet.has(node.id));
          const result = rebuildGroupStateFromNodes(remaining);
          return {
            ...value,
            ...result,
            edges: value.edges.filter(
              (edge) =>
                !edgeSet.has(edge.id) &&
                !nodeSet.has(edge.from) &&
                !nodeSet.has(edge.to),
            ),
          };
        });
      }, 180);
    }
  };
  const removeEdge = (edgeId: string | null = selectedEdge) => {
    if (!edgeId) return;
    const visibleEdge = canvasEdges.find((edge) => edge.id === edgeId);
    const rawEdgeIds = new Set<string>(
      docRef.current.edges.some((edge) => edge.id === edgeId) ? [edgeId] : [],
    );
    // `visibleCanvasEdges` may bridge a hidden completed task and expose a
    // synthetic id. Resolve that visual edge back to the shortest raw path so
    // deleting it still removes the connection users can see.
    if (!rawEdgeIds.size && visibleEdge) {
      const hidden = new Set(
        docRef.current.nodes
          .filter((node) => isCollapsedResultTask(node, docRef.current.nodes, docRef.current.edges))
          .map((node) => node.id),
      );
      const outgoing = new Map<string, Edge[]>();
      docRef.current.edges.forEach((edge) => {
        const list = outgoing.get(edge.from) || [];
        list.push(edge);
        outgoing.set(edge.from, list);
      });
      const queue: { id: string; path: string[] }[] = [{ id: visibleEdge.from, path: [] }];
      const visited = new Set<string>();
      while (queue.length) {
        const current = queue.shift()!;
        if (current.id === visibleEdge.to) {
          current.path.forEach((id) => rawEdgeIds.add(id));
          break;
        }
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        for (const edge of outgoing.get(current.id) || []) {
          if (edge.to !== visibleEdge.to && !hidden.has(edge.to)) continue;
          queue.push({ id: edge.to, path: [...current.path, edge.id] });
        }
      }
    }
    clearConnection();
    commit((value) => ({
      ...value,
      edges: value.edges.filter((edge) => !rawEdgeIds.has(edge.id)),
    }));
    setSelectedEdge(null);
    setSelected([]);
    setInspectorOpen(false);
    closeMenus();
  };
  const groupSelection = () => {
    const ids = [...new Set(selected)];
    if (ids.length < 2) return;
    const groupId = uid("group");
    commit((value) => {
      // A regroup can leave one member behind in its previous group. Rebuild
      // all frames from the post-change membership so singleton groups and
      // their stale hit areas disappear together with the old assignment.
      const result = regroupNodes(value.nodes, ids, groupId);
      return { ...value, ...result };
    });
    setSelected(ids);
  };
  const ungroupSelection = () => {
    const grouped = [...new Set(selected)].filter((id) => docRef.current.nodes.find((node) => node.id === id)?.groupId);
    if (!grouped.length) return;
    commit((value) => {
      const groupIds = new Set(
        grouped
          .map((id) => value.nodes.find((node) => node.id === id)?.groupId)
          .filter((id): id is string => Boolean(id)),
      );
      // Selecting every visible member means "解组". Completed creator
      // tasks can be hidden behind their result assets, so clear those
      // metadata nodes as well or the frame would be recreated on render.
      const targetIds = selectedWholeGroup
        ? new Set(value.nodes.filter((node) => node.groupId && groupIds.has(node.groupId)).map((node) => node.id))
        : new Set(grouped);
      const result = ungroupNodes(value.nodes, [...targetIds], selectedWholeGroup);
      return { ...value, ...result };
    });
    setSelected(grouped);
  };
  const applyLayout = (
    mode: "flow" | "grid",
    scope: "all" | "selected" = chosen.length > 1 ? "selected" : "all",
    sort: typeof layoutSort = layoutSort,
  ) => {
    const source = scope === "selected" ? chosen : docRef.current.nodes;
    if (source.length < 2) {
      setMessage("至少选择 2 个节点后才能整理布局。");
      setLayoutMenu(false);
      return;
    }
    const ids = new Set(source.map((node) => node.id));
    let arranged: CanvasNode[];
    if (mode === "flow") {
      arranged = arrangeNodes(
        source,
        docRef.current.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
      );
    } else {
      const selectedOrder = new Map(selected.map((id, index) => [id, index]));
      const ordered = [...source].sort((a, b) => {
        if (sort === "custom") return (selectedOrder.get(a.id) ?? 0) - (selectedOrder.get(b.id) ?? 0);
        if (sort === "name") return a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id);
        if (sort === "time") return docRef.current.nodes.indexOf(a) - docRef.current.nodes.indexOf(b);
        return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
      });
      const rows = Math.max(1, Math.min(layoutRows, ordered.length));
      const columns = Math.ceil(ordered.length / rows);
      const columnWidths = Array.from({ length: columns }, (_, column) =>
        Math.max(...ordered.filter((_, index) => index % columns === column).map((node) => node.width)),
      );
      const rowHeights = Array.from({ length: rows }, (_, row) =>
        Math.max(...ordered.filter((_, index) => Math.floor(index / columns) === row).map((node) => node.height)),
      );
      const startX = Math.min(...source.map((node) => node.x));
      const startY = Math.min(...source.map((node) => node.y));
      const gap = 32;
      const xOffsets = columnWidths.map((_, column) => columnWidths.slice(0, column).reduce((sum, width) => sum + width + gap, 0));
      const yOffsets = rowHeights.map((_, row) => rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0));
      arranged = ordered.map((node, index) => ({
        ...node,
        x: startX + xOffsets[index % columns],
        y: startY + yOffsets[Math.floor(index / columns)],
      }));
    }
    const minX = Math.min(...source.map((node) => node.x));
    const minY = Math.min(...source.map((node) => node.y));
    const next = new Map(arranged.map((node) => [node.id, node]));
    const positioned = docRef.current.nodes.map((node) => {
      const position = next.get(node.id);
      if (!position) return node;
      return mode === "flow"
        ? { ...node, x: position.x + minX - 100, y: position.y + minY - 100 }
        : { ...node, x: position.x, y: position.y };
    });
    commit((value) => ({
      ...value,
      nodes: value.nodes.map((node) => positioned.find((item) => item.id === node.id) || node),
    }));
    if (scope === "all") navigateView(fitViewport(positioned, boardSize, 110, 1));
    setLayoutMenu(false);
  };
  const arrangeSelection = () => applyLayout(canvasPreferences.autoLayout, "selected");
  const exportSelection = () => {
    if (!chosen.length) return;
    const ids = new Set(chosen.map((node) => node.id));
    const value = docRef.current;
    downloadDocument({
      ...value,
      name: `${value.name || "画布"} · 已选 ${chosen.length} 个节点`,
      nodes: value.nodes.filter((node) => ids.has(node.id)),
      edges: value.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    }, true);
  };
  const duplicateNodes = (originals: CanvasNode[]) => {
    if (!originals.length) return;
    const mapping = new Map(originals.map((node) => [node.id, uid(node.type)]));
    const groupMapping = new Map<string, string>();
    originals.forEach((node) => {
      if (node.groupId && !groupMapping.has(node.groupId)) groupMapping.set(node.groupId, uid("group"));
    });
    const minX = Math.min(...originals.map((n) => n.x)),
      minY = Math.min(...originals.map((n) => n.y));
    const area = {
      x: minX + 40,
      y: minY + 40,
      width: Math.max(...originals.map((n) => n.x + n.width)) - minX,
      height: Math.max(...originals.map((n) => n.y + n.height)) - minY,
    };
    const location = findFreePosition(docRef.current.nodes, area);
    const copies = originals.map((node) => ({
      ...node,
      id: mapping.get(node.id)!,
      title: `${node.title} 副本`,
      x: node.x + location.x - minX,
      y: node.y + location.y - minY,
      taskId: node.mediaType === "audio" && node.status === "completed" ? node.taskId : undefined,
      videoSubmission: undefined,
      musicSubmission: undefined,
      voiceDesignSubmission: undefined,
      ttsSubmission: undefined,
      taskDiagnostic: undefined,
      taskPrompt: undefined,
      inputSignature: undefined,
      submission: undefined,
      resultOf: undefined,
      resultIndex: undefined,
      continuationOf: undefined,
      groupId: node.groupId ? groupMapping.get(node.groupId) : undefined,
      status: node.mediaType === "audio" && node.status === "completed" ? "completed" as const : undefined,
      error: undefined,
    }));
    if (!copies.length) return;
    const edges = docRef.current.edges
      .filter((edge) => mapping.has(edge.to))
      .map((edge) => ({
        id: uid("edge"),
        from: mapping.get(edge.from) || edge.from,
        to: mapping.get(edge.to)!,
      }));
    commit((value) => ({
      ...value,
      nodes: [...value.nodes, ...copies],
      edges: [...value.edges, ...edges],
      groups: expandGroupFrames([...value.nodes, ...copies], value.groups),
    }));
    setSelected(copies.map((node) => node.id));
    reveal(copies);
    closeMenus();
  };
  const duplicate = (ids = selected) => {
    const expandedIds = expandWholeGroupSelection(docRef.current.nodes, ids);
    const originals = docRef.current.nodes.filter((node) => expandedIds.includes(node.id));
    duplicateNodes(originals);
  };
  const copyNodes = (ids = selected) => {
    const expandedIds = expandWholeGroupSelection(docRef.current.nodes, ids);
    const originals = docRef.current.nodes.filter((node) => expandedIds.includes(node.id));
    if (!originals.length) return;
    nodeClipboard.current = clone(originals);
    closeMenus();
    setMessage(`已复制 ${originals.length} 个节点，可使用 ⌘/Ctrl + V 粘贴。`, undefined, 2500);
  };
  const pasteNodes = () => {
    if (!nodeClipboard.current.length) return;
    duplicateNodes(clone(nodeClipboard.current));
  };
  const applyImageOperation = (source: CanvasNode, outputs: ImageToolOutput[]) => {
    if (!outputs.length) return;
    const current = docRef.current;
    // Image tools resolve their source asynchronously. The user can delete
    // that source while the tool is running; do not append late results to a
    // canvas that no longer contains the source card.
    const liveSource = current.nodes.find((node) => node.id === source.id);
    if (!liveSource || pendingRemovalNodes.current.has(source.id)) return;
    source = liveSource;
    const created: CanvasNode[] = [];
    for (const [index, output] of outputs.entries()) {
      const width = Math.min(1600, Math.max(120, output.width || source.width));
      const height = Math.min(1200, Math.max(80, output.height || source.height));
      const location = findFreePosition(
        [...current.nodes, ...created],
        { x: source.x + source.width + 40 + index * 30, y: source.y + index * 30, width, height },
      );
      created.push({
        id: uid("image"),
        type: "image",
        title: `${source.title} · ${output.titleSuffix}`,
        text: "",
        x: location.x,
        y: location.y,
        width,
        height,
        color: COLORS[1],
        image: output.dataUrl,
        resultOf: source.id,
        resultIndex: index,
        operationId: output.operationId,
        operationParams: output.params,
        status: "completed",
      });
    }
    commit((value) => ({
      ...value,
      nodes: [...value.nodes, ...created],
      groups: expandGroupFrames([...value.nodes, ...created], value.groups),
    }));
    setSelected(created.map((node) => node.id));
    setSelectedEdge(null);
    reveal(created);
    setMessage(`已生成 ${created.length} 张${outputs[0].titleSuffix}图片。`, undefined, 2500);
  };
  const insertCapturedVideoFrame = (source: CanvasNode, documentId: string, frame: CapturedVideoFrame) => {
    const current = docRef.current.nodes.find(node => node.id === source.id);
    if (!alive.current || leaving.current || documentId !== docRef.current.id || !current || !sameVideoNodeSource(source, current)) {
      throw new Error("原视频已更换或画布已关闭，请在当前视频上重新截帧。");
    }
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(frame.dataUrl) ||
      ![frame.width, frame.height].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(frame.time) || frame.time < 0) {
      throw new Error("无法读取当前视频画面，请等待加载完成后重试。");
    }
    const size = fitImageNodeSize(frame.width, frame.height);
    const node: CanvasNode = {
      id: uid("image"),
      type: "image",
      title: `${displayNodeTitle(current)} · ${formatVideoTime(frame.time)} 截帧`,
      text: `截取自「${displayNodeTitle(current)}」 ${formatVideoTime(frame.time)}`,
      ...findFreePosition(docRef.current.nodes, { x: current.x + current.width + 40, y: current.y, ...size }),
      ...size,
      color: COLORS[1],
      image: frame.dataUrl,
      // Local derivation is not a model task result. In particular, a legacy
      // inline-video prompt must stay visible after one of its frames is saved.
      operationId: "video-frame",
      operationParams: { sourceNodeId: current.id, time: frame.time, width: frame.width, height: frame.height },
      groupId: current.groupId,
      status: "completed",
    };
    // Use the regular document transaction: undo, autosave, and the existing
    // content-addressed image cache own this local image just like an upload.
    commit(value => ({
      ...value,
      nodes: [...value.nodes, node],
      groups: expandGroupFrames([...value.nodes, node], value.groups),
    }));
    setSelected([node.id]);
    setSelectedEdge(null);
    setInspectorOpen(false);
    reveal([current, node]);
    setMessage("已将当前帧添加为图片，可继续创作或撤销。", undefined, 2500);
  };
  const saveVideoProcessResult = async (blob: Blob, request: VideoProcessRequest, signal: AbortSignal) => {
    const { source, options } = request;
    const nodeId = source.source.id;
    const currentSource = () => {
      signal.throwIfAborted();
      const node = docRef.current.nodes.find(item => item.id === nodeId);
      if (!alive.current || leaving.current || videoProcessJobs.current.get(nodeId) !== request ||
        pendingRemovalNodes.current.has(nodeId) || !videoSources.current.isCurrent(source, docRef.current.id, node)) {
        throw new DOMException("原视频或画布已变化，提取已停止。", "AbortError");
      }
      return node!;
    };
    let current = currentSource();
    if (options.operation === "extract-video" || options.operation === "extract-audio") {
      const audio = options.operation === "extract-audio";
      let localKey: string | undefined;
      let ownsLocalKey = false;
      const mimeType = blob.type || (audio ? "audio/webm" : "video/webm");
      const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "webm";
      const file = new File([blob], `${displayNodeTitle(current)}-extract.${extension}`, { type: mimeType });
      try {
        const [localResult, uploadResult] = await Promise.allSettled([
          audio ? storeLocalAudio(blob) : storeLocalVideo(blob),
          uploadPlatformAsset(client.api, { file, name: file.name, category: audio ? "sound" : "other" }),
        ]);
        if (localResult.status === "fulfilled") { localKey = localResult.value; ownsLocalKey = true; }
        const uploaded = uploadResult.status === "fulfilled" ? uploadResult.value : undefined;
        if (!localKey && !uploaded) throw new Error("提取结果未能保存到本机或云端，请检查存储空间和网络后重试。");
        current = currentSource();
        const size = audio ? DEFAULT_AUDIO_NODE_SIZE : fitVideoNodeSize(current.width, current.height);
        const kind = audio ? "音频" : "视频";
        const node: CanvasNode = {
          id: uid(audio ? "audio" : "video"), type: audio ? "audio" : "video", mediaType: audio ? "audio" : "video",
          title: `${displayNodeTitle(current)} · 提取${kind}`.slice(0, 160),
          text: `提取自「${displayNodeTitle(current)}」`,
          ...size,
          ...findFreePosition(docRef.current.nodes, { x: current.x + current.width + 40, y: current.y, ...size }),
          color: current.color, groupId: current.groupId, status: "completed", resultOf: current.id,
          ...(audio ? { ...(localKey ? { localAudio: localKey } : {}), ...(uploaded?.url ? { audio: uploaded.url } : {}), audioMode: "recording" as const } : { ...(localKey ? { localVideo: localKey } : {}), ...(uploaded?.url ? { video: uploaded.url, videoContentUrl: uploaded.url, videoContentUrlExpiresAt: uploaded.url_expires_at } : {}), videoDuration: options.endTime - options.startTime }),
          ...(uploaded?.id ? { assetId: uploaded.id } : {}),
          operationId: options.operation,
          operationParams: { sourceNodeId: current.id, startTime: options.startTime, endTime: options.endTime, mimeType, size: blob.size },
        };
        commit(value => {
          const nodes = [...value.nodes, node];
          return { ...value, nodes, groups: expandGroupFrames(nodes, value.groups) };
        });
        setSelected([node.id]); setSelectedEdge(null); setInspectorOpen(false);
        reveal([current, node]);
        clearVideoProcess(nodeId, request);
        setMessage(uploaded ? `已将提取${kind}保存到素材库并添加为新节点。` : `已将提取${kind}添加为新节点；云端保存失败，当前仅保存在本机。`, undefined, 3500);
      } catch (error) {
        if (localKey && ownsLocalKey) await (audio ? deleteLocalAudio(localKey) : deleteLocalVideo(localKey)).catch(() => {});
        throw error;
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const extension = videoOutputExtension(blob.type);
    const suffix = options.operation === "convert" ? `${(options.outputFormat || "webm").toUpperCase()}格式` : options.operation === "trim" ? "裁剪" : options.operation === "watermark" ? "水印" : options.operation === "crop" ? "裁剪" : options.operation === "compress" ? "压缩" : options.operation === "grade" ? "调色" : options.operation === "rotate" ? "旋转" : options.operation === "mirror" ? "镜像" : options.operation === "speed" ? `${options.playbackRate || 1}倍速` : "静音";
    const link = document.createElement("a"); link.href = url; link.download = `${current.title || "video"} · ${suffix}.${extension}`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    clearVideoProcess(nodeId, request);
    setMessage(`已导出${suffix}文件。`, undefined, 2500);
  };
  saveVideoProcessResultRef.current = saveVideoProcessResult;
  const copyImage = async (node: CanvasNode) => {
    if (!node.image && !node.localImage && !node.assetId && !node.taskId) return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        setMessage("当前浏览器不支持复制图片，请尝试下载图片。");
        return;
      }
      const nodeElement = [...document.querySelectorAll<HTMLElement>(".node[data-node-id]")]
        .find((element) => element.dataset.nodeId === node.id);
      const displayedImage = nodeElement?.querySelector<HTMLImageElement>(
        "img.node-image, .creation-inline-media img, .creation-result-thumb",
      );
      const displayedSource = displayedImage?.currentSrc || displayImageThumbnail(node.image, node.imageThumbnail);
      let blob: Blob | undefined;

      // Read the decoded pixels first. This keeps same-origin and inline media
      // on the zero-request path.
      if (displayedImage?.complete && displayedImage.naturalWidth > 0 && displayedImage.naturalHeight > 0) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = displayedImage.naturalWidth;
          canvas.height = displayedImage.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("canvas");
          context.drawImage(displayedImage, 0, 0);
          blob = await new Promise<Blob | undefined>((resolve) => canvas.toBlob(
            (value) => resolve(value || undefined),
            "image/png",
          ));
        } catch {
          // Cross-origin images without CORS permission taint the canvas.
        }
      }

      if (!blob && node.localImage) {
        const local = await readCachedImage(node.localImage).catch(() => null);
        if (local) blob = await imageDataBlob(local);
      }

      if (!blob && node.image) {
        const original = imageOriginalURL(node.image) || node.image;
        const cached = getCachedRemoteImage(node.image) || getCachedRemoteImage(original);
        if (cached) blob = await imageDataBlob(cached);
      }

      // The host cache can supply bytes for a displayed COS image without
      // asking the Canvas page to download the object again.
      if (!blob && (node.assetId || node.taskId)) {
        const cached = await readHostCachedImage({
          assetId: node.assetId,
          taskId: node.taskId,
          resultIndex: node.resultIndex,
        });
        if (cached?.image) blob = await imageDataBlob(cached.image);
      }

      if (!blob && displayedSource && /^(?:data|blob):/i.test(displayedSource)) {
        blob = await imageDataBlob(displayedSource);
      }

      if (!blob) {
        setMessage("图片已显示，但浏览器无法读取跨域图片像素，且本机缓存不可用。可尝试下载图片。", {
          label: "下载图片",
          run: () => { void downloadImage(node); },
        });
        return;
      }

      const png = await imageBlobAsPNG(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setMessage("图片已复制到剪贴板。", undefined, 2500);
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === "NotAllowedError"
        ? "浏览器拒绝写入剪贴板，请检查剪贴板权限。"
        : "图片复制失败，请检查图片是否可读取或尝试下载图片。", {
        label: "下载图片",
        run: () => { void downloadImage(node); },
      });
    } finally {
      closeMenus();
    }
  };
  const renameNode = (node: CanvasNode) => {
    const value = window.prompt("修改节点名称", node.title);
    if (value === null) return;
    const title = value.trim().slice(0, 160);
    if (!title || title === node.title) return;
    commit((document) => ({
      ...document,
      nodes: document.nodes.map((item) => item.id === node.id ? { ...item, title } : item),
    }));
    closeMenus();
  };
  const startEdit = (node: CanvasNode) => {
    editCancelled.current = false;
    setSelected([node.id]);
    setEditing(node.id);
    setEditText(node.text);
    closeMenus();
  };
  const reveal = (nodes: CanvasNode[], composer = false) => {
    if (!composer)
      return navigateView(
        fitViewport(nodes, boardSize, boardSize.width < 700 ? 45 : 100, 1),
      );
    // Keep the node and its screen-space composer visible together.
    const previewHeight = Math.max(140, boardSize.height - 430);
    const next = fitViewport(
      nodes,
      { width: boardSize.width, height: previewHeight },
      boardSize.width < 700 ? 28 : 55,
      1,
    );
    navigateView({ ...next, y: next.y + 72 });
  };
  const returnToCreatorFromAssetLibrary = React.useCallback(() => {
    const target = assetReferenceTarget.current;
    if (!target || target.documentId !== docRef.current.id) {
      assetReferenceTarget.current = undefined;
      setDrawer(null);
      return;
    }
    const creator = docRef.current.nodes.find(node => node.id === target.nodeId && node.type === "prompt");
    assetReferenceTarget.current = undefined;
    if (!creator) {
      setDrawer(null);
      return;
    }
    setSelected([creator.id]);
    setSelectedEdge(null);
    setEditing(null);
    setDrawer(null);
    setInspectorOpen(true);
    reveal([creator]);
  }, [reveal]);
  const add = (
    type: NodeType,
    at = picker?.world || centerPoint(),
    sourceId = picker?.sourceId,
    text = "",
    mediaType: MediaType = "image",
    continuationOf?: string,
  ) => {
    const width = type === "prompt" ? 480 : type === "image" ? 360 : type === "audio" ? DEFAULT_AUDIO_NODE_SIZE.width : W,
      height = type === "prompt" ? 270 : type === "image" ? 240 : type === "audio" ? DEFAULT_AUDIO_NODE_SIZE.height : H;
    const sourceNode = sourceId
      ? docRef.current.nodes.find((node) => node.id === sourceId)
      : undefined;
    const location = findFreePosition(docRef.current.nodes, {
      x: at.x - width / 2,
      y: at.y - height / 2,
      width,
      height,
    });
    const node: CanvasNode = {
      id: uid(type),
      type,
      title:
        type === "note"
          ? "文本节点"
          : type === "prompt"
            ? mediaType === "video" ? "视频创作" : mediaType === "audio" ? "音乐创作" : "图片创作"
            : type === "audio" ? "音频素材" : type === "video" ? "视频素材" : "图片素材",
      mediaType: type === "prompt" ? mediaType : undefined,
      continuationOf,
      // New workflow steps stay inside the same group as their source.
      groupId: sourceNode?.groupId,
      text,
      ...location,
      width,
      height,
      color: COLORS[type === "note" ? 0 : type === "prompt" ? 2 : type === "video" ? 4 : type === "audio" ? 3 : 1],
    };
    commit((value) => ({
      ...value,
      nodes: [...value.nodes, node],
      groups: node.groupId
        ? expandGroupFrames([...value.nodes, node], value.groups)
        : value.groups,
      edges:
        sourceId && value.nodes.some((n) => n.id === sourceId)
          ? [...value.edges, { id: uid("edge"), from: sourceId, to: node.id }]
          : value.edges,
    }));
    setSelected([node.id]);
    setReferenceRequest(0);
    setSelectedEdge(null);
    closeMenus();
    setDrawer(null);
    setEditing(null);
    setInspectorOpen(type === "prompt");
    if (type === "prompt") setCreatorFocusRequest((request) => request + 1);
    reveal([node], type === "prompt");
    if (type === "note") startEdit(node);
  };
  const addNext = (node: CanvasNode) => {
    setPreview(null);
    // One source asset owns one continuation task. Reuse it across repeated
    // clicks, including completed and failed tasks, so repeated generation
    // does not create a trail of duplicate prompt nodes.
    const mediaKind = assetType(node);
    if (mediaKind === "audio") {
      setMessage("音频暂不支持直接作为图片或视频创作输入。");
      return;
    }
    const expectedTitle = mediaKind === "video" ? "视频创作" : "图片创作";
    const candidates = docRef.current.nodes.filter((candidate) =>
      candidate.type === "prompt" &&
      (candidate.continuationOf === node.id ||
        (candidate.title === expectedTitle &&
          docRef.current.edges.some((edge) => edge.from === node.id && edge.to === candidate.id))),
    );
    // Prefer an unfinished task. If all tasks are terminal, reuse the latest
    // one so clicking Continue remains idempotent after a completed batch.
    const existing = candidates.find((candidate) => isPending(candidate)) || candidates.at(-1);
    if (existing) {
      setSelected([existing.id]);
      setInspectorOpen(true);
      setCreatorFocusRequest((request) => request + 1);
      setEditing(null);
      reveal([existing], true);
      return;
    }
    add(
      "prompt",
      { x: node.x + node.width + 250, y: node.y + 90 },
      node.id,
      mediaKind === "image" && hasMediaContent(node) ? node.text : "",
      mediaKind === "video" ? "video" : "image",
      node.id,
    );
  };
  const disconnect = (from: string, to: string) => {
    commit((value) => ({
      ...value,
      edges: value.edges.filter((e) => e.from !== from || e.to !== to),
      nodes: value.nodes.map(node => node.id === to && node.musicReference?.nodeId === from ? { ...node, musicReference: undefined } : node),
    }));
  };
  const locateNode = (id: string) => {
    setReferenceRequest(0);
    const node = docRef.current.nodes.find((n) => n.id === id);
    if (node) {
      setSelected([id]);
      const role = resolveCanvasNodeRole(node, docRef.current.nodes);
      const creator = role.kind === "creator" ? role.creator : null;
      const openEditor = Boolean(creator);
      setInspectorOpen(openEditor);
      reveal(creator ? [creator] : [node], openEditor);
    }
  };
  const downloadImage = async (node: CanvasNode) => {
    if (!node.image && !node.assetId && !node.localImage) return;
    setExportError("");
    try {
      const source = await resolveImageDownloadSource(node);
      if (!source) throw new Error("image");
      const response = await fetchCanvasResource(source, undefined, { gatewayURL: client.session()?.gateway_url });
      if (!response.ok) throw new Error("download");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.style.display = "none";
      a.download = /\.(png|jpe?g|webp)$/i.test(node.title)
        ? node.title
        : `${node.title || "image"}.${blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("图片已开始下载。", undefined, 2500);
    } catch {
      if (!docRef.current.nodes.some((candidate) => candidate.id === node.id)) return;
      setPreview(node);
      const message = "图片暂时无法下载，请重新打开原图后重试。";
      setExportError(message);
      setMessage(message);
    }
  };
  const downloadVideo = async (node: CanvasNode) => {
    if (!canLoadVideoContent(node)) return;
    setExportError("");
    try {
      const current = docRef.current.nodes.find(candidate => candidate.id === node.id) || node;
      const blob = await readVideoSourceBlob(client.api, videoDeliveryNode(current), {
        maxBytes: 500 * 1024 * 1024,
        fetchResource: (url, init) => fetchCanvasResource(String(url), init, { gatewayURL: client.session()?.gateway_url }),
      });
      const url = URL.createObjectURL(blob);
      const extension = blob.type.includes("webm") ? "webm" : blob.type.includes("quicktime") ? "mov" : blob.type.includes("ogg") ? "ogv" : "mp4";
      const a = document.createElement("a");
      a.href = url;
      a.download = `${node.title || "video"}.${extension}`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("视频已开始下载。", undefined, 2500);
    } catch { setExportError("视频暂时无法下载，请检查资产是否可用后重试。"); }
  };
  const downloadAudio = async (node: CanvasNode) => {
    if (!canLoadAudioContent(node)) return;
    setExportError("");
    try {
      const blob = await audioSources.read(docRef.current.nodes.find(value => value.id === node.id) || node);
      const url = URL.createObjectURL(blob);
      const mime = (blob.type || "").toLowerCase();
      const extension = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : mime.includes("webm") ? "webm" : mime.includes("aac") ? "aac" : mime.includes("flac") ? "flac" : "audio";
      const a = document.createElement("a");
      a.href = url;
      a.download = `${node.title || "audio"}.${extension}`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("音频已开始下载。", undefined, 2500);
    } catch { setExportError("音频暂时无法下载，请检查资产是否可用后重试。"); }
  };
  const validateAudio = async (node: CanvasNode) => {
    if (!canLoadAudioContent(node) || audioSources.loading.includes(node.id) || validatingAudioIds.has(node.id)) return;
    setValidatingAudioIds(current => new Set(current).add(node.id));
    try {
      const blob = await audioSources.read(docRef.current.nodes.find(value => value.id === node.id) || node);
      if (!docRef.current.nodes.some(value => value.id === node.id)) return;
      setMessage(`音频校验通过 · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`, undefined, 2500);
    } catch (error) {
      if (!docRef.current.nodes.some(value => value.id === node.id)) return;
      const message = error instanceof Error ? error.message : "音频校验失败，请重新加载后重试。";
      audioSources.fail(node.id, message);
      setMessage(message);
    } finally { setValidatingAudioIds(current => { if (!current.has(node.id)) return current; const next = new Set(current); next.delete(node.id); return next; }); }
  };
  const startAudioEdit = async (nodeId: string, range: { startTime: number; endTime: number }) => {
    const source = docRef.current.nodes.find(node => node.id === nodeId);
    if (!alive.current || leaving.current || !source || !canLoadAudioContent(source) || audioEditJobs.current.has(nodeId)) return;
    const request = { controller: new AbortController(), documentId: docRef.current.id, identity: audioSourceIdentity(source) };
    audioEditJobs.current.set(nodeId, request);
    clearAudioEditError(nodeId);
    setAudioEditBusyIds(current => new Set(current).add(nodeId));
    let localKey: string | undefined;
    let saved = false;
    const currentSource = () => {
      request.controller.signal.throwIfAborted();
      const live = docRef.current.nodes.find(node => node.id === nodeId);
      if (!alive.current || leaving.current || docRef.current.id !== request.documentId ||
        audioEditJobs.current.get(nodeId) !== request || pendingRemovalNodes.current.has(nodeId) ||
        !live || audioSourceIdentity(live) !== request.identity) {
        throw new DOMException("原音频或画布已变化，剪辑已停止。", "AbortError");
      }
      return live;
    };
    try {
      const input = await audioSources.read(currentSource(), request.controller.signal, MAX_AUDIO_EDIT_INPUT_BYTES);
      currentSource();
      const output = await exportAudioEdit(input, { ...range, signal: request.controller.signal });
      const current = currentSource();
      const outputFile = new File([output], `${displayNodeTitle(current)}-trim.wav`, { type: output.type || "audio/wav" });
      const [localResult, uploadResult] = await Promise.allSettled([
        storeLocalAudio(output),
        uploadPlatformAsset(client.api, { file: outputFile, name: outputFile.name, category: "sound" }),
      ]);
      localKey = localResult.status === "fulfilled" ? localResult.value : undefined;
      const uploaded = uploadResult.status === "fulfilled" ? uploadResult.value : undefined;
      if (!localKey && !uploaded) throw new Error("裁切片段未能保存到本机或云端，请检查存储空间和网络后重试。");
      currentSource();
      const size = DEFAULT_AUDIO_NODE_SIZE;
      const title = `${displayNodeTitle(current)} · 裁切`;
      const node: CanvasNode = {
        id: uid("audio"), type: "audio", mediaType: "audio", title: title.slice(0, 160),
        text: `裁切自「${displayNodeTitle(current)}」 ${range.startTime.toFixed(1)}s–${range.endTime.toFixed(1)}s`,
        ...findFreePosition(docRef.current.nodes, { x: current.x + current.width + 40, y: current.y, ...size }),
        ...size, color: current.color, groupId: current.groupId, status: "completed", resultOf: current.id,
        ...(localKey ? { localAudio: localKey } : {}), ...(uploaded?.url ? { audio: uploaded.url } : {}), ...(uploaded?.id ? { assetId: uploaded.id } : {}), audioMode: "recording", operationId: "audio-trim",
        operationParams: { sourceNodeId: current.id, startTime: range.startTime, endTime: range.endTime, mimeType: output.type, size: output.size },
      };
      commit(value => {
        const nodes = [...value.nodes, node];
        return { ...value, nodes, groups: expandGroupFrames(nodes, value.groups) };
      });
      saved = true;
      localKey = undefined;
      setSelected([node.id]);
      setSelectedEdge(null);
      setInspectorOpen(false);
      reveal([current, node]);
      setMessage(uploaded ? "已将裁切片段保存到素材库并添加为新节点，原音频保持不变。" : "已添加裁切片段；云端保存失败，当前仅保存在本机。", undefined, 3500);
    } catch (error) {
      if (audioEditJobs.current.get(nodeId) === request && !request.controller.signal.aborted &&
        !(error instanceof DOMException && error.name === "AbortError")) {
        setAudioEditErrors(current => ({ ...current, [nodeId]: error instanceof Error ? error.message : "音频剪辑失败，请重试。" }));
      }
    } finally {
      if (localKey && !saved) await deleteLocalAudio(localKey).catch(() => {});
      if (audioEditJobs.current.get(nodeId) === request) {
        audioEditJobs.current.delete(nodeId);
        setAudioEditBusyIds(current => { if (!current.has(nodeId)) return current; const next = new Set(current); next.delete(nodeId); return next; });
      }
    }
  };
  const arrange = () => {
    applyLayout(canvasPreferences.autoLayout, "all");
  };
  const prepareLeave = async () => {
    if (leaving.current) return false;
    (document.activeElement as HTMLElement | null)?.blur();
    cancelGesture();
    leaving.current = true;
    setNavigating(true);
    for (const controller of activeRequests.current.values())
      controller.abort();
    try {
      if (cloudSaveTimer.current !== null) {
        window.clearTimeout(cloudSaveTimer.current);
        cloudSaveTimer.current = null;
      }
      // The local write is the durability boundary for switching canvases.
      // Cloud sync is an additional delivery path and must not make a canvas
      // appear unsaved when the local snapshot has already been committed.
      // Waiting for the cloud request here used to turn transient network
      // failures into a blocking "尚未保存" error in the New Canvas dialog.
      const snapshot = clone(docRef.current);
      await persist(snapshot, false);
      if (syncEnabled && hydrated && platformReadyRef.current) {
        void syncSnapshot(snapshot).catch((error) => {
          if (alive.current) setMessage(`已保存到本机，但云端同步失败：${errorText(error)}`);
        });
      }
      return true;
    } catch (error) {
      leaving.current = false;
      setNavigating(false);
      setMessage(errorText(error));
      return false;
    }
  };
  const flush = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    viewportMotion.stop();
    const snapshot = clone(docRef.current);
    await persist(snapshot, false);
    return snapshot;
  };
  const agentAdapterRef = React.useRef<CanvasAgentAdapter | null>(null);
  agentAdapterRef.current = {
    getDocument: () => { if (!platformReadyRef.current) throw Object.assign(new Error("请先登录并打开画布"), { code: "CANVAS_NOT_READY", executionStarted: false, reason: "auth_required", retryable: false, nextAction: { type: "user_login" } }); return docRef.current; },
    beforeWrite: () => { (document.activeElement as HTMLElement | null)?.blur(); viewportMotion.stop(); },
    commit,
    persist: async (snapshot) => { await persist(snapshot, false); },
    canWrite: () => platformReadyRef.current && draftReady && !leaving.current && !removalTimer.current,
    getModels: () => models,
    isNodeBusy: (id) => activeRequests.current.has(id),
    imageSize: async (dataUrl) => {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(Object.assign(new Error("图片内容无法解码"), { code: "CANVAS_MEDIA_INVALID", executionStarted: false })); image.src = dataUrl; });
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64000000) mediaFailure("CANVAS_MEDIA_LIMIT", "图片不能超过 6400 万像素");
      return fitImageNodeSize(image.naturalWidth, image.naturalHeight);
    },
    readMedia: async (node, signal) => {
      checkLocalAccount(); signal.throwIfAborted();
      try {
        if (node.type === "audio" || node.mediaType === "audio") {
          const blob = await audioSources.read(node, signal, AGENT_MEDIA_MAX_BYTES);
          checkLocalAccount(); signal.throwIfAborted(); return blob;
        }
        if (node.type === "video" || node.mediaType === "video") {
          if (!canLoadVideoContent(node)) mediaFailure("CANVAS_MEDIA_UNAVAILABLE", "视频尚未生成完成或已不可用");
          const blob = await readVideoSourceBlob(client.api, videoDeliveryNode(node), {
            signal, maxBytes: AGENT_MEDIA_MAX_BYTES,
            fetchResource: (url, init) => fetchCanvasResource(String(url), init, { gatewayURL: client.session()?.gateway_url }),
          });
          checkLocalAccount(); signal.throwIfAborted();
          return blob;
        }
        let source = node.image || node.video || node.audio;
        if (!source && node.localImage && !node.assetId && !node.taskId) {
          const recoverable: { nodes: Array<{ image?: string; localImage?: string }> } = { nodes: [{ localImage: node.localImage }] };
          source = (await restoreLocalImages(recoverable)).nodes[0]?.image || source;
        }
        if (node.assetId && (!source || /^https?:/i.test(source))) source = (await readPlatformAsset(client.api, node.assetId)).url || source;
        if (!source || !/^(https?:|blob:|data:(?:image|video|audio)\/)/i.test(source)) mediaFailure("CANVAS_MEDIA_UNAVAILABLE", "媒体暂时无法读取，请在应用内恢复资源后重试");
        const response = await fetchCanvasResource(source!, { signal, credentials: "omit", referrerPolicy: "no-referrer" }, { gatewayURL: client.session()?.gateway_url });
        const blob = await boundedMediaBlob(response, signal);
        checkLocalAccount(); return blob;
      } catch (error) {
        signal.throwIfAborted(); checkLocalAccount();
        if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("CANVAS_MEDIA_")) throw error;
        if (error && typeof error === "object" && "code" in error && ["VIDEO_CONTENT_TOO_LARGE", "AUDIO_CONTENT_TOO_LARGE"].includes(String(error.code))) mediaFailure("CANVAS_MEDIA_LIMIT", "媒体大小超过本次导出的限制");
        return mediaFailure("CANVAS_MEDIA_UNAVAILABLE", "媒体暂时无法读取，请在应用内恢复资源后重试");
      }
    },
    resumeGeneration: (node) => {
      const completion = generate(node);
      void completion.catch(cause => setMessage(errorText(cause)));
      if (!activeRequests.current.has(node.id)) mediaFailure("CANVAS_TASK_NOT_RESUMABLE", "原任务暂时无法继续，请在应用内检查任务");
    },
    cancelGeneration: async (node, key, signal) => {
      checkLocalAccount(); signal.throwIfAborted();
      const documentId = docRef.current.id;
      if (node.mediaType === "audio") {
        if (isTTSNode(node)) mediaFailure("CANVAS_FEATURE_UNAVAILABLE", "画布暂不支持文本转语音。");
        const snapshot = await (isVoiceDesignNode(node) ? cancelVoiceDesign : cancelMusic)((path, init) => client.api.request(path, { ...init, signal }), node.taskId!, key);
        checkLocalAccount(); signal.throwIfAborted();
        const current = docRef.current.nodes.find(item => item.id === node.id);
        if (docRef.current.id !== documentId || !current || current.taskId !== node.taskId) throw Object.assign(new Error("任务已变化，请重新读取 read_tasks"), { code: "CANVAS_DOCUMENT_CHANGED" });
        const cancelled = ["cancelled", "canceled"].includes(snapshot.status);
        if (cancelled) activeRequests.current.get(node.id)?.abort("cancelled");
        patchTask(node.id, { status: cancelled ? "failed" : "queued", taskDiagnostic: { ...current.taskDiagnostic, status: snapshot.status, code: snapshot.code || undefined, phase: snapshot.phase } });
        if (!cancelled && !activeRequests.current.has(node.id)) void (isVoiceDesignNode(current) ? generateVoiceDesignTask(current) : generateMusicTask(current));
        return { status: snapshot.status || "unknown", cancelled };
      }
      const snapshot = await cancelVideo((path, init) => client.api.request(path, { ...init, signal }), node.taskId!, key);
      checkLocalAccount(); signal.throwIfAborted();
      const current = docRef.current.nodes.find(item => item.id === node.id);
      if (docRef.current.id !== documentId || !current || current.taskId !== node.taskId) throw Object.assign(new Error("任务已变化，请重新读取 read_tasks"), { code: "CANVAS_DOCUMENT_CHANGED" });
      const cancelled = ["cancelled", "canceled"].includes(snapshot.status);
      // Keep polling a cancellation acknowledgement; only a terminal provider response stops it.
      if (cancelled) activeRequests.current.get(node.id)?.abort("cancelled");
      if (!["completed", "succeeded", "success"].includes(snapshot.status)) patchTask(node.id, videoTaskSnapshotPatch(current, snapshot));
      if (!cancelled && !activeRequests.current.has(node.id)) void generateVideoTask(current);
      return { status: snapshot.status || "unknown", cancelled };
    },
    startGeneration: (node) => {
      const composition = composePrompt(docRef.current.nodes, docRef.current.edges, node.id);
      const references = node.ignoreImageRefs ? [] : composition.imageReferences;
      const kind = node.mediaType === "video" ? "video" : "image";
      if (node.mediaType === "audio") {
        if (isTTSNode(node)) mediaFailure("CANVAS_FEATURE_UNAVAILABLE", "画布暂不支持文本转语音。");
        const compatibleAudio = compatibleMusicModels(models as any);
        if (!composition.prompt.trim() || !node.modelId || !compatibleAudio.some(model => model.id === node.modelId)) throw Object.assign(new Error("请提供提示词及支持文字输入的音乐模型"), { code: "CANVAS_GENERATION_NOT_READY", executionStarted: false });
        const completion = generate(node); void completion.catch(cause => setMessage(errorText(cause)));
        if (!activeRequests.current.has(node.id)) throw Object.assign(new Error("生成任务未被接受"), { code: "CANVAS_GENERATION_NOT_READY", executionStarted: false });
        return;
      }
      const referenceCount = new Set(references.map(ref => ref.image || ref.localImage || ref.nodeId)).size;
      const selectedModel = preferredModelForNode(models, kind, referenceCount, node);
      // Agent generation keeps its explicit-model contract. The interactive
      // CreatorPanel may use the platform default, but agent callers must
      // choose and persist a model before starting a task.
      if (!composition.prompt.trim() || references.some(ref => !ref.image) || !node.modelId || !selectedModel) {
        throw Object.assign(new Error("请提供提示词及可用的明确模型，并确认参考图片已加载"), { code: "CANVAS_GENERATION_NOT_READY", executionStarted: false });
      }
      // Existing submission logic records the task identity synchronously,
      // persists it before network I/O and owns polling/recovery afterwards.
      const completion = generate(node);
      void completion.catch(cause => setMessage(errorText(cause)));
      if (!activeRequests.current.has(node.id)) throw Object.assign(new Error("生成任务未被接受"), { code: "CANVAS_GENERATION_NOT_READY", executionStarted: false });
    },
  };
  React.useEffect(() => {
    if (!platformReady || !draftReady) return;
    const capabilities = createCanvasAgent({
      getDocument: () => agentAdapterRef.current!.getDocument(),
      beforeWrite: () => agentAdapterRef.current!.beforeWrite(),
      commit: (change) => agentAdapterRef.current!.commit(change),
      persist: (snapshot) => agentAdapterRef.current!.persist(snapshot),
      canWrite: () => agentAdapterRef.current!.canWrite(),
      getModels: () => agentAdapterRef.current!.getModels!(),
      isNodeBusy: (id) => agentAdapterRef.current!.isNodeBusy!(id),
      startGeneration: (node) => agentAdapterRef.current!.startGeneration!(node),
      resumeGeneration: (node) => agentAdapterRef.current!.resumeGeneration!(node),
      cancelGeneration: (node, key, signal) => agentAdapterRef.current!.cancelGeneration!(node, key, signal),
      readMedia: (node, signal) => agentAdapterRef.current!.readMedia!(node, signal),
      imageSize: (source) => agentAdapterRef.current!.imageSize!(source),
    });
    return registerCanvasCapabilities(capabilities);
  }, [platformReady, draftReady]);
  React.useEffect(() => {
    if (!platformReady) return;
    return agent.setStatus({
      state: navigating ? "busy" : draftReady ? "ready" : "loading",
      reason: navigating ? "正在保存并离开当前画布" : draftReady ? "画布编辑器已就绪" : "正在恢复画布草稿",
      retryable: navigating || !draftReady,
      ...(navigating || !draftReady ? { nextAction: { type: "wait" as const } } : {}),
      context: { activeDocumentId: doc.id },
    }, { scope: "canvas.editor", priority: 10 });
  }, [platformReady, draftReady, navigating, doc.id]);
  // Keep the platform-facing editor handle stable while dispatching to the
  // latest render. Workspace should not lose its editor ref on every render.
  const editorHandlersRef = React.useRef<CanvasEditorHandle | null>(null);
  editorHandlersRef.current = {
    prepareLeave,
    flush,
    rename: async (name: string) => {
      (document.activeElement as HTMLElement | null)?.blur();
      commit((value) => ({ ...value, name }));
      await persist(docRef.current, false);
    },
    resume: () => {
      leaving.current = false;
      setNavigating(false);
    },
  };
  const editorHandle = React.useMemo<CanvasEditorHandle>(() => ({
    prepareLeave: () => editorHandlersRef.current!.prepareLeave(),
    flush: () => editorHandlersRef.current!.flush(),
    rename: (name: string) => editorHandlersRef.current!.rename(name),
    resume: () => editorHandlersRef.current!.resume(),
  }), []);
  React.useEffect(() => {
    registerEditor(editorHandle);
    return () => registerEditor(null);
  }, [editorHandle, registerEditor]);
  const save = async () => {
    const snapshot = docRef.current;
    setStatus("正在保存…");
    try {
      await persist(snapshot);
      if (docRef.current.updatedAt === snapshot.updatedAt)
        setStatus(savedStatus(syncEnabled && hydrated));
    } catch (error) {
      setStatus(
        lastLocalSave.current === snapshot.updatedAt
          ? syncFailureStatus()
          : "保存失败 · 请导出备份",
      );
      if (lastLocalSave.current !== snapshot.updatedAt) setMessage(errorText(error));
    }
  };
  const canSwitch = () => {
    if (activeRequests.current.size) {
      setMessage("请等当前生成完成后再切换画布；后台任务会继续处理。");
      return false;
    }
    return true;
  };
  const useCloud = async () => {
    if (!cloudCandidate || !canSwitch()) return;
    try {
      await rememberVersion(docRef.current);
      clearConnection();
      commit(() => clone(cloudCandidate));
      void refreshPersistedImageUrls();
      setSelected([]);
      setInspectorOpen(false);
      setSyncEnabled(true);
      setCloudCandidate(null);
      setOverlay(null);
      setMessage(isSessionOnlyStorage() ? "已恢复云端画布。切换前的版本在当前页面内可找回。" : "已恢复云端画布。原本机版本可在画布菜单中找回。");
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  const enableSync = async () => {
    if (!hydrated) {
      void refreshPlatform();
      return;
    }
    try {
      if (cloudCandidate) await rememberVersion(cloudCandidate);
      const snapshot = clone(docRef.current);
      await persist(snapshot, true);
      setSyncEnabled(true);
      setCloudCandidate(null);
      setOverlay(null);
      if (docRef.current.updatedAt === snapshot.updatedAt) setStatus(savedStatus(true));
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  const restorePrevious = async () => {
    if (!recovery || !canSwitch()) return;
    const previous = clone(recovery);
    try {
      await rememberVersion(docRef.current);
      commit(() => previous);
      void refreshPersistedImageUrls();
      setSelected([]);
      setInspectorOpen(false);
      closeMenus();
      setMessage("已恢复此画布的上一次版本，可撤销。");
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  const exportCanvas = () => {
    const value = docRef.current;
    if (
      value.nodes.some(
        (n) =>
          (n.localImage && !n.image) ||
          n.submission?.images.some((ref) => !ref.image),
      )
    ) {
      setExportError(
        "部分本地图片缺失。请重新上传，或明确导出不含缺失图片的画布。",
      );
      setOverlay("settings");
      return;
    }
    downloadDocument(value);
  };
  const downloadDocument = async (value: Document, partial = false) => {
    try {
      const packaged = await packageCanvasAudio(value, { partial });
      const videos = await packageCanvasVideo(packaged.document, { partial });
      const blob = new Blob(
        [JSON.stringify({ schema: "proxy.canvas/v3", ...videos.document, audioAssets: packaged.audioAssets, videoAssets: videos.videoAssets })],
        { type: "application/json" },
      );
      if (blob.size > 256 * 1024 * 1024) {
        setMessage("画布超过 256 MiB，请精简本机媒体后再导出。");
        return;
      }
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `${value.name || "canvas"}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      closeMenus();
      setExportError("");
      if (partial) setMessage(packaged.missing + videos.missing
        ? `已导出画布和可用本机媒体；${packaged.missing + videos.missing} 项文件缺失，备份保留其缓存引用，导入后需重新添加。`
        : "已导出可用内容和节点结构；缺失的图片仍需重新上传。");
    } catch (error) {
      setExportError(errorText(error));
      setOverlay("settings");
    }
  };
  const pickImage = (replace?: string, at = picker?.world || centerPoint()) => {
    imageDestination.current = { at, replace, sourceId: picker?.sourceId, documentId: docRef.current.id };
    if (file.current) file.current.accept = "image/png,image/jpeg,image/webp";
    file.current?.click();
    closeMenus();
  };
  const pickMedia = (at = picker?.world || centerPoint()) => {
    imageDestination.current = { at, sourceId: picker?.sourceId, documentId: docRef.current.id };
    if (file.current) file.current.accept = "image/*,video/*,audio/*";
    file.current?.click();
    closeMenus();
  };
  const pickVideoReplacement = (node: CanvasNode) => {
    const current = docRef.current.nodes.find(candidate => candidate.id === node.id);
    // A completed prompt can render as a video, but it must remain a creator.
    if (!current || current.type !== "video" || !sameVideoNodeSource(node, current)) return;
    imageDestination.current = {
      replace: current.id,
      at: { x: current.x + current.width / 2, y: current.y + current.height / 2 },
      documentId: docRef.current.id,
      videoReplacement: videoSources.current.capture(docRef.current.id, current),
    };
    if (file.current) file.current.accept = "video/mp4,video/webm,video/quicktime,video/ogg";
    file.current?.click();
    closeMenus();
  };
  const uploadNodeAsset = (node: CanvasNode) => {
    if (node.type === "image") {
      pickImage(node.id, {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      });
      return;
    }
    if (node.type === "video") {
      pickVideoReplacement(node);
      return;
    }
    if (node.type === "audio") {
      imageDestination.current = { replace: node.id, at: { x: node.x + node.width / 2, y: node.y + node.height / 2 } };
      if (file.current) file.current.accept = "image/*,video/*,audio/*";
      file.current?.click();
      closeMenus();
      return;
    }
    setMessage("该节点还没有可预览的媒体内容。请先完成创作或上传支持的素材。");
  };
  const uploadReference = (target: CanvasNode) => {
    imageDestination.current = {
      targetId: target.id,
      embeddedReference: true,
      at: { x: target.x - 270, y: target.y + target.height / 2 },
    };
    if (file.current) file.current.accept = target.mediaType === "video"
      ? "image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/mp4,audio/aac,audio/flac,video/mp4,video/webm,video/quicktime,video/ogg"
      : "image/png,image/jpeg,image/webp,image/gif";
    file.current?.click();
  };
  const openHandDraw = (target: CanvasNode) => {
    imageDestination.current = {
      targetId: target.id,
      embeddedReference: true,
      at: { x: target.x - 270, y: target.y + target.height / 2 },
    };
    setHandDrawTargetId(target.id);
  };
  const saveHandDraw = async (dataUrl: string) => {
    const target = handDrawTargetId ? docRef.current.nodes.find((node) => node.id === handDrawTargetId) : undefined;
    if (!target) { setMessage("原创作节点已删除，请重新选择节点添加参考图片。"); setHandDrawTargetId(null); return; }
    try {
      const response = await fetchCanvasResource(dataUrl, undefined, { gatewayURL: client.session()?.gateway_url });
      const blob = await response.blob();
      const file = new File([blob], `手绘参考-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      setHandDrawTargetId(null);
      importImage(file, { targetId: target.id, embeddedReference: true, at: { x: target.x - 270, y: target.y + target.height / 2 } });
    } catch { setMessage("手绘图片保存失败，请重试。"); }
  };
  const importImage = (input: File, destination = imageDestination.current) => {
    const documentId = destination?.documentId || docRef.current.id;
    const replacedNode = destination?.replace ? docRef.current.nodes.find(node => node.id === destination.replace) : undefined;
    const videoReplacement = destination?.videoReplacement || (replacedNode?.type === "video"
      ? videoSources.current.capture(documentId, replacedNode)
      : undefined);
    const isCurrentImport = () => alive.current && !leaving.current && docRef.current.id === documentId &&
      (!destination?.replace || docRef.current.nodes.some(node => node.id === destination.replace)) &&
      (!videoReplacement || videoSources.current.isCurrent(videoReplacement, docRef.current.id,
        docRef.current.nodes.find(node => node.id === videoReplacement.source.id)));
    if (!isCurrentImport()) return;
    const reportError = (message: string) => {
      if (!isCurrentImport()) return;
      setMessage(message);
    };
    const mediaType: MediaType = input.type.startsWith("image/") ? "image" : input.type.startsWith("video/") ? "video" : input.type.startsWith("audio/") ? "audio" : "image";
    const supportedImage = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(input.type);
    const supportedVideo = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"].includes(input.type);
    const supportedAudio = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac", "audio/flac"].includes(input.type);
    if (!(supportedImage || supportedVideo || supportedAudio))
      return reportError("支持 PNG、JPG、WEBP 图片，MP4、WEBM 视频和 MP3、WAV、OGG 音频");
    if (videoReplacement && !supportedVideo)
      return reportError("替换视频只支持 MP4、WEBM、MOV 或 OGG 视频，请选择视频文件。");
    if (destination?.targetId && mediaType !== "image" && !(mediaType === "video" && docRef.current.nodes.find(node => node.id === destination.targetId)?.mediaType === "video") && !(mediaType === "audio" && docRef.current.nodes.find(node => node.id === destination.targetId)?.mediaType === "video"))
      return reportError("图片模型只支持图片参考；视频模型可使用图片、音频或视频参考");
    const at = destination?.at || centerPoint();
    // Probe the file through a short-lived object URL first. Reading a large
    // video/audio file as Base64 before validation briefly duplicates its
    // memory footprint and is a common cause of local-upload failures.
    const probeSource = URL.createObjectURL(input);
    let probeReleased = false;
    const releaseProbe = () => {
      if (probeReleased) return;
      probeReleased = true;
      URL.revokeObjectURL(probeSource);
    };
    const readSource = (width: number, height: number, imageData?: string) => {
      if (!isCurrentImport()) return;
      const localSave = mediaType === "audio" ? storeLocalAudio(input)
        : mediaType === "video" ? storeLocalVideo(input)
          : Promise.resolve(imageData);
      void Promise.allSettled([localSave, uploadPlatformAsset(client.api, { file: input, name: input.name, category: mediaType === "audio" ? "sound" : "other" })]).then(([localResult, uploadResult]) => {
        const localSource = localResult.status === "fulfilled" ? localResult.value : undefined;
        const uploaded = uploadResult.status === "fulfilled" ? uploadResult.value : undefined;
        const cloudError = uploadResult.status === "rejected" ? uploadResult.reason : undefined;
        if (!localSource && !uploaded) {
          reportError(cloudError ? errorText(cloudError) : "素材未能保存到本机或云端，请检查存储空间和网络后重试。");
          return;
        }
        if (!isCurrentImport()) {
          if (typeof localSource === "string" && isLocalAudioKey(localSource)) void deleteLocalAudio(localSource).catch(() => {});
          if (typeof localSource === "string" && isLocalVideoKey(localSource)) void deleteLocalVideo(localSource).catch(() => {});
          return;
        }
        // Cloud assets are the canonical source for imported images. Keep the
        // IndexedDB key only as a local fallback; cards can use the signed
        // thumbnail while the gallery resolves the original asset URL.
        const source = mediaType === "image" && uploaded?.url
          ? uploaded.url
          : typeof localSource === "string" ? localSource : uploaded?.url || "";
        finish(width, height, source, uploaded, cloudError);
      });
    };
    const finish = (width: number, height: number, source: string, uploaded?: StoredAsset, cloudError?: unknown) => {
      if (!isCurrentImport()) return;
        // File uploads from the creator panel are an explicit reference
        // attachment, not a canvas wire connection. A prompt may already
        // have a generated result (and therefore no longer accept new wire
        // connections) while still accepting another reference image.
        const target = destination?.targetId
          ? docRef.current.nodes.find((node) => node.id === destination.targetId)
          : undefined;
        if (destination?.targetId && !target) {
          setMessage("原创作节点已删除，请重新选择节点添加参考图片。");
          return;
        }
        if (destination?.targetId && target?.type !== "prompt") {
          setMessage("当前节点不支持添加创作参考图片，请重新选择创作节点。");
          return;
        }
        if (destination?.embeddedReference && target?.type === "prompt" && (mediaType === "image" || mediaType === "video" || mediaType === "audio")) {
          const reference = {
            id: uid("reference"),
            title: input.name,
            mediaType,
            ...(mediaType === "image" ? { image: source, ...(uploaded?.thumbnail_url ? { imageThumbnail: uploaded.thumbnail_url } : {}) } : mediaType === "video"
              ? { ...(isLocalVideoKey(source) ? { localVideo: source } : {}), ...(uploaded?.url ? { video: uploaded.url, videoContentUrl: uploaded.url, videoContentUrlExpiresAt: uploaded.url_expires_at } : !isLocalVideoKey(source) ? { video: source } : {}) }
              : { ...(isLocalAudioKey(source) ? { localAudio: source } : {}), ...(uploaded?.url ? { audio: uploaded.url } : !isLocalAudioKey(source) ? { audio: source } : {}) }),
            ...(uploaded?.id ? { assetId: uploaded.id } : {}),
          };
          commit((value) => ({
            ...value,
            nodes: value.nodes.map((item) => item.id === target.id
              ? { ...item, ignoreImageRefs: false, embeddedReferences: [...(item.embeddedReferences || []), reference] }
              : item),
          }));
          setSelected([target.id]);
          setInspectorOpen(true);
          setSelectedEdge(null);
          if (!uploaded) setMessage(isStorageQuotaError(cloudError) ? errorText(cloudError) : "云端保存失败，该参考素材仅保存在本机，换设备后无法恢复。");
          return;
        }
        const size = mediaType === "image" ? fitImageNodeSize(width, height) : mediaType === "video" ? fitImageNodeSize(width || 16, height || 9) : DEFAULT_AUDIO_NODE_SIZE;
        const existing =
          destination?.replace &&
          docRef.current.nodes.find((node) => node.id === destination.replace);
        const sourceNode = destination?.sourceId
          ? docRef.current.nodes.find((node) => node.id === destination.sourceId)
          : undefined;
        if (existing && videoReplacement) {
          const replacement = replaceVideoNodeMedia(existing, {
            ...(isLocalVideoKey(source) ? { localVideo: source } : {}),
            ...(uploaded?.url ? { video: uploaded.url, videoContentUrl: uploaded.url, videoContentUrlExpiresAt: uploaded.url_expires_at } : !isLocalVideoKey(source) ? { video: source } : {}),
            ...(uploaded?.id ? { assetId: uploaded.id } : {}),
            title: input.name,
            ...size,
          });
          // Invalidate before committing, including identical-file replacements,
          // so an earlier decoder or import cannot put the old source back.
          clearVideoNodeRuntime(existing.id);
          commit(value => {
            const nodes = value.nodes.map(node => node.id === existing.id ? replacement : node);
            return {
              ...value,
              nodes,
              // An uploaded replacement is no longer an output of the old
              // creator. Downstream references remain attached to this node.
              edges: value.edges.filter(edge => edge.to !== existing.id),
              groups: expandGroupFrames(nodes, value.groups),
            };
          });
          setPreview(active => active?.id === existing.id ? replacement : active);
          setSelected([existing.id]);
        } else if (existing)
          update([existing.id], {
            ...(mediaType === "image" ? { image: source, imageThumbnail: uploaded?.thumbnail_url, localImage: undefined, video: undefined, localVideo: undefined, audio: undefined, localAudio: undefined } : mediaType === "video"
              ? { ...(isLocalVideoKey(source) ? { localVideo: source } : { localVideo: undefined }), ...(uploaded?.url ? { video: uploaded.url, videoContentUrl: uploaded.url, videoContentUrlExpiresAt: uploaded.url_expires_at } : !isLocalVideoKey(source) ? { video: source, videoContentUrl: undefined, videoContentUrlExpiresAt: undefined } : {}), image: undefined, imageThumbnail: undefined, localImage: undefined, audio: undefined, localAudio: undefined, taskId: undefined, status: "completed" }
              : { ...(isLocalAudioKey(source) ? { localAudio: source } : { localAudio: undefined }), ...(uploaded?.url ? { audio: uploaded.url } : !isLocalAudioKey(source) ? { audio: source } : {}), image: undefined, imageThumbnail: undefined, localImage: undefined, video: undefined, videoContentUrl: undefined, localVideo: undefined, videoContentUrlExpiresAt: undefined, taskId: undefined, audioTaskType: undefined, voiceId: undefined, musicSubmission: undefined, voiceDesignSubmission: undefined, ttsSubmission: undefined, status: "completed" }),
            assetId: uploaded?.id,
            width: size.width,
            height: size.height,
            title: input.name,
            type: mediaType,
          });
        else {
          const node: CanvasNode = {
            id: uid(mediaType),
            type: mediaType,
            title: input.name,
            text: "",
            ...findFreePosition(docRef.current.nodes, {
              x: at.x - size.width / 2,
              y: at.y - size.height / 2,
              width: size.width,
              height: size.height,
            }),
            width: size.width,
            height: size.height,
            color: mediaType === "image" ? COLORS[1] : mediaType === "video" ? COLORS[4] : COLORS[3],
            ...(mediaType === "image" ? { image: source, ...(uploaded?.thumbnail_url ? { imageThumbnail: uploaded.thumbnail_url } : {}) } : mediaType === "video"
              ? { ...(isLocalVideoKey(source) ? { localVideo: source } : {}), ...(uploaded?.url ? { video: uploaded.url, videoContentUrl: uploaded.url, videoContentUrlExpiresAt: uploaded.url_expires_at } : !isLocalVideoKey(source) ? { video: source } : {}), status: "completed" as const }
              : { ...(isLocalAudioKey(source) ? { localAudio: source } : {}), ...(uploaded?.url ? { audio: uploaded.url } : !isLocalAudioKey(source) ? { audio: source } : {}), status: "completed" as const }),
            ...(uploaded?.id ? { assetId: uploaded.id } : {}),
            // Imported references are part of the same workspace as the
            // creator they are attached to, so they do not visually escape
            // an existing group.
            groupId: target?.groupId || sourceNode?.groupId,
          };
          commit((value) => ({
            ...value,
            nodes: [
              ...value.nodes.map((item) =>
                item.id === target?.id
                  ? { ...item, ignoreImageRefs: false }
                  : item,
              ),
              node,
            ],
            groups: node.groupId
              ? expandGroupFrames([
                  ...value.nodes.map((item) => item.id === target?.id ? { ...item, ignoreImageRefs: false } : item),
                  node,
                ], value.groups)
              : value.groups,
            edges: target
              ? [
                  ...value.edges,
                  { id: uid("edge"), from: node.id, to: target.id },
                ]
              : destination?.sourceId &&
                  value.nodes.some(
                    (source) => source.id === destination.sourceId,
                  )
                ? [
                    ...value.edges,
                    {
                      id: uid("edge"),
                      from: destination.sourceId,
                      to: node.id,
                    },
                  ]
                : value.edges,
          }));
          if (target) {
            setSelected([target.id]);
            setInspectorOpen(true);
          } else {
            setSelected([node.id]);
            reveal([node]);
          }
        }
        if (!target) setInspectorOpen(false);
        setSelectedEdge(null);
        if (!uploaded) setMessage(isStorageQuotaError(cloudError) ? errorText(cloudError) : "云端保存失败，该素材仅保存在本机，换设备后无法恢复。");
      };
    if (mediaType === "image") {
      const probe = new Image();
      probe.onload = () => {
        releaseProbe();
        const reader = new FileReader();
        reader.onload = () => readSource(probe.naturalWidth, probe.naturalHeight, String(reader.result));
        reader.onerror = () => reportError("读取图片失败，请重试或选择另一张图片。");
        reader.onabort = () => reportError("本地上传已取消，请重试。");
        reader.readAsDataURL(input);
      };
      probe.onerror = () => { releaseProbe(); reportError("无法解码此图片，请选择另一张图片。"); };
      probe.src = probeSource;
    } else {
      const probe = document.createElement(mediaType);
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        releaseProbe();
        if (mediaType === "video") {
          const video = probe as HTMLVideoElement;
          readSource(video.videoWidth, video.videoHeight);
        } else readSource(420, 150);
      };
      probe.onerror = () => { releaseProbe(); reportError(`无法读取此${mediaType === "video" ? "视频" : "音频"}，请选择另一份文件。`); };
      probe.src = probeSource;
    }
  };
  const reportTaskFailure = (node: CanvasNode, error: unknown, submissionKey?: string) => {
    const current = docRef.current.nodes.find(item => item.id === node.id);
    const requiresConfirmation = canvasTaskRetryPolicy(current || node).requiresConfirmation;
    const notice = notificationGate.current.generation({ canvasId: docRef.current.id, nodeId: node.id, title: node.title, outcome: "failed", taskId: current?.taskId, submissionKey,
      failureText: `「${node.title}」生成失败${isStorageQuotaError(error) ? "：媒体空间已用完" : requiresConfirmation ? "，暂时无法重试，可继续编辑内容" : "，可调整输入后重试"}。` }, preferencesRef.current);
    if (!notice) return;
    const context = taskFeedbackContext.current;
    // The selected node shows its failure status; details remain available in task records.
    if (context.selected.length === 1 && context.selected[0] === node.id
      && context.inspectorMode && !context.overlay && !context.preview) return;
    setMessage(notice.text);
  };
  const syncFailedVideoTask = async (node: CanvasNode) => {
    if (node.mediaType !== "video" || !node.taskId || pendingRemovalNodes.current.has(node.id)) return;
    const documentId = docRef.current.id;
    const checkKey = taskRecoveryKey(documentId, node.id, node.taskId);
    if (taskStatusChecks.current.has(checkKey) || activeRequests.current.has(node.id)) return;
    taskStatusChecks.current.add(checkKey);
    try {
      checkLocalAccount();
      const snapshot = await readVideoTask((path, init) => client.api.request(path, init), node.taskId);
      checkLocalAccount();
      const current = docRef.current.nodes.find(item => item.id === node.id);
      if (!alive.current || leaving.current || pendingRemovalNodes.current.has(node.id) ||
        docRef.current.id !== documentId || !current || current.taskId !== snapshot.taskId) return;
      const patch = videoTaskSnapshotPatch(current, snapshot);
      // The snapshot patch includes the asset identity and its delivery expiry.
      if (Object.keys(patch).length) {
        patchTask(node.id, patch);
        await persist(docRef.current, false);
      }
    } catch {
      // Opening a failed task only refreshes its durable state. A failed read
      // preserves the existing failure and never creates another user status.
    } finally {
      taskStatusChecks.current.delete(checkKey);
    }
  };
  const generateImageTask = async (requested = primary, inputChanged = false) => {
    if (!requested || leaving.current || pendingRemovalNodes.current.has(requested.id)) return;
    const node = docRef.current.nodes.find((n) => n.id === requested.id);
    if (!node || node.type !== "prompt" || activeRequests.current.has(node.id))
      return;
    const resumable = hasPendingNodeTask(node);
    const retryPolicy = canvasTaskRetryPolicy(node);
    if (!resumable && !canCreateNewCanvasTask(node, inputChanged)) {
      if (retryPolicy.requiresConfirmation) setMessage(retryPolicy.reason === "reconciliation_expired"
        ? "原任务结果未确认，原样重试已关闭。修改提示词、参考图或参数后可创建新的生成任务。"
        : "原任务结果仍在核对中，暂不能提交新的任务。");
      return;
    }
    const taskId = node.taskId && resumable ? node.taskId : undefined;
    const previousSubmission =
      !taskId && resumable
        ? node.submission
        : undefined;
    const composition = composePrompt(
      docRef.current.nodes,
      docRef.current.edges,
      node.id,
    );
    const effectivePrompt =
      previousSubmission?.prompt ||
      (taskId && node.taskPrompt ? node.taskPrompt : composition.prompt);
    const references = node.ignoreImageRefs ? [] : composition.imageReferences;
    const referenceCount = new Set(references.map(ref => ref.image || ref.localImage || ref.nodeId)).size;
    const selectedModel = preferredModelForNode(models, "image", referenceCount, node);
    // Resolve catalog defaults before freezing the submission. This keeps the
    // value shown by the quantity dropdown identical to the request sent to
    // the image API, even when the user never touches the control.
    const resolvedImageSettings = resolveImageSettings(selectedModel, node.imageSettings);
    const reason = !composition.prompt.trim()
      ? "请先填写画面描述，或连接文本节点。"
      : references.some((ref) => !ref.image)
        ? "参考图片尚未恢复，请重新上传或改为仅使用文字。"
        : !selectedModel
          ? "没有符合当前创作方式的模型，请重新检测模型或调整参考图。"
          : mediaReferenceLimit(selectedModel) &&
              new Set(references.map((ref) => ref.image || ref.localImage || ref.nodeId)).size >
                mediaReferenceLimit(selectedModel)!
            ? `模型最多支持 ${mediaReferenceLimit(selectedModel)} 张参考图。`
            : "";
    if (!taskId && !previousSubmission && reason) {
      setCreationError({ id: node.id, message: reason });
      setInspectorOpen(true);
      return;
    }
    if (previousSubmission?.images.some((ref) => !ref.image)) {
      patchTask(node.id, {
        error: "原提交的参考图片缺失，请在原浏览器或完整备份中恢复后继续。",
      });
      return;
    }
    const generationBatchId =
      node.generationBatchId || previousSubmission?.resultBatchId || uid("image-batch");
    const submission = taskId
      ? undefined
      : previousSubmission || {
          key: uid("canvas-submit"),
          model: selectedModel!.id!,
          prompt: effectivePrompt,
          images: references.map(({ image, localImage }) => ({
            image,
            localImage,
          })),
          count: resolvedImageSettings.count,
          size: resolvedImageSettings.size,
          resolution: resolvedImageSettings.resolution,
          quality: resolvedImageSettings.quality,
          aspectRatio: resolvedImageSettings.aspectRatio,
          ...(resolvedImageSettings.outputFormat ? { outputFormat: resolvedImageSettings.outputFormat } : {}),
          resultBatchId: generationBatchId,
          responseFormat: "url" as const,
        };
    const controller = new AbortController();
    activeRequests.current.set(node.id, controller);
    const currentRequestNode = () => {
      if (!alive.current || leaving.current || controller.signal.aborted ||
        pendingRemovalNodes.current.has(node.id) ||
        activeRequests.current.get(node.id) !== controller) return undefined;
      return docRef.current.nodes.find((candidate) => candidate.id === node.id);
    };
    setActiveIds((ids) => [...ids, node.id]);
    setCreationError(null);
    setReferenceRequest(0);
    patchTask(node.id, {
      status: "running",
      taskId,
      error: undefined,
      taskPrompt: effectivePrompt,
      generationBatchId,
      // A fresh submission must not inherit an unknown/failed observation
      // from an older task. Resumed submissions keep the original diagnosis
      // so its task identity remains available during reconciliation.
      taskDiagnostic: taskId || previousSubmission ? node.taskDiagnostic : undefined,
      inputSignature:
        taskId || previousSubmission
          ? node.inputSignature
          : creationInputSignature({
              prompt: effectivePrompt,
              model: submission!.model,
              references: composition.imageReferences,
              ignoreImageRefs: node.ignoreImageRefs,
              settings: resolvedImageSettings,
            }),
      submission,
      ...(!taskId && !previousSubmission && selectedModel?.id
        ? { modelId: selectedModel.id, modelSelection: node.modelSelection === "user" ? "user" as const : "default" as const, imageSettings: resolvedImageSettings }
        : {}),
    });
    if (!taskId && !previousSubmission && preferencesRef.current.clearFocusAfterSubmit) {
      setSelected([]); setInspectorMode(null);
    }
    try {
      // Persist the request identity and exact inputs before any network submission.
      await persist(docRef.current, false);
      if (!currentRequestNode()) return;
      const result = await generateImage(
        (path, init) => {
          if (!platformReadyRef.current)
            throw Object.assign(new Error("请重新登录后继续创作。"), {
              code: "APP_LOGIN_REQUIRED",
            });
          return client.api.request(path, init);
        },
        {
          model: submission?.model || node.modelId || "",
          prompt: effectivePrompt,
          images: submission?.images.map((ref) => ref.image!),
          count: submission?.count ?? resolvedImageSettings.count,
          size: submission?.size ?? resolvedImageSettings.size,
          resolutionTier: submission?.resolution ?? resolvedImageSettings.resolution,
          qualityMode: submission?.quality ?? resolvedImageSettings.quality,
          aspectRatio: submission?.aspectRatio ?? resolvedImageSettings.aspectRatio,
          outputFormat: submission?.outputFormat ?? resolvedImageSettings.outputFormat,
          responseFormat: submission?.responseFormat,
          idempotencyKey: submission?.key,
          taskId,
        },
        (id) => {
          if (!currentRequestNode()) return;
          patchTask(node.id, {
            taskId: id,
            status: "running",
            submission: undefined,
          });
          return persist(docRef.current, false);
        },
        {
          signal: controller.signal,
          // A restored frozen submission must be looked up before replaying
          // its creation request. New submissions do not pay for a lookup.
          recovery: previousSubmission
            ? { inputReferencesAvailable: !previousSubmission.images.some((ref) => !ref.image) }
            : undefined,
        },
      );
      const source = currentRequestNode();
      if (!source) return;
      // Ignore malformed empty entries from a provider. Creating a node for an
      // empty payload is what previously left blank result cards behind.
      const outputImages = (result.images?.length ? result.images : [result.image]).filter(
        (image): image is string => typeof image === "string" && image.trim().length > 0,
      );
      if (!outputImages.length) throw new Error("生成完成但没有可用图片结果");
      // Geometry probing must use the signed preview. The original URL is
      // retained for detail/download only and must never be fetched as a side
      // effect of placing a result card.
      const outputSizes = await Promise.all(outputImages.map((image, index) => {
        const thumbnail = result.thumbnails?.[index];
        if (thumbnail) return readImageNodeSize(thumbnail);
        return isCosImageURL(image) ? Promise.resolve(fitImageNodeSize(480, 480)) : readImageNodeSize(image);
      }));
      if (!currentRequestNode()) return;
      // Every submission gets a fresh batch. A single output is written back to
      // the creator; a multi-output batch gets independent asset nodes.
      const occupied: Array<{ x: number; y: number; width: number; height: number }> =
        docRef.current.nodes.map(({ x, y, width, height }) => ({ x, y, width, height }));
      const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(outputImages.length))));
      const rows = Math.ceil(outputImages.length / columns);
      const columnWidths = Array.from({ length: columns }, (_, column) =>
        Math.max(...outputSizes.filter((_, index) => index % columns === column).map((size) => size.width)),
      );
      const rowHeights = Array.from({ length: rows }, (_, row) =>
        Math.max(...outputSizes.filter((_, index) => Math.floor(index / columns) === row).map((size) => size.height)),
      );
      const batchWidth = columnWidths.reduce((sum, value) => sum + value, 0) + (columns - 1) * 32;
      const batchHeight = rowHeights.reduce((sum, value) => sum + value, 0) + (rows - 1) * 32;
      // Reserve the whole result grid in one pass. Placing each card with an
      // independent collision search could scatter a batch around unrelated
      // nodes, which made its source edges cross through other cards.
      const batchPosition = findFreePosition(occupied, {
        x: source.x + source.width + 100,
        y: source.y,
        width: batchWidth,
        height: batchHeight,
      });
      // A grouped creator owns its generated assets. Only an ungrouped
      // multi-output task needs a new generated-result group of its own.
      const outputGroupId = source.groupId ||
        (outputImages.length > 1 ? generationBatchId : undefined);
      const outputs = outputImages.map((image, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const xOffset = columnWidths.slice(0, column).reduce((sum, value) => sum + value + 32, 0);
        const yOffset = rowHeights.slice(0, row).reduce((sum, value) => sum + value + 32, 0);
        const size = outputSizes[index];
        const position = {
          x: batchPosition.x + xOffset,
          y: batchPosition.y + yOffset,
        };
        return {
          id: uid("image"), type: "image" as const,
          title: `${node.title} · 结果${outputImages.length > 1 ? ` ${index + 1}` : ""}`,
          resultOf: node.id,
          resultIndex: index,
          resultBatchId: generationBatchId,
          groupId: outputGroupId,
          text: effectivePrompt,
          ...position,
          width: size.width, height: size.height, color: COLORS[1], image,
          ...(result.thumbnails?.[index] ? { imageThumbnail: result.thumbnails[index] } : {}),
          ...(result.taskId ? { taskId: result.taskId } : {}),
          ...(result.assetIds?.[index] ? { assetId: result.assetIds[index] } : {}),
          status: "completed" as const,
        };
      });
      commit((value) => {
        const oldResultIds = new Set(
          outputImages.length === 1
            ? value.nodes
                .filter((candidate) => isGeneratedResult(node.id, candidate, value.edges, node.title))
                .map((candidate) => candidate.id)
            : [],
        );
        const nextNodes = value.nodes
          .filter((candidate) => !oldResultIds.has(candidate.id))
          .map((n) => {
            if (n.id !== node.id) return n;
            const next = {
              ...n,
              status: "completed" as const,
              error: undefined,
              submission: undefined,
              generationBatchId: undefined,
              taskDiagnostic: { ...n.taskDiagnostic, status: "completed", phase: "completed", assetStatus: "ready", supplierConfirmation: undefined, code: undefined },
            };
            // A new generation owns new bytes even when the creator node is
            // reused. Never let its previous local cache mask the new result.
            delete next.localImage;
            if (outputImages.length === 1) {
              next.image = outputImages[0];
              if (result.thumbnails?.[0]) next.imageThumbnail = result.thumbnails[0];
              else delete next.imageThumbnail;
              if (result.taskId) next.taskId = result.taskId;
              if (result.assetIds?.[0]) next.assetId = result.assetIds[0];
              else delete next.assetId;
              next.resultBatchId = generationBatchId;
              next.resultIndex = 0;
              delete next.video;
              delete next.videoContentUrl;
              delete next.videoContentUrlExpiresAt;
            } else {
              delete next.image;
              delete next.imageThumbnail;
              delete next.assetId;
              next.resultBatchId = generationBatchId;
              delete next.resultIndex;
            }
            return next;
          });
        const nextEdges = value.edges.filter((edge) => !oldResultIds.has(edge.from) && !oldResultIds.has(edge.to));
        const groupedNodes = outputImages.length > 1 ? [...nextNodes, ...outputs] : nextNodes;
        const nextGroups = normalizeGroupFrames(groupedNodes, value.groups).map((frame) =>
          frame.id === outputGroupId
            ? expandFrameToNodes(frame, groupedNodes.filter((candidate) => candidate.groupId === frame.id))
            : frame,
        );
        return {
          ...value,
          nodes: groupedNodes,
          edges: outputImages.length === 1 ? nextEdges : uniqueResultEdges(node.id, outputs, nextEdges),
          groups: nextGroups,
        };
      });
      if (!preferencesRef.current.clearFocusAfterSubmit && outputImages.length > 1) {
        // The creator task is now task metadata; select the result group so
        // the user lands on the actual assets instead of a hidden middle card.
        setSelected([outputs[0].id]);
      } else if (!preferencesRef.current.clearFocusAfterSubmit) {
        setSelected([node.id]);
      }
      void persist(docRef.current, false)
        .then(() => refreshPersistedImageUrls())
        .catch(() => setStatus("图片已生成 · 保存失败，请导出备份"));
      if (overlay === "settings") void loadStorage();
      setInspectorMode(null);
      setCreationError(null);
      const completionSelection = preferencesRef.current.clearFocusAfterSubmit
        ? taskFeedbackContext.current.selected
        : outputImages.length > 1 ? [outputs[0].id] : [node.id];
      const completionResults: Array<Pick<CanvasNode, "id" | "x" | "y" | "width" | "height">> = outputImages.length > 1 ? outputs : [source];
      const notice = notificationGate.current.generation({ canvasId: docRef.current.id, nodeId: node.id, title: node.title, outcome: "completed", taskId: result.taskId, submissionKey: submission?.key }, preferencesRef.current, completionNoticeContext(completionResults, completionSelection));
      if (notice) setMessage(notice.text, undefined, 3500);
    } catch (error) {
      // A deleted node owns no longer owns its request. Abort is local: the
      // provider may still finish, but its result must be ignored silently.
      if (!alive.current || leaving.current || controller.signal.reason === "deleted" ||
        pendingRemovalNodes.current.has(node.id) ||
        !docRef.current.nodes.some((candidate) => candidate.id === node.id) ||
        activeRequests.current.get(node.id) !== controller) return;
      const failure = platformFailure(error);
      if (failure.kind === "login") requireAuthentication(failure.message);
      if (isStorageQuotaError(error)) {
        if (overlay === "settings") void loadStorage();
        setOverlay("settings");
      }
      const pending =
        error instanceof ImageGenerationError
          ? error.pending || Boolean(previousSubmission && !error.terminalTask)
          : Boolean(taskId || previousSubmission);
      const imageError = error instanceof ImageGenerationError;
      const currentTaskDiagnostic = docRef.current.nodes.find(item => item.id === node.id)?.taskDiagnostic;
      patchTask(node.id, {
        status: pending ? "queued" : "failed",
        ...(!pending ? { submission: undefined } : {}),
        ...(!pending ? { generationBatchId: undefined } : {}),
        error: errorText(error),
        ...(imageError && error.taskId ? { taskId: error.taskId } : {}),
        ...(imageError ? {
          taskDiagnostic: {
            ...currentTaskDiagnostic,
            code: error.code || currentTaskDiagnostic?.code,
            ...(error.requestId ? { requestId: error.requestId } : {}),
            ...(error.status ? { status: error.status } : {}),
            ...(error.terminalTask && !error.status ? { status: "failed" } : {}),
          },
        } : {}),
      });
      if (!pending) reportTaskFailure(node, error, submission?.key);
    } finally {
      if (activeRequests.current.get(node.id) === controller) {
        activeRequests.current.delete(node.id);
        if (alive.current) setActiveIds((ids) => ids.filter((id) => id !== node.id));
      }
    }
  };
  const generateVideoTask = async (requested = primary, inputChanged = false) => {
    if (!requested || leaving.current || pendingRemovalNodes.current.has(requested.id)) return;
    const node = docRef.current.nodes.find((n) => n.id === requested.id);
    if (!node || node.type !== "prompt" || node.mediaType !== "video") return;
    if (activeRequests.current.has(node.id)) return;
    const resumable = hasPendingNodeTask(node);
    const retryPolicy = canvasTaskRetryPolicy(node);
    if (!resumable && !canCreateNewCanvasTask(node, inputChanged)) {
      if (retryPolicy.requiresConfirmation) setMessage(retryPolicy.reason === "reconciliation_expired"
        ? "原任务结果未确认，原样重试已关闭。修改提示词、参考图或参数后可创建新的生成任务。"
        : "原任务结果仍在核对中，暂不能提交新的任务。");
      return;
    }
    const taskId = node.taskId && resumable ? node.taskId : undefined;
    // A local input-recovery failure keeps its frozen identity. Even after
    // the node displays failure, check the original submission before replay.
    const previousSubmission = !taskId && resumable ? node.videoSubmission : undefined;
    const composition = composePrompt(docRef.current.nodes, docRef.current.edges, node.id);
    const effectivePrompt = previousSubmission?.prompt || (taskId && node.taskPrompt ? node.taskPrompt : composition.prompt);
    const references = node.ignoreImageRefs ? [] : composition.imageReferences;
    const videoReferences = node.ignoreImageRefs ? [] : composition.videoReferences;
    const sourceImageReferences = previousSubmission?.images || references.map(({ image, localImage, assetId }) => ({ image, localImage, assetId }));
    let resolvedImageReferences = sourceImageReferences;
    let imageReferenceError = "";
    if (!taskId && !previousSubmission && sourceImageReferences.some(reference => reference.assetId && !reference.image)) {
      try {
        resolvedImageReferences = await Promise.all(sourceImageReferences.map(async reference => {
          if (reference.image || !reference.assetId) return reference;
          const asset = await readPlatformAsset(client.api, reference.assetId);
          if (asset.storedAsset.type !== "image" || !asset.url) throw new Error("参考图片无法恢复，请从素材库重新选择。");
          return { ...reference, image: asset.url };
        }));
      } catch (error) {
        imageReferenceError = error instanceof Error ? error.message : "参考图片暂不可用，请重新加载后重试。";
      }
    }
    // A restored video asset can retain only its stable asset ID after a
    // signed delivery URL expires. Resolve those inputs before freezing the
    // submission so the gateway receives a concrete video_url instead of a
    // reference that is counted by the UI but silently omitted from JSON.
    let resolvedVideoReferences = videoReferences;
    let videoReferenceError = "";
    if (!taskId && !previousSubmission && videoReferences.some(reference => reference.assetId || reference.localVideo || reference.localAudio)) {
      try {
        resolvedVideoReferences = await Promise.all(videoReferences.map(async reference => {
          if (reference.localVideo) {
            const blob = await readLocalVideo(reference.localVideo);
            if (!blob) throw new Error("本机视频参考已丢失，请重新提取或导入完整画布备份。");
            return { ...reference, video: await localMediaDataUrl(blob, "video"), localVideo: undefined };
          }
          if (reference.localAudio) {
            const blob = await readLocalAudio(reference.localAudio);
            if (!blob) throw new Error("本机音频参考已丢失，请重新提取或导入完整画布备份。");
            return { ...reference, audio: await localMediaDataUrl(blob, "audio"), localAudio: undefined };
          }
          if (!reference.assetId) return reference;
          const asset = await readPlatformAsset(client.api, reference.assetId);
          const expectedType = reference.mediaType === "audio" ? "audio" : "video";
          if (asset.storedAsset.type !== expectedType || !asset.url) throw new Error("参考素材类型或访问地址无效，请从素材库重新选择。");
          return expectedType === "audio"
            ? { ...reference, audio: asset.url, video: undefined, videoContentUrl: undefined, videoContentUrlExpiresAt: undefined }
            : { ...reference, video: asset.url, audio: undefined, videoContentUrl: undefined, videoContentUrlExpiresAt: undefined };
        }));
      } catch (error) {
        videoReferenceError = error instanceof Error ? error.message : "参考素材暂不可用，请重新加载后重试。";
      }
    }
    const referenceCount = new Set([...references.map(ref => ref.image || ref.localImage || ref.nodeId), ...resolvedVideoReferences.map(ref => ref.video || ref.localVideo || ref.audio || ref.localAudio || ref.videoContentUrl || ref.assetId || ref.nodeId)]).size;
    const compatible = compatibleModels(models, "video", referenceCount);
    const selectedModel = preferredModelForNode(models, "video", referenceCount, node);
    const reason = !effectivePrompt.trim() ? "请先填写视频提示词。" : imageReferenceError || (resolvedImageReferences.some(ref => !ref.image && !ref.localImage && !ref.assetId) ? "参考图片尚未恢复，请重新上传。" : videoReferenceError || (resolvedVideoReferences.some(ref => !ref.video && !ref.audio && !ref.videoContentUrl && !ref.assetId) ? "参考素材尚未恢复，请重新加载资产后重试。" : !selectedModel ? "请选择支持当前输入的视频模型。" : ""));
    if (!taskId && !previousSubmission && reason) {
      setCreationError({ id: node.id, message: reason });
      setInspectorOpen(true);
      return;
    }
    const resolvedVideoSettings = resolveVideoSettings(selectedModel, {
      duration: node.videoSettings?.duration ?? node.videoDuration,
      size: node.videoSettings?.size ?? node.videoSize,
      resolution: node.videoSettings?.resolution ?? node.videoResolution,
      aspect_ratio: node.videoSettings?.aspect_ratio ?? node.videoAspectRatio,
      generate_audio: node.videoSettings?.generate_audio ?? node.videoAudio,
    });
    const submission = taskId ? undefined : previousSubmission
      ? { ...previousSubmission }
      : {
          key: uid("canvas-video-submit"), model: selectedModel!.id!, prompt: effectivePrompt,
          images: resolvedImageReferences.map(({ image, localImage, assetId }) => ({ image, localImage, assetId })),
          references: [
            ...resolvedImageReferences.filter(reference => reference.image || reference.assetId || reference.localImage).map(reference => ({ type: "image_url" as const, ...(reference.image ? { url: reference.image } : {}), ...(reference.assetId ? { assetId: reference.assetId } : {}), ...(reference.localImage ? { localImage: reference.localImage } : {}), mediaType: "image" as const })),
            ...resolvedVideoReferences
              .filter(reference => reference.audio || reference.localAudio || reference.video || reference.localVideo || reference.videoContentUrl || reference.assetId)
              .map(reference => {
                const mediaType = reference.mediaType === "audio" || reference.audio || reference.localAudio ? "audio" as const : "video" as const;
                const url = mediaType === "audio" ? reference.audio : reference.video || reference.videoContentUrl;
                return {
                  type: mediaType === "audio" ? "audio_url" as const : "video_url" as const,
                  ...(url ? { url } : {}),
                  ...(reference.assetId ? { assetId: reference.assetId } : {}),
                  ...(reference.localVideo ? { localVideo: reference.localVideo } : {}),
                  ...(reference.localAudio ? { localAudio: reference.localAudio } : {}),
                  mediaType,
                };
              }),
          ],
          ...resolvedVideoSettings,
        };
    const controller = new AbortController();
    const canvasId = docRef.current.id;
    let observedTaskId = taskId;
    const currentRequestNode = (allowAborted = false) => {
      try { checkLocalAccount(); } catch { return undefined; }
      if (!alive.current || leaving.current || pendingRemovalNodes.current.has(node.id) ||
        docRef.current.id !== canvasId ||
        activeRequests.current.get(node.id) !== controller || !allowAborted && controller.signal.aborted) return undefined;
      const current = docRef.current.nodes.find(item => item.id === node.id);
      if (!current || current.type !== "prompt" || current.mediaType !== "video") return undefined;
      return taskRecoveryKey(canvasId, node.id, current.taskId, current.videoSubmission?.key) ===
        taskRecoveryKey(canvasId, node.id, observedTaskId, submission?.key) ? current : undefined;
    };
    activeRequests.current.set(node.id, controller);
    setActiveIds((ids) => [...ids, node.id]);
    setCreationError(null);
    setReferenceRequest(0);
    patchTask(node.id, {
      // Resuming observation must preserve an unknown result until the server
      // actually reports progress. It does not start another generation.
      ...(!taskId ? { status: "running" as const, error: undefined, videoPollingPaused: false, videoPollingReason: undefined }
        : node.videoPollingReason === "user" ? { videoPollingPaused: false, videoPollingReason: undefined } : {}),
      taskId, taskPrompt: effectivePrompt, videoSubmission: submission,
      ...(!taskId && !previousSubmission && selectedModel?.id
        ? { modelId: selectedModel.id, modelSelection: node.modelSelection === "user" ? "user" as const : "default" as const }
        : {}),
      inputSignature:
        taskId || previousSubmission
          ? node.inputSignature
          : creationInputSignature({
              prompt: effectivePrompt,
              model: submission!.model,
              references: [...references, ...videoReferences],
              ignoreImageRefs: node.ignoreImageRefs,
              settings: resolvedVideoSettings,
            }),
      taskDiagnostic: taskId || previousSubmission ? node.taskDiagnostic : {
        createdAt: new Date().toISOString(),
        summary: { model: submission?.model, reference_count: submission?.references?.length || submission?.images?.length || 0,
          duration: submission?.duration, resolution: submission?.resolution, aspect_ratio: submission?.aspect_ratio },
      },
    });
    if (!taskId && !node.videoSubmission && preferencesRef.current.clearFocusAfterSubmit) {
      setSelected([]); setInspectorMode(null);
    }
    try {
      await persist(docRef.current, false);
      if (!currentRequestNode()) return;
      // A cloud snapshot intentionally stores only stable asset IDs for
      // signed reference URLs. Resolve those IDs immediately before replaying
      // the frozen request; generateVideo performs its idempotency lookup
      // before any possible new POST.
      const submittedReferences = [
        ...(submission?.references || []),
        ...(submission?.images || [])
          .filter(reference => reference.image || reference.assetId || reference.localImage)
          .filter(reference => !(submission?.references || []).some(existing => existing.type === "image_url" && (existing.assetId && existing.assetId === reference.assetId || existing.url && existing.url === reference.image)))
          .map(reference => ({ type: "image_url" as const, ...(reference.image ? { url: reference.image } : {}), ...(reference.assetId ? { assetId: reference.assetId } : {}), ...(reference.localImage ? { localImage: reference.localImage } : {}), mediaType: "image" as const })),
      ];
      if (!currentRequestNode()) return;
      const result = await generateVideo(
        (path, init) => {
          checkLocalAccount();
          if (!platformReadyRef.current) throw Object.assign(new Error("请重新登录后继续创作。"), { code: "APP_LOGIN_REQUIRED" });
          if (!currentRequestNode()) {
            controller.abort("replaced");
            throw new VideoGenerationError("原任务查询已停止。", { taskId: observedTaskId, pending: true, code: "VIDEO_TASK_PAUSED" });
          }
          return client.api.request(path, init);
        },
        {
          model: submission?.model || node.modelId || "", prompt: effectivePrompt, duration: submission?.duration, size: submission?.size, resolution: submission?.resolution, aspect_ratio: submission?.aspect_ratio, generate_audio: submission?.generate_audio,
          images: submission?.images?.map((reference) => reference.image!).filter(Boolean), references: submittedReferences,
          resolveReferences: async (referenceInputs: VideoReferenceInput[]): Promise<VideoReference[]> => Promise.all(referenceInputs.map(async reference => {
            let url = reference.url;
            const needsAssetRefresh = reference.assetId && (!url || mediaUrlNeedsRefresh(url));
            if (needsAssetRefresh && reference.assetId) {
              const asset = await readPlatformAsset(client.api, reference.assetId);
              const expectedType = reference.type === "image_url" ? "image" : reference.type === "audio_url" ? "audio" : "video";
              if (asset.storedAsset.id !== reference.assetId || asset.storedAsset.type !== expectedType || !asset.url)
                throw new Error("视频任务引用素材无法恢复，请从素材库重新选择后重试。");
              url = asset.url;
            }
            if (!url && reference.localImage) {
              const imageDocument: { nodes: Array<{ image?: string; localImage?: string }> } = { nodes: [{ localImage: reference.localImage }] };
              const restored = await restoreLocalImages(imageDocument);
              url = restored.nodes[0]?.image;
            }
            if (!url && reference.localVideo) {
              const blob = await readLocalVideo(reference.localVideo);
              if (blob) url = await localMediaDataUrl(blob, "video");
            }
            if (!url && reference.localAudio) {
              const blob = await readLocalAudio(reference.localAudio);
              if (blob) url = await localMediaDataUrl(blob, "audio");
            }
            if (!url) throw new Error("视频任务引用素材缺少可访问地址，请从素材库重新选择后重试。");
            return { type: reference.type, url };
          })),
          taskId, idempotencyKey: submission?.key,
        },
        (id) => {
          // Persist an accepted POST identity even if observation was aborted
          // for reauthorization, but never write into another account/canvas.
          const current = currentRequestNode(true);
          if (!current) { controller.abort("replaced"); return; }
          if (current.taskId === id && !current.videoSubmission) return;
          patchTask(node.id, { taskId: id, videoSubmission: undefined });
          observedTaskId = id;
          return persist(docRef.current, false);
        },
        {
          signal: controller.signal,
          observeUnknown: true,
          recovery: previousSubmission ? {
            inputReferencesAvailable:
              !previousSubmission.images?.some(reference => !reference.image && !reference.assetId && !reference.localImage && !reference.localVideo && !reference.localAudio) &&
              !previousSubmission.references?.some(reference => !reference.url && !reference.assetId && !reference.localImage && !reference.localVideo && !reference.localAudio),
          } : undefined,
          onStatus: (snapshot) => {
            const current = currentRequestNode();
            if (!current) { controller.abort("replaced"); return; }
            const patch = videoTaskSnapshotPatch(current, snapshot);
            // Commit completion together with its media source below.
            if (patch.status !== "completed" && Object.keys(patch).length) patchTask(node.id, patch);
          },
        },
      );
      if (!currentRequestNode()) return;
      const source = currentRequestNode();
      if (!source) return;
      const outputAspectRatio = videoAspectRatio(resolvedVideoSettings.aspect_ratio);
      const outputSize = fitVideoNodeSize(outputAspectRatio, 1);
      const output: CanvasNode = {
        id: uid("video"), type: "video", mediaType: "video", title: `${node.title} · 视频结果`, resultOf: node.id, resultIndex: 0, groupId: source.groupId, text: effectivePrompt,
        ...findFreePosition(docRef.current.nodes, { x: source.x + source.width + 100, y: source.y, ...outputSize }),
        ...outputSize, videoAspectRatio: resolvedVideoSettings.aspect_ratio, color: COLORS[4], videoContentUrl: result.contentUrl,
        videoContentUrlExpiresAt: result.contentUrlExpiresAt, assetId: result.assetId, taskId: result.taskId, status: "completed",
      };
      commit((value) => {
        const oldResultIds = new Set(value.nodes.filter((candidate) => isGeneratedResult(node.id, candidate, value.edges, node.title)).map((candidate) => candidate.id));
        const inlineVideo = {
          ...completedVideoMedia(result),
          resultBatchId: uid("video-batch"),
          resultIndex: 0,
        };
        return {
          ...value,
          nodes: value.nodes.filter((item) => !oldResultIds.has(item.id)).map((item) => item.id === node.id
            ? {
                ...item,
                status: "completed" as const,
                error: undefined,
                videoSubmission: undefined,
                videoPollingPaused: false,
                videoPollingReason: undefined,
                taskDiagnostic: { ...item.taskDiagnostic, status: "completed", phase: "completed", assetStatus: "ready", supplierConfirmation: undefined, code: undefined },
                taskId: result.taskId,
                ...outputSize,
                videoAspectRatio: resolvedVideoSettings.aspect_ratio,
                ...inlineVideo,
              }
            : item),
          edges: value.edges.filter((edge) => !oldResultIds.has(edge.from) && !oldResultIds.has(edge.to)),
          groups: output.groupId
            ? expandGroupFrames(value.nodes.filter((item) => !oldResultIds.has(item.id)).map((item) => item.id === node.id ? { ...item, ...inlineVideo } : item), value.groups)
            : value.groups,
        };
      });
      void persist(docRef.current, false).catch(() => setStatus("视频已生成 · 本机保存失败，请导出备份"));
      // Resolve direct delivery and extract a lightweight cover after commit;
      // completion feedback never waits on a full-video download.
      const savedVideo = docRef.current.nodes.find((candidate) => candidate.id === node.id);
      if (savedVideo) void loadVideoNode(savedVideo);
      if (overlay === "settings") void loadStorage();
      setInspectorMode(null);
      setCreationError(null);
      const notice = notificationGate.current.generation({ canvasId: docRef.current.id, nodeId: node.id, title: node.title, outcome: "completed", taskId: result.taskId, submissionKey: submission?.key }, preferencesRef.current, completionNoticeContext([node]));
      if (notice) setMessage(notice.text, undefined, 3500);
    } catch (error) {
      if (!currentRequestNode(true) || controller.signal.reason === "deleted" ||
        pendingRemovalNodes.current.has(node.id) ||
        !docRef.current.nodes.some((candidate) => candidate.id === node.id) ||
        controller.signal.reason === "cancelled" || controller.signal.reason === "replaced") return;
      const failure = platformFailure(error); if (failure.kind === "login") requireAuthentication(failure.message);
      if (isStorageQuotaError(error)) {
        if (overlay === "settings") void loadStorage();
        setOverlay("settings");
      }
      const videoError = error instanceof VideoGenerationError;
      const inputMissing = videoError && error.code === "VIDEO_SUBMISSION_INPUT_MISSING";
      // Network ambiguity is wrapped by generateVideo as VideoGenerationError
      // and keeps its explicit pending decision. A local failure before the
      // POST still keeps the frozen idempotent submission for a safe retry.
      const pending = !inputMissing && (videoError
        ? error.pending || Boolean(previousSubmission && !error.terminalTask)
        : Boolean(taskId || submission));
      const statusUnavailable = videoError && (error.status === "unknown" || ["VIDEO_TASK_STATUS_MISSING", "VIDEO_TASK_UNKNOWN", "VIDEO_TASK_READ_UNAVAILABLE"].includes(error.code));
      patchTask(node.id, {
        status: pending ? "queued" : "failed", ...(!pending && !inputMissing ? { videoSubmission: undefined } : {}), error: errorText(error),
        videoPollingPaused: Boolean(statusUnavailable), videoPollingReason: statusUnavailable ? "reconciliation" : undefined, ...(videoError && error.taskId ? { taskId: error.taskId } : {}),
        taskDiagnostic: { ...docRef.current.nodes.find(item => item.id === node.id)?.taskDiagnostic,
          ...(videoError ? { code: error.code, ...(error.requestId ? { requestId: error.requestId } : {}), ...(error.status ? { status: error.status } : {}), ...(error.terminalTask && !error.status ? { status: "failed" } : {}) } : {}) },
      });
      void persist(docRef.current, false).catch(() => setStatus("任务恢复信息保存失败 · 请保留页面并导出备份"));
      if (!pending && !(videoError && ["cancelled", "canceled"].includes(error.status || ""))) reportTaskFailure(node, error, submission?.key);
    } finally {
      if (activeRequests.current.get(node.id) === controller) {
        activeRequests.current.delete(node.id);
        if (alive.current) setActiveIds((ids) => ids.filter((id) => id !== node.id));
      }
    }
  };
  React.useEffect(() => {
    const reconnect = () => { taskRecovery.current.clear(); setRecoveryRevision(value => value + 1); };
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, []);
  React.useEffect(() => {
    if (!draftReady || !hydrated || !platformReady || authState !== "connected" || !navigator.onLine) return;
    const activeRestoreKeys = new Set<string>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const node of docRef.current.nodes) {
      if (pendingRemovalNodes.current.has(node.id) || node.type !== "prompt" || !isPending(node)) continue;
      const video = node.mediaType === "video";
      const music = node.mediaType === "audio";
      // Retired TTS tasks keep their original identity, but Canvas must never
      // poll them or accidentally send that identity to a different audio API.
      if (music && isTTSNode(node)) continue;
      const voice = music && isVoiceDesignNode(node);
      const restoreKey = taskRecoveryKey(docRef.current.id, node.id, node.taskId, video ? node.videoSubmission?.key : music ? voice ? node.voiceDesignSubmission?.key : node.musicSubmission?.key : node.submission?.key);
      activeRestoreKeys.add(restoreKey);
      // An active request must not consume recovery. It may still fail later.
      if (activeRequests.current.has(node.id)) continue;
      const delay = taskRecovery.current.delay(restoreKey);
      timers.push(setTimeout(() => {
        if (!alive.current || leaving.current || !platformReadyRef.current ||
          pendingRemovalNodes.current.has(node.id) || activeRequests.current.has(node.id)) return;
        const current = docRef.current.nodes.find(item => item.id === node.id);
        if (!current || !isPending(current) || music && isTTSNode(current)) return;
        const currentKey = taskRecoveryKey(docRef.current.id, current.id, current.taskId, video ? current.videoSubmission?.key : music ? voice ? current.voiceDesignSubmission?.key : current.musicSubmission?.key : current.submission?.key);
        if (currentKey !== restoreKey) return;
        taskRecovery.current.started(restoreKey);
        void (video ? generateVideoTask(current) : music ? voice ? generateVoiceDesignTask(current) : generateMusicTask(current) : generateImageTask(current)).finally(() => {
          taskRecovery.current.finished(restoreKey);
          if (alive.current && !leaving.current) setRecoveryRevision(value => value + 1);
        });
      }, delay));
    }
    taskRecovery.current.retain(activeRestoreKeys);
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [draftReady, hydrated, platformReady, authState, doc, activeIds, recoveryRevision]);
  const generate = async (requested = primary, inputChanged = false) => {
    if (requested?.mediaType === "video") return generateVideoTask(requested, inputChanged);
    if (requested?.mediaType === "audio") {
      if (isTTSNode(requested)) {
        setMessage("画布暂不支持文本转语音，请新建音频创作使用音色生成、音乐生成或录音。");
        return;
      }
      if (requested.audioMode === "recording") return;
      return (hasPendingNodeTask(requested) ? isVoiceDesignNode(requested) ? generateVoiceDesignTask(requested, inputChanged) : generateMusicTask(requested, inputChanged) : requested.audioMode === "voice_design" ? generateVoiceDesignTask(requested, inputChanged) : generateMusicTask(requested, inputChanged));
    }
    return generateImageTask(requested, inputChanged);
  };
  /**
   * Execute the policy-selected node action from every interaction surface.
   * Keeping this in one place prevents Enter, double-click, the floating
   * toolbar and the context menu from drifting into different behaviours.
   */
  const performNodeAction = (
    node: CanvasNode,
    options: { action?: ReturnType<typeof nodeInteraction>["primaryAction"]; focusCreator?: boolean } = {},
  ) => {
    cancelDeferredCreator();
    const interaction = nodeInteraction(node, docRef.current.nodes, docRef.current.edges, {
      hasPendingTask: isPending(node),
    });
    const role = resolveCanvasNodeRole(node, docRef.current.nodes);
    const action = options.action || (
      role.kind === "creator"
        ? (isPending(node) ? "task" : "create")
        : interaction.primaryAction
    );
    if (action === "task") {
      setMessage("生成中，完成后结果会自动显示在画布上。");
      return action;
    }
    if (action === "create") {
      closeMenus();
      setCreationError(null);
      setSelected([node.id]);
      setEditing(null);
      setInspectorOpen(true);
      if (options.focusCreator !== false) setCreatorFocusRequest((request) => request + 1);
      reveal(role.kind === "creator" ? [role.creator] : [node], true);
      return action;
    }
    if (action === "preview") {
      const result = node.type === "prompt"
        ? latestCreatorResultsFor(node.id, docRef.current.nodes, docRef.current.edges)
          .filter(hasMediaContent)
          .at(-1) || node
        : node;
      if (hasMediaContent(result)) {
        closeMenus();
        selectPreview(result);
      }
      return action;
    }
    if (action === "upload") {
      uploadNodeAsset(node);
      return action;
    }
    if (action === "edit") {
      if (interaction.canEdit) startEdit(node);
      return action;
    }
    // A media placeholder without a supported source is a recoverable empty
    // state, not an editable node. Keep the toolbar deterministic and quiet.
    return action;
  };

  const openPicker = (
    screen: Point,
    world: Point,
    nodeId?: string,
    sourceId?: string,
    edgeId?: string,
  ) => {
    setPicker({ screen, world, nodeId, sourceId, edgeId });
    setPickerQuery("");
    closeZoomMenu();
  };
  const canConnect = (
    from: string,
    to: string,
    options: { allowCompletedPrompt?: boolean } = {},
  ) => {
    const nodes = docRef.current.nodes;
    const source = nodes.find((node) => node.id === from);
    const target = nodes.find((node) => node.id === to);
    if (!source || !target || from === to) return false;
    if (source.type === "audio" || source.mediaType === "audio") {
      if (!canLoadAudioContent(source) || target.type !== "prompt" || target.mediaType !== "audio" || (target.audioMode || "music") !== "music" || target.musicReference || hasPendingNodeTask(target)) return false;
    }
    // Keep source eligibility in the same policy used by the rendered output
    // port. Empty media placeholders must not create edges that can never be
    // composed into a request.
    if (!canStartNodeConnection(source, { hasMediaContent: hasMediaContent(source) })) return false;
    // Connections flow into editable workflow nodes. Media cards are values
    // (source assets or generated outputs), so accepting input there creates
    // ambiguous image-to-image wires and makes the graph look misconnected.
    // The explicit reference picker may opt a completed prompt back in so a
    // user can extend an existing creator without changing normal port rules.
    const canReceive = options.allowCompletedPrompt && target.type === "prompt"
      ? true
      : canReceiveNodeConnection(target, { hasMediaContent: hasMediaContent(target) });
    if (!canReceive) return false;
    if (docRef.current.edges.some((edge) => edge.from === from && edge.to === to)) return false;
    // Prevent cycles before they can make prompt composition ambiguous.
    const visiting = new Set<string>();
    const reaches = (current: string): boolean => {
      if (current === from) return true;
      if (visiting.has(current)) return false;
      visiting.add(current);
      return docRef.current.edges.filter((edge) => edge.from === current).some((edge) => reaches(edge.to));
    };
    return !reaches(to);
  };
  const finishConnection = (from: string, to: string) => {
    const accepted = canConnect(from, to);
    const source = docRef.current.nodes.find(node => node.id === from);
    const audioReference = accepted && source && (source.type === "audio" || source.mediaType === "audio");
    if (audioReference) {
      void selectMusicReference(to, from).then(() => {
        commit(value => ({ ...value, edges: [...value.edges, { id: uid("edge"), from, to }] }));
        setSelected([to]); setInspectorOpen(true);
      }).catch(error => setMessage(errorText(error)));
    } else if (accepted)
      commit((value) => ({
        ...value,
        edges: [...value.edges, { id: uid("edge"), from, to }],
      }));
    setConnecting(null);
    setWireOrigin(null);
    setWirePoint(null);
    setWireTarget(null);
    setNearConnection(null);
    setTool("select");
    wireDrag.current = null;
    if (!accepted) return;
    const target = docRef.current.nodes.find((node) => node.id === to);
    const targetInteraction = target
      ? nodeInteraction(target, docRef.current.nodes, docRef.current.edges, {
          hasPendingTask: isPending(target),
        })
      : null;
    if (target && targetInteraction?.canEdit) {
      setSelected([target.id]);
      setInspectorOpen(true);
      setEditing(null);
    }
  };
  const addReference = (targetId: string, sourceId: string) => {
    const source = docRef.current.nodes.find((node) => node.id === sourceId);
    const target = docRef.current.nodes.find((node) => node.id === targetId);
    const composition = composePrompt(docRef.current.nodes, docRef.current.edges, targetId);
    if (
      !source ||
      !canUseCanvasReferenceFor(source, target) ||
      target?.type !== "prompt" ||
      [...composition.imageReferences, ...composition.videoReferences].some(reference => sameCanvasReferenceValue(source, reference)) ||
      !canConnect(sourceId, targetId, { allowCompletedPrompt: true })
    ) return false;
    commit((value) => ({
      ...value,
      nodes: value.nodes.map((node) =>
        node.id === targetId ? { ...node, ignoreImageRefs: false } : node,
      ),
      edges: [
        ...value.edges,
        { id: uid("edge"), from: sourceId, to: targetId },
      ],
    }));
    clearConnection();
    setSelected([targetId]);
    setInspectorOpen(true);
    return true;
  };
  const inspectSource = (id: string) => {
    const source = docRef.current.nodes.find((node) => node.id === id);
    if (!source) return;
    if (source.type === "image" && source.image) selectPreview(source, { preserveInspector: true });
    else if (primary) reveal([source, primary], true);
  };
  const wireEnd = (p: Point, from: string) => {
    // Wire drops use the same outside semicircle as hover handles. The side
    // is constrained to the edge facing the source so a backwards drop does
    // not appear to connect to the wrong side of the target.
    // Pointer coordinates are in world space. Use the same adaptive magnetic
    // range as hover affordances so wire drops remain reachable on zoomed media.
    const snapRadius = magneticRadiusForZoom(MAGNETIC_ENTER_RADIUS, docRef.current.viewport.zoom || 1);
    const source = docRef.current.nodes.find((candidate) => candidate.id === from);
    if (!source) return null;
    const candidates = [...docRef.current.nodes].reverse().filter((node) => canConnect(from, node.id));
    const magnetic = canvasPreferences.magneticSnap ? nearestMagneticPort(
      candidates,
      p,
      snapRadius,
      (node, side) => connectorPortSide(source, node, "target") === side,
    ) : null;
    if (magnetic) {
      const node = candidates.find((candidate) => candidate.id === magnetic.nodeId);
      if (node) return { node, port: { x: magnetic.x, y: magnetic.y }, side: magnetic.side };
    }
    // A drop inside the card remains forgiving, but resolves to the real edge
    // port rather than leaving the line endpoint in the card's interior.
    return candidates
      .map((node) => {
        const side = connectorPortSide(source, node, "target");
        const inside =
          p.x >= node.x &&
          p.x <= node.x + node.width &&
          p.y >= node.y &&
          p.y <= node.y + node.height;
        return inside ? { node, port: portPoint(node, side, p.y), side } : null;
      })
      .filter((candidate): candidate is { node: CanvasNode; port: Point; side: PortSide } => Boolean(candidate))
      .sort((a, b) => Math.hypot(p.x - a.port.x, p.y - a.port.y) - Math.hypot(p.x - b.port.x, p.y - b.port.y))[0] || null;
  };
  const capturePointer = (id: number, element: Element = board.current!) => {
    capturedPointers.current.set(id, element);
    element.setPointerCapture(id);
  };
  const claimPointer = (event: React.PointerEvent, element: Element = board.current!) => {
    gesturePointer.current = { id: event.pointerId, type: event.pointerType };
    capturePointer(event.pointerId, element);
  };
  const releasePointers = () => {
    const captures = [...capturedPointers.current];
    capturedPointers.current.clear();
    for (const [id, element] of captures) {
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
  };
  const startPinch = () => {
    const entries = [...touches.current].slice(0, 2);
    if (entries.length < 2) return;
    pinch.current = { ids: [entries[0][0], entries[1][0]], start: [entries[0][1], entries[1][1]], viewport: { ...docRef.current.viewport } };
    for (const id of touches.current.keys()) capturePointer(id);
    // Enter the viewport-motion phase as soon as the two-finger gesture is
    // claimed. The first move can arrive after React paints the gesture state;
    // marking here prevents a newly exposed node/editor from flashing for that
    // one frame.
    markViewportMoving("direct");
    setGesturing(true);
  };
  // Capture navigation before ports, node buttons, or edges can claim the press.
  const pointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest(".minimap")) return;
    if (event.button !== 0 && event.button !== 1) return;
    const mediaPlayer = target.closest('[data-canvas-video-player],[data-canvas-media-player]');
    const videoNavigation = mediaPlayer && (event.button === 1 || tool === "hand" || spacePressed.current);
    if (!referencePickTarget && !videoNavigation && target.closest('input,textarea,select,[contenteditable="true"],video[controls],audio[controls],[data-canvas-video-player][data-interactive="true"],[data-canvas-media-player]')) return;
    if (referencePickTarget && target.closest(".reference-pick-banner")) return;
    if (referencePickTarget && !target.closest("[data-node-id]")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (referencePickTarget) {
      const nodeElement = target.closest<HTMLElement>("[data-node-id]");
      const node = nodeElement?.dataset.nodeId
        ? docRef.current.nodes.find((candidate) => candidate.id === nodeElement.dataset.nodeId)
        : undefined;
      const nestedControl = target.closest(
        "button,a,input,textarea,select,video[controls],audio[controls],[data-canvas-video-player],[data-canvas-media-player],.node-toolbar,.port,.resize-handle",
      );
      if (nestedControl) {
        // Toolbar, port and playback controls belong to the normal canvas
        // mode. In pick mode only the image surface itself is actionable;
        // intercept nested controls here because several of them stop
        // propagation before nodeDown can enforce the mode.
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 0 && node) {
          if (referencePickKind === "text" && isCanvasTextReference(node)) {
            chooseCanvasTextReference(node.id);
          } else if (referencePickKind === "image" && canUseCanvasReferenceFor(node, docRef.current.nodes.find(item => item.id === referencePickTarget))) {
            if (hasUsableCanvasReferenceImage(node) && !node.image) {
              setMessage("这张图片尚未恢复，请先重新加载后再选择。");
              return;
            }
            const loadState = hasUsableCanvasReferenceImage(node) ? imageLoadStates[node.id] : undefined;
            if (loadState?.status === "recovering" || loadState?.status === "failed") {
              setMessage(loadState.status === "recovering"
                ? "图片正在恢复，请稍候再选择。"
                : "这张图片暂时不可用，请先重新加载后再选择。");
            } else {
              chooseCanvasReference(node.id);
            }
          }
        }
        return;
      }
    }
    // A canvas gesture takes ownership of the camera. Do not leave a focused
    // slider draft visible while the board is being panned or pinched.
    clearZoomDraft();
    onCanvasInteraction?.();
    suppressClick.current = false;
    if (event.pointerType === "touch") {
      if (!touches.current.size) touchSelection.current = { selected, inspector: inspectorMode };
      touches.current.set(event.pointerId, screenPoint(event.clientX, event.clientY));
      if (touches.current.size >= 2) {
        event.preventDefault();
        event.stopPropagation();
        const originalSelection = touchSelection.current;
        cancelGesture(true);
        if (originalSelection) {
          setSelected(originalSelection.selected);
          setInspectorMode(originalSelection.inspector);
        }
        startPinch();
        return;
      }
    }
    if (gesturePointer.current || pinch.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const touchBackground = event.pointerType === "touch" && !target.closest('.node,button,a');
    const handOnSurface = tool === "hand" && !target.closest('button:not(.port):not(.resize-handle),.node-toolbar,.edit-actions');
    if (event.button === 1 || spacePressed.current || handOnSurface || touchBackground) {
      event.stopPropagation();
      blurCreator();
      closeMenus();
      beginPan(event, touchBackground && event.button === 0 && tool !== "hand" && !spacePressed.current);
    }
  };
  const portDown = (
    event: React.PointerEvent,
    node: CanvasNode,
    side: PortSide = "right",
    position?: Point,
  ) => {
    event.stopPropagation();
    blurCreator();
    event.preventDefault();
    if (event.button !== 0) return;
    setNearConnection(null);
    setConnecting(node.id);
    // Preserve the exact floating magnetic position when the user grabs it.
    // Falling back to the card edge keeps keyboard/fixed ports unchanged.
    const origin = position || portPoint(node, side);
    setWireOrigin(origin);
    setWirePoint(origin);
    setSelected([node.id]);
    setSelectedEdge(null);
    wireDrag.current = {
      from: node.id,
      start: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    claimPointer(event);
  };
  const updateMagneticConnection = (p: Point) => {
    if (!preferencesRef.current.magneticSnap) { setNearConnection(null); return; }
    const zoom = clampZoom(docRef.current.viewport.zoom);
    const enterRadius = magneticRadiusForZoom(MAGNETIC_ENTER_RADIUS, zoom);
    const exitRadius = magneticRadiusForZoom(MAGNETIC_EXIT_RADIUS, zoom);
    // Magnetic affordances describe capability, not current edge count. A
    // prompt can accept several references and emit several downstream
    // results, so hiding the handle after its first edge made the interaction
    // disagree with canConnect and prevented valid workflows from being
    // extended.
    const nearest = nearestMagneticPort(
      magneticNodes,
      p,
      enterRadius,
      (node, side) => {
        const interaction = nodeInteractionById.get(node.id);
        if (!interaction) return false;
        const topology = edgeTopologyByNodeId.get(node.id);
        const inputSide = topology?.incomingSource
          ? connectorPortSide(topology.incomingSource, node, "target")
          : "left";
        const outputSide = topology?.outgoingTarget
          ? connectorPortSide(node, topology.outgoingTarget, "source")
          : "right";
        return canUseNodePortSide(
          interaction,
          side,
          inputSide,
          outputSide,
        );
      },
    );
    setNearConnection((current) => {
      if (current) {
        const node = magneticNodeById.get(current.nodeId);
        if (node) {
          const distance = magneticPortDistance(node, current.side, p);
          if (distance <= exitRadius) {
            // Keep the current handle through the hysteresis radius unless a
            // nearer candidate clearly takes over.
            if (!nearest || (nearest.nodeId === current.nodeId && nearest.side === current.side)) {
              return { ...current, x: p.x, y: p.y };
            }
            const nextNode = magneticNodeById.get(nearest.nodeId);
            if (nextNode && magneticPortDistance(nextNode, nearest.side, p) >= distance) {
              return { ...current, x: p.x, y: p.y };
            }
          }
        }
      }
      return nearest;
    });
  };
  magneticUpdateRef.current = updateMagneticConnection;
  const scheduleMagneticConnection = (p: Point) => {
    pendingMagneticPoint.current = p;
    if (magneticFrame.current !== null) return;
    magneticFrame.current = window.requestAnimationFrame(() => {
      magneticFrame.current = null;
      const pending = pendingMagneticPoint.current;
      pendingMagneticPoint.current = null;
      // A pointer-down may start another gesture before this frame paints.
      // Do not resurrect a hover handle over an active drag or connection.
      if (!pending || connectingRef.current || wireDrag.current || pan.current || resize.current || box.current || drag.current) return;
      magneticUpdateRef.current(pending);
    });
  };
  React.useLayoutEffect(() => {
    const previous = previousNearConnection.current;
    const changedTarget = previous && nearConnection &&
      (previous.nodeId !== nearConnection.nodeId || previous.side !== nearConnection.side);
    if (previous && (!nearConnection || changedTarget)) {
      setExitingNearConnection(previous);
      if (nearConnectionExitTimer.current) clearTimeout(nearConnectionExitTimer.current);
      nearConnectionExitTimer.current = setTimeout(() => {
        nearConnectionExitTimer.current = null;
        setExitingNearConnection((current) =>
          current === previous ? null : current,
        );
      }, PORT_EXIT_DURATION_MS);
    } else if (nearConnection) {
      if (nearConnectionExitTimer.current) {
        clearTimeout(nearConnectionExitTimer.current);
        nearConnectionExitTimer.current = null;
      }
      setExitingNearConnection(null);
    }
    previousNearConnection.current = nearConnection;
  }, [nearConnection]);
  React.useEffect(() => () => {
    if (nearConnectionExitTimer.current) clearTimeout(nearConnectionExitTimer.current);
    if (magneticFrame.current !== null) window.cancelAnimationFrame(magneticFrame.current);
    magneticFrame.current = null;
    pendingMagneticPoint.current = null;
  }, []);
  React.useEffect(() => {
    const screen = pointerScreen.current;
    if (!pointerInside.current || !screen || wireDrag.current || connecting || pan.current || pinch.current || drag.current || resize.current || box.current) return;
    const zoom = clampZoom(doc.viewport.zoom);
    updateMagneticConnection({
      x: (screen.x - doc.viewport.x) / zoom,
      y: (screen.y - doc.viewport.y) / zoom,
    });
    // `gesturing` changes when a pinch ends; include it so the final viewport
    // is reconciled once the navigation gesture releases its pointer. The
    // node/edge collections also refresh the candidate after graph edits.
  }, [canvasNodes, canvasEdges, doc.viewport.x, doc.viewport.y, doc.viewport.zoom, gesturing]);
  const groupFrameDown = (event: React.PointerEvent, frame: GroupFrame) => {
    event.stopPropagation();
    cancelDeferredCreator();
    blurCreator();
    if (event.button !== 0 || tool !== "select" || spacePressed.current) return;
    focusCanvas();
    closeMenus();
    setInspectorOpen(false);
    setSelectedEdge(null);
    const logicalIds = docRef.current.nodes
      .filter((node) => node.groupId === frame.id)
      .map((node) => node.id);
    const ids = visibleGroupMembers(docRef.current.nodes, frame.id).map((node) => node.id);
    const currentlySelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    if (event.shiftKey) {
      setSelected((current) => currentlySelected
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])]);
    } else {
      setSelected(ids);
    }
    drag.current = {
      start: point(event.clientX, event.clientY),
      ids,
      selectionIds: logicalIds,
      before: docRef.current,
      previousSelection: selected,
      origins: new Map(docRef.current.nodes.filter((node) => logicalIds.includes(node.id)).map((node) => [node.id, { x: node.x, y: node.y }])),
      movedIdSet: new Set(logicalIds),
      moved: false,
      groupId: frame.id,
      groupOrigin: frame,
      keepSelectionOnClick: false,
    };
    claimPointer(event, event.currentTarget);
    event.preventDefault();
  };
  const beginPan = (event: React.PointerEvent, tapToClear = false) => {
    cancelDeferredCreator();
    clearConnection();
    event.preventDefault();
    pan.current = {
      start: { x: event.clientX, y: event.clientY },
      viewport: { ...docRef.current.viewport },
      moved: false,
      tapToClear,
    };
    claimPointer(event);
  };
  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return;
    cancelDeferredCreator();
    if (referencePickTarget && (event.target as Element).closest(".reference-pick-banner")) return;
    blurCreator();
    focusCanvas();
    closeMenus();
    if (event.button === 1 || tool === "hand" || spacePressed.current)
      return beginPan(event);
    setInspectorOpen(false);
    setReferenceRequest(0);
    if (event.button !== 0) return;
    setSelectedEdge(null);
    setConnecting(null);
    setWireOrigin(null);
    setWirePoint(null);
    setNearConnection(null);
    const start = screenPoint(event.clientX, event.clientY),
      base = event.shiftKey ? selected : [];
    box.current = { start, base, before: selected, inspector: inspectorMode };
    setSelected(base);
    event.preventDefault();
    claimPointer(event);
  };
  const nodeDown = (event: React.PointerEvent, node: CanvasNode) => {
    event.stopPropagation();
    cancelDeferredCreator();
    blurCreator();
    if (referencePickTarget) {
      // While picking, every node is inert apart from an eligible image. This
      // also suppresses nested preview/play buttons on the target or on media
      // that cannot currently be used, so a pick session never leaks into the
      // normal canvas interaction model.
      if (event.button !== 0) return;
      event.preventDefault();
      if (node.id !== referencePickTarget) {
        if (referencePickKind === "text" && isCanvasTextReference(node)) {
          chooseCanvasTextReference(node.id);
        } else if (referencePickKind === "image" && canUseCanvasReferenceFor(node, docRef.current.nodes.find(item => item.id === referencePickTarget))) {
          if (hasUsableCanvasReferenceImage(node) && !node.image) {
            setMessage("这张图片尚未恢复，请先重新加载后再选择。");
            return;
          }
          const loadState = hasUsableCanvasReferenceImage(node) ? imageLoadStates[node.id] : undefined;
          if (loadState?.status === "recovering" || loadState?.status === "failed") {
            setMessage(loadState.status === "recovering"
              ? "图片正在恢复，请稍候再选择。"
              : "这张图片暂时不可用，请先重新加载后再选择。");
            return;
          }
          chooseCanvasReference(node.id);
        }
      }
      return;
    }
    setReferenceRequest(0);
    if (event.button === 2) return;
    if (event.button === 1 || spacePressed.current || tool === "hand")
      return beginPan(event);
    if (event.button !== 0 || editing === node.id) return;
    focusCanvas();
    closeMenus();
    setSelectedEdge(null);
    setNearConnection(null);
    if (connecting) {
      finishConnection(connecting, node.id);
      return;
    }
    // Alt/Option is the explicit escape hatch from a group. Command/Ctrl and
    // Shift keep their existing multi-select semantics, while an unmodified
    // click treats the group as one interaction target.
    const singleNode = event.altKey;
    const grouped = Boolean(node.groupId) && !singleNode && !event.shiftKey && !event.metaKey && !event.ctrlKey;
    const ids = singleNode
      ? [node.id]
      : grouped
        ? selectionForGroupMember(canvasNodes, node.id, selected, event.shiftKey)
      : event.shiftKey
        ? selected.includes(node.id)
          ? selected.filter((id) => id !== node.id)
          : [...new Set([...selected, node.id])]
        : selected.includes(node.id)
          ? selected
          : [node.id];
    const logicalIds = grouped
      ? docRef.current.nodes.filter((candidate) => candidate.groupId === node.groupId).map((candidate) => candidate.id)
      : ids;
    const interaction = nodeInteraction(node, docRef.current.nodes, docRef.current.edges, {
      hasPendingTask: isPending(node),
    });
    const role = resolveCanvasNodeRole(node, docRef.current.nodes);
    // Creator nodes retain their editor affordance on a single click, but a
    // completed creator can also open its media gallery on double-click. The
    // editor open is therefore committed on pointer-up (and deferred when the
    // node has media) so the second pointer-down can cancel it first.
    const opensCreator = role.kind === "creator" && interaction.canEdit;
    setSelected(ids);
    if (
      ids.length !== 1 ||
      selected[0] !== node.id ||
      !opensCreator
    )
      setInspectorMode(null);
    if (!ids.includes(node.id)) return;
    drag.current = {
      start: point(event.clientX, event.clientY),
      ids,
      before: docRef.current,
      previousSelection: selected,
      selectionIds: logicalIds,
      origins: new Map(docRef.current.nodes.filter(n => logicalIds.includes(n.id)).map(n => [n.id, { x: n.x, y: n.y }])),
      movedIdSet: new Set(logicalIds),
      moved: false,
      inspectId:
        !event.shiftKey &&
        opensCreator
          && (!node.groupId || event.altKey)
          ? node.id
          : undefined,
      deferInspect: Boolean(
        !event.shiftKey &&
        opensCreator &&
        interaction.canPreview,
      ),
      clickId: !event.shiftKey ? node.id : undefined,
      keepSelectionOnClick: !grouped,
      groupId: grouped ? node.groupId : undefined,
      groupOrigin: grouped ? normalizeGroupFrames(docRef.current.nodes, undefined).find((frame) => frame.id === node.groupId) : undefined,
    };
    // Capture on the article so a click/double-click still belongs to its node.
    claimPointer(event, event.currentTarget);
    event.preventDefault();
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerScreen.current = screenPoint(event.clientX, event.clientY);
    pointerInside.current = true;
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, screenPoint(event.clientX, event.clientY));
    if (pinch.current) {
      const { ids, start, viewport } = pinch.current;
      if (ids.includes(event.pointerId)) {
        const currentTouches: [Point, Point] = [touches.current.get(ids[0])!, touches.current.get(ids[1])!];
        const startDistance = Math.hypot(start[1].x - start[0].x, start[1].y - start[0].y);
        const currentDistance = Math.hypot(currentTouches[1].x - currentTouches[0].x, currentTouches[1].y - currentTouches[0].y);
        if (Math.abs(currentDistance - startDistance) > 0.5) revealZoomIndicator();
        view(pinchViewport(viewport, start, currentTouches));
      }
      return;
    }
    if (gesturePointer.current && gesturePointer.current.id !== event.pointerId) return;
    const threshold = dragThreshold(gesturePointer.current?.type || event.pointerType);
    const p = point(event.clientX, event.clientY);
    if (!wireDrag.current && !connecting && !pan.current && !resize.current && !box.current && !drag.current)
      scheduleMagneticConnection(p);
    if (wireDrag.current || connecting) {
      const from = wireDrag.current?.from || connecting!;
      if (
        wireDrag.current &&
        Math.hypot(
          event.clientX - wireDrag.current.start.x,
          event.clientY - wireDrag.current.start.y,
        ) >= threshold
      ) {
        wireDrag.current.moved = true;
        setGesturing(true);
      }
      const target = wireEnd(p, from);
      setWireTarget(target?.node.id || null);
      // The preview endpoint is exactly the same floating point that the
      // magnetic handle exposes. This keeps the line and the click target
      // visually locked together during a drag.
      setWirePoint(target?.port || p);
      return;
    }
    if (pan.current) {
      const { start, viewport } = pan.current;
      if (!pan.current.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < threshold) return;
      pan.current.moved = true;
      setGesturing(true);
      view({
        ...viewport,
        x: viewport.x + (event.clientX - start.x) * canvasPreferences.panSensitivity,
        y: viewport.y + (event.clientY - start.y) * canvasPreferences.panSensitivity,
      });
      return;
    }
    if (resize.current) {
      const r = resize.current,
        dx = p.x - r.start.x,
        dy = p.y - r.start.y;
      if (!r.moved && Math.hypot(dx, dy) * docRef.current.viewport.zoom < threshold)
        return;
      r.moved = true;
      setGesturing(true);
      scheduleGeometryMove(event.clientX, event.clientY);
      return;
    }
    if (drag.current) {
      const d = drag.current,
        dx = p.x - d.start.x,
        dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * docRef.current.viewport.zoom < threshold)
        return;
      d.moved = true;
      setGesturing(true);
      scheduleGeometryMove(event.clientX, event.clientY);
      return;
    }
    if (box.current) {
      const end = screenPoint(event.clientX, event.clientY),
        { start, base } = box.current;
      const m = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w: Math.abs(end.x - start.x),
        h: Math.abs(end.y - start.y),
      };
      if (!marquee && Math.hypot(m.w, m.h) < threshold) return;
      setMarquee(m);
      setGesturing(true);
      const v = docRef.current.viewport;
      setSelected([
        ...new Set([
          ...base,
          ...docRef.current.nodes
            .filter((n) => {
              const x = v.x + n.x * v.zoom,
                y = v.y + n.y * v.zoom;
              return (
                x < m.x + m.w &&
                x + n.width * v.zoom > m.x &&
                y < m.y + m.h &&
                y + n.height * v.zoom > m.y
              );
            })
            .map((n) => n.id),
        ]),
      ]);
    }
  };
  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesturePointer.current?.id === event.pointerId || touches.current.has(event.pointerId)) viewportMotion.stop();
    touches.current.delete(event.pointerId);
    if (pinch.current) {
      suppressClick.current = true;
      clickSequence.current = null;
      const element = capturedPointers.current.get(event.pointerId);
      capturedPointers.current.delete(event.pointerId);
      if (element?.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (touches.current.size >= 2) startPinch();
      else {
        pinch.current = null;
        const remaining = [...touches.current][0];
        if (remaining) {
          const rect = board.current!.getBoundingClientRect();
          gesturePointer.current = { id: remaining[0], type: "touch" };
          pan.current = { start: { x: remaining[1].x + rect.left, y: remaining[1].y + rect.top }, viewport: { ...docRef.current.viewport }, moved: true };
        } else {
          gesturePointer.current = null;
          setGesturing(false);
        }
      }
      return;
    }
    if (gesturePointer.current?.id === event.pointerId) {
      if (drag.current?.moved || resize.current?.moved) {
        pendingGeometryPoint.current = { x: event.clientX, y: event.clientY };
      }
      flushGeometryFrame();
    }
    if (!touches.current.size) touchSelection.current = null;
    if (gesturePointer.current?.id !== event.pointerId) return;
    if (drag.current?.moved || resize.current?.moved || pan.current?.moved || wireDrag.current?.moved || marquee) {
      suppressClick.current = true;
      clickSequence.current = null;
    } else {
      const key = drag.current?.clickId || (box.current ? "board" : null);
      const previous = clickSequence.current;
      clickSequence.current = key ? { key, at: performance.now(), count: previous?.key === key && performance.now() - previous.at < 600 ? previous.count + 1 : 1 } : null;
    }
    if (pan.current?.tapToClear && !pan.current.moved) {
      setSelected([]);
      setSelectedEdge(null);
      setInspectorOpen(false);
    }
    if (drag.current && !drag.current.moved && drag.current.inspectId) {
      const node = docRef.current.nodes.find(node => node.id === drag.current!.inspectId);
      if (node) {
        if (drag.current.deferInspect) deferCreatorOpen(node.id);
        else setInspectorMode("edit");
      }
    }
    if (drag.current && !drag.current.moved && drag.current.clickId && drag.current.keepSelectionOnClick) {
      setSelected(drag.current.ids);
    }
    if (wireDrag.current) {
      const w = wireDrag.current;
      if (w.moved) {
        const end = point(event.clientX, event.clientY);
        const target = wireEnd(end, w.from);
        if (target) finishConnection(w.from, target.node.id);
        else {
          setConnecting(null);
          setWireOrigin(null);
          setWirePoint(null);
          setWireTarget(null);
          // Only a genuinely empty drop area offers creation of the next node.
          if (!docRef.current.nodes.some(node => end.x >= node.x && end.x <= node.x + node.width && end.y >= node.y && end.y <= node.y + node.height)) openPicker(
            screenPoint(event.clientX, event.clientY),
            end,
            undefined,
            w.from,
          );
        }
      }
      wireDrag.current = null;
    }
    if (drag.current?.moved) {
      const movedIds = drag.current.selectionIds || drag.current.ids;
      const membership = drag.current.groupId
        ? rebuildGroupStateFromNodes(docRef.current.nodes, GROUP_PADDING)
        : reconcileGroupMembership(docRef.current.nodes, drag.current.before.nodes, drag.current.ids);
      const before = {
        ...docRef.current,
        nodes: restoreDraggedNodes(docRef.current.nodes, drag.current.before.nodes, movedIds),
        // Membership and frame geometry are part of the same gesture
        // snapshot. Restoring only node coordinates would leave a stale frame
        // after a node was dragged into or out of another group.
        groups: drag.current.before.groups,
      };
      dirty.current = true;
      setPast((items) => [...items.slice(-49), before]);
      setFuture([]);
      replaceDoc({ ...docRef.current, ...membership, updatedAt: now() });
      if (!preferencesRef.current.focusOnDrag) setSelected(drag.current.previousSelection || []);
    }
    if (resize.current?.moved) {
      const before = {
        ...docRef.current,
        nodes: restoreGeometry(
          docRef.current.nodes,
          resize.current.before.nodes,
          [resize.current.node.id],
          "resize",
        ),
      };
      dirty.current = true;
      setPast((items) => [...items.slice(-49), before]);
      setFuture([]);
      replaceDoc({ ...docRef.current, updatedAt: now() });
    }
    resize.current = null;
    drag.current = null;
    pan.current = null;
    box.current = null;
    gesturePointer.current = null;
    setMarquee(null);
    setGesturing(false);
    releasePointers();
  };
  const cancelGesture = (keepTouches = false) => {
    cancelDeferredCreator();
    viewportMotion.stop();
    // A cancelled gesture must not apply a queued frame after its snapshot is
    // restored. Pointer-up uses the complementary flush path above.
    cancelGeometryFrame();
    if (magneticFrame.current !== null) window.cancelAnimationFrame(magneticFrame.current);
    magneticFrame.current = null;
    pendingMagneticPoint.current = null;
    if (gesturePointer.current || pinch.current) {
      suppressClick.current = true;
      clickSequence.current = null;
    }
    if (resize.current?.moved)
      replaceDoc({
        ...docRef.current,
        nodes: restoreGeometry(
          docRef.current.nodes,
          resize.current.before.nodes,
          [resize.current.node.id],
          "resize",
        ),
        updatedAt: now(),
      });
    resize.current = null;
    if (drag.current?.moved) {
      const currentDrag = drag.current;
      if (!preferencesRef.current.focusOnDrag) setSelected(currentDrag.previousSelection || []);
      const movedIds = currentDrag.selectionIds || currentDrag.ids;
      replaceDoc({
        ...docRef.current,
        nodes: restoreDraggedNodes(docRef.current.nodes, currentDrag.before.nodes, movedIds),
        groups: currentDrag.before.groups,
        updatedAt: now(),
      });
    }
    drag.current = null;
    pan.current = null;
    if (box.current) {
      setSelected(box.current.before);
      setInspectorMode(box.current.inspector);
    }
    box.current = null;
    wireDrag.current = null;
    gesturePointer.current = null;
    pinch.current = null;
    if (!keepTouches) {
      touches.current.clear();
      touchSelection.current = null;
      releasePointers();
    }
    setMarquee(null);
    setConnecting(null);
    setWireOrigin(null);
    setWirePoint(null);
    setWireTarget(null);
    setNearConnection(null);
    setGesturing(false);
  };
  React.useEffect(() => () => cancelGeometryFrame(), []);
  React.useEffect(() => {
    // A file drag can finish outside the canvas, so the board never receives
    // its final dragend/dragleave event. Listen at the window boundary to
    // guarantee that the drop affordance cannot remain stuck after a canceled
    // or outside drop. Capture the drop before the board handler; clearing UI
    // state does not consume the event, so an in-board drop still imports.
    const clearOnWindowDragEnd = () => clearFileDrag();
    window.addEventListener("dragend", clearOnWindowDragEnd, true);
    window.addEventListener("drop", clearOnWindowDragEnd, true);
    window.addEventListener("blur", clearOnWindowDragEnd);
    const clearWhenHidden = () => {
      if (document.visibilityState !== "visible") {
        viewportMotion.stop();
        clearFileDrag();
      }
    };
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      window.removeEventListener("dragend", clearOnWindowDragEnd, true);
      window.removeEventListener("drop", clearOnWindowDragEnd, true);
      window.removeEventListener("blur", clearOnWindowDragEnd);
      document.removeEventListener("visibilitychange", clearWhenHidden);
      clearFileDrag();
    };
  }, [clearFileDrag]);
  React.useEffect(() => () => {
    if (viewportMoveTimer.current !== null) {
      window.clearTimeout(viewportMoveTimer.current);
      viewportMoveTimer.current = null;
    }
  }, []);
  React.useEffect(() => {
    const element = board.current!;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('textarea,input,select,[contenteditable="true"],video[controls],[data-canvas-video-player][data-interactive="true"],[data-canvas-media-player]')) return;
      event.preventDefault();
      if (gesturePointer.current || pinch.current || touches.current.size) return;
      clearZoomDraft();
      if (event.ctrlKey || event.metaKey || (preferencesRef.current.wheelDefaultAction === "zoom" && !event.shiftKey)) revealZoomIndicator();
      const rect = element.getBoundingClientRect();
      pointerScreen.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      pointerInside.current = true;
      viewportMotion.move(
        wheelViewport(viewportMotion.target("wheel"), event, pointerScreen.current, rect, { defaultAction: preferencesRef.current.wheelDefaultAction, panSensitivity: preferencesRef.current.panSensitivity }),
        { mode: "wheel" },
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [revealZoomIndicator, viewportMotion]);
  keyboardContextRef.current = {
    connecting,
    referencePickTarget,
    preview,
    overlay,
    toolMenu,
    setToolMenu,
    primary,
    selected,
    performNodeAction,
    focusToolSwitch,
    closeMenus,
    closeInspector,
    setOverlay,
    setPreview,
    setEditing,
    cancelGesture,
    setSpace,
    undo,
    redo,
    duplicate,
    copyNodes,
    pasteNodes,
    groupSelection,
    ungroupSelection,
    setSelected,
    setSelectedEdge,
    save,
    focusNodes,
    stepZoom,
    arrange,
    renameNode,
    selectedEdge,
    removeEdge,
    remove,
    changeTool,
    add,
  };
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const zoomDirection = zoomShortcutDirection(event);
      if (event.defaultPrevented || isComposingKey(event) || (event.repeat && event.code !== "Space" && !zoomDirection)) return;
      const context = keyboardContextRef.current;
      if (!context) return;
      const {
        connecting,
        referencePickTarget,
        preview,
        overlay,
        toolMenu,
        setToolMenu,
        primary,
        selected,
        performNodeAction,
        focusToolSwitch,
        closeMenus,
        closeInspector,
        setOverlay,
        setPreview,
        setEditing,
        cancelGesture,
        setSpace,
        undo,
        redo,
        duplicate,
        copyNodes,
        pasteNodes,
        groupSelection,
        ungroupSelection,
        setSelected,
        setSelectedEdge,
        save,
        focusNodes,
        stepZoom,
        arrange,
        renameNode,
        selectedEdge,
        removeEdge,
        remove,
        changeTool,
        add,
      } = context;
      if (
        !platformReadyRef.current ||
        leaving.current ||
        (event.target as HTMLElement)?.closest("[data-canvas-management]")
      )
        return;
      const videoPlayerTarget = (event.target as Element)?.closest('[data-canvas-video-player][data-interactive="true"],[data-canvas-media-player]');
      const videoGlobalShortcut = Boolean(videoPlayerTarget && isVideoPlayerGlobalShortcut(event));
      if (!referencePickTarget && videoPlayerTarget && !videoGlobalShortcut) return;
      const typing = (event.target as HTMLElement)?.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      if (event.key === "Escape") {
        if (referencePickTarget) {
          event.preventDefault();
          cancelReferencePick();
          focusCanvas();
          return;
        }
        if (gesturePointer.current || pinch.current || connecting) {
          event.preventDefault();
          cancelGesture();
          return;
        }
        if (preview) {
          event.preventDefault();
          setPreview(null);
          return;
        }
        if (overlay) {
          event.preventDefault();
          setOverlay(null);
          return;
        }
        if (appShell.current?.querySelector(".dock-drawer")) {
          event.preventDefault();
          setDrawer(null);
          return;
        }
        if (toolMenu) {
          event.preventDefault();
          setToolMenu(false);
          focusToolSwitch();
          return;
        }
        editCancelled.current = true;
        event.preventDefault();
        closeMenus();
        closeInspector();
        setOverlay(null);
        setPreview(null);
        setEditing(null);
        cancelGesture();
        return;
      }
      if (referencePickTarget) {
        // The picker owns the canvas while active. Keep normal focus traversal
        // and the banner/candidate button handlers working, but do not let a
        // Delete, shortcut, zoom, or tool key mutate the selected target
        // underneath the transient pick session.
        if (event.key === "Tab") return;
        const target = event.target as Element | null;
        if (target?.closest(".reference-pick-banner button")) return;
        event.preventDefault();
        return;
      }
      if ((typing && !videoGlobalShortcut) || overlay === "restore" || preview || (event.target as Element)?.closest(".canvas-floating-panel")) return;
      const interactiveTarget = (event.target as Element)?.closest(
        'button,a,[role="button"],[role="menuitem"],select',
      );
      if (
        !(event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "Enter" || event.code === "NumpadEnter") &&
        primary &&
        selected.length === 1 &&
        !interactiveTarget
      ) {
        event.preventDefault();
        performNodeAction(primary, { focusCreator: true });
        return;
      }
      if (event.code === "Space") {
        if ((event.target as Element).closest('button,a,[role="button"],[role="menuitemradio"]')) return;
        event.preventDefault();
        spacePressed.current = true;
        setSpace(true);
        return;
      }
      if (gesturePointer.current || pinch.current) return;
      if (zoomDirection) {
        event.preventDefault();
        stepZoom(zoomDirection);
        return;
      }
      const cmd = event.metaKey || event.ctrlKey,
        k = event.key.toLowerCase();
      if (cmd && k === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (cmd && k === "y") {
        event.preventDefault();
        redo();
      } else if (cmd && k === "d") {
        event.preventDefault();
        duplicate();
      } else if (cmd && k === "c") {
        event.preventDefault();
        copyNodes();
      } else if (cmd && k === "v") {
        event.preventDefault();
        pasteNodes();
      } else if (cmd && k === "g") {
        event.preventDefault();
        event.shiftKey ? ungroupSelection() : groupSelection();
      } else if (cmd && k === "a") {
        event.preventDefault();
        setSelected(docRef.current.nodes
          .filter((node) => !isCollapsedResultTask(node, docRef.current.nodes, docRef.current.edges))
          .map((node) => node.id));
        setSelectedEdge(null);
      } else if (cmd && k === "s") {
        event.preventDefault();
        void save();
      } else if (cmd && k === "0") {
        event.preventDefault();
        focusNodes();
      } else if (event.altKey && event.shiftKey && event.code === "KeyF") {
        event.preventDefault();
        arrange();
      } else if (!cmd && !event.altKey && !event.shiftKey && k === "f2" && primary) {
        event.preventDefault();
        renameNode(primary);
      } else if (!cmd && !event.altKey && !event.shiftKey && (k === "delete" || k === "backspace")) {
        event.preventDefault();
        selectedEdge ? removeEdge() : remove();
      } else if (!cmd && !event.altKey && !event.shiftKey && k === "v") changeTool("select");
      else if (!cmd && !event.altKey && !event.shiftKey && k === "h") changeTool("hand");
      else if (!cmd && !event.altKey && !event.shiftKey && k === "t") add("note");
    };
    const release = () => {
      spacePressed.current = false;
      setSpace(false);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    const blur = () => {
      release();
      cancelGesture();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, []);
  React.useEffect(() => {
    if (!picker && !zoomMenu && !toolMenu && !layoutMenu) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target as Element).closest(
          ".popover,.canvas-controls,.canvas-utilities,.selection-layout-control",
        )
      )
        closeMenus();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [picker, zoomMenu, toolMenu, layoutMenu]);
  React.useEffect(() => {
    if (overlay !== "restore" && !preview) return;
    const previous = document.activeElement as HTMLElement | null,
      el = modal.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]',
        ) || [],
      ).filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const all = focusable(),
        first = all[0],
        last = all.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    el?.addEventListener("keydown", trap);
    return () => {
      el?.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [overlay, Boolean(preview)]);
  React.useLayoutEffect(() => {
    if (!preview) {
      galleryFocusRestorePending.current = false;
      return;
    }
    if (!galleryFocusRestorePending.current) return;
    galleryFocusRestorePending.current = false;
    modal.current?.querySelector<HTMLButtonElement>('.media-preview-thumbnails [aria-current="true"]')?.focus({ preventScroll: true });
  }, [preview?.id]);

  const edgePathById = React.useMemo(() => {
    const paths = new Map<string, string>();
    for (const edge of renderedEdges) {
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      if (a && b) paths.set(edge.id, connectorPath(a, b, undefined, undefined, canvasPreferences.connectionStyle));
    }
    return paths;
  }, [nodeById, renderedEdges, canvasPreferences.connectionStyle]);
  const wireFrom = doc.nodes.find((n) => n.id === connecting),
    wireTo = doc.nodes.find((n) => n.id === wireTarget);
  const filtered = doc.nodes.filter(
    (node) =>
      (drawer === "tasks"
        ? node.type === "prompt" && Boolean(node.status || node.taskId)
        : drawer !== "assets" || isCanvasAsset(node) &&
          (assetFilter === "all" || assetType(node) === assetFilter)) &&
      `${node.title} ${node.text}`.toLowerCase().includes(query.toLowerCase()),
  );
  const primaryRole = primary ? resolveCanvasNodeRole(primary, doc.nodes) : null;
  const primaryCreator = primaryRole?.kind === "creator" ? primaryRole.creator : null;
  const selectMentionCandidate = React.useCallback(async (candidateId: string): Promise<PromptMentionAssetCandidate | false> => {
    const targetId = primaryCreator?.id;
    const documentId = docRef.current.id;
    const sessionKey = platformRevision;
    const checkSession = captureDocumentStorageSession(client.storage);
    if (!targetId || !docRef.current.nodes.some(node => node.id === targetId && node.type === "prompt")) return false;
    const existing = docRef.current.nodes.find(node => node.id === candidateId);
    const embedded = docRef.current.nodes.flatMap(node => node.embeddedReferences || []).find(reference => reference.id === candidateId);
    const candidateFromReference = (reference: { id: string; title: string; image?: string; imageThumbnail?: string; localImage?: string; assetId?: string; video?: string }) => ({
      id: reference.id,
      title: reference.title,
      type: "image" as const,
      source: "canvas" as const,
      image: reference.image,
      imageThumbnail: reference.imageThumbnail,
      localImage: reference.localImage,
      assetId: reference.assetId,
    });
    if (existing && existing.id !== targetId && (hasUsableCanvasReferenceImage(existing) || existing.localImage)) {
      commit(value => ({
        ...value,
        nodes: value.nodes.map(node => node.id === targetId ? { ...node, ignoreImageRefs: false } : node),
      }));
      return candidateFromReference({ id: existing.id, title: existing.title, image: existing.image, imageThumbnail: existing.imageThumbnail, localImage: existing.localImage, assetId: existing.assetId });
    }
    if (embedded) {
      commit(value => ({
        ...value,
        nodes: value.nodes.map(node => node.id === targetId ? { ...node, ignoreImageRefs: false } : node),
      }));
      return candidateFromReference(embedded);
    }
    const row = promptMentionAssets.rowById.get(candidateId);
    if (!row) return false;
    let resolved: Awaited<ReturnType<typeof promptMentionAssets.resolve>>;
    try {
      resolved = await promptMentionAssets.resolve(row);
      checkSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "素材原图暂不可用，请稍后重试。");
      return false;
    }
    const targetIsCurrent = () => docRef.current.id === documentId && sessionKey === platformRevisionRef.current
      && selectedRef.current.includes(targetId)
      && docRef.current.nodes.some(node => node.id === targetId && node.type === "prompt");
    if (!targetIsCurrent()) {
      setMessage("画布或创作节点已变化，请重新选择引用素材。");
      return false;
    }
    const target = docRef.current.nodes.find(node => node.id === targetId);
    if (!target) return false;
    const content = nodeFromLibraryAsset(row.asset, resolved.image, undefined, resolved.imageThumbnail);
    const imageProbe = resolved.imageThumbnail;
    const size = imageProbe ? await readImageNodeSize(imageProbe) : fitImageNodeSize(480, 480);
    checkSession();
    if (!targetIsCurrent()) return false;
    const node: CanvasNode = {
      ...content,
      id: uid("image"),
      type: "image",
      title: row.asset.name,
      color: COLORS[1],
      ...size,
      ...findFreePosition(docRef.current.nodes, { x: target.x - size.width - 80, y: target.y, ...size }),
    };
    commit(value => ({
      ...value,
      nodes: [...value.nodes.map(item => item.id === targetId ? { ...item, ignoreImageRefs: false } : item), node],
      groups: expandGroupFrames([...value.nodes, node], value.groups),
    }));
    setSelected([targetId]);
    setSelectedEdge(null);
    return candidateFromReference({ id: node.id, title: node.title, image: node.image, imageThumbnail: node.imageThumbnail, localImage: node.localImage, assetId: node.assetId });
  }, [commit, doc.id, platformRevision, primaryCreator?.id, promptMentionAssets, setMessage]);
  // A closed task stays a user-facing failure. Opening its editor performs
  // one silent read so an operator's later resolution can unlock retry,
  // without exposing reconciliation controls or restarting polling.
  const closedTaskViewKey = inspectorOpen && platformReady && primaryCreator?.mediaType === "video" &&
    primaryCreator.taskId && canvasTaskState(primaryCreator) === "failed" && canvasTaskRetryPolicy(primaryCreator).requiresConfirmation
      ? `${platformRevision}:${taskRecoveryKey(doc.id, primaryCreator.id, primaryCreator.taskId)}` : "";
  React.useEffect(() => {
    if (closedTaskViewKey && primaryCreator) void syncFailedVideoTask(primaryCreator);
  }, [closedTaskViewKey]);
  const primaryComposition =
    primaryCreator
      ? composePrompt(doc.nodes, doc.edges, primaryCreator.id)
      : null;
  const referencePickComposition = React.useMemo(
    () => referencePickTarget
      ? composePrompt(doc.nodes, doc.edges, referencePickTarget)
      : null,
    [doc.nodes, doc.edges, referencePickTarget],
  );
  const referencePickImages = React.useMemo(() => {
    const images = new Set<string>();
    for (const reference of referencePickComposition?.imageReferences || []) {
      if (reference.image) images.add(`image:${reference.image}`);
      if (reference.localImage) images.add(`local:${reference.localImage}`);
    }
    return images;
  }, [referencePickComposition]);
  const referencePickVideos = React.useMemo(() => {
    const videos = new Set<string>();
    for (const reference of referencePickComposition?.videoReferences || []) {
      if (reference.video) videos.add(`video:${reference.video}`);
      if (reference.localVideo) videos.add(`local:${reference.localVideo}`);
      if (reference.videoContentUrl) videos.add(`video:${reference.videoContentUrl}`);
      if (reference.assetId) videos.add(`asset:${reference.assetId}`);
    }
    return videos;
  }, [referencePickComposition]);
  const referencePickHasImage = (node: CanvasNode) =>
    Boolean(
      (node.image && referencePickImages.has(`image:${node.image}`)) ||
      (node.localImage && referencePickImages.has(`local:${node.localImage}`)),
    );
  const referencePickHasVideo = (node: CanvasNode) => Boolean(
    (node.video && referencePickVideos.has(`video:${node.video}`)) ||
    (node.localVideo && referencePickVideos.has(`local:${node.localVideo}`)) ||
    (node.videoContentUrl && referencePickVideos.has(`video:${node.videoContentUrl}`)) ||
    (node.assetId && referencePickVideos.has(`asset:${node.assetId}`)),
  );
  const referencePickAudios = React.useMemo(() => {
    const audios = new Set<string>();
    for (const reference of referencePickComposition?.videoReferences || []) {
      if (reference.audio) audios.add(`audio:${reference.audio}`);
      if (reference.localAudio) audios.add(`local:${reference.localAudio}`);
    }
    return audios;
  }, [referencePickComposition]);
  const referencePickHasAudio = (node: CanvasNode) => Boolean(
    (node.audio && referencePickAudios.has(`audio:${node.audio}`)) ||
    (node.localAudio && referencePickAudios.has(`local:${node.localAudio}`)),
  );
  // Reuse fingerprints while moving nodes; large reference images only hash when inputs change.
  const signatureCache = React.useRef(
    new Map<
      string,
      {
        prompt: string;
        model: string;
        ignored: boolean;
        settings: string;
        refs: { nodeId: string; image?: string; localImage?: string; video?: string; localVideo?: string; audio?: string; localAudio?: string; videoContentUrl?: string; assetId?: string }[];
        signature: string;
      }
    >(),
  );
  const creationStates = React.useMemo(() => {
    const result = new Map<
      string,
      { changed: boolean; referenceCount: number }
    >();
    // Build the graph indexes once for this immutable document snapshot. A
    // drag changes node geometry and therefore the array identity, but every
    // prompt still needs to walk the same graph; rebuilding the indexes per
    // prompt multiplied the work by the number of creators.
    const workflowIndex = createWorkflowIndex(doc.nodes, doc.edges);
    const keep = new Set<string>();
    for (const node of doc.nodes) {
      if (node.type !== "prompt") continue;
      keep.add(node.id);
      const composition = composePromptWithIndex(workflowIndex, node.id);
      const isMusicNode = node.mediaType === "audio";
      const refs: { nodeId: string; image?: string; localImage?: string; video?: string; localVideo?: string; audio?: string; localAudio?: string; videoContentUrl?: string; assetId?: string }[] = isMusicNode || node.ignoreImageRefs ? [] : node.mediaType === "video"
        ? [...composition.imageReferences, ...composition.videoReferences]
        : composition.imageReferences;
      const musicCompatible = isMusicNode ? compatibleMusicModels(models as any, node.musicReference ? "reference_audio" : "text") : [];
      const audioInputs = isMusicNode ? audioCreationInputs(node, models as any) : undefined;
      const compatible = isMusicNode ? [] : compatibleModels(models, node.mediaType === "video" ? "video" : "image", new Set(refs.map(ref => ref.image || ref.localImage || ref.video || ref.localVideo || ref.audio || ref.localAudio || ref.videoContentUrl || ref.assetId || ref.nodeId)).size);
      const selectedMediaModel = isMusicNode ? undefined : preferredModelForNode(models, node.mediaType === "video" ? "video" : "image", refs.length, node);
      const effectiveModel =
        (isMusicNode ? audioInputs?.model : selectedMediaModel?.id) ||
        (isMusicNode ? preferredMusicModel(musicCompatible)?.id : preferredModel(models, node.mediaType === "video" ? "video" : "image", refs.length)?.id) ||
        "";
      const effectiveSettings = isMusicNode
        ? audioInputs?.settings
        : node.mediaType === "video"
        ? resolveVideoSettings(selectedMediaModel || compatible[0], {
            duration: node.videoSettings?.duration ?? node.videoDuration,
            size: node.videoSettings?.size ?? node.videoSize,
            resolution: node.videoSettings?.resolution ?? node.videoResolution,
            aspect_ratio: node.videoSettings?.aspect_ratio ?? node.videoAspectRatio,
            generate_audio: node.videoSettings?.generate_audio ?? node.videoAudio,
          })
        : resolveImageSettings(selectedMediaModel, node.imageSettings);
      let changed = false;
      if (node.inputSignature) {
        const previous = signatureCache.current.get(node.id);
        const matches =
          previous &&
          previous.prompt === composition.prompt &&
          previous.model === effectiveModel &&
          previous.ignored === Boolean(node.ignoreImageRefs) &&
          previous.settings === JSON.stringify(effectiveSettings || {}) &&
          previous.refs.length === refs.length &&
          previous.refs.every(
            (ref, index) =>
              ref.nodeId === refs[index].nodeId &&
              (ref.image || ref.localImage || ref.video || ref.localVideo || ref.audio || ref.localAudio || ref.assetId || ref.videoContentUrl) ===
                (refs[index].image || refs[index].localImage || refs[index].video || refs[index].localVideo || refs[index].audio || refs[index].localAudio || refs[index].assetId || refs[index].videoContentUrl),
          );
        const signature = matches
          ? previous.signature
          : creationInputSignature({
              prompt: composition.prompt,
              model: effectiveModel,
              references: refs,
              settings: effectiveSettings,
            });
        if (!matches)
          signatureCache.current.set(node.id, {
            prompt: composition.prompt,
            model: effectiveModel,
            ignored: Boolean(node.ignoreImageRefs),
            settings: JSON.stringify(effectiveSettings || {}),
            refs,
            signature,
          });
        changed = node.inputSignature !== signature;
      }
      result.set(node.id, { changed, referenceCount: refs.length });
    }
    for (const id of signatureCache.current.keys())
      if (!keep.has(id)) signatureCache.current.delete(id);
    return result;
  }, [workflowRevision, models]);
  const latestResults = React.useMemo(() => {
    const result = new Map<string, CanvasNode>();
    for (const source of doc.nodes.filter((node) => node.type === "prompt")) {
      const results = latestCreatorResultsFor(source.id, doc.nodes, doc.edges).filter(hasMediaContent);
      const latest = results.at(-1);
      if (latest) result.set(source.id, latest);
    }
    return result;
  }, [workflowRevision]);
  const resultCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of doc.nodes.filter((node) => node.type === "prompt")) {
      const count = latestCreatorResultsFor(source.id, doc.nodes, doc.edges).filter(hasMediaContent).length;
      if (count) counts.set(source.id, count);
    }
    return counts;
  }, [workflowRevision]);
  const creatorPlacement = primaryCreator
    ? placeCreatorPanel(
        {
          x: primaryCreator.x * doc.viewport.zoom + doc.viewport.x,
          y: primaryCreator.y * doc.viewport.zoom + doc.viewport.y,
          width: primaryCreator.width * doc.viewport.zoom,
          height: primaryCreator.height * doc.viewport.zoom,
        },
        boardSize,
        // Audio creation uses a compact control rail, so give its footer enough
        // room while keeping image and video editors aligned to their nodes.
        { width: primaryCreator.mediaType === "audio" ? 600 : 480 },
      )
    : null;
  // `gesturing` covers both navigation and object manipulation. Keep the
  // editor visible for pan/pinch so it follows the selected node, while still
  // hiding it during a node drag, resize, marquee, or connection gesture.
  // Refs are updated before the gesture state is rendered, preventing the
  // one-frame flash that occurred when a pinch started before its first move.
  const editorHiddenDuringGesture = gesturing && !pan.current && !pinch.current;
  const guides = canvasPreferences.alignmentGuides && drag.current?.moved
    ? alignmentGuides(
        canvasNodes.length > 5000
          ? canvasNodes.filter((node) => isRectInViewport(node, doc.viewport, boardSize, viewportRenderMargin * 2))
          : canvasNodes,
        drag.current.selectionIds || drag.current.ids,
        doc.viewport.zoom,
      )
    : [];
  const gridStep = displayGridStep(canvasPreferences.gridSize, doc.viewport.zoom);
  const mini = minimapBounds(canvasNodes, doc.viewport, boardSize);
  const minimapPointerId = React.useRef<number | null>(null);
  const moveFromMinimap = (event: React.PointerEvent<SVGSVGElement>, direct = false) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height || !mini.width || !mini.height) return;
    const scale = Math.min(rect.width / mini.width, rect.height / mini.height);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const left = (rect.width - mini.width * scale) / 2;
    const top = (rect.height - mini.height * scale) / 2;
    const x = (event.clientX - rect.left - left) / scale + mini.x;
    const y = (event.clientY - rect.top - top) / scale + mini.y;
    const target = {
      ...doc.viewport,
      x: boardSize.width / 2 - x * doc.viewport.zoom,
      y: boardSize.height / 2 - y * doc.viewport.zoom,
    };
    if (direct) view(target);
    else navigateView(target);
  };
  const types: Array<{
    type: NodeType;
    title: string;
    detail: string;
    key: string;
    mediaType?: MediaType;
    action?: "upload";
    disabled?: boolean;
  }> = [
    {
      type: "note" as const,
      title: "文本",
      detail: "记录灵感、脚本与创作说明",
      key: "T",
    },
    {
      type: "prompt" as const,
      title: "图片生成",
      detail: "用文字或参考图生成图片",
      key: "",
    },
    {
      type: "prompt" as const,
      mediaType: "video" as const,
      title: "视频生成",
      detail: "用文字或参考图生成视频",
      key: "",
    },
    {
      type: "prompt" as const,
      mediaType: "audio" as const,
      title: "音乐生成",
      detail: "用文字和歌词生成音乐",
      key: "",
    },
    {
      type: "audio" as const,
      title: "媒体上传",
      detail: "上传图片、视频、音频",
      key: "",
      action: "upload" as const,
    },
    {
      type: "note" as const,
      title: "视频合成",
      detail: "视频剪辑与合成能力即将支持",
      key: "",
      disabled: true,
    },
    {
      type: "note" as const,
      title: "导演台",
      detail: "分镜与批量调度能力即将支持",
      key: "",
      disabled: true,
    },
    {
      type: "note" as const,
      title: "3D World",
      detail: "3D 场景能力即将支持",
      key: "",
      disabled: true,
    },
  ].filter(
    (item) =>
      !item.disabled &&
      `${item.title} ${item.detail}`.includes(pickerQuery),
  );
  const openBottomPicker = () => {
    closeDockPanels();
    if (picker) return setPicker(null);
    closeMenus();
    setPickerQuery("");
    setPicker({ screen: { x: 0, y: 0 }, world: centerPoint(), dock: true });
  };
  const pickerTop = picker ? Math.max(64, Math.min(
    boardSize.height - (picker.nodeId || picker.edgeId ? 260 : 288) - 80,
    picker.screen.y,
  )) : 64;
  const storageUsedBytes = Math.max(0, storageUsage?.used_bytes || 0);
  const storageReservedBytes = Math.max(0, storageUsage?.reserved_bytes || 0);
  const storageQuotaBytes = Math.max(0, storageUsage?.quota_bytes || 0);
  const storageAvailableBytes = Math.max(0, storageUsage?.available_bytes || 0);
  const storageConsumedBytes = storageUsedBytes + storageReservedBytes;
  const storagePercent = storageQuotaBytes
    ? Math.min(100, storageConsumedBytes / storageQuotaBytes * 100)
    : 0;
  // While a menu or slider change is animating, expose the requested endpoint
  // immediately so the thumb and readout reflect the user's intent.
  const zoomValue = zoomSliderActive && zoomDraft !== null
    ? zoomDraft / 100
    : clampZoom(viewportMotion.target("navigate").zoom);
  // The ruler is feedback for an active zoom gesture, not a second control.
  // Keep 100% centered while the red marker moves with the current value.
  const zoomRulerPosition = zoomIndicatorPosition(zoomValue);
  const zoomIndicatorVisible = zoomIndicatorActive;

  return (
    <div ref={appShell} className={`app-shell canvas-bg-${canvasPreferences.backgroundPreset} canvas-accent-${canvasPreferences.accent}${canvasPreferences.reduceMotion ? " canvas-reduce-motion" : ""}${canvasPreferences.nodeDensity === "compact" ? " canvas-density-compact" : ""}${!canvasPreferences.magneticSnap ? " canvas-no-magnet" : ""}`} aria-busy={navigating}
      // Freeze the displayed camera before a node, editor or toolbar receives
      // the press. Screen-space controls must be as easy to grab as the nodes.
      onPointerDownCapture={() => {
        viewportMotion.stop();
        cancelDeferredCreator();
      }}>
      {assetLibrary.draft && <AssetSaveModal
        key={assetLibrary.draft.row.asset.id}
        value={assetLibrary.draft.row.asset}
        editing={assetLibrary.draft.editing}
        busy={assetLibrary.saving}
        error={assetLibrary.draftError}
        preview={assetLibrary.draftPreview}
        knownTags={assetLibrary.knownTags}
        knownFolders={assetLibrary.knownFolders}
        onNotice={(text, action) => setMessage(text, action)}
        onSave={value => void assetLibrary.save(value)}
        onClose={assetLibrary.closeDraft}
      />}
      {navigating && (
        <div className="navigation-saving" role="status">
          <LoaderCircle className="spin" size={20} />
          正在保存画布…
        </div>
      )}
      <div
        className={`zoom-indicator${zoomIndicatorVisible ? " is-visible" : ""}`}
        role="img"
        aria-hidden={!zoomIndicatorVisible}
        aria-label={`当前画布缩放 ${Math.round(zoomValue * 100)}%，范围 ${MIN_ZOOM * 100}% 至 ${MAX_ZOOM * 100}%，顶部刻度仅作方向提示`}
      >
        <div className="zoom-ruler">
          <span
            className="zoom-ruler-marker"
            style={{ left: `${zoomRulerPosition}%` }}
            aria-hidden="true"
          />
          {ZOOM_RULER_TICKS.map((tick) => {
            const position = tick / (ZOOM_RULER_TICKS.length - 1) * 100;
            const active = position <= zoomRulerPosition;
            return (
              <i
                key={tick}
                className={`zoom-ruler-tick${active ? " is-active" : ""}`}
                style={{ left: `${position}%` }}
                aria-hidden="true"
              />
            );
          })}
          <strong
            className="zoom-indicator-value"
            style={{ left: `${zoomRulerPosition}%` }}
            aria-hidden="true"
          >
            {Math.round(zoomValue * 100)}%
          </strong>
        </div>
        <div className="zoom-ruler-labels" aria-hidden="true">
          <span>{MIN_ZOOM * 100}%</span>
          <span>{MAX_ZOOM * 100}%</span>
        </div>
      </div>
      <header className="topbar">
        <div className={`top-actions${cloudSync.error ? " has-save-error" : ""}`}>
          <button
            className={`save-status${cloudSync.error ? " is-error" : ""}`}
            title={saveStatus + " · 点击查看保存与恢复"}
            aria-label={saveStatus + "，查看保存与恢复"}
            onClick={() => setOverlay("settings")}
          >
            {cloudSync.error ? <CircleAlert size={14} /> : <i className={hydrated ? "online" : ""} />}
            <span className="save-status-text">{saveStatus}</span>
          </button>
          <button
            className="button"
            aria-label="保存画布"
            onClick={() => void save()}
          >
            <Save size={14} />
            <span>保存</span>
          </button>
          <button
            className="button"
            aria-label="导出画布"
            onClick={exportCanvas}
          >
            <ArrowDownToLine size={14} />
            <span>导出</span>
          </button>
        </div>
      </header>
      <main className="workspace">
        <div
          ref={board}
          tabIndex={-1}
          className={`canvas-board tool-${space ? "hand" : tool} ${gesturing ? "gesturing" : ""} ${gesturing && (pan.current || pinch.current) ? "is-panning" : ""} ${viewportMoving ? "is-viewport-moving" : ""} ${connecting ? "is-connecting" : ""} ${referencePickTarget ? `is-reference-picking${referencePickKind === "text" ? " is-reference-picking-text" : ""}` : ""} ${fileDragActive ? "is-file-dragging" : ""}`}
          aria-label={referencePickTarget ? `无限创作画布，${referencePickKind === "text" ? "文本引用" : "参考图"}拾取模式` : "无限创作画布"}
          onPointerDownCapture={pointerDownCapture}
          onPointerMoveCapture={(event) => {
            if (referencePickTarget) event.stopPropagation();
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerLeave={() => {
            // A port is a transient hover affordance. Clear it as soon as the
            // pointer leaves the board, including while a connection preview
            // is active; the source/target classes keep the actual wire
            // handles visible during the gesture.
            pointerInside.current = false;
            setNearConnection(null);
          }}
          onPointerUp={up}
          onPointerCancel={event => {
            if (gesturePointer.current?.id === event.pointerId || touches.current.has(event.pointerId)) cancelGesture();
          }}
          onLostPointerCapture={event => {
            if (capturedPointers.current.get(event.pointerId) === event.target) cancelGesture();
          }}
          onClickCapture={event => {
            if (referencePickTarget) {
              const target = event.target as Element;
              const article = target.closest<HTMLElement>("[data-node-id]");
              // A nested preview button can receive keyboard activation while
              // the card itself is in the Tab order. Treat that synthetic
              // click as the same pick action as pressing Enter on the card;
              // real pointer clicks were already handled on pointerdown.
              if (event.detail === 0 && article?.dataset.nodeId) {
                event.preventDefault();
                event.stopPropagation();
                if (referencePickKind === "text") chooseCanvasTextReference(article.dataset.nodeId);
                else chooseCanvasReference(article.dataset.nodeId);
                return;
              }
              if (!target.closest(".reference-pick-banner")) {
                // Candidate selection happens on pointerdown. Swallow the
                // synthesized click so an image preview button nested inside
                // the card cannot run after the reference has been attached.
                event.preventDefault();
                event.stopPropagation();
              }
              return;
            }
            if (suppressClick.current && event.detail !== 0) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
          onDoubleClick={(event) => {
            if (canvasPreferences.blankAreaAction !== "double" || tool !== "select" || spacePressed.current || clickSequence.current?.key !== "board" || clickSequence.current.count < 2) return;
            if ((event.target as Element).closest(".node,.edge")) return;
            openPicker(
              screenPoint(event.clientX, event.clientY),
              point(event.clientX, event.clientY),
            );
          }}
          onContextMenu={(event) => {
            if (referencePickTarget) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            // Canvas media uses custom controls, so it should use the same
            // node menu as every other canvas value instead of exposing the
            // browser's native media menu. Keep editable fields native so
            // text selection and input actions remain available.
            if ((event.target as Element).closest('input,textarea,select,[contenteditable="true"]')) return;
            if (canvasPreferences.blankAreaAction !== "context" && !(event.target as Element).closest(".node,.edge")) { event.preventDefault(); return; }
            event.preventDefault();
            blurCreator();
            cancelGesture();
            const edgeId = (event.target as Element).closest<SVGGElement>("[data-edge-id]")?.dataset.edgeId;
            if (edgeId) {
              // Edges are first-class selectable objects. Keep their context
              // menu separate from the node picker so a right click never
              // accidentally opens the add-node flow.
              setSelected([]);
              setSelectedEdge(edgeId);
              openPicker(
                screenPoint(event.clientX, event.clientY),
                point(event.clientX, event.clientY),
                undefined,
                undefined,
                edgeId,
              );
              return;
            }
            const id = (event.target as Element).closest<HTMLElement>(
              "[data-node-id]",
            )?.dataset.nodeId;
            if (id && !selected.includes(id)) {
              setSelected(event.altKey
                ? [id]
                : selectionForGroupMember(canvasNodes, id, selected, false));
            }
            openPicker(
              screenPoint(event.clientX, event.clientY),
              point(event.clientX, event.clientY),
              id,
            );
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (referencePickTarget) {
              clearFileDrag();
              return;
            }
            if (!hasFilePayload(event.dataTransfer)) return;
            event.dataTransfer.dropEffect = "copy";
            // A few WebKit versions omit dragenter when the drag starts over
            // a nested canvas child. Keep a single depth entry as a fallback;
            // regular dragover events never increase it repeatedly.
            if (fileDragDepth.current === 0) {
              fileDragDepth.current = 1;
              setFileDragActive(true);
            }
          }}
          onDragEnter={(event) => {
            if (referencePickTarget) {
              event.preventDefault();
              clearFileDrag();
              return;
            }
            if (!hasFilePayload(event.dataTransfer)) return;
            event.preventDefault();
            fileDragDepth.current += 1;
            setFileDragActive(true);
          }}
          onDragLeave={(event) => {
            // DataTransfer.items/types are allowed to be empty on dragleave.
            // Once the file affordance is active, trust the depth counter and
            // clear it even when the browser omits the payload metadata.
            if (
              !fileDragActive &&
              fileDragDepth.current === 0 &&
              !hasFilePayload(event.dataTransfer)
            ) return;
            event.preventDefault();
            const related = event.relatedTarget as Node | null;
            if (!related || !event.currentTarget.contains(related)) {
              clearFileDrag();
              return;
            }
            fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
            if (fileDragDepth.current === 0) clearFileDrag();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (referencePickTarget) {
              clearFileDrag();
              return;
            }
            if (!hasFilePayload(event.dataTransfer)) return;
            clearFileDrag();
            const at = point(event.clientX, event.clientY);
            const destination = (event.target as Element).closest<HTMLElement>(
              "[data-node-id]",
            )?.dataset.nodeId;
            const replace = docRef.current.nodes.find(
              (n) => n.id === destination && (n.type === "image" || n.type === "video" || n.type === "audio"),
            )?.id;
            Array.from(event.dataTransfer.files).forEach((item, index) =>
              importImage(item, {
                at: { x: at.x + index * 40, y: at.y + index * 40 },
                replace: index === 0 ? replace : undefined,
              }),
            );
          }}
          onDragEnd={() => {
            clearFileDrag();
          }}
        >
          {referencePickTarget && (() => {
            const pickTarget = docRef.current.nodes.find(item => item.id === referencePickTarget);
            const availableReferenceCount = canvasNodes.filter((candidate) => {
              if (candidate.id === referencePickTarget) return false;
              if (referencePickKind === "text") {
                return isCanvasTextReference(candidate) &&
                  !referencePickComposition?.textReferences.some((reference) => reference.nodeId === candidate.id) &&
                  canConnect(candidate.id, referencePickTarget, { allowCompletedPrompt: true });
              }
              return canUseCanvasReferenceFor(candidate, pickTarget) &&
                (!hasUsableCanvasReferenceImage(candidate) || imageLoadStates[candidate.id]?.status !== "failed") &&
                (!hasUsableCanvasReferenceImage(candidate) || imageLoadStates[candidate.id]?.status !== "recovering") &&
                !(hasUsableCanvasReferenceImage(candidate) ? referencePickHasImage(candidate) : hasUsableCanvasReferenceVideo(candidate) ? referencePickHasVideo(candidate) : referencePickHasAudio(candidate)) &&
                canConnect(candidate.id, referencePickTarget, { allowCompletedPrompt: true });
            }).length;
            return (
              <div className="reference-pick-banner" role="status" aria-live="polite">
                {referencePickKind === "text" ? <Type size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
                <span className="reference-pick-banner-copy">
                  <strong>{referencePickKind === "text" ? "引用文本" : "选择参考素材"}</strong>
                  <span>{referencePickKind === "text" ? "点击画布中高亮的文本节点" : "点击可用的图片、视频或音频节点"}</span>
                </span>
                <span className="reference-pick-banner-count" aria-label={availableReferenceCount > 0 ? `${availableReferenceCount} 个可选${referencePickKind === "text" ? "文本" : "素材"}` : `暂无可选${referencePickKind === "text" ? "文本" : "素材"}`}>
                  {availableReferenceCount > 0 ? `${availableReferenceCount} 个可选` : "暂无可选"}
                </span>
                <button type="button" onClick={() => { cancelReferencePick(); focusCanvas(); }}>取消<kbd aria-hidden="true">Esc</kbd></button>
              </div>
            );
          })()}
          {fileDragActive && (
            <div className="file-drop-overlay" role="status" aria-live="polite">
              <div className="file-drop-overlay-content">
                <Upload size={24} aria-hidden="true" />
                <strong>释放以上传媒体</strong>
                <small>支持图片、视频、音频</small>
              </div>
            </div>
          )}
          <div
            className="canvas-grid"
            style={{
              backgroundImage: !canvasPreferences.gridVisible
                ? "none"
                : canvasPreferences.gridStyle === "lines"
                  ? "linear-gradient(#ffffff12 1px, transparent 1px), linear-gradient(90deg, #ffffff12 1px, transparent 1px)"
                  : "radial-gradient(circle, #ffffff18 0.72px, transparent 0.95px)",
              backgroundSize: `${gridStep * doc.viewport.zoom}px ${gridStep * doc.viewport.zoom}px`,
              backgroundPosition: `${doc.viewport.x}px ${doc.viewport.y}px`,
            }}
          />
          <div
            className="world"
            style={{
              transform: `translate(${doc.viewport.x}px, ${doc.viewport.y}px) scale(${doc.viewport.zoom})`,
              // Keep the invisible click affordance usable while the visible
              // handle itself follows the world scale.
              ["--port-hit-scale" as string]: 1 / clampZoom(doc.viewport.zoom),
            }}
          >
            <svg className="connectors" aria-label="节点连接">
              <defs>
                <marker id="canvas-edge-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 7 4 L 0 7 z" style={{ fill: "context-stroke" }} />
                </marker>
              </defs>
              {showEdges &&
                renderedEdges.map((edge) => (
                  <g
                    key={edge.id}
                    data-edge-id={edge.id}
                    data-edge-from={edge.from}
                    data-edge-to={edge.to}
                    style={{ ["--edge-stroke" as string]: canvasPreferences.connectionColor === "accent" ? "var(--accent)" : canvasPreferences.connectionColor === "node" ? nodeById.get(edge.from)?.color : undefined }}
                    className={`edge ${selectedEdge === edge.id ? "selected" : ""} ${primary && (edge.from === primary.id || edge.to === primary.id) ? "related" : ""} ${removingEdgeIds.includes(edge.id) || removingNodeIds.includes(edge.from) || removingNodeIds.includes(edge.to) ? "is-removing" : viewportExitingEdgeIds.includes(edge.id) ? "is-viewport-removing" : ""}`}
                  >
                    <path
                      className="edge-hit"
                      d={edgePathById.get(edge.id) || ""}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (event.button !== 0) return;
                        if (spacePressed.current || tool === "hand")
                          return beginPan(event);
                        clearConnection();
                        setSelectedEdge(edge.id);
                        setSelected([]);
                        closeMenus();
                      }}
                    />
                    <path
                      className="edge-line"
                      pathLength={1}
                      d={edgePathById.get(edge.id) || ""}
                      style={{ markerEnd: canvasPreferences.showConnectionArrows ? "url(#canvas-edge-arrow)" : "none" }}
                    />
                  </g>
                ))}
              {canvasPreferences.connectionPreview && wireFrom && wirePoint && (
                <path
                  className="wire-preview"
                  d={wireTo
                    ? connectorPath(wireFrom, wireTo, wireOrigin || undefined, wirePoint, canvasPreferences.connectionStyle)
                    : connectorPath(wireFrom, {
                        x: wirePoint.x,
                        y: wirePoint.y,
                        width: 0,
                        height: 0,
                      }, wireOrigin || undefined, wirePoint, canvasPreferences.connectionStyle)}
                />
              )}
              {guides.map((guide, index) => <line key={`guide-${index}`} {...guide} className="alignment-guide" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
            </svg>
            {renderedGroupFrames.map((group) => (
              <div
                key={group.id}
                className={`node-group-frame${group.selected ? " selected" : ""}${viewportExitingGroupIds.includes(group.id) || exitingGroupFrames.some((frame) => frame.id === group.id && !groupFrames.some((current) => current.id === group.id)) ? " is-removing" : ""}`}
                style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
                aria-label={`节点组 · ${group.count} 个节点`}
                onPointerDown={(event) => groupFrameDown(event, group)}
              >
                <span>{group.label}</span>
              </div>
            ))}
            {renderedNodes.map((node) => {
              const interaction = nodeInteractionById.get(node.id) || nodeInteraction(node, doc.nodes, doc.edges, {
                hasPendingTask: isPending(node),
              });
              const role = resolveCanvasNodeRole(node, doc.nodes);
              const completedMedia = interaction.completedMedia;
              const retiredTTSCreator = node.type === "prompt" && node.mediaType === "audio" && isTTSNode(node);
              const visualType: NodeType = interaction.visualType;
              // Only editable workflow nodes can receive new connections.
              // Generated/imported media may still have legacy incoming edges,
              // but exposing an input handle on those value nodes suggested a
              // connection target that `canConnect` would reject.
              const canReceiveConnection = interaction.canReceiveConnection;
              // Port orientation must follow the same visible/bridged graph
              // that is rendered below. Raw edges can still point through a
              // collapsed task node and would place the handle toward a node
              // that is no longer on screen.
              const edgeTopology = edgeTopologyByNodeId.get(node.id);
              const incomingSource = edgeTopology?.incomingSource;
              const outgoingTarget = edgeTopology?.outgoingTarget;
              const hasIncomingPort = canReceiveConnection && Boolean(incomingSource);
              const nearNode = nearConnection?.nodeId === node.id;
              const exitingNode = exitingNearConnection?.nodeId === node.id;
              const activeSource = connecting
                ? nodeById.get(connecting)
                : undefined;
              const activeTarget = wireTarget
                ? nodeById.get(wireTarget)
                : undefined;
              const inputSide: PortSide =
                activeSource && wireTarget === node.id
                  ? connectorPortSide(activeSource, node, "target")
                  : incomingSource
                    ? connectorPortSide(incomingSource, node, "target")
                    : "left";
              const outputSide: PortSide =
                connecting === node.id && activeTarget
                  ? connectorPortSide(node, activeTarget, "source")
                  : outgoingTarget
                    ? connectorPortSide(node, outgoingTarget, "source")
                    : "right";
              // Resolve one actionable logical port for the single magnetic
              // position. Prefer the port whose normal side matches the
              // semicircle; if that port is occupied, fall back to the other
              // available port so a node never leaves a dead hover target.
              const canStartConnection = interaction.canStartConnection;
              const inputAvailable = canReceiveConnection;
              const outputAvailable = canStartConnection;
              const side = nearConnection?.side;
              const inputMatches = inputAvailable && side === inputSide;
              const outputMatches = outputAvailable && canUseNodePortSide(
                { canReceiveConnection: inputAvailable, canStartConnection: outputAvailable },
                side || outputSide,
                inputSide,
                outputSide,
              );
              const nearRole: "input" | "output" | null = !nearNode || !nearConnection
                ? null
                : inputMatches
                  ? "input"
                  : outputMatches
                    ? "output"
                    : inputAvailable
                      ? "input"
                      : outputAvailable
                        ? "output"
                        : null;
              const inputNear = nearRole === "input";
              const outputNear = nearRole === "output";
              const inputNearPosition = inputNear && nearConnection ? nearConnection : null;
              const outputNearPosition = outputNear && nearConnection ? nearConnection : null;
              const exitSide = exitingNearConnection?.side;
              const exitInputMatches = inputAvailable && exitSide === inputSide;
              const exitOutputMatches = outputAvailable && exitingNearConnection
                ? canUseNodePortSide(
                    { canReceiveConnection: inputAvailable, canStartConnection: outputAvailable },
                    exitSide || outputSide,
                    inputSide,
                    outputSide,
                  )
                : false;
              const exitRole: "input" | "output" | null = !exitingNode || !exitingNearConnection
                ? null
                : exitInputMatches
                  ? "input"
                  : exitOutputMatches
                    ? "output"
                    : inputAvailable
                      ? "input"
                      : outputAvailable
                        ? "output"
                        : null;
              const inputExit = !inputNear && exitRole === "input";
              const outputExit = !outputNear && exitRole === "output";
              const inputExitPosition = inputExit ? exitingNearConnection : null;
              const outputExitPosition = outputExit ? exitingNearConnection : null;
              const hasNearPort = inputNear || outputNear;
              const isPrimaryToolbarNode = interaction.showToolbar && primary?.id === node.id && !gesturing && !editing;
              const activeOrigin = connecting === node.id ? wireOrigin : null;
              const activeOriginSide: PortSide = activeOrigin
                ? activeOrigin.x <= node.x + node.width / 2 ? "left" : "right"
                : outputSide;
              const inputVisualSide: PortSide = inputNearPosition
                ? inputNearPosition.side
                : inputExitPosition
                  ? inputExitPosition.side
                : inputSide;
              const outputVisualSide: PortSide = activeOrigin
                ? activeOriginSide
                : outputNearPosition
                ? outputNearPosition.side
                : outputExitPosition
                  ? outputExitPosition.side
                : outputSide;
              const inputTop =
                wireTarget === node.id && wirePoint
                  ? wirePoint.y - node.y
                  : inputNearPosition
                    ? inputNearPosition.y - node.y
                    : inputExitPosition
                      ? inputExitPosition.y - node.y
                    : node.height / 2;
              const outputTop =
                activeOrigin
                  ? activeOrigin.y - node.y
                  : outputNearPosition
                  ? outputNearPosition.y - node.y
                  : outputExitPosition
                    ? outputExitPosition.y - node.y
                  : node.height / 2;
              const inputSnapPosition =
                wireTarget === node.id && wirePoint
                  ? wirePoint
                  : inputNearPosition || inputExitPosition;
              const outputSnapPosition = activeOrigin || outputNearPosition || outputExitPosition;
              // Keep the physical edge anchor stable and animate only the
              // local offset. This lets a magnetic port travel out from the
              // edge midpoint and return there before it fades away.
              const inputPortStyle = transientPortStyle(
                node,
                inputVisualSide,
                inputSnapPosition || { x: node.x + (inputVisualSide === "left" ? 0 : node.width), y: node.y + inputTop },
              );
              const outputPortStyle = transientPortStyle(
                node,
                outputVisualSide,
                outputSnapPosition || { x: node.x + (outputVisualSide === "left" ? 0 : node.width), y: node.y + outputTop },
              );
              const showNodeToolbar = interaction.showToolbar;
              const taskActive = activeIds.includes(node.id);
              const taskState = canvasTaskState(node, taskActive);
              const taskLabel = pendingTaskLabel(node, taskActive);
              const taskFailure = taskState === "failed"
                  ? mediaTaskUserFailure({
                    code: node.taskDiagnostic?.code,
                    message: node.error,
                    status: node.taskDiagnostic?.status || node.status,
                    phase: node.taskDiagnostic?.phase,
                    assetStatus: node.taskDiagnostic?.assetStatus,
                    supplierConfirmationState: node.taskDiagnostic?.supplierConfirmation?.state,
                    referenceCount: node.taskDiagnostic?.summary?.reference_count,
                  })
                : undefined;
              const mediaLabel = node.mediaType === "video" ? "视频" : node.mediaType === "audio" ? "音频" : "图片";
              const isTaskInProgress = ["queued", "running", "unknown", "reconciliation", "no_task_id"].includes(taskState);
              const videoUrl = runtimeVideoUrls[node.id] || [node.videoContentUrl, node.video].find(url => url && !videoSourceNeedsRefresh({ url, urlExpiresAt: node.videoContentUrlExpiresAt }));
              const audioUrl = audioSources.urls[node.id];
              const canRefetchVideo = Boolean(node.taskId || node.assetId) && canLoadVideoContent(node) && !/^(?:data|blob):/i.test(node.video || "");
              const videoInteractive = !referencePickTarget && tool === "select" && !space;
              const videoLoading = videoLoadingIds.includes(node.id);
              const videoLoadError = videoLoadErrors[node.id];
              const storedImageState = imageLoadStates[node.id];
              const imageLoadState = storedImageState?.source === (node.image || "")
                ? storedImageState
                : undefined;
              const imageUnavailable = imageLoadState?.status === "recovering" ||
                imageLoadState?.status === "failed";
              const imageThumbnail = displayImageThumbnail(node.image, node.imageThumbnail);
              const canRecoverImage = Boolean(
                node.taskId || node.localImage || isTemporaryMediaUrl(node.image),
              );
              const actionTarget = node.type === "prompt"
                ? latestResults.get(node.id) || node
                : node;
              const canPreviewTarget = interaction.canPreview && hasMediaContent(actionTarget);
              const primaryActionLabel = interaction.primaryAction === "preview" ? "预览" : "上传媒体";
              const mediaActions: MediaToolMenuGroup["items"] = [
                ...((actionTarget.mediaType || actionTarget.type) === "image" && (actionTarget.image || actionTarget.assetId || actionTarget.localImage) ? [{ id: "download-image", label: "下载图片", icon: Download, onSelect: () => void downloadImage(actionTarget) }] : []),
                ...(canLoadVideoContent(actionTarget) ? [{ id: "download-video", label: "下载视频", icon: Download, onSelect: () => void downloadVideo(actionTarget) }] : []),
                ...(canLoadAudioContent(actionTarget) ? [{ id: "download-audio", label: "下载音频", icon: Download, onSelect: () => void downloadAudio(actionTarget) }] : []),
                ...(visualType === "audio" && canLoadAudioContent(actionTarget) ? [{ id: "validate-audio", label: "校验音频", icon: ShieldCheck, disabled: audioSources.loading.includes(actionTarget.id) || validatingAudioIds.has(actionTarget.id), onSelect: () => void validateAudio(actionTarget) }] : []),
              ];
              const nodeActionGroups: MediaToolMenuGroup[] = [
                { label: "节点", items: [
                  ...(reusableNodeKind(actionTarget) ? [{ id: "save", label: reusableNodeKind(actionTarget) === "prompt" ? "保存提示词" : "保存为资产", icon: Save, onSelect: () => void assetLibrary.openNode(actionTarget) }] : []),
                  { id: "duplicate", label: "复制节点", icon: Copy, onSelect: () => duplicate([node.id]) },
                ] },
                ...(mediaActions.length ? [{ label: "媒体", items: mediaActions }] : []),
                { label: "管理", items: [{ id: "delete", label: "删除节点", icon: Trash2, danger: true, onSelect: () => remove([node.id]) }] },
              ];
              const referencePickDuplicate = Boolean(
                referencePickTarget && referencePickKind === "image" && canUseCanvasReferenceFor(node, docRef.current.nodes.find(item => item.id === referencePickTarget)) &&
                ([...(referencePickComposition?.imageReferences || []), ...(referencePickComposition?.videoReferences || [])].some(reference => sameCanvasReferenceValue(node, reference))),
              ) || Boolean(
                referencePickTarget && referencePickKind === "text" && isCanvasTextReference(node) &&
                referencePickComposition?.textReferences.some((reference) => reference.nodeId === node.id),
              );
              const referencePickCandidate = Boolean(referencePickTarget && (
                referencePickKind === "image"
                  ? canUseCanvasReferenceFor(node, docRef.current.nodes.find(item => item.id === referencePickTarget)) && (!hasUsableCanvasReferenceImage(node) || !imageUnavailable) && !referencePickDuplicate && canConnect(node.id, referencePickTarget, { allowCompletedPrompt: true })
                  : isCanvasTextReference(node) && !referencePickDuplicate && canConnect(node.id, referencePickTarget, { allowCompletedPrompt: true })
              ));
              // Older creator cards used a wide 480×270 task layout. Once a
              // result is attached, give the persisted node the same default
              // footprint as its media counterpart so old canvases converge
              // on the unified visual treatment as soon as they render.
              return (
              <article
                key={node.id}
                data-node-id={node.id}
                aria-label={`${displayNodeTitle(node)} · ${label(visualType, node.mediaType)}${referencePickTarget ? referencePickCandidate ? ` · 可${referencePickKind === "text" ? "引用文本" : "添加为参考素材"}` : referencePickDuplicate ? ` · 已${referencePickKind === "text" ? "引用文本" : "添加为参考素材"}` : ` · 不能${referencePickKind === "text" ? "引用文本" : "作为参考素材"}` : ""}`}
                role={referencePickTarget && (referencePickCandidate || referencePickDuplicate) ? "button" : undefined}
                tabIndex={referencePickTarget && (referencePickCandidate || referencePickDuplicate) ? 0 : undefined}
                aria-disabled={referencePickTarget ? (!referencePickCandidate || undefined) : undefined}
                title={referencePickTarget ? referencePickCandidate ? `点击${referencePickKind === "text" ? "引用文本" : "添加为参考素材"}` : referencePickDuplicate ? `已${referencePickKind === "text" ? "引用文本" : "添加为参考素材"}` : `不能${referencePickKind === "text" ? "引用文本" : "作为参考素材"}` : undefined}
                className={`node ${visualType} ${node.type === "prompt" && !completedMedia ? "task-node" : ""} ${node.groupId ? "grouped" : ""} ${selected.includes(node.id) ? "selected" : ""} ${isPrimaryToolbarNode ? "has-node-toolbar" : ""} ${removingNodeIds.includes(node.id) ? "is-removing" : viewportExitingNodeIds.includes(node.id) ? "is-viewport-removing" : ""} ${renderedNodeIdsRef.current.has(node.id) && !settledNodeIds.has(node.id) ? "is-viewport-returning" : ""} ${hasIncomingPort ? "has-incoming-port" : ""} ${connecting === node.id ? "connection-source" : ""} ${wireTarget === node.id ? "connection-target" : ""} ${hasNearPort ? "near-connection" : ""} ${drag.current?.moved && drag.current.movedIdSet.has(node.id) ? "is-dragging" : ""} ${node.type === "prompt" && latestResults.get(node.id)?.id !== node.id && latestResults.has(node.id) ? "task-collapsed" : ""} ${referencePickTarget ? (referencePickCandidate && !referencePickDuplicate ? "reference-pick-candidate" : "reference-pick-unavailable") : ""}`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                }}
                onPointerDown={(event) => nodeDown(event, node)}
                onKeyDown={(event) => {
                  if (!referencePickTarget || (!referencePickCandidate && !referencePickDuplicate)) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (referencePickKind === "text") chooseCanvasTextReference(node.id);
                  else chooseCanvasReference(node.id);
                }}
                onDoubleClick={event => {
                  event.stopPropagation();
                  cancelDeferredCreator();
                  if ((event.target as Element).closest('button,textarea,input,video[controls],audio[controls],[data-canvas-video-player],[data-canvas-media-player]') || tool !== "select" || spacePressed.current || event.detail !== 2) return;
                  const doubleClickAction = interaction.doubleClickAction;
                  performNodeAction(node, { action: doubleClickAction });
                }}
              >
                <div className={`node-caption ${visualType === "audio" && audioUrl ? "node-caption--audio-player" : ""}`}>
                  <span>
                    {icon(visualType)}
                    <span>{displayNodeTitle(node)}</span>
                  </span>
                  <small hidden={!canvasPreferences.showNodeStatus}>
                    {node.type === "prompt" && !completedMedia ? (
                      <span
                        className={`creation-state ${creationStates.get(node.id)?.changed ? "changed" : ""}`}
                      >
                        {creationStates.get(node.id)?.changed && (
                          <CircleAlert size={12} />
                        )}
                        {retiredTTSCreator && !latestResults.has(node.id)
                          ? "已停用"
                          : isPending(node) || activeIds.includes(node.id)
                          ? taskLabel
                          : creationStates.get(node.id)?.changed
                            ? "输入已更新"
                            : taskState === "failed"
                              ? "失败"
                              : latestResults.has(node.id)
                                ? "成功"
                                : "待生成"}
                      </span>
                    ) : visualType === "image" ? (
                      "图片"
                    ) : visualType === "video" ? (
                      "视频"
                    ) : visualType === "audio" ? (
                      "音频"
                    ) : (
                      "文本"
                    )}
                  </small>
                </div>
                {isPrimaryToolbarNode && (
                  <div
                    className="node-toolbar"
                    style={{ transform: `scale(${1 / doc.viewport.zoom})` }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <IconButton
                      label={role.kind === "creator" ? "编辑创作" : "节点属性"}
                      onClick={() => {
                        if (role.kind === "creator" && interaction.canEdit) {
                          performNodeAction(node, { action: node.type === "prompt" ? "create" : "edit" });
                        } else {
                          setSelected([node.id]);
                          setInspectorOpen(true);
                        }
                      }}
                    >
                      {role.kind === "creator" ? <SlidersHorizontal size={15} /> : <Settings2 size={15} />}
                    </IconButton>
                    {interaction.primaryAction !== "preview" && canPreviewTarget && (
                      <IconButton
                        label={assetType(actionTarget) === "video" ? "预览视频" : assetType(actionTarget) === "audio" ? "预览音频" : "预览图片"}
                        onClick={() => selectPreview(actionTarget)}
                      >
                        <Scan size={15} />
                      </IconButton>
                    )}
                    {visualType === "image" && actionTarget.image && (
                      <ImageTools
                        source={displayImageSource(actionTarget.image) || actionTarget.image}
                        title={displayNodeTitle(actionTarget)}
                        resolveSource={() => resolveImageToolSource(actionTarget)}
                        onNotice={(text) => setMessage(text)}
                        onApply={(outputs) => applyImageOperation(actionTarget, outputs)}
                      />
                    )}
                    {visualType === "video" && <VideoTools
                      source={videoUrl}
                      poster={node.videoPoster}
                      captureReady={videoCaptureReadyIds.has(actionTarget.id)}
                      duration={videoPlaybackStates[actionTarget.id]?.duration || 0}
                      currentTime={videoPlaybackStates[actionTarget.id]?.time || 0}
                      processBusy={videoProcessBusyIds.has(actionTarget.id)}
                      processProgress={videoProcessProgress[actionTarget.id] || 0}
                      processError={videoProcessErrors[actionTarget.id]}
                      onNotice={(text) => setMessage(text)}
                      onCapture={() => setVideoCaptureRequests(current => ({ ...current, [actionTarget.id]: (current[actionTarget.id] || 0) + 1 }))}
                      onProcess={options => startVideoProcess(actionTarget.id, options)}
                      onCancelProcess={() => cancelVideoProcess(actionTarget.id)}
                      onClearProcessError={() => clearVideoProcessError(actionTarget.id)}
                    />}
                    {visualType === "audio" && canLoadAudioContent(actionTarget) && <AudioTools
                      duration={audioPlaybackStates[actionTarget.id]?.duration || 0}
                      currentTime={audioPlaybackStates[actionTarget.id]?.time || 0}
                      busy={audioEditBusyIds.has(actionTarget.id)}
                      error={audioEditErrors[actionTarget.id]}
                      onProcess={range => void startAudioEdit(actionTarget.id, range)}
                      onCancel={() => cancelAudioEdit(actionTarget.id)}
                      onClearError={() => clearAudioEditError(actionTarget.id)}
                      onNotice={(text) => setMessage(text)}
                    />}
                    {interaction.primaryAction !== "none" && interaction.primaryAction !== "task" && interaction.primaryAction !== "create" && interaction.primaryAction !== "edit" && <button
                      className="node-generate"
                      onClick={() => performNodeAction(node)}
                    >
                      {interaction.primaryAction === "preview" ? <Scan size={14} /> : <Upload size={14} />}
                      {primaryActionLabel}
                    </button>}
                    {node.type !== "prompt" && <IconButton
                      label="继续创作"
                      onClick={() => addNext(node)}
                    >
                      <Sparkles size={15} />
                    </IconButton>}
                    <MediaToolMenu
                      label="节点操作"
                      triggerLabel="更多"
                      icon={MoreHorizontal}
                      className="node-actions-control"
                      groups={nodeActionGroups}
                    />
                  </div>
                )}
                <div className="node-surface">
                  {visualType === "audio" ? (
                    audioUrl ? <CanvasMediaPlayer kind="audio" shellClassName="node-audio" src={audioUrl} label={displayNodeTitle(node)} audioFormat={audioFormatForNode(node)} playbackScope={doc.id} preload="metadata" waveform={audioWaveform?.id === node.id && audioWaveform.identity === audioSourceIdentity(node) ? audioWaveform.peaks : undefined} onError={() => { audioSources.fail(node.id, "音频解码失败，可重试加载或下载原文件。"); setMessage("音频播放失败，可重试加载或下载原文件。"); }} onLoadedMetadata={event => { const audio = event.currentTarget as HTMLAudioElement; onAudioPlaybackStateChange(node.id, { duration: Number.isFinite(audio.duration) ? audio.duration : 0, time: audio.currentTime || 0 }); markMediaNodeLoaded(node.id); }} onTimeUpdate={event => { const audio = event.currentTarget as HTMLAudioElement; onAudioPlaybackStateChange(node.id, { duration: Number.isFinite(audio.duration) ? audio.duration : 0, time: audio.currentTime || 0 }); }} onPointerDown={(event) => { event.stopPropagation(); setSelected([node.id]); setSelectedEdge(null); }} /> : canLoadAudioContent(node) ? audioSources.loading.includes(node.id) ? <div className="image-empty audio-empty is-loading" role="status"><LoaderCircle size={22} className="spin" /><span>正在加载音频</span><small>读取完整文件后即可播放</small></div> : <button className="image-empty audio-empty" onPointerDown={event => event.stopPropagation()} onClick={() => void audioSources.load(node)}><Music2 size={30} /><span>{audioSources.errors[node.id] ? "重试加载" : "加载音频"}</span><small>{audioSources.errors[node.id] || "选中后加载完整音频"}</small></button> : <div className="image-empty audio-empty is-static" role="status"><Music2 size={30} /><span>暂无音频内容</span><small>上传音频或完成生成后可在这里播放</small></div>
                  ) : visualType === "video" ? (
                    videoUrl ? <CanvasVideo
                      hoverPreview={canvasPreferences.hoverVideoAutoplay}
                      selected={selected.includes(node.id)}
                      src={videoUrl}
                      poster={node.videoPoster}
                      label={displayNodeTitle(node)}
                      interactive={videoInteractive}
                      onLoadedData={(width, height) => {
                        markMediaNodeLoaded(node.id);
                        if (width > 0 && height > 0 && (node.type === "video" || node.mediaType === "video")) {
                          const size = fitVideoNodeSize(width, height);
                          const current = docRef.current.nodes.find(item => item.id === node.id);
                          if (current && (Math.abs(current.width / current.height - width / height) > 0.02 || current.width !== size.width || current.height !== size.height)) {
                            commit(value => {
                              const nodes = value.nodes.map(item => item.id === node.id ? { ...item, ...size } : item);
                              return { ...value, nodes, groups: expandGroupFrames(nodes, value.groups) };
                            });
                          }
                        }
                      }}
                      onSelect={() => { cancelDeferredCreator(); setSelected([node.id]); setSelectedEdge(null); }}
                      onPreview={() => { if (!referencePickTarget && tool === "select" && !spacePressed.current) selectPreview(node); }}
                      onCaptureFrame={frame => insertCapturedVideoFrame(node, doc.id, frame)}
                      captureRequest={videoCaptureRequests[node.id] || 0}
                      onCaptureRequestHandled={request => setVideoCaptureRequests(current => {
                        if (current[node.id] !== request) return current;
                        const next = { ...current };
                        delete next[node.id];
                        return next;
                      })}
                      onCaptureReadyChange={ready => onVideoCaptureReadyChange(node.id, ready)}
                      onPlaybackStateChange={state => onVideoPlaybackStateChange(node.id, state)}
                      processRequest={videoProcessRequests[node.id]}
                      processCancelRequest={videoProcessCancels[node.id] || 0}
                      onProcessRequestHandled={request => setVideoProcessRequests(current => {
                        if (current[node.id]?.id !== request) return current;
                        const next = { ...current }; delete next[node.id]; return next;
                      })}
                      onProcessProgress={(progress, request) => setVideoProcessProgress(current => videoProcessJobs.current.get(node.id) === request ? ({ ...current, [node.id]: progress }) : current)}
                      onProcessResult={saveVideoProcessResult}
                      onProcessError={(error, request) => {
                        if (videoProcessJobs.current.get(node.id) !== request) return;
                        clearVideoProcess(node.id, request);
                        if (error instanceof DOMException && error.name === "AbortError") return;
                        const message = error instanceof Error ? error.message : "视频处理失败，请稍后重试。";
                        setVideoProcessErrors(current => ({ ...current, [node.id]: message }));
                      }}
                      onReplace={node.type === "video" ? () => pickVideoReplacement(node) : undefined}
                      onRetry={canRefetchVideo ? () => retryVideoNode(node.id) : undefined}
                      onAutoRetry={canRefetchVideo ? () => autoRetryVideoNode(node.id, videoAutoRecoveryKey(node)) : undefined}
                      onNotice={(text, action) => setMessage(text, action)}
                      recoveryKey={videoAutoRecoveryKey(node)}
                    /> : node.videoPoster ? <button className="video-poster-button" aria-label={`选择视频节点，双击进入画廊：${displayNodeTitle(node)}`} title={videoLoadError ? "点击重试加载视频，双击打开画廊" : "双击打开画廊"} tabIndex={videoInteractive ? 0 : -1} style={{ pointerEvents: videoInteractive ? undefined : "none" }} onPointerDown={() => { if (videoInteractive) cancelDeferredCreator(); }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelDeferredCreator(); if (!referencePickTarget && tool === "select" && !spacePressed.current) selectPreview(node); }} onClick={(event) => { if (!videoInteractive) return; if (event.detail === 0) selectPreview(node); else if (videoLoadError) void loadVideoNode(node, true); }}><img className="node-video-poster" src={node.videoPoster} alt="视频首帧" draggable={false} onLoad={() => markMediaNodeLoaded(node.id)} /><span className="video-poster-play"><Film size={18} /></span><span className="video-poster-caption">{videoLoading ? "正在加载视频…" : videoLoadError ? "点击重试" : "视频预览"}</span></button> : (node.taskId || node.assetId || node.localVideo) ? <button className="image-empty video-empty" title={videoLoadError ? "点击重试加载视频，双击打开画廊" : "双击打开画廊"} aria-label={`选择视频节点，双击进入画廊：${displayNodeTitle(node)}`} tabIndex={videoInteractive ? 0 : -1} style={{ pointerEvents: videoInteractive ? undefined : "none" }} onPointerDown={() => { if (videoInteractive) cancelDeferredCreator(); }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelDeferredCreator(); if (!referencePickTarget && tool === "select" && !spacePressed.current && canLoadVideoContent(node)) selectPreview(node); }} onClick={(event) => { if (!videoInteractive) return; if (event.detail === 0 && canLoadVideoContent(node)) selectPreview(node); else if (videoLoadError) void loadVideoNode(node, true); }}><Film size={30} /><span>{videoLoading ? "正在加载视频…" : videoLoadError ? "视频加载失败" : "视频预览"}</span><small>{videoLoadError || "视频预览自动加载"}</small></button> : node.type === "video" ? <button className="image-empty video-empty" aria-label="上传视频" tabIndex={videoInteractive ? 0 : -1} style={{ pointerEvents: videoInteractive ? undefined : "none" }} onPointerDown={() => { if (videoInteractive) cancelDeferredCreator(); }} onClick={() => { if (videoInteractive) pickVideoReplacement(node); }}><Upload size={30} /><span>上传视频</span><small>MP4、WEBM、MOV、OGG · 最大 64 MB</small></button> : <div className="image-empty video-empty is-static" role="status"><Film size={30} /><span>暂无视频内容</span><small>完成视频生成后可在这里预览</small></div>
                  ) : visualType === "image" ? (
                    node.image && imageThumbnail && !imageUnavailable ? (
                      <button
                        type="button"
                        className="node-image-preview"
                        aria-label={`选择图片节点，双击进入画廊：${displayNodeTitle(node)}`}
                        title="单击选择，双击打开画廊"
                        onPointerDown={() => cancelDeferredCreator()}
                        onClick={(event) => {
                          event.stopPropagation();
                          // Keyboard activation remains an explicit preview
                          // affordance for accessibility. Pointer clicks only
                          // select the node; the second pointer gesture is
                          // handled by onDoubleClick below.
                          if (event.detail === 0 && !suppressClick.current) selectPreview(node);
                        }}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelDeferredCreator();
                          if (referencePickTarget || tool !== "select" || spacePressed.current) return;
                          selectPreview(node);
                        }}
                      >
                        <img
                          key={`${node.image}:${imageLoadState?.attempt || 0}`}
                          className="node-image"
                          src={imageThumbnail}
                          alt={displayNodeTitle(node)}
                          draggable={false}
                          loading="lazy"
                          decoding="async"
                          onLoad={(event) => imageLoaded(
                            node.id,
                            node.image!,
                            event.currentTarget.naturalWidth,
                            event.currentTarget.naturalHeight,
                          )}
                          onError={(event) => {
                            // Hide the browser's broken-image glyph immediately. The
                            // recovery state is rendered on the next commit and must
                            // never leave a failed thumbnail looking like an empty card.
                            event.currentTarget.style.visibility = "hidden";
                            void recoverImageNode(node, node.image!);
                          }}
                        />
                        <span className="node-image-preview-indicator" aria-hidden="true">
                          <Scan size={15} />
                        </span>
                      </button>
                    ) : imageLoadState?.status === "recovering" ? (
                      <div className="image-empty image-load-state is-static is-recovering" role="status" aria-live="polite">
                        <span className="image-load-state-icon"><LoaderCircle className="spin" size={24} /></span>
                        <span className="image-load-state-title">正在恢复图片</span>
                        <small>正在重新获取可用预览</small>
                      </div>
                    ) : imageLoadState?.status === "failed" && node.image ? (
                      <button
                        type="button"
                        className="image-empty image-load-state is-failed"
                        aria-label={`${imageLoadState.message || "图片加载失败"}，点击重试`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => canRecoverImage
                          ? void recoverImageNode(node, node.image!, true)
                          : pickImage(node.id, {
                              x: node.x + node.width / 2,
                              y: node.y + node.height / 2,
                            })}
                      >
                        <span className="image-load-state-icon">{canRecoverImage ? <ImageOff size={24} /> : <ImagePlus size={24} />}</span>
                        <span className="image-load-state-title">{imageLoadState.message || "图片加载失败"}</span>
                        <small>{canRecoverImage ? "点击重新获取缩略图" : "点击重新上传图片"}</small>
                      </button>
                    ) : node.image && isCosImageURL(node.image) && !imageThumbnail ? (
                      <div className="image-empty image-load-state is-static is-thumbnail-pending" role="status" aria-live="polite">
                        <span className="image-load-state-icon"><LoaderCircle className="spin" size={24} /></span>
                        <span className="image-load-state-title">正在获取缩略图</span>
                        <small>仅加载轻量预览，不会请求原图</small>
                      </div>
                    ) : (
                      <button
                        className="image-empty"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() =>
                          pickImage(node.id, {
                            x: node.x + node.width / 2,
                            y: node.y + node.height / 2,
                          })
                        }
                      >
                        <ImagePlus size={30} />
                        <span>添加参考图片</span>
                        <small>上传或拖入图片、视频、音频</small>
                      </button>
                    )
                  ) : node.type === "prompt" ? (
                    <div className={`creation-preview${latestResults.get(node.id) ? " has-result" : ""}${latestResults.get(node.id)?.id === node.id ? " has-inline-result" : ""}`}>
                      <div className="creation-task-label">
                        <span><Sparkles size={13} /> 创作任务</span>
                        <span className="creation-task-type">{node.mediaType === "video" ? "视频" : node.mediaType === "audio" ? "音频" : "图片"}</span>
                      </div>
                      {retiredTTSCreator && !latestResults.has(node.id) ? (
                        <div className="creation-placeholder">
                          <Music2 size={34} />
                          <span>此创作类型已停用</span>
                          <small>原有文本与任务信息已保留</small>
                        </div>
                      ) : taskState === "failed" ? (
                        <TaskFailureNotice
                          mediaLabel={mediaLabel}
                          title={taskFailure?.title || "生成任务未完成"}
                          advice={taskFailure?.advice || "可调整输入后重新生成。"}
                        />
                      ) : latestResults.get(node.id) ? (
                        latestResults.get(node.id)?.id === node.id && node.image && imageThumbnail ? (
                          <button
                            className="creation-inline-media"
                            title="单击选择，双击打开画廊"
                            onPointerDown={(event) => { event.stopPropagation(); cancelDeferredCreator(); }}
                            onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelDeferredCreator(); if (event.detail === 2 && !referencePickTarget && tool === "select" && !spacePressed.current) selectPreview(node); }}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (event.detail === 0) selectPreview(node);
                              else if (event.detail === 1) { setSelected([node.id]); setSelectedEdge(null); }
                            }}
                          >
                            <img
                              src={imageThumbnail}
                              alt="生成结果"
                              draggable={false}
                              loading="lazy"
                              decoding="async"
                              onLoad={(event) => { event.currentTarget.style.visibility = ""; imageLoaded(node.id, node.image!); }}
                              onError={(event) => {
                                event.currentTarget.style.visibility = "hidden";
                                void recoverImageNode(node, node.image!);
                              }}
                            />
                            <span><Check size={14} /> 成功 · 点击预览</span>
                          </button>
                        ) : latestResults.get(node.id)?.id === node.id && node.videoContentUrl ? (
                          <button
                            className="creation-inline-media"
                            title="单击选择，双击打开画廊"
                            onPointerDown={(event) => { event.stopPropagation(); cancelDeferredCreator(); }}
                            onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelDeferredCreator(); if (event.detail === 2 && !referencePickTarget && tool === "select" && !spacePressed.current) selectPreview(node); }}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (event.detail === 0) selectPreview(node);
                              else if (event.detail === 1) { setSelected([node.id]); setSelectedEdge(null); }
                            }}
                          >
                            <span className="creation-inline-video"><Film size={24} /></span>
                            <span><Check size={14} /> 成功 · 点击播放</span>
                          </button>
                        ) : (
                          <button
                            className="creation-result-link"
                            onPointerDown={(event) => { event.stopPropagation(); cancelDeferredCreator(); }}
                            onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelDeferredCreator(); const result = latestResults.get(node.id); if (event.detail === 2 && result && !referencePickTarget && tool === "select" && !spacePressed.current) selectPreview(result); }}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (event.detail === 0) {
                                const result = latestResults.get(node.id);
                                if (result) selectPreview(result);
                              } else if (event.detail === 1) {
                                setSelected([node.id]);
                                setSelectedEdge(null);
                              }
                            }}
                          >
                            <span className="creation-result-icon"><Check size={18} /></span>
                            <span className="creation-result-copy">
                              <strong>成功 · {resultCounts.get(node.id) || 1} 个结果</strong>
                              <small>输出已连接到右侧，点击查看结果</small>
                            </span>
                            {latestResults.get(node.id)?.image && displayImageThumbnail(latestResults.get(node.id)!.image, latestResults.get(node.id)!.imageThumbnail) && (
                              <img
                                className="creation-result-thumb"
                                src={displayImageThumbnail(latestResults.get(node.id)!.image, latestResults.get(node.id)!.imageThumbnail)}
                                alt="最新生成结果"
                                draggable={false}
                                onLoad={(event) => { event.currentTarget.style.visibility = ""; imageLoaded(latestResults.get(node.id)!.id, latestResults.get(node.id)!.image!); }}
                                onError={(event) => {
                                  event.currentTarget.style.visibility = "hidden";
                                  const result = latestResults.get(node.id);
                                  if (result?.image) void recoverImageNode(result, result.image);
                                }}
                              />
                            )}
                            <ArrowRight size={15} className="creation-result-arrow" />
                          </button>
                        )
                      ) : (
                        <div className="creation-placeholder">
                          {node.mediaType === "audio" ? <Music2 size={34} /> : node.mediaType === "video" ? <Film size={34} /> : <ImageIcon size={34} />}
                          <span>
                            {taskState === "running" || taskState === "unknown" || taskState === "reconciliation"
                                ? `${mediaLabel}生成中`
                                : taskState === "queued" || taskState === "no_task_id"
                                  ? `${mediaLabel}排队中`
                                  : node.mediaType === "audio" && node.audioMode === "recording"
                                    ? "打开录音，开始录制"
                                  : node.mediaType === "audio" && node.musicReference && (node.audioMode || "music") === "music"
                                    ? "参考音频已连接，准备生成"
                                  : creationStates.get(node.id)?.referenceCount
                                    ? "参考图已连接，准备生成"
                                    : "填写描述，开始创作"}
                          </span>
                          <small>提示词和参数会保存在此任务中</small>
                        </div>
                      )}
                      {isTaskInProgress && !retiredTTSCreator && (
                        <div className={`creation-progress is-${taskLabel === "排队中" ? "queued" : "running"}`} role="status">
                          {taskLabel === "排队中" ? <Clock3 size={18} /> : <LoaderCircle size={18} className="spin" />}
                          <span>{taskLabel}</span>
                          <small className="creation-progress-reference">{taskLabel === "排队中" ? "任务已进入队列，请稍候" : "完成后会自动更新结果"}</small>
                        </div>
                      )}
                      {node.text && (
                        <div
                          className="creation-prompt-summary"
                          title={node.text}
                        >
                          {node.text}
                        </div>
                      )}
                    </div>
                  ) : editing === node.id ? (
                    <textarea
                      autoFocus
                      className="inline-editor"
                      aria-label="编辑节点内容"
                      value={editText}
                      maxLength={20000}
                      onChange={(event) => setEditText(event.target.value)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onBlur={() => {
                        if (editing === node.id) {
                          if (!editCancelled.current)
                            update([node.id], { text: editText });
                          setEditing(null);
                        }
                      }}
                    />
                  ) : node.type === "note" ? (
                    <NoteNodePreview
                      text={node.text}
                      incomingCount={connectionCountsByNodeId.get(node.id)?.incoming || 0}
                      outgoingCount={connectionCountsByNodeId.get(node.id)?.outgoing || 0}
                      onEdit={() => startEdit(node)}
                      onCreate={() => addNext(node)}
                    />
                  ) : (
                    <div
                      className={`node-copy ${!node.text ? "placeholder" : ""}`}
                    >
                      {node.text || "双击记录你的想法…"}
                    </div>
                  )}
                  {["running", "queued", "unknown", "reconciliation", "no_task_id"].includes(taskState) && (
                    <div className="node-task">
                      <LoaderCircle size={13} className="spin" />
                      {taskLabel}
                    </div>
                  )}
                  {taskState === "failed" && node.type !== "prompt" && (
                    <div className="node-task failed">
                      失败
                    </div>
                  )}
                </div>
                {editing === node.id && (
                  <div
                    className="edit-actions"
                    onPointerDown={(event) => event.preventDefault()}
                  >
                    <button
                      onClick={() => {
                        editCancelled.current = true;
                        setEditing(null);
                      }}
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        update([node.id], { text: editText });
                        setEditing(null);
                      }}
                    >
                      <Check size={13} />
                      完成
                    </button>
                  </div>
                )}
                {primary?.id === node.id && !editing && (
                  <button
                    className="resize-handle"
                    style={{ transform: `scale(${1 / doc.viewport.zoom})` }}
                    aria-label="调整节点尺寸"
                    title={
                      node.type === "image" ? "拖动等比例缩放" : "拖动调整尺寸"
                    }
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      if (event.button !== 0) return;
                      clearConnection();
                      resize.current = {
                        start: point(event.clientX, event.clientY),
                        node: { ...node },
                        before: docRef.current,
                        moved: false,
                      };
                      claimPointer(event);
                    }}
                  />
                )}
                {canReceiveConnection && <button
                  className={`port port-in port-side-${inputVisualSide}${wireTarget === node.id ? " is-snapped" : ""}${inputNear ? " is-near" : ""}${inputExit ? " is-exiting" : ""}`}
                  style={inputPortStyle}
                  aria-label={`${node.title} 连接输入`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    blurCreator();
                    setNearConnection(null);
                    if (connecting) finishConnection(connecting, node.id);
                    else if (interaction.canEdit) {
                      setSelected([node.id]);
                      if (node.type === "prompt") {
                        setInspectorOpen(true);
                        setReferenceRequest((value) => value + 1);
                      } else {
                        setInspectorOpen(true);
                      }
                    }
                  }}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    if (connecting) finishConnection(connecting, node.id);
                    else if (interaction.canEdit) {
                      setSelected([node.id]);
                      if (node.type === "prompt") {
                        setInspectorOpen(true);
                        setReferenceRequest((value) => value + 1);
                      } else {
                        setInspectorOpen(true);
                      }
                    }
                  }}
                >
                  <Plus size={10} />
                </button>}
                {canStartConnection && <button
                  className={`port port-out port-side-${outputVisualSide}${outputNear ? " is-near" : ""}${outputExit ? " is-exiting" : ""}`}
                  style={outputPortStyle}
                  aria-label={`${node.title} 连接输出`}
                  onPointerDown={(event) => portDown(
                    event,
                    node,
                    outputVisualSide,
                    outputNearPosition || undefined,
                  )}
                  onClick={event => {
                    if (event.detail !== 0) return;
                    blurCreator();
                    setNearConnection(null);
                    setConnecting(node.id);
                    const origin = portPoint(
                      node,
                      outputVisualSide,
                      outputNearPosition || undefined,
                    );
                    setWireOrigin(origin);
                    setWirePoint(origin);
                    setSelected([node.id]);
                    setSelectedEdge(null);
                  }}
                  title="拖动连接；点击后选择目标节点"
                >
                  <Plus size={10} />
                </button>}
              </article>
              );
            })}
          </div>
          {marquee && (
            <div
              className="marquee"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
              }}
            />
          )}
          {canvasNodes.length === 0 && (
            <div
              className="empty-canvas"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <h1>开始创作</h1>
              <div className="empty-actions" role="group" aria-label="快速开始">
                <button className="button" onClick={() => add("prompt")}>
                  <Sparkles size={15} />
                  创建图片
                </button>
                <button className="button" onClick={() => add("prompt", undefined, undefined, "", "video")}>
                  <Film size={15} />
                  创建视频
                </button>
                <button className="button" onClick={() => add("prompt", undefined, undefined, "", "audio")}>
                  <Music2 size={15} />
                  创建音乐
                </button>
                <button className="button" onClick={() => pickMedia()}>
                  <Upload size={15} />
                  导入媒体
                </button>
              </div>
            </div>
          )}
        </div>
        {drawer && (
          <aside
            ref={dockDrawer}
            id="canvas-asset-panel"
            tabIndex={-1}
            className={`drawer canvas-floating-panel dock-drawer${drawer === "assets" && assetView === "library" ? " is-asset-library" : ""}`}
            aria-label={
              drawer === "tasks"
                ? "生成任务"
                : drawer === "layers"
                  ? "图层面板"
                  : "素材面板"
            }
          >
            <div className="panel-head">
              <div className="panel-tabs">
                <button
                  className={drawer === "layers" ? "active" : ""}
                  onClick={() => setDrawer("layers")}
                >
                  图层
                </button>
                <button
                  className={drawer === "assets" && assetView === "canvas" ? "active" : ""}
                  onClick={() => { setDrawer("assets"); setAssetView("canvas"); }}
                >
                  素材
                </button>
                <button className={drawer === "assets" && assetView === "library" ? "active" : ""} onClick={() => { setDrawer("assets"); setAssetView("library"); }}>资产库</button>
              </div>
              <IconButton
                label="关闭图层与素材"
                onClick={() => assetReferenceTarget.current ? returnToCreatorFromAssetLibrary() : setDrawer(null)}
              >
                <X size={16} />
              </IconButton>
            </div>
            {drawer === "assets" && assetView === "library" ? <AssetLibraryPanel
              key={platformRevision}
              rows={assetLibrary.rows} loading={assetLibrary.loading} error={assetLibrary.error}
              busyId={assetLibrary.busyId} hasMore={assetLibrary.hasMore}
              onLoadMore={() => void assetLibrary.load()} onRefresh={() => void assetLibrary.load(true)}
              onNotice={(text, action) => setMessage(text, action)}
              onFiltersChange={assetLibrary.setFilters}
              knownTags={assetLibrary.knownTags} knownFolders={assetLibrary.knownFolders}
              onInsert={row => void assetLibrary.insert(row)} onEdit={row => void assetLibrary.edit(row)} onSave={row => void assetLibrary.saveMembership(row)} onRemove={row => void assetLibrary.remove(row)}
              resolvePreview={assetLibrary.resolvePreview}
              onBackToCreator={assetReferenceTarget.current ? returnToCreatorFromAssetLibrary : undefined}
              audioReferenceSelection={assetReferenceTarget.current?.kind === "audio"}
            /> : <><label className="search-box">
              <Search size={15} />
              <input
                aria-label={drawer === "assets" ? "搜索素材" : "搜索节点"}
                placeholder={drawer === "assets" ? "搜索素材" : "搜索当前画布"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {drawer === "assets" && (
              <div className="asset-filters" role="tablist" aria-label="素材类型">
                {([['all', '全部'], ['image', '图片'], ['video', '视频'], ['audio', '音频']] as const).map(([value, text]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={assetFilter === value}
                    className={assetFilter === value ? "active" : ""}
                    onClick={() => setAssetFilter(value)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            <div className="layer-list">
              {filtered.length ? (
                filtered.map((node) => {
                  const taskDisplay = canvasTaskDisplayState(node, activeIds.includes(node.id));
                  const imageThumbnail = node.image
                    ? displayImageThumbnail(node.image, node.imageThumbnail)
                    : undefined;
                  return drawer === "assets" ? (
                    <div key={node.id} className={`asset-row ${selected.includes(node.id) ? "active" : ""}`}>
                      <button
                        className="asset-row-main"
                        onClick={() => {
                          setSelected([node.id]);
                          setSelectedEdge(null);
                          if (hasMediaContent(node)) selectPreview(node);
                          else reveal([node]);
                          if (boardSize.width < 700) setDrawer(null);
                        }}
                      >
                        {imageThumbnail ? <img src={imageThumbnail} alt="" onLoad={(event) => { event.currentTarget.style.visibility = ""; imageLoaded(node.id, node.image!); }} onError={(event) => { event.currentTarget.style.visibility = "hidden"; void recoverImageNode(node, node.image!); }} /> : node.image ? <ImageOff size={18} aria-hidden="true" /> : node.video ? <video src={node.video} muted preload="metadata" controls={false} tabIndex={-1} aria-hidden="true" /> : node.audio ? <Music2 size={18} /> : icon(node.type)}
                        <span>
                          {node.title}
                          <small>{assetType(node) === "video" ? "视频" : assetType(node) === "audio" ? "音频" : "图片"}{taskDisplay.active ? ` · ${taskDisplay.label}` : taskDisplay.state === "failed" ? " · 失败" : ""}</small>
                        </span>
                      </button>
                      <button className="asset-row-action" aria-label={`保存 ${node.title} 为资产`} title="保存为资产" onClick={() => void assetLibrary.openNode(node)}><Save size={14} /></button>
                      <button className="asset-row-action" aria-label={`继续使用 ${node.title}`} title="继续创作" onClick={() => addNext(node)}>
                        <Sparkles size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      key={node.id}
                      className={`layer-row ${selected.includes(node.id) ? "active" : ""}`}
                      onClick={() => {
                        setSelected([node.id]);
                        setSelectedEdge(null);
                        reveal([node]);
                        if (drawer === "tasks" && !isPending(node)) performNodeAction(node);
                        if (boardSize.width < 700) setDrawer(null);
                      }}
                    >
                      {imageThumbnail ? <img src={imageThumbnail} alt="" onLoad={(event) => { event.currentTarget.style.visibility = ""; imageLoaded(node.id, node.image!); }} onError={(event) => { event.currentTarget.style.visibility = "hidden"; void recoverImageNode(node, node.image!); }} /> : node.image ? <ImageOff size={18} aria-hidden="true" /> : icon(node.type)}
                      <span>
                        {node.title}
                        <small>
                          {taskDisplay.active ? taskDisplay.label : taskDisplay.state === "failed" ? "失败" : "成功"}
                        </small>
                      </span>
                      <LocateFixed size={14} />
                    </button>
                  );
                })
              ) : (
                <p className="panel-empty">
                  {drawer === "tasks"
                    ? "提交创作后，结果会自动回到画布。"
                    : drawer === "assets"
                      ? "导入的图片和生成结果会显示在这里"
                      : "没有匹配的节点"}
                </p>
              )}
            </div>
            {drawer === "tasks" && (
              <button
                className="button panel-upload"
                onClick={() => add("prompt")}
              >
                <Sparkles size={15} /> 新建图片创作
              </button>
            )}
            <div className="panel-foot">
              {drawer === "assets"
                ? `${doc.nodes.filter(isCanvasAsset).length} 个画布资产 · 单张结果收纳在创作节点`
                : `${doc.nodes.length} 个节点 · ${doc.edges.length} 条连接`}
            </div></>}
          </aside>
        )}
        <PresenceLayer
          open={Boolean(inspectorOpen && primary)}
          className="screen-editor-layer"
        >
          {primary && (primaryCreator && primaryComposition ? (
            <CreatorPanel
              key={primary.id}
              node={primaryCreator}
              style={
                creatorPlacement
                  ? {
                      left: creatorPlacement.left,
                      top: creatorPlacement.top,
                      width: creatorPlacement.width,
                      // Keep the editor attached while the viewport itself is
                      // panning/zooming. Node drags still hide it, but a
                      // canvas navigation gesture should move the fixed-size
                      // editor with its target instead of flashing it away.
                      visibility: editorHiddenDuringGesture ? "hidden" : undefined,
                    }
                  : { visibility: editorHiddenDuringGesture ? "hidden" : undefined }
              }
              inputChanged={creationStates.get(primaryCreator.id)?.changed || false}
              referenceRequest={referenceRequest}
              focusRequest={creatorFocusRequest}
              onFocusHandled={() => setCreatorFocusRequest(0)}
              onNotice={(text, action) => setMessage(text, action)}
              referenceCandidates={doc.nodes.filter(
                (node) =>
                  canUseCanvasReferenceFor(node, primaryCreator) &&
                  ![...primaryComposition.imageReferences, ...primaryComposition.videoReferences].some(ref => sameCanvasReferenceValue(node, ref)),
              )}
              mentionCandidates={doc.nodes.filter(
                (node) => isCanvasReferenceImage(node) && Boolean(node.image || node.localImage) && node.id !== primaryCreator.id,
              )}
              mentionAssetCandidates={promptMentionAssets.candidates}
              mentionAssetsLoading={promptMentionAssets.loading}
              mentionAssetsError={promptMentionAssets.error}
              mentionAssetsHasMore={promptMentionAssets.hasMore}
              onLoadMentionAssets={() => void promptMentionAssets.ensureLoaded()}
              onLoadMoreMentionAssets={() => void promptMentionAssets.loadMore()}
              onRetryMentionAssets={() => void promptMentionAssets.load(true)}
              onSelectMentionCandidate={selectMentionCandidate}
              referenceNaming={canvasPreferences.referenceNaming}
              onAddReference={(id) => addReference(primaryCreator.id, id)}
              onPickCanvasReference={() => beginReferencePick(primaryCreator.id)}
              onPickCanvasTextReference={() => beginReferencePick(primaryCreator.id, "text")}
              onUploadReference={() => uploadReference(primaryCreator)}
              onOpenAssetLibrary={() => { assetReferenceTarget.current = { nodeId: primaryCreator.id, documentId: doc.id, ...(primaryCreator.mediaType === "audio" ? { kind: "audio" as const } : {}) }; setDrawer("assets"); setAssetView("library"); setInspectorOpen(false); }}
              onDrawReference={() => openHandDraw(primaryCreator)}
              models={models}
              textReferences={primaryComposition.textReferences}
              references={primaryComposition.imageReferences}
              videoReferences={primaryComposition.videoReferences}
              sources={doc.edges
                      .filter((e) => e.to === primaryCreator.id)
                .map((e) => doc.nodes.find((n) => n.id === e.from)!)
                .filter(Boolean)}
              active={activeIds.includes(primaryCreator.id)}
              connecting={platformLoading}
              connectionError={authState === "connected" && primaryCreator.mediaType === "audio" ? primaryCreator.audioMode === "voice_design" ? voiceCatalogError : musicCatalogError : primaryCreator.mediaType === "video" && authState === "connected" ? videoCatalogError : connectionError}
              validationError={creationError?.id === primaryCreator.id ? creationError.message : undefined}
              needsLogin={authState === "required"}
              connectionActionLabel={platformActionLabel}
              modelPlaceholder={modelPlaceholder}
              onChange={(patch) => {
                setCreationError(null);
                const previousReference = primaryCreator.musicReference?.nodeId;
                if ("musicReference" in patch && previousReference && patch.musicReference?.nodeId !== previousReference) {
                  commit(value => ({ ...value, nodes: value.nodes.map(node => node.id === primaryCreator.id ? { ...node, ...patch } as CanvasNode : node), edges: value.edges.filter(edge => edge.from !== previousReference || edge.to !== primaryCreator.id) }));
                } else update([primaryCreator.id], patch as Partial<CanvasNode>);
              }}
              onGenerate={(inputChanged) => void generate(primaryCreator, inputChanged)}
              onCancel={primaryCreator.mediaType === "audio" ? () => void (isVoiceDesignNode(primaryCreator) ? cancelVoiceDesignCreator(primaryCreator) : cancelMusicCreator(primaryCreator)) : undefined}
              onSaveRecording={file => saveRecording(primaryCreator.id, file)}
              onUploadMusicReference={file => attachMusicReference(primaryCreator.id, file, file.name)}
              onSelectMusicReference={id => selectMusicReference(primaryCreator.id, id)}
              audioReferenceCandidates={doc.nodes.filter(node => node.id !== primaryCreator.id && canLoadAudioContent(node))}
              onGenerateLyrics={prompt => createLyrics(primaryCreator.id, prompt)}
              canceling={cancelingIds.includes(primaryCreator.id)}
              onRefresh={platformAction}
              onLocate={inspectSource}
              onDisconnect={(id) => disconnect(id, primaryCreator.id)}
              onClose={closeInspector}
            />
          ) : (
            <aside className="inspector" aria-label="节点属性">
              <div className="panel-head">
                <strong>{icon(primary.type)}节点设置</strong>
                <IconButton
                  label="关闭节点设置"
                  onClick={closeInspector}
                >
                  <X size={16} />
                </IconButton>
              </div>
              <div className="inspector-body">
                <Field
                  label="节点名称"
                  value={primary.title}
                  onCommit={(title) => update([primary.id], { title })}
                />
                <Field
                  label={primary.type === "image" ? "创作描述" : "内容"}
                  value={primary.text}
                  multiline
                  onCommit={(text) => update([primary.id], { text })}
                />
                {(primary.type === "image" || primary.type === "video" || primary.type === "audio") && (
                  <div className="panel-action-row">
                    {primary.type === "image" && <button
                      className="button"
                      onClick={() => pickImage(primary.id)}
                    >
                      <Upload size={15} />
                      替换图片
                    </button>}
                  </div>
                )}
              </div>
            </aside>
          ))}
        </PresenceLayer>
        <div
          className={`canvas-utilities${zoomMenu || (layoutMenu && layoutMenuAnchor === "utility") ? " has-zoom-menu" : ""}`}
          role="toolbar"
          aria-label="画布视图工具"
        >
          <IconButton label="适应画布 · ⌘0" onClick={() => { focusNodes(); closeZoomMenu(); }}>
            <Maximize2 size={16} />
          </IconButton>
          <div className="layout-control">
            <IconButton
              label="整理布局 · ⌥⇧F"
              active={layoutMenu}
              aria-haspopup="dialog"
              aria-expanded={layoutMenu}
              onClick={() => {
                closeDockPanels();
                closeMenus();
                setLayoutMenuAnchor("utility");
                setLayoutMenu(!layoutMenu);
                setPicker(null);
                closeZoomMenu();
              }}
            >
              <LayoutGrid size={15} />
            </IconButton>
            {layoutMenu && layoutMenuAnchor === "utility" && (
              <LayoutPopover
                scope={chosen.length > 1 ? "selected" : "all"}
                count={chosen.length > 1 ? chosen.length : doc.nodes.length}
                rows={layoutRows}
                sort={layoutSort}
                onRowsChange={setLayoutRows}
                onSortChange={setLayoutSort}
                onFlow={() => applyLayout("flow")}
                onGrid={() => applyLayout("grid")}
                onCustom={() => applyLayout("grid", chosen.length > 1 ? "selected" : "all", "custom")}
              />
            )}
          </div>
          <IconButton
            label="小地图"
            active={showMinimap}
            onClick={() => updateCanvasPreferences({ showMinimap: !showMinimap })}
          >
            <MapIcon size={15} />
          </IconButton>
          <span className="divider" aria-hidden="true" />
          <div className="zoom-wrap">
            <div
              className="zoom-control"
              aria-label={`画布缩放，当前 ${Math.round(zoomValue * 100)}%，范围 ${MIN_ZOOM * 100}% 至 ${MAX_ZOOM * 100}%`}
            >
              <span className="zoom-direction-mark zoom-direction-mark-min" aria-hidden="true">−</span>
              <button
                type="button"
                className="zoom-toggle"
                aria-label="缩放选项"
                aria-haspopup="dialog"
                aria-expanded={zoomMenu}
                onClick={() => {
                  closeDockPanels();
                  closeMenus();
                  setZoomMenu(!zoomMenu);
                }}
              >
                <Search size={13} aria-hidden="true" />
                <span>{Math.round(zoomValue * 100)}%</span>
                <ChevronDown size={10} aria-hidden="true" />
              </button>
              <span className="zoom-direction-mark zoom-direction-mark-max" aria-hidden="true">+</span>
            </div>
            {zoomMenu && (
              <div className="popover zoom-menu" role="dialog" aria-label="画布缩放" tabIndex={-1}>
                <div className="zoom-menu-content">
                  <div className="zoom-menu-slider-row">
                    <div
                      className="zoom-range-track"
                      style={{
                        "--zoom-progress": `${(zoomValue - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM) * 100}%`,
                        "--zoom-origin": `${(1 - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM) * 100}%`,
                      } as React.CSSProperties}
                    >
                      <input
                        className="zoom-range"
                        type="range"
                        min={MIN_ZOOM * 100}
                        max={MAX_ZOOM * 100}
                        step="1"
                        value={Math.round(zoomValue * 100)}
                        aria-label="画布缩放比例"
                        aria-valuetext={`${Math.round(zoomValue * 100)}%，可调整范围 ${MIN_ZOOM * 100}% 至 ${MAX_ZOOM * 100}%`}
                        onFocus={() => setZoomSliderActive(true)}
                        onBlur={clearZoomDraft}
                        onChange={event => {
                          const next = Math.round(Number(event.target.value));
                          setZoomSliderActive(true);
                          setZoomDraft(next);
                          zoomTo(next / 100, false);
                        }}
                      />
                      <span className="zoom-range-origin" aria-hidden="true" />
                    </div>
                    <output className="zoom-menu-value" aria-live="off">{Math.round(zoomValue * 100)}%</output>
                  </div>
                  {[0.5, 1].map((zoom) => (
                    <button type="button" key={zoom} onClick={() => { clearZoomDraft(); zoomTo(zoom, false); }}>
                      缩放至 {zoom * 100}%
                      {Math.abs(zoomValue - zoom) < 0.005 && <Check size={13} aria-hidden="true" />}
                    </button>
                  ))}
                  <button type="button" onClick={() => focusNodes()}>
                    适合屏幕<kbd>⌘ / Ctrl 0</kbd>
                  </button>
                  {chosen.length > 0 && (
                    <button type="button" onClick={() => focusNodes(chosen)}>
                      定位选中节点
                    </button>
                  )}
                  <span className="menu-separator" />
                  <button type="button" disabled={zoomValue >= MAX_ZOOM} onClick={() => stepZoom(1)}>
                    放大<kbd>⌘ / Ctrl +</kbd>
                  </button>
                  <button type="button" disabled={zoomValue <= MIN_ZOOM} onClick={() => stepZoom(-1)}>
                    缩小<kbd>⌘ / Ctrl −</kbd>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="canvas-controls" role="toolbar" aria-label="创作工具栏">
          <div className="canvas-control-group canvas-control-primary" role="group" aria-label="创建与移动">
          <IconButton
            label="添加节点"
            className="add-trigger"
            active={Boolean(picker && !picker.nodeId)}
            onClick={openBottomPicker}
          >
            <Plus size={23} />
          </IconButton>
          <div ref={toolMenuAnchor} className="tool-menu-wrap"
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setToolMenu(false);
            }}>
            <IconButton
              label={tool === "hand" || space ? "抓手工具 · H" : "移动 · V"}
              className="tool-switch"
              active
              aria-haspopup="menu"
              aria-expanded={toolMenu}
              aria-controls={toolMenu ? toolMenuId : undefined}
              onClick={() => { closeDockPanels(); closeMenus(); setToolMenu(!toolMenu); }}
              onKeyDown={event => {
                if (event.code === "Space") event.stopPropagation();
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault(); event.stopPropagation(); closeDockPanels(); closeMenus(); setToolMenu(true);
                }
              }}
            >
              {tool === "hand" || space ? <Hand size={18} /> : <MousePointer2 size={19} />}
              <ChevronDown size={8} className="tool-switch-chevron" aria-hidden="true" />
            </IconButton>
            {toolMenu && <div ref={toolMenuPanel} id={toolMenuId} className="popover tool-menu" role="menu" aria-label="画布工具"
              onKeyDown={event => {
                event.stopPropagation();
                const key = event.key.toLowerCase();
                if (key === "escape") {
                  event.preventDefault(); setToolMenu(false); focusToolSwitch();
                } else if (!event.metaKey && !event.ctrlKey && !event.altKey && (key === "v" || key === "h")) {
                  event.preventDefault(); selectNavigationTool(key === "h" ? "hand" : "select");
                } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                    : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
                  buttons[next]?.focus();
                }
              }}>
              <button type="button" role="menuitemradio" aria-checked={tool === "select"} className={tool === "select" ? "is-selected" : ""} onClick={() => selectNavigationTool("select")}>
                <MousePointer2 size={16} /><span>移动</span><kbd aria-hidden="true">V</kbd>
              </button>
              <button type="button" role="menuitemradio" aria-checked={tool === "hand"} className={tool === "hand" ? "is-selected" : ""} onClick={() => selectNavigationTool("hand")}>
                <Hand size={16} /><span>抓手工具</span><kbd aria-hidden="true">H</kbd>
              </button>
            </div>}
          </div>
          </div>
          <span className="divider" />
          <div className="canvas-control-group canvas-control-workspace" role="group" aria-label="工作区">
            <IconButton
              label={libraryOpen ? "收起画布列表" : "我的画布"}
              active={libraryOpen}
              aria-expanded={libraryOpen}
              aria-controls="canvas-library-panel"
              disabled={navigating}
              onClick={() => {
                closeMenus();
                onToggleLibrary();
              }}
            >
              {libraryOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </IconButton>
            <IconButton
              label="素材与图层"
              active={drawer === "assets" || drawer === "layers"}
              aria-expanded={drawer === "assets" || drawer === "layers"}
              aria-controls="canvas-asset-panel"
              onClick={() => drawer
                ? drawer === "assets" && assetReferenceTarget.current
                  ? returnToCreatorFromAssetLibrary()
                  : setDrawer(null)
                : toggleDockPanel(lastAssetTab.current)}
            >
              <Layers size={18} />
            </IconButton>
            <IconButton label="自定义画布" active={overlay === "settings"} aria-expanded={overlay === "settings"} aria-haspopup="dialog" onClick={() => toggleDockPanel("settings")}>
              <Settings2 size={18} />
            </IconButton>
          </div>
          <span className="divider" />
          <div className="canvas-control-group canvas-control-history" role="group" aria-label="编辑历史">
          <IconButton label="撤销 · ⌘Z" disabled={!past.length} onClick={undo}>
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="重做 · ⌘⇧Z"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 size={18} />
          </IconButton>
          </div>
          <span className="divider" />
          <IconButton className="canvas-control-help" label="快捷键与帮助" active={overlay === "help"} aria-expanded={overlay === "help"} aria-haspopup="dialog" onClick={() => toggleDockPanel("help")}>
            <Keyboard size={18} />
          </IconButton>
        </div>
        {(chosen.length > 1 || selectedEdge) && (
          <div
            ref={selectionActions}
            className={`selection-actions ${layoutMenu && layoutMenuAnchor === "selection" ? "has-layout-menu" : ""}`}
            data-positioned={chosen.length > 1 ? "false" : "true"}
          >
            <span>
              {selectedEdge ? "已选择连接" : `已选 ${chosen.length} 个节点`}
            </span>
            {!selectedEdge && (
              <>
                <button className="selection-action-button" onClick={selectedWholeGroup ? ungroupSelection : groupSelection} disabled={chosen.length < 2}>
                  {selectedWholeGroup ? <X size={15} /> : <Layers2 size={15} />}
                  {selectedWholeGroup ? "解组" : chosen.some((node) => node.groupId) ? "重新打组" : "打组"}
                </button>
                {chosen.some((node) => node.groupId) && !selectedWholeGroup && (
                  <IconButton label="取消分组" onClick={ungroupSelection}>
                    <X size={15} />
                  </IconButton>
                )}
                <div className="selection-layout-control">
                  <button className="selection-action-button" onClick={() => {
                    setLayoutMenuAnchor("selection");
                    setLayoutMenu((open) => !open);
                    setPicker(null);
                    closeZoomMenu();
                  }} disabled={chosen.length < 2} aria-haspopup="dialog" aria-expanded={layoutMenu && layoutMenuAnchor === "selection"}>
                    <LayoutGrid size={15} />
                    整理布局
                  </button>
                  {layoutMenu && layoutMenuAnchor === "selection" && (
                    <LayoutPopover
                      scope="selected"
                      count={chosen.length}
                      rows={layoutRows}
                      sort={layoutSort}
                      onRowsChange={setLayoutRows}
                      onSortChange={setLayoutSort}
                      onFlow={() => applyLayout("flow")}
                      onGrid={() => applyLayout("grid")}
                      onCustom={() => applyLayout("grid", "selected", "custom")}
                    />
                  )}
                </div>
                <IconButton label="定位选中节点" onClick={() => focusNodes(chosen)}>
                  <LocateFixed size={15} />
                </IconButton>
                <IconButton label="复制选中节点" onClick={() => duplicate()}>
                  <Copy size={15} />
                </IconButton>
                <IconButton label="导出选中节点" onClick={exportSelection}>
                  <ArrowDownToLine size={15} />
                </IconButton>
              </>
            )}
            <IconButton label={selectedEdge ? "删除连接" : "删除所选"} onClick={() => selectedEdge ? removeEdge() : remove()}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        )}
        {showMinimap && (
          <div className="minimap" role="group" aria-label="小地图导航">
            <IconButton
              className="minimap-close"
              label="关闭小地图"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => updateCanvasPreferences({ showMinimap: false })}
            >
              <X size={13} />
            </IconButton>
            <svg
              viewBox={`${mini.x} ${mini.y} ${mini.width} ${mini.height}`}
              role="application"
              aria-label="小地图导航，可点击或拖动定位画布"
              tabIndex={0}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                minimapPointerId.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
                moveFromMinimap(event);
              }}
              onPointerMove={(event) => {
                if (minimapPointerId.current !== event.pointerId) return;
                event.preventDefault();
                moveFromMinimap(event, true);
              }}
              onPointerUp={(event) => {
                if (minimapPointerId.current !== event.pointerId) return;
                event.stopPropagation();
                minimapPointerId.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={(event) => {
                if (minimapPointerId.current !== event.pointerId) return;
                event.stopPropagation();
                minimapPointerId.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                const step = 160 / doc.viewport.zoom;
                const target = { ...doc.viewport };
                if (event.key === "ArrowLeft") target.x += step;
                else if (event.key === "ArrowRight") target.x -= step;
                else if (event.key === "ArrowUp") target.y += step;
                else if (event.key === "ArrowDown") target.y -= step;
                else return;
                event.preventDefault();
                event.stopPropagation();
                view(target);
              }}
            >
              {canvasNodes.map((node) => (
                <rect
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={6}
                  className={selected.includes(node.id) ? "active" : ""}
                />
              ))}
              <rect
                className="minimap-viewport"
                x={-doc.viewport.x / doc.viewport.zoom}
                y={-doc.viewport.y / doc.viewport.zoom}
                width={boardSize.width / doc.viewport.zoom}
                height={boardSize.height / doc.viewport.zoom}
              />
            </svg>
          </div>
        )}
        <div className="canvas-hint">
          {connecting
            ? "拖至目标节点连接 · Esc 取消"
            : `${canvasPreferences.blankAreaAction === "double" ? "双击" : "右键"}创建节点 · 空格拖动画布`}
        </div>
        {picker && (
          <div
            ref={dockPicker}
            tabIndex={-1}
            className={`popover node-picker ${picker.dock ? "dock-node-picker" : ""} ${picker.nodeId || picker.edgeId ? "node-context" : ""}`}
            role={picker.nodeId || picker.edgeId ? "menu" : "dialog"}
            aria-label={picker.edgeId ? "连接操作菜单" : picker.nodeId ? "节点操作菜单" : "添加节点"}
            style={picker.dock ? undefined : {
              left: Math.max(
                8,
                Math.min(
                  boardSize.width - (picker.nodeId || picker.edgeId ? 238 : 252) - 12,
                  picker.screen.x,
                ),
              ),
              top: pickerTop,
              maxHeight: Math.max(0, boardSize.height - pickerTop - 80),
            }}
          >
            {picker.edgeId ? (
              <>
                {(() => {
                  const edge = docRef.current.edges.find((item) => item.id === picker.edgeId)
                    || canvasEdges.find((item) => item.id === picker.edgeId);
                  const from = edge && docRef.current.nodes.find((node) => node.id === edge.from);
                  const to = edge && docRef.current.nodes.find((node) => node.id === edge.to);
                  return (
                    <span className="menu-caption">
                      {from && to ? `${displayNodeTitle(from)} → ${displayNodeTitle(to)}` : "已选择连接"}
                    </span>
                  );
                })()}
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => removeEdge(picker.edgeId || selectedEdge)}
                >
                  <Trash2 size={16} />
                  删除连接<kbd>⌫</kbd>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setPicker(null);
                    setSelectedEdge(null);
                  }}
                >
                  <X size={16} />
                  取消选择
                </button>
              </>
            ) : picker.nodeId ? (
              <>
                <span className="menu-caption">{chosen.length > 1 ? `已选 ${chosen.length} 个节点` : primary?.title || "节点操作"}</span>
                {(chosen.length > 1 || primaryInteraction?.primaryAction !== "none") && <button
                  role="menuitem"
                  onClick={() => {
                    if (chosen.length > 1) {
                      selectedWholeGroup ? ungroupSelection() : groupSelection();
                      setPicker(null);
                      return;
                    }
                    const node = chosen[0];
                    if (!node) return;
                    performNodeAction(node);
                    setPicker(null);
                  }}
                >
                  {chosen.length > 1 ? (selectedWholeGroup ? <X size={16} /> : <Layers2 size={16} />) : (() => {
                    const node = chosen[0];
                    const action = node
                      ? nodeInteraction(node, docRef.current.nodes, docRef.current.edges, { hasPendingTask: isPending(node) }).primaryAction
                      : "edit";
                    return action === "task" ? <Clock3 size={16} />
                      : action === "preview" ? <Scan size={16} />
                        : action === "upload" ? <Upload size={16} />
                          : action === "none" ? <CircleAlert size={16} />
                            : action === "create" ? <Sparkles size={16} />
                              : <SlidersHorizontal size={16} />;
                  })()}
                  {chosen.length > 1
                    ? (selectedWholeGroup ? "解组" : chosen.some((node) => node.groupId) ? "重新打组" : "打组")
                    : (() => {
                        const node = chosen[0];
                        if (!node) return "编辑节点";
                        const action = nodeInteraction(node, docRef.current.nodes, docRef.current.edges, {
                          hasPendingTask: isPending(node),
                        }).primaryAction;
                        return action === "task"
                          ? pendingTaskLabel(node, activeIds.includes(node.id))
                          : action === "preview"
                            ? "预览结果"
                            : action === "create"
                              ? "继续创作"
                              : action === "upload"
                                ? "上传图片"
                                : action === "none"
                                  ? "暂无内容"
                                  : "编辑节点";
                      })()}
                </button>}
                {chosen.length === 1 && primary?.groupId && (
                  <button role="menuitem" onClick={() => { ungroupSelection(); setPicker(null); }}>
                    <X size={16} />
                    移出当前分组
                  </button>
                )}
                {chosen.length > 1 && (
                  <>
                    {chosen.some((node) => node.groupId) && !selectedWholeGroup && <button role="menuitem" onClick={() => { ungroupSelection(); setPicker(null); }}>
                      <X size={16} />
                      取消分组
                    </button>}
                    <button role="menuitem" onClick={() => { arrangeSelection(); setPicker(null); }}>
                      <LayoutGrid size={16} />
                      整理选中节点
                    </button>
                    <button role="menuitem" onClick={() => { exportSelection(); setPicker(null); }}>
                      <ArrowDownToLine size={16} />
                      导出选中节点
                    </button>
                    <span className="menu-separator" />
                  </>
                )}
                <button role="menuitem" onClick={() => copyNodes()}>
                  <Copy size={16} />
                  复制节点<kbd>⌘ / Ctrl + C</kbd>
                </button>
                {chosen.length === 1 && primary && (() => {
                  const mediaTarget = primary.type === "prompt" ? latestResults.get(primary.id) || primary : primary;
                  const hasImage = (mediaTarget.mediaType || mediaTarget.type) === "image" &&
                    (mediaTarget.image || mediaTarget.assetId || mediaTarget.localImage || mediaTarget.taskId);
                  return <>
                    {hasImage && <button role="menuitem" onClick={() => void copyImage(mediaTarget)}>
                      <FileImage size={16} />
                      复制图片
                    </button>}
                    {((mediaTarget.mediaType || mediaTarget.type) === "image" && (mediaTarget.image || mediaTarget.assetId || mediaTarget.localImage)) && <button role="menuitem" onClick={() => { setPicker(null); void downloadImage(mediaTarget); }}>
                      <Download size={16} />
                      下载图片
                    </button>}
                    {canLoadVideoContent(mediaTarget) && <button role="menuitem" onClick={() => { setPicker(null); void downloadVideo(mediaTarget); }}>
                      <Download size={16} />
                      下载视频
                    </button>}
                    {canLoadAudioContent(mediaTarget) && <button role="menuitem" onClick={() => { setPicker(null); void downloadAudio(mediaTarget); }}>
                      <Download size={16} />
                      下载音频
                    </button>}
                  </>;
                })()}
                <button role="menuitem" onClick={() => pasteNodes()} disabled={!nodeClipboard.current.length}>
                  <FolderOpen size={16} />
                  粘贴节点<kbd>⌘ / Ctrl + V</kbd>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    focusNodes(chosen);
                    setPicker(null);
                  }}
                >
                  <LocateFixed size={16} />
                  定位节点
                </button>
              </>
            ) : (
              <>
                <div className="picker-head">
                  <span>
                    {picker.sourceId ? "添加下一步 · 自动连接" : "添加节点"}
                  </span>
                  <IconButton
                    label="关闭添加节点"
                    onClick={() => setPicker(null)}
                  >
                    <X size={15} />
                  </IconButton>
                </div>
                <label className="search-box">
                  <Search size={14} />
                  <input
                    autoFocus
                    aria-label="搜索节点类型"
                    placeholder="搜索节点类型"
                    value={pickerQuery}
                    onChange={(event) => setPickerQuery(event.target.value)}
                  />
                </label>
                <div className="picker-list">
                  {types.length ? (
                      types.map((item) => (
                      <button key={`${item.title}-${item.mediaType || ""}`} disabled={item.disabled} className={item.disabled ? "is-disabled" : ""} onClick={() => {
                        if (item.disabled) return;
                        if (item.action === "upload") {
                          pickMedia();
                          return;
                        }
                        add(item.type, undefined, undefined, "", item.mediaType);
                      }}>
                        <span className={`type-icon ${item.type}`} aria-hidden="true">
                          {item.action === "upload" ? <Upload size={18} />
                            : item.mediaType === "video" ? <Film size={18} />
                            : item.mediaType === "audio" ? <Music2 size={18} />
                              : item.type === "prompt" ? <ImagePlus size={18} />
                                : <Type size={18} />}
                        </span>
                        <span className="picker-item-copy">
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        {item.key && <kbd>{item.key}</kbd>}
                      </button>
                    ))
                  ) : (
                    <p className="panel-empty">没有匹配的节点类型</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <span>{notice.text}</span>
            {notice.action && <button className="toast-action" onClick={() => { setMessage(""); notice.action?.run(); }}>{notice.action.label}</button>}
            <button aria-label="关闭提示" onClick={() => setMessage("")}>
              <X size={14} />
            </button>
          </div>
        )}
      </main>
      <input
        ref={file}
        type="file"
        hidden
        accept="image/*,video/*,audio/*"
        onChange={(event) => {
          const input = event.target.files?.[0];
          if (input) importImage(input);
          event.target.value = "";
        }}
      />
      <PresenceLayer
        open={Boolean(overlay || preview)}
        className={overlayPresentation.current ? "canvas-floating-layer" : preview ? "modal-backdrop media-preview-backdrop" : "modal-backdrop"}
        onMouseDown={() => {
          if (overlayPresentation.current) return;
          setOverlay(null);
          setPreview(null);
        }}
      >
          <div
            ref={modal}
            className={`modal ${floatingOverlay ? "canvas-floating-panel" : ""} ${preview ? "image-modal" : ""} ${overlay === "help" ? "help-modal" : ""} ${overlay === "settings" ? "canvas-settings-modal" : ""}`}
            role="dialog"
            aria-modal={floatingOverlay ? undefined : true}
            tabIndex={-1}
            aria-label={
              preview
                ? preview.type === "audio" || preview.mediaType === "audio" ? "音频预览" : preview.type === "video" || preview.mediaType === "video" ? "视频预览" : "图片预览"
                : overlay === "help"
                  ? "快捷键与帮助"
                  : overlay === "restore"
                    ? "恢复画布"
                    : "自定义画布"
            }
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (!previewNavigation || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as HTMLElement).closest('video,input,textarea,select,[contenteditable="true"]')) return;
              const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
              if (!direction || previewNavigation.items.length < 2) return;
              event.preventDefault();
              event.stopPropagation();
              const next = previewNavigation.items[previewNavigation.index + direction];
              if (next) selectGalleryPreview(next);
            }}
          >
            {preview ? (
              <div className="media-preview-topbar" onMouseDown={event => event.stopPropagation()}>
                <IconButton
                  label={preview.type === "audio" || preview.mediaType === "audio" ? "下载音频" : preview.type === "video" || preview.mediaType === "video" ? "下载视频" : "下载图片"}
                  disabled={!preview.image && !canLoadAudioContent(preview) && !canLoadVideoContent(preview)}
                  onClick={() => void (preview.type === "audio" || preview.mediaType === "audio" ? downloadAudio(preview) : preview.type === "video" || preview.mediaType === "video" ? downloadVideo(preview) : downloadImage(preview))}
                >
                  <Download size={16} />
                </IconButton>
                <IconButton
                  label="关闭画廊"
                  onClick={() => {
                    setOverlay(null);
                    setPreview(null);
                  }}
                >
                  <X size={17} />
                </IconButton>
              </div>
            ) : (
              <div className="panel-head">
                <strong>
                  {overlay === "help"
                    ? "快捷键与帮助"
                    : overlay === "restore"
                      ? "恢复画布"
                      : "自定义画布"}
                </strong>
                {overlay === "settings" && <button
                  type="button"
                  className="canvas-settings-reset"
                  onClick={() => setCanvasPreferences(resetCanvasPreferences())}
                >恢复默认</button>}
                <IconButton
                  label={floatingOverlay ? "关闭浮窗" : "关闭对话框"}
                  onClick={() => {
                    setOverlay(null);
                    setPreview(null);
                  }}
                >
                  <X size={17} />
                </IconButton>
              </div>
            )}
            {preview && previewNavigation ? (
              <MediaPreview
                node={preview.type === "audio" || preview.mediaType === "audio" ? { ...preview, audio: audioSources.urls[preview.id] } : preview}
                {...previewNavigation}
                resolveImageSource={displayImageSource}
                resolveImageThumbnail={displayImageThumbnail}
                shouldRefreshImageOriginal={Boolean(preview.image && mediaUrlNeedsRefresh(preview.image))}
                videoContentLoading={videoLoadingIds.includes(preview.id) ? true : undefined}
                videoContentError={videoLoadErrors[preview.id]}
                audioContentLoading={audioSources.loading.includes(preview.id)}
                audioContentError={audioSources.errors[preview.id]}
                onAudioRetry={() => audioSources.load(docRef.current.nodes.find(node => node.id === preview.id) || preview, true)}
                onImageLoaded={source => imageLoaded(preview.id, source)}
                error=""
                onSelect={selectGalleryPreview}
                onVideoRetry={() => {
                  setExportError("");
                  return retryVideoNode(preview.id);
                }}
                onImageRetry={() => {
                  return recoverImageNode(preview, preview.image || "", true).then(() => undefined);
                }}
                onImageOriginalRequest={async () => {
                  if (!preview.assetId && !preview.taskId) return displayImageSource(preview.image) || preview.image;
                  const recovered = await recoverImageNode(preview, preview.image || "", true);
                  return recovered?.image;
                }}
                onLocate={id => {
                  const source = docRef.current.nodes.find(node => node.id === id);
                  if (!source) return;
                  setPreview(null);
                  setInspectorMode(null);
                  setSelected([id]);
                  setSelectedEdge(null);
                  setDrawer(null);
                  closeMenus();
                  reveal([source], true);
                }}
              />
            ) : overlay === "restore" ? (
              <div className="settings-content restore-options">
                <p>
                  选择继续哪份画布。切换前的版本会保留，可在项目菜单中恢复。
                </p>
                <article>
                  <h3>{isSessionOnlyStorage() ? "当前画布" : "本机画布"} · {doc.name}</h3>
                  <p>
                    {doc.nodes.length} 个节点 ·{" "}
                    {new Date(doc.updatedAt).toLocaleString()}
                  </p>
                  <button className="button" onClick={() => void enableSync()}>
                    继续当前画布并同步到云端
                  </button>
                </article>
                {cloudCandidate && (
                  <article>
                    <h3>云端画布 · {cloudCandidate.name}</h3>
                    <p>
                      {cloudCandidate.nodes.length} 个节点 ·{" "}
                      {new Date(cloudCandidate.updatedAt).toLocaleString()}
                    </p>
                    <button className="button" onClick={() => void useCloud()}>
                      恢复云端画布
                    </button>
                  </article>
                )}
                <button
                  className="text-button"
                  onClick={() => {
                    setOverlay(null);
                    setSyncEnabled(false);
                  }}
                >
                  {isSessionOnlyStorage() ? "暂时仅在当前页面继续（关闭前请导出）" : "暂时只在本机继续"}
                </button>
              </div>
            ) : overlay === "help" ? (
              <div className="help-content">
                <p className="help-intro">常用操作按场景整理，按下对应快捷键即可。</p>
                <div className="help-grid">
                  {shortcutGroups.map((group) => (
                    <section className="help-group" key={group.title}>
                      <h3>{group.title}</h3>
                      {group.items.map((item) => (
                        <div className="help-row" key={item.label}>
                          <span>{item.label}</span>
                          <span className="shortcut-keys">
                            {item.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                          </span>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </div>
            ) : (
              <div className="settings-content">
                <CanvasSettingsPanel
                  value={canvasPreferences}
                  onChange={updateCanvasPreferences}
                >
                <section className="save-details account-storage-section">
                  <div className="account-storage-title">
                    <h3>平台账户与媒体空间</h3>
                    <span>连接与容量</span>
                  </div>
                  <div className="account-storage-block">
                  <h4>平台账户</h4>
                  {platformProfile ? (
                    <div className="platform-account-identity" aria-label="当前平台账户">
                      <span className="platform-account-avatar" aria-hidden="true">
                        {platformAccountInitial}
                      </span>
                      <span className="platform-account-details">
                        <strong>{platformAccountName}</strong>
                        {platformAccountEmail && <span>{platformAccountEmail}</span>}
                      </span>
                    </div>
                  ) : platformLoading && authState === "connected" ? (
                    <p className="platform-account-placeholder">正在读取账户资料…</p>
                  ) : null}
                  <p className={`platform-account-status${authState === "connected" ? " is-connected" : authState === "required" ? " is-required" : ""}`} role="status">
                    {authState === "connected"
                      ? platformLoading ? "正在检查连接并更新账户和模型…" : platformProfileError || "已连接平台账户"
                      : authState === "required"
                        ? "登录已失效，请重新登录后继续当前画布。"
                        : platformLoading
                          ? "正在检查平台授权…"
                          : isSessionOnlyStorage() ? "平台连接暂不可用，内容仅在当前页面保留，请先导出备份。" : "平台连接暂不可用，本机编辑和保存不受影响。"}
                  </p>
                  <p className="platform-account-help" id="platform-refresh-description">
                    {authState === "required"
                      ? "登录状态失效后，重新登录即可恢复账户资料和模型。"
                      : "重新检查平台连接，并更新账户资料、可用模型和云端画布状态；不会切换登录账户。"}
                  </p>
                  <button
                    className="button platform-refresh-button"
                    disabled={platformLoading}
                    onClick={platformAction}
                    aria-describedby="platform-refresh-description"
                  >
                    <RefreshCw
                      size={13}
                      className={platformLoading ? "spin" : ""}
                    />
                    {platformActionLabel}
                  </button>
                  </div>
                <div className="account-storage-block storage-section">
                  <div className="section-heading-row">
                    <h4>应用媒体空间</h4>
                    <button className="text-button" onClick={() => void loadStorage(true)} disabled={storageLoading || authState !== "connected"}>
                      {storageLoading ? "刷新中…" : "刷新"}
                    </button>
                  </div>
                  <p className="storage-description">当前账户的所有应用共用此容量；下方仅列出 Canvas 生成媒体。删除媒体才会释放容量，从资产库移除只会取消收藏。</p>
                  {storageUsage ? (
                    <>
                      <div className="storage-summary" aria-label="媒体空间使用情况">
                        <strong>{formatBytes(storageAvailableBytes)}</strong>
                        <span>可用空间</span>
                      </div>
                      <div className={`storage-meter${storageUsage.status === "full" ? " is-full" : storageUsage.status === "warning" ? " is-warning" : ""}`} role="progressbar" aria-label="媒体空间使用量" aria-valuemin={0} aria-valuemax={Math.max(storageQuotaBytes, 1)} aria-valuenow={Math.min(storageConsumedBytes, storageQuotaBytes)}>
                        <span style={{ width: `${storagePercent}%` }} />
                      </div>
                      <div className="storage-stats">
                        <span>已使用 <strong>{formatBytes(storageUsedBytes)}</strong></span>
                        <span>处理中预留 <strong>{formatBytes(storageReservedBytes)}</strong></span>
                        <span>总空间 <strong>{formatBytes(storageQuotaBytes)}</strong></span>
                      </div>
                      <p className={`storage-status storage-status-${storageUsage.status}`} role="status">
                        {storageUsage.status === "full" ? "空间已用满，暂时无法生成新媒体。" : storageUsage.status === "warning" ? "空间即将用满，建议及时清理或升级。" : "空间充足，可继续生成。"}
                      </p>
                      <div className="panel-action-row">
                        <button className="button" onClick={() => { assetReferenceTarget.current = undefined; setOverlay(null); setDrawer("assets"); setAssetView("library"); }}>打开资产库</button>
                        {storageUsage.storage_pack_url
                          ? <button className="button" onClick={() => openStoragePortal("storage")}>购买存储包</button>
                          : <button className="button" onClick={() => openStoragePortal("subscription")}>查看会员方案</button>}
                      </div>
                    </>
                  ) : <p>{storageActionError
                    ? "用量数据尚未加载。"
                    : storageLoading
                      ? "正在读取当前账户的媒体空间…"
                      : authState === "connected"
                        ? "平台连接就绪后即可读取媒体空间。"
                        : "登录后可查看当前账户的媒体空间。Canvas 生成的图片、视频和音频都会计入此处。"}</p>}
                  {authState === "connected" && <ApplicationMediaManager key={platformRevision} storageStatus={storageUsage?.status} connected={authState === "connected" && platformReady} onUsageRefresh={() => loadStorage(true)} onNotice={(text, action) => setMessage(text, action)} />}
                </div>
                </section>
                <section className="save-details">
                  <h3>保存与恢复</h3>
                  <p role="status">{saveStatus}</p>
                  <p>
                    画布会自动保存；登录后自动同步云端。跨设备使用时，系统会按版本时间自动保留较新的内容。
                  </p>
                  <p>导出的画布包含节点结构和本地图片；网络图片保留原地址。需要长期备份时，请同时下载原图。</p>
                  {recovery && <p>切换或同步前保留的版本可在这里恢复。</p>}
                  <div className="panel-action-row">
                    <button className="button" onClick={() => void save()}>
                      立即保存
                    </button>
                    <button className="button" onClick={exportCanvas}>
                      导出完整画布
                    </button>
                  </div>
                  {recovery && (
                    <button
                      className="button"
                      disabled={navigating || activeRequests.current.size > 0}
                      onClick={() => void restorePrevious()}
                    >
                      <RotateCcw size={14} />
                      <span>恢复上一次版本</span>
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={platformLoading || authState !== "connected"}
                    onClick={() =>
                      cloudCandidate
                        ? setOverlay("restore")
                        : hydrated
                          ? void enableSync()
                          : void refreshPlatform()
                    }
                  >
                    {platformLoading
                      ? "正在检测连接…"
                      : cloudCandidate
                        ? "查看待恢复版本"
                        : syncEnabled
                          ? "检查同步状态"
                          : hydrated
                            ? "开启云端同步"
                            : "重新检测平台连接"}
                  </button>
                </section>
                <ClientDiagnosticsPanel />
                </CanvasSettingsPanel>
              </div>
            )}
          </div>
      </PresenceLayer>
      <PresenceLayer
        open={Boolean(handDrawTargetId)}
        className="handdraw-presence"
      >
        {handDrawTargetId && (
          <HandDrawModal
            onCancel={() => setHandDrawTargetId(null)}
            onSave={(dataUrl) => void saveHandDraw(dataUrl)}
          />
        )}
      </PresenceLayer>
    </div>
  );
}
