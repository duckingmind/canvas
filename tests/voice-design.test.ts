import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelVoiceDesign,
  generateVoiceDesign,
  readVoiceDesignContent,
  readVoiceDesignTaskByIdempotencyKey,
  VoiceDesignError,
  voiceDesignSnapshot,
  type VoiceDesignInput,
} from "../src/voice-design.ts";
import type { MusicRequest } from "../src/music-generation.ts";

test("Gateway succeeded status maps to a completed voice result", async () => {
  const snapshot = voiceDesignSnapshot({
    id: "voice-task-1", status: "completed", task_status: "succeeded", voice_id: "voice-1",
    content_url: "https://objects.example/voice.mp3?signature=temporary", trial_audio: { available: true, url: "https://objects.example/voice.mp3?signature=temporary" },
  });
  assert.deepEqual(snapshot, {
    taskId: "voice-task-1", status: "succeeded", voiceId: "voice-1",
    contentUrl: "https://objects.example/voice.mp3?signature=temporary", trialAudioAvailable: true,
  });
  const result = await generateVoiceDesign(async path => {
    assert.equal(path, "/voice-design/generations");
    return { id: "voice-task-1", status: "completed", task_status: "succeeded", voice_id: "voice-1" };
  }, { prompt: "warm voice", previewText: "hello" });
  assert.equal(result.voiceId, "voice-1");
});

test("recovery resolves the original task before any create request", async () => {
  const paths: string[] = [], saved: string[] = [];
  const result = await generateVoiceDesign(async path => {
    paths.push(path);
    assert.equal(path, "/voice-design/by-idempotency-key/frozen-key");
    return { id: "recovered-voice", status: "completed", task_status: "succeeded", voice_id: "voice-recovered" };
  }, { prompt: "frozen prompt", previewText: "frozen preview", idempotencyKey: "frozen-key" }, id => { saved.push(id); }, { recovery: true });
  assert.deepEqual(paths, ["/voice-design/by-idempotency-key/frozen-key"]);
  assert.deepEqual(saved, ["recovered-voice"]);
  assert.equal(result.voiceId, "voice-recovered");
});

test("only an explicit task-not-found lookup permits replay of the same frozen request", async () => {
  const input: Readonly<VoiceDesignInput> = Object.freeze({ prompt: " original prompt ", previewText: " preview text ", idempotencyKey: "same-key" });
  const writes: Array<{ path: string; key?: string; body?: string }> = [];
  const request: MusicRequest = async (path, init) => {
    writes.push({ path, key: init?.headers?.["Idempotency-Key"], body: init?.body ? String(init.body) : undefined });
    if (path.startsWith("/voice-design/by-idempotency-key/")) throw { status: 404, code: "voice_design_task_not_found" };
    return { id: "new-voice-task", status: "completed", task_status: "succeeded", voice_id: "voice-new" };
  };
  const result = await generateVoiceDesign(request, input, undefined, { recovery: true });
  assert.equal(result.taskId, "new-voice-task");
  assert.deepEqual(writes, [
    { path: "/voice-design/by-idempotency-key/same-key", key: undefined, body: undefined },
    { path: "/voice-design/generations", key: "same-key", body: JSON.stringify({ model: "minimax-voice-design", prompt: input.prompt, preview_text: input.previewText }) },
  ]);
});

test("lookup outages remain pending and never submit a replacement", async () => {
  const paths: string[] = [];
  await assert.rejects(generateVoiceDesign(async path => {
    paths.push(path);
    throw { status: 503, code: "database_unavailable" };
  }, { prompt: "p", previewText: "v", idempotencyKey: "same-key" }, undefined, { recovery: true }), error => {
    assert.ok(error instanceof VoiceDesignError);
    assert.equal(error.pending, true);
    assert.equal(error.terminalTask, false);
    assert.equal(error.code, "database_unavailable");
    return true;
  });
  assert.deepEqual(paths, ["/voice-design/by-idempotency-key/same-key"]);
});

test("late task identity is saved before a local pause", async () => {
  const controller = new AbortController();
  const saved: string[] = [];
  let resolvePost!: (value: unknown) => void;
  let postStarted!: () => void;
  const started = new Promise<void>(resolve => { postStarted = resolve; });
  const post = new Promise<unknown>(resolve => { resolvePost = resolve; });
  const operation = generateVoiceDesign(async path => {
    assert.equal(path, "/voice-design/generations");
    postStarted();
    return post;
  }, { prompt: "voice", previewText: "hello", idempotencyKey: "same-key" }, id => { saved.push(id); }, { signal: controller.signal });
  await started;
  controller.abort(new Error("closed"));
  resolvePost({ id: "accepted-task", status: "pending" });
  await assert.rejects(operation, error => error instanceof VoiceDesignError && error.pending && error.taskId === "accepted-task" && error.code === "VOICE_DESIGN_PAUSED");
  assert.deepEqual(saved, ["accepted-task"]);
});

test("voice preview downloads directly from the signed URL without a Gateway content request", async () => {
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04])], { type: "audio/mpeg" });
  const signedUrl = "https://objects.example/voice.mp3?signature=temporary";
  let fetched = "";
  const result = await readVoiceDesignContent(async () => assert.fail("A valid signed URL must not require a Gateway request"), "voice-task-2", signedUrl, undefined, async (url, init) => {
    fetched = url;
    assert.equal(init?.credentials, "omit");
    return new Response(audio);
  });
  assert.equal(result.size, audio.size);
  assert.equal(fetched, signedUrl);
});

test("a legacy voice content URL is refreshed from task details", async () => {
  const paths: string[] = [], fetched: string[] = [];
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04])], { type: "audio/mpeg" });
  const signedUrl = "https://objects.example/voice-refreshed.mp3?signature=temporary";
  const result = await readVoiceDesignContent(async path => {
    paths.push(path);
    return { id: "voice-task-2", status: "completed", trial_audio: { available: true, url: signedUrl } };
  }, "voice-task-2", "https://gateway.example/v1/voice-design/tasks/voice-task-2/content?index=1", undefined, async url => {
    fetched.push(url);
    return new Response(audio);
  });
  assert.equal(result.size, audio.size);
  assert.deepEqual(paths, ["/voice-design/tasks/voice-task-2"]);
  assert.deepEqual(fetched, [signedUrl]);
});

test("cancellation targets the durable Gateway task", async () => {
  const result = await cancelVoiceDesign(async (path, init) => {
    assert.equal(path, "/voice-design/tasks/voice-task-3");
    assert.equal(init?.method, "DELETE");
    assert.equal(init?.headers?.["Idempotency-Key"], "cancel-key");
    return { id: "voice-task-3", status: "cancel_pending", task_status: "cancel_pending" };
  }, "voice-task-3", "cancel-key");
  assert.equal(result.status, "cancel_pending");
});

test("voice design freezes the selected catalog model instead of hard-coding its provider", async () => {
  await generateVoiceDesign(async (_path, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, "supplier-voice-design-v2");
    return { id: "catalog-task", status: "succeeded", voice_id: "voice-2", trial_audio: { available: false } };
  }, { model: "supplier-voice-design-v2", prompt: "warm", previewText: "hello" });
});

test("automatic recovery never recreates a voice task after an idempotency lookup miss", async () => {
  const paths: string[] = [];
  await assert.rejects(generateVoiceDesign(async path => {
    paths.push(path);
    if (path === "/voice-design/by-idempotency-key/auto-voice") throw { status: 404, code: "voice_design_task_not_found" };
    assert.fail(`automatic recovery must not submit to ${path}`);
  }, { prompt: "p", previewText: "v", idempotencyKey: "auto-voice" }, undefined, {
    recovery: true, allowResubmit: false,
  }), error => error instanceof VoiceDesignError && error.pending && !error.terminalTask && error.code === "VOICE_DESIGN_SUBMISSION_NOT_FOUND");
  assert.deepEqual(paths, ["/voice-design/by-idempotency-key/auto-voice"]);
});
