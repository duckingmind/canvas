type PlaybackParticipant = Pick<HTMLMediaElement, "paused" | "pause">;

const VIDEO_PLAYBACK_EVENT = "canvas-video-play";

/** Keep canvas, gallery and hover video surfaces from competing for decoders. */
export function coordinateVideoPlayback(id: string, media: PlaybackParticipant): () => void {
  if (typeof document === "undefined") return () => {};
  const pauseOtherVideo = (event: Event) => {
    const activeId = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (activeId && activeId !== id && !media.paused) media.pause();
  };
  document.addEventListener(VIDEO_PLAYBACK_EVENT, pauseOtherVideo);
  return () => document.removeEventListener(VIDEO_PLAYBACK_EVENT, pauseOtherVideo);
}

export function announceVideoPlayback(id: string): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(VIDEO_PLAYBACK_EVENT, { detail: { id } }));
}

export function videoBufferedAheadSeconds(video: Pick<HTMLVideoElement, "buffered" | "currentTime">): number {
  try {
    for (let index = 0; index < video.buffered.length; index += 1) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (video.currentTime >= start && video.currentTime <= end) return Math.max(0, end - video.currentTime);
    }
  } catch { /* Media may change sources while a diagnostic is being collected. */ }
  return 0;
}
