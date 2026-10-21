import React from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronsLeft, ChevronsRight, Crop, Film, FlipHorizontal, Gauge, Minus, Palette, Pause, Play, Plus, RotateCcw, RotateCw, Scissors, Shrink, SkipBack, SkipForward, Type, Volume2, VolumeX, X } from "lucide-react";
import { initialVideoEditRange, MAX_VIDEO_EDIT_DURATION_SECONDS, type VideoEditOperation, type VideoEditOptions } from "./video-editing";
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
  processError?: string;
  onCapture: () => void;
  onProcess: (options: VideoEditOptions) => void;
  onCancelProcess: () => void;
  onClearProcessError: () => void;
  onNotice?: (text: string) => void;
};
type MenuTool = { id: string; label: string; detail: string; icon: typeof Camera; operation?: VideoEditOperation; available?: boolean };
const MENU_GROUPS: Array<{ label: string; tools: MenuTool[] }> = [
  { label: "剪辑与导出", tools: [
    { id: "trim", label: "裁剪视频", detail: "预览并选择视频片段", icon: Scissors, operation: "trim" },
    { id: "extract-video", label: "提取视频", detail: "将完整视频添加为新节点", icon: Scissors, operation: "extract-video" },
    { id: "compress", label: "视频压缩", detail: "降低分辨率和码率", icon: Shrink, operation: "compress" },
  ] },
  { label: "画面", tools: [
    { id: "crop", label: "画面裁剪", detail: "裁剪为常用比例", icon: Crop, operation: "crop" },
    { id: "grade", label: "基础调色", detail: "本地基础色彩预设", icon: Palette, operation: "grade" },
    { id: "rotate", label: "旋转", detail: "旋转 90°、180° 或 270°", icon: RotateCw, operation: "rotate" },
    { id: "mirror", label: "镜像", detail: "水平镜像或垂直翻转", icon: FlipHorizontal, operation: "mirror" },
    { id: "speed", label: "调整速度", detail: "0.5× 至 2× 变速导出", icon: Gauge, operation: "speed" },
    { id: "watermark", label: "文字水印", detail: "添加位置和透明度可调的文字", icon: Type, operation: "watermark" },
    { id: "capture", label: "截取当前帧", detail: "将画面保存为图片", icon: Camera },
  ] },
  { label: "声音", tools: [
    { id: "extract-audio", label: "提取音频", detail: "将完整音轨添加为新节点", icon: Volume2, operation: "extract-audio" },
    { id: "mute", label: "移除音轨", detail: "导出无声视频", icon: VolumeX, operation: "mute" },
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
const defaultOptions = (operation: VideoEditOperation, duration: number, currentTime: number): VideoEditOptions => ({
  operation,
  ...initialVideoEditRange(duration, currentTime, operation === "extract-video" || operation === "extract-audio" || duration > MAX_VIDEO_EDIT_DURATION_SECONDS),
  outputFormat: "webm",
  watermarkText: "", watermarkPosition: "bottom-right", watermarkOpacity: 0.72,
  aspectRatio: "original", maxWidth: 720, quality: "standard", grade: "natural", rotation: 90, flipHorizontal: operation === "mirror", flipVertical: false, playbackRate: 1,
});

function VideoTrimWorkspace({ source, poster, duration, currentTime, options, processBusy, processProgress, processError, onOptionsChange, onProcess, onCancelProcess, onClose }: {
  source: string;
  poster?: string;
  duration: number;
  currentTime: number;
  options: VideoEditOptions;
  processBusy: boolean;
  processProgress: number;
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
      {processBusy && <div className="video-trim-progress" role="status" aria-live="polite"><span style={{ width: `${processProgress}%` }} /><small>正在导出 {Math.round(processProgress)}%</small></div>}
      <footer className="video-trim-footer"><span>选中 {formatTime(selectedDuration)} / {formatTime(totalDuration)}</span><div>{processBusy ? <button type="button" className="button" onClick={onCancelProcess}>取消处理</button> : <><button type="button" className="button" onClick={onClose}>{processError ? "关闭" : "取消"}</button><button type="button" className="generate-button" disabled={selectedDuration < 0.25 || selectedDuration > MAX_VIDEO_EDIT_DURATION_SECONDS || !source} onClick={onProcess}>{processError ? "重试裁剪" : "确认裁剪"}</button></>}</div></footer>
    </section>
  </div>;
}

export default function VideoTools({ source, poster, captureReady, duration, currentTime, processBusy, processProgress, processError, onCapture, onProcess, onCancelProcess, onClearProcessError, onNotice }: VideoToolsProps) {
  const [operation, setOperation] = React.useState<VideoEditOperation | null>(null);
  const [options, setOptions] = React.useState<VideoEditOptions | null>(null);
  const wasBusy = React.useRef(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const modalTitle = MENU_TOOLS.find(tool => tool.operation === operation)?.label || "视频工具";
  const quickExport = operation === "extract-audio" || operation === "extract-video";
  const closeDialog = (restoreFocus = true) => {
    if (processBusy) return;
    setOperation(null);
    onClearProcessError();
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const begin = (next: VideoEditOperation) => {
    if (processBusy) return;
    dismissMediaToolMenus();
    onClearProcessError();
    const nextOptions = defaultOptions(next, duration, currentTime);
    if (next === "extract-audio" || next === "extract-video") {
      nextOptions.startTime = 0;
      nextOptions.endTime = duration;
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
    if (!operation) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!processBusy) closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("input:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex='-1'])")].filter(item => !item.matches(":disabled"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [operation, processBusy]);
  const action = (tool: MenuTool) => { if (processBusy) return; if (tool.id === "capture") onCapture(); else if (tool.operation) begin(tool.operation); };
  const menuGroups = MENU_GROUPS.map(group => ({ label: group.label, items: group.tools.map(tool => ({ id: tool.id, label: tool.label, detail: tool.detail, icon: tool.icon, disabledReason: tool.available === false ? "暂不可用" : !captureReady || (tool.operation === "trim" && !source) ? "视频加载完成后可使用" : undefined, onSelect: () => action(tool) })) }));
  const close = (restoreFocus = true) => {
    if (processBusy) return;
    setOperation(null); onClearProcessError();
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  return <div className="image-tools video-tools" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <MediaToolMenu label="视频工具" triggerLabel="工具" icon={Film} groups={menuGroups} disabled={processBusy} className="video-tools-control" triggerRef={trigger} />
    {operation === "trim" && options && source && typeof document !== "undefined" ? createPortal(<VideoTrimWorkspace source={source} poster={poster} duration={duration} currentTime={currentTime} options={options} processBusy={processBusy} processProgress={processProgress} processError={processError} onOptionsChange={setOptions} onProcess={() => { onClearProcessError(); onProcess(options); }} onCancelProcess={onCancelProcess} onClose={close} />, document.body) : operation && options && typeof document !== "undefined" ? createPortal(<div className="image-tool-modal-backdrop" role="presentation" onMouseDown={() => closeDialog()}><div ref={dialog} className="image-tool-modal video-tool-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={processBusy} tabIndex={-1} onMouseDown={event => event.stopPropagation()}><div className="image-tool-modal-head"><div><strong id={titleId}>{modalTitle}</strong><small>生成新的处理结果</small></div><button type="button" aria-label="关闭视频工具" disabled={processBusy} onClick={() => closeDialog()}><X size={17} /></button></div><div className="image-tool-form">
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
      {operation === "speed" && <label>播放速度<select value={options.playbackRate} onChange={event => setOption("playbackRate", Number(event.target.value) as VideoEditOptions["playbackRate"])}><option value="0.5">0.5× 慢速</option><option value="0.75">0.75×</option><option value="1">1× 原速</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2× 快速</option></select></label>}
      {operation === "watermark" && <><label>水印文字<input type="text" maxLength={100} value={options.watermarkText || ""} placeholder="输入水印文字" onChange={event => setOption("watermarkText", event.target.value)} /></label><label>水印位置<select value={options.watermarkPosition} onChange={event => setOption("watermarkPosition", event.target.value as VideoEditOptions["watermarkPosition"])}><option value="bottom-right">右下</option><option value="bottom-left">左下</option><option value="top-right">右上</option><option value="top-left">左上</option></select></label><label>不透明度 {Math.round((options.watermarkOpacity ?? 0.72) * 100)}%<input type="range" min="20" max="100" step="5" value={Math.round((options.watermarkOpacity ?? 0.72) * 100)} onChange={event => setOption("watermarkOpacity", Number(event.target.value) / 100)} /></label></>}
      {operation === "mute" && <p className="video-tool-note">导出后会保留画面并移除全部音轨。</p>}
      </fieldset>}
      {processBusy && <div className="video-tool-progress" role="status" aria-live="polite"><span style={{ width: `${processProgress}%` }} /><small>处理中 {Math.round(processProgress)}%</small></div>}
    </div><div className="image-tool-actions">{processBusy ? <button type="button" className="button" onClick={onCancelProcess}>取消处理</button> : <>{!quickExport && <button type="button" className="image-tool-reset" onClick={() => { setOptions(defaultOptions(operation, duration, currentTime)); onClearProcessError(); }}><RotateCcw size={13} />重置</button>}<button type="button" className="button" onClick={() => closeDialog()}>{processError ? "关闭" : "取消"}</button><button type="button" className="generate-button" disabled={!processableRange} title={!processableRange ? `请选择不超过 ${MAX_VIDEO_EDIT_DURATION_SECONDS / 60} 分钟的时间范围` : undefined} onClick={submit}>{processError ? "重试处理" : "开始处理"}</button></>}</div></div></div>, document.body) : null}
  </div>;
}
