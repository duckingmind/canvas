export type VideoEditOperation = "trim" | "extract-video" | "extract-audio" | "convert" | "crop" | "compress" | "grade" | "rotate" | "mirror" | "speed" | "watermark" | "mute";
export type VideoOutputFormat = "webm" | "mp4";
export const MAX_VIDEO_EDIT_DURATION_SECONDS = 300;
export type VideoEditOptions = {
  operation: VideoEditOperation;
  startTime: number;
  endTime: number;
  outputFormat?: VideoOutputFormat;
  aspectRatio?: "original" | "16:9" | "9:16" | "1:1";
  maxWidth?: 480 | 720 | 1080;
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
type VideoCaptureElement = HTMLVideoElement & { captureStream: () => MediaStream };

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

function cropRect(width: number, height: number, ratio?: VideoEditOptions["aspectRatio"]) {
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
): Promise<Blob> {
  if (!video.isConnected || video.readyState < 2 || video.seeking || video.videoWidth <= 0 || video.videoHeight <= 0) throw new Error("请先等待视频加载完成并停止缓冲。");
  const captureElement = video as VideoCaptureElement;
  if (typeof captureElement.captureStream !== "function") throw new Error("当前浏览器无法录制播放中的视频，请使用 Chrome 或 Edge 桌面版。");
  if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持本地视频导出。");
  const range = videoEditRange(video.duration, options.startTime, options.endTime,
    options.operation === "extract-video" || options.operation === "extract-audio" ? Number.POSITIVE_INFINITY : MAX_VIDEO_EDIT_DURATION_SECONDS);
  if (options.operation === "watermark" && !options.watermarkText?.trim()) throw new Error("请输入水印文字。");
  const type = recorderMimeType(options.operation, value => MediaRecorder.isTypeSupported(value), options.outputFormat);
  const audioOnly = options.operation === "extract-audio";
  const rotation = options.operation === "rotate" ? options.rotation || 90 : 0;
  const transformed = videoTransformDimensions(video.videoWidth, video.videoHeight, rotation);
  const maxWidth = options.operation === "compress" ? options.maxWidth || 720 : transformed.width;
  const size = videoCanvasSize(transformed.width, transformed.height, maxWidth, options.operation === "crop" ? options.aspectRatio : "original");
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
    const capturedStream = captureElement.captureStream();
    sourceStream = capturedStream;
    let outputCanvas: HTMLCanvasElement | undefined;
    if (!audioOnly) {
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = size.width; outputCanvas.height = size.height;
      const context = outputCanvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("当前浏览器不支持视频画布处理。");
      canvasStream = outputCanvas.captureStream(30);
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
          processingError = new Error("提取音频超过本机缓存上限 50 MiB，已提前停止。请使用更短的视频或其他音频提取工具。");
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
    const source = cropRect(video.videoWidth, video.videoHeight, options.operation === "crop" ? options.aspectRatio : "original");
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
