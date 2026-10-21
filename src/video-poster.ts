const POSTER_TIMEOUT_MS = 12_000;
const POSTER_MAX_DIMENSION = 640;
// Limit the complete serialized data URL so persisting a poster stays inexpensive.
const POSTER_MAX_LENGTH = 48 * 1024;

export type VideoPosterOptions = { signal?: AbortSignal };

// The helper never throws: callers can safely invoke it in a background task and
// continue displaying/opening the original video when it resolves undefined.

/** Extract a small, persistent first-frame preview. A preview failure never fails the video. */
export function extractVideoPoster(source: Blob | string, { signal }: VideoPosterOptions = {}): Promise<string | undefined> {
  if (!source || signal?.aborted || typeof document === "undefined") return Promise.resolve(undefined);

  return new Promise(resolve => {
    let video: HTMLVideoElement | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ownedObjectUrl: string | undefined;
    let settled = false;

    function finish(poster?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", fail);
      if (video) {
        for (const event of ["loadedmetadata", "loadeddata", "canplay", "seeked"]) video.removeEventListener(event, capture);
        video.removeEventListener("error", fail);
        video.removeEventListener("abort", fail);
        // This element owns its decoder and request, but never owns the caller's URL.
        try { video.pause(); } catch { /* Decoder cleanup is best effort. */ }
        try { video.removeAttribute("src"); video.load(); } catch { /* No source remains to decode. */ }
      }
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (ownedObjectUrl) {
        try { URL.revokeObjectURL(ownedObjectUrl); } catch { /* URL cleanup is best effort. */ }
        ownedObjectUrl = undefined;
      }
      resolve(poster);
    }

    function fail() { finish(); }

    function capture() {
      if (settled || !video) return;
      try {
        // A time fragment or a browser's restored position must not become the cover.
        if (video.currentTime > 0 && !video.seeking) {
          video.currentTime = 0;
          return;
        }
        if (video.seeking || video.readyState < 2) return;
        if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight) || video.videoWidth <= 0 || video.videoHeight <= 0) return finish();

        canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) return finish();
        const baseScale = Math.min(1, POSTER_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
        for (const scale of [1, 0.75, 0.5, 0.25]) {
          canvas.width = Math.max(1, Math.round(video.videoWidth * baseScale * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * baseScale * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          for (const quality of [0.74, 0.58, 0.42]) {
            const poster = canvas.toDataURL("image/jpeg", quality);
            if (poster.startsWith("data:image/jpeg;base64,") && poster.length <= POSTER_MAX_LENGTH) return finish(poster);
          }
        }
        finish();
      } catch {
        // Tainted canvases, unsupported codecs and failed decodes only omit the preview.
        finish();
      }
    }

    try {
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      // Poster extraction only needs metadata and the first decoded frame.
      // `auto` encourages the browser to fetch the whole signed video before
      // the visible player mounts, which creates avoidable CDN traffic.
      video.preload = "metadata";
      video.crossOrigin = "anonymous";
      for (const event of ["loadedmetadata", "loadeddata", "canplay", "seeked"]) video.addEventListener(event, capture);
      video.addEventListener("error", fail);
      video.addEventListener("abort", fail);
      signal?.addEventListener("abort", fail, { once: true });
      timer = setTimeout(fail, POSTER_TIMEOUT_MS);
      if (typeof source === "string") video.src = source;
      else {
        // A URL created for a Blob is owned by this helper and can safely be revoked.
        ownedObjectUrl = URL.createObjectURL(source);
        video.src = ownedObjectUrl;
      }
      video.load();
    } catch {
      finish();
    }
  });
}
