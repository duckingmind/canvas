/** Node-attached creator regression. Owns disposable fixture ports 5197/5198. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const alternateReferencePath = fileURLToPath(
  new URL("./fixtures/alternate-reference.png", import.meta.url),
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
let exportSequence = 0;
const errors = [];
const checks = [];
const state = async () => (await fetch(`${api}/__fixture/state`)).json();
const control = async (body) => {
  const response = await fetch(`${api}/__fixture/control`, {
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
};
const button = (name) => name === "添加参考图片"
  ? page.getByRole("button", { name: /^(添加参考图片|添加输入引用)$/ }).first()
  : page.getByRole("button", { name, exact: true });
const creator = () => page.getByRole("complementary", { name: "图片创作" });
const selectedId = async () =>
  page.locator(".node.selected").getAttribute("data-node-id");
const snapshot = async () => {
  const downloaded = page.waitForEvent("download");
  await button("导出画布").click();
  const download = await downloaded;
  const path = `${artifacts}/creator-export-${++exportSequence}.json`;
  await download.saveAs(path);
  return JSON.parse(await readFile(path, "utf8"));
};
const checkVisibleWithinViewport = async (locator, label) => {
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds, `${label} is visible`);
  assert.ok(
    bounds.x >= -1 &&
      bounds.y >= -1 &&
      bounds.x + bounds.width <= viewport.width + 1 &&
      bounds.y + bounds.height <= viewport.height + 1,
    `${label} remains within viewport: ${JSON.stringify(bounds)}`,
  );
};
const passed = (description) => {
  checks.push(description);
  console.log(`PASS ${description}`);
};

try {
  await ready;
  console.log("READY isolated creator fixture 5197/5198");
  await control({ reset: true, slowPolls: 3 });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  const displayedImageRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/fixture-image.png")) displayedImageRequests.push(request.url());
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(base);
  await page.getByLabel("无限创作画布").waitFor();
  const collapse = button("收起画布列表").first();
  if (await collapse.isVisible()) await collapse.click();
  await createImageNode(page);
  await creator().waitFor();
  const promptId = await selectedId();
  assert.ok(promptId);
  const prompt = page.locator(`[data-node-id="${promptId}"]`);
  await creator().getByLabel("创作画面描述").waitFor();
  assert.equal(await prompt.locator("img").count(), 0, "new prompt starts with a result placeholder");
  const draft = page.getByLabel("创作画面描述");
  await draft.fill("参考图保持构图，将背景改为温暖的日落。");
  await page.locator('option[value="fixture-sync"]').waitFor({ state: "attached" });
  await page.getByLabel("创作图片模型").selectOption("fixture-sync");

  const generationRequests = async () => (await state()).requests.filter(
    (request) => request.method === "POST" && /^\/v1\/images\/(generations|edits)$/.test(request.path),
  ).length;
  const beforeKeyboard = await generationRequests();
  await draft.fill("第一行");
  await draft.press("End");
  await draft.press("Enter");
  await draft.press("Shift+Enter");
  assert.equal(await draft.inputValue(), "第一行\n\n", "plain and Shift Enter insert newlines");
  assert.equal(await generationRequests(), beforeKeyboard, "newline keys never generate");
  await draft.fill("");
  await draft.press("Control+Enter");
  assert.equal(await generationRequests(), beforeKeyboard, "keyboard obeys empty-prompt validation");
  await draft.fill("退出后立即删除，撤销保留这段文字。");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "无限创作画布");
  // Do not wait for the editor's 180 ms exit animation before deleting.
  await page.keyboard.press("Backspace");
  await prompt.waitFor({ state: "detached" });
  await page.keyboard.press("Control+z");
  await prompt.waitFor({ state: "visible" });
  await prompt.click();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "无限创作画布", "single-click must not steal focus into the prompt");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "创作画面描述");
  assert.equal(await draft.inputValue(), "退出后立即删除，撤销保留这段文字。");
  await draft.fill("参考图保持构图，将背景改为温暖的日落。");
  passed("prompt newline, empty validation, immediate Escape-delete, undo and explicit edit focus");

  // Exercise real file input from the creator, then inspect the public export.
  const nodesBeforeReferenceUpload = (await snapshot()).nodes.length;
  await button("添加参考图片").click();
  const upload = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "从本地上传", exact: true }).click();
  await (await upload).setFiles(referencePath);
  await creator().getByRole("img", { name: "aspect-ratio.png", exact: true }).waitFor();
  assert.equal(await selectedId(), promptId, "upload keeps the creator selected");
  let document = await snapshot();
  const source = document.nodes.find((node) => node.title === "aspect-ratio.png");
  assert.equal(document.nodes.length, nodesBeforeReferenceUpload, "editor upload does not create a canvas node");
  assert.equal(source, undefined, "editor upload remains embedded in the prompt");
  assert.ok(
    document.nodes.find((node) => node.id === promptId)?.embeddedReferences?.some((reference) => reference.title === "aspect-ratio.png"),
    "uploaded source is stored as a prompt reference",
  );
  assert.equal(
    document.edges.some((edge) => edge.to === promptId && !document.nodes.some((node) => node.id === edge.from)),
    false,
    "upload must not create a dangling canvas edge",
  );
  passed("creator upload connects image into prompt and retains selection");

  // Uploaded sources remain in the creator's reference strip. The old
  // standalone reference-preview dialog no longer exists.
  await creator().getByRole("button", { name: "预览参考 aspect-ratio.png", exact: true }).waitFor();
  assert.equal(await selectedId(), promptId);
  assert.equal(await draft.inputValue(), "参考图保持构图，将背景改为温暖的日落。");
  passed("reference preview closes back into the same creator and draft");

  await draft.fill("Escape 关闭前未失焦的创作描述。");
  await page.keyboard.press("Escape");
  await creator().waitFor({ state: "hidden" });
  await prompt.click();
  await creator().waitFor();
  assert.equal(await draft.inputValue(), "Escape 关闭前未失焦的创作描述。");
  await draft.fill("直接切换节点前未失焦的创作描述。");
  await button("关闭图片创作").click();
  await creator().waitFor({ state: "hidden" });
  await prompt.click();
  await creator().waitFor();
  assert.equal(await draft.inputValue(), "直接切换节点前未失焦的创作描述。");
  await draft.fill("参考图保持构图，将背景改为温暖的日落。");
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从画布选择", exact: true }).waitFor();
  assert.equal(await page.locator(".reference-pick-banner").count(), 0, "opening the menu does not enter canvas picking mode");
  await page.keyboard.press("Escape");
  await button("添加参考图片").focus();
  await page.keyboard.press("Delete");
  assert.equal(await prompt.count(), 1, "creator controls isolate Delete from canvas deletion");
  assert.equal(await selectedId(), promptId);
  passed("Escape and pointer selection commit unblurred creator drafts");

  // The current creator removes embedded references directly from the strip;
  // the former "仅使用文字" toggle is no longer part of this UI.
  await button("移除参考 aspect-ratio.png").click();
  document = await snapshot();
  assert.equal(document.nodes.find((node) => node.id === promptId)?.embeddedReferences?.length || 0, 0);
  assert.equal(document.edges.some((edge) => edge.to === promptId), false);
  await button("添加参考图片").click();
  const uploadAgain = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "从本地上传", exact: true }).click();
  await (await uploadAgain).setFiles(referencePath);
  assert.equal(await selectedId(), promptId);
  await creator().getByRole("img", { name: "aspect-ratio.png", exact: true }).waitFor();
  document = await snapshot();
  assert.equal(
    document.nodes.find((node) => node.id === promptId)?.embeddedReferences?.length,
    1,
  );
  assert.notEqual(
    document.nodes.find((node) => node.id === promptId).ignoreImageRefs,
    true,
    "explicitly adding a reference turns image input back on",
  );
  passed("existing canvas image can be removed and re-added without losing creator");

  await draft.press("Control+Enter");
  await eventually(
    async () => (await page.locator(".node.image").count()) === 1,
    "first generated result",
  );
  // Completion closes the transient inspector; reselect the prompt to reopen
  // its editor before checking the persisted result and task request.
  await prompt.click();
  await creator().waitFor();
  assert.equal(await selectedId(), promptId, "generation keeps its canvas node selected and editor available");
  assert.equal(await button("生成图片").isEnabled(), true, "completion enables a new generation directly");
  assert.ok(await prompt.locator("img").count(), "prompt previews its latest output");
  const firstResultDocument = await snapshot();
  // Single-output generations stay on the prompt node so its task history and
  // editor remain available. The rendered node is still `.node.image`, but
  // its persisted type remains `prompt`.
  const firstOutput = firstResultDocument.nodes.find((node) => node.id === promptId);
  assert.ok(firstOutput?.image);
  const creatorResultImage = prompt.locator("img.node-image").first();
  await creatorResultImage.waitFor();
  await eventually(
    () => creatorResultImage.evaluate((image) => image.complete && image.naturalWidth > 0),
    "creator result image loaded",
  );
  await eventually(async () => {
    const [bounds, dimensions] = await Promise.all([
      prompt.boundingBox(),
      creatorResultImage.evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight })),
    ]);
    return Boolean(bounds && Math.abs(bounds.width / bounds.height - dimensions.width / dimensions.height) < 0.02);
  }, "generated image node frame matches its decoded image ratio");
  const aspectDocument = await snapshot();
  assert.equal(
    aspectDocument.nodes.find((node) => node.id === promptId)?.imageAspectRatio,
    "4:2",
    "decoded image ratio is retained for reopening the canvas",
  );
  const imageRequestsBeforeCopy = displayedImageRequests.length;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await prompt.click({ button: "right" });
  const imageMenu = page.getByRole("menu", { name: "节点操作菜单", exact: true });
  await imageMenu.getByRole("menuitem", { name: "复制图片", exact: true }).click();
  await page.waitForFunction(async () =>
    (await navigator.clipboard.read()).some((item) => item.types.includes("image/png")),
  );
  assert.equal(displayedImageRequests.length, imageRequestsBeforeCopy, "copy reuses the rendered image without requesting it again");
  passed("generated image can be copied from its creator node context menu");
  const firstPost = (await state()).requests.find(
    (request) => request.method === "POST" && request.path === "/v1/images/edits",
  );
  assert.equal(firstPost?.prompt, "参考图保持构图，将背景改为温暖的日落。");
  assert.equal(firstPost.files.length, 1);
  assert.equal(
    firstPost.files[0].sha256,
    createHash("sha256").update(await readFile(referencePath)).digest("hex"),
    "multipart includes actual reference bytes",
  );

  // A completed prompt remains a valid target for another embedded upload.
  const uploadAfterResult = page.waitForEvent("filechooser");
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从本地上传", exact: true }).click();
  await (await uploadAfterResult).setFiles(referencePath);
  await creator().getByRole("img", { name: "aspect-ratio.png", exact: true }).waitFor();
  assert.equal(await selectedId(), promptId, "upload after generation keeps the creator selected");
  assert.equal(await page.getByText("原创作节点已删除，请重新选择节点添加参考图片。", { exact: true }).count(), 0);
  document = await snapshot();
  assert.equal(
    document.nodes.find((node) => node.id === promptId)?.embeddedReferences?.length,
    2,
    "explicit upload after generation adds another embedded reference",
  );
  passed("completed creator accepts local reference upload without a deleted-node error");

  // Canvas picking is a temporary interaction mode: it closes the editor,
  // highlights image nodes, and attaches the clicked image through an edge.
  await button("关闭图片创作").click();
  await creator().waitFor({ state: "hidden" });
  const canvasUpload = page.waitForEvent("filechooser");
  await button("添加节点").click();
  const nodePicker = page.getByRole("dialog", { name: "添加节点", exact: true });
  await nodePicker.getByRole("button", { name: /媒体上传/ }).click();
  await (await canvasUpload).setFiles(alternateReferencePath);
  const canvasImageDocument = await snapshot();
  const canvasImage = canvasImageDocument.nodes.find(
    (node) => node.type === "image" && node.title === "alternate-reference.png" && node.id !== firstOutput.id,
  );
  assert.ok(canvasImage?.image, "canvas upload creates a selectable image node");
  await prompt.click();
  await prompt.getByRole("button", { name: "编辑创作", exact: true }).click();
  await creator().waitFor();
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从画布选择", exact: true }).click();
  await creator().waitFor({ state: "hidden" });
  await page.locator(".reference-pick-banner").waitFor();
  await page.locator(`[data-node-id="${canvasImage.id}"]`).click();
  await eventually(
    async () => {
      const picked = await snapshot();
      return picked.edges.some((edge) => edge.from === canvasImage.id && edge.to === promptId);
    },
    "canvas picker attaches the clicked image",
  );
  await page.locator(".reference-pick-banner").waitFor({ state: "detached" });
  await creator().waitFor();
  assert.equal(await selectedId(), promptId, "canvas picking restores the creator selection");
  passed("canvas picker uses direct image-node selection and creates one reference edge");

  // Picking is an exclusive, transient mode. Keyboard shortcuts must not
  // create nodes or mutate the canvas while the picker owns the next input;
  // Escape cancels without changing the existing graph.
  const edgesAfterCanvasPick = (await snapshot()).edges.filter(
    (edge) => edge.to === promptId,
  ).length;
  const nodesBeforeShortcut = (await snapshot()).nodes.length;
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从画布选择", exact: true }).click();
  await creator().waitFor({ state: "hidden" });
  await page.locator(".reference-pick-banner").waitFor();
  await page.keyboard.press("t");
  assert.equal(
    (await snapshot()).nodes.length,
    nodesBeforeShortcut,
    "canvas shortcuts are ignored while picking a reference",
  );
  await page.locator(".reference-pick-banner").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".reference-pick-banner").waitFor({ state: "detached" });
  await creator().waitFor();
  assert.equal(
    (await snapshot()).edges.filter((edge) => edge.to === promptId).length,
    edgesAfterCanvasPick,
    "cancelling canvas picking leaves references unchanged",
  );
  passed("canvas picking isolates keyboard shortcuts and supports Escape cancellation");

  // Selecting an image that is already connected is a no-op, rather than a
  // duplicate edge. Keep the picker active so another image can be chosen.
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从画布选择", exact: true }).click();
  await creator().waitFor({ state: "hidden" });
  await page.locator(".reference-pick-banner").waitFor();
  const duplicateCanvasImage = page.locator(`[data-node-id="${canvasImage.id}"]`);
  assert.equal(await duplicateCanvasImage.getAttribute("aria-disabled"), "true");
  await page.locator(".reference-pick-banner").waitFor();
  assert.equal(
    (await snapshot()).edges.filter((edge) => edge.to === promptId).length,
    edgesAfterCanvasPick,
    "reselecting an existing image does not duplicate its reference edge",
  );
  await page.keyboard.press("Escape");
  await page.locator(".reference-pick-banner").waitFor({ state: "detached" });
  await creator().waitFor();
  passed("canvas picker keeps existing image references idempotent and recoverable");

  await creator().waitFor();
  assert.equal(await creator().getByRole("button", { name: "生成图片", exact: true }).count(), 1);
  passed("completed prompt keeps the editor available after canvas picker");

  await draft.fill("保留参考构图，将背景改为冬季雪景。");
  await creator().getByText("输入已更新", { exact: true }).waitFor();
  await page.getByLabel("创作图片模型").focus();
  await creator().getByText("输入已更新", { exact: true }).waitFor();
  await page.screenshot({ path: `${artifacts}/creator-desktop.png`, fullPage: true });
  await button("生成图片").click();
  await eventually(
    async () => (await page.locator(".node.image").count()) === 2,
    "second generated result",
  );
  document = await snapshot();
  assert.ok(document.nodes.some((node) => node.id === firstOutput.id));
  assert.equal(
    document.edges.filter((edge) => edge.from === promptId).length,
    0,
    "single-output history remains on the creator instead of adding output edges",
  );
  assert.equal(await selectedId(), promptId);
  const repeatedPosts = (await state()).requests.filter(
    (request) => request.method === "POST" && request.path === "/v1/images/edits",
  );
  assert.equal(repeatedPosts.length, 2);
  assert.ok(repeatedPosts[1].idempotencyKey);
  assert.notEqual(repeatedPosts[1].idempotencyKey, firstPost.idempotencyKey, "generating again creates a new submission");
  passed("input freshness is visible and generating again preserves earlier result");

  if (!(await creator().isVisible())) {
    await prompt.click();
    const editCreator = prompt.getByRole("button", { name: "编辑创作", exact: true });
    if (await editCreator.count()) await editCreator.click();
  }
  await creator().waitFor();
  await control({ slowPolls: 12 });
  await page.getByLabel("创作图片模型").selectOption("fixture-slow");
  await button("生成图片").click();
  await creator().waitFor();
  assert.equal(await page.locator("button.context-generate").isEnabled(), false, "running task cannot be submitted twice");
  const nextDraft = "任务进行时准备下一次描述：保留参考构图，改为春天的花园。";
  await draft.fill(nextDraft);
  // Fit all nodes before selecting the independent canvas image so it is a
  // real visible interaction while the creator task runs.
  await button("缩放选项").click();
  await page.getByRole("button", { name: /^适应画布/ }).click();
  await page.locator(`[data-node-id="${canvasImage.id}"]`).click();
  const selectionDuringTask = await selectedId();
  const viewportDuringTask = await page.locator(".world").getAttribute("style");
  assert.equal(selectionDuringTask, canvasImage.id);
  await eventually(
    async () => (await page.locator(".node.image").count()) === 2,
    "slow task completes while another node is selected",
  );
  assert.equal(await selectedId(), canvasImage.id, "completion must not steal selection");
  assert.equal(
    await page.locator(".world").getAttribute("style"),
    viewportDuringTask,
    "completion must not move the user's viewport",
  );
  assert.equal(
    (await state()).requests.filter(
      (request) => request.method === "POST" && request.model === "fixture-slow",
    ).length,
    1,
  );
  const slowPost = (await state()).requests.find(
    (request) => request.method === "POST" && request.model === "fixture-slow",
  );
  assert.equal(
    slowPost?.prompt,
    "保留参考构图，将背景改为冬季雪景。",
    "editing the next prompt during generation does not mutate the frozen request",
  );
  passed("asynchronous completion preserves other selection and viewport with one POST");

  await prompt.click();
  const reopenAfterTask = prompt.getByRole("button", { name: "编辑创作", exact: true });
  if (await reopenAfterTask.count()) await reopenAfterTask.click();
  await creator().waitFor();
  assert.equal(await draft.inputValue(), nextDraft, "completion preserves inputs edited during generation");
  await button("关闭图片创作").click();
  await creator().waitFor({ state: "hidden" });
  // Completed prompt nodes now use an explicit edit action; double-clicking
  // a result opens its preview in the current creator UI.
  await prompt.click();
  const reopenCreator = prompt.getByRole("button", { name: "编辑创作", exact: true });
  if (await reopenCreator.count()) await reopenCreator.click();
  await creator().waitFor();
  assert.equal(await draft.inputValue(), nextDraft);
  await button("展开画面描述").click();
  await button("收起画面描述").waitFor();
  assert.equal(await draft.inputValue(), nextDraft);
  await button("收起画面描述").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await creator().waitFor();
  await checkVisibleWithinViewport(draft, "mobile prompt input");
  await checkVisibleWithinViewport(button("生成图片"), "mobile submit button");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "mobile page has no horizontal overflow",
  );
  await page.screenshot({ path: `${artifacts}/creator-mobile.png`, fullPage: true });
  passed("close/reopen retains input and mobile exposes input and submission");

  // The library picker is a distinct surface from the canvas picker. It opens
  // the shared asset library, then returns to this creator after insertion.
  // Seed one platform asset so this path verifies the complete round trip,
  // including the detail read used to obtain the original image URL.
  await page.setViewportSize({ width: 1440, height: 960 });
  await creator().waitFor();
  await control({ assets: [{
    id: "library-reference",
    task_id: "task-library-reference",
    name: "素材库参考图",
    category: "object",
    tags: ["library"],
    folder: "测试素材",
    saved_to_library: true,
    metadata_revision: 0,
    url: `${base}/v1/fixture-image.png?library-reference=1`,
  }] });
  const referencesBeforeAsset = await creator().locator(".context-reference").count();
  const nodesBeforeAsset = await page.locator(".node[data-node-id]").count();
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从资产库选择", exact: true }).click();
  const assetLibrary = page.getByRole("region", { name: "Canvas 资产库", exact: true });
  await assetLibrary.waitFor();
  const assetSearch = assetLibrary.getByLabel("搜索资产库");
  await assetSearch.fill("__asset_picker_no_match__");
  await assetLibrary.getByText("没有找到符合条件的资产", { exact: true }).waitFor();
  await assetSearch.fill("");
  const assetCard = assetLibrary.locator(".asset-library-card").filter({ hasText: "素材库参考图" });
  await assetCard.waitFor();
  await assetLibrary.getByRole("button", { name: "返回创作", exact: true }).click();
  await creator().waitFor();
  await assetLibrary.waitFor({ state: "hidden" });
  assert.equal(await assetLibrary.isVisible(), false, "returning without an insertion hides the library");
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从资产库选择", exact: true }).click();
  const reopenedLibrary = page.getByRole("region", { name: "Canvas 资产库", exact: true });
  await reopenedLibrary.waitFor();
  await reopenedLibrary.getByLabel("搜索资产库").fill("素材库参考图");
  const reopenedCard = reopenedLibrary.locator(".asset-library-card").filter({ hasText: "素材库参考图" });
  await reopenedCard.waitFor();
  await reopenedCard.getByRole("button", { name: "添加 素材库参考图 到画布", exact: true }).click();
  await eventually(
    async () => (await creator().count()) === 1 &&
      (await creator().locator(".context-reference").count()) === referencesBeforeAsset + 1 &&
      (await page.locator(".node[data-node-id]").count()) === nodesBeforeAsset + 1,
    "inserting a library asset returns to the creator and attaches one reference",
  );
  const libraryDocument = await snapshot();
  const libraryNode = libraryDocument.nodes.find((node) => node.assetId === "library-reference");
  assert.ok(libraryNode?.image, "library insertion persists a stable media identity and original image URL");
  assert.ok(libraryDocument.edges.some((edge) => edge.from === libraryNode.id && edge.to === promptId), "library insertion creates a reference edge");
  const libraryState = await state();
  assert.ok(libraryState.requests.some((request) => request.method === "GET" && request.path === "/v1/media/assets/library-reference"), "insertion refreshes the original media URL");
  passed("asset library search, original-image resolution, insertion, and return to creator form one closed loop");

  // An image already attached to this creator can be mentioned repeatedly.
  // Its references must remain available after the first inline insertion,
  // while its canvas node and media input keep one stable identity.
  const nodesBeforeMentions = await page.locator(".node[data-node-id]").count();
  await control({ assets: [
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `mention-scene-${index}`,
      name: index === 0 ? "引用测试场景" : `引用测试场景${index + 1}`,
      category: "scene",
      saved_to_library: true,
      thumbnail_url: `${base}/v1/fixture-image.png?mention-scene-thumbnail=${index}`,
    })),
    { id: "mention-person", name: "引用测试人物", category: "person", saved_to_library: true, thumbnail_url: `${base}/v1/fixture-image.png?mention-person-thumbnail=1` },
    { id: "mention-generic-image", name: "image.png", category: "object", saved_to_library: true, thumbnail_url: `${base}/v1/fixture-image.png?mention-generic-thumbnail=1` },
  ] });
  await draft.fill("复用已有素材 @");
  const mentionMenu = page.getByRole("dialog", { name: "引用素材", exact: true });
  await mentionMenu.waitFor();
  await checkVisibleWithinViewport(mentionMenu, "mention menu");
  await eventually(async () => (await state()).requests.some(request => request.path.startsWith("/v1/media/assets?") && request.path.includes("limit=12")), "the first mention request only loads one small asset page");
  await mentionMenu.getByText("当前已有引用", { exact: true }).waitFor();
  await mentionMenu.getByRole("button", { name: "场景", exact: true }).click();
  const sceneMentions = page.getByRole("dialog", { name: "场景素材", exact: true });
  await sceneMentions.getByRole("option", { name: "引用测试场景", exact: true }).waitFor();
  assert.ok((await sceneMentions.getByRole("option").count()) <= 12, "only one small batch is rendered initially");
  await checkVisibleWithinViewport(sceneMentions, "category mention panel");
  assert.equal(await sceneMentions.getByRole("option", { name: "引用测试人物", exact: true }).count(), 0, "a category panel excludes other categories");
  await sceneMentions.getByRole("button", { name: "滚动或点击加载更多素材", exact: true }).click();
  await eventually(async () => (await sceneMentions.getByRole("option").count()) > 12, "scrolling the category menu renders the next asset batch");
  await sceneMentions.getByRole("button", { name: "返回引用菜单", exact: true }).click();
  const attachedMention = mentionMenu.getByRole("option", { name: "素材库参考图", exact: true });
  await attachedMention.hover();
  const mentionPreview = page.getByLabel("引用素材预览", { exact: true });
  await mentionPreview.waitFor();
  await checkVisibleWithinViewport(mentionPreview, "mention hover preview");
  await attachedMention.click();
  await mentionMenu.waitFor({ state: "hidden" });
  await draft.locator('[data-prompt-reference="true"]').waitFor();
  await draft.press("End");
  await page.keyboard.type(" 同一素材再次 @");
  await mentionMenu.waitFor();
  await mentionMenu.getByRole("option", { name: "素材库参考图", exact: true }).click();
  await mentionMenu.waitFor({ state: "hidden" });
  assert.equal(await draft.locator('[data-prompt-reference="true"]').count(), 2, "the same attached image remains reusable inline");
  const mentionedReferencePreview = creator().getByRole("button", { name: "预览参考 素材库参考图", exact: true });
  await mentionedReferencePreview.waitFor();
  assert.equal(await mentionedReferencePreview.locator("img").count(), 1, "inline mentions keep the image visible in the reference strip");
  assert.equal(await page.locator(".node[data-node-id]").count(), nodesBeforeMentions, "reusing an image does not create duplicate nodes");
  const mentionDocument = await snapshot();
  const repeatedReferences = mentionDocument.nodes.find((node) => node.id === promptId).promptSegments.filter((segment) => segment.type === "reference");
  assert.deepEqual(repeatedReferences.map((segment) => segment.referenceId), [libraryNode.id, libraryNode.id], "repeated mentions preserve the original node identity");
  assert.equal(mentionDocument.edges.filter((edge) => edge.from === libraryNode.id && edge.to === promptId).length, 1, "repeated mentions do not duplicate the reference connection");
  await draft.press("End");
  await page.keyboard.type(" 再加入 @image");
  await mentionMenu.waitFor();
  await mentionMenu.getByRole("option", { name: "image.png", exact: true }).click();
  const imageOnlyMention = draft.locator(".context-prompt-mention.is-image-only");
  await imageOnlyMention.waitFor();
  assert.equal(await imageOnlyMention.locator("img").count(), 1, "generic image filenames leave the thumbnail as the visible reference token");
  assert.equal(await imageOnlyMention.locator(".context-prompt-mention-label").count(), 0, "generic image filenames are not repeated beside the thumbnail");
  assert.match(await imageOnlyMention.getAttribute("aria-label"), /image\.png/, "the image filename remains accessible");
  assert.equal(await imageOnlyMention.getAttribute("title"), "image.png", "the filename remains available on hover");
  passed("the mention menu filters and previews assets, reuses existing references, and renders generic image files as accessible thumbnails");

  await button("关闭图片创作").click();
  const board = page.getByLabel("无限创作画布");
  await board.focus();
  await board.press("t");
  const noteId = await selectedId();
  const note = page.locator(`[data-node-id="${noteId}"]`);
  const noteText = "镜头从人物正面推进，保留清晰面部和自然光。";
  await page.getByLabel("编辑节点内容").fill(noteText);
  await note.getByRole("button", { name: "完成" }).click();
  await note.getByRole("button", { name: "创作", exact: true }).click();
  await creator().waitFor();
  const textPromptId = await selectedId();
  assert.notEqual(textPromptId, noteId);
  const textDocument = await snapshot();
  assert.ok(textDocument.edges.some((edge) => edge.from === noteId && edge.to === textPromptId));
  const textReference = creator().locator(".context-input-sources");
  await textReference.getByText(noteText, { exact: true }).waitFor();
  assert.equal(await textReference.locator(".context-text-reference").count(), 1, "connected text is shown as one compact source chip");
  assert.equal(await textReference.locator("details").count(), 0, "connected text does not expand into a blocking panel");
  assert.equal(await textReference.getAttribute("title"), null, "connected text does not create a blocking native tooltip");
  assert.equal(await draft.inputValue(), "", "connected text does not need to be copied into the local draft");
  await page.getByLabel("创作图片模型").selectOption("fixture-sync");
  const beforeTextRequest = await generationRequests();
  await button("生成图片").click();
  await eventually(async () => (await generationRequests()) === beforeTextRequest + 1, "text-only generation request");
  const textRequest = (await state()).requests.filter(
    (request) => request.method === "POST" && request.path === "/v1/images/generations",
  ).at(-1);
  assert.equal(textRequest?.prompt, noteText);
  passed("connected text node is visible in the creator and sent as the image prompt");

  // A single-output generation is persisted on its prompt node. It remains a
  // valid image source for a different prompt in the same canvas.
  const closeBeforeFinalPicker = button("关闭图片创作");
  if (await closeBeforeFinalPicker.count() && await closeBeforeFinalPicker.isVisible().catch(() => false)) {
    await closeBeforeFinalPicker.click({ timeout: 1000 }).catch(() => {});
  }
  await button("添加节点").click();
  const finalNodePicker = page.getByRole("dialog", { name: "添加节点", exact: true });
  await finalNodePicker.getByRole("button", { name: /图片生成/ }).click();
  const completedReferenceTargetId = await selectedId();
  assert.notEqual(completedReferenceTargetId, promptId);
  await button("缩放选项").click();
  await page.getByRole("button", { name: /^适应画布/ }).click();
  await button("添加参考图片").click();
  await page.getByRole("menuitem", { name: "从画布选择", exact: true }).click();
  await creator().waitFor({ state: "hidden" });
  await page.locator(".reference-pick-banner").waitFor();
  await page.locator(`[data-node-id="${promptId}"]`).click();
  await page.locator(".reference-pick-banner").waitFor({ state: "detached" });
  await creator().waitFor();
  assert.ok(
    (await snapshot()).edges.some(
      (edge) => edge.from === promptId && edge.to === completedReferenceTargetId,
    ),
    "a completed prompt result can be picked as a canvas reference",
  );
  passed("canvas picker accepts completed prompt image results as sources");

  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/creator-result.json`,
    JSON.stringify({ passed: true, errors, checks }, null, 2),
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${artifacts}/creator-failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${artifacts}/creator-failure.html`, await page.content()).catch(() => {});
    console.error((await page.locator("body").innerText().catch(() => "")).slice(0, 7000));
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
  console.log("CLOSED isolated creator browser and fixture");
}
