export const AUDIO_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

type SeekableRanges = Pick<TimeRanges, "length" | "end">;

/** Some browser-readable audio containers expose Infinity until seekable ranges are indexed. */
export function finiteMediaDuration(media: { duration: number; seekable: SeekableRanges }): number {
  if (Number.isFinite(media.duration) && media.duration >= 0) return media.duration;
  if (media.duration !== Infinity) return 0;
  try {
    const end = media.seekable.length ? media.seekable.end(media.seekable.length - 1) : 0;
    return Number.isFinite(end) && end > 0 ? end : 0;
  } catch {
    return 0;
  }
}

/** Keep the elapsed clock moving when the browser cannot report a total duration yet. */
export function displayedMediaTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  const elapsed = Math.max(0, time);
  return Number.isFinite(duration) && duration > 0 ? Math.min(duration, elapsed) : elapsed;
}

export function mediaPlayButtonLabel(paused: boolean, ended: boolean): "播放" | "暂停" | "重新播放" {
  if (ended) return "重新播放";
  return paused ? "播放" : "暂停";
}

export function nextAudioPlaybackRate(current: number): typeof AUDIO_PLAYBACK_RATES[number] {
  const index = AUDIO_PLAYBACK_RATES.findIndex(rate => rate === current);
  return AUDIO_PLAYBACK_RATES[(index + 1) % AUDIO_PLAYBACK_RATES.length];
}

export function mediaPlaybackError(error?: unknown, kind: "video" | "audio" = "audio"): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError") return "浏览器阻止了自动播放，点击播放即可开始。";
  if (name === "NotSupportedError") return `浏览器不支持此${kind === "audio" ? "音频" : "视频"}格式，请下载原文件后播放。`;
  return `${kind === "audio" ? "音频" : "视频"}暂时无法播放，请重新加载或下载原文件。`;
}
