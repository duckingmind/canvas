/** Disposable canvas list regression; no live account, model, or user browser. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createImageNode } from "./canvas-ui.mjs";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5205";
const api = "http://127.0.0.1:5206";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5205", "--api-port=5206"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Canvas list fixture did not become ready: ${output}`)), 20000);
  fixture.stdout.on("data", (chunk) => {
    output += chunk.toString();
    if (output.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); }
  });
  fixture.stderr.on("data", (chunk) => { output += chunk.toString(); });
  fixture.once("error", (error) => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0) reject(new Error(`Canvas list fixture exited ${code}: ${output}`));
  });
});
let browser;
const pages = [];
const errors = [];
const button = (page, name) => page.getByRole("button", { name, exact: true });
const state = async () => (await fetch(`${api}/__fixture/state`)).json();
const control = async (body) => {
  const response = await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
};
const eventually = async (check, label) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const settle = (page) => page.locator('.library-results[aria-busy="false"]:visible').waitFor();
const management = async (page) => {
  await page.getByLabel("无限创作画布").waitFor();
  const libraryButton = button(page, "我的画布");
  if (await libraryButton.isVisible()) await libraryButton.click();
  else if (await button(page, "管理画布").isVisible()) await button(page, "管理画布").click();
  await page.getByLabel("搜索画布名称").waitFor();
  await settle(page);
};
const current = async (page, name) => {
  await page.getByLabel(`当前画布：${name}`, { exact: true }).waitFor();
  await page.getByLabel("无限创作画布").waitFor();
};
const create = async (page, name) => {
  await management(page);
  await button(page, "新建画布").first().click();
  assert.equal(await button(page, "创建画布").isDisabled(), true, "empty canvas names cannot be submitted");
  await page.getByRole("dialog").getByRole("textbox", { name: "画布名称", exact: true }).fill(name);
  assert.equal(await button(page, "创建画布").isEnabled(), true, "entering a name enables creation");
  await button(page, "创建画布").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await current(page, name);
  if (!(await page.getByLabel("搜索画布名称").isVisible())) await management(page);
  await settle(page);
  const opened = button(page, `打开画布：${name}`);
  try {
    await opened.waitFor({ timeout: 2000 });
  } catch {
    await management(page);
    await opened.waitFor();
  }
  return page.url();
};
const open = async (page, name) => {
  await management(page);
  await button(page, `打开画布：${name}`).click();
  await current(page, name);
};
const action = async (page, name, label) => {
  await management(page);
  await button(page, `画布操作：${name}`).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};
const newPage = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  return page;
};
const seedLocal = async (page, document) => {
  await page.route("**/__library-list-seed", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local canvas list seed</title>" }));
  await page.goto(`${base}/__library-list-seed`);
  await page.evaluate(async (value) => {
    const { setLocalStorageScope } = await import("/src/local-storage-scope.ts");
    const { saveCanvas } = await import("/src/library-store.ts");
    setLocalStorageScope("acs_" + "f".repeat(64));
    await saveCanvas(value);
  }, document);
  await page.unroute("**/__library-list-seed");
};
const canonicalList = (url) => url.pathname === "/v1/storage/keys" && url.searchParams.get("prefix") === "canvas:doc:v1:";

try {
  await ready;
  const cloudOnly = {
    id: "cloud-before-sidebar",
    name: "侧栏发现的云端画布",
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:01:00.000Z",
    nodes: [{ id: "cloud-note", type: "note", title: "云端笔记", text: "侧栏打开前不会加载", x: 80, y: 80, width: 320, height: 180 }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  await control({ reset: true, storage: { "canvas:migrations:documents:v1": { completed: true }, [`canvas:doc:v1:${cloudOnly.id}`]: cloudOnly } });
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const page = await newPage();
  const localCanvas = { ...cloudOnly, id: "local-before-sidebar", name: "本机已有画布", nodes: [] };
  await seedLocal(page, localCanvas);
  await page.goto(`${base}/#/canvas/${localCanvas.id}`);
  await page.getByLabel("无限创作画布").waitFor();
  const startupRequests = (await state()).requests;
  assert.equal(
    startupRequests.some((request) => canonicalList(new URL(request.path, base))),
    false,
    "normal canvas startup with an existing local canvas does not enumerate every cloud canvas",
  );
  let releaseDiscovery;
  const discoveryGate = new Promise((resolve) => { releaseDiscovery = resolve; });
  let discoveryStarted;
  const discovered = new Promise((resolve) => { discoveryStarted = resolve; });
  await page.route(canonicalList, async (route) => { discoveryStarted(); await discoveryGate; await route.continue(); });
  await button(page, "我的画布").click();
  await discovered;
  await page.getByText("正在检查云端画布…", { exact: true }).waitFor();
  assert.equal(await page.locator(".library-card").count(), 1, "cloud discovery keeps existing local rows visible");
  assert.equal(await button(page, `打开画布：${localCanvas.name}`).isEnabled(), true, "cloud discovery does not disable opening known local canvases");
  assert.equal(await button(page, "新建画布").first().isEnabled(), false, "new canvas creation waits for discovery instead of racing a duplicate empty canvas");
  releaseDiscovery();
  await management(page);
  await page.unroute(canonicalList);
  const initialURL = page.url();
  assert.equal(await page.locator(".library-sort select").inputValue(), "created", "canvas order defaults to creation time so edits do not move older canvases");
  assert((await page.locator(".library-list-scroll").evaluate(element => element.clientHeight)) >= 300, "desktop canvas list uses the taller available panel height");
  await button(page, `打开画布：${cloudOnly.name}`).waitFor();
  assert.equal(await page.locator(".library-card").count(), 2, "opening the sidebar hydrates the pre-existing cloud canvas");
  assert.equal(await button(page, `打开画布：${localCanvas.name}`).count(), 1, "local startup canvas remains available after cloud discovery");
  assert.equal(await page.getByRole("tab", { name: /协作/ }).count(), 0, "unavailable collaboration cannot select an artificial empty list");
  assert.equal(await page.locator('.library-card-open[aria-current="page"]').count(), 1, "active canvas is identified in the list");
  await page.reload();
  await management(page);
  assert.equal(page.url(), initialURL, "reload restores the same canvas identity");
  assert.equal(await page.locator(".library-card").count(), 2, "reload does not create another blank canvas");

  const aURL = await create(page, "列表闭环 A");
  await createImageNode(page);
  await page.getByLabel("创作画面描述").fill("A 的即时输入，切换时应保存");
  const bURL = await create(page, "列表闭环 B");
  assert.notEqual(aURL, bURL);
  assert.equal(await page.locator(".library-card").count(), 4);
  await createImageNode(page);
  await page.getByLabel("创作画面描述").fill("B 的独立内容");
  await open(page, "列表闭环 A");
  await page.waitForFunction(() => document.querySelector(".world")?.innerText.includes("A 的即时输入"));
  assert.equal((await page.locator(".world").innerText()).includes("B 的独立内容"), false);
  await page.getByLabel("创作画面描述").fill("A 的即时输入已编辑，顺序应以创建时间为准");
  await open(page, "列表闭环 B");
  await open(page, "列表闭环 A");
  await page.reload();
  await management(page);
  assert.equal(page.url(), aURL);
  const expectedCreatedOrder = await page.evaluate(async () => {
    const { listCanvases } = await import("/src/library-store.ts");
    return (await listCanvases()).filter(item => !item.deletedAt)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id))
      .map(item => item.id);
  });
  const visibleCanvasOrder = await page.locator(".library-card").evaluateAll(elements => elements.map(element => element.getAttribute("data-canvas-id")));
  assert.deepEqual(visibleCanvasOrder, expectedCreatedOrder, "editing an older canvas leaves the library in creation-time order");
  await page.waitForFunction(() => document.querySelector(".world")?.innerText.includes("A 的即时输入"));
  assert.equal(await page.locator(".library-card").count(), 4, "list survives reload after creating and editing canvases");
  console.log("PASS initial persisted entry, active indicator, creation, immediate input save, switching, reload");

  await page.getByLabel("搜索画布名称").fill("没有这样的画布");
  await page.getByRole("heading", { name: "没有找到相关画布", exact: true }).waitFor();
  await button(page, "清除搜索").first().click();
  await button(page, "打开画布：列表闭环 A").waitFor();
  await action(page, "列表闭环 A", "重命名画布：列表闭环 A");
  await page.getByRole("dialog").getByRole("textbox", { name: "画布名称", exact: true }).fill("列表闭环 A 已命名");
  await button(page, "保存名称").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await current(page, "列表闭环 A 已命名");
  await button(page, "打开画布：列表闭环 A 已命名").waitFor();
  await action(page, "列表闭环 B", "将画布 列表闭环 B 移入回收站");
  await settle(page);
  assert.equal(await button(page, "打开画布：列表闭环 B").count(), 0);
  await page.getByRole("button", { name: /^回收站 ·/ }).click();
  await button(page, "恢复画布：列表闭环 B").click();
  await settle(page);
  // Returning to the active canvas resets the recycle-bin filter and reflects restoration.
  await button(page, "收起画布列表").first().click();
  await management(page);
  const returnAll = button(page, "返回全部画布");
  if (await returnAll.isVisible()) await returnAll.click();
  else {
    const allTab = page.getByRole("tab", { name: /^全部/ });
    if (await allTab.count()) await allTab.click();
  }
  await button(page, "打开画布：列表闭环 B").waitFor();
  await open(page, "列表闭环 B");
  await page.waitForFunction(() => document.querySelector(".world")?.innerText.includes("B 的独立内容"));
  await button(page, "保存画布").click();
  const bID = bURL.split("/canvas/")[1];
  await eventually(async () => (await state()).storage[`canvas:doc:v1:${bID}`]?.nodes.some((node) => node.text === "B 的独立内容"), "B canonical cloud save");
  console.log("PASS search/clear, active rename, trash/restore, recovered content");

  const second = await newPage();
  await second.goto(`${base}/#/canvases`);
  await management(second);
  await button(second, "打开画布：列表闭环 B").waitFor();
  assert.equal(await second.locator(".library-card").count(), 4, "second device discovers saved canvases without creating a stray blank");
  await open(second, "列表闭环 B");
  await second.waitForFunction(() => document.querySelector(".world")?.innerText.includes("B 的独立内容"));
  assert.equal(second.url(), bURL);

  const directLibrary = await newPage();
  await control({ reset: true, storage: { [`canvas:doc:v1:${cloudOnly.id}`]: cloudOnly } });
  await directLibrary.goto(`${base}/#/canvases`);
  await management(directLibrary);
  await button(directLibrary, `打开画布：${cloudOnly.name}`).waitFor();
  assert.equal(
    await button(directLibrary, "打开画布：未命名画布").count(),
    0,
    "direct library entry discovers cloud canvases before deciding whether to create a blank one",
  );
  assert.equal(
    await directLibrary.locator(".library-card").count(),
    1,
    "direct library entry lists the sole pre-seeded cloud canvas",
  );

  const failedLocal = await newPage();
  const retained = { ...localCanvas, id: "local-query-failure", name: "查询失败时保留的本机画布" };
  await seedLocal(failedLocal, retained);
  let localQueryAttempts = 0;
  await failedLocal.route(canonicalList, async (route) => {
    if (++localQueryAttempts === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "APP_GATEWAY_UNAVAILABLE", error: "隔离测试：云端列表暂时不可用" }) });
    else await route.continue();
  });
  await failedLocal.goto(`${base}/#/canvas/${retained.id}`);
  await management(failedLocal);
  await failedLocal.getByText("云端列表未能更新，当前仍显示本机画布。", { exact: true }).waitFor();
  assert.equal(await failedLocal.locator(".library-card").count(), 1, "failed cloud discovery preserves the known local list");
  assert.equal(await button(failedLocal, `打开画布：${retained.name}`).isEnabled(), true);
  await button(failedLocal, "刷新列表").click();
  await settle(failedLocal);
  await button(failedLocal, `打开画布：${cloudOnly.name}`).waitFor();
  assert.equal(await failedLocal.locator(".library-card").count(), 2, "retry adds the cloud canvas without replacing the local canvas");

  await control({ reset: true, storage: { "canvas:migrations:documents:v1": { completed: true }, [`canvas:doc:v1:${cloudOnly.id}`]: cloudOnly } });
  const failedEmpty = await newPage();
  let emptyQueryAttempts = 0;
  await failedEmpty.route(canonicalList, async (route) => {
    if (++emptyQueryAttempts === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "APP_GATEWAY_UNAVAILABLE", error: "隔离测试：云端列表暂时不可用" }) });
    else await route.continue();
  });
  await failedEmpty.goto(`${base}/#/canvases`);
  await failedEmpty.getByRole("heading", { name: "云端画布暂时无法读取", exact: true }).waitFor();
  assert.equal(await failedEmpty.locator(".library-card").count(), 0);
  assert.equal(await button(failedEmpty, "打开画布：未命名画布").count(), 0, "failed discovery cannot fabricate a new blank canvas");
  await button(failedEmpty, "重试查询").click();
  await management(failedEmpty);
  await button(failedEmpty, `打开画布：${cloudOnly.name}`).waitFor();
  assert.equal(await failedEmpty.locator(".library-card").count(), 1, "empty-state retry opens the existing cloud canvas");
  assert.equal(await button(failedEmpty, "打开画布：未命名画布").count(), 0);

  await control({ reset: true, storage: { "canvas:migrations:documents:v1": { completed: true }, [`canvas:doc:v1:${cloudOnly.id}`]: cloudOnly } });
  const failedLink = await newPage();
  const fallback = { ...localCanvas, id: "local-link-fallback", name: "直链失败时的本机备用画布" };
  await seedLocal(failedLink, fallback);
  let linkQueryAttempts = 0;
  await failedLink.route(canonicalList, async (route) => {
    if (++linkQueryAttempts === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "APP_GATEWAY_UNAVAILABLE", error: "隔离测试：云端目标查询暂时不可用" }) });
    else await route.continue();
  });
  const targetURL = `${base}/#/canvas/${cloudOnly.id}`;
  await failedLink.goto(targetURL);
  await current(failedLink, fallback.name);
  await failedLink.getByText("云端列表未能更新，当前仍显示本机画布。", { exact: true }).waitFor();
  await settle(failedLink);
  assert.equal(failedLink.url(), targetURL, "a failed direct link retains its requested canvas identity while the fallback is visible");
  assert.equal(await failedLink.locator(".library-card").count(), 1);
  await button(failedLink, "刷新列表").click();
  await current(failedLink, cloudOnly.name);
  await settle(failedLink);
  assert.equal(failedLink.url(), targetURL, "retry opens the original direct-link target instead of remaining on the fallback");
  assert.equal(await failedLink.locator(".library-card").count(), 2, "link recovery preserves the fallback alongside its target");
  await failedLink.waitForFunction(() => document.querySelector(".world")?.innerText.includes("侧栏打开前不会加载"));

  const newerCloud = {
    ...cloudOnly,
    id: "cloud-newer-fallback",
    name: "更新时间更晚的另一张云端画布",
    updatedAt: "2026-10-14T00:02:00.000Z",
    nodes: [{ ...cloudOnly.nodes[0], id: "newer-cloud-note", text: "不能代替直链指定的内容" }],
  };
  await control({ reset: true, storage: {
    "canvas:migrations:documents:v1": { completed: true },
    [`canvas:doc:v1:${cloudOnly.id}`]: cloudOnly,
    [`canvas:doc:v1:${newerCloud.id}`]: newerCloud,
  } });
  const failedCloudLink = await newPage();
  let cloudLinkAttempts = 0;
  await failedCloudLink.route(canonicalList, async (route) => {
    if (++cloudLinkAttempts === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "APP_GATEWAY_UNAVAILABLE", error: "隔离测试：直链查询暂时不可用" }) });
    else await route.continue();
  });
  await failedCloudLink.goto(targetURL);
  await failedCloudLink.getByRole("heading", { name: "云端画布暂时无法读取", exact: true }).waitFor();
  await settle(failedCloudLink);
  assert.equal(failedCloudLink.url(), targetURL, "a failed cloud-only link retains its URL without a local fallback");
  assert.equal(await failedCloudLink.locator(".library-card").count(), 0, "failed cloud-only discovery does not create a blank canvas");
  await button(failedCloudLink, "重试查询").click();
  await current(failedCloudLink, cloudOnly.name);
  await settle(failedCloudLink);
  assert.equal(failedCloudLink.url(), targetURL, "cloud-only retry opens the requested document rather than a newer fallback");
  assert.equal(await failedCloudLink.locator(".library-card").count(), 2);
  await failedCloudLink.waitForFunction(() => document.querySelector(".world")?.innerText.includes("侧栏打开前不会加载"));

  await control({ reset: true, storage: {
    "canvas:migrations:documents:v1": { completed: true },
    [`canvas:doc:v1:${cloudOnly.id}`]: cloudOnly,
  } });
  const freshHome = await newPage();
  await freshHome.goto(`${base}/`);
  await current(freshHome, cloudOnly.name);
  await management(freshHome);
  assert.equal(freshHome.url(), targetURL, "a fresh normal entry opens the existing cloud canvas");
  assert.equal(await freshHome.locator(".library-card").count(), 1);
  assert.equal(await button(freshHome, "打开画布：未命名画布").count(), 0, "a fresh normal entry discovers cloud documents before creating any blank canvas");

  const deletedCloud = {
    ...cloudOnly,
    id: "cloud-deleted-before-import",
    name: "首次发现后可恢复的云端画布",
    updatedAt: "2026-10-13T00:01:00.000Z",
    deletedAt: "2026-10-13T00:01:00.000Z",
  };
  await control({ reset: true, storage: {
    "canvas:migrations:documents:v1": { completed: true },
    [`canvas:doc:v1:${cloudOnly.id}`]: cloudOnly,
    [`canvas:doc:v1:${deletedCloud.id}`]: deletedCloud,
  } });
  const cloudTrash = await newPage();
  await cloudTrash.goto(`${base}/#/canvases`);
  await management(cloudTrash);
  assert.equal(await button(cloudTrash, `打开画布：${deletedCloud.name}`).count(), 0, "a cloud tombstone is not imported into the active list");
  const importedTrash = await cloudTrash.evaluate(async (id) => {
    const { getCanvas } = await import("/src/library-store.ts");
    const document = await getCanvas(id);
    return { deletedAt: document?.deletedAt, updatedAt: document?.updatedAt };
  }, deletedCloud.id);
  assert.deepEqual(importedTrash, { deletedAt: deletedCloud.deletedAt, updatedAt: deletedCloud.updatedAt }, "cloud discovery preserves original deletion and update timestamps for version-checked restoration");
  await cloudTrash.getByRole("button", { name: /^回收站 ·/ }).click();
  await button(cloudTrash, `恢复画布：${deletedCloud.name}`).click();
  await settle(cloudTrash);
  await eventually(async () => {
    const remote = (await state()).storage[`canvas:doc:v1:${deletedCloud.id}`];
    return remote && !remote.deletedAt;
  }, "newly discovered cloud trash restores remotely without a false version conflict");
  await button(cloudTrash, "返回全部画布").click();
  await open(cloudTrash, deletedCloud.name);
  await cloudTrash.waitForFunction(() => document.querySelector(".world")?.innerText.includes("侧栏打开前不会加载"));
  console.log("PASS cloud discovery preserves local rows, unavailable collaboration, failure/retry with and without local canvases");
  assert.deepEqual(errors, []);
  await management(page);
  await page.screenshot({ path: `${artifacts}/library-list-flow.png`, fullPage: true });
  await writeFile(`${artifacts}/library-list-flow-result.json`, JSON.stringify({ passed: true, checks: ["local startup avoids full cloud enumeration", "cloud discovery preserves local list and available actions", "unavailable collaboration is not interactive", "no extra blank on reload", "create/switch/save/reload", "search recovery", "rename/trash/restore", "second-context cloud discovery", "direct cloud library without stray blank", "local cloud-discovery failure and retry", "empty cloud-discovery failure and retry without stray blank", "failed direct link retains target and retry opens it", "cloud-only failed link retry selects its target over a newer document", "fresh normal startup discovers cloud canvas without creating a blank", "newly discovered cloud trash retains timestamps and restores remotely"], errors }, null, 2));
  console.log("PASS independent second browser context, list discovery, correct document content; no page errors");
} catch (error) {
  for (let index = 0; index < pages.length; index++) {
    await writeFile(`${artifacts}/library-list-flow-failure-${index}.html`, await pages[index].content()).catch(() => {});
    await pages[index].screenshot({ path: `${artifacts}/library-list-flow-failure-${index}.png`, fullPage: true }).catch(() => {});
    console.error(`PAGE ${index}: ${(await pages[index].locator("body").innerText().catch(() => "")).slice(0, 4000)}`);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  fixture.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => fixture.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
  console.log("CLOSED isolated canvas list browser and fixture");
}
