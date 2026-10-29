/** Cloud projection drops browser-local media without attempting an upload. Uses isolated ports 5201/5202. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "http://127.0.0.1:5201";
const api = "http://127.0.0.1:5202";
const canvasId = "local-media-hosting-e2e";
const cloudKey = `canvas:doc:v1:${canvasId}`;
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5201", "--api-port=5202"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Cloud media fixture did not become ready")), 20000);
  fixture.stdout.on("data", (chunk) => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); }
  });
  fixture.stderr.on("data", (chunk) => { fixtureOutput += chunk.toString(); });
  fixture.once("error", (error) => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0) reject(new Error(`Cloud media fixture exited ${code}: ${fixtureOutput}`));
  });
});
let browser;
const contexts = [];
const errors = [];
const state = async () => (await fetch(`${api}/__fixture/state`)).json();
const control = async (body) => {
  const response = await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
};
const eventually = async (check, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const openPage = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__cloud-media-seed", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Canvas local media seed</title>",
  }));
  return page;
};

try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  await control({ reset: true, hostFailuresRemaining: 1 });
  const first = await openPage();
  await first.goto(`${base}/__cloud-media-seed`);
  await first.evaluate(async (id) => {
    const now = new Date().toISOString();
    const { setLocalStorageScope } = await import("/src/local-storage-scope.ts");
    const { storeInlineImages } = await import("/src/image-cache.ts");
    const { storeLocalAudio } = await import("/src/audio-cache.ts");
    const { storeLocalVideo } = await import("/src/video-cache.ts");
    const { saveCanvas } = await import("/src/library-store.ts");
    setLocalStorageScope("acs_" + "f".repeat(64));
    const localVideo = await storeLocalVideo(new Blob(["fixture-video"], { type: "video/mp4" }));
    const localAudio = await storeLocalAudio(new Blob(["fixture-audio"], { type: "audio/mpeg" }));
    const document = {
      id,
      name: "本地素材同步闭环",
      createdAt: now,
      updatedAt: now,
      nodes: [{
        id: "local-image",
        type: "image",
        title: "本机参考图",
        text: "",
        x: 120,
        y: 120,
        width: 320,
        height: 220,
        color: "#77bbcc",
        image: "data:image/png;base64,iVBORw0KGgo=",
        uploadState: "uploading",
        uploadProgress: 37,
        uploadError: "fixture-only transient state",
        embeddedReferences: [
          { id: "local-video", title: "本机视频", mediaType: "video", localVideo },
          { id: "local-audio", title: "本机音频", mediaType: "audio", localAudio },
        ],
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const cached = await storeInlineImages(document);
    await saveCanvas(cached, { queueCloudSync: true });
  }, canvasId);

  await first.goto(`${base}/#/canvas/${canvasId}`);
  await first.getByLabel("无限创作画布").waitFor();
  await eventually(async () => Boolean((await state()).storage[cloudKey]), "cloud projection saves the document");
  const snapshot = await state();
  const remote = snapshot.storage[cloudKey];
  assert.equal(remote.nodes[0].assetId, undefined, "projection does not invent an asset identity");
  assert.equal(remote.nodes[0].image, undefined, "cloud KV never stores inline image bytes");
  assert.equal(remote.nodes[0].localImage, undefined, "cloud KV never stores a browser cache key");
  assert.equal(remote.nodes[0].uploadState, undefined, "upload placeholders do not block cloud projection");
  assert.equal(remote.nodes[0].uploadProgress, undefined, "upload progress is not cloud state");
  assert.equal(remote.nodes[0].uploadError, undefined, "upload errors are not cloud state");
  assert.equal(remote.nodes[0].embeddedReferences[0].assetId, undefined, "temporary video references are omitted");
  assert.equal(remote.nodes[0].embeddedReferences[0].localVideo, undefined, "embedded video cache keys are omitted");
  assert.equal(remote.nodes[0].embeddedReferences[1].assetId, undefined, "temporary audio references are omitted");
  assert.equal(remote.nodes[0].embeddedReferences[1].localAudio, undefined, "embedded audio cache keys are omitted");
  const localSnapshot = await first.evaluate(async (id) => (await (await import("/src/library-store.ts")).getCanvas(id)), canvasId);
  assert.equal(localSnapshot.nodes[0].assetId, undefined, "sync does not invent a local asset identity");
  const uploads = snapshot.requests.filter((request) => request.path === "/v1/media/assets" && request.method === "POST");
  assert.equal(uploads.length, 0, "sync never falls back to Gateway multipart for local media");
  const directIntents = snapshot.requests.filter((request) => request.path === "/v1/media/assets/upload-intents" && request.method === "POST");
  const directCompletes = snapshot.requests.filter((request) => request.path.endsWith("/complete") && request.method === "POST");
  const directObjects = snapshot.requests.filter((request) => request.path.startsWith("/__fixture/cos/uploads/") && request.method === "PUT");
  assert.equal(directIntents.length, 0, "sync never starts a media upload");
  assert.equal(directCompletes.length, 0, "sync never acknowledges a media upload");
  assert.equal(directObjects.length, 0, "sync never sends browser-local bytes to object storage");

  const second = await openPage();
  await second.goto(`${base}/#/canvas/${canvasId}`);
  await second.getByLabel("无限创作画布").waitFor();
  await eventually(async () => {
    const local = await second.evaluate(async (id) => (await (await import("/src/library-store.ts")).getCanvas(id)), canvasId);
    return local?.nodes?.[0]?.assetId === undefined && local?.nodes?.[0]?.image === undefined;
  }, "a fresh browser restores the projected document without local media");
  assert.deepEqual(errors, []);
  console.log("PASS sync projects local-only media out without checking or uploading local media");
} catch (error) {
  console.error(error);
  console.error(fixtureOutput);
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser?.close().catch(() => {});
  fixture.kill("SIGTERM");
}

