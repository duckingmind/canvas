/** Canvas video controls and editing against a disposable loopback-only fixture.
 * The browser records its own color-changing WebM. No account, remote media,
 * production request, model call, or extra package installation is needed.
 * CANVAS_PLAYWRIGHT_MODULE may point to an existing playwright/index.mjs.
 * CANVAS_VIDEO_INTERACTION_ONLY=1 runs the local node/player interaction checks.
 * CANVAS_VIDEO_DELIVERY_ONLY=1 runs only the signed-URL delivery regression.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5291", api = "http://127.0.0.1:5292";
const canvasId = "video-player-regression";
const checks = [], errors = [], consoleErrors = [], unexpectedNetworks = [];
const measurements = {};
let fixtureOutput = "", browser, context, page;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventually = async (predicate, message, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${message}`);
};
const passed = message => { checks.push(message); console.log(`PASS ${message}`); };
const control = async body => {
  const response = await fetch(`${api}/__fixture/control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
};
const fixtureState = async () => (await fetch(`${api}/__fixture/state`)).json();

// MediaRecorder's streaming WebM intentionally omits Duration. Add that small
// Info field so this seekable local fixture exercises real finite-duration UI.
// The recorded Segment has unknown length and no SeekHead/Cues to relocate.
function withWebmDuration(dataUrl, durationMs) {
  const source = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const vint = (offset, id = false) => {
    const first = source[offset];
    assert.ok(first, "valid EBML variable-length integer");
    let length = 1, mask = 0x80;
    while (!(first & mask)) { length++; mask >>= 1; }
    assert.ok(length <= 8 && offset + length <= source.length);
    let value = BigInt(id ? first : first & (mask - 1));
    for (let i = 1; i < length; i++) value = value * 256n + BigInt(source[offset + i]);
    return { value, length, unknown: !id && value === (1n << BigInt(7 * length)) - 1n };
  };
  const element = offset => {
    const id = vint(offset, true), size = vint(offset + id.length);
    const start = offset + id.length + size.length;
    return { offset, id: Number(id.value), size, start, end: size.unknown ? source.length : start + Number(size.value) };
  };
  const encodeSize = (value, minimum = 1) => {
    let length = minimum;
    while (BigInt(value) >= (1n << BigInt(7 * length)) - 1n) length++;
    const output = Buffer.alloc(length);
    let encoded = BigInt(value) | (1n << BigInt(7 * length));
    for (let i = length - 1; i >= 0; i--) { output[i] = Number(encoded & 255n); encoded >>= 8n; }
    return output;
  };
  let segment, info;
  const segmentChildren = [];
  for (let at = 0; at < source.length;) {
    const item = element(at);
    if (item.id === 0x18538067) { segment = item; break; }
    assert.ok(item.end > at); at = item.end;
  }
  assert.ok(segment, "MediaRecorder produced a WebM Segment");
  for (let at = segment.start; at < segment.end;) {
    const item = element(at);
    segmentChildren.push(item);
    if (item.id === 0x1549a966) info = item;
    assert.ok(item.end > at); at = item.end;
  }
  assert.ok(info, "WebM Info exists");
  let scale = 1_000_000;
  for (let at = info.start; at < info.end;) {
    const item = element(at);
    if (item.id === 0x2ad7b1) scale = source.readUIntBE(item.start, item.end - item.start);
    if (item.id === 0x4489) {
      const copy = Buffer.from(source), value = durationMs * 1_000_000 / scale;
      if (item.end - item.start === 4) copy.writeFloatBE(value, item.start);
      else copy.writeDoubleBE(value, item.start);
      return `data:video/webm;base64,${copy.toString("base64")}`;
    }
    at = item.end;
  }
  assert.ok(!segmentChildren.some(item => item.id === 0x114d9b74 || item.id === 0x1c53bb6b), "adding Duration must not invalidate existing seek offsets");
  const duration = Buffer.alloc(11);
  duration.set([0x44, 0x89, 0x88]); duration.writeDoubleBE(durationMs * 1_000_000 / scale, 3);
  const oldInfoHeader = info.start - info.offset;
  const infoHeader = Buffer.concat([Buffer.from([0x15, 0x49, 0xa9, 0x66]), encodeSize(info.end - info.start + duration.length)]);
  const delta = infoHeader.length - oldInfoHeader + duration.length;
  const body = Buffer.concat([source.subarray(segment.start, info.offset), infoHeader, source.subarray(info.start, info.end), duration, source.subarray(info.end)]);
  const segmentSize = segment.size.unknown
    ? source.subarray(segment.offset + 4, segment.start)
    : encodeSize(Number(segment.size.value) + delta, segment.size.length);
  const output = Buffer.concat([source.subarray(0, segment.offset + 4), segmentSize, body]);
  return `data:video/webm;base64,${output.toString("base64")}`;
}

// Keep the fixture deterministic and include an audible tone so extraction
// checks the encoded samples, not only the resulting node and cache entry.
measurements.audibleAudioTrackIncluded = true;
const recordVideo = async (colors, durationMs = 6000) => {
  const recording = await page.evaluate(async ({ colors, durationMs }) => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d");
    const draw = phase => {
      context.fillStyle = colors[phase]; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#fff"; context.font = "bold 38px sans-serif";
      context.fillText(`LOCAL VIDEO · FRAME ${phase + 1}`, 50, 190);
      context.fillStyle = "#ffffff44"; context.fillRect(50, 220, 540 * (phase + 1) / colors.length, 8);
    };
    draw(0);
    const videoStream = canvas.captureStream(15);
    const audioContext = new AudioContext();
    await audioContext.resume().catch(() => {});
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain(); gain.gain.value = 0.12;
    const destination = audioContext.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination); oscillator.start();
    const stream = new MediaStream([...videoStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    if (stream.getAudioTracks().length !== 1) throw new Error("The local WebM fixture must contain one audio track");
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("The local browser cannot record a WebM fixture");
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 500_000 });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = reject; });
    recorder.start();
    const started = performance.now();
    const timer = setInterval(() => draw(Math.min(colors.length - 1, Math.floor((performance.now() - started) / durationMs * colors.length))), 50);
    await new Promise(resolve => setTimeout(resolve, durationMs));
    const elapsed = performance.now() - started;
    clearInterval(timer); recorder.stop(); await stopped;
    oscillator.stop(); await audioContext.close().catch(() => {});
    stream.getTracks().forEach(track => track.stop());
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => { reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(new Blob(chunks, { type: mimeType })); });
    return { dataUrl, durationMs: elapsed };
  }, { colors, durationMs });
  return withWebmDuration(recording.dataUrl, recording.durationMs);
};
const button = name => page.getByRole("button", { name, exact: true });
const node = id => page.locator(`[data-node-id="${id}"]`);
const player = id => node(id).locator("[data-canvas-video-player]");
const video = id => player(id).locator("video");
const mediaState = id => video(id).evaluate(element => ({ paused: element.paused, muted: element.muted, volume: element.volume, time: element.currentTime, duration: element.duration, readyState: element.readyState, poster: element.poster, source: element.currentSrc, controls: element.controls }));
const geometry = id => node(id).evaluate(element => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top), width: parseFloat(element.style.width), height: parseFloat(element.style.height) }));
const viewport = () => page.locator(".world").evaluate(element => { const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform); return { x: matrix.e, y: matrix.f, zoom: matrix.a }; });
const focusCanvas = () => page.locator(".canvas-board").focus();
const fitCanvas = async () => {
  await focusCanvas(); await page.keyboard.press("ControlOrMeta+0");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator(".canvas-board.is-viewport-moving").waitFor({ state: "hidden" });
};
const keyboardButton = async (id, name, key = "Enter") => { const target = player(id).getByRole("button", { name, exact: true }); await target.focus(); await target.press(key); };
const useVideoTool = async name => {
  const trigger = button("视频工具");
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  const menu = page.getByRole("menu", { name: "视频工具菜单", exact: true });
  await menu.getByRole("menuitem", { name, exact: true }).click();
};
const exportDocument = async () => {
  const downloaded = page.waitForEvent("download");
  await button("导出画布").click();
  const download = await downloaded;
  const filename = await download.path();
  assert.ok(filename, "export is a local browser download");
  return JSON.parse(await readFile(filename, "utf8"));
};
const exportNode = async id => (await exportDocument()).nodes.find(item => item.id === id);
const pixel = async selector => page.locator(selector).evaluate(element => {
  const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext("2d"); context.drawImage(element, 8, 8, 1, 1, 0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
});
const layout = async id => player(id).evaluate(element => {
  const box = element.getBoundingClientRect();
  const controls = [...element.querySelectorAll("button,input")].filter(control => {
    const style = getComputedStyle(control), rect = control.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }).map(control => { const rect = control.getBoundingClientRect(); return { name: control.getAttribute("aria-label"), x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height, inside: rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 }; });
  return { width: box.width, height: box.height, overflowX: element.scrollWidth > element.clientWidth + 1, overflowY: element.scrollHeight > element.clientHeight + 1, controls };
});

await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.env.CANVAS_FIXTURE_NODE || process.execPath, ["tests/platform-fixture.mjs", "--port=5291", "--api-port=5292"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Video fixture startup timeout: ${fixtureOutput}`)), 30000);
  fixture.stdout.on("data", chunk => { fixtureOutput += String(chunk); if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timer); resolve(); } });
  fixture.stderr.on("data", chunk => { fixtureOutput += String(chunk); });
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { clearTimeout(timer); if (code) reject(new Error(`Fixture exited ${code}: ${fixtureOutput}`)); });
});

try {
  await ready;
  browser = await chromium.launch({ headless: true, timeout: Number(process.env.CANVAS_BROWSER_LAUNCH_TIMEOUT || 90000), ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      unexpectedNetworks.push(`${route.request().method()} ${url.origin}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("blocked by CORS policy") && text.includes("__fixture/cos/videos/")) return;
    consoleErrors.push(text);
  });
  page.on("dialog", dialog => dialog.accept());
  await page.route("**/v1/estimates", route => route.fulfill({ json: { known: false, amount: null, currency: "USD" } }));
  await page.mouse.click(1400, 940);
  const originalVideo = await recordVideo(["#eb4141", "#22c55e", "#3b82f6"]);
  const replacementVideo = process.env.CANVAS_VIDEO_DELIVERY_ONLY ? "" : await recordVideo(["#a855f7", "#ec4899", "#eab308"], 2100);
  const oldPoster = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360; const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ffcc00"; ctx.fillRect(0, 0, 640, 360); return canvas.toDataURL("image/jpeg"); });
  const timestamp = new Date().toISOString();
  if (!process.env.CANVAS_VIDEO_DELIVERY_ONLY) {
  const document = { id: canvasId, name: "视频浮层播放器回归", createdAt: timestamp, updatedAt: timestamp, edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [
    { id: "wide-video", type: "video", mediaType: "video", title: "宽版视频 · 本机测试", text: "", x: 70, y: 110, width: 640, height: 360, color: "#77bbcc", video: originalVideo, videoPoster: oldPoster, localVideoPoster: "stale-poster-key", taskId: "stale-video-task", assetId: "stale-video-asset", videoContentUrl: "/videos/stale-video-task/content", taskDiagnostic: { status: "completed", requestId: "stale-request" }, status: "completed" },
    { id: "compact-video", type: "video", title: "紧凑视频 · 本机测试", text: "", x: 775, y: 160, width: 260, height: 150, color: "#77bbcc", video: originalVideo, videoPoster: oldPoster },
    { id: "toolbar-overlap", type: "note", title: "上方图层", text: "上方图层", x: 70, y: 15, width: 260, height: 80, color: "#888888" },
  ] };
  await control({ reset: true, videoMode: "completed", videoTasks: [{ id: "stale-video-task" }], storage: { [`canvas:doc:v1:${canvasId}`]: document } });
  await page.goto(`${base}/#/canvas/${canvasId}`);
  await player("wide-video").waitFor(); await player("compact-video").waitFor();
  const collapse = button("收起画布列表").first(); if (await collapse.isVisible()) await collapse.click();
  await fitCanvas();
  await eventually(async () => { const state = await mediaState("wide-video"); return state.readyState >= 2 && Number.isFinite(state.duration) && state.duration > 2.5; }, "locally recorded finite-duration video loads");
  const initialGeometry = await geometry("wide-video");
  assert.equal((await mediaState("wide-video")).controls, false, "canvas videos use only the custom controls");
  passed("offline generated video loads with a finite duration and without native controls");

  await video("wide-video").click({ position: { x: 120, y: 100 } });
  const toolsTrigger = button("视频工具");
  await toolsTrigger.waitFor({ state: "visible" });
  const toolbarHitOwner = await toolsTrigger.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("[data-node-id]")?.getAttribute("data-node-id");
  });
  assert.equal(toolbarHitOwner, "wide-video", "the selected video toolbar stays above a later overlapping canvas layer");
  passed("the selected video toolbar remains visible and interactive above an overlapping sibling layer");

  await video("wide-video").evaluate(element => element.pause());
  await page.mouse.move(25, 70);
  await eventually(async () => (await mediaState("wide-video")).paused, "leaving the selected video stops its initial hover");
  await video("wide-video").evaluate(element => {
    window.__videoHoverEvents = [];
    element.addEventListener("play", () => window.__videoHoverEvents.push({ muted: element.muted, volume: element.volume, time: element.currentTime }));
  });
  await video("wide-video").hover({ position: { x: 70, y: 70 } });
  await eventually(() => page.evaluate(() => window.__videoHoverEvents.some(event => !event.muted && event.volume > 0)), "audible hover preview starts by default");
  await eventually(async () => { const state = await mediaState("wide-video"); return !state.paused && !state.muted && state.volume > 0; }, "hover preview plays with sound");
  await page.mouse.move(25, 70);
  await eventually(async () => { const state = await mediaState("wide-video"); return state.paused && !state.muted && state.volume > 0; }, "hover departure pauses without changing the default audio preference");
  passed("hover preview plays with sound by default and pauses on departure");

  await video("wide-video").hover({ position: { x: 70, y: 70 } });
  await player("wide-video").getByRole("button", { name: "静音", exact: true }).click();
  assert.equal((await mediaState("wide-video")).muted, true, "muting a hover preview takes manual control");
  await page.mouse.move(25, 70);
  await video("wide-video").hover({ position: { x: 70, y: 70 } });
  await eventually(async () => { const state = await mediaState("wide-video"); return !state.paused && state.muted; }, "hover leaves a user's explicit mute choice unchanged");
  await page.mouse.move(25, 70);
  assert.equal((await mediaState("wide-video")).muted, true, "hover departure preserves explicit mute");
  await video("wide-video").evaluate(element => element.pause());
  passed("hover playback preserves the user's explicit mute preference across re-entry and departure");

  await video("wide-video").hover({ position: { x: 70, y: 70 } });
  await player("wide-video").getByRole("button", { name: "取消静音", exact: true }).click();
  assert.equal((await mediaState("wide-video")).muted, false, "one click unmutes the preview and takes manual control");
  await video("wide-video").evaluate(element => element.pause());
  await page.mouse.move(25, 70);
  passed("one click on unmute takes manual control of a muted hover preview");

  // Test pointer controls separately from hover autoplay. Change the real
  // preference through its UI so moving to a paused button cannot restart it.
  await button("自定义画布").click();
  const settings = page.getByRole("dialog", { name: "自定义画布", exact: true });
  await settings.getByText("视频悬停预览", { exact: true }).click();
  assert.equal(await settings.getByRole("checkbox", { name: "视频悬停预览", exact: true }).isChecked(), false);
  await settings.getByRole("button", { name: "关闭浮窗", exact: true }).click();
  await settings.waitFor({ state: "hidden" });

  await keyboardButton("wide-video", "播放视频");
  await eventually(async () => !(await mediaState("wide-video")).paused, "manual play");
  await pause(180);
  await keyboardButton("wide-video", "暂停视频");
  await eventually(async () => (await mediaState("wide-video")).paused, "manual pause");
  await player("wide-video").getByRole("button", { name: "播放视频", exact: true }).click();
  await eventually(async () => !(await mediaState("wide-video")).paused, "pointer play");
  await player("wide-video").getByRole("button", { name: "暂停视频", exact: true }).click();
  await eventually(async () => (await mediaState("wide-video")).paused, "pointer pause");
  assert.deepEqual(await geometry("wide-video"), initialGeometry);
  passed("manual play/pause changes playback without moving the node");

  const progress = player("wide-video").getByRole("slider", { name: "播放进度", exact: true });
  const scrubRect = await progress.boundingBox(), scrubViewport = await viewport();
  assert.ok(scrubRect);
  await page.mouse.move(scrubRect.x + scrubRect.width * .15, scrubRect.y + scrubRect.height / 2); await page.mouse.down();
  await page.mouse.move(scrubRect.x + scrubRect.width * .7, scrubRect.y + scrubRect.height / 2, { steps: 8 }); await page.mouse.up();
  await eventually(async () => { const state = await mediaState("wide-video"); return state.time > state.duration * .55 && state.time < state.duration * .85; }, "pointer scrubbing updates current time");
  assert.deepEqual(await viewport(), scrubViewport, "scrubbing does not pan or zoom the canvas");
  assert.deepEqual(await geometry("wide-video"), initialGeometry, "scrubbing does not drag the video node");
  await progress.focus(); await progress.press("End");
  for (let index = 0; index < 3; index++) await progress.press("ArrowLeft");
  await eventually(async () => { const state = await mediaState("wide-video"); return state.time > state.duration * .65 && state.time < state.duration && state.paused; }, "keyboard seek reaches the final colored phase while paused");
  const volume = player("wide-video").getByRole("slider", { name: "音量", exact: true });
  await volume.focus(); await volume.press("Home"); await volume.press("ArrowRight");
  await eventually(async () => { const state = await mediaState("wide-video"); return state.volume > 0 && state.volume < .3; }, "volume slider changes media volume");
  await keyboardButton("wide-video", "静音");
  assert.equal((await mediaState("wide-video")).muted, true);
  await keyboardButton("wide-video", "取消静音");
  assert.equal((await mediaState("wide-video")).muted, false);
  assert.deepEqual(await geometry("wide-video"), initialGeometry);
  passed("seek, volume, and mute controls update the media and never drag the canvas node");

  const dragBefore = await geometry("wide-video"), captionRect = await node("wide-video").locator(".node-caption").boundingBox();
  assert.ok(captionRect);
  const captionDragX = captionRect.x + captionRect.width - 8, captionDragY = captionRect.y + captionRect.height / 2;
  await page.mouse.move(captionDragX, captionDragY); await page.mouse.down();
  await page.mouse.move(captionDragX + 55, captionDragY + 35, { steps: 8 }); await page.mouse.up();
  assert.notDeepEqual(await geometry("wide-video"), dragBefore, "the node caption remains draggable");
  await focusCanvas(); await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual(await geometry("wide-video"), dragBefore);
  const videoRect = await video("wide-video").boundingBox();
  assert.ok(videoRect);
  const videoDragX = videoRect.x + videoRect.width * .78, videoDragY = videoRect.y + videoRect.height * .48;
  await page.mouse.move(videoDragX, videoDragY); await page.mouse.down();
  await page.mouse.move(videoDragX + 48, videoDragY + 32, { steps: 8 }); await page.mouse.up();
  assert.notDeepEqual(await geometry("wide-video"), dragBefore, "the video surface remains draggable");
  await focusCanvas(); await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual(await geometry("wide-video"), dragBefore);
  passed("video surface and node caption both drag and remain undoable");

  await video("wide-video").click({ position: { x: 70, y: 55 } });
  const nodeActions = page.getByRole("button", { name: "节点操作", exact: true });
  await nodeActions.click();
  const nodeActionsMenu = page.getByRole("menu", { name: "节点操作菜单", exact: true });
  await nodeActionsMenu.waitFor();
  for (const name of ["复制节点", "下载视频", "删除节点"]) {
    assert.equal(await nodeActionsMenu.getByRole("menuitem", { name, exact: true }).count(), 1);
  }
  await page.keyboard.press("Escape");
  passed("node management actions are grouped in one accessible menu");
  await button("节点属性").click();
  const nodeInspector = page.locator('.inspector[aria-label="节点属性"]');
  await nodeInspector.waitFor({ state: "visible" });
  assert.equal(await nodeInspector.getByLabel("节点名称").count(), 1);
  assert.equal(await nodeInspector.getByRole("button", { name: /继续创作|创建图片/ }).count(), 0, "node properties do not repeat the canvas continuation action");
  await button("关闭节点设置").click();
  await nodeInspector.waitFor({ state: "hidden" });
  passed("media node properties remain available through a dedicated toolbar action");

  await video("wide-video").evaluate(async element => {
    element.pause(); element.currentTime = 0;
    if (element.seeking) await new Promise(resolve => element.addEventListener("seeked", resolve, { once: true }));
  });
  await progress.focus(); await progress.press("Home");
  const beforeSpace = await viewport();
  await keyboardButton("wide-video", "播放视频", "Space");
  await eventually(async () => !(await mediaState("wide-video")).paused, "Space activates play");
  assert.equal(await page.locator(".canvas-board.tool-hand").count(), 0);
  assert.equal(await page.locator(".canvas-board.gesturing").count(), 0);
  assert.deepEqual(await viewport(), beforeSpace);
  await keyboardButton("wide-video", "暂停视频", "Space");
  await eventually(async () => (await mediaState("wide-video")).paused, "Space activates pause");
  assert.deepEqual(await viewport(), beforeSpace);
  passed("Space on player controls does not turn on canvas panning or change the viewport");

  // Paused controls stay visible without a synthetic keyboard-focus ring.
  await focusCanvas();
  for (const [id, name] of [["wide-video", "wide"], ["compact-video", "compact"]]) {
    measurements[name] = await layout(id);
    assert.equal(measurements[name].overflowX, false, `${name} player has no horizontal overflow`);
    assert.equal(measurements[name].overflowY, false, `${name} player has no vertical overflow`);
    assert.ok(measurements[name].controls.every(item => item.inside), `${name} controls remain within the player: ${JSON.stringify(measurements[name].controls)}`);
    await node(id).screenshot({ path: `${artifacts}/video-player-${name}.png` });
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await page.screenshot({ path: `${artifacts}/video-player-canvas.png` });
  passed("wide and compact players keep every visible control inside their bounds");

  if (!process.env.CANVAS_VIDEO_INTERACTION_ONLY) {
  await progress.focus(); await progress.press("End");
  for (let index = 0; index < 3; index++) await progress.press("ArrowLeft");
  await eventually(async () => !(await video("wide-video").evaluate(element => element.seeking)), "seek finishes before capture");
  const currentPixel = await pixel('[data-node-id="wide-video"] [data-canvas-video-player] video');
  assert.ok(currentPixel[2] > currentPixel[0] + 80, `late video frame must be blue, not its first red frame or yellow poster: ${currentPixel}`);
  measurements.capturedTime = (await mediaState("wide-video")).time;
  const videoTools = button("视频工具");
  await videoTools.click();
  const videoToolsMenu = page.getByRole("menu", { name: "视频工具菜单", exact: true });
  await videoToolsMenu.waitFor();
  assert.equal(await videoToolsMenu.getByRole("menuitem").count(), 12, "the menu contains editing and frame capture tools only");
  for (const group of ["剪辑与导出", "画面", "声音"]) {
    assert.equal(await videoToolsMenu.getByRole("group", { name: group, exact: true }).count(), 1, `${group} tools are grouped for scanning`);
  }
  for (const name of ["提取视频", "提取音频", "旋转", "镜像", "调整速度", "文字水印", "移除音轨"]) {
    assert.equal(await videoToolsMenu.getByRole("menuitem", { name, exact: true }).isEnabled(), true, `${name} is implemented locally`);
  }
  assert.equal(await videoToolsMenu.getByRole("menuitem", { name: "格式转换", exact: true }).count(), 0, "format conversion is no longer offered in the video menu");
  for (const name of ["下载原视频", "替换视频"]) {
    assert.equal(await videoToolsMenu.getByRole("menuitem", { name, exact: true }).count(), 0, `${name} is available outside the tools menu`);
  }
  for (const name of ["LUT 调色", "人声分离", "深度视频", "对口型", "倒序", "转动图"]) {
    assert.equal(await videoToolsMenu.getByRole("menuitem", { name, exact: true }).count(), 0, `${name} is not presented without a processing implementation`);
  }
  assert.equal(await videoToolsMenu.getByRole("menuitem", { name: "截取当前帧", exact: true }).isEnabled(), true);
  await page.keyboard.press("Escape");
  await eventually(async () => await videoTools.evaluate(element => document.activeElement === element), "Escape closes the video menu and restores focus");
  const mediaDownloads = [];
  page.on("download", download => mediaDownloads.push(download));
  const downloadsBeforeExtraction = mediaDownloads.length;
  const assertNoExtractionDownloads = () => assert.deepEqual(
    mediaDownloads.slice(downloadsBeforeExtraction).map(download => download.suggestedFilename()).filter(name => !name.endsWith(".json")),
    [], "extraction never downloads media; explicit canvas JSON exports are allowed",
  );
  const sourceBeforeVideoExtraction = await mediaState("wide-video");
  await useVideoTool("提取视频");
  const videoExtractionDialog = page.getByRole("dialog", { name: "提取视频", exact: true });
  assert.equal(await videoExtractionDialog.getByLabel("开始时间").count(), 0, "video extraction has no parameter form");
  assert.equal(await videoExtractionDialog.getByLabel("输出格式").count(), 0, "video extraction does not ask for an output format");
  await eventually(async () => (await page.locator('.node[data-node-id]').count()) >= 4, "video extraction inserts a new canvas node");
  const sourceAfterVideoExtraction = await mediaState("wide-video");
  assert.equal(sourceAfterVideoExtraction.time, sourceBeforeVideoExtraction.time, "copying the source bytes never seeks the source player");
  assert.equal(sourceAfterVideoExtraction.muted, sourceBeforeVideoExtraction.muted, "copying the source bytes preserves the source mute setting");
  assert.equal(sourceAfterVideoExtraction.paused, sourceBeforeVideoExtraction.paused, "copying the source bytes preserves the source playback state");
  assertNoExtractionDownloads();
  let extractedDocument = await exportDocument();
  const extractedVideoNode = extractedDocument.nodes.find(item => item.operationId === "extract-video");
  assert.ok(extractedVideoNode, "video extraction creates a dedicated result node");
  assert.equal(extractedVideoNode.type, "video");
  assert.equal(extractedVideoNode.mediaType, "video");
  assert.equal(extractedVideoNode.resultOf, "wide-video");
  assert.match(extractedVideoNode.localVideo || "", /^proxy-canvas:video:v1:/, "video extraction stores bytes in the local video cache");
  assert.ok(extractedVideoNode.id && await node(extractedVideoNode.id).evaluate(element => element.classList.contains("selected")), "the extracted video node is selected");
  assert.ok(extractedDocument.videoAssets && extractedDocument.videoAssets[extractedVideoNode.localVideo], "canvas export includes extracted video bytes");
  assert.deepEqual(Buffer.from(extractedDocument.videoAssets[extractedVideoNode.localVideo].base64, "base64"), Buffer.from(originalVideo.split(",")[1], "base64"), "video extraction preserves the original bytes without MediaRecorder re-encoding");
  passed("video extraction copies the original bytes into a selected local node without a download, parameters, or source playback changes");

  // The next tool belongs to the source video. Restore that selection after
  // each extraction so the toolbar never silently targets the derived node.
  // The note deliberately overlaps the source caption. Select the uncovered
  // picture instead of depending on the caption's center being a safe hit.
  await video("wide-video").click({ position: { x: 70, y: 55 } });
  await eventually(async () => await button("视频工具").isVisible(), "source video toolbar is restored after video extraction");
  await video("wide-video").evaluate(async element => {
    element.pause(); element.muted = true; element.currentTime = 1.5;
    if (element.seeking) await new Promise(resolve => element.addEventListener("seeked", resolve, { once: true }));
  });
  const sourceBeforeAudioExtraction = await mediaState("wide-video");
  await useVideoTool("提取音频");
  const audioExtractionDialog = page.getByRole("dialog", { name: "提取音频", exact: true });
  await audioExtractionDialog.waitFor();
  assert.equal(await audioExtractionDialog.getByLabel("开始时间").count(), 0, "audio extraction has no parameter form");
  assert.equal(await audioExtractionDialog.getByLabel("输出格式").count(), 0, "audio extraction does not ask for an output format");
  await eventually(async () => (await page.locator('.node[data-node-id]').count()) >= 5, "audio extraction inserts a new canvas node");
  const sourceAfterAudioExtraction = await mediaState("wide-video");
  assert.equal(sourceAfterAudioExtraction.time, sourceBeforeAudioExtraction.time, "audio extraction restores the source playback position");
  assert.equal(sourceAfterAudioExtraction.muted, sourceBeforeAudioExtraction.muted, "audio extraction preserves the source mute setting");
  assert.equal(sourceAfterAudioExtraction.paused, sourceBeforeAudioExtraction.paused, "audio extraction preserves the source playback state");
  assertNoExtractionDownloads();
  extractedDocument = await exportDocument();
  const extractedAudioNode = extractedDocument.nodes.find(item => item.operationId === "extract-audio");
  assert.ok(extractedAudioNode, "audio extraction creates a dedicated result node");
  assert.equal(extractedAudioNode.type, "audio");
  assert.equal(extractedAudioNode.mediaType, "audio");
  assert.equal(extractedAudioNode.resultOf, "wide-video");
  assert.match(extractedAudioNode.localAudio || "", /^proxy-canvas:audio:v1:/, "audio extraction stores bytes in the local audio cache");
  assert.ok(extractedAudioNode.id && await node(extractedAudioNode.id).evaluate(element => element.classList.contains("selected")), "the extracted audio node is selected");
  assert.ok(extractedDocument.audioAssets && extractedDocument.audioAssets[extractedAudioNode.localAudio], "canvas export includes extracted audio bytes");
  const extractedAudioSamples = await page.evaluate(async base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(bytes.buffer);
      const samples = audio.getChannelData(0);
      let energy = 0;
      for (let index = 0; index < samples.length; index++) energy += samples[index] ** 2;
      return { duration: audio.duration, rms: Math.sqrt(energy / samples.length) };
    } finally { await context.close(); }
  }, extractedDocument.audioAssets[extractedAudioNode.localAudio].base64);
  assert.ok(extractedAudioSamples.duration > 4, `audio extraction preserves the full track duration: ${extractedAudioSamples.duration}`);
  assert.ok(extractedAudioSamples.rms > 0.005, `audio extraction contains audible source samples: ${extractedAudioSamples.rms}`);
  measurements.extractedAudioSamples = extractedAudioSamples;
  passed("audio extraction creates and selects a local audio node without a media download or parameter form");

  // Both derived nodes are regular document transactions and must participate
  // in undo/redo and reload recovery just like a manually inserted asset.
  await focusCanvas(); await page.keyboard.press("ControlOrMeta+z");
  await eventually(async () => await node(extractedAudioNode.id).count() === 0, "undo removes the extracted audio node");
  assert.equal(await node(extractedVideoNode.id).count(), 1, "undoing audio extraction preserves the preceding video result");
  await page.keyboard.press("ControlOrMeta+z");
  await eventually(async () => await node(extractedVideoNode.id).count() === 0, "undo removes the extracted video node");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await eventually(async () => await node(extractedVideoNode.id).count() === 1, "redo restores the extracted video node");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await eventually(async () => await node(extractedAudioNode.id).count() === 1, "redo restores the extracted audio node");
  assertNoExtractionDownloads();
  await button("保存画布").click();
  await eventually(async () => /已保存/.test(await page.locator("body").innerText()), "extracted nodes are saved before reload");
  await page.goto("about:blank"); await page.goto(`${base}/#/canvas/${canvasId}`);
  await node(extractedVideoNode.id).waitFor(); await node(extractedAudioNode.id).waitFor();
  const reloadedDocument = await exportDocument();
  assert.match(reloadedDocument.nodes.find(item => item.id === extractedVideoNode.id)?.localVideo || "", /^proxy-canvas:video:v1:/, "reload preserves the extracted video cache reference");
  assert.match(reloadedDocument.nodes.find(item => item.id === extractedAudioNode.id)?.localAudio || "", /^proxy-canvas:audio:v1:/, "reload preserves the extracted audio cache reference");
  passed("extracted nodes support undo/redo and survive a canvas reload with their local cache references");

  // A local result can itself be extracted, sharing its immutable cache entry
  // while still creating a separate node and a separate undo transaction.
  await player(extractedVideoNode.id).waitFor();
  await eventually(async () => (await mediaState(extractedVideoNode.id)).readyState >= 2, "the extracted local video can be played after reload");
  await video(extractedVideoNode.id).click({ position: { x: 70, y: 55 } });
  const localVideoBeforeExtraction = await mediaState(extractedVideoNode.id);
  await useVideoTool("提取视频");
  await eventually(async () => (await page.locator('.node[data-node-id]').count()) === reloadedDocument.nodes.length + 1, "re-extracting a local video inserts an independent node");
  const repeatedDocument = await exportDocument();
  const repeatedVideoNode = repeatedDocument.nodes.find(item => item.operationId === "extract-video" && item.id !== extractedVideoNode.id);
  assert.ok(repeatedVideoNode, "a repeated extraction creates another video node");
  assert.equal(repeatedVideoNode.localVideo, extractedVideoNode.localVideo, "extracting a local video reuses its immutable localVideo entry");
  assert.equal(repeatedVideoNode.operationParams?.sourceNodeId, extractedVideoNode.id, "the repeated result records its immediate source");
  assert.equal(repeatedVideoNode.resultOf, extractedVideoNode.id);
  assert.equal(Object.keys(repeatedDocument.videoAssets).length, 1, "the backup contains one shared video payload after repeated extraction");
  assert.deepEqual(Buffer.from(repeatedDocument.videoAssets[repeatedVideoNode.localVideo].base64, "base64"), Buffer.from(originalVideo.split(",")[1], "base64"), "repeated extraction keeps the original video bytes");
  const localVideoAfterExtraction = await mediaState(extractedVideoNode.id);
  assert.equal(localVideoAfterExtraction.time, localVideoBeforeExtraction.time);
  assert.equal(localVideoAfterExtraction.muted, localVideoBeforeExtraction.muted);
  assert.equal(localVideoAfterExtraction.paused, localVideoBeforeExtraction.paused);
  assertNoExtractionDownloads();
  await focusCanvas(); await page.keyboard.press("ControlOrMeta+z");
  await eventually(async () => await node(repeatedVideoNode.id).count() === 0, "undo removes only the repeated extraction node");
  assert.equal(await node(extractedVideoNode.id).count(), 1, "undo keeps the shared cache source node");
  passed("repeated local-video extraction shares the original cached bytes without disturbing source playback or undo ownership");

  await video("wide-video").click({ position: { x: 70, y: 55 } });
  await video("wide-video").evaluate((element, time) => { element.pause(); element.currentTime = time; }, measurements.capturedTime);
  await eventually(async () => !(await video("wide-video").evaluate(element => element.seeking)), "restore the pre-reload playhead for later frame checks");
  await useVideoTool("文字水印");
  const watermarkDialog = page.getByRole("dialog", { name: "文字水印", exact: true });
  assert.equal(await watermarkDialog.getByRole("button", { name: "开始处理", exact: true }).isEnabled(), false, "watermark export requires text");
  await watermarkDialog.getByLabel("水印文字").fill("LOCAL TEST");
  assert.equal(await watermarkDialog.getByRole("button", { name: "开始处理", exact: true }).isEnabled(), true, "watermark export is enabled when text is provided");
  await watermarkDialog.getByRole("button", { name: "取消", exact: true }).click();
  await useVideoTool("调整速度");
  const speedDialog = page.getByRole("dialog", { name: "调整速度", exact: true });
  const processingStarted = Date.now();
  await speedDialog.getByRole("button", { name: "开始处理", exact: true }).click();
  await speedDialog.getByRole("button", { name: "取消处理", exact: true }).click();
  await speedDialog.waitFor({ state: "hidden", timeout: 2000 });
  assert.ok(Date.now() - processingStarted < 2000, "cancel exits recording instead of waiting for the export timeout");
  passed("video tool cancellation closes the active recording immediately");
  await useVideoTool("截取当前帧");
  await eventually(async () => await page.locator(".node.image img.node-image").count() === 1, "captured image node is added");
  await page.locator(".node.image img.node-image").evaluate(image => image.decode());
  const capturedPixel = await pixel(".node.image img.node-image");
  measurements.currentPixel = currentPixel; measurements.capturedPixel = capturedPixel;
  assert.ok(capturedPixel.every((value, index) => Math.abs(value - currentPixel[index]) <= 18), `captured pixels must match the actual current frame: ${currentPixel} vs ${capturedPixel}`);
  await page.locator(".node.image").screenshot({ path: `${artifacts}/video-player-captured-frame.png` });
  // Capturing leaves focus on its player button. Undo must remain available
  // immediately, without requiring another click on the board.
  await page.keyboard.press("ControlOrMeta+z");
  await eventually(async () => await page.locator(".node.image").count() === 0, "one undo removes the captured image");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await eventually(async () => await page.locator(".node.image").count() === 1, "redo restores the captured image while player focus is preserved");
  const capturedDocument = await exportDocument();
  const capturedNode = capturedDocument.nodes.find(item => item.operationId === "video-frame");
  assert.ok(capturedNode, "captured node has a dedicated video-frame operation");
  assert.equal(capturedNode.operationParams?.sourceNodeId, "wide-video");
  assert.equal(capturedNode.resultOf, undefined, "a frame is not a generated result that can collapse the source creator");
  assert.equal(await player("wide-video").isVisible(), true, "capture and redo preserve the source player");
  await focusCanvas(); await page.keyboard.press("ControlOrMeta+z");
  await eventually(async () => await page.locator(".node.image").count() === 0, "remove the redone frame before remaining checks");
  await fitCanvas();
  passed("capture matches the actual seeked frame; immediate undo/redo works and preserves the source");

  const beforeRejectedUpload = await exportNode("wide-video");
  const imageFile = await readFile(new URL("./fixtures/aspect-ratio.png", import.meta.url));
  const invalidChooser = page.waitForEvent("filechooser");
  await player("wide-video").getByRole("button", { name: "替换视频", exact: true }).click();
  const rejectedChooser = await invalidChooser;
  const accept = await rejectedChooser.element().getAttribute("accept");
  assert.ok(accept?.includes("video") && !accept.includes("image"), "replacement file picker accepts videos only");
  await rejectedChooser.setFiles({ name: "not-a-video.png", mimeType: "image/png", buffer: imageFile });
  await eventually(async () => /请选择.*视频|只支持.*视频|仅支持.*视频|视频文件/.test(await page.locator("body").innerText()), "image replacement is rejected with a video-specific message");
  const afterRejectedUpload = await exportNode("wide-video");
  for (const key of ["type", "video", "videoPoster", "taskId", "assetId", "title"]) assert.equal(afterRejectedUpload[key], beforeRejectedUpload[key], `invalid image upload preserves ${key}`);
  passed("video replacement rejects images without changing the original node");

  const validChooser = page.waitForEvent("filechooser");
  await player("wide-video").getByRole("button", { name: "替换视频", exact: true }).click();
  await (await validChooser).setFiles({ name: "replacement-local.webm", mimeType: "video/webm", buffer: Buffer.from(replacementVideo.split(",")[1], "base64") });
  await eventually(async () => { const state = await mediaState("wide-video"); return state.readyState >= 2 && state.source.startsWith("blob:"); }, "replacement local video loads from the browser cache");
  const replacedDocument = await exportDocument();
  const replaced = replacedDocument.nodes.find(item => item.id === "wide-video");
  assert.equal(replaced.type, "video"); assert.equal(replaced.title, "replacement-local.webm"); assert.equal(replaced.video, undefined);
  assert.match(replaced.localVideo || "", /^proxy-canvas:video:v1:/, "replacement stores a browser-local video cache key");
  assert.ok(replacedDocument.videoAssets?.[replaced.localVideo], "replacement export includes the cached video bytes");
  assert.deepEqual(Buffer.from(replacedDocument.videoAssets[replaced.localVideo].base64, "base64"), Buffer.from(replacementVideo.split(",")[1], "base64"), "replacement cache keeps the original bytes");
  for (const key of ["taskId", "assetId", "videoContentUrl", "taskDiagnostic", "videoSubmission", "submission", "error"]) assert.equal(replaced[key], undefined, `replacement clears obsolete ${key}`);
  assert.notEqual(replaced.videoPoster, oldPoster, "the previous video's poster must not survive replacement");
  assert.notEqual(replaced.localVideoPoster, "stale-poster-key", "the old cached poster must not be revived");
  await pause(300);
  assert.notEqual((await mediaState("wide-video")).poster, oldPoster);
  passed("replacement clears stale task, asset, URL, and poster metadata");

  await page.keyboard.press("ControlOrMeta+z");
  await eventually(async () => (await mediaState("wide-video")).source === originalVideo, "undo restores the original video source");
  const restoredVideo = await exportNode("wide-video");
  assert.equal(restoredVideo.video, originalVideo);
  assert.equal(restoredVideo.taskId, "stale-video-task");
  assert.equal(restoredVideo.assetId, "stale-video-asset");
  assert.equal(restoredVideo.videoContentUrl, "/videos/stale-video-task/content");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await eventually(async () => { const state = await mediaState("wide-video"); return state.readyState >= 2 && state.source.startsWith("blob:"); }, "redo restores the replacement video source");
  const redoneDocument = await exportDocument();
  const redoneVideo = redoneDocument.nodes.find(item => item.id === "wide-video");
  assert.equal(redoneVideo.video, undefined);
  assert.match(redoneVideo.localVideo || "", /^proxy-canvas:video:v1:/);
  assert.deepEqual(Buffer.from(redoneDocument.videoAssets[redoneVideo.localVideo].base64, "base64"), Buffer.from(replacementVideo.split(",")[1], "base64"));
  for (const key of ["taskId", "assetId", "videoContentUrl", "taskDiagnostic"]) assert.equal(redoneVideo[key], undefined, `replacement redo does not resurrect ${key}`);
  assert.notEqual(redoneVideo.videoPoster, oldPoster);
  passed("replacement undo restores the original source and identity; redo restores only the new media");

  await fitCanvas();
  await video("wide-video").dblclick({ position: { x: 70, y: 55 } });
  const gallery = page.getByRole("dialog", { name: "视频预览", exact: true });
  await gallery.waitFor();
  const galleryPlayer = gallery.locator("[data-canvas-media-player]"), galleryVideo = galleryPlayer.locator("video");
  const galleryMediaState = () => galleryVideo.evaluate(element => ({ paused: element.paused, muted: element.muted, volume: element.volume, readyState: element.readyState }));
  await eventually(async () => { const state = await galleryMediaState(); return state.readyState >= 2 && !state.paused && !state.muted && state.volume > 0; }, "gallery starts playing with sound by default");
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
  await galleryPlayer.getByRole("button", { name: "全屏", exact: true }).click();
  await eventually(() => page.evaluate(() => Boolean(document.fullscreenElement)), "gallery enters browser fullscreen");
  assert.equal((await galleryMediaState()).muted, false, "fullscreen keeps default playback audible");
  assert.ok((await galleryMediaState()).volume > 0, "fullscreen keeps a nonzero default volume");
  await galleryPlayer.getByRole("button", { name: "静音", exact: true }).click();
  assert.equal((await galleryMediaState()).muted, true, "fullscreen allows an explicit mute choice");
  await galleryPlayer.getByRole("button", { name: "退出全屏", exact: true }).click();
  await eventually(() => page.evaluate(() => !document.fullscreenElement), "gallery exits browser fullscreen");
  assert.equal((await galleryMediaState()).muted, true, "leaving fullscreen preserves explicit mute");
  await galleryPlayer.getByRole("button", { name: "全屏", exact: true }).click();
  await eventually(() => page.evaluate(() => Boolean(document.fullscreenElement)), "gallery re-enters browser fullscreen");
  assert.equal((await galleryMediaState()).muted, true, "re-entering fullscreen preserves explicit mute");
  await galleryPlayer.getByRole("button", { name: "退出全屏", exact: true }).click();
  await eventually(() => page.evaluate(() => !document.fullscreenElement), "gallery leaves fullscreen before closing");
  await button("关闭画廊").click();
  await gallery.waitFor({ state: "hidden" });
  passed("gallery and fullscreen default to audible playback while fullscreen transitions preserve explicit mute");

  await focusCanvas();
  const legacyId = "video-player-legacy-prompt";
  await control({ storage: { [`canvas:doc:v1:${legacyId}`]: {
    id: legacyId, name: "旧版内联视频截帧回归", createdAt: timestamp, updatedAt: timestamp, edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ id: "legacy-video", type: "prompt", mediaType: "video", title: "旧版内联视频", text: "", x: 200, y: 140, width: 420, height: 240, color: "#77bbcc", video: originalVideo, videoPoster: oldPoster, status: "completed" }],
  } } });
  // A hash-only change intentionally reuses the loaded library. This document
  // was just seeded out-of-band, so bootstrap a new page to discover it.
  await page.goto("about:blank");
  await page.goto(`${base}/#/canvas/${legacyId}`);
  await player("legacy-video").waitFor();
  await eventually(async () => (await mediaState("legacy-video")).readyState >= 2, "legacy inline video loads");
  assert.equal(await player("legacy-video").getByRole("button", { name: "替换视频", exact: true }).count(), 0, "a creator's inline result must not offer value-node replacement");
  await keyboardButton("legacy-video", "截取当前帧");
  await eventually(async () => await page.locator(".node.image img.node-image").count() === 1, "legacy inline video's frame is inserted");
  assert.equal(await player("legacy-video").isVisible(), true, "a derived frame never collapses the original prompt video");
  const legacyDocument = await exportDocument();
  const legacyFrame = legacyDocument.nodes.find(item => item.operationId === "video-frame");
  assert.equal(legacyFrame?.operationParams?.sourceNodeId, "legacy-video");
  assert.equal(legacyFrame?.resultOf, undefined);
  assert.equal(legacyDocument.edges.some(edge => edge.from === "legacy-video" && edge.to === legacyFrame?.id), false);
  passed("capturing a legacy inline prompt video leaves the original video visible and independent");
  }
  }

  if (!process.env.CANVAS_VIDEO_INTERACTION_ONLY) {
  // Serve the browser-recorded video on a different local origin, with a
  // signature in the ordinary task/asset response. No signing API exists.
  const deliveryAssetId = "signed-video-asset", deliveryTaskId = "signed-video-task";
  await context.addCookies([{ name: "fixture_app_session", value: "must-not-reach-cos", url: base, sameSite: "Lax" }]);
  await control({ videoDataURL: originalVideo, videoMode: "completed", videoTasks: [{ id: deliveryTaskId, assetId: deliveryAssetId }], assets: [{ id: deliveryAssetId, task_id: deliveryTaskId, type: "video", name: "Signed COS fixture" }] });
  const delivery = await (await fetch(`${api}/v1/videos/${deliveryTaskId}`)).json();
  assert.ok(delivery.content_url?.startsWith(`${api}/__fixture/cos/videos/`));
  assert.equal(delivery.asset_id, deliveryAssetId);
  const deliveryNode = { id: "signed-video", type: "video", mediaType: "video", title: "签名视频直连回归", text: "", x: 160, y: 140, width: 640, height: 360, color: "#77bbcc", status: "completed", assetId: deliveryAssetId, taskId: deliveryTaskId, videoContentUrl: delivery.content_url, videoContentUrlExpiresAt: delivery.content_url_expires_at, videoPoster: oldPoster };
  const openDeliveryDocument = async (id, patch) => {
    await control({ storage: { [`canvas:doc:v1:${id}`]: { id, name: "视频交付回归", createdAt: timestamp, updatedAt: new Date().toISOString(), edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [{ ...deliveryNode, ...patch }] } } });
    await page.goto("about:blank");
    const start = (await fixtureState()).requests.length;
    await page.goto(`${base}/#/canvas/${id}`);
    await node("signed-video").waitFor();
    // Source resolution is automatic for videos in the viewport; opening this
    // document must not require a click on its poster or empty state.
    await player("signed-video").waitFor();
    await eventually(async () => (await mediaState("signed-video")).readyState >= 2, `signed URL playback for ${id}`);
    const state = await mediaState("signed-video");
    assert.ok(state.source.startsWith(`${api}/__fixture/cos/videos/`), `player reads COS directly, not a blob or gateway: ${state.source}`);
    return { start, requests: (await fixtureState()).requests.slice(start) };
  };
  const direct = await openDeliveryDocument("video-delivery-direct", {});
  assert.ok(direct.requests.some(entry => entry.storage === "cos"), "browser reads signed COS bytes");
  assert.equal(direct.requests.some(entry => entry.path === `/v1/videos/${deliveryTaskId}` || entry.path === `/v1/media/assets/${deliveryAssetId}`), false, "an already delivered usable URL needs no extra business/signing request");
  passed("already delivered signed URLs play directly from COS without another signature, task, or content request");

  const beforeDownload = (await fixtureState()).requests.length;
  await node("signed-video").locator(".node-caption").click();
  const downloadedVideo = page.waitForEvent("download");
  await button("节点操作").click();
  await page.getByRole("menu", { name: "节点操作菜单", exact: true }).getByRole("menuitem", { name: "下载视频", exact: true }).click();
  const savedVideo = await downloadedVideo;
  assert.match(savedVideo.suggestedFilename(), /\.webm$/);
  assert.deepEqual(await readFile(await savedVideo.path()), Buffer.from(originalVideo.split(",")[1], "base64"));
  const downloadedRequests = (await fixtureState()).requests.slice(beforeDownload);
  assert.ok(downloadedRequests.some(entry => entry.storage === "cos"));
  assert.equal(downloadedRequests.some(entry => entry.path.endsWith("/content")), false);
  passed("video download reads signed COS bytes and preserves the real WebM file instead of saving an API response");

  const beforeAgentExport = (await fixtureState()).requests.length;
  const exported = await page.evaluate(async () => {
    // Import the same Vite-resolved SDK singleton used by the real registration
    // module, then invoke the registered read-only media capability.
    const source = await (await fetch("/src/agent-registration.ts")).text();
    const specifier = /from\s+["']([^"']*proxy-app-sdk[^"']*)["']/.exec(source)?.[1];
    if (!specifier) throw new Error("Cannot locate the SDK used by this fixture");
    const sdk = await import(specifier);
    return sdk.dispatchAgentInvocation({ requestId: "fixture-video-export", appId: "app.proxy.canvas", appVersion: "fixture", capability: "read_media", args: { node_id: "signed-video" }, signal: new AbortController().signal });
  });
  assert.equal(exported.mimeType, "video/webm");
  assert.equal(exported.totalBytes, Buffer.from(originalVideo.split(",")[1], "base64").length);
  assert.deepEqual(Buffer.from(exported.dataBase64, "base64"), Buffer.from(originalVideo.split(",")[1], "base64").subarray(0, Buffer.from(exported.dataBase64, "base64").length));
  assert.ok((await fixtureState()).requests.slice(beforeAgentExport).some(entry => entry.storage === "cos"));
  passed("registered Agent read_media exports the same COS video without gateway content forwarding");

  const expired = await openDeliveryDocument("video-delivery-expired", { videoContentUrlExpiresAt: "2000-01-01T00:00:00Z" });
  assert.ok(expired.requests.some(entry => entry.path === `/v1/media/assets/${deliveryAssetId}`), "expired delivery refreshes existing asset details");
  const restored = await openDeliveryDocument("video-delivery-asset-only", { taskId: undefined, videoContentUrl: undefined, videoContentUrlExpiresAt: undefined, videoPoster: undefined });
  assert.ok(restored.requests.some(entry => entry.path === `/v1/media/assets/${deliveryAssetId}`), "asset-only restoration reads the existing asset");
  const legacyRestored = await openDeliveryDocument("video-delivery-legacy-proxy", { assetId: undefined, videoContentUrl: `/videos/${deliveryTaskId}/content`, videoContentUrlExpiresAt: undefined, videoPoster: undefined });
  assert.ok(legacyRestored.requests.some(entry => entry.path === `/v1/videos/${deliveryTaskId}`), "legacy proxy restoration reads existing task details");
  const deliveryRequests = (await fixtureState()).requests.slice(direct.start);
  assert.equal(deliveryRequests.some(entry => entry.method === "POST" && entry.path === "/v1/videos"), false, "recovery never creates a new generation");
  assert.equal(deliveryRequests.some(entry => entry.path.endsWith("/content") || /\/(sign|play-url)(?:\/|$)/.test(entry.path)), false, "delivery never uses content forwarding or a dedicated signature API");
  assert.ok(deliveryRequests.filter(entry => entry.storage === "cos").every(entry => !entry.hasAuthorization && !entry.hasCookie), "COS receives no application authorization or cookies");
  measurements.delivery = { cosReads: deliveryRequests.filter(entry => entry.storage === "cos").length, assetReads: deliveryRequests.filter(entry => entry.path === `/v1/media/assets/${deliveryAssetId}`).length, taskReads: deliveryRequests.filter(entry => entry.path === `/v1/videos/${deliveryTaskId}`).length };
  passed("expired URLs, asset-only canvases and legacy content nodes recover through existing details without a generation POST");

  // Mount the actual exported components in an isolated React root. Synthetic
  // media events make decoder/network races deterministic without invalid
  // provider files, timers measured in minutes, or a second React installation.
  measurements.componentRecovery = await page.evaluate(async ({ signedURL, assetId }) => {
    const [previewSource, mainSource] = await Promise.all([fetch("/src/MediaPreview.tsx").then(response => response.text()), fetch("/src/main.tsx").then(response => response.text())]);
    const reactPath = /from\s+["']([^"']*\/react\.js[^"']*)["']/.exec(previewSource)?.[1];
    const domPath = /from\s+["']([^"']*\/react-dom_client\.js[^"']*)["']/.exec(mainSource)?.[1];
    if (!reactPath || !domPath) throw new Error("Cannot locate the real fixture React runtime");
    const React = (await import(reactPath)).default;
    const dom = await import(domPath), createRoot = dom.createRoot || dom.default.createRoot;
    const MediaPreview = (await import("/src/MediaPreview.tsx")).default;
    const CanvasVideo = (await import("/src/CanvasVideo.tsx")).default;
    const flush = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const until = async (predicate, reason) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) { if (Date.now() >= deadline) throw new Error(reason); await new Promise(resolve => setTimeout(resolve, 20)); }
    };
    const assert = (condition, reason) => { if (!condition) throw new Error(reason); };
    const host = document.createElement("div");
    host.dataset.fixtureVideoEdges = "true";
    Object.assign(host.style, { position: "fixed", inset: "80px 20px auto auto", width: "640px", height: "420px", background: "#111", zIndex: "999999" });
    document.body.append(host);
    let root = createRoot(host);
    const nodeFor = source => ({ id: "same-logical-node", type: "video", title: "Delivery race fixture", assetId, video: source });
    const renderPreview = (node, retry) => root.render(React.createElement(MediaPreview, { node, items: [node], index: 0, sources: [], error: "", onSelect() {}, onLocate() {}, onVideoRetry: retry }));
    const freshRoot = async () => { root.unmount(); root = createRoot(host); await flush(); };
    const media = () => host.querySelector("video");
    const results = {};
    try {
      let finishOld, oldCalls = 0;
      const delayed = () => { oldCalls++; return new Promise(resolve => { finishOld = resolve; }); };
      renderPreview(nodeFor(`${signedURL}#previous-source`), delayed);
      await until(() => media()?.readyState >= 2, "old preview source loads");
      media().dispatchEvent(new Event("error"));
      await until(() => oldCalls === 1, "old source enters a deferred metadata recovery");
      renderPreview(nodeFor(`${signedURL}#replacement-source`), delayed);
      await until(() => media()?.currentSrc.endsWith("#replacement-source") && media().readyState >= 2, "same-id replacement preview loads");
      finishOld(false); await flush();
      assert(media()?.currentSrc.endsWith("#replacement-source"), "late false from the old recovery must not hide the same-id replacement video");
      assert(!host.querySelector('[role="alert"]'), "old source errors must not cover a new video");
      results.lateFailureIgnored = true;

      await freshRoot();
      let shortCalls = 0;
      renderPreview({ ...nodeFor(signedURL), videoContentUrlExpiresAt: new Date(Date.now() + 20_000).toISOString() }, () => { shortCalls++; return true; });
      await until(() => media()?.readyState >= 2, "an unexpired URL with less than 30 seconds remaining still renders and plays");
      assert(shortCalls === 0, "rendering a delivered unexpired source must not request a signature refresh");
      results.shortRemainingLifetimePlayable = true;

      for (const component of ["gallery", "canvas"]) {
        await freshRoot();
        let retries = 0;
        const retry = async () => { retries++; return true; };
        if (component === "gallery") renderPreview(nodeFor(`${signedURL}#gallery-budget`), retry);
        else root.render(React.createElement(CanvasVideo, { src: `${signedURL}#canvas-budget`, label: "Recovery budget", recoveryKey: assetId, hoverPreview: false, onSelect() {}, onPreview() {}, onCaptureFrame() {}, onRetry: retry }));
        await until(() => media()?.readyState >= 2, `${component} initial video loads`);
        media().dispatchEvent(new Event("error"));
        await until(() => retries === 1, `${component} makes one automatic recovery`);
        await flush();
        await until(() => media()?.readyState >= 2, `${component} refreshed decoder receives a valid first frame`);
        media().dispatchEvent(new Event("loadeddata")); await flush();
        media().dispatchEvent(new Event("error")); await flush();
        assert(retries === 1, `${component} must not reset its automatic recovery budget after loadeddata`);
        results[`${component}AutomaticRetryCount`] = retries;
      }

      return results;
    } finally { root.unmount(); host.remove(); }
  }, { signedURL: delivery.content_url, assetId: deliveryAssetId });
  passed("same-id source replacement ignores a late failure from the previous gallery recovery");
  passed("gallery plays a delivered URL with less than 30 seconds remaining without treating it as expired");
  passed("gallery and canvas each recover automatically only once across error, loadeddata, and a later error");
  await control({ videoCorsEnabled: false });
  const withoutCors = await openDeliveryDocument("video-delivery-no-cors", {});
  assert.ok(withoutCors.requests.some(entry => entry.path === `/v1/media/assets/${deliveryAssetId}`), "the failed signed source refreshes through the existing asset detail endpoint");
  assert.equal(await video("signed-video").getAttribute("crossorigin"), null, "playback fallback omits crossOrigin after the refreshed source still fails");
  passed("a refreshed signed video remains playable when COS omits CORS headers; readback still requires CORS");

  assert.deepEqual(unexpectedNetworks, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  }
  await writeFile(`${artifacts}/video-player-result.json`, JSON.stringify({ passed: true, checks, measurements, errors, consoleErrors, unexpectedNetworks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, artifacts }));
} catch (error) {
  if (page) await page.screenshot({ path: `${artifacts}/video-player-failure.png`, timeout: 5000 }).catch(() => {});
  await writeFile(`${artifacts}/video-player-result.json`, JSON.stringify({ passed: false, error: String(error), checks, measurements, errors, consoleErrors, unexpectedNetworks }, null, 2));
  await writeFile(`${artifacts}/video-player-fixture.log`, fixtureOutput);
  console.error(JSON.stringify({ checks, measurements, errors, consoleErrors, unexpectedNetworks }));
  throw error;
} finally {
  await context?.close(); await browser?.close();
  fixture.kill("SIGTERM");
  if (fixture.exitCode === null && fixture.signalCode === null) await new Promise(resolve => {
    const timeout = setTimeout(resolve, 5000);
    fixture.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
