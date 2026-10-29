/** Real browser camera timing, takeover and overlay checks on a disposable fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createImageNode } from "./canvas-ui.mjs";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5237", "--api-port=5238"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, page;
const errors = [], checks = [], traces = {};
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(output || "Fixture timeout")), 20000);
  fixture.stdout.on("data", data => { output += data; if (output.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); } });
  fixture.stderr.on("data", data => { output += data; });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => { clearTimeout(timeout); if (code) reject(new Error(output)); });
});
const button = name => page.getByRole("button", { name, exact: true });
const creator = () => page.getByRole("complementary", { name: "图片创作", exact: true });
const near = (actual, expected, message, tolerance = 0.15) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);
const equalView = (actual, expected, message) => { for (const key of ["x", "y", "zoom"]) near(actual[key], expected[key], `${message} ${key}`, key === "zoom" ? 0.00002 : 0.15); };
const viewport = () => page.locator(".world").evaluate(el => { const m = new DOMMatrixReadOnly(getComputedStyle(el).transform); return { x: m.e, y: m.f, zoom: m.a }; });
const passed = message => { checks.push(message); console.log(`PASS ${message}`); };

// Samples the browser's painted transforms after React's frame updates. DOM
// wheel events let a burst be delivered in the same task, independent of CDP
// round trips, while exercising the application's real event listeners.
const sample = options => page.evaluate(async options => {
  const board = document.querySelector(".canvas-board"), rect = board.getBoundingClientRect();
  const read = () => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".world")).transform);
    const node = document.querySelector(".node.selected"), editor = document.querySelector('[aria-label="图片创作"]');
    const n = node?.getBoundingClientRect(), e = editor?.getBoundingClientRect();
    return { x: m.e, y: m.f, zoom: m.a, ...(n && e ? { editor: { gap: e.top - n.bottom, centerOffset: e.left + e.width / 2 - n.left - n.width / 2, width: e.width, visible: getComputedStyle(editor).visibility !== "hidden" } } : {}) };
  };
  const before = read(), started = performance.now(), frames = [], events = [];
  let alive = true;
  const frame = () => {
    // rAF schedules React's camera update. Read after that commit rather than
    // reading an update one frame before the browser has painted it.
    setTimeout(() => { if (alive) frames.push({ time: performance.now() - started, ...read() }); }, 0);
    if (alive) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const dispatchWheel = event => {
    events.push({ time: performance.now() - started, ...event });
    board.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: rect.left + (options.anchor?.x ?? 220), clientY: rect.top + (options.anchor?.y ?? 650), deltaMode: 0, ...event }));
  };
  if (options.kind === "fit") {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "0", code: "Digit0", ctrlKey: true, bubbles: true, cancelable: true }));
  } else {
    for (const event of options.wheels || []) {
      const { at = 0, ...wheel } = event;
      if (at) setTimeout(() => dispatchWheel(wheel), at);
      else dispatchWheel(wheel);
    }
  }
  await new Promise(resolve => setTimeout(resolve, options.duration || 190));
  alive = false;
  return { before, after: read(), events, frames };
}, options);

try {
  await ready;
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "no-preference" });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto("http://127.0.0.1:5237/");
  const closeLibrary = button("收起画布列表").first();
  if (await closeLibrary.isVisible()) await closeLibrary.click();
  await createImageNode(page);
  await creator().waitFor();
  const id = await page.locator(".node.selected").getAttribute("data-node-id");
  const node = page.locator(`[data-node-id="${id}"]`);
  await button("关闭图片创作").click();
  await creator().waitFor({ state: "hidden" });
  await page.waitForTimeout(260);

  const wheel = traces.wheel = await sample({ wheels: [{ deltaX: 120, deltaY: 84 }] });
  const wheelTarget = { x: wheel.before.x - 120, y: wheel.before.y - 84, zoom: wheel.before.zoom };
  equalView(wheel.after, wheelTarget, "wheel endpoint");
  const changedWheelFrames = wheel.frames.filter(frame => Math.abs(frame.x - wheel.before.x) > 0.5 || Math.abs(frame.y - wheel.before.y) > 0.5);
  assert.ok(changedWheelFrames.length, "wheel must paint at least one changed frame");
  for (const frame of changedWheelFrames) equalView(frame, wheelTarget, "wheel has no synthetic tail after the first changed frame");
  passed("wheel reaches the exact destination on the next paint without an extra animation tail");

  const burst = traces.burst = await sample({ wheels: [{ deltaX: 80, deltaY: 60 }, { deltaX: 40, deltaY: 30 }, { deltaX: -25, deltaY: -15 }, { at: 24, deltaX: -35, deltaY: -20 }, { at: 45, deltaX: 15, deltaY: 10 }], duration: 230 });
  equalView(burst.after, { x: burst.before.x - 75, y: burst.before.y - 65, zoom: burst.before.zoom }, "accumulated wheel burst");
  assert.ok(burst.frames.every(frame => Number.isFinite(frame.x) && Number.isFinite(frame.y)), "reversal must never produce invalid geometry");
  passed("same-frame and continuous wheel bursts accumulate every delta, including direction reversal");

  const anchor = { x: 500, y: 360 };
  const zoom = traces.zoom = await sample({ anchor, wheels: [{ deltaX: 0, deltaY: -24, ctrlKey: true }] });
  assert.ok(zoom.after.zoom > zoom.before.zoom);
  const changedZoomFrames = zoom.frames.filter(frame => Math.abs(frame.zoom - zoom.before.zoom) > 0.0001);
  assert.ok(changedZoomFrames.length, "zoom should paint at least one changed frame");
  for (const frame of changedZoomFrames) {
    equalView(frame, zoom.after, "wheel zoom has no synthetic tail after the first changed frame");
    near((anchor.x - frame.x) / frame.zoom, (anchor.x - zoom.before.x) / zoom.before.zoom, "zoom keeps pointer world x", 0.01);
    near((anchor.y - frame.y) / frame.zoom, (anchor.y - zoom.before.y) / zoom.before.zoom, "zoom keeps pointer world y", 0.01);
  }
  passed("wheel zoom preserves the pointer anchor without an extra animation tail");

  await page.mouse.move(130, 700);
  await page.evaluate(() => {
    window.addEventListener("pointerdown", () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".world")).transform);
      window.__motionTakeover = { x: m.e, y: m.f, zoom: m.a };
    }, { capture: true, once: true });
    document.querySelector(".canvas-board").dispatchEvent(new WheelEvent("wheel", { deltaX: 500, deltaY: 120, clientX: 130, clientY: 700, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(25);
  await page.mouse.down({ button: "middle" });
  const takeover = await page.evaluate(() => window.__motionTakeover);
  await page.waitForTimeout(130);
  equalView(await viewport(), takeover, "pointerdown freezes the displayed position");
  await page.mouse.move(175, 730, { steps: 5 });
  await page.waitForTimeout(25);
  equalView(await viewport(), { x: takeover.x + 45, y: takeover.y + 30, zoom: takeover.zoom }, "direct drag is 1:1");
  await page.mouse.up({ button: "middle" });
  const released = await viewport();
  await page.waitForTimeout(150);
  equalView(await viewport(), released, "release has no fabricated inertia");
  passed("pointerdown interrupts wheel without jumping; direct drag stays 1:1 and stops on release");

  const fitTarget = await node.evaluate(el => {
    const board = document.querySelector(".canvas-board").getBoundingClientRect();
    const x = parseFloat(el.style.left), y = parseFloat(el.style.top), w = parseFloat(el.style.width), h = parseFloat(el.style.height);
    const zoom = Math.min(1, (board.width - 220) / w, (board.height - 220) / h);
    return { x: board.width / 2 - (x + w / 2) * zoom, y: board.height / 2 - (y + h / 2) * zoom, zoom };
  });
  const fit = traces.fit = await sample({ kind: "fit", duration: 310 });
  assert.ok(fit.frames.some(frame => frame.time > 100 && frame.time < 210 && Math.abs(frame.x - fit.before.x) > 1 && Math.abs(frame.x - fitTarget.x) > 0.1), "fit must retain an intermediate transition after 100 ms");
  equalView(fit.after, fitTarget, "fit endpoint");
  equalView(fit.frames.find(frame => frame.time >= 245), fitTarget, "fit settles after 220 ms");
  passed("fit-to-canvas smoothly transitions for 220 ms and reaches the exact fit geometry");

  await node.click();
  await creator().waitFor();
  await page.waitForTimeout(260);
  const editor = traces.editor = await sample({ wheels: [{ deltaX: -45, deltaY: -35 }] });
  assert.ok(editor.before.editor, "selected creator has its attached editor");
  for (const frame of editor.frames) {
    assert.ok(frame.editor?.visible, "camera navigation must not hide the editor");
    near(frame.editor.gap, editor.before.editor.gap, "editor tracks node bottom throughout camera movement", 0.5);
    near(frame.editor.centerOffset, editor.before.editor.centerOffset, "editor tracks node center throughout camera movement", 0.5);
    near(frame.editor.width, editor.before.editor.width, "camera movement keeps editor width fixed", 0.5);
  }
  passed("the selected node's editor follows every camera frame with stable width and node-relative placement");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = traces.reduced = await sample({ wheels: [{ deltaX: 110, deltaY: 75 }], duration: 110 });
  const reducedTarget = { x: reduced.before.x - 110, y: reduced.before.y - 75, zoom: reduced.before.zoom };
  const changed = reduced.frames.filter(frame => Math.abs(frame.x - reduced.before.x) > 0.2);
  assert.ok(changed.length, "reduced-motion wheel still navigates");
  for (const frame of changed) equalView(frame, reducedTarget, "reduced motion has no interpolated position");
  equalView(reduced.after, reducedTarget, "reduced-motion endpoint");
  passed("reduced-motion navigation commits its endpoint in one frame without interpolation");

  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${artifacts}/viewport-motion.png` });
  await writeFile(`${artifacts}/viewport-motion-result.json`, JSON.stringify({ checks, errors, traces }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: `${artifacts}/viewport-motion-failure.png` }).catch(() => {});
  await writeFile(`${artifacts}/viewport-motion-result.json`, JSON.stringify({ checks, errors, traces, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
}
