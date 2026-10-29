/** Two-device regression for cloud version prompts during ordinary collaboration. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5195";
const api = "http://127.0.0.1:5196";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5195", "--api-port=5196"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Collaboration fixture did not become ready")), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += chunk.toString(); });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => {
    clearTimeout(timeout);
    if (code !== 0) reject(new Error(`Collaboration fixture exited ${code}: ${fixtureOutput}`));
  });
});

let browser;
const contexts = [];
const pages = [];
const errors = [];
const state = async () => (await fetch(`${api}/__fixture/state`)).json();
const eventually = async (check, description, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
};
const button = (page, name) => page.getByRole("button", { name, exact: true });
const firstNoteText = async page => page.locator(".node.note").first().innerText().catch(() => "");
const newPage = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  contexts.push(context);
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  return page;
};
const management = async page => {
  await page.getByLabel("无限创作画布").waitFor();
  const manage = button(page, "管理画布");
  const library = button(page, "我的画布");
  if (await manage.isVisible()) await manage.click();
  else if (await library.isVisible()) await library.click();
  await page.getByLabel("搜索画布名称").waitFor();
};
const open = async (page, name) => {
  await management(page);
  const card = button(page, `打开画布：${name}`);
  const id = await card.evaluate(element => element.closest("[data-canvas-id]")?.getAttribute("data-canvas-id"));
  assert.ok(id);
  await card.click();
  await page.waitForFunction(expected => location.hash === `#/canvas/${expected}`, id);
  await page.getByLabel("无限创作画布").waitFor();
  return id;
};
const editFirstNote = async (page, text) => {
  const note = page.locator(".node.note").first();
  const editor = page.getByLabel("编辑节点内容", { exact: true });
  if (!(await editor.isVisible().catch(() => false))) await note.dblclick();
  await editor.fill(text);
  await button(page, "完成").click();
};

try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const first = await newPage();
  await first.goto(base);
  await first.getByLabel("无限创作画布").waitFor();
  await management(first);
  await button(first, "新建画布").first().click();
  await first.getByRole("dialog").getByRole("textbox", { name: "画布名称", exact: true }).fill("协作稳定性验证");
  await button(first, "创建画布").click();
  await first.getByRole("dialog").waitFor({ state: "hidden" });
  await first.getByLabel("无限创作画布").waitFor();
  const id = first.url().split("/canvas/")[1];
  await eventually(async () =>
    (await first.locator(".save-status-text").innerText().catch(() => "")) === "已保存到本机与云端",
  "new canvas initial save settles");

  await button(first, "添加节点").click();
  await first.getByRole("button", { name: "文本 记录灵感、脚本与创作说明 T", exact: true }).click();
  await first.getByLabel("编辑节点内容", { exact: true }).fill("共同起点");
  await button(first, "完成").click();
  await first.getByText("共同起点", { exact: true }).waitFor();
  await eventually(async () => {
    const doc = (await state()).storage[`canvas:doc:v1:${id}`];
    return doc?.nodes?.some(node => node.text === "共同起点");
  }, "initial note reaches cloud");
  await first.waitForTimeout(6000);
  assert.equal(await button(first, "重新加载").count(), 0,
    "a document's own confirmed save must not appear as a new remote version");

  const second = await newPage();
  await second.goto(`${base}/#/canvas/${id}`);
  await second.waitForFunction(expected => location.hash === `#/canvas/${expected}`, id);
  await second.getByLabel("无限创作画布").waitFor();
  await second.getByText("共同起点", { exact: true }).waitFor();

  const requestSequence = (await state()).requests.length;
  const controlResponse = await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storageBatchDelayMs: 2500 }),
  });
  assert.equal(controlResponse.status, 200);
  await editFirstNote(first, "协作者一的首次修改");
  await eventually(async () => (await state()).requests.some(request =>
    request.sequence > requestSequence && request.outcome === "delayed-batch-started"),
  "first cloud write is in flight", 20000);
  const releaseDelay = await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storageBatchDelayMs: 0 }),
  });
  assert.equal(releaseDelay.status, 200);
  // Continue editing the same field while the earlier save is still awaiting
  // its cloud acknowledgement. The acknowledgement must become the new base.
  await editFirstNote(first, "协作者一的连续修改");
  await eventually(async () => {
    const doc = (await state()).storage[`canvas:doc:v1:${id}`];
    return doc?.nodes?.some(node => node.text === "协作者一的连续修改");
  }, "the latest same-device edit reaches cloud");
  await second.getByText("协作者一的连续修改", { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(await button(second, "重新加载").count(), 0,
    "a second device must incorporate a non-conflicting remote edit without a prompt");

  await editFirstNote(second, "协作者二的修改");
  await eventually(async () => {
    const doc = (await state()).storage[`canvas:doc:v1:${id}`];
    return doc?.nodes?.some(node => node.text === "协作者二的修改");
  }, "second collaborator's edit reaches cloud");
  await eventually(async () => (await firstNoteText(first)).includes("协作者二的修改"),
    "first collaborator receives the second edit", 25000);
  await first.waitForTimeout(6000);
  assert.equal(await button(first, "重新加载").count(), 0,
    "the accepted collaboration state must not keep reopening the reload prompt");
  assert.equal(await button(second, "重新加载").count(), 0);

  assert.deepEqual(errors, []);
  console.log("PASS two-device edits synchronize without repeated reload prompts");
} catch (error) {
  for (let index = 0; index < pages.length; index++) {
    await pages[index].screenshot({ path: `${artifacts}/cloud-collaboration-failure-${index}.png`, fullPage: true }).catch(() => {});
    console.error(`PAGE ${index}: ${(await pages[index].locator("body").innerText().catch(() => "")).slice(0, 4000)}`);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  for (const context of contexts) await context.close().catch(() => {});
  fixture.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => fixture.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
