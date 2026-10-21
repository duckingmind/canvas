import type { Document } from "./canvas-types";

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

/**
 * Resolve a local/cloud pair without exposing an implementation detail to the
 * editor UI. Timestamps are the version contract; equal timestamps with
 * different content stay recoverable instead of being silently overwritten.
 */
export function resolveCloudDocumentVersion(
  local: Document,
  remote: Document,
  documentSignature: Signature,
  documentRevisionSignature: Signature,
): CloudVersionResolution {
  if (documentRevisionSignature(local) === documentRevisionSignature(remote))
    return "same";
  const localTime = documentVersionTime(local);
  const remoteTime = documentVersionTime(remote);
  if (remoteTime > localTime) return "prefer-cloud";
  if (localTime > remoteTime) return "prefer-local";
  if (documentSignature(local) === documentSignature(remote)) return "same";
  return "manual";
}
