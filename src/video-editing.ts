export type VideoEditOperation = "trim" | "extract-video" | "extract-audio" | "convert" | "crop" | "compress" | "grade" | "rotate" | "mirror" | "speed" | "watermark" | "mute";
export type VideoOutputFormat = "webm" | "mp4";
export const MAX_VIDEO_EDIT_DURATION_SECONDS = 300;
export type VideoEditOptions = {
  operation: VideoEditOperation;
  startTime: number;
  endTime: number;
  outputFormat?: VideoOutputFormat;
  aspectRatio?: "original" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "2:3";
  cropLeft?: number;
  cropRight?: number;
  cropTop?: number;
  cropBottom?: number;
  maxWidth?: 360 | 480 | 540 | 720 | 1080;
  frameRate?: 15 | 24 | 30;
  quality?: "standard" | "high";
  grade?: "natural" | "warm" | "cool" | "cinematic" | "mono";
  rotation?: 0 | 90 | 180 | 270;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  playbackRate?: 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
  watermarkText?: string;
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  watermarkOpacity?: number;
};

/** Keep a processed result's source and the exact scalar controls needed to identify the edit. */
export function videoEditOperationParams(
  sourceNodeId: string,
  options: VideoEditOptions,
  mimeType: string,
  size: number,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    sourceNodeId,
    startTime: options.startTime,
    endTime: options.endTime,
    mimeType,
    size,
  };
  for (const [key, value] of Object.entries(options)) {
    if (key === "operation" || key in params || !["string", "number", "boolean"].includes(typeof value)) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    params[key] = value as string | number | boolean;
  }
  return params;
}

/** Playback-rate edits alter the encoded clip length; the other operations preserve their selected range. */
export function videoEditOutputDuration(options: VideoEditOptions): number {
  const rate = options.operation === "speed" ? options.playbackRate || 1 : 1;
  return Math.max(0.25, (options.endTime - options.startTime) / rate);
}

type VideoCaptureElement = HTMLVideoElement & { captureStream: (frameRate?: number) => MediaStream };

const WEBM_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const MP4_TYPES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4"];
const VIDEO_TYPES = [...WEBM_TYPES, ...MP4_TYPES];
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];

export function recorderMimeType(operation: VideoEditOperation, isSupported: (type: string) => boolean, outputFormat?: VideoOutputFormat): string {
  const types = operation === "extract-audio" ? AUDIO_TYPES
    : operation === "convert" && outputFormat === "mp4" ? MP4_TYPES
      : operation === "convert" && outputFormat === "webm" ? WEBM_TYPES
        : VIDEO_TYPES;
  const type = types.find(isSupported);
  if (!type) throw new Error(operation === "extract-audio"
    ? "此浏览器不支持导出音频，请使用支持 WebM/Opus 的浏览器。"
    : operation === "convert" ? `此浏览器不支持导出 ${outputFormat?.toUpperCase() || "所选"} 格式，请选择其他可用格式。`
    : "此浏览器不支持视频导出，请使用支持 WebM 的浏览器。");
  return type;
}

export function supportedVideoOutputFormats(isSupported: (type: string) => boolean): VideoOutputFormat[] {
  const formats: VideoOutputFormat[] = [];
  if (WEBM_TYPES.some(isSupported)) formats.push("webm");
  if (MP4_TYPES.some(isSupported)) formats.push("mp4");
  return formats;
}

export function initialVideoEditRange(duration: number, currentTime: number, startAtCurrentTime: boolean): { startTime: number; endTime: number } {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const startTime = startAtCurrentTime
    ? Math.max(0, Math.min(Number.isFinite(currentTime) ? currentTime : 0, Math.max(0, safeDuration - 0.25)))
    : 0;
  const endTime = startAtCurrentTime ? Math.min(safeDuration, startTime + MAX_VIDEO_EDIT_DURATION_SECONDS) : safeDuration;
  return { startTime, endTime };
}

export function videoOutputExtension(mimeType: string): string {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/mp4") return "m4a";
  if (mime.startsWith("audio/")) return "webm";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/ogg") return "ogv";
  if (mime === "video/x-matroska") return "mkv";
  return "webm";
}

export function videoEditRange(duration: number, start: number, end: number, maxDuration = MAX_VIDEO_EDIT_DURATION_SECONDS): { start: number; end: number } {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长。");
  const from = Math.max(0, Math.min(duration, Number.isFinite(start) ? start : 0));
  const to = Math.max(0, Math.min(duration, Number.isFinite(end) ? end : duration));
  if (to - from < 0.25) throw new Error("截取范围至少需要 0.25 秒。");
  if (to - from > maxDuration) throw new Error(`单次本地处理最多 ${Math.floor(maxDuration / 60)} 分钟，请先缩短截取范围。`);
  return { start: from, end: to };
}

export function videoCanvasSize(width: number, height: number, maxWidth: number, ratio: VideoEditOptions["aspectRatio"]): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  let sourceWidth = safeWidth;
  let sourceHeight = safeHeight;
  if (ratio && ratio !== "original") {
    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    const targetRatio = ratioWidth / ratioHeight;
    if (safeWidth / safeHeight > targetRatio) sourceWidth = safeHeight * targetRatio;
    else sourceHeight = safeWidth / targetRatio;
  }
  const scale = Math.min(1, Math.max(2, maxWidth) / sourceWidth);
  const targetWidth = Math.max(2, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(2, Math.round(sourceHeight * scale));
  return { width: Math.max(2, targetWidth - targetWidth % 2), height: Math.max(2, targetHeight - targetHeight % 2) };
}

export function gradeFilter(grade: VideoEditOptions["grade"]): string {
  switch (grade) {
    case "warm": return "sepia(.16) saturate(1.18) contrast(1.04)";
    case "cool": return "saturate(.92) hue-rotate(9deg) contrast(1.04)";
    case "cinematic": return "saturate(.82) contrast(1.16) brightness(.96)";
    case "mono": return "grayscale(1) contrast(1.06)";
    default: return "none";
  }
}

export function videoTransformDimensions(width: number, height: number, rotation: VideoEditOptions["rotation"] = 0): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  return rotation === 90 || rotation === 270
    ? { width: safeHeight, height: safeWidth }
    : { width: safeWidth, height: safeHeight };
}

export function watermarkPlacement(width: number, height: number, position: VideoEditOptions["watermarkPosition"] = "bottom-right", margin = 24): { x: number; y: number; align: CanvasTextAlign } {
  const left = position === "top-left" || position === "bottom-left";
  const top = position === "top-left" || position === "top-right";
  return { x: left ? margin : width - margin, y: top ? margin : height - margin, align: left ? "left" : "right" };
}

export function videoExportBitrate(options: VideoEditOptions, size: { width: number; height: number }): number {
  if (options.operation === "compress") return options.quality === "high" ? 3_000_000 : 1_000_000;
  const pixels = Math.max(1, size.width * size.height);
  return Math.min(30_000_000, Math.max(5_000_000, Math.round(5_000_000 * pixels / (1920 * 1080))));
}

export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  const abortError = () => new DOMException("视频处理已取消。", "AbortError");
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onResolve = (value: T) => { cleanup(); resolve(value); };
    const onReject = (error: unknown) => { cleanup(); reject(error); };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(onResolve, onReject);
  });
}

type AudioTrackExtractor = (video: HTMLVideoElement, range: { start: number; end: number }, signal?: AbortSignal, maxOutputBytes?: number, onProgress?: (progress: number) => void) => Promise<Blob>;

/** Extracts encoded audio packets without playing every video frame in real time. */
export const extractAudioTrack: AudioTrackExtractor = async (video, range, signal, maxOutputBytes = Number.POSITIVE_INFINITY, onProgress = () => {}) => {
  const { Input, Output, Conversion, BufferTarget, UrlSource, BlobSource, MP4, QTFF, WEBM, MATROSKA, OGG, WebMOutputFormat, Mp4OutputFormat } = await raceWithAbort(import("mediabunny"), signal);
  const sourceUrl = video.currentSrc || video.src;
  if (!sourceUrl) throw new Error("视频地址不可用，无法快速提取音轨。");

  let source: InstanceType<typeof UrlSource> | InstanceType<typeof BlobSource>;
  if (/^https?:/i.test(sourceUrl)) {
    source = new UrlSource(sourceUrl, {
      maxCacheSize: 16 * 1024 * 1024,
      parallelism: 4,
      requestInit: { credentials: "omit", referrerPolicy: "no-referrer" },
      // Do not let a stalled signed URL spend minutes retrying before we can fall back to the playing element.
      getRetryDelay: () => null,
    });
  } else {
    const response = await raceWithAbort(fetch(sourceUrl, { signal, credentials: "omit", referrerPolicy: "no-referrer" }), signal);
    if (!response.ok) throw new Error(`读取视频失败（HTTP ${response.status}）。`);
    source = new BlobSource(await raceWithAbort(response.blob(), signal));
  }

  const input = new Input({ source, formats: [MP4, QTFF, WEBM, MATROSKA, OGG] });
  let output: InstanceType<typeof Output> | undefined;
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
  let completed = false;
  const abort = () => {
    input.dispose();
    void conversion?.cancel().catch(() => {});
    void output?.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const audioTrack = await raceWithAbort(input.getPrimaryAudioTrack(), signal);
    if (!audioTrack) throw new Error("此视频没有可提取的音轨。");
    const codec = await raceWithAbort(audioTrack.getCodec(), signal);
    const target = new BufferTarget({
      onFinalize: buffer => {
        if (buffer.byteLength > maxOutputBytes) throw new Error("提取音频超过本机缓存上限 50 MiB，已停止。请使用其他音频提取工具。");
      },
    });
    // AAC is common in MP4/MOV videos. Keeping it in an MP4 audio container
    // allows packet copying even on browsers without a WebCodecs AAC decoder.
    output = new Output({ format: codec === "aac" ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
    conversion = await raceWithAbort(Conversion.init({
      input,
      output,
      tracks: "primary",
      audio: {},
      video: { discard: true },
      trim: { start: range.start, end: range.end },
      copy: { mode: "preferred" },
    }), signal);
    if (!conversion.isValid) throw new Error("当前视频音频编码无法直接转换，请重试或使用其他音频提取工具。");
    conversion.onProgress = (progress: number) => onProgress(Math.max(0, Math.min(100, progress * 100)));
    await raceWithAbort(conversion.execute(), signal);
    signal?.throwIfAborted();
    const buffer = target.buffer;
    if (!buffer?.byteLength) throw new Error("视频处理没有生成音频结果。");
    if (buffer.byteLength > maxOutputBytes) throw new Error("提取音频超过本机缓存上限 50 MiB，已停止。请使用其他音频提取工具。");
    onProgress(100);
    const mimeType = await output.getMimeType();
    completed = true;
    return new Blob([buffer], { type: mimeType || "audio/webm" });
  } finally {
    signal?.removeEventListener("abort", abort);
    input.dispose();
    if (!completed && output && output.state !== "finalized") await output.cancel().catch(() => {});
  }
};

function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("视频处理已取消。", "AbortError"));
  if (Math.abs(video.currentTime - time) < 0.02 && !video.seeking) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error("定位视频片段超时，请重试。")), 15_000);
    const done = (error?: Error) => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const onSeeked = () => done();
    const onError = () => done(new Error("定位视频片段失败，视频可能已损坏。"));
    const onAbort = () => done(new DOMException("视频处理已取消。", "AbortError"));
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    video.currentTime = time;
  });
}

function cropRect(width: number, height: number, ratio?: VideoEditOptions["aspectRatio"], options?: VideoEditOptions) {
  const marginValues = [options?.cropLeft, options?.cropRight, options?.cropTop, options?.cropBottom];
  const hasCustomMargins = marginValues.some(value => typeof value === "number" && Number.isFinite(value));
  if (hasCustomMargins) {
    const left = Math.max(0, Math.min(94, Number(options?.cropLeft) || 0));
    const right = Math.max(0, Math.min(94, Number(options?.cropRight) || 0));
    const top = Math.max(0, Math.min(94, Number(options?.cropTop) || 0));
    const bottom = Math.max(0, Math.min(94, Number(options?.cropBottom) || 0));
    const horizontal = left + right > 94 ? 94 / Math.max(left + right, 1) : 1;
    const vertical = top + bottom > 94 ? 94 / Math.max(top + bottom, 1) : 1;
    const safeLeft = left * horizontal, safeRight = right * horizontal;
    const safeTop = top * vertical, safeBottom = bottom * vertical;
    return { x: width * safeLeft / 100, y: height * safeTop / 100, width: width * (100 - safeLeft - safeRight) / 100, height: height * (100 - safeTop - safeBottom) / 100 };
  }
  if (!ratio || ratio === "original") return { x: 0, y: 0, width, height };
  const [rw, rh] = ratio.split(":").map(Number);
  const targetRatio = rw / rh;
  const sourceRatio = width / height;
  if (sourceRatio > targetRatio) {
    const cropWidth = height * targetRatio;
    return { x: (width - cropWidth) / 2, y: 0, width: cropWidth, height };
  }
  const cropHeight = width / targetRatio;
  return { x: 0, y: (height - cropHeight) / 2, width, height: cropHeight };
}

/** Re-encode a bounded segment from the already-decoded canvas player. */
export async function exportVideoEdit(
  video: HTMLVideoElement,
  options: VideoEditOptions,
  onProgress: (progress: number) => void = () => {},
  signal?: AbortSignal,
  maxOutputBytes = Number.POSITIVE_INFINITY,
  onStatus: (status: string) => void = () => {},
): Promise<Blob> {
  if (!video.isConnected || video.readyState < 2 || video.seeking || video.videoWidth <= 0 || video.videoHeight <= 0) throw new Error("请先等待视频加载完成并停止缓冲。");
  const audioOnly = options.operation === "extract-audio";
  const range = videoEditRange(video.duration, options.startTime, options.endTime,
    options.operation === "extract-video" || audioOnly ? Number.POSITIVE_INFINITY : MAX_VIDEO_EDIT_DURATION_SECONDS);
  if (audioOnly) {
    onStatus("正在快速提取音轨…");
    try {
      return await extractAudioTrack(video, range, signal, maxOutputBytes, onProgress);
    } catch (error) {
      if (signal?.aborted || error instanceof DOMException && error.name === "AbortError" || error instanceof Error && /超过本机缓存上限|没有可提取的音轨/.test(error.message)) throw error;
      onStatus("无法直接拆分此视频，正在切换为实时录制…");
    }
  }
  const captureElement = video as VideoCaptureElement;
  if (typeof captureElement.captureStream !== "function") throw new Error("当前浏览器无法录制播放中的视频，请使用 Chrome 或 Edge 桌面版。");
  if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持本地视频导出。");
  if (options.operation === "watermark" && !options.watermarkText?.trim()) throw new Error("请输入水印文字。");
  const type = recorderMimeType(options.operation, value => MediaRecorder.isTypeSupported(value), options.outputFormat);
  const rotation = options.operation === "rotate" ? options.rotation || 90 : 0;
  const transformed = videoTransformDimensions(video.videoWidth, video.videoHeight, rotation);
  const maxWidth = options.operation === "compress" ? options.maxWidth || 720 : transformed.width;
  const cropSource = options.operation === "crop" ? cropRect(video.videoWidth, video.videoHeight, options.aspectRatio, options) : cropRect(video.videoWidth, video.videoHeight, "original");
  const size = options.operation === "crop"
    ? videoCanvasSize(cropSource.width, cropSource.height, transformed.width, "original")
    : videoCanvasSize(transformed.width, transformed.height, maxWidth, "original");
  const previousTime = video.currentTime;
  const previousPaused = video.paused;
  const previousMuted = video.muted;
  const previousPlaybackRate = video.playbackRate;
  let recorder: MediaRecorder | undefined;
  let combinedStream: MediaStream | undefined;
  let canvasStream: MediaStream | undefined;
  let sourceStream: MediaStream | undefined;
  let animation = 0;
  let timeout = 0;
  let cancelled = false;
  let processingError: Error | undefined;
  let recordedBytes = 0;
  let lastProgressAt = 0;
  const abortError = () => new DOMException("视频处理已取消。", "AbortError");
  const abort = () => { cancelled = true; if (recorder?.state === "recording") recorder.stop(); video.pause(); cancelAnimationFrame(animation); };
  if (signal?.aborted) throw abortError();
  signal?.addEventListener("abort", abort, { once: true });
  const cleanup = async () => {
    signal?.removeEventListener("abort", abort);
    if (timeout) window.clearTimeout(timeout);
    cancelAnimationFrame(animation);
    for (const stream of [combinedStream, canvasStream, sourceStream]) stream?.getTracks().forEach(track => track.stop());
    if (video.isConnected) {
      video.pause();
      video.muted = previousMuted;
      video.playbackRate = previousPlaybackRate;
      if (Number.isFinite(previousTime)) video.currentTime = Math.min(previousTime, Number.isFinite(video.duration) ? video.duration : previousTime);
      if (!previousPaused) await video.play().catch(() => {});
    }
  };
  try {
    const seeking = seekVideo(video, range.start, signal);
    // Start playback in the export button's user gesture so browser autoplay
    // policies also allow the recording stream to carry its audio track.
    if (options.operation !== "mute" && options.operation !== "extract-audio") video.muted = false;
    const playing = video.play();
    const captureFrameRate = options.operation === "compress" ? options.frameRate || 30 : 30;
    const capturedStream = captureElement.captureStream();
    sourceStream = capturedStream;
    let outputCanvas: HTMLCanvasElement | undefined;
    if (!audioOnly) {
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = size.width; outputCanvas.height = size.height;
      const context = outputCanvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("当前浏览器不支持视频画布处理。");
      canvasStream = outputCanvas.captureStream(captureFrameRate);
    }
    await raceWithAbort(Promise.all([seeking, playing]), signal);
    if (cancelled) throw abortError();
    const audioTracks = capturedStream.getAudioTracks();
    if (audioOnly && !audioTracks.length) throw new Error("此视频没有可读取的音轨。");
    const includeAudio = !audioOnly && options.operation !== "mute";
    const tracks: MediaStreamTrack[] = audioOnly ? [...audioTracks] : [...(canvasStream?.getVideoTracks() || []), ...(includeAudio ? audioTracks : [])];
    combinedStream = new MediaStream(tracks);
    const bitrate = videoExportBitrate(options, size);
    recorder = new MediaRecorder(combinedStream, { mimeType: type, ...(audioOnly ? {} : { videoBitsPerSecond: bitrate }) });
    const chunks: BlobPart[] = [];
    const completed = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = event => {
        if (!event.data.size || processingError) return;
        if (recordedBytes + event.data.size > maxOutputBytes) {
          processingError = audioOnly
            ? new Error("提取音频超过本机缓存上限 50 MiB，已提前停止。请使用更短的视频或其他音频提取工具。")
            : new Error(`视频处理结果超过素材库的单文件上限 ${Math.floor(maxOutputBytes / (1024 * 1024))} MiB，已提前停止。请缩短片段或降低分辨率后重试。`);
          video.pause();
          cancelAnimationFrame(animation);
          if (recorder?.state === "recording") recorder.stop();
          return;
        }
        recordedBytes += event.data.size;
        chunks.push(event.data);
      };
      recorder!.onstop = () => cancelled ? reject(abortError()) : processingError ? reject(processingError) : chunks.length ? resolve(new Blob(chunks, { type: recorder!.mimeType || type })) : reject(new Error("视频处理没有生成结果。"));
      recorder!.onerror = () => reject(new Error("浏览器视频编码失败，请缩短片段或降低压缩参数后重试。"));
    });
    void completed.catch(() => {});
    recorder.start(500);
    if (options.operation === "speed") video.playbackRate = options.playbackRate || 1;
    const context = outputCanvas?.getContext("2d", { alpha: false });
    const source = cropSource;
    if (context) context.filter = options.operation === "grade" ? gradeFilter(options.grade) : "none";
    const ended = new Promise<void>((resolve, reject) => {
      const step = () => {
        if (cancelled || recorder?.state !== "recording") return;
        try {
          if (!audioOnly && context && video.readyState >= 2) {
            if (options.operation === "rotate" || options.operation === "mirror") {
              const angle = rotation * Math.PI / 180;
              context.save();
              context.translate(outputCanvas!.width / 2, outputCanvas!.height / 2);
              context.rotate(angle);
              context.scale(options.operation === "mirror" && options.flipHorizontal ? -1 : 1, options.operation === "mirror" && options.flipVertical ? -1 : 1);
              const drawWidth = rotation === 90 || rotation === 270 ? outputCanvas!.height : outputCanvas!.width;
              const drawHeight = rotation === 90 || rotation === 270 ? outputCanvas!.width : outputCanvas!.height;
              context.drawImage(video, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
              context.restore();
            } else if (options.operation === "crop" && options.flipHorizontal) {
              context.save();
              context.translate(outputCanvas!.width, 0);
              context.scale(-1, 1);
              context.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, outputCanvas!.width, outputCanvas!.height);
              context.restore();
            } else {
              context.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, outputCanvas!.width, outputCanvas!.height);
            }
            if (options.operation === "watermark") {
              const text = options.watermarkText!.trim().slice(0, 100);
              const placement = watermarkPlacement(outputCanvas!.width, outputCanvas!.height, options.watermarkPosition, Math.round(outputCanvas!.width * 0.025));
              context.save();
              context.globalAlpha = Math.max(0.1, Math.min(1, options.watermarkOpacity ?? 0.72));
              context.fillStyle = "#ffffff";
              context.font = `600 ${Math.max(16, Math.round(outputCanvas!.width * 0.035))}px sans-serif`;
              context.textAlign = placement.align;
              context.textBaseline = placement.y <= outputCanvas!.height / 2 ? "top" : "bottom";
              context.shadowColor = "rgba(0, 0, 0, .7)";
              context.shadowBlur = Math.max(2, Math.round(outputCanvas!.width * 0.005));
              context.fillText(text, placement.x, placement.y, outputCanvas!.width * 0.7);
              context.restore();
            }
            if (context.canvas.dataset.originChecked !== "true") {
              context.getImageData(0, 0, 1, 1);
              context.canvas.dataset.originChecked = "true";
            }
          }
        } catch (error) {
          processingError = error instanceof DOMException && error.name === "SecurityError"
            ? new Error("视频源未开放跨域画布权限，当前无法进行本地处理。")
            : error instanceof Error ? error : new Error("无法读取视频画面，请稍后重试。");
          video.pause();
          if (recorder?.state === "recording") recorder.stop();
          reject(processingError);
          return;
        }
        const progress = Math.max(0, Math.min(100, (video.currentTime - range.start) / (range.end - range.start) * 100));
        const now = performance.now();
        if (progress >= 100 || now - lastProgressAt >= 150) {
          lastProgressAt = now;
          onProgress(progress);
        }
        if (video.currentTime >= range.end || video.ended) {
          video.pause();
          resolve();
          return;
        }
        animation = requestAnimationFrame(step);
      };
      animation = requestAnimationFrame(step);
    });
    const playbackRate = options.operation === "speed" ? options.playbackRate || 1 : 1;
    const safety = new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error("本地处理超时，请缩短视频片段后重试。")), (range.end - range.start) / playbackRate * 1000 + 90_000); });
    const recordingFailed = completed.then(() => new Promise<never>((_, reject) => reject(new Error("视频录制提前结束，请重试。"))));
    void recordingFailed.catch(() => {});
    await raceWithAbort(Promise.race([ended, recordingFailed, safety]), signal);
    if (recorder.state === "recording") recorder.stop();
    const output = await raceWithAbort(Promise.race([completed, safety]), signal);
    if (processingError) throw processingError;
    onProgress(100);
    return output;
  } catch (error) {
    if (recorder?.state === "recording") recorder.stop();
    if (video.isConnected) video.pause();
    throw error;
  } finally {
    await cleanup();
  }
}
