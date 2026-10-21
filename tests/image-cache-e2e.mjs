/** Real HTTP transfer counts across reloads. No Playwright routing: routing
 * disables the browser's HTTP cache and would hide the fallback being tested.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5261", api = "http://127.0.0.1:5262";
const bitmap = await readFile(new URL("./fixtures/aspect-ratio.png", import.meta.url));
const transfers = [], checks = [], errors = [];
const media = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const interval = (url.searchParams.get("q-sign-time") || "").split(";").map(Number);
  const status = interval[1] <= Date.now() / 1000 ? 403 : request.headers.range === "bytes=0-0" ? 206 : 200;
  const cors = !url.pathname.includes("/no-cors/");
  const headers = { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000", "Accept-Ranges": "bytes", "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Method", "Content-Disposition": "attachment", "x-cos-force-download": "true" };
  if (cors) headers["Access-Control-Allow-Origin"] = base;
  if (status === 206) headers["Content-Range"] = `bytes 0-0/${bitmap.length}`;
  const body = status === 206 ? bitmap.subarray(0, 1) : bitmap;
  transfers.push({ path: url.pathname, query: url.search, method: request.method, status, origin: request.headers.origin || null, bytes: request.method === "HEAD" ? 0 : body.length });
  response.writeHead(status, headers);
  response.end(request.method === "HEAD" ? undefined : body);
});
await new Promise(resolve => media.listen(0, "127.0.0.1", resolve));
const mediaBase = `http://127.0.0.1:${media.address().port}`;
const object = user => `${mediaBase}/app/media/image/${user}/2026/09/22/task-0-0123456789abcdef.png`;
const signed = (user, signature, end = Math.floor(Date.now() / 1000) + 3600) => `${object(user)}?q-sign-time=${Math.floor(Date.now() / 1000) - 120};${end}&q-signature=${signature}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventually = async (predicate, message) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(100); }
  throw new Error("Timed out: " + message);
};
const control = async value => {
  const response = await fetch(api + "/__fixture/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.equal(response.status, 200);
};
const state = async () => (await fetch(api + "/__fixture/state")).json();
const assetReads = async () => (await state()).requests.filter(r => r.path === "/v1/media/assets/fixture-image").length;
const downloads = user => transfers.filter(t => t.path === new URL(object(user)).pathname && t.method === "GET" && t.status === 200).length;
const assertNoPersistentRemoteImages = async () => {
  const persisted = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const imageDatabase = databases.find(database => database.name?.includes("proxy-canvas:image-cache:"));
    if (!imageDatabase?.name) return { dataImages: 0, remoteIndexes: 0 };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(imageDatabase.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains("images")) return { dataImages: 0, remoteIndexes: 0 };
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("images", "readonly"), store = transaction.objectStore("images");
        const keys = store.getAllKeys(), values = store.getAll();
        transaction.oncomplete = () => resolve({
          dataImages: values.result.filter(value => typeof value === "string" && value.startsWith("data:image/")).length,
          remoteIndexes: keys.result.filter(key => String(key).includes("image-url:") || String(key).includes("image-object:")).length,
        });
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  assert.deepEqual(persisted, { dataImages: 0, remoteIndexes: 0 });
};
const doc = (name, image, timestamp = new Date().toISOString()) => ({
  id: name, name, createdAt: timestamp, updatedAt: timestamp,
  nodes: [{ id: "image-node", type: "image", title: "缓存验证", text: "", assetId: "fixture-image", taskId: "fixture-task", resultIndex: 0, image,
    x: 240, y: 180, width: 360, height: 480, color: "#202024", status: "completed" }],
  edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 },
});
const seed = async (document, url, reset = true) => control({ reset, storage: { ["canvas:doc:v1:" + document.id]: document }, assets: [{ id: "fixture-image", task_id: "fixture-task", url }] });

await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.env.CANVAS_FIXTURE_NODE || process.execPath, ["tests/platform-fixture.mjs", "--port=5261", "--api-port=5262"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, context, page;
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Fixture startup timeout")), 30000);
  fixture.stdout.on("data", chunk => { output += chunk; if (output.includes('"event":"ready"')) { clearTimeout(timer); resolve(); } });
  fixture.stderr.on("data", chunk => { output += chunk; });
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { clearTimeout(timer); reject(new Error("Fixture exited: " + code)); });
});
const imageLoaded = async () => {
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-node-id="image-node"] img.node-image');
    return image?.complete && image.naturalWidth > 0 && /^https?:/i.test(image.src);
  }, null, { timeout: 45000 });
};
const settled = async () => {
  await eventually(async () => !/正在连接|正在加载|正在同步/.test(await page.locator(".save-status").innerText()), "canvas hydration");
  await pause(1200);
};
const freshPage = async name => {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/#/canvas/" + name);
};
const pass = message => { checks.push(message); console.log("PASS " + message); };

try {
  await ready;
  browser = await chromium.launch({ headless: true, timeout: 90000, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const first = signed("cached", "first"), document = doc("image-cache", first);
  await seed(document, first);
  await freshPage(document.id);
  await imageLoaded();
  await settled();
  assert.ok(downloads("cached") > 0);
  await assertNoPersistentRemoteImages();
  const initialDownloads = downloads("cached"), initialReads = await assetReads();
  await page.locator('[data-node-id="image-node"]').dblclick();
  await page.waitForFunction(() => {
    const image = document.querySelector(".media-preview-image");
    return image?.complete && image.naturalWidth > 0 && /^https?:/i.test(image.src);
  }, null, { timeout: 45000 });
  await assertNoPersistentRemoteImages();
  assert.equal(transfers.some(transfer => transfer.path === new URL(object("cached")).pathname && transfer.method === "GET" && transfer.status === 206), false, "ordinary display and preview must not run the byte-cache range probe");
  pass("ordinary cards and preview use remote URLs without an application-owned full-byte cache");
  await page.reload();
  await imageLoaded();
  await settled();
  assert.ok(await assetReads() >= initialReads);
  await assertNoPersistentRemoteImages();
  pass("a reload keeps the remote document URL and does not restore a persisted data URL");

  const renewed = signed("cached", "rotated");
  await seed(doc(document.id, renewed, new Date(Date.now() + 5000).toISOString()), renewed, false);
  await page.reload();
  await imageLoaded();
  await settled();
  assert.ok(downloads("cached") >= initialDownloads);
  await assertNoPersistentRemoteImages();
  pass("a renewed signature remains a remote reference; object bytes are not restored from persistent browser storage");

  const thumbnail = renewed + "&imageMogr2/thumbnail/240x240>=";
  await seed(doc(document.id, thumbnail, new Date(Date.now() + 10000).toISOString()), thumbnail, false);
  await page.reload();
  await eventually(async () => downloads("cached") > initialDownloads, "different transformation downloads its own image");
  await imageLoaded();
  await assertNoPersistentRemoteImages();
  pass("different transformations stay distinct remote URLs without persistent copies");

  const expired = signed("expired", "old", Math.floor(Date.now() / 1000) - 1), recovered = signed("expired", "new");
  await seed(doc("image-expired", expired), recovered);
  await freshPage("image-expired");
  await imageLoaded();
  assert.ok(await assetReads() >= 1);
  assert.ok(downloads("expired") > 0);
  pass("an expired signature still renews automatically and keeps the recovered image as a remote URL");

  await seed(doc("image-new-device", undefined), signed("new-device", "fresh"));
  await freshPage("image-new-device");
  await imageLoaded();
  assert.ok(await assetReads() >= 1);
  pass("a new browser restores a cloud node containing only its stable asset identity");

  const noCors = signed("no-cors", "unchanged");
  await seed(doc("image-no-cors", noCors), noCors);
  await freshPage("image-no-cors");
  await imageLoaded();
  await settled();
  const noCorsDownloads = downloads("no-cors"), noCorsReads = await assetReads();
  await page.reload();
  await imageLoaded();
  await settled();
  assert.equal(await assetReads(), noCorsReads);
  assert.equal(downloads("no-cors"), noCorsDownloads);
  pass("without CORS-readable bytes, a valid unchanged URL still uses the browser HTTP cache on reload");
  assert.deepEqual(errors, []);
  await writeFile(artifacts + "image-cache-result.json", JSON.stringify({ passed: true, checks, transfers, errors }, null, 2));
} catch (error) {
  await writeFile(artifacts + "image-cache-fixture.log", output);
  await writeFile(artifacts + "image-cache-result.json", JSON.stringify({ passed: false, error: String(error), checks, transfers, errors }, null, 2));
  await page?.screenshot({ path: artifacts + "image-cache-failure.png", timeout: 3000 }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
  await Promise.race([new Promise(resolve => fixture.once("exit", resolve)), pause(5000)]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
  await new Promise(resolve => media.close(resolve));
}
