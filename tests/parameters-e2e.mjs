/** Parameter popover regression; uses disposable platform fixtures only. */
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
const referencePath = fileURLToPath(
  new URL("./fixtures/aspect-ratio.png", import.meta.url),
);
const base = "http://127.0.0.1:5197";
const api = "http://127.0.0.1:5198";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(
  process.execPath,
  ["tests/platform-fixture.mjs", "--port=5197", "--api-port=5198"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Creator fixture did not become ready")),
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
      reject(new Error(`Creator fixture exited ${code}: ${fixtureOutput}`));
  });
});
let browser;
let page;
const errors = [];
const checks = [];
const button = (name) => page.getByRole("button", { name, exact: true });
const creator = () => page.getByRole("complementary", { name: "图片创作" });
const passed = (description) => {
  checks.push(description);
  console.log(`PASS ${description}`);
};

const catalog = [{
  id: "fixture-sync", name: "参数回归模型", available: true,
  supported_operations: ["generation", "edit"], max_input_images: 4,
  quality_modes: ["auto", "low", "medium", "high", "ultra", "extreme"],
  parameter_options: { image_qualities: [
    { value: "low", label: "低画质" }, { value: "medium", label: "标准画质" },
    { value: "high", label: "高画质" }, { value: "ultra", label: "超高画质" }, { value: "extreme", label: "极致画质" },
  ] },
  resolution_tiers: ["1k", "2k", "4k"],
  supported_aspect_ratios: ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"],
  max_output_count: 4,
  default_parameters: { quality_mode: "medium", resolution_tier: "2k", aspect_ratio: "16:9", n: 1 },
}];
catalog.push({ ...catalog[0], id: "novel", name: "后端新增参数", quality_modes: ["studio-v3"], resolution_tiers: ["3k"], supported_aspect_ratios: ["7:5"], max_output_count: 8, default_parameters: { quality_mode: "studio-v3", resolution_tier: "3k", aspect_ratio: "7:5", n: 8 } });
catalog.push({ id: "empty", name: "无可选参数", supported_operations: ["generation", "edit"], max_input_images: 4, quality_modes: [], resolution_tiers: [], supported_aspect_ratios: [], supported_sizes: [], max_output_count: 1, platform_capabilities: { quality_modes: ["legacy"], supported_sizes: ["999x999"] } });
const layouts = [];
try {
  await ready;
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/v1/images/models", route => route.fulfill({ json: { data: catalog } }));
  await page.goto(base);
  await page.getByLabel("无限创作画布").waitFor();
  const collapse = button("收起画布列表").first();
  if (await collapse.isVisible()) await collapse.click();
  await createImageNode(page);
  const trigger = page.locator(".context-settings-toggle");
  const dialog = page.getByRole("dialog", { name: "图片参数", exact: true });
  const model = page.getByLabel("创作图片模型", { exact: true });
  const draft = page.getByLabel("创作画面描述", { exact: true });
  await draft.fill("保留参考图构图，将背景改为日落。");
  await model.selectOption("fixture-sync");
  const upload = page.waitForEvent("filechooser");
  await button("添加参考图片").click();
  await (await upload).setFiles(referencePath);
  await creator().getByRole("img", { name: "aspect-ratio.png", exact: true }).waitFor();
  await trigger.click();
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("combobox", { name: "生成数量", exact: true }).inputValue(), "1");
  const qualityGroup = dialog.getByRole("radiogroup", { name: "画质", exact: true });
  assert.equal(await qualityGroup.getByRole("radio").count(), 5);
  assert.equal(await qualityGroup.getByRole("radio", { name: "auto", exact: true }).count(), 0);
  assert.deepEqual(await qualityGroup.getByRole("radio").allTextContents(), ["高画质", "标准画质", "低画质", "超高画质", "极致画质"]);
  for (const name of ["高画质", "2K", "16:9"]) assert.equal(await dialog.getByRole("radio", { name, exact: true }).getAttribute("aria-checked"), "true");
  assert.equal(await page.locator(".context-generation-mode").count(), 0);
  passed("backend defaults, labels and choice groups match the reference interaction");
  async function checkLayout(name) {
    await dialog.waitFor();
    await page.waitForFunction(() => { const el = document.querySelector('.context-settings-popover'); return el && getComputedStyle(el).visibility === 'visible'; });
    const result = await dialog.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bodyPortal: el.parentElement === document.body,
        horizontal: el.scrollWidth > el.clientWidth + 1, vertical: el.scrollHeight > el.clientHeight + 1,
        controls: [...el.querySelectorAll('[role="radio"], select')].map(button => {
          const r = button.getBoundingClientRect();
          return { label: button.textContent, visible: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
            hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        }) };
    });
    const viewport = page.viewportSize();
    assert.ok(result.bodyPortal && !result.horizontal && !result.vertical, JSON.stringify(result));
    assert.ok(result.x >= 9 && result.y >= 9 && result.x + result.width <= viewport.width - 9 && result.y + result.height <= viewport.height - 9, JSON.stringify(result));
    assert.ok(result.controls.every(item => item.visible && item.hit), JSON.stringify(result));
    await page.screenshot({ path: `${artifacts}/parameters-${name}.png` });
    layouts.push({ name, ...result });
  }
  await checkLayout("desktop");
  const anchor = await trigger.boundingBox(), popup = await dialog.boundingBox();
  assert.ok(Math.abs(popup.x - anchor.x) <= 1 && Math.abs(popup.y + popup.height + 8 - anchor.y) <= 1);
  passed("all controls are visible and clickable, anchored directly above the parameter summary");
  await dialog.getByRole("radio", { name: "高画质", exact: true }).click();
  await dialog.getByRole("combobox", { name: "生成数量", exact: true }).selectOption("3");
  assert.equal(await dialog.isVisible(), true);
  assert.match(await trigger.textContent(), /高画质.*2K.*3 张/);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await creator().isVisible(), true);
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  await trigger.click();
  assert.equal(await dialog.getByRole("radio", { name: "高画质", exact: true }).evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await dialog.getByRole("radio", { name: "标准画质", exact: true }).getAttribute("aria-checked"), "true");
  await page.keyboard.press("Escape");
  await trigger.click();
  await trigger.click();
  await dialog.waitFor({ state: "hidden" });
  await trigger.click();
  // Click the exposed left side of the description; its centre is under the card as in Liblib.
  await draft.click({ position: { x: 5, y: 10 } });
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await draft.inputValue(), "保留参考图构图，将背景改为日落。");
  passed("selection, Escape, toggle, outside-click and arrow keys preserve the editor and draft");
  await model.selectOption("novel");
  await trigger.click();
  assert.equal(await dialog.getByRole("radio", { name: "studio-v3", exact: true }).count(), 1);
  assert.equal(await dialog.getByRole("radio", { name: "7:5", exact: true }).count(), 1);
  assert.equal(await dialog.getByRole("combobox", { name: "生成数量", exact: true }).getByRole("option").count(), 8);
  await page.keyboard.press("Escape");
  await model.selectOption("empty");
  await trigger.waitFor({ state: "hidden" });
  await model.selectOption("fixture-sync");
  passed("new backend choices appear automatically and retired choices stay absent");
  for (const [width, height] of [[1024, 768], [390, 844], [844, 390], [375, 667]]) {
    await page.setViewportSize({ width, height });
    await trigger.click();
    await checkLayout(`${width}x${height}`);
    await page.keyboard.press("Escape");
  }
  passed("desktop, portrait and short landscape have no clipping or internal scrollbars");
  await page.setViewportSize({ width: 1440, height: 960 });
  await trigger.click();
  await dialog.getByRole("radio", { name: "高画质", exact: true }).click();
  await dialog.getByRole("combobox", { name: "生成数量", exact: true }).selectOption("3");
  await page.keyboard.press("Escape");
  let submission;
  await page.route("**/v1/images/edits", async route => {
    const request = route.request();
    const form = await new Request("http://localhost", { method: "POST", headers: { "Content-Type": request.headers()["content-type"] }, body: request.postDataBuffer() }).formData();
    submission = { quality: form.get("quality_mode"), resolution: form.get("resolution_tier"), ratio: form.get("aspect_ratio"), count: form.get("n"), size: form.get("size") };
    await route.fulfill({ json: { data: [{ url: `${base}/v1/fixture-image.png` }] } });
  });
  await button("生成图片").click();
  await creator().getByRole("button", { name: "生成记录", exact: true }).waitFor();
  assert.equal(await button("生成图片").isEnabled(), true);
  assert.deepEqual(submission, { quality: "high", resolution: "2k", ratio: "16:9", count: "3", size: null });
  passed("selected backend values reach multipart generation without a conflicting size");
  assert.deepEqual(errors, []);
  await writeFile(`${artifacts}/parameters-result.json`, JSON.stringify({ checks, errors, layouts }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: `${artifacts}/parameters-failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
}
