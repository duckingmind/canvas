export type MediaUploadRuntimeState = {
  state: "preparing" | "uploading" | "completing" | "failed";
  progress: number;
  error?: string;
};

export type MediaUploadStateMap = Record<string, MediaUploadRuntimeState>;

function boundedProgress(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

/** Preserve the last measured position when an upload changes to a failure. */
export function markMediaUploadFailed(
  states: MediaUploadStateMap,
  nodeId: string,
  error: string,
): MediaUploadStateMap {
  return {
    ...states,
    [nodeId]: {
      state: "failed",
      progress: boundedProgress(states[nodeId]?.progress),
      error,
    },
  };
}
