import type { Edge } from "./canvas-types.ts";

type MediaValue = {
  id?: string;
  type: string;
  mediaType?: string;
  image?: string;
  video?: string;
  videoContentUrl?: string;
  audio?: string;
  assetId?: string;
  taskId?: string;
  status?: string;
  resultOf?: string;
  title?: string;
};

type CompletedMediaValue = Pick<MediaValue, "type" | "mediaType" | "status">;

const mediaKind = (node: MediaValue) =>
  node.type === "prompt" ? node.mediaType || "image" : node.type;

/** The cloud projection can unload an old delivery URL without changing the
 * fact that a completed media node is still a value in the canvas. */
export const isCompletedMediaValue = (node: CompletedMediaValue) =>
  node.status === "completed" && (
    node.type === "image" || node.type === "video" || node.type === "audio" ||
    node.type === "prompt" && ["image", "video", "audio"].includes(node.mediaType || "image")
  );

/** Validate that two media values can be connected by one canvas edge. */
export function areCompatibleMediaValues<T extends MediaValue>(
  source: T | undefined,
  target: T | undefined,
) {
  if (!source || !target || (!["image", "video", "audio"].includes(source.type) && source.type !== "prompt") || (!["image", "video", "audio"].includes(target.type) && target.type !== "prompt")) return false;
  const sourceKind = mediaKind(source);
  const targetKind = mediaKind(target);
  if (!["image", "video", "audio"].includes(sourceKind) || !["image", "video", "audio"].includes(targetKind)) return false;
  return !((sourceKind === "audio" || targetKind === "audio") && sourceKind !== targetKind);
}

/** Keep a media edge while a document is normalized or a URL is refreshing. */
export function canKeepMediaEdge<T extends MediaValue>(
  source: T | undefined,
  target: T | undefined,
  hasMediaContent: (node: T) => boolean,
) {
  return Boolean(source && target && areCompatibleMediaValues(source, target) &&
    (hasMediaContent(source) || isCompletedMediaValue(source)) &&
    (hasMediaContent(target) || isCompletedMediaValue(target)));
}

/** Keep valid media edges while a document is canonicalized. */
export function shouldKeepMediaEdge<T extends MediaValue>(
  edge: Pick<Edge, "from">,
  source: T | undefined,
  target: T,
  hasMediaContent: (node: T) => boolean,
) {
  if (target.resultOf) return Boolean(source && edge.from === target.resultOf);
  // Older canvases predate explicit resultOf metadata. Retain the narrow
  // creator-to-result shape they used, while dropping other ambiguous media
  // edges from legacy documents.
  if (source?.type === "prompt" && (
    hasMediaContent(target) ||
    target.title?.startsWith(`${source.title} · 结果`) ||
    target.title === `${source.title} · 视频结果`
  )) return true;
  return canKeepMediaEdge(source, target, hasMediaContent);
}
