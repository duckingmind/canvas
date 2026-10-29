import type { Rect } from "./geometry";
import type { PromptSegment } from "./canvas-types";
import { normalizePromptSegments, promptSegmentsText } from "./prompt-segments.ts";

export type WorkflowNode = {
  id: string;
  type: "note" | "prompt" | "image" | "video" | "audio";
  title: string;
  text: string;
  image?: string;
  imageThumbnail?: string;
  audio?: string;
  localAudio?: string;
  localVideo?: string;
  embeddedReferences?: {
    id: string;
    title: string;
    image?: string;
    imageThumbnail?: string;
    video?: string;
    audio?: string;
    localAudio?: string;
    localVideo?: string;
    videoContentUrl?: string;
    videoContentUrlExpiresAt?: string;
    mediaType?: "image" | "video" | "audio";
    assetId?: string;
  }[];
  promptSegments?: PromptSegment[];
  mediaType?: "image" | "video" | "audio";
  video?: string;
  videoContentUrl?: string;
  videoContentUrlExpiresAt?: string;
  assetId?: string;
};
export type WorkflowEdge = { from: string; to: string };
export type ImageReferenceValue = { image?: string; assetId?: string };

/** Only server-delivered URLs or a stable platform asset identity are valid
 * image inputs. Data/Blob URLs are browser-local intermediates. */
const durableImageURL = (value: unknown): value is string =>
  typeof value === "string" && /^(?:https?:\/\/|\/)/i.test(value.trim());
const hasDurableImage = (value: ImageReferenceValue | undefined): boolean =>
  Boolean(value?.assetId || durableImageURL(value?.image));

export type VideoReferenceValue = { mediaType?: "video" | "audio"; video?: string; localVideo?: string; audio?: string; localAudio?: string; videoContentUrl?: string; videoContentUrlExpiresAt?: string; assetId?: string };

/** Stable identity used when the same image is exposed through multiple nodes. */
export const imageReferenceIdentity = (reference: ImageReferenceValue) =>
  reference.assetId ? `asset:${reference.assetId}` : durableImageURL(reference.image) ? `image:${reference.image}` : "";

export const videoReferenceIdentity = (reference: Omit<VideoReferenceValue, "mediaType">) =>
  reference.assetId ? `asset:${reference.assetId}` :
  reference.video ? `video:${reference.video}` :
  reference.audio ? `audio:${reference.audio}` :
  reference.videoContentUrl ? `video:${reference.videoContentUrl}` :
  reference.localVideo ? `local-video:${reference.localVideo}` :
  reference.localAudio ? `local-audio:${reference.localAudio}` : "";

const isMediaReferenceNode = (node: WorkflowNode) =>
  node.type === "image" || node.type === "video" || node.type === "audio" ||
  node.type === "prompt" && Boolean(hasDurableImage(node) || node.video || node.localVideo || node.audio || node.localAudio || node.videoContentUrl);

/** Text nodes are values only when they do not already represent a generated image. */
export const isWorkflowTextReference = (
  node: Pick<WorkflowNode, "type" | "text" | "image">,
) => Boolean(
  node.text.trim() &&
  (node.type === "note" || (node.type === "prompt" && !node.image)),
);
export type PromptComposition = {
  prompt: string;
  textReferences: { nodeId: string; title: string; text: string }[];
  imageReferences: {
    nodeId: string;
    title: string;
    image?: string;
    imageThumbnail?: string;
    assetId?: string;
    embedded?: boolean;
  }[];
  videoReferences: {
    nodeId: string;
    title: string;
    mediaType?: "video" | "audio";
    video?: string;
    localVideo?: string;
    audio?: string;
    localAudio?: string;
    videoContentUrl?: string;
    videoContentUrlExpiresAt?: string;
    assetId?: string;
  }[];
};

/**
 * Indexes the immutable workflow snapshot once before composing prompts.
 *
 * Canvas pointer gestures replace node objects frequently, so rebuilding the
 * node and incoming-edge maps for every prompt turns a geometry-only update
 * into an O(prompts * (nodes + edges)) pass. Keeping the index separate lets
 * callers compose all prompts from one graph snapshot.
 */
export type WorkflowIndex = {
  byId: Map<string, WorkflowNode>;
  incoming: Map<string, Set<string>>;
};

export function createWorkflowIndex(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    if (!incoming.has(edge.to)) incoming.set(edge.to, new Set());
    incoming.get(edge.to)!.add(edge.from);
  }
  return { byId, incoming };
}

/**
 * Build a prompt from incoming dependencies, then the selected node's text.
 * References exclude the selected node and are unique by node ID, in dependency
 * order (connection order breaks ties). Cycles are cut at the first visited
 * node. An image is an already produced value: collect it without traversing
 * its inputs, so continuing from a result does not replay historical prompts
 * or reference images. Images remain explicit even while their image is
 * missing: the caller must validate model support and image availability.
 */
export function composePromptWithIndex(
  index: WorkflowIndex,
  promptNodeId: string,
): PromptComposition {
  const result: PromptComposition = {
    prompt: "",
    textReferences: [],
    imageReferences: [],
    videoReferences: [],
  };
  const { byId, incoming } = index;
  const target = byId.get(promptNodeId);
  if (!target) return result;
  const visited = new Set([promptNodeId]);
  const seenImages = new Set<string>();
  const seenVideos = new Set<string>();
  const targetSegments = target.promptSegments
    ? normalizePromptSegments(target.promptSegments, target.text)
    : undefined;
  // Inline mentions are ordered prompt inputs. Resolve them against the same
  // immutable graph snapshot used for upstream links, then let the ordinary
  // edge walk deduplicate a source that is also connected to this prompt.
  for (const segment of targetSegments || []) {
    if (segment.type !== "reference") continue;
    const node = byId.get(segment.referenceId);
    if (!node || !hasDurableImage(node) || !(node.type === "image" || (node.type === "prompt" && node.mediaType !== "video" && node.mediaType !== "audio"))) continue;
    const imageKey = imageReferenceIdentity(node);
    if (!imageKey || seenImages.has(imageKey)) continue;
    seenImages.add(imageKey);
    result.imageReferences.push({
      nodeId: node.id,
      title: node.title || segment.label,
      ...(durableImageURL(node.image) ? { image: node.image } : {}),
      ...(node.imageThumbnail ? { imageThumbnail: node.imageThumbnail } : {}),
      ...(node.assetId ? { assetId: node.assetId } : {}),
    });
  }
  for (const reference of target.embeddedReferences || []) {
    if (reference.video || reference.localVideo || reference.audio || reference.localAudio || reference.mediaType === "video" || reference.mediaType === "audio" || target.mediaType === "video" && !reference.image && (reference as { videoContentUrl?: string; assetId?: string }).videoContentUrl || target.mediaType === "video" && !reference.image && !reference.mediaType && (reference as { assetId?: string }).assetId) {
      const videoReference = reference as VideoReferenceValue;
      const videoKey = videoReferenceIdentity(videoReference);
      if (videoKey && seenVideos.has(videoKey)) continue;
      if (videoKey) seenVideos.add(videoKey);
      result.videoReferences.push({
        nodeId: reference.id,
        title: reference.title,
        mediaType: reference.mediaType === "audio" || (!reference.mediaType && (reference.audio || reference.localAudio)) ? "audio" : "video",
        ...(videoReference.mediaType ? { mediaType: videoReference.mediaType } : {}),
        ...(videoReference.video ? { video: videoReference.video } : {}),
        ...(videoReference.localVideo ? { localVideo: videoReference.localVideo } : {}),
        ...(videoReference.audio ? { audio: videoReference.audio } : {}),
        ...(videoReference.localAudio ? { localAudio: videoReference.localAudio } : {}),
        ...(videoReference.videoContentUrl ? { videoContentUrl: videoReference.videoContentUrl } : {}),
        ...(videoReference.videoContentUrlExpiresAt ? { videoContentUrlExpiresAt: videoReference.videoContentUrlExpiresAt } : {}),
        ...(videoReference.assetId ? { assetId: videoReference.assetId } : {}),
      });
      continue;
    }
    const imageKey = imageReferenceIdentity(reference);
    if (!imageKey || seenImages.has(imageKey)) continue;
    seenImages.add(imageKey);
    result.imageReferences.push({
      nodeId: reference.id,
      title: reference.title,
      embedded: true,
      ...(durableImageURL(reference.image) ? { image: reference.image } : {}),
      ...(reference.imageThumbnail ? { imageThumbnail: reference.imageThumbnail } : {}),
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
    });
  }
  const stack = [
    {
      id: promptNodeId,
      next: 0,
      parents: [...(incoming.get(promptNodeId) || [])],
    },
  ];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.next < frame.parents.length) {
      const id = frame.parents[frame.next++];
      if (visited.has(id)) continue;
      visited.add(id);
      stack.push({
        id,
        next: 0,
        parents:
          isMediaReferenceNode(byId.get(id)!)
            ? []
            : [...(incoming.get(id) || [])],
      });
      continue;
    }
    stack.pop();
    if (frame.id === promptNodeId) continue;
    const node = byId.get(frame.id)!;
    if (node.type === "video" || node.type === "audio" || (node.type === "prompt" && (node.mediaType === "video" || node.mediaType === "audio") && Boolean(node.video || node.localVideo || node.audio || node.localAudio || node.videoContentUrl || node.assetId))) {
      const videoKey = videoReferenceIdentity(node);
      if (videoKey && seenVideos.has(videoKey)) continue;
      if (videoKey) seenVideos.add(videoKey);
      result.videoReferences.push({
        nodeId: node.id,
        title: node.title,
        mediaType: node.type === "audio" || node.mediaType === "audio" ? "audio" : "video",
        ...(node.video ? { video: node.video } : {}),
        ...(node.localVideo ? { localVideo: node.localVideo } : {}),
        ...(node.audio ? { audio: node.audio } : {}),
        ...(node.localAudio ? { localAudio: node.localAudio } : {}),
        ...(node.videoContentUrl ? { videoContentUrl: node.videoContentUrl } : {}),
        ...(node.videoContentUrlExpiresAt ? { videoContentUrlExpiresAt: node.videoContentUrlExpiresAt } : {}),
        ...(node.assetId ? { assetId: node.assetId } : {}),
      });
    } else if (node.type === "image" || (node.type === "prompt" && node.mediaType !== "video" && node.mediaType !== "audio" && hasDurableImage(node))) {
      const imageKey = imageReferenceIdentity(node);
      // Image nodes can still be present while a COS upload is in progress.
      // They are not text dependencies and must not produce an empty image
      // input that later code could mistake for a valid submission.
      if (!imageKey || seenImages.has(imageKey)) continue;
      seenImages.add(imageKey);
      result.imageReferences.push({
        nodeId: node.id,
        title: node.title,
        ...(durableImageURL(node.image) ? { image: node.image } : {}),
        ...(node.imageThumbnail ? { imageThumbnail: node.imageThumbnail } : {}),
        ...(node.assetId ? { assetId: node.assetId } : {}),
      });
    } else if (node.text.trim()) {
      result.textReferences.push({
        nodeId: node.id,
        title: node.title,
        text: node.text.trim(),
      });
    }
  }
  result.prompt = [
    ...result.textReferences.map((reference) => reference.text),
    target.type === "image" ? "" : (targetSegments ? promptSegmentsText(targetSegments) : target.text).trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return result;
}

export function composePrompt(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  promptNodeId: string,
): PromptComposition {
  return composePromptWithIndex(createWorkflowIndex(nodes, edges), promptNodeId);
}

type Point = Pick<Rect, "x" | "y">;
const validRect = (rect: Rect) =>
  [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
  rect.width > 0 &&
  rect.height > 0;
const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

/**
 * World coordinates for a new rectangle. Keep the desired point if free;
 * otherwise try nearby positions to its right/below, respecting actual sizes.
 * A bounded search falls back beyond the rightmost obstacle, so dense imports
 * always terminate. Input rectangles are never changed; callers add the result
 * to their occupied list when placing a batch.
 */
export function findFreePosition(
  nodes: readonly Rect[],
  desired: Rect,
  gap = 32,
): Point {
  const origin = { x: finite(desired.x), y: finite(desired.y) };
  const width = Math.max(1, finite(desired.width, 1));
  const height = Math.max(1, finite(desired.height, 1));
  const spacing = Math.max(0, finite(gap, 32));
  const occupied = nodes.filter(validRect);
  const overlaps = (point: Point, rect: Rect) =>
    point.x < rect.x + rect.width + spacing &&
    point.x + width + spacing > rect.x &&
    point.y < rect.y + rect.height + spacing &&
    point.y + height + spacing > rect.y;
  const score = (point: Point) =>
    (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
  const frontier: Point[] = [origin];
  const seen = new Set([`${origin.x},${origin.y}`]);
  const add = (point: Point) => {
    const key = `${point.x},${point.y}`;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || seen.has(key))
      return;
    seen.add(key);
    if (frontier.length < 4096) frontier.push(point);
  };
  for (let attempt = 0; frontier.length && attempt < 4096; attempt++) {
    frontier.sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
    const point = frontier.shift()!;
    const collisions = occupied.filter((rect) => overlaps(point, rect));
    if (!collisions.length) return point;
    for (const rect of collisions) {
      add({ x: Math.max(point.x, rect.x + rect.width + spacing), y: point.y });
      add({ x: point.x, y: Math.max(point.y, rect.y + rect.height + spacing) });
    }
  }
  return {
    x: occupied.reduce(
      (right, rect) => Math.max(right, rect.x + rect.width + spacing),
      origin.x,
    ),
    y: origin.y,
  };
}
