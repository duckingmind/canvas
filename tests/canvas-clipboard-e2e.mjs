/** System clipboard paste regression against the disposable loopback fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createImageNode } from "./canvas-ui.mjs";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const mod = process.platform === "darwin" ? "Meta" : "Control";
const base = "http://127.0.0.1:5347";
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5347", "--api-port=5348"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "";
let browser;
let page;
const errors = [];
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Clipboard fixture timed out: ${fixtureOutput}`)), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += chunk.toString(); });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => {
    clearTimeout(timeout);
    if (code !== 0) reject(new Error(`Clipboard fixture exited ${code}: ${fixtureOutput}`));
  });
});

try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  const board = page.getByLabel("无限创作画布", { exact: true });
  await board.waitFor();
  await createImageNode(page);
  await page.keyboard.press("Escape");
  const initialImageCount = await page.locator(".node.image").count();

  await page.evaluate(async () => {
    const response = await fetch("/v1/fixture-image.png");
    const image = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
  });
  let releaseUpload;
  const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
  await page.route("**/__fixture/cos/uploads/**", async route => {
    await uploadGate;
    await route.continue();
  });
  await board.click({ position: { x: 1120, y: 820 } });
  await page.mouse.move(1120, 820);
  await page.keyboard.press(`${mod}+V`);
  await page.locator(".node.image").waitFor();
  const pendingUpload = page.locator(".node-image-upload");
  await pendingUpload.waitFor();
  assert.equal(await pendingUpload.getByRole("progressbar", { name: "图片上传进度" }).count(), 1, "clipboard paste exposes upload progress before COS finishes");
  releaseUpload();
  await pendingUpload.waitFor({ state: "detached" });
  await page.unroute("**/__fixture/cos/uploads/**");
  // The upload state and the committed asset fields are separate React
  // updates. Wait for the final image node render instead of sampling the
  // single frame between those updates.
  await page.waitForFunction(expected => document.querySelectorAll(".node.image").length === expected, initialImageCount + 1);
  const pastedImageCount = await page.locator(".node.image").count();
  assert.equal(pastedImageCount, initialImageCount + 1, "clipboard image is imported as one canvas image node");
  console.log("PASS pasted image shows a stable local preview and measured upload progress");

  const noteCount = await page.locator(".node.note").count();
  await page.evaluate(() => navigator.clipboard.writeText("从剪贴板粘贴的创意文本"));
  await page.mouse.move(1120, 820);
  await page.keyboard.press(`${mod}+V`);
  await page.waitForFunction(expected => document.querySelectorAll(".node.note").length === expected, noteCount + 1);
  assert.equal(await page.locator("textarea.inline-editor").last().inputValue(), "从剪贴板粘贴的创意文本");
  console.log("PASS pasting plain text creates an editable canvas note");

  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+0`);
  const prompt = page.locator(".node.prompt").first();
  await prompt.click();
  await page.keyboard.press("Enter");
  const draft = page.getByLabel("创作画面描述", { exact: true });
  await draft.waitFor();
  await draft.fill("已有描述");
  await page.evaluate(() => navigator.clipboard.writeText("追加到描述"));
  await draft.focus();
  await page.keyboard.press(`${mod}+V`);
  assert.equal(await draft.inputValue(), "已有描述追加到描述", "editable prompt keeps native text insertion/paste behavior");
  console.log("PASS editor paste remains browser-native");

  await draft.fill("原描述");
  await page.keyboard.press("Escape");
  const copiedNote = page.locator(".node.note").last();
  await copiedNote.click();
  await page.keyboard.press(`${mod}+C`);
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes("文本节点"));
  const copiedNoteCount = await page.locator(".node.note").count();
  await page.keyboard.press(`${mod}+V`);
  await page.waitForFunction(expected => document.querySelectorAll(".node.note").length === expected, copiedNoteCount + 1);
  console.log("PASS canvas node copy and paste still duplicates selected nodes");

  const sourceImage = await page.evaluate(async () => {
    const visibleIds = new Set([...document.querySelectorAll(".node.image[data-node-id]")].map(node => node.getAttribute("data-node-id")));
    const { listCanvases, getCanvas } = await import("/src/library-store.ts");
    for (const summary of await listCanvases()) {
      const document = await getCanvas(summary.id);
      const image = document?.nodes.find(node => visibleIds.has(node.id) && node.type === "image" && node.assetId);
      if (image) return { canvasId: document.id, nodeId: image.id, assetId: image.assetId };
    }
    return undefined;
  });
  assert.ok(sourceImage?.assetId, "the imported image has a stable platform asset identity");
  const beforeDuplicate = await (await fetch("http://127.0.0.1:5348/__fixture/state")).json();
  const uploadCounts = snapshot => ({
    intents: snapshot.requests.filter(request => request.method === "POST" && request.path === "/v1/media/assets/upload-intents").length,
    completes: snapshot.requests.filter(request => request.method === "POST" && request.path.endsWith("/complete")).length,
    objects: snapshot.requests.filter(request => request.method === "PUT" && request.path.startsWith("/__fixture/cos/uploads/")).length,
  });
  const initialUploads = uploadCounts(beforeDuplicate);
  const sourceElement = page.locator(`[data-node-id="${sourceImage.nodeId}"]`);
  await page.keyboard.press("Escape");
  await sourceElement.locator(".node-caption").click();
  await page.waitForFunction(id => document.querySelector(`[data-node-id="${id}"].selected`) !== null, sourceImage.nodeId);
  await page.keyboard.press(`${mod}+D`);
  const duplicatedDocument = await page.evaluate(async ({ canvasId, assetId }) => {
    const { getCanvas } = await import("/src/library-store.ts");
    for (let attempt = 0; attempt < 80; attempt++) {
      const current = await getCanvas(canvasId);
      if (current?.nodes.filter(node => node.assetId === assetId).length === 2) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const settled = await getCanvas(canvasId);
        if (settled?.nodes.filter(node => node.assetId === assetId).length === 2) return settled;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return undefined;
  }, { canvasId: sourceImage.canvasId, assetId: sourceImage.assetId });
  assert.ok(duplicatedDocument, "the duplicate is persisted with the source asset identity");
  const imageCopies = duplicatedDocument.nodes.filter(node => node.assetId === sourceImage.assetId);
  assert.equal(new Set(imageCopies.map(node => node.id)).size, 2, "the duplicate receives a new node ID");
  assert.ok(imageCopies.every(node => node.status === "completed" && !node.uploadState && !node.localImage), "both nodes refer to the completed platform asset without upload state or local cache");
  const afterDuplicate = await (await fetch("http://127.0.0.1:5348/__fixture/state")).json();
  assert.deepEqual(uploadCounts(afterDuplicate), initialUploads, "duplicating an existing asset does not start another platform upload");
  console.log("PASS duplicated image reuses its existing platform asset without downloading or uploading it again");

  assert.deepEqual(errors, [], `browser page errors: ${errors.join("; ")}`);
} finally {
  await browser?.close();
  if (fixture.exitCode === null) fixture.kill("SIGTERM");
}
