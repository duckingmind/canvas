/** Optional notices are emitted by completed operations, never by loading documents. */
export type CanvasNotificationPreferences = {
  notifyGeneration: boolean;
  notifyFailure: boolean;
};

export type CanvasNotification = {
  kind: "generation" | "failure";
  text: string;
};

export type GenerationNotificationEvent = {
  canvasId: string;
  nodeId: string;
  title: string;
  outcome: "completed" | "failed";
  /** Pass both identities when the provider has acknowledged a submission. */
  taskId?: string;
  submissionKey?: string;
  failureText?: string;
};

/**
 * One gate belongs to one mounted editor. Call generation only when an actual
 * request/recovery reaches a terminal result. In particular, do not call it
 * while hydrating a document, restoring media URLs, applying history, or autosaving.
 *
 * Preferences filter transient notices only. Inline task errors, save status,
 * and errors that require the user's action remain visible independently.
 */
export function createCanvasNotificationGate() {
  const consumed = new Set<string>();
  // Bound session memory even when an editor stays open for many days.
  const capacity = 2048;
  const consume = (keys: string[]) => {
    const duplicate = keys.some((key) => consumed.has(key));
    // Remember every alias even on a duplicate. A resumed request may only
    // have its provider task ID, while its first request had a submission key.
    for (const key of keys) {
      consumed.delete(key);
      consumed.add(key);
    }
    while (consumed.size > capacity) consumed.delete(consumed.values().next().value!);
    return !duplicate;
  };

  return {
    generation(
      event: GenerationNotificationEvent,
      preferences: CanvasNotificationPreferences,
      context?: { userViewingResult?: boolean },
    ): CanvasNotification | null {
      const keys = [
        event.taskId ? ["task", event.taskId] : null,
        event.submissionKey ? ["submission", event.submissionKey] : null,
      ].filter((identity) => identity !== null).map((identity) =>
        JSON.stringify(["generation", event.canvasId, event.nodeId, event.outcome, ...identity]),
      );
      // An unbound document node is not enough evidence of a new operation.
      if (!keys.length || !consume(keys)) return null;
      const failed = event.outcome === "failed";
      // Consume even while muted; enabling a preference must not replay old results.
      if (failed ? !preferences.notifyFailure : !preferences.notifyGeneration || context?.userViewingResult) return null;
      const title = event.title.trim() || "创作任务";
      return {
        kind: failed ? "failure" : "generation",
        text: failed
          ? event.failureText || `「${title}」生成失败，请修改输入后重试。`
          : `「${title}」生成完成。`,
      };
    },
  };
}
