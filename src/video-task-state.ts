import type { CanvasNode } from "./canvas-types";
import { videoTaskPhase, type VideoTaskSnapshot } from "./video-generation.ts";
import { mediaTaskPublicLabel, mediaTaskPublicState, mediaTaskState, type MediaTaskStateInput } from "./shared/media-task-state.ts";
import { hasRecoverableVideoIdentity } from "./video-node-media.ts";

type TaskNode = Omit<Pick<CanvasNode, "type" | "mediaType" | "taskId" | "assetId" | "video" | "localVideo" | "videoContentUrl" | "videoPollingPaused" | "videoPollingReason" | "taskDiagnostic">, "type"> & {
  /** TaskDetails uses a redacted task shape without the persisted node type. */
  type?: CanvasNode["type"];
  status?: string;
  // Keep this view structural: CreatorPanel passes a deliberately redacted
  // node that only retains the stable recovery key.
  submission?: { key?: string };
  videoSubmission?: { key?: string };
  musicSubmission?: { key?: string };
  voiceDesignSubmission?: { key?: string };
  ttsSubmission?: { key?: string };
};
const isVideo = (node: TaskNode) => node.type === "video" || node.mediaType === "video";

export type CanvasTaskState = "idle" | "queued" | "running" | "unknown" | "reconciliation" | "no_task_id" | "action_required" | "failed" | "completed";

const submissionLookupMissCodes = new Set([
  "image_submission_not_found",
  "video_submission_not_found",
  "music_submission_not_found",
  "voice_design_submission_not_found",
]);

/** A lookup miss is unresolved, but automatic recovery has nothing useful to retry. */
export function isSubmissionLookupMiss(node: Pick<TaskNode, "taskDiagnostic">): boolean {
  return submissionLookupMissCodes.has(token(node.taskDiagnostic?.code));
}

/** The explicit retry button is only offered when the frozen request can be replayed intact. */
export function canRetryMissedSubmission(node: {
  taskId?: string;
  taskDiagnostic?: CanvasNode["taskDiagnostic"];
  submission?: { key?: string };
  videoSubmission?: { key?: string };
  musicSubmission?: { key?: string };
  voiceDesignSubmission?: { key?: string };
}): boolean {
  if (node.taskId || !isSubmissionLookupMiss(node)) return false;
  const code = token(node.taskDiagnostic?.code);
  if (code === "image_submission_not_found") return Boolean(node.submission?.key);
  if (code === "video_submission_not_found") return Boolean(node.videoSubmission?.key);
  if (code === "music_submission_not_found") return Boolean(node.musicSubmission?.key);
  return Boolean(node.voiceDesignSubmission?.key);
}

/** Clear only the local lookup-miss marker after the user explicitly starts replaying it. */
export function submissionRetryStartedDiagnostic(node: Pick<TaskNode, "taskDiagnostic">): CanvasNode["taskDiagnostic"] {
  if (!isSubmissionLookupMiss(node)) return node.taskDiagnostic;
  return { ...node.taskDiagnostic, code: undefined, status: "running", phase: "submitting" };
}

function token(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function lifecycleInput(node: TaskNode): MediaTaskStateInput {
  return {
    status: node.taskDiagnostic?.status || node.status,
    code: node.taskDiagnostic?.code,
    phase: node.taskDiagnostic?.phase || (node.videoPollingReason === "reconciliation" ? "reconciling" : undefined),
    assetStatus: node.taskDiagnostic?.assetStatus,
    supplierConfirmationState: node.taskDiagnostic?.supplierConfirmation?.state,
  };
}

/**
 * Resolve the state shown by Canvas. A queued status with an unknown
 * diagnostic is a reconciliation state, not evidence that the provider is
 * still generating. Keeping this decision in one place prevents cards,
 * drawers and context actions from drifting apart.
 */
export function canvasTaskState(node: TaskNode, active = false): CanvasTaskState {
  const status = token(node.status);
  const observedStatus = token(node.taskDiagnostic?.status);
  const code = token(node.taskDiagnostic?.code);
  const input = lifecycleInput(node);
  const lifecycle = mediaTaskState(input);
  const publicState = mediaTaskPublicState(input);
  const unknown = observedStatus === "unknown" || code === "creation_result_unknown" || code === "video_task_unknown" ||
    ["unconfirmed", "unconfirmed_after_timeout"].includes(token(node.taskDiagnostic?.supplierConfirmation?.state));

  if (status === "completed") return "completed";
  if (lifecycle.isTerminal) return publicState === "succeeded" ? "completed" : "failed";
  if (isSubmissionLookupMiss(node)) return "action_required";
  if (lifecycle.requiresReconciliation) return unknown ? "unknown" : "reconciliation";
  if (publicState === "failed") return "failed";
  if ((status === "running" || status === "queued" || active) && !node.taskId) return "no_task_id";
  if (publicState === "running") return "running";
  if (status === "queued" || observedStatus && publicState === "queued") return "queued";
  return "idle";
}

export type CanvasTaskRetryPolicy = {
  /** Permission to retry an existing durable task, not permission to create an idle node. */
  canRetry: boolean;
  /** Also guards a new POST after the original task's reconciliation window closed. */
  requiresConfirmation: boolean;
  reason?: "reconciliation_pending" | "reconciliation_expired";
};

export function canvasTaskRetryPolicy(node: TaskNode): CanvasTaskRetryPolicy {
  if (node.status === "completed") return { canRetry: false, requiresConfirmation: false };
  const lifecycle = mediaTaskState(lifecycleInput(node));
  const requiresConfirmation = lifecycle.requiresReconciliation;
  return {
    canRetry: lifecycle.canRetry,
    requiresConfirmation,
    ...(requiresConfirmation ? {
      reason: lifecycle.code === "unknown_resolution_expired" || lifecycle.status === "unknown_resolution_expired"
        ? "reconciliation_expired" as const : "reconciliation_pending" as const,
    } : {}),
  };
}

/**
 * A reconciliation guard applies to the original request, not every future
 * edit. Once an unknown-result window is closed, changed inputs represent a
 * new user intent and may create a new task with a fresh idempotency key. An
 * active unknown request remains blocked until its supplier outcome is known.
 */
export function canCreateNewCanvasTask(node: TaskNode, inputChanged = false): boolean {
  const policy = canvasTaskRetryPolicy(node);
  if (!policy.requiresConfirmation) return true;
  return policy.reason === "reconciliation_expired" && inputChanged;
}

/** Observation is not evidence that a provider is generating a video. */
export function isVideoResultUnconfirmed(node: TaskNode): boolean {
  if (!isVideo(node) || node.status === "completed") return false;
  const lifecycle = mediaTaskState(lifecycleInput(node));
  return lifecycle.requiresReconciliation && !lifecycle.isTerminal;
}

export type VideoTaskControls = {
  /** Local polling can be paused only after the provider result is known enough to observe safely. */
  canPause: boolean;
  /** Cancellation is withheld while the create result still needs reconciliation. */
  canCancel: boolean;
};

/**
 * Gate destructive/observer controls on the internal lifecycle, not only the
 * public "生成中" label. Cancellation is a queue operation: once execution
 * starts, the platform rejects it with a conflict and does not call upstream.
 * An unknown create result also stays under reconciliation and never exposes
 * a destructive control.
 */
export function videoTaskControls(node: TaskNode, active = false): VideoTaskControls {
  const input = lifecycleInput(node);
  const lifecycle = mediaTaskState(input);
  const publicState = mediaTaskPublicState(input);
  const resultUnknown = !lifecycle.isTerminal && lifecycle.requiresReconciliation;
  const canObserve = isVideo(node) && Boolean(node.taskId) && (publicState === "queued" || publicState === "running") && !lifecycle.isTerminal && !resultUnknown;
  return { canPause: canObserve && active, canCancel: canObserve && publicState === "queued" };
}

export function isTaskCancelled(node: TaskNode): boolean {
  return node.status === "failed" && ["cancelled", "canceled"].includes(node.taskDiagnostic?.status || "");
}

export function pendingTaskLabel(node: TaskNode, active = false): string {
  if (isSubmissionLookupMiss(node)) return "需要操作";
  const publicState = mediaTaskPublicState(lifecycleInput(node));
  // Keep a single four-state vocabulary on every Canvas surface. The
  // underlying canvas state still distinguishes unknown/reconciliation for
  // recovery and retry guards; this function is display-only.
  return mediaTaskPublicLabel(publicState);
}

/** A task id alone never authorizes a player/cover download. */
export function canLoadVideoContent(node: TaskNode): boolean {
  if (!isVideo(node) || !["", "idle", "completed"].includes(node.status || "")) return false;
  return Boolean(node.video || node.videoContentUrl || hasRecoverableVideoIdentity(node));
}

/** Merge a fresh server observation, ignoring results from an older task. */
export function videoTaskSnapshotPatch(node: CanvasNode, snapshot: VideoTaskSnapshot): Partial<CanvasNode> {
  if (node.taskId !== snapshot.taskId) return {};
  const phase = videoTaskPhase(snapshot.status, {
    code: snapshot.code, phase: snapshot.phase, assetStatus: snapshot.assetStatus,
    supplierConfirmationState: snapshot.supplierConfirmation?.state,
  });
  const unconfirmed = phase === "unknown";
  const patch: Partial<CanvasNode> = {
    status: unconfirmed ? "queued" : phase,
    error: snapshot.message || undefined,
    videoPollingPaused: unconfirmed,
    videoPollingReason: unconfirmed ? "reconciliation" : undefined,
    taskDiagnostic: {
      ...node.taskDiagnostic,
      status: snapshot.status || "unknown",
      phase: snapshot.phase,
      assetStatus: snapshot.assetStatus,
      code: snapshot.code || undefined,
      requestId: snapshot.requestId || node.taskDiagnostic?.requestId,
      // Each response is a complete observation. Retaining a former unknown
      // supplier state after a confirmed failure would block retry forever.
      supplierConfirmation: snapshot.supplierConfirmation,
    },
  };
  if (phase === "completed") {
    if (snapshot.assetId) patch.assetId = snapshot.assetId;
    if (snapshot.contentUrl) {
      patch.videoContentUrl = snapshot.contentUrl;
      patch.videoContentUrlExpiresAt = snapshot.contentUrlExpiresAt;
    }
  }
  // Repeated observations must not create new document revisions or saves.
  return Object.keys(patch).some((key) =>
    JSON.stringify(node[key as keyof CanvasNode]) !== JSON.stringify(patch[key as keyof CanvasNode]),
  ) ? patch : {};
}
