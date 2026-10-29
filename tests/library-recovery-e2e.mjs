/** Isolated recovery/cloud regression. Starts and closes its own 5195/5196 fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createImageNode } from "./canvas-ui.mjs";

const { chromium } = await import(
  process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5195";
const api = "http://127.0.0.1:5196";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(
  process.execPath,
  ["tests/platform-fixture.mjs", "--port=5195", "--api-port=5196"],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Recovery fixture did not become ready")),
    20000,
  );
  fixture.stdout.on("data", (chunk) => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) {
      clearTimeout(timeout);
      resolve();
    }
  });
  fixture.stderr.on("data", (chunk) => {
    fixtureOutput += chunk.toString();
  });
  fixture.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  fixture.once("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0)
      reject(new Error(`Recovery fixture exited ${code}: ${fixtureOutput}`));
  });
});
let browser;
const pages = [];
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
const eventually = async (check, description, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
};
const button = (page, name) => page.getByRole("button", { name, exact: true });
const current = async (page, name) => {
  void name;
  await page.getByLabel("无限创作画布").waitFor();
};
const management = async (page) => {
  await page.getByLabel("无限创作画布").waitFor();
  const managementButton = button(page, "管理画布");
  const libraryButton = button(page, "我的画布");
  if (await managementButton.isVisible()) await managementButton.click();
  else if (await libraryButton.isVisible()) await libraryButton.click();
  await page.getByLabel("搜索画布名称").waitFor();
};
const open = async (page, name) => {
  await management(page);
  const card = button(page, `打开画布：${name}`);
  const id = await card.evaluate((element) => element.closest("[data-canvas-id]")?.getAttribute("data-canvas-id"));
  assert.ok(id, `canvas card has an ID: ${name}`);
  await card.click();
  await page.waitForFunction((expectedId) => location.hash === `#/canvas/${expectedId}`, id);
  await current(page, name);
};
const reviewRecovery = async (page) => {
  await page.getByRole("button", { name: /查看保存与恢复/ }).click();
  await button(page, "查看待恢复版本").click();
};
const action = async (page, name, label) => {
  await management(page);
  await button(page, `画布操作：${name}`).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};
const newPage = async () => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  return page;
};
const legacyDocument = (name, text) => ({
  name,
  updatedAt: "2026-09-09T10:00:00.000Z",
  nodes: [
    {
      id: "legacy-note",
      type: "note",
      title: "旧版内容",
      text,
      x: 100,
      y: 100,
      width: 300,
      height: 180,
      color: "#e9b86f",
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

try {
  await ready;
  console.log("READY isolated recovery fixture 5195/5196");
  await control({
    storage: {
      "canvas:document:v3": legacyDocument(
        "旧云端不同版本",
        "云端独有创作说明",
      ),
    },
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const first = await newPage();
  // Seed account-owned local canvases before mounting the application.
  await first.route("**/__recovery-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Recovery seed</title>",
    }),
  );
  await first.goto(`${base}/__recovery-seed`);
  await first.evaluate(
    async ({ workspace, recovery }) => {
      const { setLocalStorageScope } = await import("/src/local-storage-scope.ts");
      const { saveCanvas } = await import("/src/library-store.ts");
      setLocalStorageScope("acs_" + "f".repeat(64));
      await saveCanvas({ ...workspace, id: "legacy-workspace", createdAt: workspace.updatedAt });
      await saveCanvas({ ...recovery, id: "legacy-recovery", createdAt: recovery.updatedAt });
    },
    {
      workspace: legacyDocument("旧本机工作画布", "本机独有创作说明"),
      recovery: legacyDocument("旧本机恢复画布", "恢复区创作说明"),
    },
  );
  await first.unroute("**/__recovery-seed");
  await first.goto(base);
  await management(first);
  await button(first, "打开画布：旧本机工作画布").waitFor();
  await button(first, "打开画布：旧本机恢复画布").waitFor();
  await eventually(
    async () =>
      (await state()).requests.some((r) =>
        r.path.includes(encodeURIComponent("canvas:document:v3")),
      ),
    "legacy cloud lookup",
  );
  assert.equal(await first.locator(".library-card").count(), 2);
  await open(first, "旧本机工作画布");
  assert.match(await first.locator("body").innerText(), /本机独有创作说明/);
  await reviewRecovery(first);
  await first.getByRole("button", { name: "重新加载", exact: true }).waitFor();
  const dialog = first.getByRole("dialog", { name: "云端新版本" });
  const overlay = first.locator(".cloud-version-backdrop");
  assert.equal(await dialog.getByRole("heading").count(), 0);
  assert.equal(await dialog.getByRole("button").count(), 1);
  const overlayBox = await overlay.boundingBox();
  assert.deepEqual(
    { x: overlayBox?.x, y: overlayBox?.y, width: overlayBox?.width, height: overlayBox?.height },
    { x: 0, y: 0, width: 1440, height: 960 },
    "the version mask covers the entire app, including the canvas list",
  );
  assert.equal(await button(first, "重新加载").count(), 1);
  assert.equal(await button(first, "继续当前画布并同步到云端").count(), 0);
  await button(first, "重新加载").click();
  await dialog.waitFor({ state: "hidden" });
  await eventually(
    async () =>
      (await state()).storage["canvas:doc:v1:legacy-workspace"]?.name ===
      "旧云端不同版本",
    "automatic merge publishes the selected conflict resolution",
  );
  const recovered = await first.evaluate(async () => {
    const { readDraft } = await import("/src/draft-store.ts");
    return readDraft("recovery:legacy-workspace");
  });
  assert.equal(recovered?.name, "旧本机工作画布");
  assert.equal(recovered?.nodes[0]?.text, "本机独有创作说明");
  assert.match(await first.locator("body").innerText(), /云端独有创作说明/);
  await management(first);
  await button(first, "打开画布：旧云端不同版本").waitFor();
  await button(first, "打开画布：旧本机恢复画布").waitFor();
  assert.equal(await first.locator(".library-card").count(), 2);
  await open(first, "旧本机恢复画布");
  assert.match(await first.locator("body").innerText(), /恢复区创作说明/);
  await management(first);
  console.log(
    "PASS account-scoped automatic cloud merge, full-screen version mask, recovery copy, and reload",
  );

  await button(first, "新建画布").first().click();
  await first
    .getByRole("dialog")
    .getByRole("textbox", { name: "画布名称", exact: true })
    .fill("跨设备画布");
  await button(first, "创建画布").click();
  await first.getByRole("dialog").waitFor({ state: "hidden" });
  await current(first, "跨设备画布");
  const sharedId = first.url().split("/canvas/")[1];
  await createImageNode(first);
  await first.getByLabel("创作画面描述").fill("跨设备专属内容");
  const delayedMerge = first.getByRole("button", { name: "重新加载", exact: true });
  await delayedMerge.waitFor({ state: "visible", timeout: 20000 });
  await delayedMerge.click();
  await first.getByRole("dialog", { name: "云端新版本" }).waitFor({ state: "hidden" });
  await button(first, "保存画布").click();
  await eventually(
    async () =>
      (await state()).storage[`canvas:doc:v1:${sharedId}`]?.nodes?.some(
        (n) => n.text === "跨设备专属内容",
      ),
    "shared document saved to independent cloud key",
  );
  await management(first);
  const second = await newPage();
  await second.goto(`${base}/#/canvas/${sharedId}`);
  await second.waitForFunction((id) => location.hash === `#/canvas/${id}`, sharedId);
  await second.getByLabel("无限创作画布").waitFor();
  assert.equal(
    second.url().split("/canvas/")[1],
    sharedId,
    "cloud-only direct link opens its requested canvas",
  );
  assert.equal(
    await button(second, "打开画布：未命名画布").count(),
    0,
    "remote direct link does not create a stray blank canvas",
  );
  await management(second);
  await button(second, "打开画布：跨设备画布").waitFor();
  await open(second, "跨设备画布");
  assert.match(await second.locator("body").innerText(), /跨设备专属内容/);
  await management(second);
  console.log(
    "PASS independent second browser context discovers multiple cloud canvases and their own contents",
  );

  await control({ storageFailuresRemaining: 1 });
  await action(second, "跨设备画布", "重命名画布：跨设备画布");
  await second
    .getByRole("dialog")
    .getByRole("textbox", { name: "画布名称", exact: true })
    .fill("云端失败仍保留本机");
  await button(second, "保存名称").click();
  await eventually(
    async () =>
      (await state()).requests.some(
        (r) => r.outcome === "retryable-storage-failure",
      ),
    "injected cloud write failure",
  );
  await second.getByText(/本机操作已完成|已保存本机 · 云端同步失败/).waitFor();
  await second.reload();
  await management(second);
  await button(second, "打开画布：云端失败仍保留本机").waitFor();
  await eventually(
    async () =>
      (await state()).storage[`canvas:doc:v1:${sharedId}`]?.name ===
      "云端失败仍保留本机",
    "queued local revision resumes after reload",
  );
  console.log(
    "PASS cloud write failure preserves the local rename and resumes sync after reload",
  );

  await control({ storageFailuresRemaining: 10000 });
  const requestsBeforeTrash = (await state()).requests.length;
  await action(
    second,
    "云端失败仍保留本机",
    "将画布 云端失败仍保留本机 移入回收站",
  );
  await eventually(
    async () =>
      (await state()).requests
        .slice(requestsBeforeTrash)
        .some((r) => r.outcome === "retryable-storage-failure"),
    "injected cloud delete failure",
  );
  assert.equal(
    (await state()).storage[`canvas:doc:v1:${sharedId}`].deletedAt,
    undefined,
    "failed deletion leaves the stale cloud copy active",
  );
  await management(second);
  await second.getByRole("tab", { name: /回收站/ }).click();
  await button(second, "恢复画布：云端失败仍保留本机").waitFor();
  await second.reload();
  await management(second);
  await second.getByRole("tab", { name: /回收站/ }).click();
  await button(second, "恢复画布：云端失败仍保留本机").waitFor();
  await second.getByRole("tab", { name: /^全部/ }).click();
  assert.equal(await button(second, "打开画布：跨设备画布").count(), 0);
  assert.equal(await button(second, "打开画布：云端失败仍保留本机").count(), 0);
  assert.equal(
    (await state()).storage[`canvas:doc:v1:${sharedId}`].deletedAt,
    undefined,
  );
  console.log(
    "PASS local tombstone survives reload and a still-live cloud copy never resurrects it",
  );

  assert.deepEqual(errors, []);
  await second.screenshot({
    path: `${artifacts}/library-recovery.png`,
    fullPage: true,
  });
  await writeFile(
    `${artifacts}/library-recovery-result.json`,
    JSON.stringify(
      {
        passed: true,
        errors,
        checks: [
          "account-scoped local recovery",
          "persisted local-only conflict choice",
          "explicit conflict sync choice",
          "second-context cloud discovery",
          "cloud-only direct link without extra blank canvas",
          "local rename despite cloud write failure",
          "local tombstone resists cloud resurrection",
        ],
      },
      null,
      2,
    ),
  );
  console.log("PASS all library recovery regressions");
} catch (error) {
  for (let index = 0; index < pages.length; index++) {
    await writeFile(
      `${artifacts}/library-recovery-failure-${index}.html`,
      await pages[index].content(),
    ).catch(() => {});
    await pages[index]
      .screenshot({
        path: `${artifacts}/library-recovery-failure-${index}.png`,
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      `PAGE ${index}: ${(
        await pages[index]
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 6000)}`,
    );
  }
  throw error;
} finally {
  if (browser) await browser.close();
  fixture.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => fixture.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
  console.log("CLOSED isolated recovery browser and fixture");
}
