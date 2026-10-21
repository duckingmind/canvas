import type { CanvasNode, StoredAsset } from "./canvas-types";

export type RecoverableImageNode = Pick<
  CanvasNode,
  "id" | "taskId" | "resultIndex"
>;

export type ImageRecoveryUpdate = {
  id: string;
  taskId: string;
  image: string;
  thumbnail?: string;
};

export type StoredImageMatch = {
  assetId: string;
  taskId: string;
  image: string;
  thumbnail?: string;
};

type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" ? (value as RecordValue) : {};

function taskImage(entry: unknown): string | undefined {
  const item = record(entry);
  const url = typeof item.url === "string" ? item.url.trim() : "";
  if (/^(?:https?:\/\/|\/|data:image\/)/i.test(url)) return url;
  const base64 =
    typeof item.b64_json === "string" ? item.b64_json.trim() : "";
  return base64 ? `data:image/png;base64,${base64}` : undefined;
}

/**
 * Stable identity for an object-store URL. Signing parameters expire and CDN
 * hosts may change, while the application-scoped `media/...` object path does
 * not. Unknown URL layouts retain the host to avoid cross-origin collisions.
 */
export function mediaUrlIdentity(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim()))
    return undefined;
  try {
    const url = new URL(value.trim());
    const normalizedPath = url.pathname.replace(/\/{2,}/g, "/");
    const objectPath = normalizedPath.match(
      /\/(media\/(?:image|video|audio)\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9._:-]+-\d+-[a-f0-9]{16}\.(?:png|jpg|webp|bin|mp4|webm|mp3|wav|flac))$/,
    )?.[1];
    if (objectPath) return `object:${objectPath}`;
    // Some deployed COS keys use a compact timestamp directly below
    // media/image (for example /tenant/media/image/20260430...png)
    // instead of the dated /media/image/<bucket>/YYYY/MM/DD layout above.
    // Keep the stable media path host-independent as well, otherwise a
    // refreshed signed URL from a CDN cannot be matched to the old COS URL.
    const mediaPath = normalizedPath.match(/\/(media\/(?:image|video|audio)\/[^?#]+)$/)?.[1];
    if (mediaPath) return `object:${mediaPath}`;
    const parameters = new URLSearchParams(url.search);
    for (const key of [...parameters.keys()]) {
      if (
        /^(?:q-(?:sign-algorithm|ak|sign-time|key-time|header-list|url-param-list|signature)|x-cos-security-token|x-amz-|signkey|signature|expires|awsaccesskeyid)/i.test(key)
      ) parameters.delete(key);
    }
    parameters.sort();
    const query = parameters.toString();
    return `${url.host.toLowerCase()}${normalizedPath}${query ? `?${query}` : ""}`;
  } catch {
    return undefined;
  }
}

/**
 * Recover a no-taskId node from a freshly listed application asset. Asset
 * lists are already scoped by app and user. Ambiguous task ownership is still
 * rejected so a damaged list cannot attach the node to an unrelated task.
 */
export function matchStoredImageAsset(
  image: unknown,
  assets: readonly Pick<StoredAsset, "id" | "task_id" | "type" | "url" | "thumbnail_url">[],
): StoredImageMatch | undefined {
  const identity = mediaUrlIdentity(image);
  if (!identity) return undefined;
  const matches = assets.flatMap((asset) => {
    const taskId = typeof asset.task_id === "string" ? asset.task_id.trim() : "";
    const assetImage = taskImage({ url: asset.url });
    if (
      !/^image(?:\/|$)/i.test(asset.type || "") ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId) ||
      !assetImage ||
      mediaUrlIdentity(assetImage) !== identity
    ) return [];
    const thumbnail = typeof asset.thumbnail_url === "string" && /^https?:\/\//i.test(asset.thumbnail_url.trim())
      ? asset.thumbnail_url.trim()
      : undefined;
    return [{ assetId: asset.id, taskId, image: assetImage, ...(thumbnail ? { thumbnail } : {}) }];
  });
  if (!matches.length || new Set(matches.map((match) => match.taskId)).size !== 1)
    return undefined;
  return matches[0];
}

/**
 * Preserve result slots while normalizing a task response. Filtering malformed
 * entries here would shift resultIndex and display the wrong output on a node.
 */
export function taskImageResults(response: unknown): Array<string | undefined> {
  const data = record(response).data;
  return Array.isArray(data) ? data.map(taskImage) : [];
}

function taskImageThumbnail(entry: unknown): string | undefined {
  const item = record(entry);
  const thumbnail = typeof item.thumbnail_url === "string"
    ? item.thumbnail_url.trim()
    : typeof item.thumbnailUrl === "string" ? item.thumbnailUrl.trim() : "";
  return /^https?:\/\//i.test(thumbnail) ? thumbnail : undefined;
}

/** Keep thumbnail slots aligned with task result slots for legacy recovery. */
export function taskImageThumbnailResults(response: unknown): Array<string | undefined> {
  const data = record(response).data;
  return Array.isArray(data) ? data.map(taskImageThumbnail) : [];
}

/**
 * Map one task response back to its canvas nodes without assigning result zero
 * to every card. Current documents use resultIndex. The positional fallback is
 * only for legacy batches where every index is absent and cardinality is exact.
 */
export function mapTaskImageResults(
  taskId: string,
  nodes: readonly RecoverableImageNode[],
  response: unknown,
): ImageRecoveryUpdate[] {
  if (!taskId || !nodes.length) return [];
  const images = taskImageResults(response);
  if (!images.length) return [];

  if (nodes.length === 1) {
    const node = nodes[0];
    const hasIndex = node.resultIndex !== undefined;
    if (hasIndex && (!Number.isInteger(node.resultIndex) || node.resultIndex! < 0))
      return [];
    if (!hasIndex && images.length !== 1) return [];
    const index = hasIndex ? node.resultIndex! : 0;
    const image = images[index];
    const thumbnail = taskImageThumbnailResults(response)[index];
    return image ? [{ id: node.id, taskId, image, ...(thumbnail ? { thumbnail } : {}) }] : [];
  }

  const allLegacy = nodes.every((node) => node.resultIndex === undefined);
  if (allLegacy) {
    if (images.length !== nodes.length || images.some((image) => !image)) return [];
    return nodes.map((node, index) => ({
      id: node.id,
      taskId,
      image: images[index]!,
      ...(taskImageThumbnailResults(response)[index] ? { thumbnail: taskImageThumbnailResults(response)[index] } : {}),
    }));
  }

  const thumbnails = taskImageThumbnailResults(response);
  return nodes.flatMap((node) => {
    if (
      !Number.isInteger(node.resultIndex) ||
      node.resultIndex! < 0 ||
      !images[node.resultIndex!]
    ) return [];
    return [{ id: node.id, taskId, image: images[node.resultIndex!]!, ...(thumbnails[node.resultIndex!] ? { thumbnail: thumbnails[node.resultIndex!] } : {}) }];
  });
}

type RecoveryAttempt = {
  attempts: number;
  fingerprints: Set<string>;
  inFlight?: { fingerprint: string; token: string };
};

/**
 * Bounds automatic recovery both per failed source and per target. A refreshed
 * URL can be tried once, but an endless sequence of distinct broken signed URLs
 * cannot loop forever. Call reset for an explicit user-requested retry.
 */
export class ImageRecoveryGuard {
  private readonly attempts = new Map<string, RecoveryAttempt>();
  private readonly maxAttempts: number;
  private sequence = 0;

  constructor(maxAttempts = 2) {
    this.maxAttempts = maxAttempts;
  }

  begin(nodeId: string, fingerprint: string): string | undefined {
    if (!nodeId || !fingerprint || this.maxAttempts <= 0) return undefined;
    const current = this.attempts.get(nodeId);
    const token = `${++this.sequence}:${fingerprint}`;
    if (!current) {
      this.attempts.set(nodeId, {
        attempts: 1,
        fingerprints: new Set([fingerprint]),
        inFlight: { fingerprint, token },
      });
      return token;
    }
    if (
      current.inFlight ||
      current.fingerprints.has(fingerprint) ||
      current.attempts >= this.maxAttempts
    ) return undefined;
    current.attempts++;
    current.fingerprints.add(fingerprint);
    current.inFlight = { fingerprint, token };
    return token;
  }

  finish(nodeId: string, token: string): void {
    const current = this.attempts.get(nodeId);
    if (current?.inFlight?.token === token) current.inFlight = undefined;
  }

  reset(nodeId: string): void {
    this.attempts.delete(nodeId);
  }

  resetAll(): void {
    this.attempts.clear();
  }
}
