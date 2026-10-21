import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasNotificationGate } from "../src/canvas-notifications.ts";

const enabled = { notifyGeneration: true, notifyFailure: true };
const completed = {
  canvasId: "canvas-a", nodeId: "node-a", title: "产品图片", outcome: "completed" as const,
  taskId: "task-a", submissionKey: "submission-a",
};

test("completion is emitted once across provider and original submission identities", () => {
  const gate = createCanvasNotificationGate();
  assert.deepEqual(gate.generation(completed, enabled), { kind: "generation", text: "「产品图片」生成完成。" });
  assert.equal(gate.generation({ ...completed, submissionKey: undefined }, enabled), null);
  assert.equal(gate.generation({ ...completed, taskId: undefined }, enabled), null);
});

test("a newly learned task alias also deduplicates later recovery", () => {
  const gate = createCanvasNotificationGate();
  assert.ok(gate.generation({ ...completed, taskId: undefined }, enabled));
  assert.equal(gate.generation(completed, enabled), null);
  assert.equal(gate.generation({ ...completed, submissionKey: undefined }, enabled), null);
});

test("muted results are consumed and not replayed when the option is enabled", () => {
  const gate = createCanvasNotificationGate();
  assert.equal(gate.generation(completed, { ...enabled, notifyGeneration: false }), null);
  assert.equal(gate.generation(completed, enabled), null);
  const failed = { ...completed, outcome: "failed" as const };
  assert.equal(gate.generation(failed, { ...enabled, notifyFailure: false }), null);
  assert.equal(gate.generation(failed, enabled), null);
});

test("new submissions on a reused node and tasks on another canvas still notify", () => {
  const gate = createCanvasNotificationGate();
  assert.ok(gate.generation(completed, enabled));
  assert.ok(gate.generation({ ...completed, taskId: "task-b", submissionKey: "submission-b" }, enabled));
  assert.ok(gate.generation({ ...completed, canvasId: "canvas-b" }, enabled));
});

test("failure preference is independent and can preserve the actionable failure text", () => {
  const gate = createCanvasNotificationGate();
  assert.deepEqual(gate.generation({
    ...completed, outcome: "failed", failureText: "「产品图片」生成失败：媒体空间已用完。",
  }, { ...enabled, notifyGeneration: false }), {
    kind: "failure", text: "「产品图片」生成失败：媒体空间已用完。",
  });
  assert.ok(gate.generation(completed, { ...enabled, notifyFailure: false }));
});

test("completion is suppressed when the result is already selected in the current view", () => {
  const gate = createCanvasNotificationGate();
  assert.equal(gate.generation(completed, enabled, { userViewingResult: true }), null);
  assert.ok(gate.generation({ ...completed, taskId: "task-b", submissionKey: "submission-b" }, enabled, { userViewingResult: false }));
});

test("unbound loaded nodes never count as new generation operations", () => {
  const gate = createCanvasNotificationGate();
  assert.equal(gate.generation({ ...completed, taskId: undefined, submissionKey: undefined }, enabled), null);
  // The same node can later finish a real request or background recovery.
  assert.ok(gate.generation(completed, enabled));
});

