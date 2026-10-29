/** Portrait image-node regression for the canvas surface and persisted frame. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const port = 5297;
const apiPort = 5298;
const base = `http://127.0.0.1:${port}`;
await mkdir(artifacts, { recursive: true });

const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", `--port=${port}`, `--api-port=${apiPort}`], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`image node fixture timeout: ${fixtureOutput}`)), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) {
      clearTimeout(timer);
      resolve();
    }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += chunk.toString(); });
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => {
    if (code) reject(new Error(`image node fixture exited ${code}: ${fixtureOutput}`));
  });
});

const control = async body => {
  const response = await fetch(`http://127.0.0.1:${apiPort}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
};
const eventually = async (check, description, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
};

let browser;
try {
  await ready;
  await control({ reset: true, imageVariant: "portrait" });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/v1/fixture-image.*", async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.goto(base);
  const closeLibrary = page.getByRole("button", { name: "收起画布列表", exact: true }).first();
  if (await closeLibrary.isVisible()) await closeLibrary.click();

  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加节点", exact: true });
  await picker.getByRole("button", { name: /图片生成/ }).click();
  const creator = page.getByRole("complementary", { name: "图片创作", exact: true });
  await creator.waitFor();
  await page.getByLabel("创作画面描述", { exact: true }).fill("竖图节点展示回归");
  await page.getByLabel("创作图片模型", { exact: true }).selectOption("fixture-sync");
  await page.getByRole("button", { name: "生成图片", exact: true }).click();

  const node = page.locator(".node.image").first();
  await node.waitFor();
  const image = node.locator("img.node-image");
  await image.waitFor();
  const loadingPlaceholder = node.locator(".node-image-load-placeholder");
  await loadingPlaceholder.waitFor({ state: "visible" });
  assert.match(await loadingPlaceholder.innerText(), /正在加载图片/);
  await eventually(() => image.evaluate(element => element.complete && element.naturalWidth > 0), "portrait image decode");
  await eventually(() => loadingPlaceholder.evaluate(element => getComputedStyle(element).visibility === "hidden"), "loading placeholder clears after image decode");
  await eventually(async () => {
    const bounds = await node.boundingBox();
    return Boolean(bounds && bounds.height > bounds.width && Math.abs(bounds.width / bounds.height - 0.5) < 0.02);
  }, "portrait node frame follows the source ratio");

  const surface = node.locator(".node-surface");
  const surfaceBounds = await surface.boundingBox();
  assert.ok(surfaceBounds && surfaceBounds.height > surfaceBounds.width, "portrait surface is taller than it is wide");
  const surfaceShot = await surface.screenshot({ path: `${artifacts}/image-node-portrait.png` });
  const samples = await page.evaluate(async data => {
    const preview = new Image();
    preview.src = `data:image/png;base64,${data}`;
    await preview.decode();
    const canvas = document.createElement("canvas");
    canvas.width = preview.naturalWidth;
    canvas.height = preview.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(preview, 0, 0);
    // Sample the plain background near the top, away from the decorative
    // test subject and the hover indicator in the corner.
    const y = Math.min(24, Math.max(2, canvas.height - 2));
    const pixel = x => Array.from(context.getImageData(x, y, 1, 1).data);
    return { left: pixel(2), center: pixel(Math.floor(canvas.width / 2)), right: pixel(canvas.width - 3) };
  }, surfaceShot.toString("base64"));
  const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  assert.ok(distance(samples.left, samples.center) < 30, "portrait image reaches the left content edge");
  assert.ok(distance(samples.right, samples.center) < 30, "portrait image reaches the right content edge");

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出画布", exact: true }).click();
  const exportFile = await downloaded;
  const exportPath = `${artifacts}/image-node-portrait-export.json`;
  await exportFile.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  const nodeId = await node.getAttribute("data-node-id");
  const exportedNode = exported.nodes.find(item => item.id === nodeId);
  assert.ok(exportedNode, "portrait node is present in the saved canvas");
  const [ratioWidth, ratioHeight] = String(exportedNode.imageAspectRatio || "").split(":").map(Number);
  assert.ok(Number.isFinite(ratioWidth) && Number.isFinite(ratioHeight) && Math.abs(ratioWidth / ratioHeight - 0.5) < 0.02, "saved image ratio remains portrait");
  assert.deepEqual(errors, []);
  console.log("PASS portrait image nodes fill their proportional surface and retain the ratio on export");
} finally {
  if (browser) await browser.close();
  fixture.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 100));
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
