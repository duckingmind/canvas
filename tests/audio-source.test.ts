import assert from "node:assert/strict";
import test from "node:test";
import { canLoadAudioContent, readAudioSourceBlob } from "../src/audio-source.ts";
import { storeLocalAudio } from "../src/audio-cache.ts";

test("protected music content is read through the authenticated task route", async () => {
  const calls: string[] = [];
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04])], { type: "audio/mpeg" });
  const result = await readAudioSourceBlob({
    request: async (path) => {
      calls.push(path);
      return audio;
    },
  }, {
    type: "audio",
    taskId: "music-task-1",
    status: "completed",
    audio: "/music/tasks/music-task-1/content",
  }, {
    fetchResource: async () => { throw new Error("protected content must not be fetched directly"); },
  });
  assert.equal(result, audio);
  assert.deepEqual(calls, ["/music/tasks/music-task-1/content"]);
});

test("a completed music result without an asset ID remains recoverable by task identity", async () => {
  const calls: string[] = [];
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x05])], { type: "audio/mpeg" });
  await readAudioSourceBlob({
    request: async (path) => { calls.push(path); return audio; },
  }, {
    type: "prompt",
    mediaType: "audio",
    taskId: "music-task-2",
    status: "completed",
    audio: "/v1/music/tasks/music-task-2/content",
  }, {
    fetchResource: async () => { throw new Error("protected content must not be fetched directly"); },
  });
  assert.deepEqual(calls, ["/music/tasks/music-task-2/content"]);
});

test("protected voice preview content uses the authenticated task route even with an absolute URL", async () => {
  const calls: string[] = [];
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04])], { type: "audio/mpeg" });
  const result = await readAudioSourceBlob({
    request: async (path, init) => {
      calls.push(path);
      assert.equal(init?.responseType, "blob");
      return audio;
    },
  }, {
    type: "audio",
    taskId: "voice-task-1",
    status: "completed",
    audioTaskType: "voice_design",
    audio: "https://gateway.example/v1/voice-design/tasks/voice-task-1/content?index=1",
  }, {
    fetchResource: async () => { throw new Error("protected voice content must not be fetched directly"); },
  });
  assert.equal(result, audio);
  assert.deepEqual(calls, ["/voice-design/tasks/voice-task-1/content?index=1"]);
});

test("historical TTS audio resolves through media assets without invoking synthesis APIs", async () => {
  const calls: string[] = [];
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04])], { type: "audio/mpeg" });
  const asset = { id: "legacy-audio-asset", task_id: "tts-task-1", type: "audio", size_bytes: audio.size, created_at: "2026-10-15", url: "https://assets.example/legacy.mp3", saved_to_library: false, metadata_revision: 1 };
  const result = await readAudioSourceBlob({
    request: async path => {
      calls.push(path);
      if (path.startsWith("/media/assets?")) {
        const params = new URL(path, "https://gateway.example").searchParams;
        assert.equal(params.get("task_id"), "tts-task-1");
        assert.equal(params.get("type"), "audio");
        return { items: [asset] };
      }
      assert.equal(path, "/media/assets/legacy-audio-asset");
      return asset;
    },
  }, {
    type: "audio",
    taskId: "tts-task-1",
    status: "completed",
    audioTaskType: "tts",
    audio: "https://gateway.example/v1/tts/tasks/tts-task-1/content?index=1",
  }, {
    fetchResource: async url => {
      assert.equal(url, asset.url);
      return new Response(audio);
    },
  });
  assert.equal(result.size, audio.size);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(path => path.startsWith("/media/assets")));
});

test("missing historical audio never falls back to TTS or music task APIs", async () => {
  const calls: string[] = [];
  await assert.rejects(readAudioSourceBlob({ request: async path => {
    calls.push(path);
    return { items: [{ id: "unrelated-audio", task_id: "other-task", type: "audio" }] };
  } }, {
    type: "audio", taskId: "tts-missing", status: "completed", audioTaskType: "tts",
  }, { fetchResource: async () => { throw new Error("No unrelated media may be fetched"); } }), /历史音频资产暂不可用/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("/media/assets?"));
});

test("a completed voice result remains recoverable by its voice task identity", async () => {
  const calls: string[] = [];
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x05])], { type: "audio/mpeg" });
  await readAudioSourceBlob({
    request: async (path) => { calls.push(path); return audio; },
  }, {
    type: "prompt",
    mediaType: "audio",
    taskId: "voice-task-2",
    status: "completed",
    audioTaskType: "voice_design",
  }, {
    fetchResource: async () => { throw new Error("protected voice content must not be fetched directly"); },
  });
  assert.deepEqual(calls, ["/voice-design/tasks/voice-task-2/content"]);
});

test("local recordings remain playable from cache without any gateway or remote request", async () => {
  const audio = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x05])], { type: "audio/mpeg" });
  const localAudio = await storeLocalAudio(audio);
  const result = await readAudioSourceBlob({ request: async () => { throw new Error("Local audio must not request the gateway"); } }, {
    type: "audio", localAudio,
  }, { fetchResource: async () => { throw new Error("Local audio must not request remote resources"); } });
  assert.equal(result, audio);
  await assert.rejects(readAudioSourceBlob({ request: async () => { throw new Error("Unexpected request"); } }, {
    type: "audio", localAudio,
  }, { maxBytes: audio.size - 1, fetchResource: async () => { throw new Error("Unexpected fetch"); } }), { code: "AUDIO_CONTENT_TOO_LARGE" });
});

test("voice design without a preview remains a successful voice identity but cannot load audio", async () => {
  const node = { type: "prompt", mediaType: "audio", status: "completed", taskId: "voice-no-preview", audioTaskType: "voice_design" as const, voiceTrialAudioAvailable: false };
  assert.equal(canLoadAudioContent(node), false);
  await assert.rejects(readAudioSourceBlob({ request: async () => assert.fail("No audio API may be called") }, node, { fetchResource: async () => assert.fail("No media may be fetched") }), /尚未生成完成或已不可用/);
});
