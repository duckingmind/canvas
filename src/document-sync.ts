import type { CanvasSyncMarker } from "./document-kv.ts";

export type CanvasSyncEvent = {
  id: string;
  marker: CanvasSyncMarker;
};

const CHANNEL_NAME = "proxy-canvas:document-sync:v1";
type Listener = (event: CanvasSyncEvent) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === "undefined") {
    channel = null;
    return channel;
  }
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Node's test runner exposes BroadcastChannel too. Keep the browser
    // channel alive for sibling tabs without keeping command-line tests open.
    (channel as BroadcastChannel & { unref?: () => void }).unref?.();
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (!value || typeof value !== "object") return;
      const data = value as Partial<CanvasSyncEvent> & { marker?: Partial<CanvasSyncMarker> };
      if (typeof data.id !== "string" || !data.id || !data.marker ||
        data.marker.version !== 1 || typeof data.marker.documentUpdatedAt !== "string" ||
        typeof data.marker.syncId !== "string") return;
      const parsed: CanvasSyncEvent = {
        id: data.id,
        marker: {
          version: 1,
          documentUpdatedAt: data.marker.documentUpdatedAt,
          syncId: data.marker.syncId,
        },
      };
      listeners.forEach((listener) => {
        try { listener(parsed); } catch { /* one window must not break the channel */ }
      });
    });
  } catch {
    channel = null;
  }
  return channel;
}

export function publishCanvasSync(id: string, marker: CanvasSyncMarker): void {
  try { getChannel()?.postMessage({ id, marker }); } catch { /* polling remains authoritative */ }
}

export function subscribeCanvasSync(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  return () => listeners.delete(listener);
}

