/** Maximum number of recently loaded offscreen media nodes kept mounted. */
export const MAX_RETAINED_LOADED_MEDIA_NODES = 24;

/**
 * Mark a media node as recently used and evict the oldest entries when the
 * retention window is full. The Set's insertion order is the LRU order.
 */
export function touchRetainedMediaNode(
  current: Set<string>,
  nodeId: string,
  limit = MAX_RETAINED_LOADED_MEDIA_NODES,
): Set<string> {
  const capacity = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (!nodeId || capacity === 0) return new Set();

  let newestId: string | undefined;
  for (const id of current) newestId = id;
  if (newestId === nodeId && current.size <= capacity) return current;

  const next = new Set(current);
  next.delete(nodeId);
  next.add(nodeId);
  while (next.size > capacity) {
    const oldestId = next.values().next().value as string | undefined;
    if (oldestId === undefined) break;
    next.delete(oldestId);
  }
  return next;
}
