export type HoverPreviewMedia = {
  paused: boolean;
  playbackRate: number;
  play: () => Promise<void>;
  pause: () => void;
};

const HOVER_PLAYBACK_RATE = 1.5;

/** Own only playback that this controller started; keep the user's audio settings. */
export function createVideoHoverPreview(media: HoverPreviewMedia) {
  let revision = 0;
  let session: { revision: number; playbackRate: number } | null = null;

  const stop = () => {
    if (!session) return;
    const previous = session;
    session = null;
    media.pause();
    media.playbackRate = previous.playbackRate;
  };

  return {
    start() {
      if (session || !media.paused) return;
      const current = { revision: ++revision, playbackRate: media.playbackRate };
      session = current;
      media.playbackRate = HOVER_PLAYBACK_RATE;
      try {
        void media.play().then(() => {
          // A late play acknowledgement must not revive a departed hover.
          // A newer hover or user interaction owns playback if revision changed.
          if (revision === current.revision && session !== current) media.pause();
        }, () => {
          // Autoplay denial or source changes are ordinary preview failures.
          if (session === current) stop();
        });
      } catch {
        if (session === current) stop();
      }
    },
    stop,
    takeManualControl() {
      // Invalidate even a stopped session's pending play promise, so its
      // resolution cannot pause a later user action on the native controls.
      revision++;
      const previous = session;
      session = null;
      if (previous) {
        media.playbackRate = previous.playbackRate;
      }
    },
  };
}

export { HOVER_PLAYBACK_RATE };
