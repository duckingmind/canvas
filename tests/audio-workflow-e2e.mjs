/** Actual Canvas audio workflows, using loopback storage and intercepted supplier responses. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5289", api = "http://127.0.0.1:5290";
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5289", "--api-port=5290"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, context, page, canvasId, requests = [], objectRequests = [], checks = [];
const errors = [], browserDiagnostics = [], forbiddenRequests = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Audio fixture startup timeout: " + output)), 30000);
  const read = chunk => { output += String(chunk); if (output.includes('"event":"ready"')) { clearTimeout(timer); resolve(); } };
  fixture.stdout.on("data", read); fixture.stderr.on("data", read);
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { clearTimeout(timer); reject(new Error("Audio fixture exited " + code + ": " + output)); });
});
const control = async value => {
  const response = await fetch(api + "/__fixture/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.equal(response.status, 200);
};
const eventually = async (check, label, timeout = 45000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await pause(80); }
  throw new Error("Timed out: " + label);
};
const readDocument = () => page.evaluate(async id => (await import("/src/library-store.ts")).getCanvas(id), canvasId);
const readNode = async () => (await readDocument())?.nodes.find(node => node.id === "audio-node");
const passed = label => { checks.push(label); console.log("PASS " + label); };
const wav = Buffer.alloc(44 + 8 * 8000 * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
const song = { id: "fixture-song", name: "测试音乐", type: "audio", is_default: true, supported_operations: ["generation"], supported_input_modes: ["text", "lyrics"], audio_modes: ["song", "instrumental"], output_formats: ["wav"], supported_parameters: { lyrics_optimizer: { type: "boolean" } } };
const cover = { id: "fixture-music-cover", name: "测试 Cover", type: "audio", supported_operations: ["generation"], supported_input_modes: ["reference_audio"], audio_modes: ["song"], output_formats: ["wav"] };
const voice = { id: "minimax-voice-design", name: "测试音色", type: "audio", is_default: true, supported_operations: ["generation"], supported_input_modes: ["text"], supported_parameters: { prompt: {}, preview_text: {} } };

async function makeCase(name, patch = {}, recover = false) {
  await context?.close(); requests = []; objectRequests = [];
  canvasId = "audio-workflow-" + name;
  const now = new Date().toISOString();
  const node = { id: "audio-node", type: "prompt", mediaType: "audio", audioMode: "music", title: "测试音频", text: "轻快明亮的中文夏日歌曲", x: 300, y: 120, width: 360, height: 180, color: "#888", status: "idle", ...patch };
  await control({ reset: true, storage: { ["canvas:doc:v1:" + canvasId]: { id: canvasId, name, createdAt: now, updatedAt: now, nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } } });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route("**/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/v1/music/models") return json({ data: [song, cover] });
    if (path === "/v1/voice-design/models") return json({ data: [voice] });
    if (path.startsWith("/v1/tts/")) {
      forbiddenRequests.push({ path, method: request.method() });
      return json({ error: { code: "feature_removed", message: "Canvas must not invoke TTS" } }, 404);
    }
    if (path === "/v1/media/assets/legacy-audio-asset") {
      requests.push({ path, method: request.method() });
      return json({ id: "legacy-audio-asset", task_id: "legacy-result-task", type: "audio", model: "minimax-speech-2.8-hd", size_bytes: wav.length, created_at: now, url: base + "/v1/fixture-audio.wav", saved_to_library: false, metadata_revision: 1 });
    }
    if (path === "/v1/fixture-audio.wav") return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
    if (path === "/v1/models") return json({ data: [{ id: "fixture-lyrics", type: "text", supported_endpoints: ["responses"] }] });
    if (path === "/v1/responses") { requests.push({ path, body: request.postDataJSON() }); return json({ status: "completed", output_text: "[Verse]\n海风吹散了云朵\n[Chorus]\n一起唱响这个夏天" }); }
    if (/^\/v1\/(?:music|voice-design)\/(?:generations|tasks\/|by-idempotency-key\/)/.test(path)) {
      requests.push({ path, method: request.method(), key: request.headers()["idempotency-key"], ...(request.postData() ? { body: request.postDataJSON() } : {}) });
      const isVoice = path.includes("voice-design"), taskId = isVoice ? "fixture-voice-task" : "fixture-music-task";
      if (path.includes("by-idempotency-key") && !recover) return json({ error: { code: isVoice ? "voice_design_task_not_found" : "music_task_not_found", message: "not found" } }, 404);
      const signedUrl = `https://objects.example/${isVoice ? "voice-preview" : "music-result"}.wav?signature=temporary`;
      return json(isVoice ? { id: taskId, task_status: "succeeded", voice_id: "voice-fixture-result", content_url: signedUrl, trial_audio: { available: true, url: signedUrl } } : { id: taskId, status: "completed", content_url: signedUrl, data: [{ url: signedUrl, format: "wav" }] });
    }
    return route.continue();
  });
  await context.route("https://objects.example/**", async route => {
    objectRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "audio/wav", headers: { "Access-Control-Allow-Origin": "*" }, body: wav });
  });
  page = await context.newPage(); page.on("pageerror", error => { errors.push(error.message); browserDiagnostics.push(error.stack || error.message); });
  page.on("requestfailed", request => browserDiagnostics.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
  page.on("console", message => { if (message.type() === "error") browserDiagnostics.push(message.text()); });
  await page.goto(base + "/#/canvas/" + canvasId);
  await page.locator('[data-node-id="audio-node"]').waitFor({ state: "attached" });
  const closeList = page.getByRole("button", { name: "收起画布列表", exact: true }).first();
  if (await closeList.isVisible()) await closeList.click();
}

async function creator(label) {
  await page.locator('[data-node-id="audio-node"]').dblclick();
  const panel = page.getByRole("complementary", { name: label, exact: true });
  await panel.waitFor();
  assert.deepEqual(await panel.getByRole("tab").allTextContents(), ["音色生成", "音乐生成", "录音"]);
  return panel;
}

try {
  await ready; await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const selectedCase = process.env.CANVAS_AUDIO_CASE;
  if (!selectedCase || selectedCase === "lyrics") {
  await makeCase("lyrics");
  const musicPanel = await creator("音乐创作");
  await musicPanel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "歌词已生成" }).waitFor();
  const lyrics = await page.getByLabel("歌词内容", { exact: true }).inputValue();
  assert.match(lyrics, /一起唱响这个夏天/);
  await musicPanel.locator(".context-generate").click();
  await eventually(async () => (await readNode())?.status === "completed", "lyrics music completes");
  const musicPost = requests.find(request => request.path === "/v1/music/generations");
  assert.equal(musicPost.body.lyrics, lyrics); assert.equal(musicPost.body.model, song.id); assert.ok(musicPost.key);
  passed("AI lyrics flow through the App callback into a durable music request");
  }

  if (!selectedCase || selectedCase === "cover") {
  await makeCase("cover");
  const coverPanel = await creator("音乐创作");
  await coverPanel.getByRole("button", { name: "添加参考音频", exact: true }).click();
  await page.getByLabel("选择参考音频", { exact: true }).setInputFiles({ name: "reference.wav", mimeType: "audio/wav", buffer: wav });
  await coverPanel.locator(".context-music-reference-toggle.has-reference").waitFor();
  await eventually(async () => Boolean((await readNode())?.musicReference?.localAudio), "reference cached before submission");
  await coverPanel.locator(".context-generate").click();
  await eventually(async () => (await readNode())?.status === "completed", "Cover music completes");
  const coverPost = requests.find(request => request.path === "/v1/music/generations");
  assert.equal(coverPost.body.model, cover.id); assert.equal(coverPost.body.audio_base64, wav.toString("base64"));
  await eventually(async () => {
    const storage = (await (await fetch(api + "/__fixture/state")).json()).storage;
    return storage["canvas:doc:v1:" + canvasId]?.nodes[0]?.status === "completed";
  }, "completed Cover cloud metadata sync");
  const storage = (await (await fetch(api + "/__fixture/state")).json()).storage;
  const cloud = JSON.stringify(storage["canvas:doc:v1:" + canvasId]);
  assert(!cloud.includes("audio_base64")); assert(!cloud.includes(wav.toString("base64")));
  assert.match(cloud, /proxy-canvas:audio:v1:/);
  passed("Cover upload is validated and cached locally, submitted to its model, and excluded from cloud bytes");
  }

  if (!selectedCase || selectedCase === "cover-recovery") {
  await makeCase("cover-recovery", { status: "queued", musicSubmission: { key: "cover-original", model: cover.id, prompt: "原 Cover 描述", referenceLocalAudio: "proxy-canvas:audio:v1:11111111-1111-4111-8111-111111111111", referenceDuration: 8, referenceSize: wav.length } }, true);
  await eventually(async () => (await readNode())?.status === "completed", "accepted Cover recovers without local bytes");
  assert.equal((await readNode()).taskId, "fixture-music-task");
  assert.equal(requests.filter(request => request.path.endsWith("/generations")).length, 0);
  assert(requests.some(request => request.path === "/v1/music/by-idempotency-key/cover-original"));
  passed("accepted Cover recovers on a new browser without reading the missing local file or resubmitting");
  }

  if (!selectedCase || selectedCase === "voice") {
  await makeCase("voice", { audioMode: "voice_design", voicePreviewText: "你好，欢迎来到音乐创作。", text: "温柔清晰的青年声音", modelId: voice.id });
  const voicePanel = await creator("音色生成");
  await voicePanel.locator(".context-generate").click();
  await eventually(async () => (await readNode())?.status === "completed", "voice completes");
  const voiceNode = await readNode();
  assert.equal(voiceNode.voiceId, "voice-fixture-result"); assert.equal(voiceNode.audioTaskType, "voice_design");
  assert.equal(requests.filter(request => request.path === "/v1/music/generations").length, 0);
  const voicePost = requests.find(request => request.path === "/v1/voice-design/generations");
  assert.equal(voicePost.body.preview_text, "你好，欢迎来到音乐创作。"); assert.ok(voicePost.key);
  await eventually(async () => objectRequests.some(url => url.includes("/voice-preview.wav?")), "voice preview direct object-storage download");
  assert.equal(requests.some(request => request.path.endsWith("/content")), false, "audio bytes must not pass through Gateway content routes");
  await page.locator('[data-node-id="audio-node"]').click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载音频", exact: true }).first().click();
  assert.match((await download).suggestedFilename(), /\.wav$/);
  await page.screenshot({ path: artifacts + "audio-workflow-voice.png" });
  passed("voice design yields voice_id, direct object-storage playback, and a downloadable audio result");
  }
  if (!selectedCase || selectedCase === "retired-tts") {
    const legacyText = "历史语音草稿，保留原有文字。";
    await makeCase("retired-tts-draft", { audioMode: "tts", text: legacyText, modelId: "minimax-speech-2.8-hd" });
    const legacyDraft = await creator("音频创作");
    assert.equal(await legacyDraft.locator(".context-generate").count(), 0);
    assert.equal(await legacyDraft.locator(".context-tts-settings").count(), 0);
    await legacyDraft.getByRole("tab", { name: "音乐生成", exact: true }).click();
    await page.getByRole("complementary", { name: "音乐创作", exact: true }).waitFor();
    assert.equal(await page.getByLabel("音乐创作描述", { exact: true }).inputValue(), legacyText);
    assert.equal(requests.filter(request => request.path.endsWith("/generations")).length, 0);
    passed("the audio creator exposes three modes and preserves retired drafts until an explicit mode choice");

    for (const patch of [
      { audioMode: "tts", status: "queued", ttsSubmission: { key: "tts-original", model: "minimax-speech-2.8-hd", text: legacyText, settings: { voice_id: "old-voice" } } },
      { audioMode: "music", audioTaskType: "tts", status: "queued", taskId: "legacy-pending-task" },
    ]) {
      await makeCase("retired-tts-pending", patch, true);
      const legacyTask = await creator("音频创作");
      await legacyTask.getByRole("status").filter({ hasText: "历史任务信息已保留" }).waitFor();
      await pause(700);
      assert.equal(requests.length, 0, "legacy tasks must not be polled or submitted to a different audio API");
      assert.equal(await page.locator('[data-node-id="audio-node"] .creation-progress').count(), 0);
      assert.equal(await legacyTask.locator(".context-generate").count(), 0);
      const original = await readNode();
      assert.equal(original.taskId, patch.taskId);
      assert.deepEqual(original.ttsSubmission, patch.ttsSubmission);
    }
    passed("legacy task IDs and lost-response submissions remain intact without TTS or music API requests");

    await makeCase("retired-tts-result", { audioMode: "tts", audioTaskType: "tts", status: "completed", taskId: "legacy-result-task", assetId: "legacy-audio-asset", audio: "/v1/tts/tasks/legacy-result-task/content" });
    await page.locator('[data-node-id="audio-node"]').click();
    await eventually(async () => Boolean(await page.locator('[data-node-id="audio-node"] audio').getAttribute("src").catch(() => "")), "historical audio asset becomes playable");
    assert.equal(await page.locator('[data-node-id="audio-node"] .creation-placeholder').count(), 0);
    assert.equal(await page.locator('[data-node-id="audio-node"] .creation-progress').count(), 0);
    assert(requests.some(request => request.path === "/v1/media/assets/legacy-audio-asset"));
    assert.equal((await readNode()).audioTaskType, "tts");
    passed("historical speech audio remains playable through the ordinary media asset service");
  }
  if (!selectedCase || selectedCase === "recording") {
    await makeCase("recording");
    const recordingPanel = await creator("音乐创作");
    await page.evaluate(bytes => {
      const state = window.audioRecordingFixture = { stoppedTracks: 0 };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => ({ getTracks: () => [{ stop() { state.stoppedTracks++; } }] }) });
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        state = "inactive"; mimeType = "audio/wav"; ondataavailable = null; onstop = null; onerror = null;
        start() { this.state = "recording"; }
        stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: "audio/wav" }) }); this.onstop?.(); }
      };
    }, [...wav]);
    await recordingPanel.getByRole("tab", { name: "录音", exact: true }).click();
    const recorder = page.getByRole("complementary", { name: "录音", exact: true });
    await recorder.getByRole("button", { name: "开始录音", exact: true }).click();
    await recorder.getByRole("button", { name: "停止录音", exact: true }).click();
    await recorder.getByRole("button", { name: "确认使用", exact: true }).click();
    await eventually(async () => (await readNode())?.status === "completed", "recording saved in target Canvas node");
    const recorded = await readNode();
    assert.equal(recorded.audioMode, "recording"); assert.match(recorded.localAudio, /^proxy-canvas:audio:v1:/);
    assert.equal(await page.evaluate(async key => (await (await import("/src/audio-cache.ts")).readLocalAudio(key))?.size, recorded.localAudio), wav.length);
    assert.equal(await page.evaluate(() => window.audioRecordingFixture.stoppedTracks), 1);
    assert.equal(requests.filter(request => request.path.endsWith("/generations")).length, 0);
    await page.locator('[data-node-id="audio-node"]').click();
    const recordingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载音频", exact: true }).first().click();
    assert.match((await recordingDownload).suggestedFilename(), /\.wav$/);
    passed("recording saves into its Canvas node, releases the microphone, and downloads from local cache");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbiddenRequests, [], "Canvas must never request TTS endpoints");
  await writeFile(artifacts + "audio-workflow-result.json", JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await mkdir(artifacts, { recursive: true });
  await writeFile(artifacts + "audio-workflow-diagnostics.json", JSON.stringify({ errors, browserDiagnostics, output, requests, forbiddenRequests, node: await readNode().catch(() => undefined) }, null, 2));
  await writeFile(artifacts + "audio-workflow-failure.txt", String(error) + "\n" + await page?.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  await page?.screenshot({ path: artifacts + "audio-workflow-failure.png", timeout: 3000 }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); fixture.kill("SIGTERM");
  await Promise.race([new Promise(resolve => fixture.once("exit", resolve)), pause(5000)]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
