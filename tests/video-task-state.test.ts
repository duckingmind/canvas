import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasNode } from "../src/canvas-types.ts";
import { canCreateNewCanvasTask, canLoadVideoContent, canvasTaskRetryPolicy, canvasTaskState, isTaskCancelled, isVideoResultUnconfirmed, pendingTaskLabel, videoTaskControls, videoTaskSnapshotPatch } from "../src/video-task-state.ts";
import { diagnoseMediaFailure } from "../src/shared/media-diagnostics.ts";

const node: CanvasNode = {
  id: "creator", type: "prompt", mediaType: "video", title: "视频创作", text: "test",
  x: 0, y: 0, width: 420, height: 260, color: "#ccc",
  taskId: "video-task", status: "running",
};
const unknown = {
  taskId: "video-task", status: "unknown", code: "creation_result_unknown",
  message: "upstream create returned a non-JSON response", contentUrl: "/videos/video-task/content",
};

test("pending, ambiguous and failed task ids never trigger video cover downloads", () => {
  for (const status of ["running", "queued", "failed"] as const) {
    assert.equal(canLoadVideoContent({ ...node, status }), false);
    assert.equal(canLoadVideoContent({ ...node, status, videoContentUrl: "/videos/old-task/content" }), false);
  }
  assert.equal(canLoadVideoContent({ ...node, status: "completed" }), true);
  assert.equal(canLoadVideoContent({ ...node, type: "video", taskId: undefined, status: undefined, video: "blob:imported" }), true);
  assert.equal(canLoadVideoContent({ ...node, status: undefined }), false);
  assert.equal(canLoadVideoContent({ ...node, type: "video", status: undefined, taskId: undefined, assetId: "video-asset" }), true);
});

test("completed snapshots retain delivered identity and URL lifetime without revising identical observations", () => {
  const snapshot = { ...unknown, status: "completed", code: "", message: "", assetId: "video-asset", contentUrl: "https://cdn.test/video.mp4?signature=ready", contentUrlExpiresAt: "2026-10-08T01:00:00Z" };
  const completed = { ...node, ...videoTaskSnapshotPatch(node, snapshot) };
  assert.equal(completed.assetId, "video-asset");
  assert.equal(completed.videoContentUrl, snapshot.contentUrl);
  assert.equal(completed.videoContentUrlExpiresAt, snapshot.contentUrlExpiresAt);
  assert.deepEqual(videoTaskSnapshotPatch(completed, snapshot), {});
});

test("legacy running nodes with unknown server diagnostics remain pending confirmation", () => {
  const ambiguous = { ...node, taskDiagnostic: { status: "unknown", code: "creation_result_unknown" } };
  assert.equal(isVideoResultUnconfirmed(ambiguous), true);
  assert.equal(canvasTaskState(ambiguous), "unknown");
  assert.equal(pendingTaskLabel(ambiguous), "生成中");
  assert.equal(pendingTaskLabel(node), "生成中");
  assert.equal(pendingTaskLabel({ ...node, status: "queued", videoPollingReason: "reconciliation" }), "生成中");
  assert.equal(isVideoResultUnconfirmed({ ...ambiguous, status: "completed" }), false);
  assert.equal(isVideoResultUnconfirmed({ ...ambiguous, status: "failed" }), true);
  assert.equal(canvasTaskState({ ...ambiguous, status: "failed" }), "unknown");
  assert.equal(canvasTaskState({ ...ambiguous, status: "failed", taskDiagnostic: { status: "failed", code: "unknown_resolution_expired" } }), "failed");
  const supplierUnknown = { ...node, status: "failed" as const, taskDiagnostic: {
    status: "failed", code: "unknown_resolution_expired",
    supplierConfirmation: { state: "unconfirmed_after_timeout", status: "unknown", source: "platform" },
  } };
  assert.equal(canvasTaskState(supplierUnknown), "failed");
  // The platform has explicitly closed the reconciliation window. The
  // supplier evidence remains diagnostic, but the public lifecycle is now a
  // terminal failure and must not keep the client polling indefinitely.
  assert.equal(pendingTaskLabel(supplierUnknown), "失败");
});

test("video task labels keep queued, generating and terminal failure distinct", () => {
  assert.equal(pendingTaskLabel({ ...node, status: "queued" }), "排队中");
  assert.equal(pendingTaskLabel({ ...node, status: "running" }), "生成中");
  assert.equal(pendingTaskLabel({
    ...node,
    status: "failed",
    taskDiagnostic: { status: "failed", code: "unknown_resolution_expired" },
  }), "失败");
});

test("video diagnostics distinguish active reconciliation from its terminal close", () => {
  const active = diagnoseMediaFailure({ status: "unknown", code: "creation_result_unknown" });
  assert.equal(active.title, "正在核对供应商结果");
  assert.match(active.advice, /请勿重复提交/);

  const expired = diagnoseMediaFailure({ status: "failed", code: "unknown_resolution_expired" });
  assert.equal(expired.title, "未能确认供应商结果");
  assert.match(expired.advice, /任务已关闭/);

  const manual = diagnoseMediaFailure({ status: "failed", code: "provider_lookup_unsupported" });
  assert.equal(manual.title, "需要人工核对供应商结果");
});

test("new submissions stay blocked after reconciliation closes until evidence resolves the original task", () => {
  const expired = { ...node, status: "failed" as const, taskDiagnostic: { status: "failed", code: "unknown_resolution_expired" } };
  assert.deepEqual(canvasTaskRetryPolicy(expired), { canRetry: false, requiresConfirmation: true, reason: "reconciliation_expired" });
  assert.equal(canCreateNewCanvasTask(expired), false);
  assert.equal(canCreateNewCanvasTask(expired, true), true);
  assert.equal(canCreateNewCanvasTask({ ...node, status: "unknown", taskDiagnostic: { status: "unknown", code: "creation_result_unknown" } }, true), false);
  assert.deepEqual(canvasTaskRetryPolicy({ ...expired, taskDiagnostic: { status: "failed", code: "unknown_reconciled" } }), { canRetry: true, requiresConfirmation: false });
  assert.equal(canCreateNewCanvasTask({ ...expired, taskDiagnostic: { status: "failed", code: "unknown_reconciled" } }), true);
  assert.deepEqual(canvasTaskRetryPolicy({ ...node, status: undefined, taskId: undefined }), { canRetry: false, requiresConfirmation: false });
});

test("missing lookup support stays unresolved across cards, controls and retry actions", () => {
  for (const status of ["unknown", "failed"]) {
    const manual = { ...node, status: "failed" as const, taskDiagnostic: { status, code: "provider_lookup_unsupported" } };
    assert.notEqual(canvasTaskState(manual), "failed");
    assert.equal(pendingTaskLabel(manual), "生成中");
    assert.deepEqual(canvasTaskRetryPolicy(manual), { canRetry: false, requiresConfirmation: true, reason: "reconciliation_pending" });
    assert.deepEqual(videoTaskControls(manual, true), { canPause: false, canCancel: false });
    assert.match(diagnoseMediaFailure(manual.taskDiagnostic).advice, /需由平台核对结果/);
  }
});

test("server phases and asset persistence keep queued and collecting states consistent", () => {
  const queued = { ...node, ...videoTaskSnapshotPatch(node, { ...unknown, status: "queued", code: "", phase: "queued" }) };
  assert.equal(canvasTaskState(queued), "queued");
  assert.equal(pendingTaskLabel(queued), "排队中");
  const collecting = { ...node, ...videoTaskSnapshotPatch(node, { ...unknown, status: "succeeded", code: "", phase: "collecting", assetStatus: "pending" }) };
  assert.equal(canvasTaskState(collecting), "running");
  assert.equal(pendingTaskLabel(collecting), "生成中");
  assert.equal(canLoadVideoContent(collecting), false);
});

test("a fresh terminal observation clears stale supplier ambiguity from a previous read", () => {
  const waiting = { ...node, taskDiagnostic: { status: "unknown", code: "creation_result_unknown", supplierConfirmation: { state: "unconfirmed" } } };
  const failed = { ...waiting, ...videoTaskSnapshotPatch(waiting, { ...unknown, status: "failed", code: "provider_rejected_request" }) };
  assert.equal(failed.taskDiagnostic?.supplierConfirmation, undefined);
  assert.equal(canvasTaskState(failed), "failed");
  assert.deepEqual(canvasTaskRetryPolicy(failed), { canRetry: true, requiresConfirmation: false });
});

test("a missing task id is shown as an unconfirmed submission", () => {
  const withSubmission = { ...node, taskId: undefined, status: "queued" as const, videoSubmission: { key: "submit-1" } as any };
  assert.equal(canvasTaskState(withSubmission), "no_task_id");
  assert.equal(pendingTaskLabel(withSubmission), "排队中");

  const withoutIdentity = { ...withSubmission, videoSubmission: undefined };
  assert.equal(canvasTaskState(withoutIdentity), "no_task_id");
  assert.equal(pendingTaskLabel(withoutIdentity), "排队中");
});

test("server observations replace stale running state and suppress duplicate revisions", () => {
  const original = { ...node, taskDiagnostic: { createdAt: "2026-09-19T13:25:14Z", summary: { duration: 4 } } };
  const waiting = { ...original, ...videoTaskSnapshotPatch(original, unknown) };
  assert.equal(waiting.status, "queued");
  assert.equal(waiting.videoPollingReason, "reconciliation");
  assert.equal(waiting.taskDiagnostic?.createdAt, original.taskDiagnostic.createdAt);
  assert.deepEqual(videoTaskSnapshotPatch(waiting, unknown), {});

  const resumed = { ...waiting, ...videoTaskSnapshotPatch(waiting, { ...unknown, status: "in_progress", code: "", message: "" }) };
  assert.equal(resumed.status, "running");
  assert.equal(isVideoResultUnconfirmed(resumed), false);
  assert.equal(resumed.videoPollingPaused, false);
  assert.equal(resumed.error, undefined);

  const failed = { ...waiting, ...videoTaskSnapshotPatch(waiting, { ...unknown, status: "failed", code: "unknown_resolution_expired" }) };
  assert.equal(failed.status, "failed");
  assert.equal(failed.videoPollingReason, undefined);
  assert.equal(canLoadVideoContent(failed), false);
});

test("a late content error cannot overwrite a replacement task", () => {
  assert.deepEqual(videoTaskSnapshotPatch({ ...node, taskId: "new-video-task" }, unknown), {});
});

test("cancellation stays pending until the server confirms its terminal result", () => {
  const cancelling = { ...node, ...videoTaskSnapshotPatch(node, { ...unknown, status: "cancel_pending", code: "", message: "" }) };
  assert.equal(cancelling.status, "running");
  assert.equal(pendingTaskLabel(cancelling, false), "生成中");
  assert.equal(isTaskCancelled(cancelling), false);
  assert.equal(canLoadVideoContent(cancelling), false);
  const cancelled = { ...cancelling, ...videoTaskSnapshotPatch(cancelling, { ...unknown, status: "cancelled" }) };
  assert.equal(cancelled.status, "failed");
  assert.equal(isTaskCancelled(cancelled), true);
  assert.equal(canLoadVideoContent(cancelled), false);
  const completed = { ...cancelling, ...videoTaskSnapshotPatch(cancelling, { ...unknown, status: "completed" }) };
  assert.equal(isTaskCancelled(completed), false);
  assert.equal(canLoadVideoContent(completed), true);
});

test("unknown or reconciliation tasks do not expose pause or cancel controls", () => {
  const unknownTask = {
    ...node,
    status: "queued" as const,
    videoPollingReason: "reconciliation" as const,
    taskDiagnostic: { status: "unknown", code: "creation_result_unknown" },
  };
  assert.deepEqual(videoTaskControls(unknownTask, true), { canPause: false, canCancel: false });
  assert.deepEqual(videoTaskControls(unknownTask, false), { canPause: false, canCancel: false });

  const supplierUnconfirmed = {
    ...node,
    status: "failed" as const,
    taskDiagnostic: { status: "failed", supplierConfirmation: { state: "unconfirmed_after_timeout" } },
  };
  assert.deepEqual(videoTaskControls(supplierUnconfirmed, true), { canPause: false, canCancel: false });

  const runningTask = { ...node, status: "running" as const };
  assert.deepEqual(videoTaskControls(runningTask, true), { canPause: true, canCancel: true });
  assert.deepEqual(videoTaskControls(runningTask, false), { canPause: false, canCancel: true });

  const staleCompleted = { ...runningTask, taskDiagnostic: { status: "completed" } };
  assert.deepEqual(videoTaskControls(staleCompleted, true), { canPause: false, canCancel: false });
});
