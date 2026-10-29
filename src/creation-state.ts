import type { CanvasNode } from "./canvas-types";
import { isDurableAssetUrl } from "./asset-library.ts";
import { hasStableMediaIdentity } from "./media-identity.ts";

/** Reuse a completed media value; a duplicate is another reference, not a new upload. */
export function copiedMediaIdentity(node: CanvasNode): Pick<CanvasNode, "assetId" | "taskId" | "status"> {
  const mediaType = node.mediaType || node.type;
  if (
    !["image", "audio", "video"].includes(mediaType) ||
    node.uploadState ||
    (node.status !== undefined && node.status !== "completed") ||
    !hasStableMediaIdentity({
      assetId: node.assetId,
      taskId: node.taskId,
      url: node.image || node.video || node.videoContentUrl || node.audio,
    })
  ) return {};
  const url = node.image || node.video || node.videoContentUrl || node.audio;
  const reusableOutput = Boolean(node.assetId || isDurableAssetUrl(url) || node.status === "completed" && node.taskId);
  if (!reusableOutput) return {};
  return {
    ...(node.assetId ? { assetId: node.assetId } : {}),
    ...(node.taskId ? { taskId: node.taskId } : {}),
    status: "completed",
  };
}

function durableDelivery(value: string | undefined): string | undefined {
  return value && isDurableAssetUrl(value) ? value : undefined;
}

/** Remove browser-local and expiring deliveries while retaining reusable IDs and durable URLs. */
export function copiedMediaFields(node: CanvasNode): Partial<CanvasNode> {
  const embeddedReferences = node.embeddedReferences?.map(reference => ({
    ...reference,
    image: durableDelivery(reference.image),
    imageThumbnail: durableDelivery(reference.imageThumbnail),
    video: durableDelivery(reference.video),
    audio: durableDelivery(reference.audio),
    videoContentUrl: undefined,
    videoContentUrlExpiresAt: undefined,
    localImage: undefined,
    localVideo: undefined,
    localAudio: undefined,
  }));
  return {
    ...copiedMediaIdentity(node),
    image: durableDelivery(node.image),
    imageThumbnail: durableDelivery(node.imageThumbnail),
    video: durableDelivery(node.video),
    videoContentUrl: undefined,
    videoContentUrlExpiresAt: undefined,
    audio: durableDelivery(node.audio),
    videoPoster: undefined,
    localVideoPoster: undefined,
    localImage: undefined,
    localVideo: undefined,
    localAudio: undefined,
    uploadState: undefined,
    uploadProgress: undefined,
    uploadError: undefined,
    embeddedReferences,
    musicReference: node.musicReference
      ? { ...node.musicReference, localAudio: undefined }
      : undefined,
  };
}

export type CreationInputs = {
  prompt: string;
  model: string;
  references: readonly {
    nodeId: string;
    image?: string;
    /** Legacy marker is ignored; images must be server-delivered or asset-backed. */
    localImage?: string;
    video?: string;
    localVideo?: string;
    audio?: string;
    localAudio?: string;
    videoContentUrl?: string;
    assetId?: string;
  }[];
  ignoreImageRefs?: boolean;
  settings?: Record<string, unknown>;
};

/**
 * Create the editable state for a new task while retaining the user's
 * composition inputs. A retry must keep the original submission identity;
 * this helper is for the separate "copy as new task" path and therefore
 * removes every task/result identity that could accidentally resume or
 * overwrite the old request.
 */
export function createEditableCanvasTaskCopy(node: CanvasNode, id: string): CanvasNode {
  const copy: CanvasNode = {
    ...node,
    id,
    title: `${node.title} · 新任务`,
    embeddedReferences: node.embeddedReferences?.map((reference) => ({ ...reference })),
    promptSegments: node.promptSegments?.map((segment) => ({ ...segment })),
    imageSettings: node.imageSettings ? { ...node.imageSettings } : undefined,
    videoSettings: node.videoSettings ? { ...node.videoSettings } : undefined,
    musicSettings: node.musicSettings ? { ...node.musicSettings } : undefined,
    musicReference: node.musicReference ? { ...node.musicReference } : undefined,
  };

  // Keep the list explicit. It documents the boundary between frozen input
  // fields (prompt, references, model and parameters) and mutable task state.
  const taskStateKeys: Array<keyof CanvasNode | "videoTaskId" | "taskStage" | "cancelRequested"> = [
    "taskId",
    "assetId",
    "image",
    "imageThumbnail",
    "imageAspectRatio",
    "localImage",
    "video",
    "localVideo",
    "videoContentUrl",
    "videoContentUrlExpiresAt",
    "videoPoster",
    "localVideoPoster",
    "audio",
    "localAudio",
    "voiceId",
    "voiceTrialAudioAvailable",
    "uploadState",
    "uploadProgress",
    "uploadError",
    "error",
    "taskPrompt",
    "taskDiagnostic",
    "generationBatchId",
    "inputSignature",
    "submission",
    "videoSubmission",
    "musicSubmission",
    "voiceDesignSubmission",
    "ttsSubmission",
    "audioTaskType",
    "taskStage",
    "cancelRequested",
    "videoPollingPaused",
    "videoPollingReason",
    "resultOf",
    "resultIndex",
    "resultBatchId",
    "operationId",
    "operationParams",
    "continuationOf",
    "status",
  ];
  const mutable = copy as unknown as Record<string, unknown>;
  for (const key of taskStateKeys) delete mutable[key];
  return copy;
}

/**
 * A compact, synchronous fingerprint for the “inputs changed” UI. This is not
 * a security hash or a request idempotency key. Feed strings incrementally so
 * large local images do not become part of the saved fingerprint or require
 * another combined copy in memory. Length framing preserves field boundaries.
 */
export function creationInputSignature(input: CreationInputs): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b1;
  const feed = (value: string) => {
    const frame = `${value.length}:`;
    for (const text of [frame, value]) {
      for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
      }
    }
  };
  feed(input.prompt.trim());
  feed(input.model);
  if (input.settings) feed(JSON.stringify(input.settings));
  const references = input.ignoreImageRefs ? [] : input.references;
  feed(String(references.length));
  for (const reference of references) {
    feed(reference.nodeId);
    // A restored image and its cached copy represent one effective input.
    // Keep the cache identity only while the actual image is unavailable.
    feed(reference.image || reference.video || reference.localVideo || reference.audio || reference.localAudio || reference.assetId || reference.videoContentUrl || "");
  }
  return `v1:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export type CreatorPanelPlacement = {
  left: number;
  top: number;
  width: number;
};

type PanelPlacementOptions = {
  width?: number;
  gap?: number;
  clampToBoard?: boolean;
};

const finite = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Position a screen-space editor below its selected node, independent of
 * canvas zoom. Small boards can opt into horizontal clamping so a node near
 * an edge cannot make the editor impossible to reach. Height is owned by the
 * editor's content and CSS, never by the space below its changing position.
 */
export function placeCreatorPanel(
  nodeRect: { x: number; y: number; width: number; height: number },
  board: { width: number; height: number },
  options: PanelPlacementOptions = {},
): CreatorPanelPlacement {
  const boardWidth = Math.max(0, finite(board.width, 0));
  const margin = Math.min(12, boardWidth / 2);
  const width = Math.min(
    Math.max(0, finite(options.width, 560)),
    Math.max(0, boardWidth - margin * 2),
  );
  const anchorTop =
    finite(nodeRect.y, 0) +
    Math.max(0, finite(nodeRect.height, 0)) +
    Math.max(0, finite(options.gap, 14));
  // The composer always stays below the target. It is intentionally not
  // flipped above or docked to the viewport when there is not enough room:
  // doing so breaks the visual relationship while panning a large canvas.
  const top = anchorTop;
  const center = finite(nodeRect.x, 0) + Math.max(0, finite(nodeRect.width, 0)) / 2;
  const centeredLeft = center - width / 2;
  const left = options.clampToBoard && boardWidth > 0
    ? Math.max(margin, Math.min(centeredLeft, Math.max(margin, boardWidth - width - margin)))
    : centeredLeft;
  return {
    left,
    top,
    width,
  };
}
