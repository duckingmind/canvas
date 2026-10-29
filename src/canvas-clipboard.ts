import type { CanvasNode } from "./canvas-types";

export type CanvasClipboardPayload =
  | { kind: "files"; files: File[] }
  | { kind: "text"; text: string };

export const CANVAS_NODE_CLIPBOARD_TYPE = "application/x-proxy-canvas-nodes";

export type CanvasNodeClipboard = {
  documentId?: string;
  nodes: CanvasNode[];
};

export function serializeCanvasNodes(nodes: CanvasNode[], documentId?: string): string {
  return JSON.stringify(documentId ? { version: 1, documentId, nodes } : nodes);
}

const isCanvasMediaFile = (file: File) =>
  file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/");

/** Read only media files and plain text; editable fields keep browser-native paste. */
export function readCanvasClipboard(data: DataTransfer): CanvasClipboardPayload | null {
  const files: File[] = [];
  const seen = new Set<File>();
  const signatures = new Set<string>();
  const addFile = (file: File | null) => {
    if (!file || !isCanvasMediaFile(file)) return;
    const signature = `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
    if (!seen.has(file) && !signatures.has(signature)) {
      seen.add(file);
      signatures.add(signature);
      files.push(file);
    }
  };

  for (const item of Array.from(data.items || [])) {
    if (item.kind === "file") addFile(item.getAsFile());
  }
  // Browsers expose the same clipboard file through both collections. Prefer
  // `items` when it yielded a media file so one paste creates one node.
  if (!files.length) for (const file of Array.from(data.files || [])) addFile(file);
  if (files.length) return { kind: "files", files };

  const text = data.getData("text/plain");
  return text ? { kind: "text", text } : null;
}

export function parseCanvasNodeClipboard(value: string): CanvasNodeClipboard | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const envelope = !Array.isArray(parsed) && parsed && typeof parsed === "object"
      ? parsed as { version?: unknown; documentId?: unknown; nodes?: unknown }
      : undefined;
    if (envelope && (envelope.version !== 1 || !Array.isArray(envelope.nodes))) return null;
    const valueNodes = Array.isArray(parsed) ? parsed : envelope?.nodes;
    if (!Array.isArray(valueNodes)) return null;
    const nodeTypes = new Set(["note", "prompt", "image", "video", "audio"]);
    const nodes = valueNodes.filter((node): node is CanvasNode => Boolean(
      node && typeof node === "object" && typeof (node as CanvasNode).id === "string" &&
      nodeTypes.has((node as CanvasNode).type) && typeof (node as CanvasNode).title === "string" &&
      ["x", "y", "width", "height"].every((key) => Number.isFinite((node as CanvasNode)[key as "x" | "y" | "width" | "height"])),
    ));
    if (!nodes.length) return null;
    return {
      ...(typeof envelope?.documentId === "string" ? { documentId: envelope.documentId } : {}),
      nodes,
    };
  } catch {
    return null;
  }
}

/**
 * A clipboard item is a snapshot, but a same-canvas paste should reflect the
 * current node contents when that node still exists. This prevents a copy made
 * before regeneration from pasting an older result. Deleted nodes and copies
 * from another canvas retain their clipboard snapshot.
 */
export function refreshCanvasClipboardNodes(
  copiedNodes: CanvasNode[],
  sourceDocumentId: string | undefined,
  currentDocumentId: string,
  currentNodes: readonly CanvasNode[],
): CanvasNode[] {
  if (!sourceDocumentId || sourceDocumentId !== currentDocumentId) return copiedNodes;
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return copiedNodes.map((snapshot) => currentById.get(snapshot.id) || snapshot);
}

/** Keep copied creator references attached to their copied prompt nodes. */
export function remapCopiedNodeReferences(
  nodes: CanvasNode[],
  nodeIds: ReadonlyMap<string, string>,
  createReferenceId: () => string,
): CanvasNode[] {
  const referenceIds = new Map<string, string>();
  for (const node of nodes) {
    for (const reference of node.embeddedReferences || []) {
      if (!referenceIds.has(reference.id)) referenceIds.set(reference.id, createReferenceId());
    }
  }

  return nodes.map((node) => ({
    ...node,
    embeddedReferences: node.embeddedReferences?.map((reference) => ({
      ...reference,
      id: referenceIds.get(reference.id) || reference.id,
    })),
    promptSegments: node.promptSegments?.map((segment) => segment.type === "reference"
      ? {
          ...segment,
          referenceId: referenceIds.get(segment.referenceId) || nodeIds.get(segment.referenceId) || segment.referenceId,
        }
      : segment),
  }));
}
