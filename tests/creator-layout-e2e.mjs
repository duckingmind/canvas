/** Regression for the node-attached creator layout (disposable fixture only). */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const uiPort = 5247;
const apiPort = 5248;
const base = `http://127.0.0.1:${uiPort}`;
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", `--port=${uiPort}`, `--api-port=${apiPort}`], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`fixture timeout: ${output}`)), 20000);
  fixture.stdout.on("data", chunk => {
    output += chunk.toString();
    if (output.includes('"event":"ready"')) { clearTimeout(timer); resolve(); }
  });
  fixture.stderr.on("data", chunk => { output += chunk.toString(); });
  fixture.once("error", reject);
  fixture.once("exit", code => { if (code) reject(new Error(`fixture exited ${code}: ${output}`)); });
});

let browser;
try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(15000);
  await page.goto(base);
  const closeList = page.getByRole("button", { name: "收起画布列表", exact: true }).first();
  if (await closeList.isVisible()) await closeList.click();

  // The empty-canvas guide is passive so a real double-click can open the
  // node picker without the guide swallowing either pointer event.
  const emptyGuide = page.locator(".empty-canvas");
  await emptyGuide.getByText("双击画布开始创作", { exact: true }).waitFor();
  await emptyGuide.getByText("也可点击底部「添加节点」", { exact: true }).waitFor();
  assert.equal(await emptyGuide.evaluate(element => getComputedStyle(element).pointerEvents), "none");
  const board = await page.getByLabel("无限创作画布").boundingBox();
  assert.ok(board);
  await page.mouse.dblclick(board.x + board.width / 2, board.y + board.height / 2);
  const picker = page.getByRole("dialog", { name: "添加节点", exact: true });
  await picker.waitFor();
  await picker.getByRole("button", { name: /图片生成/ }).click();
  await emptyGuide.waitFor({ state: "detached" });
  const editor = page.getByRole("complementary", { name: "图片创作", exact: true });
  await editor.waitFor();
  const targetId = await page.locator(".node.selected").getAttribute("data-node-id");
  assert.ok(targetId);
  const target = page.locator(`[data-node-id="${targetId}"]`);
  const panel = page.locator(".creator-panel.context-creator");
  // Give the prompt enough content to exercise the normal editor height.
  await page.getByLabel("创作画面描述", { exact: true }).fill("画面高度回归测试：保持主体构图，生成一张完整图片。");
  const relation = async () => {
    const node = await target.boundingBox();
    const box = await panel.boundingBox();
    assert.ok(node && box);
    return { node, box };
  };
  const assertBelow = async (label) => {
    const { node, box } = await relation();
    assert.ok(Math.abs(box.y - (node.y + node.height + 14)) < 1.5, `${label}: editor must stay 14px below target`);
  };
  await assertBelow("initial placement");
  const initialWidth = (await panel.boundingBox()).width;
  const initialHeight = (await panel.boundingBox()).height;

  // Scrolling the board pans it; the editor and transformed target must move together.
  const transformBeforePan = await page.locator(".world").getAttribute("style");
  await page.mouse.move(1200, 850);
  await page.mouse.wheel(120, 80);
  await page.waitForFunction((before) => document.querySelector(".world")?.getAttribute("style") !== before, transformBeforePan);
  await assertBelow("after pan");
  const transformBeforeZoom = await page.locator(".world").getAttribute("style");
  await page.keyboard.down("Control");
  await page.mouse.move(1200, 850);
  await page.mouse.wheel(0, -22);
  await page.keyboard.up("Control");
  await page.waitForFunction((before) => document.querySelector(".world")?.getAttribute("style") !== before, transformBeforeZoom);
  await assertBelow("after zoom");
  const afterZoom = await panel.boundingBox();
  assert.ok(afterZoom);
  assert.ok(Math.abs(afterZoom.width - initialWidth) < 1, "zoom must not resize editor width");
  assert.ok(Math.abs(afterZoom.height - initialHeight) < 1, "zoom must not resize editor height");

  await page.getByRole("button", { name: "展开画面描述", exact: true }).click();
  const expanded = await panel.boundingBox();
  assert.ok(expanded && expanded.height > initialHeight, "expanded editor should grow vertically");
  // Move the target below the viewport. The editor may be clipped, but must keep
  // its natural height instead of being compressed by a viewport max-height.
  const transformBeforeBottomPan = await page.locator(".world").getAttribute("style");
  await page.mouse.move(1200, 850);
  await page.mouse.wheel(0, -900);
  await page.waitForFunction((before) => document.querySelector(".world")?.getAttribute("style") !== before, transformBeforeBottomPan);
  await assertBelow("expanded near bottom edge");
  const expandedAfterPan = await panel.boundingBox();
  assert.ok(expandedAfterPan && Math.abs(expandedAfterPan.height - expanded.height) < 1, "pan must not change expanded editor height");
  await page.screenshot({ path: fileURLToPath(new URL("./artifacts/creator-layout.png", import.meta.url)), fullPage: true });

  console.log("PASS creator stays below its target through pan/zoom and keeps screen-size dimensions");
} finally {
  if (browser) await browser.close();
  fixture.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 100));
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
