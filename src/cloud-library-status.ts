import type { Document } from "./canvas-types";
import {
  resolveCloudDocumentVersion,
  type CloudVersionResolution,
} from "./cloud-version.ts";

export type CloudLibraryStatus =
  | "synced"
  | "local-only"
  | "local-newer"
  | "cloud-newer"
  | "conflict"
  | "cloud-deleted"
  | "local-deleted";

export type CloudLibraryStatusEntry = {
  state: CloudLibraryStatus;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
};

export type DocumentSignature = (value: Document) => string;

function compareTimestamp(left?: string, right?: string) {
  if (!left || !right) return 0;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.sign(leftTime - rightTime)
    : left.localeCompare(right);
}

export function markCloudLibraryLocalSave(
  previous: CloudLibraryStatusEntry | undefined,
  snapshot: Document,
): CloudLibraryStatusEntry {
  if (
    previous?.localUpdatedAt &&
    compareTimestamp(previous.localUpdatedAt, snapshot.updatedAt) > 0
  ) return previous;
  if (previous?.remoteUpdatedAt) {
    if (compareTimestamp(snapshot.updatedAt, previous.remoteUpdatedAt) <= 0)
      return previous;
  } else if (previous?.state === "local-only" || previous?.state === "local-deleted") {
    return previous;
  }
  if (
    previous?.state === "synced" &&
    (previous.localUpdatedAt === snapshot.updatedAt ||
      previous.remoteUpdatedAt === snapshot.updatedAt)
  ) return previous;
  return {
    state: "local-newer",
    localUpdatedAt: snapshot.updatedAt,
    ...(previous?.remoteUpdatedAt
      ? { remoteUpdatedAt: previous.remoteUpdatedAt }
      : {}),
  };
}

/**
 * Classify a local/cloud pair without changing either copy. The list uses
 * this result as a hint; opening a document still performs the authoritative
 * version check and presents the existing recovery choice.
 */
export function classifyCloudDocument(
  local: Document | null,
  remote: Document | null,
  documentSignature: DocumentSignature,
  documentRevisionSignature: DocumentSignature,
): CloudLibraryStatusEntry {
  if (!local && !remote) return { state: "synced" };
  if (!local) {
    if (!remote) return { state: "synced" };
    return {
      state: "cloud-newer",
      remoteUpdatedAt: remote.updatedAt,
    };
  }
  if (!remote) {
    return {
      state: local.deletedAt ? "local-deleted" : "local-only",
      localUpdatedAt: local.updatedAt,
    };
  }

  const resolution: CloudVersionResolution = resolveCloudDocumentVersion(
    local,
    remote,
    documentSignature,
    documentRevisionSignature,
  );
  const base = {
    localUpdatedAt: local.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
  };
  if (resolution === "same") return { state: "synced", ...base };
  if (resolution === "prefer-cloud") {
    return {
      state: remote.deletedAt ? "cloud-deleted" : "cloud-newer",
      ...base,
    };
  }
  if (resolution === "prefer-local") {
    return {
      state: local.deletedAt ? "local-deleted" : "local-newer",
      ...base,
    };
  }
  return { state: "conflict", ...base };
}

export function classifyCloudAcknowledgement(
  local: Document | null,
  acknowledged: Document,
  previous: CloudLibraryStatusEntry | undefined,
  documentSignature: DocumentSignature,
  documentRevisionSignature: DocumentSignature,
): CloudLibraryStatusEntry {
  const confirmedAt = acknowledged.updatedAt;
  if (
    previous?.remoteUpdatedAt &&
    compareTimestamp(previous.remoteUpdatedAt, confirmedAt) > 0
  ) return previous;
  if (
    previous?.remoteUpdatedAt === confirmedAt &&
    (previous.state === "cloud-newer" ||
      previous.state === "cloud-deleted" ||
      previous.state === "conflict") &&
    (!local ||
      documentRevisionSignature(local) !==
        documentRevisionSignature(acknowledged))
  ) return previous;
  if (
    local?.updatedAt &&
    compareTimestamp(local.updatedAt, acknowledged.updatedAt) > 0 &&
    (previous?.state === "local-newer" || previous?.state === "local-only")
  ) return previous;
  return classifyCloudDocument(
    local,
    acknowledged,
    documentSignature,
    documentRevisionSignature,
  );
}
