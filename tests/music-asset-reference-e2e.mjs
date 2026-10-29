/** Cover references can be selected from reusable audio assets through the real App. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const port = Number(process.env.CANVAS_MUSIC_ASSET_PORT || 5293);
const apiPort = Number(process.env.CANVAS_MUSIC_ASSET_API_PORT || port + 1);
const base = `http://127.0.0.1:${port}`, api = `http://127.0.0.1:${apiPort}`;
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", `--port=${port}`, `--api-port=${apiPort}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, page;
const requests = [], objectRequests = [], errors = [], checks = [];
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Music asset fixture startup timeout: ${output}`)), 30000);
  const read = chunk => { output += String(chunk); if (output.includes('"event":"ready"')) { clearTimeout(timer); resolve(); } };
  fixture.stdout.on("data", read); fixture.stderr.on("data", read);
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { clearTimeout(timer); reject(new Error(`Music asset fixture exited ${code}: ${output}`)); });
});
const eventually = async (check, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const readDocument = () => page.evaluate(async () => (await import("/src/library-store.ts")).getCanvas("music-asset-reference"));
const wav = Buffer.alloc(44 + 8 * 8000 * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
const cover = { id: "fixture-asset-cover", name: "资产 Cover", type: "audio", supported_operations: ["generation"], supported_input_modes: ["reference_audio"], audio_modes: ["song"], output_formats: ["wav"] };
const song = { id: "fixture-asset-song", name: "文字音乐", type: "audio", supported_operations: ["generation"], supported_input_modes: ["text", "lyrics"], audio_modes: ["song"], output_formats: ["wav"] };
const passed = label => { checks.push(label); console.log(`PASS ${label}`); };

try {
  await ready; await mkdir(artifacts, { recursive: true });
  const now = new Date().toISOString();
  const response = await fetch(`${api}/__fixture/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true, assets: [
    { id: "library-audio", name: "收藏配乐", type: "audio", category: "sound", saved_to_library: true, url: `${base}/v1/asset-audio.wav` },
    { id: "library-image", name: "无关图片", type: "image", saved_to_library: true },
  ], storage: { "canvas:doc:v1:music-asset-reference": {
    id: "music-asset-reference", name: "资产库音乐参考", createdAt: now, updatedAt: now,
    nodes: [{ id: "music-node", type: "prompt", mediaType: "audio", audioMode: "music", title: "音乐创作", text: "轻快明亮的夏日音乐", x: 300, y: 120, width: 360, height: 180, color: "#888", status: "idle" }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  } } }) });
  assert.equal(response.status, 200);
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/v1/music/models") return json({ data: [song, cover] });
    if (path === "/v1/asset-audio.wav") return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
    if (path.startsWith("/v1/music/by-idempotency-key/")) return json({ error: { code: "music_task_not_found", message: "not found" } }, 404);
    if (path === "/v1/music/generations") {
      requests.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      const url = "https://objects.example/asset-cover.wav?signature=temporary";
      return json({ id: "asset-cover-result", status: "completed", content_url: url, data: [{ asset_id: "asset-cover-result-asset", url }] });
    }
    return route.continue();
  });
  await context.route("https://objects.example/**", async route => {
    objectRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "audio/wav", headers: { "Access-Control-Allow-Origin": "*" }, body: wav });
  });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/#/canvas/music-asset-reference`);
  await page.locator('[data-node-id="music-node"]').waitFor({ state: "attached" });
  const closeList = page.getByRole("button", { name: "收起画布列表", exact: true }).first();
  if (await closeList.isVisible()) await closeList.click();
  await page.locator('[data-node-id="music-node"]').dblclick();
  const panel = page.getByRole("complementary", { name: "音乐创作", exact: true });
  await panel.getByRole("button", { name: "添加参考音频", exact: true }).click();
  await page.getByRole("button", { name: "从资产库选择参考音频", exact: true }).click();
  const library = page.getByRole("region", { name: "Canvas 资产库", exact: true });
  await library.getByRole("heading", { name: "收藏配乐", exact: true }).waitFor();
  assert.equal(await library.getByRole("heading", { name: "无关图片", exact: true }).count(), 0);
  await library.getByRole("button", { name: "返回创作", exact: true }).click();
  await panel.waitFor();
  assert.equal((await readDocument()).nodes.length, 1, "returning to creation does not insert an asset");
  passed("music reference picker displays only audio assets and returns without altering the canvas");

  await panel.getByRole("button", { name: "添加参考音频", exact: true }).click();
  await page.getByRole("button", { name: "从资产库选择参考音频", exact: true }).click();
  await library.getByRole("button", { name: "选择 收藏配乐 作为参考音频", exact: true }).click();
  await panel.locator(".context-music-reference-toggle.has-reference").waitFor();
  await eventually(async () => Boolean((await readDocument()).nodes.find(node => node.id === "music-node")?.musicReference?.localAudio), "asset bytes frozen for Cover");
  let document = await readDocument();
  const creator = document.nodes.find(node => node.id === "music-node"), source = document.nodes.find(node => node.id === creator.musicReference.nodeId);
  assert.equal(source.assetId, "library-audio"); assert.equal(source.type, "audio");
  assert.equal(creator.musicReference.title, "收藏配乐"); assert.equal(creator.musicReference.duration, 8);
  assert(document.edges.some(edge => edge.from === source.id && edge.to === creator.id));
  passed("choosing an audio asset creates a reusable source node, connection, and validated frozen Cover bytes");

  await panel.locator(".context-generate").click();
  await eventually(async () => (await readDocument()).nodes.find(node => node.id === "music-node")?.status === "completed", "asset Cover completes");
  assert.equal(requests.length, 1); assert.equal(requests[0].body.model, cover.id);
  assert.equal(requests[0].body.audio_base64, wav.toString("base64")); assert.ok(requests[0].key);
  assert.equal(requests.some(request => request.path?.endsWith("/content")), false, "music bytes must not pass through Gateway content routes");
  await eventually(async () => {
    const state = await (await fetch(`${api}/__fixture/state`)).json();
    return state.storage["canvas:doc:v1:music-asset-reference"]?.nodes.some(node => node.id === "music-node" && node.status === "completed");
  }, "Cover reference metadata syncs");
  const state = await (await fetch(`${api}/__fixture/state`)).json();
  const persisted = JSON.stringify(state.storage["canvas:doc:v1:music-asset-reference"]);
  assert(!persisted.includes("audio_base64")); assert(!persisted.includes(wav.toString("base64")));
  passed("library reference reaches the Cover model with the original bytes while cloud storage contains metadata only");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${artifacts}/music-asset-reference.png`, fullPage: true });
  await writeFile(`${artifacts}/music-asset-reference-results.json`, JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${artifacts}/music-asset-reference-failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${artifacts}/music-asset-reference-fixture.log`, output);
  throw error;
} finally {
  await browser?.close(); fixture.kill("SIGTERM");
  await Promise.race([new Promise(resolve => fixture.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
}
