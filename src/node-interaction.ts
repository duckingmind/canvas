/**
 * Pure interaction policy for canvas nodes.
 *
 * CanvasNode is intentionally structural here so this module does not depend
 * on React or the persistence shape in App.tsx.  Keeping the policy pure makes
 * it usable by rendering, pointer handlers and tests without duplicating the
 * prompt/media rules in each caller.
 */

import { mediaTaskState } from "./shared/media-task-state.ts";
import { hasRecoverableVideoIdentity } from "./video-node-media.ts";
import { hasRecoverableAudioIdentity } from "./audio-source.ts";

export type NodeKind = "note" | "prompt" | "image" | "video" | "audio";
export type VisualNodeType = NodeKind;
export type PrimaryAction = "edit" | "create" | "preview" | "task" | "upload" | "none";

export type InteractionNode = {
  type: NodeKind;
  mediaType?: "image" | "video" | "audio";
  image?: unknown;
  video?: unknown;
  localVideo?: string;
  videoContentUrl?: unknown;
  audio?: unknown;
  localAudio?: string;
  voiceTrialAudioAvailable?: boolean;
  taskId?: string;
  assetId?: string;
  videoTaskId?: string;
  status?: string;
  submission?: unknown;
  videoSubmission?: unknown;
  musicSubmission?: unknown;
  voiceDesignSubmission?: unknown;
  ttsSubmission?: unknown;
  videoPollingReason?: "user" | "reconciliation";
  taskDiagnostic?: {
    status?: string;
    code?: string;
    phase?: string;
    assetStatus?: string;
    supplierConfirmation?: { state?: string };
  };
  error?: string;
};

export type NodeInteractionContext = {
  /** Set when the node itself contains an image/video result. */
  hasMediaContent?: boolean;
  /** Set when generated result nodes exist for a prompt. */
  hasGeneratedResult?: boolean;
  /** A task is currently running or resumable for this node. */
  hasPendingTask?: boolean;
};

export type NodeInteraction = {
  kind: NodeKind;
  completedMedia: boolean;
  visualType: VisualNodeType;
  canEdit: boolean;
  canPreview: boolean;
  canUpload: boolean;
  canReceiveConnection: boolean;
  canStartConnection: boolean;
  showToolbar: boolean;
  primaryAction: PrimaryAction;
  doubleClickAction: PrimaryAction;
};

export type PortSide = "left" | "right";

/**
 * Resolve whether a node can expose an actionable port on a side. Value
 * nodes (media-only outputs) may emit toward either side; editable workflow
 * nodes retain their directional input/output ports. Keeping this rule shared
 * prevents magnetic hit testing and rendered handles from disagreeing.
 */
export function canUseNodePortSide(
  interaction: Pick<NodeInteraction, "canReceiveConnection" | "canStartConnection">,
  side: PortSide,
  inputSide: PortSide,
  outputSide: PortSide,
): boolean {
  const outputOnly = interaction.canStartConnection && !interaction.canReceiveConnection;
  return (interaction.canReceiveConnection && side === inputSide) ||
    (interaction.canStartConnection && (outputOnly || side === outputSide));
}

// Keep this list aligned with the media task lifecycle. These states mean the
// durable task still exists and must be observed after a page reload; they do
// not authorize a new creation request.
const activeTaskStatuses = new Set([
  "created",
  "quoted",
  "funds_reserved",
  "accepted",
  "dispatching",
  "collecting",
  "cancel_requested",
  "cancel_pending",
  "running",
  "queued",
  "pending",
  "submitted",
  "in_progress",
]);

const normalizeTaskToken = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * A task is resumable while the server-side state is active or unresolved.
 * Terminal failures (including an expired reconciliation window) must not be
 * picked up by the automatic restore loop.
 */
export function hasPendingNodeTask(node: InteractionNode): boolean {
  const status = normalizeTaskToken(node.status);
  const diagnosticStatus = normalizeTaskToken(node.taskDiagnostic?.status);
  const code = normalizeTaskToken(node.taskDiagnostic?.code);
  const hasIdentity = Boolean(node.taskId || node.videoTaskId || node.submission || node.videoSubmission || node.musicSubmission || node.voiceDesignSubmission || node.ttsSubmission);
  const lifecycle = mediaTaskState({
    status: diagnosticStatus || status,
    code,
    phase: node.taskDiagnostic?.phase || (node.videoPollingReason === "reconciliation" ? "reconciling" : undefined),
    assetStatus: node.taskDiagnostic?.assetStatus,
    supplierConfirmationState: node.taskDiagnostic?.supplierConfirmation?.state,
  });
  // A durable failed row can still represent an unconfirmed provider
  // submission. Keep observing it until reconciliation makes the outcome
  // terminal; otherwise a reload would expose a duplicate-submit action.
  if (!hasIdentity || status === "completed" || lifecycle.isTerminal) return false;
  return activeTaskStatuses.has(status) || activeTaskStatuses.has(diagnosticStatus) ||
    ["unknown", "reconciliation", "reconciling"].includes(status) ||
    ["unknown", "reconciliation", "reconciling"].includes(diagnosticStatus) ||
    lifecycle.requiresReconciliation && !lifecycle.isTerminal;
}

export function nodeHasMediaContent(node: InteractionNode): boolean {
  return Boolean(
    (node.type === "image" || node.type === "prompt") && node.image ||
    (node.type === "video" || node.type === "prompt") &&
        (node.video || node.localVideo || node.videoContentUrl) || hasRecoverableVideoIdentity(node) ||
    (node.type === "audio" || node.type === "prompt" && node.mediaType === "audio") && node.audio || hasRecoverableAudioIdentity(node),
  );
}

export function isCompletedMediaNode(
  node: InteractionNode,
  context: NodeInteractionContext = {},
): boolean {
  return node.type === "prompt" &&
    Boolean(context.hasMediaContent ?? nodeHasMediaContent(node));
}

export function getNodeVisualType(
  node: InteractionNode,
  context: NodeInteractionContext = {},
): VisualNodeType {
  if (!isCompletedMediaNode(node, context)) return node.type;
  return node.mediaType === "video" ? "video" : node.mediaType === "audio" ? "audio" : "image";
}

export function getNodeInteraction(
  node: InteractionNode,
  context: NodeInteractionContext = {},
): NodeInteraction {
  const completedMedia = isCompletedMediaNode(node, context);
  // `image`/`video` nodes are values, so their preview action is only valid
  // once they actually contain media. Empty image placeholders are upload
  // targets and must not render a dead preview button.
  const hasOwnMedia = nodeHasMediaContent(node);
  const hasMedia = completedMedia ||
    (node.type === "image" || node.type === "video" || node.type === "audio") && hasOwnMedia ||
    Boolean(context.hasGeneratedResult);
  // The caller owns task lifecycle state.  `taskId` is retained after a
  // completed generation so the result can be reloaded, therefore it cannot
  // by itself make a node look pending. Use explicit context first, then the
  // persisted status when available; only old records without status use the
  // legacy taskId heuristic.
  const pending = context.hasPendingTask ?? (
    node.status
      ? hasPendingNodeTask(node)
      : Boolean(node.taskId)
  );
  const canEdit = node.type === "note" || node.type === "prompt";
  const canPreview = hasMedia;
  const canUpload = (node.type === "image" || node.type === "audio") && !hasOwnMedia;
  const canReceiveConnection = node.type === "note" ||
    (node.type === "prompt" && !completedMedia);
  // Workflow nodes can emit a request even before they have any media. An
  // image/video value cannot be a useful source until it has an actual value;
  // exposing its output port while empty creates edges that later fail during
  // prompt composition. Keep this decision beside the target-side rule so
  // rendering, hit testing and persistence all agree.
  const canStartConnection = node.type === "note" ||
    node.type === "prompt" ||
    hasMedia;
  const primaryAction: PrimaryAction = pending
    ? "task"
    : node.type === "note"
      ? "edit"
      : node.type === "prompt" && !completedMedia && !context.hasGeneratedResult
        ? "create"
        : canPreview
          ? "preview"
          : canUpload
            ? "upload"
            : "none";

  return {
    kind: node.type,
    completedMedia,
    visualType: getNodeVisualType(node, context),
    canEdit,
    canPreview,
    canUpload,
    canReceiveConnection,
    // Source and target rules are deliberately separate: a media value can
    // feed a workflow node, while an empty media placeholder cannot.
    canStartConnection,
    // Keep the basic toolbar available for every node; its primary action is
    // selected by the policy above rather than by ad-hoc type checks.
    showToolbar: true,
    primaryAction,
    doubleClickAction: primaryAction,
  };
}

export const canReceiveNodeConnection = (
  node: InteractionNode,
  context: NodeInteractionContext = {},
) => getNodeInteraction(node, context).canReceiveConnection;

export const canStartNodeConnection = (
  node: InteractionNode,
  context: NodeInteractionContext = {},
) => getNodeInteraction(node, context).canStartConnection;

export const getNodePrimaryAction = (
  node: InteractionNode,
  context: NodeInteractionContext = {},
) => getNodeInteraction(node, context).primaryAction;

export const getNodeDoubleClickAction = (
  node: InteractionNode,
  context: NodeInteractionContext = {},
) => getNodeInteraction(node, context).doubleClickAction;

export const shouldShowNodeToolbar = (
  node: InteractionNode,
  context: NodeInteractionContext = {},
) => getNodeInteraction(node, context).showToolbar;
