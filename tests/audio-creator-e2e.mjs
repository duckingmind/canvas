/** Audio creator interactions use a disposable component harness and no platform writes. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.CANVAS_AUDIO_CREATOR_PORT || 5287);
const base = `http://127.0.0.1:${port}`;
const server = spawn("npm", ["run", "dev:server", "--", "--config", "tests/audio-creator-vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, page;
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Vite startup timeout: ${output}`)), 30000);
  const read = chunk => {
    output += String(chunk);
    if (output.includes(`127.0.0.1:${port}`)) { clearTimeout(timeout); resolve(); }
  };
  server.stdout.on("data", read);
  server.stderr.on("data", read);
  server.once("error", error => { clearTimeout(timeout); reject(error); });
  server.once("exit", code => { clearTimeout(timeout); reject(new Error(`Vite exited ${code}: ${output}`)); });
});

try {
  await ready;
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(`${base}/src/main.tsx`, route => route.fulfill({ status: 200, contentType: "application/javascript", body: 'import "/src/styles.css";' }));
  await page.goto(base);
  const sources = await page.evaluate(async () => {
    const [panel, main] = await Promise.all([fetch("/src/CreatorPanel.tsx").then(response => response.text()), fetch("/src/main.tsx?harness-runtime").then(response => response.text())]);
    return { reactPath: /from\s+["']([^"']*\/react\.js[^"']*)["']/.exec(panel)?.[1], domPath: /from\s+["']([^"']*\/react-dom_client\.js[^"']*)["']/.exec(main)?.[1] };
  });
  assert.ok(sources.reactPath && sources.domPath);
  await page.evaluate(async ({ reactPath, domPath }) => {
    const React = (await import(reactPath)).default;
    const dom = await import(domPath), createRoot = dom.createRoot || dom.default.createRoot;
    const CreatorPanel = (await import("/src/CreatorPanel.tsx")).default;
    document.querySelector("#root").style.display = "none";
    const host = document.createElement("div");
    // Keep this fixture below body-portaled popovers, like the real canvas.
    Object.assign(host.style, { position: "fixed", inset: "40px", zIndex: "10", background: "#111", containerType: "inline-size", containerName: "canvas-editor" });
    document.body.append(host);
    const state = window.audioCreatorHarness = { lyricCalls: 0, saveCalls: 0, referenceCalls: 0, cancelCalls: 0, stoppedTracks: 0, nodes: {}, lyricResolve: null, lyricReject: null, saveResolve: null, saveReject: null, referenceResolve: null, referenceReject: null };
    const defaultNode = { id: "voice-a", type: "prompt", title: "声音", text: "温柔低沉的青年声音", mediaType: "audio", audioMode: "voice_design", voicePreviewText: "你好，欢迎来到音乐创作。", voiceId: "voice-result-only-once" };
    const models = [
      { id: "voice-default", name: "音色模型", type: "audio", is_default: true, supported_operations: ["generation"], supported_input_modes: ["text"], supported_parameters: { prompt: {}, preview_text: {} } },
      { id: "voice-disabled", name: "不可用音色模型", type: "audio", available: false, supported_parameters: { prompt: {}, preview_text: {} } },
      { id: "music-default", name: "音乐模型", type: "audio", is_default: true, supported_input_modes: ["text", "lyrics"], audio_modes: ["song", "instrumental"], output_formats: ["mp3"] },
    ];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => ({ getTracks: () => [{ stop() { state.stoppedTracks++; } }] }) });
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      state = "inactive"; mimeType = "audio/webm"; ondataavailable = null; onstop = null; onerror = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["fixture-recording"], { type: "audio/webm" }) }); this.onstop?.(); }
    };
    function Harness() {
      const [node, setNode] = React.useState(defaultNode);
      state.node = node;
      state.setNode = next => setNode({ ...defaultNode, voiceId: undefined, audioMode: "music", ...next });
      return React.createElement(CreatorPanel, {
        node, models, textReferences: [], references: [], referenceCandidates: [], mentionCandidates: [], referenceNaming: "name", onFocusHandled() {}, sources: [], inputChanged: true,
        style: { left: 0, top: 0 }, active: false, connecting: false, connectionError: "", needsLogin: false, connectionActionLabel: "刷新", modelPlaceholder: "选择模型",
        onChange: patch => setNode(current => ({ ...current, ...patch })), onGenerate() {}, onCancel() { state.cancelCalls++; }, onRefresh() {}, onLocate() {}, onDisconnect() {}, onAddReference() {}, onPickCanvasReference() {}, onPickCanvasTextReference() {}, onUploadReference() {}, onDrawReference() {}, onClose() {},
        audioReferenceCandidates: [{ id: "reference-node", type: "audio", title: "参考音乐", text: "", audio: "https://fixture.invalid/audio.mp3" }, { id: "asset-reference", type: "audio", title: "可恢复音频资产", text: "", assetId: "stable-audio-asset" }],
        onGenerateLyrics: () => { state.lyricCalls++; return new Promise((resolve, reject) => { state.lyricResolve = resolve; state.lyricReject = reject; }); },
        onSaveRecording: () => { state.saveCalls++; return new Promise((resolve, reject) => { state.saveResolve = resolve; state.saveReject = reject; }); },
        onSelectMusicReference: () => { state.referenceCalls++; return new Promise((resolve, reject) => { state.referenceResolve = resolve; state.referenceReject = reject; }); },
      });
    }
    createRoot(host).render(React.createElement(Harness));
  }, sources);

  const panel = page.locator(".context-creator");
  await panel.waitFor();
  assert.equal(await panel.locator(".context-voice-result code").count(), 1, "the voice ID appears once");
  assert.equal(await panel.locator(".context-voice-result code").innerText(), "voice-result-only-once");
  await panel.getByRole("button", { name: "复制音色 ID", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "复制失败" }).waitFor();
  const voiceCompactHeight = (await panel.boundingBox()).height;
  await panel.getByRole("button", { name: "设置音色试听文本", exact: true }).click();
  await page.getByRole("dialog", { name: "音色试听文本", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "音色试听文本", exact: true }).inputValue(), "你好，欢迎来到音乐创作。");
  assert.equal(Math.abs((await panel.boundingBox()).height - voiceCompactHeight) < 1, true, "voice preview opens without expanding the composer");
  await page.keyboard.press("Escape");
  assert.equal(await panel.getByRole("button", { name: "设置音色试听文本", exact: true }).evaluate(button => button === document.activeElement), true, "Escape returns focus to the voice-preview control");
  await panel.getByRole("button", { name: "音色模型，打开音色模型选择", exact: true }).click();
  assert.equal(await panel.locator(".context-model-menu .context-model-option").filter({ hasText: "不可用音色模型" }).isDisabled(), true);
  await panel.getByRole("tab", { name: "音色生成", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await panel.getByRole("tab", { name: "音乐生成", exact: true }).getAttribute("aria-selected"), "true", "arrow keys move between audio modes");
  assert.equal(await panel.getByLabel("歌词内容", { exact: true }).count(), 0, "lyrics stay tucked away in the compact composer");
  const musicCompactHeight = (await panel.boundingBox()).height;
  assert.ok(musicCompactHeight < 200, "music starts as a compact prompt composer");
  await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  await page.getByRole("dialog", { name: "歌曲歌词", exact: true }).waitFor();
  assert.equal(Math.abs((await panel.boundingBox()).height - musicCompactHeight) < 1, true, "lyrics open as a popover instead of growing the composer");
  await page.keyboard.press("Escape");
  assert.equal(await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).evaluate(button => button === document.activeElement), true, "Escape returns focus to the lyrics control");
  if (process.env.CANVAS_AUDIO_CREATOR_SCREENSHOT) {
    await page.screenshot({ path: process.env.CANVAS_AUDIO_CREATOR_SCREENSHOT });
    await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
    await page.screenshot({ path: process.env.CANVAS_AUDIO_CREATOR_SCREENSHOT.replace(/\.png$/i, "-lyrics.png") });
    await panel.getByRole("button", { name: "收起歌词编辑", exact: true }).click();
  }
  await panel.getByRole("button", { name: "添加参考音频", exact: true }).click();
  const referenceDialog = page.getByRole("dialog", { name: "参考音频", exact: true });
  assert.equal(Math.abs((await panel.boundingBox()).height - musicCompactHeight) < 1, true, "reference selection does not expand the composer");
  assert.equal(await referenceDialog.locator('select[aria-label="选择画布中的参考音频"] option[value="asset-reference"]').count(), 1, "asset-backed audio remains available as a reference");
  if (process.env.CANVAS_AUDIO_CREATOR_SCREENSHOT) {
    await page.screenshot({ path: process.env.CANVAS_AUDIO_CREATOR_SCREENSHOT.replace(/\.png$/i, "-reference.png") });
  }
  await page.keyboard.press("Escape");
  assert.equal(await panel.getByRole("button", { name: "添加参考音频", exact: true }).evaluate(button => button === document.activeElement), true, "Escape returns focus to the reference control");
  await page.setViewportSize({ width: 480, height: 800 });
  assert.equal(await panel.locator(".context-creator-footer").evaluate(footer => footer.scrollWidth <= footer.clientWidth), true, "narrow controls wrap inside the composer");
  await panel.getByRole("button", { name: "音乐模型，打开音乐模型选择", exact: true }).click();
  assert.equal(await panel.getByRole("listbox", { name: "音乐模型列表", exact: true }).isVisible(), true, "wrapping the controls keeps model selection available");
  await page.keyboard.press("Escape");
  if (process.env.CANVAS_AUDIO_CREATOR_SCREENSHOT) await page.screenshot({ path: process.env.CANVAS_AUDIO_CREATOR_SCREENSHOT.replace(/\.png$/i, "-narrow.png") });
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(() => window.audioCreatorHarness.setNode({ id: "voice-pending", audioMode: "voice_design", audioTaskType: "voice_design", status: "running", taskId: "pending-voice-task" }));
  await panel.getByRole("button", { name: "停止音色生成", exact: true }).click();
  assert.equal(await page.evaluate(() => window.audioCreatorHarness.cancelCalls), 1);
  await page.evaluate(() => window.audioCreatorHarness.setNode({ id: "music-a", text: "温暖的抒情音乐" }));
  await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).click();
  assert.equal(await panel.getByRole("tab", { name: "录音", exact: true }).isDisabled(), true, "a pending lyrics operation locks mode switching");
  assert.equal(await page.getByLabel("歌词内容", { exact: true }).isDisabled(), true);
  await page.evaluate(() => window.audioCreatorHarness.lyricReject(new Error("歌词暂不可用")));
  await page.getByRole("alert").filter({ hasText: "歌词暂不可用" }).waitFor();
  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).click();
  await page.evaluate(() => window.audioCreatorHarness.lyricResolve("[Verse]\n月光洒在琴键上"));
  await page.getByRole("status").filter({ hasText: "歌词已生成" }).waitFor();
  assert.equal(await page.getByLabel("歌词内容", { exact: true }).inputValue(), "[Verse]\n月光洒在琴键上");
  await page.getByLabel("歌词内容", { exact: true }).fill("手动编辑后的歌词");
  assert.equal(await page.getByRole("status").filter({ hasText: "歌词已生成" }).count(), 0);
  await panel.getByRole("button", { name: "收起歌词编辑", exact: true }).click();
  await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  assert.equal(await page.getByLabel("歌词内容", { exact: true }).inputValue(), "手动编辑后的歌词", "collapsing the editor keeps its lyrics");
  await panel.getByRole("button", { name: "纯音乐", exact: true }).click();
  assert.equal(await panel.getByRole("button", { name: "纯音乐无需歌词", exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("歌词内容", { exact: true }).count(), 0);
  await panel.getByRole("button", { name: "自适应", exact: true }).click();
  await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  assert.equal(await page.getByLabel("歌词内容", { exact: true }).inputValue(), "手动编辑后的歌词", "switching music type retains the lyrics draft");

  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).click();
  await page.evaluate(() => window.audioCreatorHarness.setNode({ id: "music-b", text: "明快的夏日音乐", musicLyrics: "新节点歌词" }));
  await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).waitFor();
  await page.evaluate(() => window.audioCreatorHarness.lyricResolve("旧节点的延迟歌词"));
  await page.waitForTimeout(60);
  assert.equal(await page.getByLabel("歌词内容", { exact: true }).inputValue(), "新节点歌词", "a late lyric result cannot overwrite another node");
  assert.equal(await page.getByRole("status").filter({ hasText: "歌词已生成" }).count(), 0);
  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).click();
  await page.evaluate(() => {
    const state = window.audioCreatorHarness;
    state.previousLyricResolve = state.lyricResolve;
    state.setNode({ id: "music-temporary", text: "临时节点" });
  });
  await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).waitFor();
  await page.evaluate(() => window.audioCreatorHarness.setNode({ id: "music-b", text: "返回的编辑内容", musicLyrics: "返回节点的新歌词" }));
  await panel.getByRole("button", { name: "展开歌词编辑", exact: true }).click();
  await page.getByRole("button", { name: "AI 生成歌词", exact: true }).waitFor();
  await page.evaluate(() => window.audioCreatorHarness.previousLyricResolve("离开之前的延迟歌词"));
  await page.waitForTimeout(60);
  assert.equal(await page.getByLabel("歌词内容", { exact: true }).inputValue(), "返回节点的新歌词", "returning to the same node must not reactivate an abandoned response");
  await panel.getByRole("button", { name: "添加参考音频", exact: true }).click();
  await page.getByLabel("选择画布中的参考音频", { exact: true }).selectOption("reference-node");
  await page.evaluate(() => window.audioCreatorHarness.setNode({ id: "music-c", text: "安静的钢琴曲" }));
  await page.evaluate(() => window.audioCreatorHarness.referenceReject(new Error("旧参考选择失败")));
  await page.waitForTimeout(60);
  assert.equal(await panel.getByRole("alert").filter({ hasText: "旧参考选择失败" }).count(), 0);

  await panel.getByRole("tab", { name: "录音", exact: true }).click();
  await panel.getByRole("button", { name: "开始录音", exact: true }).click();
  await panel.getByRole("button", { name: "停止录音", exact: true }).click();
  await panel.getByRole("button", { name: "确认使用", exact: true }).waitFor();
  assert.equal(await panel.locator(".audio-recorder-clock, .audio-recorder-progress, .audio-recorder-message").count(), 0, "ready state keeps only one playback timeline and removes recording-only status details");
  assert.equal(await panel.getByRole("heading", { name: "试听录音", exact: true }).count(), 1);
  await page.evaluate(() => { const button = document.querySelector(".audio-recorder-button.is-primary"); button.click(); button.click(); });
  assert.equal(await page.evaluate(() => window.audioCreatorHarness.saveCalls), 1, "rapid confirmation shares one save");
  await page.evaluate(() => window.audioCreatorHarness.saveReject(new Error("本机保存失败")));
  await panel.getByRole("alert").filter({ hasText: "本机保存失败" }).waitFor();
  assert.equal(await panel.locator(".audio-recorder-preview").count(), 1, "save failure retains the recording for retry");
  await panel.getByRole("button", { name: "确认使用", exact: true }).click();
  await page.evaluate(() => window.audioCreatorHarness.saveResolve());
  await panel.getByRole("status").filter({ hasText: "录音已保存到画布" }).waitFor();
  await panel.getByRole("button", { name: "再录一段", exact: true }).click();
  await panel.getByRole("button", { name: "开始录音", exact: true }).waitFor();
  assert.equal(await panel.locator(".audio-recorder-preview").count(), 0);
  await panel.getByRole("button", { name: "开始录音", exact: true }).click();
  await panel.getByRole("button", { name: "停止录音", exact: true }).waitFor();
  const stoppedBeforeSwitch = await page.evaluate(() => window.audioCreatorHarness.stoppedTracks);
  await page.evaluate(() => window.audioCreatorHarness.setNode({ id: "recording-other", audioMode: "recording" }));
  await panel.getByRole("button", { name: "开始录音", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.audioCreatorHarness.stoppedTracks), stoppedBeforeSwitch + 1, "switching recording nodes releases the prior microphone");
  assert.equal(await panel.locator(".audio-recorder-preview").count(), 0, "another node never reuses the prior recording preview");
  assert.deepEqual(errors, [], "audio interactions must not raise unhandled browser errors");
  console.log("PASS audio creator covers lyrics retry, stale responses, voice ID copy failure, recording retry, duplicate-save protection and cross-node microphone cleanup");
} catch (error) {
  if (page) console.log(await page.evaluate(() => {
    const button = document.querySelector('[aria-label="复制音色 ID"]');
    const rect = button?.getBoundingClientRect();
    return { rect: rect?.toJSON(), body: document.body.outerHTML.slice(0, 500), hit: rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 500) : null };
  }));
  throw error;
} finally {
  if (browser) await browser.close();
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* Server already exited. */ }
  await new Promise(resolve => setTimeout(resolve, 100));
  if (server.exitCode === null) { try { process.kill(-server.pid, "SIGKILL"); } catch { /* Server already exited. */ } }
}
