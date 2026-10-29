/** Canvas switch feedback regression against an isolated loopback fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "http://127.0.0.1:5327";
const api = "http://127.0.0.1:5328";
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5327", "--api-port=5328"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "";
let browser;
let page;
const errors = [];
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Canvas switch fixture timed out: ${fixtureOutput}`)), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += chunk.toString(); });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => {
    clearTimeout(timeout);
    if (code !== 0) reject(new Error(`Canvas switch fixture exited ${code}: ${fixtureOutput}`));
  });
});
const control = async body => {
  const response = await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
};
const button = name => page.getByRole("button", { name, exact: true });
const current = async name => {
  await page.getByLabel(`当前画布：${name}`, { exact: true }).waitFor();
  await page.getByLabel("无限创作画布").waitFor();
};
const openLibrary = async () => {
  const toggle = button("我的画布");
  if (await toggle.isVisible()) await toggle.click();
  await page.getByLabel("搜索画布名称").waitFor();
  await page.locator('.library-results[aria-busy="false"]').waitFor();
};
const documentValue = (id, name, text) => ({
  id,
  name,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  nodes: [{ id: `${id}-note`, type: "note", title: name, text, x: 80, y: 80, width: 320, height: 180 }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
const ids = { first: "switch-first", slow: "switch-slow", failed: "switch-failed" };
const docs = {
  first: documentValue(ids.first, "切换回归 A", "A 画布内容"),
  slow: documentValue(ids.slow, "切换回归 B", "B 画布内容"),
  failed: documentValue(ids.failed, "切换失败 C", "C 画布内容"),
};
const removeLocalBodies = async (targetIds) => page.evaluate(async idsToRemove => {
  const entries = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
  const info = entries.find(item => item.name?.startsWith("proxy-canvas:library:v1:account:acs_"));
  if (!info?.name) throw new Error("Canvas library database was not created");
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(info.name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readwrite");
    for (const id of idsToRemove) transaction.objectStore("documents").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}, targetIds);

try {
  await ready;
  await control({
    reset: true,
    storage: {
      "canvas:migrations:documents:v1": { completed: true },
      [`canvas:doc:v1:${ids.slow}`]: docs.slow,
      [`canvas:doc:v1:${ids.failed}`]: docs.failed,
    },
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.route("**/__canvas-switch-seed", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Canvas switch seed</title>",
  }));
  await page.goto(`${base}/__canvas-switch-seed`);
  await page.evaluate(async documents => {
    const { setLocalStorageScope } = await import("/src/local-storage-scope.ts");
    const { saveCanvas } = await import("/src/library-store.ts");
    setLocalStorageScope("acs_" + "f".repeat(64));
    for (const document of Object.values(documents)) await saveCanvas(document);
  }, docs);
  await page.unroute("**/__canvas-switch-seed");
  await page.goto(`${base}/#/canvas/${ids.first}`);
  await current(docs.first.name);
  await openLibrary();
  await button(`打开画布：${docs.slow.name}`).waitFor();
  await button(`打开画布：${docs.failed.name}`).waitFor();

  // Keep summaries in the library while removing each body. The open path
  // must then recover the document through the fixture's targeted cloud read.
  await removeLocalBodies([ids.slow, ids.failed]);

  let releaseSlowRead;
  let slowReadStarted;
  const slowGate = new Promise(resolve => { releaseSlowRead = resolve; });
  const slowStarted = new Promise(resolve => { slowReadStarted = resolve; });
  await page.route("**/v1/storage/items*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("key") === `canvas:doc:v1:${ids.slow}`) {
      slowReadStarted();
      await slowGate;
    }
    await route.continue();
  });
  await button(`打开画布：${docs.slow.name}`).click();
  await slowStarted;
  const indicator = page.locator(".canvas-switch-indicator");
  await indicator.waitFor({ state: "visible" });
  assert.match(await indicator.innerText(), /正在打开画布/,
    "a delayed target read shows a concise progress message");
  const revealObserved = page.evaluate(() => new Promise(resolve => {
    const findAnimation = () => {
      const element = document.querySelector(".canvas-editor-enter.is-switching");
      if (!element) return false;
      resolve(getComputedStyle(element).animationName);
      return true;
    };
    if (findAnimation()) return;
    const observer = new MutationObserver(() => {
      if (findAnimation()) observer.disconnect();
    });
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] });
    setTimeout(() => { observer.disconnect(); resolve(null); }, 5000);
  }));
  releaseSlowRead();
  assert.equal(await revealObserved, "canvas-editor-switch-in",
    "the ready canvas uses a brief reveal transition");
  await current(docs.slow.name);
  await indicator.waitFor({ state: "hidden" });
  await page.unroute("**/v1/storage/items*");
  console.log("PASS slow canvas reads show delayed progress and reveal the ready editor");

  // A locally available document is fast and should not create a short-lived
  // spinner or reveal animation between otherwise direct interactions.
  await page.evaluate(() => {
    window.__canvasSwitchAnimationSeen = false;
    window.__canvasSwitchAnimationObserver = new MutationObserver(() => {
      if (document.querySelector(".canvas-editor-enter.is-switching")) window.__canvasSwitchAnimationSeen = true;
    });
    window.__canvasSwitchAnimationObserver.observe(document.documentElement, {
      subtree: true, attributes: true, attributeFilter: ["class"],
    });
  });
  await button(`打开画布：${docs.first.name}`).click();
  await current(docs.first.name);
  await page.waitForTimeout(260);
  assert.equal(await page.locator(".canvas-switch-indicator").count(), 0,
    "fast local switches remain visually quiet");
  assert.equal(await page.evaluate(() => {
    window.__canvasSwitchAnimationObserver?.disconnect();
    return window.__canvasSwitchAnimationSeen;
  }), false, "fast local switches do not run the reveal animation");
  console.log("PASS fast canvas switches do not show progress feedback or run a reveal animation");

  // The preference suppresses the reveal motion while retaining the same
  // delayed progress behavior for a genuinely slow switch.
  await removeLocalBodies([ids.slow]);
  await page.evaluate(() => localStorage.setItem("codex.canvas.preferences.v1", JSON.stringify({ reduceMotion: true })));
  let releaseReducedRead;
  let reducedReadStarted;
  const reducedGate = new Promise(resolve => { releaseReducedRead = resolve; });
  const reducedStarted = new Promise(resolve => { reducedReadStarted = resolve; });
  await page.route("**/v1/storage/items*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("key") === `canvas:doc:v1:${ids.slow}`) {
      reducedReadStarted();
      await reducedGate;
    }
    await route.continue();
  });
  await button(`打开画布：${docs.slow.name}`).click();
  await reducedStarted;
  await page.waitForTimeout(220);
  const reducedIndicator = page.locator(".canvas-switch-indicator");
  await reducedIndicator.waitFor({ state: "visible" });
  assert.ok(await reducedIndicator.evaluate(element => parseFloat(getComputedStyle(element).animationDuration) <= 0.0001),
    "reduced-motion preference disables indicator motion");
  releaseReducedRead();
  await current(docs.slow.name);
  await page.locator(".canvas-switch-indicator").waitFor({ state: "hidden" });
  await page.unroute("**/v1/storage/items*");
  console.log("PASS reduced-motion preference keeps switching feedback but removes motion");

  let abortFailedRead;
  let failedReadStarted;
  const failedGate = new Promise(resolve => { abortFailedRead = resolve; });
  const failedStarted = new Promise(resolve => { failedReadStarted = resolve; });
  await page.route("**/v1/storage/items*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("key") === `canvas:doc:v1:${ids.failed}`) {
      failedReadStarted();
      await failedGate;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await button(`打开画布：${docs.failed.name}`).click();
  await failedStarted;
  await page.locator(".canvas-switch-indicator").waitFor({ state: "visible" });
  abortFailedRead();
  await current(docs.slow.name);
  await page.locator(".canvas-switch-indicator").waitFor({ state: "hidden" });
  assert.equal(page.url(), `http://127.0.0.1:5327/#/canvas/${ids.slow}`,
    "a failed target read leaves the previous canvas and route active");
  assert.match(await page.locator("body").innerText(), /无法从云端恢复|暂时无法/, 
    "the failed read retains an actionable error message");
  assert.deepEqual(errors, []);
  console.log("PASS failed canvas recovery keeps the previous canvas active");
} catch (error) {
  if (page) {
    await page.screenshot({ path: fileURLToPath(new URL("./artifacts/canvas-switch-failure.png", import.meta.url)), fullPage: true }).catch(() => {});
    console.error((await page.locator("body").innerText().catch(() => "")).slice(0, 5000));
  }
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
}
