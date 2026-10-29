import React from "react";
import { createPortal } from "react-dom";
import { Camera, Check, ChevronsLeft, ChevronsRight, Crop, Film, Images, Minus, Pause, Play, Plus, RotateCcw, Scissors, Shrink, SkipBack, SkipForward, Trash2, Volume2, X } from "lucide-react";
import { initialVideoEditRange, MAX_VIDEO_EDIT_DURATION_SECONDS, videoCanvasSize, videoExportBitrate, type VideoEditOperation, type VideoEditOptions } from "./video-editing";
import { captureVideoFrame, type CapturedVideoFrame } from "./video-player";
import MediaToolMenu, { dismissMediaToolMenus } from "./MediaToolMenu";
import "./image-tools.css";

type VideoToolsProps = {
  source?: string;
  poster?: string;
  captureReady: boolean;
  duration: number;
  currentTime: number;
  processBusy: boolean;
  processProgress: number;
  processStatus?: string;
  processError?: string;
  /** Shows parameter-free extraction progress on the source media surface. */
  inlineQuickProcess?: boolean;
  onCapture: () => void;
  onCaptureFrameAt?: (frame: CapturedVideoFrame) => Promise<void> | void;
  onProcess: (options: VideoEditOptions) => void;
  onCancelProcess: () => void;
  onClearProcessError: () => void;
  onPlaybackLockChange?: (locked: boolean) => void;
  onNotice?: (text: string) => void;
};
type MenuTool = { id: string; label: string; detail: string; icon: typeof Camera; operation?: VideoEditOperation; available?: boolean };
const MENU_GROUPS: Array<{ label: string; tools: MenuTool[] }> = [
  { label: "剪辑与处理", tools: [
    { id: "trim", label: "裁剪视频", detail: "预览并选择视频片段，生成新的画布节点", icon: Scissors, operation: "trim" },
    { id: "extract-video", label: "提取视频", detail: "将完整视频添加为新节点", icon: Scissors, operation: "extract-video" },
    { id: "compress", label: "视频压缩", detail: "降低分辨率和码率，生成新的画布节点", icon: Shrink, operation: "compress" },
  ] },
  { label: "画面", tools: [
    { id: "crop", label: "画面裁剪", detail: "裁剪为常用比例，生成新的画布节点", icon: Crop, operation: "crop" },
    { id: "capture", label: "截取当前帧", detail: "将画面保存为图片", icon: Camera },
    { id: "capture-batch", label: "批量截取画面", detail: "选择多个时间点并生成图片节点", icon: Images },
  ] },
  { label: "声音", tools: [
    { id: "extract-audio", label: "提取音频", detail: "将完整音轨添加为新节点", icon: Volume2, operation: "extract-audio" },
  ] },
];
const MENU_TOOLS = MENU_GROUPS.flatMap(group => group.tools);
const formatTime = (value: number) => {
  const seconds = Math.max(0, Number.isFinite(value) ? value : 0);
  const centiseconds = Math.round(seconds * 100);
  const minutes = Math.floor(centiseconds / 6000);
  return `${String(minutes).padStart(2, "0")}:${((centiseconds % 6000) / 100).toFixed(2).padStart(5, "0")}`;
};

const parseTimeInput = (value: string): number => {
  const normalized = value.trim();
  if (!normalized) return 0;
  if (normalized.includes(":")) {
    const parts = normalized.split(":").map(Number);
    if (parts.every(Number.isFinite)) {
      if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
      if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
  }
  const seconds = Number(normalized);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
};

type TimelineFrame = { url: string; time: number };
type SelectedFrame = { id: number; time: number };
const MAX_SELECTED_VIDEO_FRAMES = 30;
const clampCaptureTime = (time: number, duration: number) => Math.max(0, Math.min(Math.max(0, duration - 0.001), Number.isFinite(time) ? time : 0));
const formatCaptureTime = (value: number) => {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor(safe / 60) % 60;
  const seconds = Math.floor(safe) % 60;
  const fraction = String(Math.floor((safe % 1) * 1000)).padStart(3, "0");
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${fraction}`;
};

/** Generate a small bounded strip of frames without affecting the preview decoder. */
function useVideoTimelineFrames(source: string | undefined, duration: number): { frames: TimelineFrame[]; loading: boolean } {
  const [frames, setFrames] = React.useState<TimelineFrame[]>([]);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    setFrames([]);
    if (!source || !Number.isFinite(duration) || duration <= 0 || typeof document === "undefined") {
      setLoading(false);
      return () => { cancelled = true; };
    }
    const frameCount = Math.min(20, Math.max(8, Math.round(duration * 3)));
    const times = Array.from({ length: frameCount }, (_, index) => duration * index / Math.max(1, frameCount - 1));
    const decoder = document.createElement("video");
    decoder.preload = "metadata";
    decoder.muted = true;
    decoder.playsInline = true;
    if (/^https?:/i.test(source)) decoder.crossOrigin = "anonymous";
    const canvas = document.createElement("canvas");
    const waitForMetadata = () => new Promise<void>((resolve, reject) => {
      if (decoder.readyState >= 1) { resolve(); return; }
      const timer = window.setTimeout(() => { cleanup(); reject(new Error("metadata-timeout")); }, 10_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        decoder.removeEventListener("loadedmetadata", done);
        decoder.removeEventListener("error", fail);
      };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error("metadata-error")); };
      decoder.addEventListener("loadedmetadata", done, { once: true });
      decoder.addEventListener("error", fail, { once: true });
    });
    const seek = (time: number) => new Promise<void>((resolve, reject) => {
      if (Math.abs(decoder.currentTime - time) < 0.02) { resolve(); return; }
      const timer = window.setTimeout(() => { cleanup(); reject(new Error("seek-timeout")); }, 5_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        decoder.removeEventListener("seeked", done);
        decoder.removeEventListener("error", fail);
      };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error("seek-error")); };
      decoder.addEventListener("seeked", done, { once: true });
      decoder.addEventListener("error", fail, { once: true });
      decoder.currentTime = time;
    });
    setLoading(true);
    decoder.src = source;
    void (async () => {
      try {
        await waitForMetadata();
        if (cancelled) return;
        const ratio = decoder.videoWidth > 0 && decoder.videoHeight > 0 ? decoder.videoWidth / decoder.videoHeight : 16 / 9;
        canvas.width = 160;
        canvas.height = Math.max(60, Math.round(canvas.width / ratio));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("canvas-unavailable");
        const rendered: TimelineFrame[] = [];
        for (const time of times) {
          if (cancelled) return;
          await seek(Math.min(time, Math.max(0, decoder.duration - 0.02)));
          context.drawImage(decoder, 0, 0, canvas.width, canvas.height);
          rendered.push({ time, url: canvas.toDataURL("image/jpeg", 0.7) });
        }
        if (!cancelled) setFrames(rendered);
      } catch {
        // A signed source without CORS can still be previewed. Keep the
        // timeline usable with its poster instead of failing the trim tool.
      } finally {
        if (!cancelled) setLoading(false);
        canvas.width = 0;
        canvas.height = 0;
        decoder.pause();
        decoder.removeAttribute("src");
        decoder.load();
      }
    })();
    return () => {
      cancelled = true;
      decoder.pause();
      decoder.removeAttribute("src");
      decoder.load();
    };
  }, [duration, source]);
  return { frames, loading };
}

function seekPreviewVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < 0.02) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error("定位画面超时，请重试。")), 10_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const done = (error?: Error) => { cleanup(); error ? reject(error) : resolve(); };
    const onSeeked = () => done();
    const onError = () => done(new Error("视频无法定位到所选时间点。"));
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

function VideoFrameBatchDialog({ source, poster, duration, initialTime, dialogRef, onCancel, onCaptureFrame, onComplete }: {
  source: string;
  poster?: string;
  duration: number;
  initialTime: number;
  dialogRef: React.RefObject<HTMLDivElement>;
  onCancel: () => void;
  onCaptureFrame?: (frame: CapturedVideoFrame) => Promise<void> | void;
  onComplete: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const sequence = React.useRef(0);
  const [previewTime, setPreviewTime] = React.useState(0);
  const [previewSeeking, setPreviewSeeking] = React.useState(false);
  const [frames, setFrames] = React.useState<SelectedFrame[]>([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState("");
  const { frames: timelineFrames, loading: timelineLoading } = useVideoTimelineFrames(source, duration);

  React.useLayoutEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true });
  }, [dialogRef]);

  const seek = (time: number) => {
    const normalized = clampCaptureTime(time, duration);
    const video = videoRef.current;
    if (video && Math.abs(video.currentTime - normalized) >= 0.02) {
      setPreviewSeeking(true);
      video.currentTime = normalized;
    }
    setPreviewTime(normalized);
  };
  const addFrame = (time: number) => {
    if (busy) return;
    const normalized = Math.round(clampCaptureTime(time, duration) * 1000) / 1000;
    if (frames.some(frame => Math.abs(frame.time - normalized) < 0.02)) {
      setError("这个时间点已经添加。");
      return;
    }
    if (frames.length >= MAX_SELECTED_VIDEO_FRAMES) {
      setError(`单次最多提取 ${MAX_SELECTED_VIDEO_FRAMES} 张画面。`);
      return;
    }
    sequence.current += 1;
    setFrames(current => [...current, { id: sequence.current, time: normalized }].sort((left, right) => left.time - right.time));
    setError("");
  };
  const extract = async () => {
    const video = videoRef.current;
    if (!video || !frames.length || busy) return;
    setBusy(true); setError(""); setProgress(0);
    let completed = 0;
    try {
      for (const [index, frame] of frames.entries()) {
        setStatus(`正在截取 ${index + 1}/${frames.length} · ${formatCaptureTime(frame.time)}`);
        await seekPreviewVideo(video, frame.time);
        const captured = captureVideoFrame(video);
        await onCaptureFrame?.(captured);
        completed += 1;
        setProgress(Math.round(completed / frames.length * 100));
        setFrames(current => current.filter(item => item.id !== frame.id));
      }
      onComplete();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "批量截帧失败，请重试。";
      setError(completed ? `已生成 ${completed} 张；${message}` : message);
    } finally {
      setBusy(false); setStatus("");
    }
  };

  return <div className="image-tool-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}><div ref={dialogRef} className="image-tool-modal video-frame-modal" role="dialog" aria-modal="true" aria-labelledby="video-frame-batch-title" aria-busy={busy || timelineLoading} tabIndex={-1} onMouseDown={event => event.stopPropagation()}><div className="image-tool-modal-head"><div><strong id="video-frame-batch-title">批量截取视频画面</strong><small>选择时间点并生成关联图片节点，最多 {MAX_SELECTED_VIDEO_FRAMES} 张</small></div><button type="button" aria-label="关闭批量截帧" disabled={busy} onClick={onCancel}><X size={17} /></button></div><div className="video-frame-preview"><video ref={videoRef} key={source} src={source} poster={poster} controls playsInline preload="metadata" crossOrigin={/^https?:\/\//i.test(source) ? "anonymous" : undefined} onLoadedMetadata={event => { const video = event.currentTarget; const time = clampCaptureTime(initialTime, Number.isFinite(video.duration) ? video.duration : duration); if (time > 0) { setPreviewSeeking(true); video.currentTime = time; } setPreviewTime(time); }} onSeeking={() => setPreviewSeeking(true)} onTimeUpdate={event => { if (!event.currentTarget.seeking) setPreviewTime(event.currentTarget.currentTime); }} onSeeked={event => { setPreviewTime(event.currentTarget.currentTime); setPreviewSeeking(false); }} onError={() => setError("视频预览无法加载，请检查素材来源或重新加载视频。")} /></div><div className="video-frame-time-row"><span>当前时间 <strong>{formatCaptureTime(previewTime)}</strong></span><span>{formatCaptureTime(duration)}</span><button type="button" disabled={busy || !duration} onClick={() => addFrame(0)}>添加首帧</button><button type="button" disabled={busy || !duration} onClick={() => addFrame(Math.max(0, duration - 0.001))}>添加尾帧</button><button type="button" disabled={busy || !duration || previewSeeking} onClick={() => addFrame(previewTime)}>添加当前帧</button></div><div className="video-frame-navigator"><input aria-label="定位视频时间点" type="range" min="0" max={Math.max(duration, 0.001)} step="0.01" value={Math.min(previewTime, duration || 0)} disabled={!duration || busy} onChange={event => seek(Number(event.target.value))} /><input aria-label="当前时间（秒）" type="number" min="0" max={duration} step="0.01" value={Number(previewTime.toFixed(2))} disabled={!duration || busy} onChange={event => seek(Number(event.target.value))} /></div><div className="video-frame-strip-heading"><strong>快速定位</strong><span>{timelineLoading ? "正在生成预览…" : `${timelineFrames.length} 个预览点`}</span></div><div className="video-frame-strip">{timelineFrames.map((frame, index) => <button type="button" className={`video-frame-thumb${frames.some(item => Math.abs(item.time - frame.time) < 0.02) ? " is-selected" : ""}`} key={`${frame.time}-${index}`} title={`定位到 ${formatCaptureTime(frame.time)}`} disabled={busy} onClick={() => seek(frame.time)}><img src={frame.url} alt={`视频预览 ${formatCaptureTime(frame.time)}`} /><span>{formatCaptureTime(frame.time)}</span></button>)}</div><div className="video-frame-selected-heading"><strong>已选画面</strong><span>{frames.length}/{MAX_SELECTED_VIDEO_FRAMES}</span><button type="button" disabled={!frames.length || busy} onClick={() => setFrames([])}>清空</button></div>{frames.length ? <div className="video-frame-selected-list">{frames.map((frame, index) => <div key={frame.id}><button type="button" disabled={busy} onClick={() => seek(frame.time)}><span>画面 {index + 1}</span><strong>{formatCaptureTime(frame.time)}</strong></button><button type="button" aria-label={`移除画面 ${index + 1}`} disabled={busy} onClick={() => setFrames(items => items.filter(item => item.id !== frame.id))}><Trash2 size={14} /></button></div>)}</div> : <p className="video-frame-empty">播放、拖动进度或点击预览帧，再添加需要的画面。相同时间点会自动去重。</p>}{error && <p className="image-tool-error" role="alert">{error}</p>}{busy && <div className="video-tool-progress" role="status" aria-live="polite"><div className="video-tool-progress-track" role="progressbar" aria-label={status || "批量截帧进度"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div><small>{status || `已处理 ${progress}%`}</small></div>}<div className="image-tool-actions"><button type="button" className="button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="generate-button" disabled={!frames.length || busy || !onCaptureFrame} onClick={() => void extract()}>{busy ? "正在生成…" : frames.length ? `生成 ${frames.length} 张图片` : "选择画面后生成"}<Check size={14} /></button></div></div></div>;
}
const defaultOptions = (operation: VideoEditOperation, duration: number, currentTime: number): VideoEditOptions => ({
  operation,
  ...initialVideoEditRange(duration, currentTime, operation === "extract-video" || operation === "extract-audio" || duration > MAX_VIDEO_EDIT_DURATION_SECONDS),
  outputFormat: "webm",
  watermarkText: "", watermarkPosition: "bottom-right", watermarkOpacity: 0.72,
  aspectRatio: "original", cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, maxWidth: 720, frameRate: 30, quality: "standard", grade: "natural", rotation: 90, flipHorizontal: operation === "mirror", flipVertical: false, playbackRate: 1,
});

type VideoCropMargins = { left: number; right: number; top: number; bottom: number };
type VideoCropDragKind = "move" | "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
type VideoCropDragState = VideoCropMargins & { kind: VideoCropDragKind; clientX: number; clientY: number };

const VIDEO_CROP_RATIOS: Array<{ value: NonNullable<VideoEditOptions["aspectRatio"]>; label: string }> = [
  { value: "original", label: "自由" }, { value: "1:1", label: "1:1" }, { value: "4:3", label: "4:3" }, { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "21:9", label: "21:9" }, { value: "2:3", label: "2:3" },
];
const clampVideoCrop = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeVideoCropMargins = (value: VideoCropMargins): VideoCropMargins => {
  const left = clampVideoCrop(Number.isFinite(value.left) ? value.left : 0, 0, 94);
  const right = clampVideoCrop(Number.isFinite(value.right) ? value.right : 0, 0, 94);
  const top = clampVideoCrop(Number.isFinite(value.top) ? value.top : 0, 0, 94);
  const bottom = clampVideoCrop(Number.isFinite(value.bottom) ? value.bottom : 0, 0, 94);
  const horizontal = left + right > 94 ? 94 / Math.max(left + right, 1) : 1;
  const vertical = top + bottom > 94 ? 94 / Math.max(top + bottom, 1) : 1;
  return { left: left * horizontal, right: right * horizontal, top: top * vertical, bottom: bottom * vertical };
};
const videoCropRatioValue = (value: VideoEditOptions["aspectRatio"]): number | undefined => {
  if (!value || value === "original") return undefined;
  const [width, height] = value.split(":").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : undefined;
};
const videoCropMarginsFromOptions = (options: VideoEditOptions): VideoCropMargins => normalizeVideoCropMargins({
  left: options.cropLeft ?? 0, right: options.cropRight ?? 0, top: options.cropTop ?? 0, bottom: options.cropBottom ?? 0,
});
const videoCropMarginsForRatio = (margins: VideoCropMargins, sourceRatio: number, targetRatio: number): VideoCropMargins => {
  const currentWidth = 1 - (margins.left + margins.right) / 100;
  const currentHeight = 1 - (margins.top + margins.bottom) / 100;
  let width = currentWidth;
  let height = currentHeight;
  const currentRatio = sourceRatio * currentWidth / Math.max(currentHeight, 0.001);
  if (currentRatio > targetRatio) width = currentHeight * targetRatio / sourceRatio;
  else height = currentWidth / targetRatio * sourceRatio;
  width = clampVideoCrop(width, 0.06, 1);
  height = clampVideoCrop(height, 0.06, 1);
  const centerX = (margins.left + 50 - margins.right) / 100;
  const centerY = (margins.top + 50 - margins.bottom) / 100;
  return normalizeVideoCropMargins({
    left: (centerX - width / 2) * 100, right: (1 - centerX - width / 2) * 100,
    top: (centerY - height / 2) * 100, bottom: (1 - centerY - height / 2) * 100,
  });
};

function VideoCropWorkspace({ source, poster, duration, currentTime, options, processBusy, processProgress, processStatus, processError, canSubmit, dialogRef, titleId, onOptionsChange, onProcess, onCancelProcess, onClearProcessError, onReset, onClose }: {
  source: string;
  poster?: string;
  duration: number;
  currentTime: number;
  options: VideoEditOptions;
  processBusy: boolean;
  processProgress: number;
  processStatus?: string;
  processError?: string;
  canSubmit: boolean;
  dialogRef: React.RefObject<HTMLDivElement>;
  titleId: string;
  onOptionsChange: (options: VideoEditOptions) => void;
  onProcess: () => void;
  onCancelProcess: () => void;
  onClearProcessError: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const [previewTime, setPreviewTime] = React.useState(Math.max(0, currentTime));
  const [drag, setDrag] = React.useState<VideoCropDragState | null>(null);
  const margins = videoCropMarginsFromOptions(options);
  const ratio = options.aspectRatio || "original";
  const targetRatio = videoCropRatioValue(ratio);
  const cropWidth = dimensions.width ? Math.max(1, Math.round(dimensions.width * (100 - margins.left - margins.right) / 100)) : 0;
  const cropHeight = dimensions.height ? Math.max(1, Math.round(dimensions.height * (100 - margins.top - margins.bottom) / 100)) : 0;
  const selectedDuration = Math.max(0, options.endTime - options.startTime);
  const selectedRatio = cropWidth && cropHeight ? `${cropWidth}:${cropHeight}` : "读取中";

  React.useLayoutEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus({ preventScroll: true });
  }, [dialogRef]);
  React.useEffect(() => { if (processBusy) videoRef.current?.pause(); }, [processBusy]);

  const setOption = <K extends keyof VideoEditOptions>(key: K, value: VideoEditOptions[K]) => {
    onOptionsChange({ ...options, [key]: value });
    if (processError) onClearProcessError();
  };
  const setMargins = (next: VideoCropMargins, axis?: "horizontal" | "vertical") => {
    let normalized = normalizeVideoCropMargins(next);
    if (targetRatio && dimensions.width && dimensions.height && axis) {
      const width = (100 - normalized.left - normalized.right) / 100;
      const height = (100 - normalized.top - normalized.bottom) / 100;
      if (axis === "horizontal") {
        const desiredHeight = width / targetRatio * (dimensions.width / dimensions.height);
        const nextHeight = clampVideoCrop(desiredHeight, 0.06, 1);
        const centerY = (normalized.top + 50 - normalized.bottom) / 100;
        normalized = normalizeVideoCropMargins({ ...normalized, top: (centerY - nextHeight / 2) * 100, bottom: (1 - centerY - nextHeight / 2) * 100 });
      } else {
        const desiredWidth = height * targetRatio * (dimensions.height / dimensions.width);
        const nextWidth = clampVideoCrop(desiredWidth, 0.06, 1);
        const centerX = (normalized.left + 50 - normalized.right) / 100;
        normalized = normalizeVideoCropMargins({ ...normalized, left: (centerX - nextWidth / 2) * 100, right: (1 - centerX - nextWidth / 2) * 100 });
      }
    }
    onOptionsChange({ ...options, cropLeft: normalized.left, cropRight: normalized.right, cropTop: normalized.top, cropBottom: normalized.bottom });
    if (processError) onClearProcessError();
  };
  const setRatio = (next: NonNullable<VideoEditOptions["aspectRatio"]>) => {
    const nextRatio = videoCropRatioValue(next);
    const nextMargins = nextRatio && dimensions.width && dimensions.height ? videoCropMarginsForRatio(margins, dimensions.width / dimensions.height, nextRatio) : next === "original" ? { left: 0, right: 0, top: 0, bottom: 0 } : margins;
    onOptionsChange({ ...options, aspectRatio: next, cropLeft: nextMargins.left, cropRight: nextMargins.right, cropTop: nextMargins.top, cropBottom: nextMargins.bottom });
    if (processError) onClearProcessError();
  };
  const startDrag = (kind: VideoCropDragKind, event: React.PointerEvent<HTMLElement>) => {
    if (processBusy) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ ...margins, kind, clientX: event.clientX, clientY: event.clientY });
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !viewportRef.current || processBusy) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const dx = (event.clientX - drag.clientX) / Math.max(rect.width, 1) * 100;
    const dy = (event.clientY - drag.clientY) / Math.max(rect.height, 1) * 100;
    const next = { left: drag.left, right: drag.right, top: drag.top, bottom: drag.bottom };
    if (drag.kind === "move") {
      const width = 100 - drag.left - drag.right, height = 100 - drag.top - drag.bottom;
      next.left = clampVideoCrop(drag.left + dx, 0, 100 - width); next.right = 100 - width - next.left;
      next.top = clampVideoCrop(drag.top + dy, 0, 100 - height); next.bottom = 100 - height - next.top;
      setMargins(next);
    } else {
      if (drag.kind.includes("left")) next.left = drag.left + dx;
      if (drag.kind.includes("right")) next.right = drag.right - dx;
      if (drag.kind.includes("top")) next.top = drag.top + dy;
      if (drag.kind.includes("bottom")) next.bottom = drag.bottom - dy;
      setMargins(next, drag.kind.includes("left") || drag.kind.includes("right") ? "horizontal" : "vertical");
    }
  };
  const finishDrag = () => setDrag(null);
  const resetCrop = () => { onReset(); setPreviewTime(Math.max(0, currentTime)); };
  const setPreviewPosition = (value: number) => {
    const next = Math.max(0, Math.min(Math.max(duration, 0.25), Number.isFinite(value) ? value : 0));
    setPreviewTime(next);
    if (videoRef.current && Number.isFinite(videoRef.current.duration)) videoRef.current.currentTime = next;
  };

  return <div className="image-tool-modal-backdrop video-crop-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !processBusy) onClose(); }}>
    <div ref={dialogRef} className="image-tool-modal video-crop-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={processBusy} tabIndex={-1} onMouseDown={event => event.stopPropagation()}>
      <header className="video-crop-head image-tool-modal-head"><div className="video-crop-title"><div className="video-crop-title-mark"><Crop size={17} /></div><div><strong id={titleId}>视频画面裁剪</strong><small>拖动裁剪框调整画面构图，输出为新视频节点</small></div></div><button type="button" aria-label="关闭视频工具" disabled={processBusy} onClick={onClose}><X size={18} /></button></header>
      <div className="video-crop-body">
        <main className="video-crop-stage">
          <div className="video-crop-viewport-shell">
            <div ref={viewportRef} className="video-crop-viewport" style={{ aspectRatio: dimensions.width && dimensions.height ? `${dimensions.width} / ${dimensions.height}` : "16 / 9" }} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
              <video ref={videoRef} src={source} poster={poster} controls playsInline preload="metadata" crossOrigin={/^https?:\/\//i.test(source) ? "anonymous" : undefined} onLoadedMetadata={event => { const video = event.currentTarget; setDimensions({ width: video.videoWidth, height: video.videoHeight }); const time = Math.max(0, Math.min(video.duration || duration, previewTime)); video.currentTime = time; }} onTimeUpdate={event => setPreviewTime(event.currentTarget.currentTime)} />
              {!dimensions.width && <div className="video-crop-loading">正在读取视频画面…</div>}
              <div className="video-crop-selection" role="group" aria-label="视频裁剪选区" style={{ left: `${margins.left}%`, right: `${margins.right}%`, top: `${margins.top}%`, bottom: `${margins.bottom}%` }} onPointerDown={event => startDrag("move", event)}>
                <span className="video-crop-selection-label">{cropWidth && cropHeight ? `${cropWidth} × ${cropHeight}` : "裁剪选区"}</span>
                <button type="button" className="video-crop-handle is-top-left" aria-label="调整左上裁剪边界" onPointerDown={event => startDrag("top-left", event)} />
                <button type="button" className="video-crop-handle is-top-right" aria-label="调整右上裁剪边界" onPointerDown={event => startDrag("top-right", event)} />
                <button type="button" className="video-crop-handle is-bottom-left" aria-label="调整左下裁剪边界" onPointerDown={event => startDrag("bottom-left", event)} />
                <button type="button" className="video-crop-handle is-bottom-right" aria-label="调整右下裁剪边界" onPointerDown={event => startDrag("bottom-right", event)} />
                <button type="button" className="video-crop-edge is-left" aria-label="调整左裁剪边界" onPointerDown={event => startDrag("left", event)} /><button type="button" className="video-crop-edge is-right" aria-label="调整右裁剪边界" onPointerDown={event => startDrag("right", event)} /><button type="button" className="video-crop-edge is-top" aria-label="调整上裁剪边界" onPointerDown={event => startDrag("top", event)} /><button type="button" className="video-crop-edge is-bottom" aria-label="调整下裁剪边界" onPointerDown={event => startDrag("bottom", event)} />
              </div>
            </div>
          </div>
          <div className="video-crop-stage-footer"><span>预览时间 {formatTime(previewTime)} / {formatTime(duration)}</span><strong>{cropWidth && cropHeight ? `${cropWidth} × ${cropHeight} px` : "读取中"}</strong><span>比例 {ratio === "original" ? "自由" : ratio}</span></div>
          <div className="video-crop-time-control"><input aria-label="视频预览位置" type="range" min="0" max={Math.max(duration, 0.25)} step="0.01" value={Math.min(previewTime, Math.max(duration, 0.25))} disabled={processBusy} onChange={event => setPreviewPosition(Number(event.target.value))} /><span>{formatTime(previewTime)}</span></div>
        </main>
        <aside className="video-crop-inspector" aria-label="裁剪设置">
          <div className="video-crop-inspector-heading"><strong>尺寸预设</strong><span>{dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height}` : "读取中"}</span></div>
          <div className="video-crop-ratio-grid" role="radiogroup" aria-label="尺寸预设">
            {VIDEO_CROP_RATIOS.map((preset, index) => <button key={preset.value} type="button" role="radio" aria-checked={ratio === preset.value} autoFocus={index === 0 && !processBusy} className={ratio === preset.value ? "is-selected" : ""} disabled={processBusy} onClick={() => setRatio(preset.value)}>{preset.label}</button>)}
          </div>
          <div className="video-crop-side-actions"><button type="button" className={options.flipHorizontal ? "is-selected" : ""} aria-pressed={Boolean(options.flipHorizontal)} disabled={processBusy} onClick={() => setOption("flipHorizontal", !options.flipHorizontal)}>水平镜像</button><button type="button" disabled={processBusy} onClick={resetCrop}>重置</button></div>
          <div className="video-crop-info-card"><div><span>输出尺寸</span><strong>{cropWidth && cropHeight ? `${cropWidth} × ${cropHeight}` : "读取中"}</strong></div><div><span>处理区间</span><strong>{formatTime(selectedDuration)}</strong></div><div><span>输出方式</span><strong>保持原音轨</strong></div></div>
          <p className="video-crop-hint">拖动框内区域移动构图；拖动四角或四边调整裁剪范围。选择比例后会自动保持对应画幅。</p>
        </aside>
      </div>
      {processError && !processBusy && <p className="video-tool-error video-crop-feedback" role="alert">{processError}</p>}
      {processBusy && <div className={`video-tool-progress video-crop-progress${processStatus && !processProgress ? " is-indeterminate" : ""}`} role="status" aria-live="polite"><div className="video-tool-progress-track" role="progressbar" aria-label={processStatus || "视频处理进度"} aria-valuemin={0} aria-valuemax={100} {...(processStatus && !processProgress ? {} : { "aria-valuenow": Math.round(processProgress) })}><span style={processStatus && !processProgress ? undefined : { width: `${processProgress}%` }} /></div><small>{processStatus || `处理中 ${Math.round(processProgress)}%`}</small></div>}
      <footer className="image-tool-actions video-crop-footer">{processBusy ? <button type="button" className="button" onClick={onCancelProcess}>取消处理</button> : <><button type="button" className="image-tool-reset" onClick={resetCrop}><RotateCcw size={13} />重置</button><span className="video-crop-footer-summary">选区 {cropWidth && cropHeight ? `${cropWidth} × ${cropHeight}` : "读取中"} · {ratio === "original" ? "自由比例" : ratio}</span><button type="button" className="button" onClick={onClose}>{processError ? "关闭" : "取消"}</button><button type="button" className="generate-button" aria-label={processError ? "重试处理" : "开始处理"} disabled={!canSubmit} title={!canSubmit ? `请选择不超过 ${MAX_VIDEO_EDIT_DURATION_SECONDS / 60} 分钟的时间范围` : undefined} onClick={onProcess}>{processError ? "重试处理" : "确认裁剪"}<Check size={14} /></button></>}</footer>
    </div>
  </div>;
}

function VideoTrimWorkspace({ source, poster, duration, currentTime, options, processBusy, processProgress, processStatus, processError, onOptionsChange, onProcess, onCancelProcess, onClose }: {
  source: string;
  poster?: string;
  duration: number;
  currentTime: number;
  options: VideoEditOptions;
  processBusy: boolean;
  processProgress: number;
  processStatus?: string;
  processError?: string;
  onOptionsChange: (options: VideoEditOptions) => void;
  onProcess: () => void;
  onCancelProcess: () => void;
  onClose: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const workspaceRef = React.useRef<HTMLElement>(null);
  const dragRef = React.useRef<"startTime" | "endTime" | null>(null);
  const [mediaDuration, setMediaDuration] = React.useState(0);
  const [playhead, setPlayhead] = React.useState(Math.max(0, currentTime));
  const [playing, setPlaying] = React.useState(false);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const totalDuration = Number.isFinite(mediaDuration) && mediaDuration > 0
    ? mediaDuration
    : Number.isFinite(duration) && duration > 0 ? duration : 0;
  const { frames, loading: framesLoading } = useVideoTimelineFrames(source, totalDuration);
  const selectedDuration = Math.max(0, options.endTime - options.startTime);
  const safeDuration = Math.max(totalDuration, 0.25);
  const maxSelectableDuration = Math.min(safeDuration, MAX_VIDEO_EDIT_DURATION_SECONDS);
  const maxLabel = MAX_VIDEO_EDIT_DURATION_SECONDS >= 60
    ? `${MAX_VIDEO_EDIT_DURATION_SECONDS / 60} 分钟`
    : `${MAX_VIDEO_EDIT_DURATION_SECONDS} 秒`;
  const startPercent = Math.max(0, Math.min(100, options.startTime / safeDuration * 100));
  const endPercent = Math.max(startPercent, Math.min(100, options.endTime / safeDuration * 100));
  const playheadPercent = Math.max(0, Math.min(100, playhead / safeDuration * 100));

  const updateRange = (key: "startTime" | "endTime", value: number): number => {
    if (processBusy) return key === "startTime" ? options.startTime : options.endTime;
    const upper = Math.max(totalDuration, 0.25);
    const safeValue = Number.isFinite(value) ? value : key === "startTime" ? options.startTime : options.endTime;
    if (key === "startTime") {
      const next = Math.max(0, Math.min(Math.max(0, options.endTime - 0.25), safeValue));
      onOptionsChange({ ...options, startTime: next });
      return next;
    }
    const next = Math.max(Math.min(upper, options.startTime + 0.25), Math.min(upper, safeValue));
    onOptionsChange({ ...options, endTime: next });
    return next;
  };
  const seek = (value: number) => {
    if (processBusy) return;
    const next = Math.max(0, Math.min(totalDuration || value, value));
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration)) video.currentTime = next;
    setPlayhead(next);
  };
  const togglePlayback = () => {
    const video = videoRef.current;
    if (processBusy || !video || !totalDuration) return;
    if (!video.paused) { video.pause(); setPlaying(false); return; }
    if (video.currentTime < options.startTime || video.currentTime >= options.endTime) video.currentTime = options.startTime;
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  const resetRange = () => {
    if (processBusy) return;
    const end = Math.min(safeDuration, maxSelectableDuration);
    onOptionsChange({ ...options, startTime: 0, endTime: Math.max(0.25, end) });
    seek(0);
  };
  const keepAtStart = () => {
    if (processBusy || !totalDuration) return;
    const length = Math.max(0.25, Math.min(selectedDuration, maxSelectableDuration));
    onOptionsChange({ ...options, startTime: 0, endTime: Math.min(totalDuration, length) });
    seek(0);
  };
  const keepAtEnd = () => {
    if (processBusy || !totalDuration) return;
    const length = Math.max(0.25, Math.min(selectedDuration, maxSelectableDuration));
    const end = totalDuration;
    const start = Math.max(0, end - length);
    onOptionsChange({ ...options, startTime: start, endTime: end });
    seek(start);
  };
  const setInPoint = () => updateRange("startTime", playhead);
  const setOutPoint = () => updateRange("endTime", playhead);
  const timelineTime = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? Math.max(0, Math.min(totalDuration, (clientX - rect.left) / rect.width * totalDuration)) : 0;
  };
  const onHandlePointerDown = (key: "startTime" | "endTime", event: React.PointerEvent<HTMLButtonElement>) => {
    if (processBusy) return;
    event.preventDefault(); event.stopPropagation(); dragRef.current = key;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current && !processBusy) {
      const value = timelineTime(event.clientX);
      // Seek to the clamped handle position. This keeps the playhead aligned
      // with the visible handle when the pointer moves past a legal boundary.
      seek(updateRange(dragRef.current, value));
    }
  };
  const stopDragging = () => { dragRef.current = null; };

  React.useEffect(() => { if (processBusy) { videoRef.current?.pause(); setPlaying(false); } }, [processBusy]);
  React.useEffect(() => () => videoRef.current?.pause(), []);
  React.useEffect(() => {
    if (!totalDuration) return;
    setPlayhead(value => Math.max(0, Math.min(totalDuration, value)));
  }, [totalDuration]);
  React.useLayoutEffect(() => { workspaceRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true }); }, []);
  React.useEffect(() => {
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !workspaceRef.current) return;
      const items = [...workspaceRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])")].filter(item => !item.matches(":disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !workspaceRef.current.contains(document.activeElement))) { event.preventDefault(); event.stopImmediatePropagation(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !workspaceRef.current.contains(document.activeElement))) { event.preventDefault(); event.stopImmediatePropagation(); first.focus(); }
    };
    window.addEventListener("keydown", trapFocus, true);
    return () => window.removeEventListener("keydown", trapFocus, true);
  }, []);
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!workspaceRef.current?.contains(target)) return;
      if (event.key === "Escape") return;
      if (target?.matches("input, select, textarea, [contenteditable='true']") || target?.getAttribute("role") === "slider") return;
      if ((event.key === " " || event.key === "Spacebar") && !target?.closest("button")) {
        event.preventDefault(); event.stopImmediatePropagation(); togglePlayback();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation();
        seek(playhead + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
      } else if (event.key === "[" && !processBusy) {
        event.preventDefault(); event.stopImmediatePropagation(); updateRange("startTime", playhead);
      } else if (event.key === "]" && !processBusy) {
        event.preventDefault(); event.stopImmediatePropagation(); updateRange("endTime", playhead);
      } else if (event.key === "Home") {
        event.preventDefault(); event.stopImmediatePropagation(); seek(options.startTime);
      } else if (event.key === "End") {
        event.preventDefault(); event.stopImmediatePropagation(); seek(options.endTime);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [options, playhead, processBusy, totalDuration]);

  return <div className="video-trim-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !processBusy) onClose(); }}>
    <section ref={workspaceRef} className="video-trim-workspace" role="dialog" aria-modal="true" aria-label="裁剪视频" aria-busy={processBusy} onMouseDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <header className="video-trim-header">
        <div className="video-trim-heading"><Scissors size={17} /><div><strong>裁剪视频长度</strong><small>拖动入点 / 出点确定保留区间，其余部分将被截掉</small></div></div>
        <div className="video-trim-header-actions"><div className="video-trim-summary" role="status"><span>已选</span><strong>{formatTime(selectedDuration)}</strong><small>限 0.25 秒 ~ {maxLabel}</small></div><button type="button" aria-label="关闭裁剪视频" disabled={processBusy} onClick={onClose}><X size={18} /></button></div>
      </header>
      <div className="video-trim-content">
        <div className="video-trim-main">
          <div className="video-trim-preview" onDoubleClick={togglePlayback}>
            {source ? <video ref={videoRef} src={source} poster={poster} preload="metadata" playsInline tabIndex={-1}
              onLoadedMetadata={event => {
                const video = event.currentTarget;
                const actualDuration = Number.isFinite(video.duration) ? video.duration : 0;
                setMediaDuration(actualDuration); setDimensions({ width: video.videoWidth, height: video.videoHeight });
                if (actualDuration > 0) {
                  const start = Math.min(options.startTime, Math.max(0, actualDuration - 0.25));
                  const end = Math.max(start + 0.25, Math.min(actualDuration, options.endTime));
                  if (Math.abs(start - options.startTime) > 0.01 || Math.abs(end - options.endTime) > 0.01) onOptionsChange({ ...options, startTime: start, endTime: end });
                }
                const initialTime = Math.min(playhead || options.startTime, actualDuration || options.startTime);
                video.currentTime = Math.max(0, initialTime);
              }}
              onTimeUpdate={event => {
                const video = event.currentTarget;
                if (video.currentTime >= options.endTime - 0.01) { video.pause(); video.currentTime = options.endTime; setPlaying(false); setPlayhead(options.endTime); return; }
                if (video.currentTime < options.startTime && !video.paused) video.currentTime = options.startTime;
                setPlayhead(video.currentTime);
              }}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} /> : <div className="video-trim-unavailable">视频预览暂不可用</div>}
            {!playing && !processBusy && <button className="video-trim-center-play" type="button" aria-label="播放选中区间" onClick={togglePlayback}><Play size={21} fill="currentColor" /></button>}
          </div>
          <div className="video-trim-player-controls">
            <button type="button" className="video-trim-jump" aria-label="跳到选区开始" title="跳到入点" onClick={() => seek(options.startTime)} disabled={!source || !totalDuration || processBusy}><ChevronsLeft size={15} /></button>
            <button type="button" className="video-trim-jump" aria-label="后退 1 秒" title="后退 1 秒" onClick={() => seek(playhead - 1)} disabled={!source || !totalDuration || processBusy}><SkipBack size={15} /></button>
            <button type="button" className="video-trim-play" aria-label={playing ? "暂停预览" : "播放选中区间"} onClick={togglePlayback} disabled={!source || !totalDuration || processBusy}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <button type="button" className="video-trim-jump" aria-label="前进 1 秒" title="前进 1 秒" onClick={() => seek(playhead + 1)} disabled={!source || !totalDuration || processBusy}><SkipForward size={15} /></button>
            <button type="button" className="video-trim-jump" aria-label="跳到选区结束" title="跳到出点" onClick={() => seek(options.endTime)} disabled={!source || !totalDuration || processBusy}><ChevronsRight size={15} /></button>
            <span className="video-trim-clock">{formatTime(playhead)} <i>/</i> {formatTime(totalDuration)}</span>
            <input aria-label="预览播放位置" type="range" min="0" max={safeDuration} step="0.01" value={Math.min(playhead, safeDuration)} disabled={processBusy || !totalDuration} onChange={event => seek(Number(event.target.value))} />
            <div className="video-trim-point-actions"><button type="button" onClick={setInPoint} disabled={processBusy || !totalDuration} title="将当前播放位置设为入点">设为入点 <kbd>[</kbd></button><button type="button" onClick={setOutPoint} disabled={processBusy || !totalDuration} title="将当前播放位置设为出点">设为出点 <kbd>]</kbd></button></div>
          </div>
          <div className="video-trim-timeline-area">
            <div className="video-trim-timeline-label"><strong>时间轴</strong><span>{framesLoading ? "正在生成缩略图…" : "拖动入点 / 出点调整选区"}</span></div>
            <div ref={trackRef} className="video-trim-track" role="group" aria-label="裁剪时间轴" onPointerDown={event => { if (!processBusy && !(event.target as HTMLElement).closest("button")) seek(timelineTime(event.clientX)); }}>
              <div className="video-trim-track-base" aria-hidden="true">
                {Array.from({ length: frames.length || 14 }, (_, index) => {
                  const frame = frames[index];
                  const background = frame?.url || poster;
                  return <span key={frame?.time ?? index} style={background ? { backgroundImage: `url(${background})` } : undefined} />;
                })}
              </div>
              <div className="video-trim-track-shade is-before" style={{ width: `${startPercent}%` }} />
              <div className="video-trim-track-shade is-after" style={{ left: `${endPercent}%` }} />
              <div className="video-trim-selection" style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}><span>{formatTime(selectedDuration)}</span></div>
              <div className="video-trim-playhead" style={{ left: `${playheadPercent}%` }} />
              <button type="button" className="video-trim-handle is-start" role="slider" aria-label="裁剪开始位置" aria-valuemin={0} aria-valuemax={Math.max(0, options.endTime - 0.25)} aria-valuenow={options.startTime} aria-valuetext={formatTime(options.startTime)} disabled={processBusy || !totalDuration} style={{ left: `${startPercent}%` }} onPointerDown={event => onHandlePointerDown("startTime", event)} onPointerMove={onHandlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); updateRange("startTime", options.startTime + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1)); } }}><span /></button>
              <button type="button" className="video-trim-handle is-end" role="slider" aria-label="裁剪结束位置" aria-valuemin={Math.min(totalDuration, options.startTime + 0.25)} aria-valuemax={totalDuration} aria-valuenow={options.endTime} aria-valuetext={formatTime(options.endTime)} disabled={processBusy || !totalDuration} style={{ left: `${endPercent}%` }} onPointerDown={event => onHandlePointerDown("endTime", event)} onPointerMove={onHandlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); updateRange("endTime", options.endTime + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1)); } }}><span /></button>
            </div>
            <div className="video-trim-scale"><span>00:00.00</span><span>{formatTime(totalDuration)}</span></div>
            <div className="video-trim-shortcuts"><span><kbd>空格</kbd>播放选区</span><span><kbd>←</kbd><kbd>→</kbd>微调 <kbd>Shift</kbd> + 1 秒</span><span><kbd>Home</kbd><kbd>End</kbd>跳到入 / 出点</span></div>
          </div>
        </div>
        <aside className="video-trim-details">
          <div className="video-trim-panel-card video-trim-range-card">
            <div className="video-trim-detail-heading"><strong>区间</strong><button type="button" onClick={resetRange} disabled={processBusy || !totalDuration}>重置</button></div>
            <div className="video-trim-bound"><span>入点</span><div><button type="button" aria-label="入点减少 0.1 秒" onClick={() => updateRange("startTime", options.startTime - 0.1)} disabled={processBusy || options.startTime <= 0}><Minus size={14} /></button><input aria-label="开始时间" type="number" min="0" max={Math.max(0, options.endTime - 0.25)} step="0.01" value={options.startTime.toFixed(2)} disabled={processBusy} onChange={event => updateRange("startTime", parseTimeInput(event.target.value))} /><button type="button" aria-label="入点增加 0.1 秒" onClick={() => updateRange("startTime", options.startTime + 0.1)} disabled={processBusy || options.startTime >= options.endTime - 0.25}><Plus size={14} /></button></div></div>
            <div className="video-trim-bound"><span>出点</span><div><button type="button" aria-label="出点减少 0.1 秒" onClick={() => updateRange("endTime", options.endTime - 0.1)} disabled={processBusy || options.endTime <= options.startTime + 0.25}><Minus size={14} /></button><input aria-label="结束时间" type="number" min={Math.min(totalDuration, options.startTime + 0.25)} max={totalDuration} step="0.01" value={options.endTime.toFixed(2)} disabled={processBusy} onChange={event => updateRange("endTime", parseTimeInput(event.target.value))} /><button type="button" aria-label="出点增加 0.1 秒" onClick={() => updateRange("endTime", options.endTime + 0.1)} disabled={processBusy || options.endTime >= totalDuration}><Plus size={14} /></button></div></div>
            <div className="video-trim-duration-row"><span>保留时长</span><strong>{formatTime(selectedDuration)}</strong></div>
            <div className="video-trim-edge-actions"><button type="button" onClick={keepAtStart} disabled={processBusy || !totalDuration}>开头 {formatTime(selectedDuration)}</button><button type="button" onClick={keepAtEnd} disabled={processBusy || !totalDuration}>末尾 {formatTime(selectedDuration)}</button></div>
          </div>
          <div className="video-trim-panel-card video-trim-info-card">
            <div className="video-trim-detail-heading"><strong>信息</strong></div>
            <dl className="video-trim-metadata"><div><dt>原始时长</dt><dd>{formatTime(totalDuration)}</dd></div><div><dt>分辨率</dt><dd>{dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height}` : "读取中"}</dd></div><div><dt>输出</dt><dd>保持原分辨率</dd></div></dl>
            {totalDuration > MAX_VIDEO_EDIT_DURATION_SECONDS && <p className="video-trim-limit">单次最多裁剪 {maxLabel}，请缩短选区后确认。</p>}
          </div>
        </aside>
      </div>
      {processError && !processBusy && <p className="video-tool-error" role="alert">{processError}</p>}
      {processBusy && <div className="video-trim-progress" role="status" aria-live="polite"><span style={{ width: `${processProgress}%` }} /><small>{processStatus || `正在处理并保存结果 ${Math.round(processProgress)}%`}</small></div>}
      <footer className="video-trim-footer"><span>选中 {formatTime(selectedDuration)} / {formatTime(totalDuration)}</span><div>{processBusy ? <button type="button" className="button" onClick={onCancelProcess}>取消处理</button> : <><button type="button" className="button" onClick={onClose}>{processError ? "关闭" : "取消"}</button><button type="button" className="generate-button" disabled={selectedDuration < 0.25 || selectedDuration > MAX_VIDEO_EDIT_DURATION_SECONDS || !source} onClick={onProcess}>{processError ? "重试处理" : "处理并添加节点"}</button></>}</div></footer>
    </section>
  </div>;
}

type VideoCompressWorkspaceProps = {
  source: string;
  poster?: string;
  duration: number;
  currentTime: number;
  options: VideoEditOptions;
  processBusy: boolean;
  processProgress: number;
  processStatus?: string;
  processError?: string;
  canSubmit: boolean;
  dialogRef: React.RefObject<HTMLDivElement>;
  titleId: string;
  onOptionsChange: (options: VideoEditOptions) => void;
  onProcess: () => void;
  onCancelProcess: () => void;
  onClearProcessError: () => void;
  onReset: () => void;
  onClose: () => void;
};

type VideoCompressionWidth = NonNullable<VideoEditOptions["maxWidth"]>;
type VideoCompressionFrameRate = NonNullable<VideoEditOptions["frameRate"]>;
const COMPRESSION_WIDTH_OPTIONS: VideoCompressionWidth[] = [1080, 720, 540, 480, 360];
const COMPRESSION_FRAME_RATE_OPTIONS: VideoCompressionFrameRate[] = [30, 24, 15];

const formatVideoBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatVideoPixels = (pixels: number): string => {
  if (!Number.isFinite(pixels) || pixels <= 0) return "—";
  if (pixels >= 1_000_000) return `${(pixels / 1_000_000).toFixed(1)} MP`;
  return `${Math.max(1, Math.round(pixels / 10_000))} 万像素`;
};

function VideoCompressWorkspace({ source, poster, duration, currentTime, options, processBusy, processProgress, processStatus, processError, canSubmit, dialogRef, titleId, onOptionsChange, onProcess, onCancelProcess, onClearProcessError, onReset, onClose }: VideoCompressWorkspaceProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const [previewTime, setPreviewTime] = React.useState(Math.max(0, currentTime));
  const [previewError, setPreviewError] = React.useState(false);
  const safeDuration = Math.max(0.25, Number.isFinite(duration) ? duration : 0.25);
  const selectedDuration = Math.max(0, Math.min(safeDuration, options.endTime) - Math.max(0, options.startTime));
  const selectedWidth = options.maxWidth || 720;
  const selectedFrameRate = options.frameRate || 30;
  const sourcePixels = dimensions.width * dimensions.height;
  const outputSize = dimensions.width && dimensions.height
    ? videoCanvasSize(dimensions.width, dimensions.height, selectedWidth, "original")
    : { width: 0, height: 0 };
  const outputPixels = outputSize.width * outputSize.height;
  const estimatedBytes = videoExportBitrate(options, outputSize.width && outputSize.height ? outputSize : { width: selectedWidth, height: Math.max(2, Math.round(selectedWidth * 9 / 16)) }) * selectedDuration / 8;
  const reduction = sourcePixels > 0 && outputPixels > 0
    ? Math.max(0, Math.round((1 - outputPixels / sourcePixels) * 100))
    : 0;
  const rangeLabel = `${formatTime(options.startTime)} – ${formatTime(options.endTime)}`;

  React.useLayoutEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), button:not(:disabled)")?.focus({ preventScroll: true });
  }, [dialogRef]);

  React.useEffect(() => {
    if (processBusy) videoRef.current?.pause();
  }, [processBusy]);

  const setOption = <K extends keyof VideoEditOptions>(key: K, value: VideoEditOptions[K]) => {
    onOptionsChange({ ...options, [key]: value });
    if (processError) onClearProcessError();
  };
  const setStartTime = (value: number) => {
    const next = Number.isFinite(value) ? Math.max(0, Math.min(Math.max(0, options.endTime - 0.25), value)) : options.startTime;
    setOption("startTime", next);
  };
  const setEndTime = (value: number) => {
    const next = Number.isFinite(value) ? Math.max(Math.min(safeDuration, Math.max(0.25, options.startTime + 0.25)), Math.min(safeDuration, value)) : options.endTime;
    setOption("endTime", next);
  };
  const setCurrentTime = (value: number) => {
    const next = Math.max(0, Math.min(safeDuration, Number.isFinite(value) ? value : 0));
    setPreviewTime(next);
    if (videoRef.current && Number.isFinite(videoRef.current.duration)) videoRef.current.currentTime = next;
  };

  return <div className="image-tool-modal-backdrop video-compress-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !processBusy) onClose(); }}>
    <div ref={dialogRef} className="image-tool-modal video-compress-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={processBusy} tabIndex={-1} onMouseDown={event => event.stopPropagation()}>
      <header className="video-compress-head image-tool-modal-head">
        <div className="video-compress-title"><div className="video-compress-title-mark"><Shrink size={17} /></div><div><strong id={titleId}>视频压缩</strong><small>调整分辨率、帧率与质量，生成更轻量的新视频节点</small></div></div>
        <button type="button" aria-label="关闭视频工具" disabled={processBusy} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="video-compress-body image-tool-form">
        <main className="video-compress-preview-column">
          <div className="video-compress-preview-shell">
            <video ref={videoRef} key={source} src={source} poster={poster} controls playsInline preload="metadata" crossOrigin={/^https?:\/\//i.test(source) ? "anonymous" : undefined}
              onLoadedMetadata={event => { const video = event.currentTarget; setPreviewError(false); setDimensions({ width: video.videoWidth, height: video.videoHeight }); const time = Math.max(0, Math.min(safeDuration, previewTime)); video.currentTime = time; }}
              onTimeUpdate={event => setPreviewTime(event.currentTarget.currentTime)}
              onError={() => setPreviewError(true)} />
            {!dimensions.width && <div className="video-compress-preview-loading" role={previewError ? "alert" : "status"}>{previewError ? "视频预览加载失败，请检查素材来源" : "正在读取视频预览…"}</div>}
          </div>
          <div className="video-compress-preview-caption"><span>预览</span><strong>{dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height}` : "正在读取分辨率"}</strong><span>·</span><span>{formatTime(selectedDuration)} 处理区间</span></div>
          <section className="video-compress-range-card" aria-label="处理区间">
            <div className="video-compress-section-heading"><div><strong>处理区间</strong><small>只处理选中片段，原视频不会被修改</small></div><span>{rangeLabel}</span></div>
            <div className="video-compress-range-inputs">
              <label>开始时间<input autoFocus={!processBusy} aria-label="开始时间" type="number" min="0" max={safeDuration} step="0.1" value={options.startTime} disabled={processBusy} onChange={event => setStartTime(Number(event.target.value))} /><button type="button" disabled={processBusy || !duration} onClick={() => setStartTime(currentTime)}>设为播放位置</button></label>
              <label>结束时间<input aria-label="结束时间" type="number" min="0" max={safeDuration} step="0.1" value={options.endTime} disabled={processBusy} onChange={event => setEndTime(Number(event.target.value))} /><button type="button" disabled={processBusy || !duration} onClick={() => setEndTime(currentTime)}>设为播放位置</button></label>
            </div>
            <div className="video-compress-range-sliders">
              <input aria-label="开始时间滑块" type="range" min="0" max={safeDuration} step="0.1" value={Math.min(options.startTime, safeDuration)} disabled={processBusy} onChange={event => setStartTime(Number(event.target.value))} />
              <input aria-label="结束时间滑块" type="range" min="0" max={safeDuration} step="0.1" value={Math.min(options.endTime, safeDuration)} disabled={processBusy} onChange={event => setEndTime(Number(event.target.value))} />
            </div>
            <div className="video-compress-range-scale"><span>00:00.00</span><span>{formatTime(safeDuration)}</span><button type="button" disabled={processBusy} onClick={() => { setStartTime(0); setEndTime(safeDuration); setCurrentTime(0); }}>恢复完整视频</button></div>
            <p>单次最多处理 {MAX_VIDEO_EDIT_DURATION_SECONDS / 60} 分钟{duration > MAX_VIDEO_EDIT_DURATION_SECONDS ? "，可拖动滑块选择要处理的区间" : ""}。</p>
          </section>
        </main>
        <aside className="video-compress-inspector">
          <section className="video-compress-card video-compress-source-card">
            <div className="video-compress-section-heading"><div><strong>源视频</strong><small>读取到的原始媒体信息</small></div><span className="video-compress-status-dot">{previewError ? "读取失败" : dimensions.width ? "已加载" : "读取中"}</span></div>
            <div className="video-compress-source-value"><strong>{dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height}` : "读取中"}</strong><span>{formatVideoPixels(sourcePixels)}</span><span>音轨自动保留</span></div>
          </section>
          <section className="video-compress-card">
            <div className="video-compress-section-heading"><div><strong>目标分辨率</strong><small>按最大宽度等比缩放，不会放大原视频</small></div></div>
            <div className="video-compress-resolution-grid" role="radiogroup" aria-label="目标分辨率快捷选项">
              {COMPRESSION_WIDTH_OPTIONS.map(value => <button key={value} type="button" role="radio" aria-checked={selectedWidth === value} className={selectedWidth === value ? "is-selected" : ""} disabled={processBusy} onClick={() => setOption("maxWidth", value)}><strong>{value} px</strong><span>{dimensions.width && dimensions.height ? `${videoCanvasSize(dimensions.width, dimensions.height, value, "original").width} × ${videoCanvasSize(dimensions.width, dimensions.height, value, "original").height}` : "等比输出"}</span></button>)}
            </div>
            <label className="video-compress-native-select"><span>最大宽度</span><select aria-label="最大宽度" value={selectedWidth} disabled={processBusy} onChange={event => setOption("maxWidth", Number(event.target.value) as VideoCompressionWidth)}>{COMPRESSION_WIDTH_OPTIONS.map(value => <option key={value} value={value}>{value} px</option>)}</select></label>
          </section>
          <section className="video-compress-card">
            <div className="video-compress-section-heading"><div><strong>目标帧率</strong><small>降低帧率可进一步减小文件体积</small></div><span>{selectedFrameRate} fps</span></div>
            <div className="video-compress-choice-row" role="radiogroup" aria-label="目标帧率">
              {COMPRESSION_FRAME_RATE_OPTIONS.map(value => <button key={value} type="button" role="radio" aria-checked={selectedFrameRate === value} className={selectedFrameRate === value ? "is-selected" : ""} disabled={processBusy} onClick={() => setOption("frameRate", value)}>{value}fps</button>)}
            </div>
          </section>
          <section className="video-compress-card video-compress-output-card">
            <div className="video-compress-section-heading"><div><strong>输出</strong><small>当前设置下的结果预估</small></div></div>
            <div className="video-compress-output-size">{outputSize.width && outputSize.height ? `${outputSize.width} × ${outputSize.height}` : "读取中"}</div>
            <div className="video-compress-output-tags"><span>{formatVideoPixels(outputPixels)}</span><span>约 {formatVideoBytes(estimatedBytes)}</span><span>{selectedFrameRate} fps</span></div>
            <div className="video-compress-output-meter"><span style={{ width: `${Math.max(4, Math.min(100, reduction || (sourcePixels ? 4 : 18)))}%` }} /></div>
            <p>{reduction > 0 ? `预计画面像素减少 ${reduction}%，文件大小约 ${formatVideoBytes(estimatedBytes)}。` : "当前设置会保持原始画面尺寸，建议选择更低的目标分辨率以减小体积。"} 保留可读取的原始音轨。</p>
            <label className="video-compress-quality"><span>质量</span><select aria-label="质量" value={options.quality} disabled={processBusy} onChange={event => setOption("quality", event.target.value as VideoEditOptions["quality"])}><option value="standard">标准 · 更小体积</option><option value="high">高质量 · 更清晰</option></select></label>
          </section>
        </aside>
      </div>
      {processError && !processBusy && <p className="video-tool-error video-compress-feedback" role="alert">{processError}</p>}
      {processBusy && <div className={`video-tool-progress video-compress-progress${processStatus && !processProgress ? " is-indeterminate" : ""}`} role="status" aria-live="polite"><div className="video-tool-progress-track" role="progressbar" aria-label={processStatus || "视频处理进度"} aria-valuemin={0} aria-valuemax={100} {...(processStatus && !processProgress ? {} : { "aria-valuenow": Math.round(processProgress) })}><span style={processStatus && !processProgress ? undefined : { width: `${processProgress}%` }} /></div><small>{processStatus || `处理中 ${Math.round(processProgress)}%`}</small></div>}
      <footer className="image-tool-actions video-compress-footer">{processBusy ? <button type="button" className="button" onClick={onCancelProcess}>取消处理</button> : <><button type="button" className="image-tool-reset" onClick={onReset}><RotateCcw size={13} />重置</button><button type="button" className="button" onClick={onClose}>{processError ? "关闭" : "取消"}</button><button type="button" className="generate-button" aria-label={processError ? "重试处理" : "开始处理"} disabled={!canSubmit} title={!canSubmit ? `请选择不超过 ${MAX_VIDEO_EDIT_DURATION_SECONDS / 60} 分钟的时间范围` : undefined} onClick={onProcess}>{processError ? "重试处理" : "确认压缩"}<Check size={14} /></button></>}</footer>
    </div>
  </div>;
}

export default function VideoTools({ source, poster, captureReady, duration, currentTime, processBusy, processProgress, processStatus, processError, inlineQuickProcess = false, onCapture, onCaptureFrameAt, onProcess, onCancelProcess, onClearProcessError, onPlaybackLockChange, onNotice }: VideoToolsProps) {
  const [operation, setOperation] = React.useState<VideoEditOperation | null>(null);
  const [options, setOptions] = React.useState<VideoEditOptions | null>(null);
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const wasBusy = React.useRef(false);
  const playbackLockChangeRef = React.useRef(onPlaybackLockChange);
  playbackLockChangeRef.current = onPlaybackLockChange;
  const trigger = React.useRef<HTMLButtonElement>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const captureDialog = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const modalTitle = MENU_TOOLS.find(tool => tool.operation === operation)?.label || "视频工具";
  const quickExport = operation === "extract-audio" || operation === "extract-video";
  const closeDialog = (restoreFocus = true) => {
    if (processBusy) return;
    setOperation(null);
    onClearProcessError();
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const openCaptureBatch = () => {
    if (processBusy || !source || !duration) return;
    dismissMediaToolMenus();
    setCaptureOpen(true);
  };
  const closeCaptureBatch = () => {
    setCaptureOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const begin = (next: VideoEditOperation) => {
    if (processBusy) return;
    dismissMediaToolMenus();
    onClearProcessError();
    const nextOptions = defaultOptions(next, duration, currentTime);
    if (next === "extract-audio" || next === "extract-video") {
      nextOptions.startTime = 0;
      nextOptions.endTime = duration;
      if (next === "extract-audio" && inlineQuickProcess) {
        onProcess(nextOptions);
        return;
      }
      setOperation(next); setOptions(nextOptions); onProcess(nextOptions);
      return;
    }
    setOperation(next); setOptions(nextOptions);
  };
  const setOption = <K extends keyof VideoEditOptions>(key: K, value: VideoEditOptions[K]) => setOptions(current => current ? { ...current, [key]: value } : current);
  const processableRange = Boolean(options && Number.isFinite(options.startTime) && Number.isFinite(options.endTime)
    && options.endTime - options.startTime >= 0.25 && (quickExport || options.endTime - options.startTime <= MAX_VIDEO_EDIT_DURATION_SECONDS)
    && (operation !== "watermark" || Boolean(options.watermarkText?.trim())));
  const submit = () => { if (!processBusy && options && processableRange) { onClearProcessError(); onProcess(options); } };
  React.useLayoutEffect(() => {
    if (!operation && !captureOpen) return;
    playbackLockChangeRef.current?.(true);
    return () => playbackLockChangeRef.current?.(false);
  }, [operation, captureOpen]);
  React.useEffect(() => {
    if (processBusy) { wasBusy.current = true; }
    else if (wasBusy.current) {
      wasBusy.current = false;
      if (processError) onNotice?.(processError);
      else closeDialog();
    }
  }, [processBusy, processError, onNotice]);
  React.useLayoutEffect(() => {
    if (!operation || !dialog.current) return;
    (dialog.current.querySelector<HTMLElement>(".image-tool-form input:not(:disabled), .image-tool-form select:not(:disabled), .image-tool-actions button:not(:disabled)") || dialog.current)?.focus({ preventScroll: true });
  }, [operation, processBusy]);
  React.useEffect(() => {
    if (!operation && !captureOpen) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (captureOpen) closeCaptureBatch();
        else if (!processBusy) closeDialog();
        return;
      }
      const activeDialog = captureOpen ? captureDialog.current : dialog.current;
      if (event.key !== "Tab" || !activeDialog) return;
      const items = [...activeDialog.querySelectorAll<HTMLElement>("input:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex='-1'])")].filter(item => !item.matches(":disabled"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [operation, captureOpen, processBusy]);
  const action = (tool: MenuTool) => { if (processBusy) return; if (tool.id === "capture") onCapture(); else if (tool.id === "capture-batch") openCaptureBatch(); else if (tool.operation) begin(tool.operation); };
  const menuGroups = MENU_GROUPS.map(group => ({ label: group.label, items: group.tools.map(tool => ({ id: tool.id, label: tool.label, detail: tool.detail, icon: tool.icon, disabledReason: tool.available === false ? "暂不可用" : !captureReady || (tool.operation === "trim" && !source) ? "视频加载完成后可使用" : undefined, onSelect: () => action(tool) })) }));
  const batchDialog = captureOpen && source ? <VideoFrameBatchDialog source={source} poster={poster} duration={duration} initialTime={currentTime} dialogRef={captureDialog} onCancel={closeCaptureBatch} onCaptureFrame={onCaptureFrameAt} onComplete={closeCaptureBatch} /> : null;
  const close = (restoreFocus = true) => {
    if (processBusy) return;
    setOperation(null); onClearProcessError();
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  return <div className="image-tools video-tools" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <MediaToolMenu label="视频工具" triggerLabel="工具" icon={Film} groups={menuGroups} disabled={processBusy} className="video-tools-control" triggerRef={trigger} />
    {batchDialog && typeof document !== "undefined" ? createPortal(batchDialog, document.body) : null}
    {operation === "trim" && options && source && typeof document !== "undefined" ? createPortal(<VideoTrimWorkspace source={source} poster={poster} duration={duration} currentTime={currentTime} options={options} processBusy={processBusy} processProgress={processProgress} processStatus={processStatus} processError={processError} onOptionsChange={setOptions} onProcess={() => { onClearProcessError(); onProcess(options); }} onCancelProcess={onCancelProcess} onClose={close} />, document.body) : operation === "crop" && options && source && typeof document !== "undefined" ? createPortal(<VideoCropWorkspace source={source} poster={poster} duration={duration} currentTime={currentTime} options={options} processBusy={processBusy} processProgress={processProgress} processStatus={processStatus} processError={processError} canSubmit={processableRange} dialogRef={dialog} titleId={titleId} onOptionsChange={setOptions} onProcess={submit} onCancelProcess={onCancelProcess} onClearProcessError={onClearProcessError} onReset={() => { if (operation) { setOptions(defaultOptions(operation, duration, currentTime)); onClearProcessError(); } }} onClose={closeDialog} />, document.body) : operation === "compress" && options && source && typeof document !== "undefined" ? createPortal(<VideoCompressWorkspace source={source} poster={poster} duration={duration} currentTime={currentTime} options={options} processBusy={processBusy} processProgress={processProgress} processStatus={processStatus} processError={processError} canSubmit={processableRange} dialogRef={dialog} titleId={titleId} onOptionsChange={setOptions} onProcess={submit} onCancelProcess={onCancelProcess} onClearProcessError={onClearProcessError} onReset={() => { if (operation) { setOptions(defaultOptions(operation, duration, currentTime)); onClearProcessError(); } }} onClose={closeDialog} />, document.body) : operation && options && typeof document !== "undefined" ? createPortal(<div className="image-tool-modal-backdrop" role="presentation" onMouseDown={() => closeDialog()}><div ref={dialog} className="image-tool-modal video-tool-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={processBusy} tabIndex={-1} onMouseDown={event => event.stopPropagation()}><div className="image-tool-modal-head"><div><strong id={titleId}>{modalTitle}</strong><small>{operation === "extract-audio" ? "提取结果会添加为音频节点。" : "处理结果保存为新视频节点，原视频保持不变。"}</small></div><button type="button" aria-label="关闭视频工具" disabled={processBusy} onClick={() => closeDialog()}><X size={17} /></button></div><div className="image-tool-form">
      {quickExport ? <p className="video-tool-note">{operation === "extract-audio" ? "正在提取完整音轨，完成后添加音频节点。" : "正在提取完整视频，完成后添加视频节点。"}</p> : <fieldset className="video-tool-settings" disabled={processBusy}>
      <div className="video-tool-range"><div className="video-tool-range-heading"><strong>处理区间</strong><span>{formatTime(options.startTime)} - {formatTime(options.endTime)} <small>({formatTime(options.endTime - options.startTime)})</small></span></div>
        <label className="video-tool-time-input">开始<input aria-label="开始时间" type="number" min="0" max={duration} step="0.1" value={options.startTime} onChange={event => setOption("startTime", Math.max(0, Math.min(options.endTime - 0.25, Number(event.target.value))))} /><button type="button" aria-label="将开始时间设为当前播放位置" disabled={!duration} onClick={() => setOption("startTime", Math.max(0, Math.min(options.endTime - 0.25, currentTime)))}>设为播放位置</button></label>
        <input className="video-tool-range-slider" aria-label="开始时间滑块" type="range" min="0" max={Math.max(duration, 0.25)} step="0.1" value={options.startTime} onChange={event => setOption("startTime", Math.max(0, Math.min(options.endTime - 0.25, Number(event.target.value))))} />
        <label className="video-tool-time-input">结束<input aria-label="结束时间" type="number" min="0" max={duration} step="0.1" value={options.endTime} onChange={event => setOption("endTime", Math.max(options.startTime + 0.25, Math.min(duration, Number(event.target.value))))} /><button type="button" aria-label="将结束时间设为当前播放位置" disabled={!duration} onClick={() => setOption("endTime", Math.max(options.startTime + 0.25, Math.min(duration, currentTime)))}>设为播放位置</button></label>
        <input className="video-tool-range-slider" aria-label="结束时间滑块" type="range" min="0" max={Math.max(duration, 0.25)} step="0.1" value={options.endTime} onChange={event => setOption("endTime", Math.max(options.startTime + 0.25, Math.min(duration, Number(event.target.value))))} />
        <div className="video-tool-range-scale"><span>00:00</span><span>{formatTime(duration)}</span></div>
      </div>
      <p className="video-tool-note">单次最多处理 {MAX_VIDEO_EDIT_DURATION_SECONDS / 60} 分钟{duration > MAX_VIDEO_EDIT_DURATION_SECONDS ? "，可拖动滑块选择要处理的区间" : ""}。</p>
      {operation === "crop" && <label>输出比例<select value={options.aspectRatio} onChange={event => setOption("aspectRatio", event.target.value as VideoEditOptions["aspectRatio"])}><option value="original">保持原比例</option><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option></select></label>}
      {operation === "compress" && <><label>最大宽度<select value={options.maxWidth} onChange={event => setOption("maxWidth", Number(event.target.value) as VideoEditOptions["maxWidth"])}><option value="480">480 px</option><option value="720">720 px</option><option value="1080">1080 px</option></select></label><label>质量<select value={options.quality} onChange={event => setOption("quality", event.target.value as VideoEditOptions["quality"])}><option value="standard">标准</option><option value="high">高质量</option></select></label></>}
      {operation === "grade" && <label>风格<select value={options.grade} onChange={event => setOption("grade", event.target.value as VideoEditOptions["grade"])}><option value="natural">自然</option><option value="warm">暖色</option><option value="cool">冷色</option><option value="cinematic">电影感</option><option value="mono">黑白</option></select></label>}
      {operation === "rotate" && <label>旋转角度<select value={options.rotation} onChange={event => setOption("rotation", Number(event.target.value) as VideoEditOptions["rotation"])}><option value="90">顺时针 90°</option><option value="180">180°</option><option value="270">顺时针 270°</option></select></label>}
      {operation === "mirror" && <div className="video-tool-checks"><label><input type="checkbox" checked={Boolean(options.flipHorizontal)} onChange={event => setOption("flipHorizontal", event.target.checked)} />水平镜像</label><label><input type="checkbox" checked={Boolean(options.flipVertical)} onChange={event => setOption("flipVertical", event.target.checked)} />垂直翻转</label></div>}
      {operation === "watermark" && <><label>水印文字<input type="text" maxLength={100} value={options.watermarkText || ""} placeholder="输入水印文字" onChange={event => setOption("watermarkText", event.target.value)} /></label><label>水印位置<select value={options.watermarkPosition} onChange={event => setOption("watermarkPosition", event.target.value as VideoEditOptions["watermarkPosition"])}><option value="bottom-right">右下</option><option value="bottom-left">左下</option><option value="top-right">右上</option><option value="top-left">左上</option></select></label><label>不透明度 {Math.round((options.watermarkOpacity ?? 0.72) * 100)}%<input type="range" min="20" max="100" step="5" value={Math.round((options.watermarkOpacity ?? 0.72) * 100)} onChange={event => setOption("watermarkOpacity", Number(event.target.value) / 100)} /></label></>}
      {operation === "mute" && <p className="video-tool-note">导出后会保留画面并移除全部音轨。</p>}
      </fieldset>}
      {processError && !processBusy && <p className="video-tool-error" role="alert">{processError}</p>}
      {processBusy && <div className={`video-tool-progress${processStatus && !processProgress ? " is-indeterminate" : ""}`} role="status" aria-live="polite">
        <div className="video-tool-progress-track" role="progressbar" aria-label={processStatus || "视频处理进度"} aria-valuemin={0} aria-valuemax={100} {...(processStatus && !processProgress ? {} : { "aria-valuenow": Math.round(processProgress) })}>
          <span style={processStatus && !processProgress ? undefined : { width: `${processProgress}%` }} />
        </div>
        <small>{processStatus || `处理中 ${Math.round(processProgress)}%`}</small>
      </div>}
    </div><div className="image-tool-actions">{processBusy ? <button type="button" className="button" onClick={onCancelProcess}>取消处理</button> : <>{!quickExport && <button type="button" className="image-tool-reset" onClick={() => { setOptions(defaultOptions(operation, duration, currentTime)); onClearProcessError(); }}><RotateCcw size={13} />重置</button>}<button type="button" className="button" onClick={() => closeDialog()}>{processError ? "关闭" : "取消"}</button><button type="button" className="generate-button" disabled={!processableRange} title={!processableRange ? `请选择不超过 ${MAX_VIDEO_EDIT_DURATION_SECONDS / 60} 分钟的时间范围` : undefined} onClick={submit}>{processError ? "重试处理" : "开始处理"}</button></>}</div></div></div>, document.body) : null}
  </div>;
}
