import type { CanvasNode } from "./canvas-types";

/** A saved video remains media when its short-lived delivery URL is omitted. */
export function hasRecoverableVideoIdentity(node: { type?: string; mediaType?: string; status?: string; assetId?: string; taskId?: string; localVideo?: string }): boolean {
  return (node.type === "video" || node.mediaType === "video") &&
    ["", "idle", "completed"].includes(node.status || "") &&
    Boolean(node.localVideo || node.assetId || node.status === "completed" && node.taskId);
}

/** A newly generated result must never inherit an older local video or cover. */
export function completedVideoMedia(result: { contentUrl: string; contentUrlExpiresAt?: string; assetId?: string }) {
  return {
    videoContentUrl: result.contentUrl,
    videoContentUrlExpiresAt: result.contentUrlExpiresAt,
    assetId: result.assetId,
    video: undefined, localVideo: undefined, image: undefined, localImage: undefined, audio: undefined,
    videoPoster: undefined, localVideoPoster: undefined,
  };
}

/** Only source identity belongs here: renaming, moving, or adding a poster is harmless. */
export type VideoNodeSource = Pick<CanvasNode, "id" | "type" | "mediaType" | "video" | "localVideo" | "videoContentUrl" | "videoContentUrlExpiresAt" | "taskId" | "assetId">;
export type VideoNodeSourceToken = { documentId: string; source: VideoNodeSource };

export function videoAutoRecoveryKey(node: Pick<CanvasNode, "id" | "assetId" | "taskId" | "video" | "localVideo">): string {
  return `${node.id}:${node.localVideo || node.assetId || node.taskId || node.video || ""}`;
}

/** Persist automatic retry budgets across temporary player unmounts. */
export class VideoAutoRecoveryGuard {
  private attempts = new Map<string, string>();

  tryRecover(nodeId: string, recoveryKey: string): boolean {
    if (this.attempts.get(nodeId) === recoveryKey) return false;
    this.attempts.set(nodeId, recoveryKey);
    return true;
  }

  retain(nodes: Array<{ id: string; recoveryKey: string }>) {
    const current = new Map(nodes.map(node => [node.id, node.recoveryKey]));
    for (const [id, key] of this.attempts) {
      if (current.get(id) !== key) this.attempts.delete(id);
    }
  }
}

export function sameVideoNodeSource(source: VideoNodeSource, current: VideoNodeSource | undefined): boolean {
  return Boolean(current && source.id === current.id && source.type === current.type &&
    source.mediaType === current.mediaType && source.videoContentUrlExpiresAt === current.videoContentUrlExpiresAt &&
    source.video === current.video && source.localVideo === current.localVideo && source.videoContentUrl === current.videoContentUrl &&
    source.taskId === current.taskId && source.assetId === current.assetId);
}

/**
 * A token owns one source incarnation, not merely one reusable node id. Explicit
 * invalidation also protects replacing a file with the exact same encoded bytes.
 */
export class VideoNodeSourceGuard {
  private sources = new Map<string, VideoNodeSourceToken>();

  get(nodeId: string) { return this.sources.get(nodeId); }

  capture(documentId: string, node: VideoNodeSource): VideoNodeSourceToken {
    const current = this.sources.get(node.id);
    if (current && this.isCurrent(current, documentId, node)) return current;
    const token = {
      documentId,
      source: {
        id: node.id, type: node.type, mediaType: node.mediaType, video: node.video, localVideo: node.localVideo, videoContentUrl: node.videoContentUrl, videoContentUrlExpiresAt: node.videoContentUrlExpiresAt,
        taskId: node.taskId, assetId: node.assetId,
      },
    };
    this.sources.set(node.id, token);
    return token;
  }

  isCurrent(token: VideoNodeSourceToken, documentId: string, node: VideoNodeSource | undefined): boolean {
    return token.documentId === documentId && this.sources.get(token.source.id) === token &&
      sameVideoNodeSource(token.source, node);
  }

  invalidate(nodeId: string) { this.sources.delete(nodeId); }

  invalidateStale(documentId: string, nodes: VideoNodeSource[]): string[] {
    const current = new Map(nodes.map(node => [node.id, node]));
    const stale: string[] = [];
    for (const [id, token] of this.sources) {
      if (this.isCurrent(token, documentId, current.get(id))) continue;
      this.sources.delete(id);
      stale.push(id);
    }
    return stale;
  }
}

/** Keep layout and notes, but never let an uploaded file inherit an old task/asset. */
export function replaceVideoNodeMedia(
  node: CanvasNode,
  media: { video?: string; localVideo?: string; videoContentUrl?: string; videoContentUrlExpiresAt?: string; assetId?: string; title: string; width: number; height: number },
): CanvasNode {
  if (node.type !== "video") throw new Error("只能替换视频素材节点");
  if (!media.video && !media.localVideo && !media.assetId) throw new Error("替换视频需要一个有效的视频来源");
  return {
    id: node.id,
    type: "video",
    title: media.title,
    text: node.text,
    x: node.x,
    y: node.y,
    width: media.width,
    height: media.height,
    color: node.color,
    ...(node.groupId ? { groupId: node.groupId } : {}),
    ...(media.video ? { video: media.video } : {}),
    ...(media.localVideo ? { localVideo: media.localVideo } : {}),
    ...(media.videoContentUrl ? { videoContentUrl: media.videoContentUrl } : {}),
    ...(media.videoContentUrlExpiresAt ? { videoContentUrlExpiresAt: media.videoContentUrlExpiresAt } : {}),
    ...(media.assetId ? { assetId: media.assetId } : {}),
  };
}
