import type { Document } from "./canvas-types";
import { canvasContentSignature } from "./cloud-version.ts";
import { isTemporaryMediaUrl } from "./media-url-cache.ts";

export type CloudMergeResult = {
  document: Document | null;
  conflicts: string[];
};

type Identified = { id: string };
type ConflictResolution = "manual" | "prefer-local" | "prefer-remote";

export type CloudMergePlan =
  | { kind: "same" }
  | { kind: "local-only"; document: Document }
  | { kind: "remote-only"; document: Document }
  | { kind: "merge"; document: Document }
  | { kind: "conflict"; conflicts: string[] };

const transientKeys = new Set([
  "taskDiagnostic", "imageThumbnail", "videoPoster", "localImage", "localVideo",
  "localAudio", "localVideoPoster", "videoContentUrlExpiresAt", "uploadState",
  "uploadProgress", "uploadError", "status", "error", "videoPollingPaused",
  "videoPollingReason",
]);
const temporaryMediaKeys = new Set(["image", "video", "audio", "videoContentUrl", "videoPoster"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function comparable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    );
  }) ?? "undefined";
}

function same(left: unknown, right: unknown): boolean {
  return comparable(left) === comparable(right);
}

/**
 * Advance the editor's common ancestor after a confirmed save, but do not
 * replace a baseline that another reconciliation has already moved forward.
 * This matters when the user keeps editing while a cloud write is in flight:
 * the watcher must recognize that write as this editor's own ancestor.
 */
export function advanceCloudBaseAfterConfirmedSave(
  currentBase: Document | null,
  baseAtSaveStart: Document | null,
  saved: Document,
): Document | null {
  const baseHasNotAdvanced = currentBase === null
    ? baseAtSaveStart === null
    : baseAtSaveStart !== null &&
      canvasContentSignature(currentBase) === canvasContentSignature(baseAtSaveStart);
  if (!baseHasNotAdvanced) return currentBase;
  return clone(saved);
}

function authoredValue(value: unknown, key = ""): unknown {
  if (transientKeys.has(key)) return undefined;
  if (temporaryMediaKeys.has(key) && typeof value === "string" &&
    (/^(?:data|blob):/i.test(value) || isTemporaryMediaUrl(value)))
    return undefined;
  if (Array.isArray(value)) return value.map((item) => authoredValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([childKey, childValue]) => {
        const stable = authoredValue(childValue, childKey);
        return stable === undefined ? [] : [[childKey, stable]];
      }),
  );
}

function sameAuthored(left: unknown, right: unknown, key = ""): boolean {
  return comparable(authoredValue(left, key)) === comparable(authoredValue(right, key));
}

function preserveTransient<T>(target: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  if (!target || typeof target !== "object" || Array.isArray(target)) return clone(target);
  const result = clone(target) as Record<string, unknown>;
  const localRecord = local && typeof local === "object" ? local as Record<string, unknown> : {};
  const remoteRecord = remote && typeof remote === "object" ? remote as Record<string, unknown> : {};
  for (const key of transientKeys) {
    const value = localRecord[key] === undefined ? remoteRecord[key] : localRecord[key];
    if (value === undefined) delete result[key];
    else result[key] = clone(value);
  }
  return result as T;
}

function mergeRecord<T extends Record<string, unknown>>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  path: string,
  conflicts: string[],
  conflictResolution: ConflictResolution,
): T | undefined {
  if (sameAuthored(local, remote)) return preserveTransient(local, local, remote);
  if (sameAuthored(local, base)) return preserveTransient(remote, local, remote);
  if (sameAuthored(remote, base)) return preserveTransient(local, local, remote);
  if (!local || !remote) {
    // With no prior item there is no deletion to resolve: this item was added
    // by whichever side contains it, so keep it as part of the union.
    if (base === undefined) return clone(local ?? remote);
    // A transient task, upload or signed-preview update does not turn a
    // deletion into a content conflict.
    if (!local && sameAuthored(remote, base)) return undefined;
    if (!remote && sameAuthored(local, base)) return undefined;
    conflicts.push(path);
    if (conflictResolution === "prefer-local") return clone(local);
    if (conflictResolution === "prefer-remote") return clone(remote);
    return undefined;
  }

  const result: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(base || {}),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  const conflictsBefore = conflicts.length;
  const geometryGroups = path.startsWith("nodes.") ? [["x", "y"], ["width", "height"]] : [];
  const geometryHandled = new Set<string>();
  for (const key of keys) {
    const geometryGroup = geometryGroups.find((group) => group.includes(key));
    if (geometryGroup) {
      if (geometryHandled.has(key)) continue;
      geometryGroup.forEach((name) => geometryHandled.add(name));
      const geometry = (record: Record<string, unknown> | undefined) => record
        ? Object.fromEntries(geometryGroup.filter((name) => name in record).map((name) => [name, record[name]]))
        : undefined;
      const baseGeometry = geometry(base);
      const localGeometry = geometry(local);
      const remoteGeometry = geometry(remote);
      let selectedGeometry: Record<string, unknown> | undefined;
      if (same(localGeometry, remoteGeometry)) selectedGeometry = localGeometry;
      else if (same(localGeometry, baseGeometry)) selectedGeometry = remoteGeometry;
      else if (same(remoteGeometry, baseGeometry)) selectedGeometry = localGeometry;
      else {
        conflicts.push(`${path}.${geometryGroup.join("+")}`);
        selectedGeometry = conflictResolution === "prefer-local" ? localGeometry : remoteGeometry;
      }
      for (const name of geometryGroup) {
        if (selectedGeometry && name in selectedGeometry) result[name] = clone(selectedGeometry[name]);
      }
      continue;
    }
    const baseValue = base?.[key];
    const localValue = local[key];
    const remoteValue = remote[key];
    let value: unknown;
    if (transientKeys.has(key)) {
      // Keep this editor's runtime state where possible. Runtime-only values
      // never block authored changes from being merged.
      value = clone(localValue === undefined ? remoteValue : localValue);
    } else if (sameAuthored(localValue, remoteValue, key)) value = clone(localValue);
    else if (sameAuthored(localValue, baseValue, key)) value = clone(remoteValue);
    else if (sameAuthored(remoteValue, baseValue, key)) value = clone(localValue);
    else {
      conflicts.push(`${path}.${key}`);
      if (conflictResolution === "prefer-local") value = clone(localValue);
      else if (conflictResolution === "prefer-remote") value = clone(remoteValue);
      else continue;
    }
    if (value !== undefined) result[key] = value;
  }
  return conflictResolution === "manual" && conflicts.length !== conflictsBefore
    ? undefined
    : result as T;
}

function mergeIdentified<T extends Identified>(
  base: T[] | undefined,
  local: T[] | undefined,
  remote: T[] | undefined,
  path: string,
  conflicts: string[],
  conflictResolution: ConflictResolution,
): T[] {
  const baseById = new Map((base || []).map((item) => [item.id, item]));
  const localById = new Map((local || []).map((item) => [item.id, item]));
  const remoteById = new Map((remote || []).map((item) => [item.id, item]));
  const ids = [...new Set([
    ...(base || []).map((item) => item.id),
    ...(local || []).map((item) => item.id),
    ...(remote || []).map((item) => item.id),
  ])];
  const merged: T[] = [];
  for (const id of ids) {
    const item = mergeRecord(
      baseById.get(id) as (T & Record<string, unknown>) | undefined,
      localById.get(id) as (T & Record<string, unknown>) | undefined,
      remoteById.get(id) as (T & Record<string, unknown>) | undefined,
      `${path}.${id}`,
      conflicts,
      conflictResolution,
    );
    if (item) merged.push(item);
  }
  return merged;
}

/**
 * Merge two edits made from the same accepted cloud snapshot, or two snapshots
 * with unknown ancestry. Conflicting fields can be reported for manual
 * handling or resolved deterministically while preserving the other side's
 * independent changes.
 */
export function mergeCloudDocuments(
  base: Document | null,
  local: Document,
  remote: Document,
  options: { conflictResolution?: ConflictResolution } = {},
): CloudMergeResult {
  if ((base && base.id !== local.id) || local.id !== remote.id) {
    return { document: null, conflicts: ["document"] };
  }

  const conflictResolution = options.conflictResolution || "manual";
  const mergeBase: Document = base || {
    id: local.id,
    name: "",
    createdAt: "",
    updatedAt: "",
    nodes: [],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const conflicts: string[] = [];
  const stripCollections = (value: Document) => {
    const { nodes: _nodes, edges: _edges, groups: _groups, viewport: _viewport, updatedAt: _updatedAt, ...metadata } = value;
    return metadata as Omit<Document, "nodes" | "edges" | "groups" | "viewport" | "updatedAt">;
  };
  const name = mergeRecord(
    stripCollections(mergeBase) as unknown as Record<string, unknown>,
    stripCollections(local) as unknown as Record<string, unknown>,
    stripCollections(remote) as unknown as Record<string, unknown>,
    "document",
    conflicts,
    conflictResolution,
  );
  // Camera position is per-editor navigation state. Keep the local camera and
  // never report it as an authored-content conflict.
  const viewport = clone(local.viewport || remote.viewport || mergeBase.viewport);
  let nodes = mergeIdentified(mergeBase.nodes, local.nodes, remote.nodes, "nodes", conflicts, conflictResolution);
  let edges = mergeIdentified(mergeBase.edges, local.edges, remote.edges, "edges", conflicts, conflictResolution);
  const mergedNodeIds = new Set(nodes.map((node) => node.id));
  const danglingEdges = edges.filter((edge) => !mergedNodeIds.has(edge.from) || !mergedNodeIds.has(edge.to));
  if (danglingEdges.length) {
    danglingEdges.forEach((edge) => conflicts.push(`edges.${edge.id}.endpoint`));
    if (conflictResolution !== "manual") {
      const preferred = conflictResolution === "prefer-local" ? local : remote;
      const preferredEdges = new Set(preferred.edges.map((edge) => edge.id));
      const byId = new Map(preferred.nodes.map((node) => [node.id, node]));
      for (const edge of danglingEdges) {
        if (!preferredEdges.has(edge.id)) continue;
        for (const id of [edge.from, edge.to]) {
          const endpoint = byId.get(id);
          if (endpoint && !mergedNodeIds.has(id)) {
            nodes.push(clone(endpoint));
            mergedNodeIds.add(id);
          }
        }
      }
      edges = edges.filter((edge) => mergedNodeIds.has(edge.from) && mergedNodeIds.has(edge.to));
    }
  }
  // Group frame geometry is derived from node membership and positions; the
  // node.groupId fields are merged above. Keep a snapshot for compatibility,
  // then let the document normalizer recalculate the frame bounds.
  const groups = clone(local.groups ?? remote.groups ?? []);

  if ((conflictResolution === "manual" && conflicts.length) || !name || !viewport) {
    return { document: null, conflicts };
  }

  const merged: Document = {
    ...clone(local),
    ...(name as unknown as Omit<Document, "nodes" | "edges" | "groups" | "viewport" | "updatedAt">),
    nodes,
    edges,
    groups,
    viewport: viewport as unknown as Document["viewport"],
    updatedAt: new Date().toISOString(),
  };
  return { document: merged, conflicts };
}

/**
 * Decide whether a cloud update can be incorporated silently. A retained
 * common snapshot gives a precise three-way merge; when it is unavailable we
 * still perform a conservative two-way merge and prompt only for divergent
 * authored values that cannot be reconciled safely.
 */
export function planCloudDocumentMerge(
  base: Document | null,
  local: Document,
  remote: Document,
): CloudMergePlan {
  if (local.id !== remote.id || (base && base.id !== local.id))
    return { kind: "conflict", conflicts: ["document"] };

  if (canvasContentSignature(local) === canvasContentSignature(remote))
    return { kind: "same" };
  if (!base) {
    // A persisted common ancestor is preferable, but its absence should not
    // turn every cloud update into a prompt. The two-way merge still combines
    // independent fields and reports divergent values for the same field.
    // Items present on only one side are retained, which avoids silently
    // discarding either side when deletion ancestry is unknown.
    const result = mergeCloudDocuments(null, local, remote);
    if (!result.document) return { kind: "conflict", conflicts: result.conflicts };
    return { kind: "merge", document: result.document };
  }

  const localChanged = canvasContentSignature(local) !== canvasContentSignature(base);
  const remoteChanged = canvasContentSignature(remote) !== canvasContentSignature(base);
  if (!localChanged && !remoteChanged) return { kind: "same" };

  const result = mergeCloudDocuments(base, local, remote);
  if (!result.document) return { kind: "conflict", conflicts: result.conflicts };
  if (!localChanged && remoteChanged) return { kind: "remote-only", document: result.document };
  if (localChanged && !remoteChanged) return { kind: "local-only", document: result.document };
  return { kind: "merge", document: result.document };
}
