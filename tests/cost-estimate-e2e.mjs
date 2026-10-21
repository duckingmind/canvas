/** Cost estimate UI regression using only the disposable Canvas platform fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const referencePath = fileURLToPath(new URL("./fixtures/aspect-ratio.png", import.meta.url));
const base = "http://127.0.0.1:5261";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5261", "--api-port=5262"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Cost fixture timeout: ${fixtureOutput}`)), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += String(chunk);
    if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timer); resolve(); }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += String(chunk); });
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { clearTimeout(timer); if (code) reject(new Error(`Cost fixture exited ${code}: ${fixtureOutput}`)); });
});
const catalog = [
  { id: "fixture-sync", name: "测试图片模型" },
  { id: "fixture-slow", name: "测试慢报价模型" },
  { id: "fixture-retry", name: "测试未知价格模型" },
].map(model => ({
  ...model, available: true, supported_operations: ["generation", "edit"], max_input_images: 4,
  quality_modes: ["standard", "high"], resolution_tiers: ["1k", "2k"], supported_aspect_ratios: ["1:1", "16:9"],
  max_output_count: 4, default_parameters: { quality_mode: "standard", resolution_tier: "1k", aspect_ratio: "1:1", n: 1 },
}));
const requests = [], held = [], errors = [], aborted = [];
let browser, page, responseMode = "known", holdSlow = false, emptyCatalog = false;
const eventually = async (check, message) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${message}`);
};
const button = name => page.getByRole("button", { name, exact: true });
const createNode = async kind => {
  await button("添加节点").click();
  await page.getByRole("button", { name: kind === "video" ? "视频生成 用文字或参考图生成视频" : "图片生成 用文字或参考图生成图片", exact: true }).click();
};
const quote = () => page.locator(".context-cost-estimate");
const quoteText = async text => eventually(async () => await quote().textContent() === text, `estimate ${text}`);
const passed = text => console.log(`PASS ${text}`);
try {
  await ready;
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => {
    if (new URL(request.url()).pathname === "/v1/estimates") aborted.push(request.failure()?.errorText);
  });
  await page.route("**/v1/images/models", route => route.fulfill({ json: { data: emptyCatalog ? [] : catalog } }));
  await page.route("**/v1/estimates", async route => {
    const body = route.request().postDataJSON();
    assert.equal(route.request().method(), "POST");
    requests.push(body);
    let response = { estimated: true, known: true, amount: (body.parameters.n || 1) * 0.012, currency: "USD", may_change: true, pricing_source: "route_estimate" };
    if (holdSlow && body.model === "fixture-slow") response = await new Promise(resolve => held.push(resolve));
    else if (body.model === "fixture-retry" || responseMode === "unknown") response = { ...response, known: false, amount: null };
    else if (responseMode === "tiny") response.amount = 0.00001;
    else if (body.model_type === "video") { response.amount = body.parameters.duration * 0.08; response.currency = "CNY"; }
    await route.fulfill({ status: responseMode === "error" ? 503 : 200, json: response }).catch(() => {});
  });
  await page.goto(base);
  const collapse = button("收起画布列表").first();
  if (await collapse.isVisible()) await collapse.click();
  await createNode("image");
  await quoteText("预估 US$0.012");
  assert.equal(requests.length, 1);
  assert.equal(await page.getByLabel("创作画面描述", { exact: true }).inputValue(), "");
  assert.deepEqual(requests[0], { model: "fixture-sync", model_type: "image", operation: "generation", parameters: {
    n: 1, quality_mode: "standard", resolution_tier: "1k", aspect_ratio: "1:1", input_image_count: 0,
  } });
  assert.match(await quote().getAttribute("title"), /最终以实际费用为准/);
  await page.getByLabel("创作画面描述", { exact: true }).fill("生成一张安静的风景图。");
  await button("展开画面描述").click();
  await button("收起画面描述").click();
  await page.waitForTimeout(700);
  assert.equal(requests.length, 1, "prompt edits and unrelated rerenders must not repeatedly estimate");
  passed("initial pricing needs no prompt; typing/rerenders do not repeat requests");

  await page.locator(".context-settings-toggle").click();
  const parameters = page.getByRole("dialog", { name: "图片参数", exact: true });
  await parameters.getByRole("radio", { name: "high", exact: true }).click();
  await parameters.getByRole("combobox", { name: "生成数量", exact: true }).evaluate(select => {
    for (const value of ["2", "3", "4"]) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await quoteText("预估 US$0.048");
  assert.equal(requests.length, 2, "rapid pricing changes should produce one debounced request");
  assert.equal(requests.at(-1).parameters.quality_mode, "high");
  assert.equal(requests.at(-1).parameters.n, 4);
  await page.keyboard.press("Escape");
  await button("添加参考图片").click();
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "从本地上传", exact: true }).click();
  await (await fileChooser).setFiles(referencePath);
  await eventually(() => requests.at(-1)?.parameters.input_image_count === 1, "image reference repricing");
  assert.equal(requests.at(-1).operation, "edit");
  assert.ok(!JSON.stringify(requests.at(-1)).includes("http"), "estimate must not upload reference media");
  await quoteText("预估 US$0.048");
  passed("quantity, quality and uploaded reference count reprice the exact image request");

  const model = page.getByLabel("创作图片模型", { exact: true });
  holdSlow = true;
  await model.selectOption("fixture-slow");
  await eventually(() => held.length === 1, "slow estimate started");
  await quoteText("估算中…");
  await model.selectOption("fixture-sync");
  await quoteText("预估 US$0.048");
  held.shift()({ estimated: true, known: true, amount: 9.99, currency: "USD" });
  await page.waitForTimeout(400);
  await quoteText("预估 US$0.048");
  await eventually(() => aborted.length >= 1, "obsolete estimate request aborted");
  passed("changing model aborts the old request and ignores its late quote");

  await model.selectOption("fixture-retry");
  await quoteText("暂无法估价");
  assert.equal(await button("生成图片").isEnabled(), true);
  responseMode = "error";
  await model.selectOption("fixture-sync");
  await quoteText("暂无法估价");
  assert.equal(await button("生成图片").isEnabled(), true);
  responseMode = "tiny";
  await model.selectOption("fixture-retry");
  await quoteText("暂无法估价");
  await model.selectOption("fixture-sync");
  await quoteText("预估 US$0.00001");
  passed("unavailable/error estimates never block generation or show zero; tiny prices stay visible");

  for (const [width, height] of [[1440, 1100], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.locator(".context-creator-footer").evaluate(footer => {
      const rect = footer.getBoundingClientRect();
      const cost = footer.querySelector(".context-cost-estimate").getBoundingClientRect();
      const submit = footer.querySelector(".context-generate").getBoundingClientRect();
      return { overflow: footer.scrollWidth > footer.clientWidth + 1, costInFooter: cost.x >= rect.x && cost.right <= submit.x, submitInFooter: submit.right <= rect.right, size: submit.width };
    });
    assert.deepEqual(layout, { overflow: false, costInFooter: true, submitInFooter: true, size: 32 });
    await page.locator(".context-creator").screenshot({ path: `${artifacts}/cost-estimate-${width}.png` });
  }
  passed("cost sits beside the submit button without footer overflow on desktop or mobile");
  await page.setViewportSize({ width: 1440, height: 1100 });

  await model.selectOption("fixture-slow");
  await eventually(() => held.length === 1, "pending quote before closing editor");
  await button("关闭图片创作").click();
  await quote().waitFor({ state: "hidden" });
  responseMode = "known";
  await createNode("image");
  await quoteText("预估 US$0.012");
  held.shift()({ estimated: true, known: true, amount: 8.88, currency: "USD" });
  await page.waitForTimeout(400);
  await quoteText("预估 US$0.012");
  passed("a closed editor's pending response cannot populate another node");

  await button("关闭图片创作").click();
  await createNode("video");
  await quoteText("预估 ¥0.48");
  assert.equal(requests.at(-1).operation, "generation");
  assert.deepEqual(requests.at(-1).parameters, { generate_audio: true, duration: 6, resolution: "1080p", aspect_ratio: "9:16", input_image_count: 0 });
  await page.locator(".context-settings-toggle").click();
  await page.getByRole("combobox", { name: "视频时长", exact: true }).selectOption("8");
  await quoteText("预估 ¥0.64");
  await page.keyboard.press("Escape");
  await button("添加视频参考图片").click();
  const videoFile = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "从本地上传", exact: true }).click();
  await (await videoFile).setFiles(referencePath);
  await eventually(() => requests.at(-1)?.model_type === "video" && requests.at(-1)?.parameters.input_image_count === 1, "video reference repricing");
  assert.equal(requests.at(-1).operation, "generation");
  await quoteText("预估 ¥0.64");
  await page.locator(".context-creator").screenshot({ path: `${artifacts}/cost-estimate-video.png` });
  passed("video duration and references reprice while respecting the returned currency");

  emptyCatalog = true;
  await page.reload();
  await createNode("image");
  await page.getByRole("complementary", { name: "图片创作", exact: true }).waitFor();
  const countWithNoModel = requests.length;
  await page.waitForTimeout(700);
  assert.equal(await quote().count(), 0);
  assert.equal(requests.length, countWithNoModel);
  passed("no compatible model clears pricing and sends no estimate request");
  assert.deepEqual(errors, []);
} catch (error) {
  if (page) await page.screenshot({ path: `${artifacts}/cost-estimate-failure.png` }).catch(() => {});
  throw error;
} finally {
  for (const resolve of held) resolve({ known: false, amount: null, currency: "USD" });
  await browser?.close();
  fixture.kill("SIGTERM");
}
