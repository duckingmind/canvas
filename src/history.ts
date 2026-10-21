type HistoryNode = {
  id: string;
  type: string;
  taskId?: string;
  status?: string;
  taskPrompt?: string;
  taskDiagnostic?: unknown;
  inputSignature?: string;
  error?: string;
  submission?: unknown;
  videoSubmission?: unknown;
  musicSubmission?: unknown;
  voiceDesignSubmission?: unknown;
  ttsSubmission?: unknown;
  audioTaskType?: unknown;
  voiceId?: string;
  audio?: string;
  localAudio?: string;
  assetId?: string;
  voiceTrialAudioAvailable?: boolean;
  audioMode?: string;
};

/**
 * Restore editable history without rewinding live generation state.
 *
 * Removing a live node is intentional: the caller's document transaction
 * will stop that node's request before the snapshot is committed. We only
 * reject a history step that reuses the same id with a different node type;
 * that would otherwise let an in-flight prompt request write into a new
 * non-prompt node.
 */
export function reconcileHistoryNodes<T extends HistoryNode>(
  snapshot: readonly T[],
  current: readonly T[],
  activeIds: ReadonlySet<string>,
): T[] | null {
  const currentById = new Map(current.map((node) => [node.id, node]));
  const snapshotById = new Map(snapshot.map((node) => [node.id, node]));

  for (const id of activeIds) {
    const next = snapshotById.get(id);
    if (next && currentById.get(id)?.type === "prompt" && next.type !== "prompt") {
      return null;
    }
  }

  return snapshot.map((node) => {
    const live = currentById.get(node.id);
    if (node.type !== "prompt" || live?.type !== "prompt") return { ...node };

    return {
      ...node,
      // Explicit undefined values also replace snapshot fields: cleared tasks stay cleared.
      taskId: live.taskId,
      status: live.status,
      taskPrompt: live.taskPrompt,
      ...('taskDiagnostic' in live || 'taskDiagnostic' in node ? { taskDiagnostic: live.taskDiagnostic } : {}),
      inputSignature: live.inputSignature,
      error: live.error,
      submission: live.submission,
      ...('videoSubmission' in live || 'videoSubmission' in node ? { videoSubmission: live.videoSubmission } : {}),
      ...('musicSubmission' in live || 'musicSubmission' in node ? { musicSubmission: live.musicSubmission } : {}),
      ...('voiceDesignSubmission' in live || 'voiceDesignSubmission' in node ? { voiceDesignSubmission: live.voiceDesignSubmission } : {}),
      ...('ttsSubmission' in live || 'ttsSubmission' in node ? { ttsSubmission: live.ttsSubmission } : {}),
      ...('audioTaskType' in live || 'audioTaskType' in node ? { audioTaskType: live.audioTaskType } : {}),
      ...('voiceId' in live || 'voiceId' in node ? { voiceId: live.voiceId } : {}),
      ...('audio' in live || 'audio' in node ? { audio: live.audio } : {}),
      ...('localAudio' in live || 'localAudio' in node ? { localAudio: live.localAudio } : {}),
      ...('assetId' in live || 'assetId' in node ? { assetId: live.assetId } : {}),
      ...('voiceTrialAudioAvailable' in live || 'voiceTrialAudioAvailable' in node ? { voiceTrialAudioAvailable: live.voiceTrialAudioAvailable } : {}),
      ...((activeIds.has(node.id) || ["running", "queued"].includes(live.status || "")) && ('audioMode' in live || 'audioMode' in node) ? { audioMode: live.audioMode } : {}),
    };
  });
}

type GeometryNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Roll back a gesture without replacing edits or generation results received during it. */
export function restoreGeometry<T extends GeometryNode>(
  current: readonly T[],
  before: readonly T[],
  ids: readonly string[],
  kind: "move" | "resize",
): T[] {
  const targets = new Set(ids);
  const previousById = new Map(before.map((node) => [node.id, node]));
  return current.map((node) => {
    const previous = targets.has(node.id)
      ? previousById.get(node.id)
      : undefined;
    if (!previous) return { ...node };
    return kind === "move"
      ? { ...node, x: previous.x, y: previous.y }
      : { ...node, width: previous.width, height: previous.height };
  });
}
