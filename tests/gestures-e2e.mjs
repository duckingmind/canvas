/** Real browser input against a disposable, loopback-only platform fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5227", "--api-port=5228"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, page;
const errors = [], checks = [];
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(output || "Fixture timeout")), 20000);
  fixture.stdout.on("data", data => { output += data; if (output.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); } });
  fixture.stderr.on("data", data => { output += data; });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => { clearTimeout(timeout); if (code) reject(new Error(output)); });
});
const button = name => page.getByRole("button", { name, exact: true });
const creator = () => page.getByRole("complementary", { name: "图片创作", exact: true });
const viewport = () => page.locator(".world").evaluate(el => {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return { x: m.e, y: m.f, zoom: m.a };
});
const geometry = node => node.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) }));
const center = async node => { const r = await node.boundingBox(); assert.ok(r); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.1, `${message}: ${actual} ≠ ${expected}`);
const eventually = async (read, check, message) => {
  for (let i = 0; i < 100; i++) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
};
const passed = message => { checks.push(message); console.log(`PASS ${message}`); };
const closeCreator = async () => {
  await creator().waitFor({ state: "visible" });
  await button("关闭图片创作").click();
  await creator().waitFor({ state: "detached" });
};
const moveMouse = p => page.mouse.move(p.x, p.y);
const fitCanvas = async () => {
  await page.keyboard.press("ControlOrMeta+0");
  // Navigation is deliberately animated. Wait for its scheduled frame and
  // settled lifecycle before computing input coordinates for the next gesture.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator(".canvas-board.is-viewport-moving").waitFor({ state: "hidden" });
};

try {
  await ready;
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto("http://127.0.0.1:5227/");
  const closeLibrary = button("收起画布列表").first();
  if (await closeLibrary.isVisible()) await closeLibrary.click();
  await button("创建图片").click();
  await creator().waitFor();
  const id = await page.locator(".node.selected").getAttribute("data-node-id");
  const prompt = page.locator(`[data-node-id="${id}"]`);
  await page.getByLabel("创作画面描述", { exact: true }).fill("手势回归中保留的描述");
  await closeCreator();
  const original = await geometry(prompt);
  let p = await center(prompt);
  await moveMouse(p); await page.mouse.down(); await page.mouse.move(p.x + 2, p.y + 1); await page.mouse.up();
  await creator().waitFor();
  assert.deepEqual(await geometry(prompt), original);
  await closeCreator();
  await prompt.dblclick();
  await creator().waitFor();
  assert.equal(await page.getByLabel("创作画面描述", { exact: true }).inputValue(), "手势回归中保留的描述");
  passed("click jitter does not move a node; double-click opens editing and retains the draft");

  p = await center(prompt);
  await moveMouse(p); await page.mouse.down(); await page.mouse.move(p.x + 70, p.y + 40, { steps: 8 });
  await creator().waitFor({ state: "hidden" });
  await page.keyboard.press("Escape"); await page.mouse.up();
  await creator().waitFor();
  assert.deepEqual(await geometry(prompt), original);
  assert.equal(await page.locator(".canvas-board.gesturing").count(), 0);
  passed("Escape rolls back an in-flight drag and restores the existing editor");

  await closeCreator();
  p = await center(prompt);
  await moveMouse(p); await page.mouse.down(); await page.mouse.move(p.x + 70, p.y + 40, { steps: 8 }); await page.mouse.up();
  assert.notDeepEqual(await geometry(prompt), original);
  await creator().waitFor({ state: "detached" });
  assert.equal(await creator().count(), 0);
  await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual(await geometry(prompt), original);
  passed("drag moves without opening editing and records a single undo step");

  let before = await viewport();
  await page.mouse.move(100, 700); await page.mouse.wheel(80, 60);
  let after = await eventually(viewport, value => Math.abs(value.x - (before.x - 80)) < 0.01 && Math.abs(value.y - (before.y - 60)) < 0.01, "wheel pan settles at the exact accumulated delta");
  near(after.x, before.x - 80, "horizontal pan"); near(after.y, before.y - 60, "vertical pan"); near(after.zoom, before.zoom, "scroll does not zoom");
  before = after;
  const anchor = { x: 600, y: 400 };
  await moveMouse(anchor); await page.keyboard.down("Control"); await page.mouse.wheel(0, -24); await page.keyboard.up("Control");
  after = await eventually(viewport, value => Math.abs(value.zoom - before.zoom * Math.exp(0.24)) < 0.00001, "wheel zoom settles");
  const boardRect = await page.getByLabel("无限创作画布", { exact: true }).boundingBox();
  near((anchor.x - boardRect.x - after.x) / after.zoom, (anchor.x - boardRect.x - before.x) / before.zoom, "zoom keeps pointer x");
  near((anchor.y - boardRect.y - after.y) / after.zoom, (anchor.y - boardRect.y - before.y) / before.zoom, "zoom keeps pointer y");
  passed("trackpad scroll pans on both axes and Ctrl wheel zooms around the pointer");

  await fitCanvas();
  await prompt.click(); await closeCreator();
  let rect = await prompt.boundingBox();
  before = await viewport();
  await page.mouse.move(rect.x - 35, rect.y - 50); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width + 35, rect.y + rect.height + 35, { steps: 8 });
  await page.mouse.wheel(0, 50);
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.deepEqual(await viewport(), before);
  assert.equal(await prompt.getAttribute("class").then(value => value.includes("selected")), true);
  assert.equal(await page.locator(".marquee").count(), 0);
  passed("marquee freezes wheel navigation and cancellation restores the previous selection");

  const port = prompt.getByRole("button", { name: "图片创作 连接输出", exact: true });
  p = await center(port); before = await viewport();
  await moveMouse(p); await page.mouse.down({ button: "middle" }); await page.mouse.move(p.x + 55, p.y + 35, { steps: 6 }); await page.mouse.up({ button: "middle" });
  after = await viewport();
  near(after.x, before.x + 55, "middle pan over port");
  assert.equal(await page.locator(".wire-preview").count(), 0);
  assert.deepEqual(await geometry(prompt), original);
  passed("middle-button navigation takes priority over connection ports");

  p = await center(prompt);
  await moveMouse(p); await page.mouse.down(); await page.mouse.move(-20, -20, { steps: 6 }); await page.mouse.up();
  assert.equal(await page.locator(".canvas-board.gesturing").count(), 0);
  await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual(await geometry(prompt), original);
  passed("releasing a drag outside the canvas ends capture and remains undoable");

  await fitCanvas();
  await button("添加节点").click();
  await page.getByRole("button", { name: "文本 记录灵感、脚本与创作说明 T", exact: true }).click();
  await page.getByLabel("编辑节点内容", { exact: true }).fill("双击文本仍然可编辑");
  await button("完成").click();
  const note = page.locator(".node.note").first();
  await note.dblclick(); await page.getByLabel("编辑节点内容", { exact: true }).waitFor();
  before = await viewport();
  await moveMouse(await center(page.getByLabel("编辑节点内容", { exact: true }))); await page.mouse.wheel(0, 60);
  assert.deepEqual(await viewport(), before, "native text scrolling must not navigate the board");
  await button("完成").click();
  await fitCanvas();
  await prompt.click(); await closeCreator();
  p = await center(port); const target = await center(note);
  await moveMouse(p); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.locator(".edge").count(), 1);
  assert.equal(await page.locator(".wire-preview").count(), 0);
  passed("text double-click and drag-to-connect remain available after pointer capture changes");

  // Connecting now selects the receiving node. Establish the source selection
  // explicitly before testing additive selection, independent of that policy.
  await prompt.click(); await closeCreator();
  await note.click({ modifiers: ["Shift"] });
  assert.equal(await page.locator(".node.selected").count(), 2);
  const groupBefore = [await geometry(prompt), await geometry(note)];
  p = await center(prompt);
  await moveMouse(p); await page.mouse.down(); await page.mouse.move(p.x + 45, p.y + 20, { steps: 5 }); await page.mouse.up();
  const groupAfter = [await geometry(prompt), await geometry(note)];
  near(groupAfter[0].x - groupBefore[0].x, groupAfter[1].x - groupBefore[1].x, "group x displacement");
  near(groupAfter[0].y - groupBefore[0].y, groupAfter[1].y - groupBefore[1].y, "group y displacement");
  await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual([await geometry(prompt), await geometry(note)], groupBefore);
  await note.click();
  assert.equal(await page.locator(".node.selected").count(), 1);
  passed("Shift selects a group, dragging preserves relative positions, and a plain click returns to single selection");

  await prompt.click(); await closeCreator();
  await prompt.evaluate(el => el.addEventListener("pointerdown", event => { el.dataset.testPointer = String(event.pointerId); }, { once: true }));
  p = await center(prompt);
  const beforeCapture = await geometry(prompt);
  await moveMouse(p); await page.mouse.down(); await page.mouse.move(p.x + 35, p.y + 15, { steps: 5 });
  await prompt.evaluate(el => el.releasePointerCapture(Number(el.dataset.testPointer)));
  // The next pointer event makes the browser deliver lostpointercapture.
  await page.mouse.move(p.x + 36, p.y + 16);
  await page.locator(".canvas-board.gesturing").waitFor({ state: "hidden" });
  await page.mouse.up();
  assert.deepEqual(await geometry(prompt), beforeCapture);
  passed("lost pointer capture cancels provisional movement without leaving a stuck gesture");

  await page.setViewportSize({ width: 390, height: 844 });
  await fitCanvas();
  await prompt.click(); await closeCreator();
  const cdp = await context.newCDPSession(page);
  await page.evaluate(() => {
    window.__gestureEvents = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"])
      document.addEventListener(type, event => window.__gestureEvents.push({ type, id: event.pointerId, x: event.clientX, y: event.clientY }), true);
  });
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
  p = await center(prompt);
  const touchOriginal = await geometry(prompt);
  const first = [1, p.x, p.y];
  await touch("touchStart", [first]);
  await touch("touchMove", [[1, p.x + 25, p.y]]);
  assert.notDeepEqual(await geometry(prompt), touchOriginal);
  const second = [2, Math.min(360, p.x + 85), p.y + 70];
  await touch("touchStart", [[1, p.x + 25, p.y], second]);
  assert.deepEqual(await geometry(prompt), touchOriginal, "second finger rolls back the provisional node drag");
  before = await viewport();
  const moved = [[1, p.x - 10, p.y - 15], [2, second[1] + 15, second[2] + 20]];
  await touch("touchMove", moved);
  after = await eventually(viewport, value => value.zoom !== before.zoom, "pinch changes zoom");
  assert.deepEqual(await geometry(prompt), touchOriginal);
  // CDP's non-empty touchEnd list identifies the finger being lifted.
  await touch("touchEnd", [moved[0]]);
  before = await viewport();
  await touch("touchMove", [[2, moved[1][1] - 15, moved[1][2] + 12]]);
  after = await eventually(viewport, value => value.x !== before.x, "remaining finger pans"); near(after.x, before.x - 15, "remaining finger pans without a jump"); near(after.y, before.y + 12, "remaining finger y");
  await touch("touchEnd", []);
  await page.locator(".canvas-board.gesturing").waitFor({ state: "hidden" });
  assert.equal(await creator().count(), 0);
  passed("two-finger pinch takes over from node drag; lifting a finger continues smooth panning without ghost clicks");

  await fitCanvas();
  p = await center(prompt);
  await touch("touchStart", [[3, p.x, p.y]]);
  await touch("touchMove", [[3, p.x + 25, p.y + 10]]);
  await touch("touchCancel", []);
  await page.locator(".canvas-board.gesturing").waitFor({ state: "hidden" });
  assert.deepEqual(await geometry(prompt), touchOriginal);
  assert.equal(await page.locator(".canvas-board.gesturing").count(), 0);
  before = await viewport();
  await touch("touchStart", [[4, 30, 690]]);
  await touch("touchMove", [[4, 55, 720]]);
  after = await eventually(viewport, value => value.x !== before.x, "single-finger background pan");
  near(after.x, before.x + 25, "touch pan x"); near(after.y, before.y + 30, "touch pan y");
  await touch("touchEnd", []);
  await page.locator(".canvas-board.gesturing").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".node.selected").count(), 1, "background panning preserves selection");
  await touch("touchStart", [[5, 45, 690]]); await touch("touchEnd", []);
  await page.locator(".node.selected").waitFor({ state: "hidden" });
  passed("single-finger background drag pans without deselection, while tapping blank space clears selection");
  await prompt.click(); await creator().waitFor();
  assert.equal(await page.getByLabel("创作画面描述", { exact: true }).inputValue(), "手势回归中保留的描述");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${artifacts}/gestures-mobile.png` });
  passed("touch cancellation restores node geometry and allows editing to resume on mobile");
  assert.deepEqual(errors, []);
  await writeFile(`${artifacts}/gestures-result.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  if (page) {
    console.error(await page.evaluate(() => window.__gestureEvents || []));
    await page.screenshot({ path: `${artifacts}/gestures-failure.png` }).catch(() => {});
    console.error((await page.locator("body").innerText()).slice(0, 4000));
  }
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
}
