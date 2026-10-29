/** Grouped canvas cards keep node-level actions and explicit whole-group movement. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createImageNode } from "./canvas-ui.mjs";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const port = 5457;
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", `--port=${port}`, `--api-port=${port + 1}`], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "";
let browser;
let page;
const errors = [];
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Grouped interaction fixture timed out: ${fixtureOutput}`)), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) {
      clearTimeout(timeout);
      resolve();
    }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += chunk.toString(); });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => {
    clearTimeout(timeout);
    if (code) reject(new Error(`Grouped interaction fixture exited ${code}: ${fixtureOutput}`));
  });
});

const button = name => page.getByRole("button", { name, exact: true });
const creator = () => page.getByRole("complementary", { name: "图片创作", exact: true });
const geometry = node => node.evaluate(element => ({
  x: parseFloat(element.style.left),
  y: parseFloat(element.style.top),
}));
const center = async node => {
  const rect = await node.boundingBox();
  assert.ok(rect);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};
const closeCreator = async () => {
  await creator().waitFor({ state: "visible" });
  await button("关闭图片创作").click();
  await creator().waitFor({ state: "detached" });
};

try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    // This spec checks group behavior, not transitions. Removing motion keeps
    // the setup and menu clicks deterministic on slower desktop browsers.
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  const closeLibrary = button("收起画布列表").first();
  if (await closeLibrary.isVisible()) await closeLibrary.click();

  await createImageNode(page);
  const prompt = page.locator(".node.prompt").first();
  await closeCreator();

  await button("添加节点").click();
  await page.getByRole("button", { name: "文本 记录灵感、脚本与创作说明 T", exact: true }).click();
  await page.getByLabel("编辑节点内容", { exact: true }).fill("分组交互回归");
  await button("完成").click();
  const note = page.locator(".node.note").first();

  await prompt.click();
  await closeCreator();
  await note.click({ modifiers: ["Shift"] });
  assert.equal(await page.locator(".node.selected").count(), 2, "two nodes are selected before grouping");
  await page.keyboard.press("ControlOrMeta+g");
  const groupFrame = page.locator(".node-group-frame").first();
  await groupFrame.waitFor();

  // A member click is a node-level action even though the cards belong to a group.
  await prompt.click();
  await creator().waitFor({ state: "visible" });
  assert.equal(await page.getByLabel("创作画面描述", { exact: true }).count(), 1, "grouped creator remains editable");
  await closeCreator();
  await note.click();
  assert.equal(await page.locator(".node.selected").count(), 1, "clicking a group member selects only that node");
  await note.getByRole("button", { name: "节点属性", exact: true }).click();
  const inspector = page.locator('.inspector[aria-label="节点属性"]');
  await inspector.waitFor({ state: "visible" });
  await button("关闭节点设置").click();
  await inspector.waitFor({ state: "hidden" });

  // The context menu resolves the card under the pointer instead of reopening
  // the group menu, so node-specific commands remain available.
  const notePoint = await center(note);
  await page.mouse.click(notePoint.x, notePoint.y, { button: "right" });
  const nodeMenu = page.getByRole("menu", { name: "节点操作菜单", exact: true });
  await nodeMenu.waitFor();
  assert.equal(await nodeMenu.getByRole("menuitem", { name: /^复制节点/ }).count(), 1);
  assert.equal(await nodeMenu.getByRole("menuitem", { name: "移出当前分组", exact: true }).count(), 1);
  await page.keyboard.press("Escape");

  // Dragging a member is a node-level operation. The other member and the
  // group frame must stay where they are until the explicit frame surface is
  // dragged.
  const beforePrompt = await geometry(prompt);
  const beforeNote = await geometry(note);
  const dragPoint = await center(note);
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 48, dragPoint.y + 26, { steps: 8 });
  await page.mouse.up();
  const afterPrompt = await geometry(prompt);
  const afterNote = await geometry(note);
  assert.equal(afterPrompt.x, beforePrompt.x, "dragging a grouped member does not move its sibling");
  assert.equal(afterPrompt.y, beforePrompt.y, "dragging a grouped member does not move its sibling");
  assert.notEqual(afterNote.x, beforeNote.x, "grouped member moves independently on x");
  assert.notEqual(afterNote.y, beforeNote.y, "grouped member moves independently on y");

  // The padded frame remains the explicit whole-group movement surface.
  const frameBefore = [await geometry(prompt), await geometry(note)];
  const movableFrame = await groupFrame.boundingBox();
  assert.ok(movableFrame);
  const framePoint = { x: movableFrame.x + 5, y: movableFrame.y + 5 };
  await page.mouse.move(framePoint.x, framePoint.y);
  await page.mouse.down();
  await page.mouse.move(framePoint.x + 42, framePoint.y + 22, { steps: 8 });
  await page.mouse.up();
  const frameAfter = [await geometry(prompt), await geometry(note)];
  assert.equal(frameAfter[0].x - frameBefore[0].x, frameAfter[1].x - frameBefore[1].x, "frame drag keeps group x displacement");
  assert.equal(frameAfter[0].y - frameBefore[0].y, frameAfter[1].y - frameBefore[1].y, "frame drag keeps group y displacement");

  // The padded frame remains the whole-group selection surface.
  const frameRect = await groupFrame.boundingBox();
  assert.ok(frameRect);
  await page.mouse.click(frameRect.x + 5, frameRect.y + 5);
  assert.equal(await page.locator(".node.selected").count(), 2, "group frame selects all visible members");
  await button("整理组内").click();
  await groupFrame.waitFor();
  assert.equal(await page.locator(".node.selected").count(), 2, "group content arrangement keeps the full group selected");
  const groupFrameRect = await groupFrame.boundingBox();
  assert.ok(groupFrameRect);
  await page.mouse.click(groupFrameRect.x + 5, groupFrameRect.y + 5, { button: "right" });
  const groupMenu = page.getByRole("menu", { name: "节点操作菜单", exact: true });
  await groupMenu.waitFor();
  await groupMenu.getByRole("menuitem", { name: "整理组内", exact: true }).click();
  assert.equal(await page.locator(".node.selected").count(), 2, "context-menu arrangement keeps the full group selected");
  assert.equal(await page.getByRole("button", { name: "解组", exact: true }).count(), 1);
  await button("解组").click();
  await groupFrame.waitFor({ state: "detached" });
  assert.deepEqual(errors, [], `browser page errors: ${errors.join("; ")}`);
  console.log("PASS grouped members keep node actions, context menus, group dragging and frame selection");
} finally {
  await browser?.close();
  if (fixture.exitCode === null) fixture.kill("SIGTERM");
}
