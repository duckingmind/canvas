export type CapturedVideoFrame = {
  dataUrl: string;
  width: number;
  height: number;
  /** Playback position in seconds, not the video's first-frame cover. */
  time: number;
};

export function formatVideoTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const tail = String(value % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}` : `${minutes}:${tail}`;
}

export function clampVideoTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(duration, Math.max(0, time));
}

export function videoPlaybackErrorMessage(code?: number | null): string {
  switch (code) {
    case 1: return "视频加载已中断，请重新加载或替换视频。";
    case 2: return "视频数据加载失败，请检查网络后重试。";
    case 3: return "视频数据无法解码，请使用 H.264 编码的 MP4 或 WebM。";
    // Browsers also report code 4 for a cross-origin response that is blocked,
    // an expired signed URL, or an HTML/JSON error returned in place of media.
    // Do not claim that the bytes are definitely encoded incorrectly.
    case 4: return "浏览器无法读取该视频，可能是跨域、签名已失效或编码不受支持；请检查视频地址后重试。";
    default: return "视频暂时无法播放，可能是网络、跨域、签名或编码问题；请重新加载或替换视频。";
  }
}

/** Editing shortcuts still work after a capture; playback keys stay local. */
export function isVideoPlayerGlobalShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.key === "Escape" || (event.metaKey || event.ctrlKey) && ["z", "y", "s"].includes(event.key.toLowerCase());
}

/** Capture the decoded, visible frame. Never fetch another source or seek to zero. */
export function captureVideoFrame(video: HTMLVideoElement): CapturedVideoFrame {
  if (video.seeking || video.readyState < 2 || !Number.isFinite(video.currentTime)) {
    throw new Error("当前画面尚未准备好，请等待视频加载或拖动完成后重试。");
  }
  if (![video.videoWidth, video.videoHeight].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("无法读取视频画面尺寸，请重新加载视频。");
  }
  // Bound decoder output memory and preserve the aspect ratio for large clips.
  const scale = Math.min(1, 3840 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const time = Math.max(0, video.currentTime);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法截取视频画面，请换用支持画布的浏览器。");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.94, 0.86, 0.74]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && dataUrl.length <= 8 * 1024 * 1024) {
        return { dataUrl, width: canvas.width, height: canvas.height, time };
      }
    }
    throw new Error("截取的画面过大，请使用分辨率更低的视频后重试。");
  } catch (error) {
    if (error instanceof Error && error.name === "SecurityError") {
      throw new Error("此视频的来源不允许截帧。请下载视频并上传到画布后重试。");
    }
    throw error;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
