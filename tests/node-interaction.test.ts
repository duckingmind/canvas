import assert from "node:assert/strict";
import test from "node:test";
import {
  getNodeInteraction,
  getNodeVisualType,
  hasPendingNodeTask,
  nodeHasMediaContent,
  canUseNodePortSide,
} from "../src/node-interaction.ts";

const node = (type: "note" | "prompt" | "image" | "video" | "audio", extra = {}) => ({
  type,
  ...extra,
});

test("note has the common editable workflow interaction", () => {
  const policy = getNodeInteraction(node("note"));
  assert.equal(policy.canEdit, true);
  assert.equal(policy.canReceiveConnection, true);
  assert.equal(policy.canStartConnection, true);
  assert.equal(policy.primaryAction, "edit");
  assert.equal(policy.doubleClickAction, "edit");
});

test("unfinished prompt opens creator and accepts inputs", () => {
  const policy = getNodeInteraction(node("prompt"));
  assert.equal(policy.canEdit, true);
  assert.equal(policy.canReceiveConnection, true);
  assert.equal(policy.primaryAction, "create");
  assert.equal(policy.visualType, "prompt");
});

test("completed prompt behaves as its media result", () => {
  const policy = getNodeInteraction(node("prompt", { image: "data:image/png" }));
  assert.equal(policy.completedMedia, true);
  assert.equal(policy.visualType, "image");
  assert.equal(policy.canPreview, true);
  assert.equal(policy.canReceiveConnection, false);
  assert.equal(policy.primaryAction, "preview");
  assert.equal(getNodeVisualType(node("prompt", { mediaType: "video" }), { hasMediaContent: true }), "video");
});

test("output-only media nodes expose a magnetic port on either outside side", () => {
  const policy = getNodeInteraction(node("image", { image: "https://cdn.test/image.png" }));
  assert.equal(canUseNodePortSide(policy, "left", "left", "right"), true);
  assert.equal(canUseNodePortSide(policy, "right", "left", "right"), true);
  const prompt = getNodeInteraction(node("prompt"));
  assert.equal(canUseNodePortSide(prompt, "left", "left", "right"), true);
  assert.equal(canUseNodePortSide(prompt, "right", "left", "right"), true);
});

test("image and video are previewable output values and cannot receive input", () => {
  const values = [
    node("image", { image: "https://cdn.test/image.png" }),
    node("video", { videoContentUrl: "https://cdn.test/video.mp4" }),
  ];
  for (const value of values) {
    const policy = getNodeInteraction(value);
    assert.equal(policy.canEdit, false);
    assert.equal(policy.canPreview, true);
    assert.equal(policy.canReceiveConnection, false);
    assert.equal(policy.canStartConnection, true);
    assert.equal(policy.primaryAction, "preview");
  }
});

test("empty image placeholders offer upload instead of a dead preview action", () => {
  const policy = getNodeInteraction(node("image"));
  assert.equal(policy.canPreview, false);
  assert.equal(policy.canUpload, true);
  assert.equal(policy.primaryAction, "upload");
  assert.equal(policy.doubleClickAction, "upload");
  assert.equal(policy.canReceiveConnection, false);
  assert.equal(policy.canStartConnection, false);
});

test("video values only become previewable after content is available", () => {
  const empty = getNodeInteraction(node("video"));
  assert.equal(empty.canPreview, false);
  assert.equal(empty.primaryAction, "none");
  assert.equal(empty.canStartConnection, false);
  const loaded = getNodeInteraction(node("video", { videoContentUrl: "/videos/task/content" }));
  assert.equal(loaded.canPreview, true);
  assert.equal(loaded.primaryAction, "preview");
  assert.equal(loaded.canStartConnection, true);
});

test("audio values are previewable and expose a reference output", () => {
  const empty = getNodeInteraction(node("audio"));
  assert.equal(empty.canUpload, true);
  assert.equal(empty.primaryAction, "upload");
  const loaded = getNodeInteraction(node("audio", { audio: "data:audio/mpeg;base64,abc" }));
  assert.equal(loaded.canPreview, true);
  assert.equal(loaded.primaryAction, "preview");
  assert.equal(loaded.canStartConnection, true);
});

test("pending tasks use task action consistently across node kinds", () => {
  for (const type of ["prompt", "image", "video"] as const) {
    assert.equal(getNodeInteraction(node(type), { hasPendingTask: true }).primaryAction, "task");
  }
  assert.equal(getNodeInteraction(node("prompt", { taskId: "task-1" })).doubleClickAction, "task");
});

test("workflow nodes keep connection ports available for branching", () => {
  const note = getNodeInteraction(node("note"));
  const prompt = getNodeInteraction(node("prompt"));
  assert.equal(note.canStartConnection, true);
  assert.equal(note.canReceiveConnection, true);
  assert.equal(prompt.canStartConnection, true);
  assert.equal(prompt.canReceiveConnection, true);
});

test("pending task detection uses active status and supports legacy video ids", () => {
  assert.equal(hasPendingNodeTask(node("prompt", { taskId: "task", status: "running" })), true);
  assert.equal(hasPendingNodeTask(node("prompt", { taskId: "task", status: "completed" })), false);
  assert.equal(hasPendingNodeTask(node("prompt", { videoTaskId: "video-task", status: "queued" })), true);
});

test("reconciliation keeps the original task pending and blocks duplicate generation", () => {
  assert.equal(hasPendingNodeTask(node("prompt", {
    taskId: "ambiguous-task",
    status: "queued",
    videoPollingReason: "reconciliation",
    taskDiagnostic: { status: "unknown", code: "creation_result_unknown" },
  })), true);
  assert.equal(hasPendingNodeTask(node("prompt", {
    taskId: "ambiguous-task",
    status: "queued",
    taskDiagnostic: { code: "VIDEO_TASK_UNKNOWN" },
  })), true);
});

test("persisted unknown states resume observation without replaying terminal tasks", () => {
  assert.equal(hasPendingNodeTask(node("prompt", {
    taskId: "ambiguous-task",
    status: "unknown",
    taskDiagnostic: { status: "unknown", code: "creation_result_unknown" },
  })), true);
  assert.equal(hasPendingNodeTask(node("prompt", {
    taskId: "ambiguous-task",
    status: "reconciling",
    taskDiagnostic: { code: "image_task_read_failed" },
  })), true);
  assert.equal(hasPendingNodeTask(node("prompt", {
    taskId: "expired-task",
    status: "failed",
    taskDiagnostic: { status: "failed", code: "unknown_resolution_expired" },
  })), false);
  assert.equal(hasPendingNodeTask(node("prompt", {
    taskId: "ambiguous-failed-task",
    status: "failed",
    taskDiagnostic: { status: "failed", code: "creation_result_unknown" },
  })), true);
});

test("persisted active lifecycle states continue polling after reload", () => {
  for (const status of ["accepted", "dispatching", "collecting", "cancel_requested", "cancel_pending"]) {
    assert.equal(hasPendingNodeTask(node("prompt", { taskId: `task-${status}`, status })), true, status);
  }
});

test("manual reconciliation remains observable but a closed window never auto-resumes", () => {
  const manual = node("prompt", { taskId: "manual-task", status: "failed", taskDiagnostic: { status: "failed", code: "provider_lookup_unsupported" } });
  assert.equal(hasPendingNodeTask(manual), true);
  assert.equal(getNodeInteraction(manual).primaryAction, "task");
  assert.equal(hasPendingNodeTask({ ...manual, taskDiagnostic: { status: "failed", code: "unknown_resolution_expired" } }), false);
  assert.equal(hasPendingNodeTask({ ...manual, taskDiagnostic: { status: "failed", code: "unknown_reconciled" } }), false);
});

test("explicitly completed task metadata wins over a retained task id", () => {
  const policy = getNodeInteraction(
    node("prompt", { taskId: "task-1", image: "https://cdn.test/result.png" }),
    { hasMediaContent: true, hasPendingTask: false },
  );
  assert.equal(policy.completedMedia, true);
  assert.equal(policy.primaryAction, "preview");
  assert.equal(policy.doubleClickAction, "preview");
});

test("node policy respects terminal status when no lifecycle context is passed", () => {
  const policy = getNodeInteraction(node("prompt", {
    taskId: "task-1",
    status: "completed",
    image: "https://cdn.test/result.png",
  }));
  assert.equal(policy.primaryAction, "preview");
});

test("a prompt with separate generated outputs is previewable", () => {
  const policy = getNodeInteraction(node("prompt"), {
    hasGeneratedResult: true,
    hasPendingTask: false,
  });
  assert.equal(policy.canPreview, true);
  assert.equal(policy.primaryAction, "preview");
  assert.equal(policy.canReceiveConnection, true);
});

test("media detection accepts prompt image/video fields and audio nodes", () => {
  assert.equal(nodeHasMediaContent(node("prompt", { image: "x" })), true);
  assert.equal(nodeHasMediaContent(node("prompt", { videoContentUrl: "x" })), true);
  assert.equal(nodeHasMediaContent(node("note", { image: "x" })), false);
  assert.equal(nodeHasMediaContent(node("audio", { audio: "x" })), true);
});

test("explicit interaction context overrides stale persisted media", () => {
  const policy = getNodeInteraction(
    node("prompt", { image: "https://cdn.test/old-result.png" }),
    { hasMediaContent: false },
  );
  assert.equal(policy.completedMedia, false);
  assert.equal(policy.visualType, "prompt");
  assert.equal(policy.canPreview, false);
  assert.equal(policy.primaryAction, "create");
});

test("prompt video results use the declared media type for visual rendering", () => {
  const policy = getNodeInteraction(
    node("prompt", { mediaType: "video", videoContentUrl: "https://cdn.test/result.mp4" }),
  );
  assert.equal(policy.completedMedia, true);
  assert.equal(policy.visualType, "video");
  assert.equal(policy.primaryAction, "preview");
});
