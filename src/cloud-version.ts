import type { Document } from "./canvas-types";
import { isTemporaryMediaUrl } from "./media-url-cache.ts";

export type CloudVersionResolution =
  | "same"
  | "prefer-local"
  | "prefer-cloud"
  | "manual";

type Signature = (value: Document) => string;

const documentVersionTime = (value: Document) => {
  const time = Date.parse(value.updatedAt);
  return Number.isFinite(time) ? time : 0;
};

const ephemeralKeys = new Set([
  "taskDiagnostic",
  "imageThumbnail",
  "videoPoster",
  "localImage",
  "localVideo",
  "localAudio",
  "localVideoPoster",
  "videoContentUrlExpiresAt",
  "uploadState",
  "uploadProgress",
  "uploadError",
  "status",
  "error",
  "videoPollingPaused",
  "videoPollingReason",
]);
const mediaKeys = new Set(["image", "video", "audio", "videoContentUrl", "videoPoster"]);

function stableValue(value: unknown, key = ""): unknown {
  if (ephemeralKeys.has(key)) return undefined;
  if (mediaKeys.has(key) && typeof value === "string" &&
    (/^(?:data|blob):/i.test(value) || isTemporaryMediaUrl(value))) return undefined;
  if (Array.isArray(value)) return value.map((item) => stableValue(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([childKey, childValue]) => {
        const stable = stableValue(childValue, childKey);
        return stable === undefined ? [] : [[childKey, stable]];
      }),
  );
}

/** A version signature for user-authored canvas content, excluding camera,
 * timestamps and short-lived task/media delivery state. */
export function canvasContentSignature(value: Document): string {
  return JSON.stringify(stableValue({
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    deletedAt: value.deletedAt,
    nodes: value.nodes,
    edges: value.edges,
    groups: value.groups || [],
  }));
}

/**
 * Resolve a local/cloud pair without exposing an implementation detail to the
 * editor UI. Content equality is checked before timestamps so camera moves,
 * saves and short-lived task updates cannot look like a competing version.
 * Timestamps only order genuinely different content; equal timestamps stay
 * recoverable instead of being silently overwritten.
 */
export function resolveCloudDocumentVersion(
  local: Document,
  remote: Document,
  documentSignature: Signature,
  documentRevisionSignature: Signature,
): CloudVersionResolution {
  if (documentRevisionSignature(local) === documentRevisionSignature(remote))
    return "same";
  if (documentSignature(local) === documentSignature(remote)) return "same";
  const localTime = documentVersionTime(local);
  const remoteTime = documentVersionTime(remote);
  if (remoteTime > localTime) return "prefer-cloud";
  if (localTime > remoteTime) return "prefer-local";
  return "manual";
}
