/** Run against platform-fixture.mjs in an isolated browser profile; no live models. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
  process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.CANVAS_TEST_URL || "http://127.0.0.1:5191";
const api = process.env.CANVAS_TEST_API || "http://127.0.0.1:5192";
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const control = (body) =>
  fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
await control({ reset: true, slowPolls: 6 });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
    ? {}
    : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
const button = (name) => page.getByRole("button", { name, exact: true });
const hasText = async (text) => {
  await page.waitForFunction(
    (value) => document.querySelector(".world")?.innerText.includes(value),
    text,
  );
};
const management = async () => {
  await page.getByLabel("无限创作画布").waitFor();
  if (await button("管理画布").isVisible()) await button("管理画布").click();
  await page.getByLabel("搜索画布名称").waitFor();
};
const collapse = async () => {
  await button("收起画布列表").first().click();
  await button("管理画布").waitFor();
};
const current = async (name) => {
  await page.waitForFunction(
    (value) => document.querySelector(".project-name")?.value === value,
    name,
  );
  await page.getByLabel("无限创作画布").waitFor();
};
const open = async (name) => {
  await management();
  await button(`打开画布：${name}`).click();
  await current(name);
};
const action = async (name, label) => {
  await management();
  await button(`画布操作：${name}`).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};
const create = async (name) => {
  await management();
  await button("新建画布").first().click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "画布名称", exact: true })
    .fill(name);
  await button("创建画布").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await current(name);
  return page.url();
};
try {
  await page.goto(base);
  await page.getByLabel("无限创作画布").waitFor();
  assert.match(
    page.url(),
    /#\/canvas\//,
    "startup enters a working canvas directly",
  );
  const firstUrl = page.url();
  await page.reload();
  await page.getByLabel("无限创作画布").waitFor();
  assert.equal(
    page.url(),
    firstUrl,
    "reload retains the initial canvas identity",
  );
  const aUrl = await create("城市海报 A");
  await button("创建图片").click();
  await page
    .getByLabel("创作画面描述")
    .fill("A 专属内容：雨夜城市与暖色灯光。");
  await button("缩放选项").click();
  await button("50%").click();
  const editor = await page.locator(".canvas-board").elementHandle();
  const transform = await page.locator(".world").getAttribute("style");
  assert.equal(await button("撤销 · ⌘Z").isEnabled(), true);
  await collapse();
  await management();
  assert.equal(
    await editor.evaluate((node) => node.isConnected),
    true,
    "sidebar toggle keeps the mounted editor",
  );
  assert.equal(page.url(), aUrl, "sidebar toggle is not navigation");
  await page.waitForFunction(
    (style) =>
      document.querySelector(".world")?.getAttribute("style") === style,
    transform,
  );
  assert.equal(
    await button("撤销 · ⌘Z").isEnabled(),
    true,
    "sidebar toggle keeps undo history",
  );
  await hasText("A 专属内容");
  // Creation and switching must commit the current textarea before its autosave debounce.
  await page
    .getByLabel("创作画面描述")
    .fill("A 专属内容：雨夜城市与暖色灯光。");
  const bUrl = await create("产品灵感 B");
  assert.notEqual(aUrl, bUrl);
  await button("创建图片").click();
  await page.getByLabel("创作画面描述").fill("B 专属内容：极简产品摄影。");
  await open("城市海报 A");
  await hasText("A 专属内容");
  assert.equal(
    (await page.locator(".world").innerText()).includes("B 专属内容"),
    false,
  );
  await page.reload();
  await page.getByLabel("无限创作画布").waitFor();
  assert.equal(page.url(), aUrl);
  await hasText("A 专属内容");
  await open("产品灵感 B");
  await hasText("B 专属内容");
  assert.equal(
    await button("撤销 · ⌘Z").isEnabled(),
    false,
    "history does not cross canvases",
  );
  console.log(
    "PASS direct startup, A/B creation, instant save, reload, sidebar preserves viewport/editor/history, isolated undo",
  );

  await action("城市海报 A", "重命名画布：城市海报 A");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "画布名称", exact: true })
    .fill("城市海报 · 已命名");
  await button("保存名称").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await open("城市海报 · 已命名");
  await page
    .getByRole("article", { name: "图片创作 · 图片提示词", exact: true })
    .click();
  const latestText = "A 专属内容：雨夜城市与暖色灯光。复制前最新输入。";
  await page.getByLabel("创作画面描述").fill("重命名前的未保存输入");
  const renameEditor = await page.locator(".canvas-board").elementHandle();
  await action("城市海报 · 已命名", "重命名画布：城市海报 · 已命名");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "画布名称", exact: true })
    .fill("城市海报 · 最终");
  await button("保存名称").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await current("城市海报 · 最终");
  assert.equal(
    await renameEditor.evaluate((node) => node.isConnected),
    true,
    "renaming the active canvas does not remount it",
  );
  await hasText("重命名前的未保存输入");
  await page.getByLabel("创作画面描述").fill(latestText);
  await action("城市海报 · 最终", "复制画布：城市海报 · 最终");
  await button("打开画布：城市海报 · 最终 副本").waitFor();
  await open("城市海报 · 最终 副本");
  await hasText(latestText);
  await open("产品灵感 B");
  await action("产品灵感 B", "将画布 产品灵感 B 移入回收站");
  await page.waitForFunction(
    () => document.querySelector(".project-name")?.value !== "产品灵感 B",
  );
  assert.notEqual(
    page.url(),
    bUrl,
    "trashing the active canvas selects another working canvas",
  );
  await page.getByRole("tab", { name: /回收站/ }).click();
  await button("恢复画布：产品灵感 B").waitFor();
  await page.reload();
  await management();
  await page.getByRole("tab", { name: /回收站/ }).click();
  await button("恢复画布：产品灵感 B").click();
  await page.getByRole("tab", { name: /全部画布/ }).click();
  await button("打开画布：产品灵感 B").waitFor();
  await page.getByLabel("搜索画布名称").fill("无匹配名称");
  await page.getByText(/没有找到/).waitFor();
  await button("清除搜索").first().click();
  await page.screenshot({
    path: `${artifacts}/library-desktop.png`,
    fullPage: true,
  });
  console.log(
    "PASS current/inactive rename, latest-content duplicate, active trash/reload/restore and search",
  );

  await open("城市海报 · 最终");
  const download = page.waitForEvent("download");
  await button("导出画布").click();
  const file = await download;
  const exportPath = `${artifacts}/exported-canvas.json`;
  await file.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  assert.equal(exported.nodes[0].text, latestText);
  await management();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^导入画布/ }).click();
  await (await chooser).setFiles(exportPath);
  await page.waitForURL((url) => url.href !== aUrl);
  await page.getByLabel("无限创作画布").waitFor();
  const importedUrl = page.url();
  assert.notEqual(importedUrl, aUrl, "import creates a new identity");
  await hasText(latestText);
  // Browser history moves directly between working canvases.
  await page.goBack();
  await page.waitForURL(aUrl);
  await current("城市海报 · 最终");
  await open("产品灵感 B");
  await page.goBack();
  await page.waitForURL(aUrl);
  await current("城市海报 · 最终");
  await page.goForward();
  await page.waitForURL(bUrl);
  await current("产品灵感 B");
  await hasText("B 专属内容");
  console.log(
    "PASS export/import new identity and browser back/forward between canvases",
  );

  await page
    .getByRole("article", { name: "图片创作 · 图片提示词", exact: true })
    .click();
  await page
    .locator('option[value="fixture-slow"]')
    .waitFor({ state: "attached" });
  await page.getByLabel("创作图片模型").selectOption("fixture-slow");
  await button("生成图片").click();
  await button("查看进度").click();
  await button("暂停查询").waitFor();
  const runningEditor = await page.locator(".canvas-board").elementHandle();
  const taskState = await (await fetch(`${api}/__fixture/state`)).json();
  const pollsBeforeToggle = taskState.requests.filter(
    (r) => r.method === "GET" && r.taskId,
  ).length;
  await collapse();
  await management();
  assert.equal(
    await runningEditor.evaluate((node) => node.isConnected),
    true,
    "managing canvases does not remount a running editor",
  );
  await button("暂停查询").waitFor();
  const deadline = Date.now() + 10000;
  let continuedPolling = false;
  while (Date.now() < deadline) {
    const result = await (await fetch(`${api}/__fixture/state`)).json();
    if (
      result.requests.filter((r) => r.method === "GET" && r.taskId).length >
      pollsBeforeToggle
    ) {
      continuedPolling = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    continuedPolling,
    true,
    "task polling continues after sidebar toggles",
  );
  await open("城市海报 · 最终 副本");
  assert.equal(await page.locator(".node.image").count(), 0);
  await page.reload();
  await open("产品灵感 B");
  await page
    .getByRole("article", { name: "图片创作 · 图片提示词", exact: true })
    .click();
  await button("继续查询原任务").click();
  await page.locator(".node.image").waitFor();
  await button("保存画布").click();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent?.includes("已保存"),
  );
  const state = await (await fetch(`${api}/__fixture/state`)).json();
  assert.equal(
    state.requests.filter(
      (r) => r.method === "POST" && r.model === "fixture-slow",
    ).length,
    1,
  );
  console.log(
    "PASS sidebar keeps active polling; pending task survives switching/reload with one POST",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByLabel("无限创作画布").waitFor();
  await button("管理画布").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await create("移动端画布");
  await button("管理画布").waitFor();
  await button("创建图片").click();
  await page.getByLabel("创作画面描述").fill("移动端输入");
  await management();
  await page.screenshot({
    path: `${artifacts}/library-mobile.png`,
    fullPage: true,
  });
  await open("城市海报 · 最终 副本");
  await button("管理画布").waitFor();
  await open("移动端画布");
  await hasText("移动端输入");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByLabel("搜索画布名称").waitFor();
  console.log(
    "PASS mobile starts collapsed, creates/edits/switches, and closes sidebar after selection",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/library-result.json`,
    JSON.stringify(
      {
        passed: true,
        canvasCount: await page.locator(".library-card").count(),
        errors,
        slowTaskPosts: 1,
        sidebarPreservesEditor: true,
        sidebarPreservesPolling: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({
    path: `${artifacts}/library-failure.png`,
    fullPage: true,
  });
  await writeFile(`${artifacts}/library-failure.html`, await page.content());
  console.error((await page.locator("body").innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser.close();
}
