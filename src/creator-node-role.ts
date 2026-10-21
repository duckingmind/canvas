import type { CanvasNode } from "./canvas-types";
import { hasRecoverableVideoIdentity } from "./video-node-media.ts";
import { hasRecoverableAudioIdentity } from "./audio-source.ts";

export type CanvasNodeRole =
  | { kind: "creator"; creator: CanvasNode; presentation: "prompt" | "generated-media" }
  | { kind: "generated-result"; creator: CanvasNode; result: CanvasNode }
  | { kind: "imported-media"; node: CanvasNode }
  | { kind: "other"; node: CanvasNode };

const hasMedia = (node: CanvasNode) => Boolean(
  node.image || node.video || node.videoContentUrl || node.audio || hasRecoverableVideoIdentity(node) || hasRecoverableAudioIdentity(node),
);

/** Resolve whether selected content is source media, a creator, or a creator output. */
export function resolveCanvasNodeRole(
  node: CanvasNode,
  nodes: CanvasNode[],
): CanvasNodeRole {
  if (node.type === "prompt") {
    return {
      kind: "creator",
      creator: node,
      presentation: hasMedia(node) ? "generated-media" : "prompt",
    };
  }

  if (node.resultOf) {
    const creator = nodes.find((candidate) =>
      candidate.id === node.resultOf && candidate.type === "prompt",
    );
    if (creator) return { kind: "generated-result", creator, result: node };
  }

  // A media card without a valid prompt owner is an imported/source asset.
  // Never infer ownership from its title or edge direction; that was the
  // source of the earlier result-vs-source ambiguity.

  return node.type === "image" || node.type === "video" || node.type === "audio"
    ? { kind: "imported-media", node }
    : { kind: "other", node };
}
