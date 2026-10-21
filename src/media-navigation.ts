import { hasRecoverableVideoIdentity } from "./video-node-media.ts";
import { hasRecoverableAudioIdentity } from "./audio-source.ts";

type MediaNode = {
  id: string;
  type: string;
  mediaType?: string;
  title?: string;
  image?: string;
  localImage?: string;
  video?: string;
  localVideo?: string;
  videoContentUrl?: string;
  audio?: string;
  localAudio?: string;
  voiceTrialAudioAvailable?: boolean;
  taskId?: string;
  assetId?: string;
  status?: string;
  operationId?: string;
  resultOf?: string;
  resultIndex?: number;
  generationBatchId?: string;
  resultBatchId?: string;
  submission?: { resultBatchId?: string };
  videoSubmission?: { key?: string };
};
type Connection = { from: string; to: string };

const hasMedia = (node: MediaNode) =>
  ((node.type === "image" || node.type === "prompt") && Boolean(node.image || node.localImage)) ||
  ((node.type === "video" || node.type === "prompt") && Boolean(node.video || node.videoContentUrl)) ||
  hasRecoverableVideoIdentity(node) ||
  ((node.type === "audio" || node.type === "prompt" && node.mediaType === "audio") && Boolean(node.audio)) || hasRecoverableAudioIdentity(node);

/**
 * A completed prompt with inline media is a generated result even though the
 * node keeps the `prompt` type. Single-output generations use this compact
 * shape, so they have no resultOf sibling to identify a gallery. Keep this
 * fallback deliberately narrow: notes and empty/pending prompts never enter
 * it, while explicit result lineage remains authoritative above it.
 */
const isInlineGeneratedMedia = (node: MediaNode) =>
  node.type === "prompt" && hasMedia(node) && (
    node.status === "completed" ||
    Boolean(node.taskId || node.submission || node.videoSubmission || node.resultBatchId || node.generationBatchId)
  );

/** Generated or imported media cards can participate in a canvas-level fallback gallery. */
const isCanvasMedia = (node: MediaNode) =>
  hasMedia(node) && (node.type === "prompt" || node.type === "image" || node.type === "video" || node.type === "audio");

const uniqueNodes = <T extends MediaNode>(nodes: readonly T[]) => {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
};

/** Keep explicit result indexes first, while retaining canvas order as a tie-breaker. */
const orderResults = <T extends MediaNode>(nodes: readonly T[]) =>
  nodes
    .map((node, order) => ({ node, order }))
    .sort((left, right) => {
      const leftIndex = Number.isInteger(left.node.resultIndex)
        ? left.node.resultIndex!
        : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isInteger(right.node.resultIndex)
        ? right.node.resultIndex!
        : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.order - right.order;
    })
    .map(({ node }) => node);

const firstBatch = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === "string" && value.length > 0);

/**
 * Resolve a media result's creator and follow only that creator's results.
 * `resultOf` is authoritative; the incoming prompt and direct output edge
 * are retained only for canvases saved before result lineage was persisted.
 */
export function mediaNavigation<T extends MediaNode>(nodes: readonly T[], edges: readonly Connection[], current: T) {
  const parentIds = new Set(edges.filter((edge) => edge.to === current.id).map((edge) => edge.from));
  const incomingSources = uniqueNodes(nodes.filter((node) => node.type === "prompt" && parentIds.has(node.id)));
  const hasLineage = typeof current.resultOf === "string" && current.resultOf.length > 0;
  const lineageSource = current.resultOf
    ? nodes.find((node) => node.id === current.resultOf)
    : undefined;
  if (hasLineage && !lineageSource) return { sources: [], items: [current], index: 0 };
  const currentBatch = current.resultBatchId;
  const batchSources = currentBatch
    ? uniqueNodes(nodes.filter((node) => {
      if (node.type !== "prompt") return false;
      return firstBatch(
        node.submission?.resultBatchId,
        node.generationBatchId,
        node.resultBatchId,
      ) === currentBatch;
    }))
    : [];
  // A prompt that owns inline media is its own creator. A generated node with
  // a valid resultOf must win over stale or accidental incoming edges. Image
  // tool outputs can point to an image source rather than a prompt, so the
  // explicit lineage is intentionally not limited to prompt nodes.
  const sources = lineageSource
    ? [lineageSource]
    : current.type === "prompt"
      ? [current]
      : incomingSources.length
        ? incomingSources
        : batchSources;

  // Without one unambiguous source, do not mix unrelated results in a gallery.
  if (sources.length !== 1) return { sources, items: [current], index: 0 };
  const source = sources[0];
  const outputIds = new Set(edges.filter((edge) => edge.from === source.id).map((edge) => edge.to));
  const incomingTargetIds = new Set(edges.map((edge) => edge.to));
  const sourceBatch = firstBatch(
    source.submission?.resultBatchId,
    source.generationBatchId,
    source.resultBatchId,
  );
  const requestedBatch = firstBatch(current.resultBatchId, sourceBatch);
  const candidates = uniqueNodes(nodes.filter((node) => {
    if (node.id === source.id || !hasMedia(node)) return false;
    if (node.resultOf === source.id) return true;
    // A resultOf value pointing elsewhere is stronger than an old direct edge.
    // Do not turn a continuation prompt into a gallery item.
    if (!node.resultOf && node.type !== "prompt" && outputIds.has(node.id)) return true;
    // Some saved canvases lost their edges while retaining the immutable
    // result batch. A batch is generated per creator request, so it is safe to
    // recover media siblings from that identifier when lineage is absent.
    return Boolean(
      requestedBatch &&
      node.type !== "prompt" &&
      node.resultBatchId === requestedBatch &&
      // If explicit lineage exists on the selected node, recover a sibling
      // only when it has no competing incoming source. A stale edge from a
      // different creator must never be pulled into this gallery.
      (!current.resultOf || outputIds.has(node.id) || !incomingTargetIds.has(node.id)),
    );
  }));
  // Single-output generations are stored directly on separate prompt nodes.
  // There is no result edge to follow, but the completed prompt still belongs
  // to the canvas media sequence. Use that sequence only as a last resort;
  // explicit lineage and batch metadata above always take precedence.
  if (!candidates.length && !hasLineage && isInlineGeneratedMedia(current)) {
    const canvasItems = orderResults(uniqueNodes(nodes.filter(isCanvasMedia)));
    const canvasIndex = canvasItems.findIndex((node) => node.id === current.id);
    if (canvasItems.length > 1 && canvasIndex >= 0)
      return { sources, items: canvasItems, index: canvasIndex };
  }
  if (!candidates.length) return { sources, items: [current], index: 0 };

  // The selected result identifies its batch first. During recovery the source
  // can still hold the frozen submission or generation batch, so use those
  // before inferring the newest batch from the candidate nodes.
  const latestCandidateBatch = [...candidates].reverse().find((node) => node.resultBatchId)?.resultBatchId;
  const batchId = requestedBatch || latestCandidateBatch;
  const explicitCandidateBatches = new Set(
    candidates
      .map((node) => node.resultBatchId)
      .filter((value): value is string => Boolean(value)),
  );
  // Older result nodes may not have a resultBatchId. Include those when the
  // creator identifies the selected batch, or when there is no competing
  // batch metadata. This recovers legacy galleries without mixing a known
  // historical batch into the current one.
  const currentIsUnbatchedSibling = current.resultOf === source.id && !current.resultBatchId;
  const includeUnbatched = Boolean(
    batchId && (
      // The creator's batch is authoritative. Results written by older
      // versions may have the same resultOf but no batch id, so retain those
      // siblings when the source still identifies the active batch.
      sourceBatch === batchId ||
      // If the selected result is an explicitly linked legacy sibling without
      // a batch id, it is added below while unbatched siblings stay excluded
      // from an otherwise ambiguous historical batch.
      (!currentIsUnbatchedSibling && explicitCandidateBatches.size <= 1 &&
        (explicitCandidateBatches.size === 0 || explicitCandidateBatches.has(batchId)))
    ),
  );
  const batchItems = currentIsUnbatchedSibling && !sourceBatch
    // With no creator batch, an unbatched selected result cannot identify
    // which explicit historical batch it belongs to. Keep its unbatched
    // siblings together and leave the known batches out of this gallery.
    ? candidates.filter((node) => !node.resultBatchId)
    : batchId
      ? candidates.filter((node) => node.resultBatchId === batchId || (includeUnbatched && !node.resultBatchId))
      : candidates;
  // Always retain the selected explicitly linked legacy result. It can be
  // unbatched while other siblings carry a historical batch id, in which case
  // including every unbatched node would be too broad but dropping the
  // selected node would collapse the gallery back to one item.
  const selectedItems = currentIsUnbatchedSibling && !batchItems.some((node) => node.id === current.id)
    ? [current, ...batchItems]
    : batchItems;
  const orderedResults = orderResults(selectedItems);
  // A completed creator keeps a single output on its prompt node. When later
  // results are stored as sibling nodes, the creator's own media is part of
  // the same gallery only when its batch is compatible with the selected one.
  const sourceIsCurrentMedia = source.type === "prompt" && hasMedia(source) &&
    (!batchId || !sourceBatch || sourceBatch === batchId);
  const items = sourceIsCurrentMedia
    ? [source, ...orderedResults.filter((node) => node.id !== source.id)]
    : orderedResults;
  const index = items.findIndex((node) => node.id === current.id);
  // If a malformed legacy node cannot be associated with the selected batch,
  // keep it viewable without exposing unrelated results beside it.
  return index < 0
    ? { sources, items: [current], index: 0 }
    : { sources, items, index };
}
