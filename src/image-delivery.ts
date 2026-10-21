import type { CanvasNode, StoredAsset } from "./canvas-types.ts";
import { imageOriginalURL, isThumbnailURL } from "./image-variants.ts";
import { mapTaskImageResults, type ImageRecoveryUpdate } from "./image-recovery.ts";

type ImageNode = Pick<CanvasNode, "id" | "assetId" | "taskId" | "resultIndex" | "image" | "imageThumbnail">;
type DeliveryReaders = {
  readAsset: (assetId: string) => Promise<Pick<StoredAsset, "url" | "thumbnail_url" | "task_id">>;
  readTask: (taskId: string) => Promise<unknown>;
};

/** A thumbnail address is never evidence that the original was recovered. */
export function recoveredImageOriginal(source?: string, thumbnail?: string): string | undefined {
  if (!source || !/^(?:https?:\/\/|\/|data:image\/|blob:)/i.test(source)) return undefined;
  if (isThumbnailURL(source)) return undefined;
  const original = imageOriginalURL(source);
  if (!original || isThumbnailURL(original)) return undefined;
  if (!/^(?:data:image\/|blob:)/i.test(original) && original === thumbnail) return undefined;
  return original;
}

/** Resolve an asset first, then its task, without allowing a failed asset
 * index or a thumbnail-only response to block the task's original output. */
export async function recoverImageDelivery(
  node: ImageNode,
  siblings: readonly ImageNode[],
  readers: DeliveryReaders,
): Promise<{ image: string; taskId?: string; updates: ImageRecoveryUpdate[] } | undefined> {
  let taskId = node.taskId;
  if (node.assetId) {
    try {
      const asset = await readers.readAsset(node.assetId);
      taskId = asset.task_id || taskId;
      const image = recoveredImageOriginal(asset.url, asset.thumbnail_url || node.imageThumbnail);
      if (image) return {
        image, taskId,
        updates: [{ id: node.id, taskId: taskId || "", image, ...(asset.thumbnail_url ? { thumbnail: asset.thumbnail_url } : {}) }],
      };
    } catch {
      // The task remains readable when an older asset index is unavailable.
    }
  }
  if (!taskId) return undefined;
  try {
    const response = await readers.readTask(taskId);
    const candidates = siblings.filter(candidate => candidate.taskId === taskId && candidate.id !== node.id);
    let requested = { ...node, taskId };
    // Asset identity is authoritative for imported results whose task result
    // index is absent or belongs to an older ordering.
    const data = response && typeof response === "object" && "data" in response ? response.data : undefined;
    if (node.assetId && Array.isArray(data)) {
      const assetIndex = data.findIndex(entry => entry && typeof entry === "object" && entry.asset_id === node.assetId);
      if (assetIndex >= 0) requested = { ...requested, resultIndex: assetIndex };
    }
    const nodes = [...candidates, requested];
    const updates = mapTaskImageResults(taskId, nodes, response).flatMap(update => {
      const candidate = nodes.find(candidate => candidate.id === update.id);
      const image = recoveredImageOriginal(update.image, update.thumbnail || candidate?.imageThumbnail);
      return image ? [{ ...update, image }] : [];
    });
    const current = updates.find(update => update.id === node.id);
    return current ? { image: current.image, taskId, updates } : undefined;
  } catch {
    return undefined;
  }
}
