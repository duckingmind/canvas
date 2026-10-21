/** Platform-backed asset regression. Uses an isolated loopback fixture and the installed browser. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5251", api = "http://127.0.0.1:5252";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5251", "--api-port=5252"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, page;
const errors = [], checks = [];
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Asset fixture did not become ready")), 30000);
  fixture.stdout.on("data", chunk => { output += chunk.toString(); if (output.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); } });
  fixture.stderr.on("data", chunk => { output += chunk.toString(); });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => { clearTimeout(timeout); if (code !== 0) reject(new Error(`Asset fixture exited ${code}: ${output}`)); });
});
const state = async () => (await fetch(`${api}/__fixture/state`)).json();
const control = async body => {
  const response = await fetch(`${api}/__fixture/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
};
const eventually = async (check, description, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${description}`);
};
const button = name => page.getByRole("button", { name, exact: true });
const passed = description => { checks.push(description); console.log(`PASS ${description}`); };
const openLibrary = async () => {
  if (!await button("资产库").isVisible()) await button("素材与图层").click();
  await button("资产库").click();
  await page.getByRole("region", { name: "Canvas 资产库" }).waitFor();
};

try {
  await ready;
  const now = new Date().toISOString();
  const pagedAssets = Array.from({ length: 50 }, (_, index) => ({
    id: `media-page-${String(index + 1).padStart(2, "0")}`,
    name: `分页测试素材 ${String(index + 1).padStart(2, "0")}`,
    category: "other", saved_to_library: true,
  }));
  await control({ reset: true, assets: [
    { id: "media-character", task_id: "task-character", name: "", category: "other", saved_to_library: false },
    { id: "media-landscape", task_id: "task-landscape", name: "山水场景", category: "scene", tags: ["山水"], folder: "场景", saved_to_library: true },
    { id: "media-other-app", name: "其他应用资产", saved_to_library: true, source_app_id: "another-application" },
    ...pagedAssets,
  ], storage: {
    "canvas:asset:v1:local-filtered": {
      schemaVersion: 1, id: "local-filtered", name: "本机备注素材", kind: "image", category: "other",
      tags: ["本机"], folder: "本机文件夹", createdAt: now, updatedAt: now,
      source: { type: "local", localImage: `proxy-canvas:image:sha256:${"a".repeat(64)}` },
    },
    "canvas:doc:v1:asset-fixture": {
      id: "asset-fixture", name: "资产库回归", createdAt: now, updatedAt: now,
      nodes: [{ id: "character-node", type: "image", title: "原始角色图", text: "", x: 280, y: 180, width: 350, height: 260, color: "#77bbcc", image: `${base}/v1/fixture-image.png`, assetId: "media-character", taskId: "task-character", status: "completed" }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    },
  } });
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/#/canvas/asset-fixture`);
  await page.getByLabel("无限创作画布").waitFor();
  const collapse = button("收起画布列表").first();
  if (await collapse.isVisible()) await collapse.click();
  await page.locator('[data-node-id="character-node"]').click();
  await button("节点操作").click();
  await page.getByRole("menu", { name: "节点操作菜单", exact: true }).getByRole("menuitem", { name: "保存为资产", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "保存资产", exact: true });
  await dialog.waitFor();
  await dialog.getByLabel(/资产名称/).fill("角色三视图");
  await dialog.getByLabel("保存位置", { exact: true }).fill("角色库");
  await dialog.getByRole("group", { name: "资产分类" }).getByRole("button", { name: "角色", exact: true }).click();
  const tagInput = dialog.getByLabel(/^自定义标签/);
  await tagInput.fill(" 古装 ");
  await tagInput.press("Enter");
  await tagInput.fill("Hero"); await tagInput.press("Enter");
  await tagInput.fill("hero"); await tagInput.press("Enter");
  assert.equal(await dialog.getByRole("button", { name: /^移除标签 / }).count(), 2, "case variants share one user tag");
  const source = dialog.locator(".asset-save-source");
  assert.match(await source.innerText(), /系统来源/);
  assert.match(await source.innerText(), /Canvas/);
  assert.equal(await source.locator("input,select,textarea,button").count(), 0, "system provenance is read-only");
  await page.screenshot({ path: `${artifacts}/asset-save-modal.png`, fullPage: true });
  await dialog.getByRole("button", { name: "保存资产", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await eventually(async () => (await state()).assets["media-character"].saved_to_library, "platform membership saved");
  let snapshot = await state();
  assert.equal(snapshot.assets["media-character"].name, "角色三视图");
  assert.equal(snapshot.assets["media-character"].folder, "角色库");
  assert.equal(snapshot.assets["media-character"].category, "person");
  assert.deepEqual(snapshot.assets["media-character"].tags, ["古装", "Hero"]);
  assert.equal(snapshot.assets["media-character"].metadata_revision, 1);
  const patches = snapshot.requests.filter(request => request.method === "PATCH" && request.path === "/v1/media/assets/media-character");
  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0].metadata).sort(), ["category", "expected_revision", "folder", "name", "saved_to_library", "tags"]);
  assert.equal(patches[0].metadata.expected_revision, 0);
  assert.equal(snapshot.storage["canvas:asset:v1:media-character"], undefined, "platform metadata is not duplicated into KV");
  passed("save platform asset with folder/category/user tags and read-only system provenance at revision zero");

  await openLibrary();
  const library = page.getByRole("region", { name: "Canvas 资产库" });
  await library.getByRole("heading", { name: "角色三视图", exact: true }).waitFor();
  await library.getByRole("heading", { name: "山水场景", exact: true }).waitFor();
  assert.equal(await library.getByRole("heading", { name: "其他应用资产", exact: true }).count(), 0);
  const assetScroll = library.locator(".asset-library-scroll");
  assert.equal(await library.locator(".asset-library-card").count(), 49, "only the first bounded platform page plus local assets are initially rendered");
  await assetScroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await eventually(async () => await library.locator(".asset-library-card").count() === 53, "scroll automatically loads the next asset page");
  snapshot = await state();
  assert.ok(snapshot.requests.some(request => request.method === "GET" && request.path === "/v1/media/assets?page=2&limit=48"));
  passed("the next bounded asset page loads automatically when scrolling to the end");
  await page.getByLabel("按文件夹筛选资产").selectOption("folder:角色库");
  await eventually(async () => await library.locator(".asset-library-card").count() === 1, "folder filter");
  assert.equal(await library.getByRole("heading", { name: "本机备注素材", exact: true }).count(), 0, "local KV assets obey the active filters too");
  await page.getByLabel("按标签筛选资产").selectOption("Hero");
  await page.getByLabel("搜索资产库").fill("不存在的资产");
  await library.getByText("没有找到符合条件的资产", { exact: true }).waitFor();
  await page.getByLabel("搜索资产库").fill("角色三视图");
  await library.getByRole("heading", { name: "角色三视图", exact: true }).waitFor();
  await page.screenshot({ path: `${artifacts}/asset-library-filtered.png`, fullPage: true });
  passed("library filters combine server-side name, user tag and folder while scoping to Canvas");

  await page.reload();
  await page.getByLabel("无限创作画布").waitFor();
  await openLibrary();
  await library.getByRole("heading", { name: "角色三视图", exact: true }).waitFor();
  await button("编辑 角色三视图 的信息").click();
  const editing = page.getByRole("dialog", { name: "编辑资产", exact: true });
  assert.equal(await editing.getByLabel("保存位置", { exact: true }).inputValue(), "角色库");
  assert.equal(await editing.getByRole("button", { name: "移除标签 Hero", exact: true }).count(), 1);
  await button("关闭资产弹窗").click();
  const beforeNodes = await page.locator(".node[data-node-id]").count();
  await button("添加 角色三视图 到画布").click();
  await eventually(async () => await page.locator(".node[data-node-id]").count() === beforeNodes + 1, "insert asset into canvas");
  await button("保存画布").click();
  await eventually(async () => (await state()).storage["canvas:doc:v1:asset-fixture"]?.nodes?.filter(node => node.assetId === "media-character").length === 2, "stable ID persisted in inserted node");
  snapshot = await state();
  assert.ok(snapshot.requests.some(request => request.method === "GET" && request.path === "/v1/media/assets/media-character"));
  passed("metadata survives reload and reusable nodes resolve content through stable media identity");

  await openLibrary();
  await button("从资产库移除 角色三视图").click();
  await library.getByRole("button", { name: "移除", exact: true }).click();
  await eventually(async () => !(await state()).assets["media-character"].saved_to_library, "remove membership");
  await eventually(async () => await library.getByRole("button", { name: "保存为资产 角色三视图", exact: true }).count() === 1, "removed membership remains available outside the saved-only library state");
  snapshot = await state();
  assert.ok(snapshot.assets["media-character"], "underlying media remains available");
  assert.equal(snapshot.requests.some(request => request.method === "DELETE" && request.path.startsWith("/v1/media/assets/")), false);
  const lastPatch = snapshot.requests.filter(request => request.method === "PATCH").at(-1);
  assert.deepEqual(lastPatch.metadata, { expected_revision: 1, saved_to_library: false });
  assert.equal(await page.locator(".node[data-node-id]").count(), beforeNodes + 1, "existing canvas references survive removal");
  passed("removal only patches membership and preserves both media bytes and existing canvas nodes");
  assert.deepEqual(errors, []);
  await writeFile(`${artifacts}/asset-library-results.json`, JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: `${artifacts}/asset-library-failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${artifacts}/asset-library-fixture.log`, output);
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
  await Promise.race([new Promise(resolve => fixture.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
}
