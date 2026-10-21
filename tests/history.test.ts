import assert from "node:assert/strict";
import test from "node:test";
import { reconcileHistoryNodes, restoreGeometry } from "../src/history.ts";

type Node = {
  id: string;
  type: string;
  text?: string;
  x?: number;
  y?: number;
  modelId?: string;
  image?: string;
  taskId?: string;
  status?: string;
  taskPrompt?: string;
  inputSignature?: string;
  error?: string;
  submission?: unknown;
};

test("undoing generated results keeps the prompt's completed task identity", () => {
  const snapshot: Node[] = [
    {
      id: "prompt",
      type: "prompt",
      status: "running",
      text: "城市夜景",
      inputSignature: "v1:1111111111111111",
    },
  ];
  const current: Node[] = [
    {
      id: "prompt",
      type: "prompt",
      status: "completed",
      taskId: "completed-task",
      taskPrompt: "城市夜景",
      inputSignature: "v1:2222222222222222",
      submission: { model: "image-model", images: [{ image: "reference" }] },
      text: "城市夜景",
    },
    { id: "result", type: "image", image: "https://example.com/result.png" },
  ];

  const restored = reconcileHistoryNodes(snapshot, current, new Set())!;
  assert.equal(restored.length, 1);
  assert.equal(restored[0].status, "completed");
  assert.equal(restored[0].taskId, "completed-task");
  assert.equal(restored[0].taskPrompt, "城市夜景");
  assert.equal(restored[0].inputSignature, "v1:2222222222222222");
  assert.deepEqual(restored[0].submission, current[0].submission);
});

test("history can remove an active node but cannot change its type in place", () => {
  const current: Node[] = [
    { id: "active", type: "prompt", taskId: "task", status: "running" },
    { id: "other", type: "note" },
  ];
  const activeIds = new Set(["active"]);

  assert.deepEqual(reconcileHistoryNodes([current[1]], current, activeIds), [current[1]]);
  assert.equal(
    reconcileHistoryNodes(
      [{ id: "active", type: "note" }, current[1]],
      current,
      activeIds,
    ),
    null,
  );
  assert.equal(
    reconcileHistoryNodes(
      [{ id: "active", type: "image" }],
      current,
      activeIds,
    ),
    null,
  );
  assert.ok(
    reconcileHistoryNodes(
      [{ id: "active", type: "prompt", text: "之前的提示词" }],
      current,
      activeIds,
    ),
  );
});

test("text, position and model undo while live task metadata survives", () => {
  const snapshot: Node[] = [
    {
      id: "prompt",
      type: "prompt",
      text: "之前的文字",
      x: -150,
      y: 280,
      modelId: "previous-model",
      taskId: "old-task",
      status: "completed",
      taskPrompt: "旧请求",
      inputSignature: "v1:1111111111111111",
      submission: { model: "old-model", images: [] },
    },
  ];
  const current: Node[] = [
    {
      id: "prompt",
      type: "prompt",
      text: "新的文字",
      x: 300,
      y: 50,
      modelId: "new-model",
      taskId: "latest-task",
      status: "failed",
      taskPrompt: "实际提交的请求",
      inputSignature: "v1:2222222222222222",
      error: "服务暂时不可用",
      submission: {
        model: "submitted-model",
        images: [{ image: "reference" }],
      },
    },
  ];

  assert.deepEqual(reconcileHistoryNodes(snapshot, current, new Set()), [
    {
      ...snapshot[0],
      taskId: "latest-task",
      status: "failed",
      taskPrompt: "实际提交的请求",
      inputSignature: "v1:2222222222222222",
      error: "服务暂时不可用",
      submission: current[0].submission,
    },
  ]);
});

test("cleared task fields cannot be resurrected by undo or redo", () => {
  const snapshot: Node[] = [
    {
      id: "prompt",
      type: "prompt",
      taskId: "discarded-task",
      status: "running",
      taskPrompt: "已放弃的请求",
      inputSignature: "v1:1111111111111111",
      error: "旧错误",
      submission: { model: "discarded-model", images: [] },
    },
  ];
  const current: Node[] = [{ id: "prompt", type: "prompt" }];
  const restored = reconcileHistoryNodes(snapshot, current, new Set())!;

  for (const key of [
    "taskId",
    "status",
    "taskPrompt",
    "inputSignature",
    "error",
    "submission",
  ] as const) {
    assert.equal(restored[0][key], undefined);
  }
  assert.deepEqual(restored[0], {
    id: "prompt",
    type: "prompt",
    taskId: undefined,
    status: undefined,
    taskPrompt: undefined,
    inputSignature: undefined,
    error: undefined,
    submission: undefined,
  });
});

test("other node types and restored missing nodes keep snapshot values", () => {
  const snapshot: Node[] = [
    { id: "image", type: "image", image: "old-image", status: "completed" },
    { id: "changed", type: "note", text: "原来的文本", status: "idle" },
    { id: "restored", type: "prompt", text: "恢复的节点" },
  ];
  const current: Node[] = [
    { id: "image", type: "image", image: "new-image", status: "failed" },
    { id: "changed", type: "prompt", taskId: "different-task" },
  ];

  assert.deepEqual(
    reconcileHistoryNodes(snapshot, current, new Set()),
    snapshot,
  );
});

test("reconciliation never mutates either input and returns independent node objects", () => {
  const snapshot = Object.freeze([
    Object.freeze<Node>({ id: "prompt", type: "prompt", text: "旧文字" }),
    Object.freeze<Node>({ id: "note", type: "note", text: "备注" }),
  ]);
  const current = Object.freeze([
    Object.freeze<Node>({ id: "prompt", type: "prompt", status: "completed" }),
  ]);
  const originalSnapshot = structuredClone(snapshot);
  const originalCurrent = structuredClone(current);
  const restored = reconcileHistoryNodes(snapshot, current, new Set())!;

  assert.deepEqual(snapshot, originalSnapshot);
  assert.deepEqual(current, originalCurrent);
  assert.notEqual(restored, snapshot);
  for (let index = 0; index < restored.length; index++) {
    assert.notEqual(restored[index], snapshot[index]);
  }
  assert.notEqual(restored[0], current[0]);
  assert.deepEqual(reconcileHistoryNodes([], [], new Set()), []);
});

test("rolling back a move retains asynchronous results, task state and current deletions", () => {
  const before = [
    {
      id: "prompt",
      x: 10,
      y: 20,
      width: 300,
      height: 180,
      status: "running",
      text: "原文",
    },
    { id: "deleted", x: 80, y: 90, width: 100, height: 100 },
  ];
  const current = [
    {
      id: "prompt",
      x: 210,
      y: 320,
      width: 330,
      height: 200,
      status: "completed",
      text: "编辑后的文字",
      taskId: "task-completed",
    },
    {
      id: "result",
      x: 700,
      y: 50,
      width: 400,
      height: 600,
      image: "generated-image",
    },
  ];
  const originalCurrent = structuredClone(current);
  const originalBefore = structuredClone(before);
  const restored = restoreGeometry(
    current,
    before,
    ["prompt", "deleted", "result"],
    "move",
  );

  assert.deepEqual(restored, [{ ...current[0], x: 10, y: 20 }, current[1]]);
  assert.equal(restored[0].status, "completed");
  assert.equal(restored[0].taskId, "task-completed");
  assert.equal(restored[1].image, "generated-image");
  assert.deepEqual(current, originalCurrent);
  assert.deepEqual(before, originalBefore);
  assert.notEqual(restored[0], current[0]);
});

test("geometry rollback restores only the selected gesture dimensions and target IDs", () => {
  const before = [
    { id: "target", x: 10, y: 20, width: 300, height: 180 },
    { id: "other", x: 50, y: 60, width: 200, height: 100 },
  ];
  const current = [
    { id: "target", x: 110, y: 220, width: 600, height: 360 },
    { id: "other", x: 150, y: 160, width: 400, height: 200 },
  ];

  assert.deepEqual(restoreGeometry(current, before, ["target"], "resize"), [
    { ...current[0], width: 300, height: 180 },
    current[1],
  ]);
  assert.deepEqual(restoreGeometry(current, before, ["target"], "move"), [
    { ...current[0], x: 10, y: 20 },
    current[1],
  ]);
});


test("history keeps current diagnosis and clears discarded diagnostic snapshots", () => {
  const snapshot = [{ id: "prompt", type: "prompt", taskDiagnostic: { requestId: "old" } }];
  const diagnostic = { requestId: "latest", summary: { reference_count: 2 } };
  const current = [{ id: "prompt", type: "prompt", taskDiagnostic: diagnostic }];
  assert.deepEqual(reconcileHistoryNodes(snapshot, current, new Set())![0].taskDiagnostic, diagnostic);
  assert.equal(reconcileHistoryNodes(snapshot, [{ id: "prompt", type: "prompt" }], new Set())![0].taskDiagnostic, undefined);
});

test("audio undo keeps the current submission and its independent task identity", () => {
  const snapshot = [{
    id: "prompt", type: "prompt", audioTaskType: "music", voiceId: "old-voice",
    musicSubmission: { key: "old-music-key" }, voiceDesignSubmission: { key: "old-voice-key" },
  }];
  const current = [{
    id: "prompt", type: "prompt", audioTaskType: "voice_design", voiceId: "new-voice",
    voiceDesignSubmission: { key: "current-voice-key", prompt: "original voice request", previewText: "original preview" },
  }];
  const restored = reconcileHistoryNodes(snapshot, current, new Set())![0];
  assert.equal(restored.audioTaskType, "voice_design");
  assert.equal(restored.voiceId, "new-voice");
  assert.deepEqual(restored.voiceDesignSubmission, current[0].voiceDesignSubmission);
  assert.equal(restored.musicSubmission, undefined);
});

test("undo never resurrects cleared audio or video submissions", () => {
  const snapshot = [{
    id: "prompt", type: "prompt", audioTaskType: "voice_design", voiceId: "old-voice",
    musicSubmission: { key: "old-music" }, voiceDesignSubmission: { key: "old-voice" }, videoSubmission: { key: "old-video" },
  }];
  const current = [{ id: "prompt", type: "prompt" }];
  const restored = reconcileHistoryNodes(snapshot, current, new Set())![0];
  for (const key of ["musicSubmission", "voiceDesignSubmission", "videoSubmission", "audioTaskType", "voiceId"] as const) {
    assert.equal(restored[key], undefined);
  }
});
