/** Real media-tool components on a disposable loopback Vite fixture.
 * No app bootstrap, platform account, media download, or package installation.
 * CANVAS_PLAYWRIGHT_MODULE may point to an already installed playwright/index.mjs.
 * Run: node tests/media-tools-e2e.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5391";
const checks = [], errors = [], consoleErrors = [], unexpectedNetworks = [], measurements = {};
let fixtureOutput = "", browser, context, page, failure;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventually = async (predicate, message, timeout = 12000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(40); }
  throw new Error(`Timed out: ${message}`);
};
const passed = message => { checks.push(message); console.log(`PASS ${message}`); };
const button = name => page.getByRole("button", { name, exact: true });
const menu = name => page.getByRole("menu", { name: `${name}菜单`, exact: true });
const dialog = name => page.getByRole("dialog", { name, exact: true });
const focused = locator => locator.evaluate(element => document.activeElement === element);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const control = async patch => { await page.evaluate(patch => window.mediaToolsFixture.update(patch), patch); await settle(); };
const stats = () => page.evaluate(() => window.mediaToolsFixture.stats());
const snapshot = async name => { await settle(); await page.screenshot({ path: `${artifacts}media-tools-${name}.png` }); };
const openTool = async (kind, name) => {
  await page.mouse.move(1300, 800);
  await button(`${kind}工具`).hover();
  await menu(`${kind}工具`).waitFor();
  await menu(`${kind}工具`).getByRole("menuitem", { name, exact: true }).click();
};

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>媒体工具独立回归</title></head><body><div id="root"></div><script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
window.__mediaToolsPreambleReady = true;
</script></body></html>`;

await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.env.CANVAS_FIXTURE_NODE || process.execPath, ["tests/platform-fixture.mjs", "--port=5391", "--api-port=5392"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Media-tools fixture startup timeout: ${fixtureOutput}`)), 30000);
  fixture.stdout.on("data", chunk => { fixtureOutput += String(chunk); if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timer); resolve(); } });
  fixture.stderr.on("data", chunk => { fixtureOutput += String(chunk); });
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { clearTimeout(timer); if (code) reject(new Error(`Fixture exited ${code}: ${fixtureOutput}`)); });
});

async function mount(target) {
  await target.route("**/__media_tools", route => route.fulfill({ contentType: "text/html", body: html }));
  await target.route("**/favicon.ico", route => route.fulfill({ status: 204, body: "" }));
  await target.goto(`${base}/__media_tools`);
  await target.waitForFunction(() => window.__mediaToolsPreambleReady);
  const sources = await target.evaluate(async () => {
    const [image, main] = await Promise.all([fetch("/src/ImageTools.tsx").then(response => response.text()), fetch("/src/main.tsx").then(response => response.text())]);
    return { reactPath: /from\s+["']([^"']*\/react\.js[^"']*)["']/.exec(image)?.[1], domPath: /from\s+["']([^"']*\/react-dom_client\.js[^"']*)["']/.exec(main)?.[1] };
  });
  assert.ok(sources.reactPath && sources.domPath, "locate the same Vite React runtime used by the real components");
  await target.evaluate(async ({ reactPath, domPath }) => {
    const React = (await import(reactPath)).default;
    const domRuntime = await import(domPath);
    const createRoot = domRuntime.createRoot || domRuntime.default?.createRoot;
    if (typeof createRoot !== "function") throw new Error("Vite React DOM runtime does not expose createRoot");
    const [{ default: ImageTools }, { default: VideoTools }, { default: MediaToolMenu }] = await Promise.all([import("/src/ImageTools.tsx"), import("/src/VideoTools.tsx"), import("/src/MediaToolMenu.tsx")]);
    // The real ImageTools/VideoTools import their production lucide icons. The
    // synthetic long-list harness only needs a valid icon component here and
    // should not couple the test to lucide's package export layout.
    const Camera = props => React.createElement("span", { ...props, "aria-hidden": "true" }, "•");
    await import("/src/styles.css");
    const style = document.createElement("style");
    style.textContent = `body{margin:0;background:#151517;background-image:radial-gradient(#38383b .7px,transparent .7px);background-size:14px 14px;color:#eee;font:13px system-ui;overflow:hidden}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}.fixture-heading{position:absolute;left:54px;top:35px;display:grid;gap:7px}.fixture-heading strong{font-size:19px;font-weight:550}.fixture-heading small{color:#777780;font-size:12px}.fixture-stage{position:absolute;display:flex;gap:60px;align-items:flex-start;left:160px;top:170px}.fixture-card.node{position:static;width:310px;display:grid;gap:16px}.fixture-card-label{font-size:12px;color:#bcbcc4}.fixture-card .node-toolbar{position:static;left:auto;bottom:auto;transform:none;width:max-content;min-height:39px;padding:4px 7px;z-index:auto}.fixture-media{width:310px;height:205px;object-fit:cover;border-radius:10px;border:1px solid #494950;background:#202024}.fixture-video{position:relative;border:1px solid #494950;border-radius:10px;overflow:hidden;width:310px;height:205px;background:linear-gradient(145deg,#31354e,#595871 48%,#292b3e)}.fixture-video:before{content:'▶';position:absolute;left:132px;top:78px;font-size:33px;color:#ffffffa8}.fixture-video:after{content:'00:08 / 01:00';position:absolute;bottom:13px;left:16px;font:11px system-ui;color:#dddde4}.fixture-neutral{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:#9e9eaa;display:grid;place-items:center}.fixture-neutral:focus-visible{outline:2px solid #b9bfff}.fixture-edge .fixture-card{width:auto}.fixture-edge .fixture-card-label,.fixture-edge .fixture-media,.fixture-edge .fixture-video{display:none}.fixture-summary{position:absolute;bottom:35px;left:54px;color:#666670;font-size:11px}.fixture-long{position:absolute;right:80px;top:170px}`;
    document.head.append(style);
    const originalCanvas = document.createElement("canvas"); originalCanvas.width = 1200; originalCanvas.height = 800;
    const ctx = originalCanvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 1200, 800); gradient.addColorStop(0, "#c98e65"); gradient.addColorStop(.42, "#d1a883"); gradient.addColorStop(1, "#423e60"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = "#736675"; ctx.beginPath(); ctx.moveTo(0, 610); ctx.bezierCurveTo(250, 250, 690, 360, 1200, 190); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
    ctx.fillStyle = "#524f69"; ctx.beginPath(); ctx.moveTo(0, 800); ctx.bezierCurveTo(200, 680, 780, 420, 1200, 520); ctx.lineTo(1200, 800); ctx.fill();
    ctx.fillStyle = "#edc6a3"; ctx.beginPath(); ctx.arc(870, 180, 63, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff8"; ctx.font = "30px system-ui"; ctx.fillText("ORIGINAL · 1200 × 800", 48, 72);
    const original = originalCanvas.toDataURL("image/png");
    const thumbnailCanvas = document.createElement("canvas"); thumbnailCanvas.width = 120; thumbnailCanvas.height = 80;
    thumbnailCanvas.getContext("2d").drawImage(originalCanvas, 0, 0, 120, 80);
    const thumbnail = thumbnailCanvas.toDataURL("image/png");
    const telemetry = { resolveCalls: 0, sourceFailures: 0, outputs: [], captures: 0, processCalls: [], cancels: 0, notices: [] };
    function Harness() {
      const [state, setState] = React.useState({ tick: 0, captureReady: true, busy: false, progress: 0, error: "", position: "normal", long: false });
      window.mediaToolsFixture = {
        update(patch) { if ("sourceFailures" in patch) { telemetry.sourceFailures = patch.sourceFailures; patch = { ...patch }; delete patch.sourceFailures; } setState(current => ({ ...current, ...patch })); },
        stats: () => ({ ...telemetry, outputs: telemetry.outputs.map(output => ({ ...output, dataUrl: undefined })), state, original, thumbnail }),
      };
      const h = React.createElement;
      const edge = state.position !== "normal";
      const position = state.position === "bottom" ? { top: "auto", bottom: "12px", left: "20px" } : state.position === "top" ? { top: "8px", left: "8px" } : state.position === "right" ? { top: "8px", left: "auto", right: "8px" } : {};
      const image = h(ImageTools, { source: thumbnail, title: "山间日落", resolveSource: async () => { telemetry.resolveCalls++; if (telemetry.sourceFailures > 0) { telemetry.sourceFailures--; throw new Error("原图加载失败：测试连接中断"); } await new Promise(resolve => setTimeout(resolve, 30)); return original; }, onApply: outputs => { telemetry.outputs.push(...outputs); }, onNotice: notice => telemetry.notices.push(notice) });
      const video = h(VideoTools, { source: "data:video/webm;base64,GkXfo0A=", captureReady: state.captureReady, duration: 60, currentTime: 8, processBusy: state.busy, processProgress: state.progress, processError: state.error, onCapture: () => { telemetry.captures++; }, onProcess: options => { telemetry.processCalls.push({ ...options }); setState(current => ({ ...current, busy: true, progress: 40, error: "" })); }, onCancelProcess: () => { telemetry.cancels++; setState(current => ({ ...current, busy: false, error: "处理已取消" })); }, onClearProcessError: () => setState(current => current.error ? { ...current, error: "" } : current) });
      const toolCard = (kind, tool, media) => h("div", { className: `fixture-card node ${kind}` }, h("div", { className: "fixture-card-label" }, kind === "image" ? "图片 · 山间日落" : "视频 · 山间漫游"), h("div", { className: "node-toolbar" }, h("button", { id: `before-${kind}`, className: "fixture-neutral icon-button", "aria-label": `${kind}前一个按钮` }, "↖"), tool, h("button", { id: `after-${kind}`, className: "node-generate", "aria-label": `${kind}生成按钮` }, "生成")), media);
      return h(React.Fragment, null,
        h("header", { className: "fixture-heading" }, h("strong", null, "媒体创作工具"), h("small", null, "图片与视频 · 统一工具菜单")),
        h("main", { className: `fixture-stage${edge ? " fixture-edge" : ""}`, style: position }, toolCard("image", image, h("img", { className: "fixture-media", src: thumbnail, alt: "图片节点缩略图" })), toolCard("video", video, h("div", { className: "fixture-video", "aria-label": "视频节点" }))),
        state.long && h("div", { className: "fixture-long" }, h(MediaToolMenu, { label: "长列表工具", groups: [{ label: "扩展工具", items: Array.from({ length: 40 }, (_, index) => ({ id: `long-${index}`, label: `扩展工具 ${index + 1}`, icon: Camera, onSelect: () => {} })) }] })),
        h("footer", { className: "fixture-summary" }, "仅使用本机合成媒体 · 不访问平台模型与远程素材"));
    }
    createRoot(document.getElementById("root")).render(React.createElement(Harness));
  }, sources);
  await target.getByRole("button", { name: "图片工具", exact: true }).waitFor();
}

try {
  await ready;
  browser = await chromium.launch({ headless: true, args: ["--disable-features=LocalNetworkAccessChecks"], ...(process.env.CANVAS_BROWSER_EXECUTABLE ? { executablePath: process.env.CANVAS_BROWSER_EXECUTABLE } : process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) { unexpectedNetworks.push(`${route.request().method()} ${url.origin}`); return route.abort("blockedbyclient"); }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await mount(page);

  await page.mouse.move(1300, 800); await settle();
  const transparent = color => color === "transparent" || color === "rgba(0, 0, 0, 0)";
  const triggerDefaults = await page.locator(".node-toolbar button").evaluateAll(items => items.map(item => {
    const style = getComputedStyle(item);
    return { name: item.getAttribute("aria-label"), background: style.backgroundColor, borderColor: style.borderTopColor, borderWidth: style.borderTopWidth, shadow: style.boxShadow, height: item.getBoundingClientRect().height };
  }));
  assert.equal(triggerDefaults.length, 6);
  assert.ok(triggerDefaults.every(item => transparent(item.background)), "all sibling toolbar controls have a transparent idle surface");
  assert.ok(triggerDefaults.every(item => parseFloat(item.borderWidth) === 0 || transparent(item.borderColor)), "idle controls do not add another outlined capsule");
  assert.ok(triggerDefaults.every(item => item.shadow === "none"), "idle controls do not add independent card shadows");
  const wrappers = await page.locator(".image-tools,.media-tool-menu").evaluateAll(items => items.map(item => { const style = getComputedStyle(item); return { background: style.backgroundColor, borderWidth: style.borderTopWidth, shadow: style.boxShadow }; }));
  assert.ok(wrappers.every(item => transparent(item.background) && parseFloat(item.borderWidth) === 0 && item.shadow === "none"), "tool wrappers do not create an extra capsule surface");
  measurements.toolbarDefaults = triggerDefaults;
  await snapshot("toolbar-idle");
  for (const kind of ["image", "video"]) {
    const siblingHover = [];
    for (const target of [page.locator(`#before-${kind}`), button(`${kind === "image" ? "图片" : "视频"}工具`), page.locator(`#after-${kind}`)]) {
      await target.hover(); await pause(140);
      siblingHover.push(await target.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, radius: parseFloat(getComputedStyle(element).borderTopLeftRadius), height: element.getBoundingClientRect().height })));
    }
    assert.equal(siblingHover[0].background, siblingHover[2].background, "ordinary toolbar icon and generate action share the same hover surface");
    assert.notEqual(siblingHover[1].background, siblingHover[0].background, "the expanded tool trigger exposes a distinct open state");
    assert.equal(siblingHover[0].radius, siblingHover[2].radius, "ordinary toolbar controls share the same corner radius");
    assert.ok(siblingHover[1].radius >= siblingHover[1].height / 2, "tool trigger uses a capsule radius that matches the rounded outer toolbar");
    measurements[`${kind}SiblingHover`] = siblingHover;
  }

  await page.mouse.move(1300, 800); await pause(300);
  await button("图片工具").hover();
  await menu("图片工具").waitFor();
  await snapshot("toolbar-hover-menu");
  const imageTriggerBox = await button("图片工具").boundingBox();
  const imageMenuBox = await menu("图片工具").boundingBox();
  assert.ok(imageMenuBox.x >= imageTriggerBox.x - 1, "menu aligns its left edge with the trigger when there is room to the right");
  await page.mouse.move(imageTriggerBox.x + imageTriggerBox.width / 2, imageTriggerBox.y + imageTriggerBox.height + 4);
  await pause(60);
  assert.equal(await menu("图片工具").isVisible(), true, "crossing the trigger-menu gap preserves the hover menu");
  await menu("图片工具").getByRole("menuitem").nth(1).hover();
  await pause(260);
  assert.equal(await menu("图片工具").isVisible(), true, "entering the portal menu cancels the gap-close timer");
  await page.mouse.move(1300, 800); await pause(60);
  assert.equal(await menu("图片工具").isVisible(), true, "pointer leave uses a short grace period");
  await menu("图片工具").getByRole("menuitem").nth(1).hover(); await pause(280);
  assert.equal(await menu("图片工具").isVisible(), true, "returning to the menu cancels pending dismissal");
  await page.mouse.move(1300, 800);
  await eventually(async () => await menu("图片工具").count() === 0, "pointer leave dismisses the menu", 2500);
  await button("图片工具").hover(); await menu("图片工具").waitFor();
  await button("图片工具").click();
  await menu("图片工具").waitFor();
  assert.equal(await focused(button("图片工具")), true, "pointer opening keeps focus on the trigger");
  assert.equal(await menu("图片工具").getByRole("menuitem").first().evaluate(element => element.matches(":focus-visible")), false);
  assert.equal(await menu("图片工具").getByRole("menuitem").count(), 4);
  await snapshot("image-menu");
  await menu("图片工具").getByRole("menuitem").nth(1).hover(); await settle();
  const imageHoverRows = await menu("图片工具").getByRole("menuitem").evaluateAll(items => items.map(item => ({ background: getComputedStyle(item).backgroundColor, hover: item.matches(":hover"), focusVisible: item.matches(":focus-visible") })));
  assert.equal(imageHoverRows.filter(item => item.hover).length, 1);
  assert.equal(imageHoverRows[1].hover, true);
  assert.equal(imageHoverRows.filter(item => !transparent(item.background)).length, 1, "only the pointed item is highlighted");
  assert.equal(imageHoverRows.filter(item => item.focusVisible).length, 0, "pointer opening does not leave the first row visually selected");
  await snapshot("image-menu-hover");
  await button("图片工具").focus();
  await button("视频工具").hover();
  await menu("视频工具").waitFor();
  assert.equal(await menu("图片工具").count(), 0); assert.equal(await menu("视频工具").count(), 1);
  assert.equal(await menu("视频工具").getByRole("menuitem").first().evaluate(element => element === document.activeElement), false, "hover opening does not steal focus into the menu");
  await snapshot("video-menu");
  await page.keyboard.press("Escape");
  await eventually(async () => await menu("视频工具").count() === 0, "Escape closes a hover-open menu without stealing existing focus");
  assert.equal(await focused(button("图片工具")), true, "Escape preserves focus outside the hover-open menu");
  await page.mouse.move(1300, 800);
  await button("视频工具").hover(); await menu("视频工具").waitFor();
  await menu("视频工具").getByRole("menuitem").nth(1).hover(); await settle();
  const videoHoverRows = await menu("视频工具").getByRole("menuitem").evaluateAll(items => items.map(item => ({ background: getComputedStyle(item).backgroundColor, hover: item.matches(":hover"), focusVisible: item.matches(":focus-visible") })));
  assert.equal(videoHoverRows.filter(item => item.hover).length, 1);
  assert.equal(videoHoverRows[1].hover, true);
  assert.equal(videoHoverRows.filter(item => !transparent(item.background)).length, 1);
  assert.equal(videoHoverRows.filter(item => item.focusVisible).length, 0);
  await snapshot("video-menu-hover");
  const videoNames = ["裁剪视频", "提取视频", "视频压缩", "画面裁剪", "基础调色", "旋转", "镜像", "调整速度", "文字水印", "截取当前帧", "提取音频", "移除音轨"];
  assert.equal(await menu("视频工具").getByRole("menuitem").count(), 12);
  for (const name of videoNames) assert.equal(await menu("视频工具").getByRole("menuitem", { name, exact: true }).count(), 1);
  assert.equal(await menu("视频工具").getByRole("menuitem", { name: "格式转换", exact: true }).count(), 0);
  const rowGeometry = await menu("视频工具").getByRole("menuitem").evaluateAll(items => items.map(item => ({ height: item.getBoundingClientRect().height, secondary: item.querySelector("small") !== null })));
  assert.ok(rowGeometry.every(row => row.height >= 32 && row.height <= 40 && !row.secondary), "compact command rows have no secondary description line");
  measurements.videoRows = rowGeometry;
  assert.equal(await focused(button("图片工具")), true, "hovering the menu does not steal focus from the previously focused control");
  await page.mouse.move(1300, 800);
  await eventually(async () => await menu("视频工具").count() === 0, "pointer leave closes a hover-open menu");
  assert.equal(await focused(button("图片工具")), true);
  measurements.hoverGap = { trigger: imageTriggerBox, panel: imageMenuBox };
  passed("hover menus open, preserve trigger-to-panel gap crossing, delay dismissal, cancel pending close on return, and expose twelve video commands without format conversion");

  for (const kind of ["图片", "视频"]) {
    const trigger = button(`${kind}工具`), panel = menu(`${kind}工具`);
    await page.mouse.move(1300, 800);
    for (const key of ["Enter", "Space"]) {
      await trigger.focus(); await page.keyboard.press(key);
      await eventually(() => focused(panel.getByRole("menuitem").first()), `${kind} ${key} opens on first item`);
      assert.equal(await panel.getByRole("menuitem").first().evaluate(element => element.matches(":focus-visible")), true);
      await page.keyboard.press("Escape"); await eventually(() => focused(trigger), `${kind} ${key} Escape restores trigger`);
    }
    for (const [key, target] of [["ArrowDown", "first"], ["ArrowUp", "last"]]) {
      await page.mouse.move(1300, 800); await pause(220);
      await trigger.hover(); await panel.waitFor();
      assert.equal(await panel.getByRole("menuitem").evaluateAll(items => items.some(item => item === document.activeElement)), false, "hover keeps keyboard focus outside the menu");
      await page.keyboard.press(key);
      await eventually(() => focused(target === "first" ? panel.getByRole("menuitem").first() : panel.getByRole("menuitem").last()), `${kind} pointer-open ${key} picks ${target}`);
      await page.keyboard.press("Escape"); await eventually(() => focused(trigger), `${kind} pointer-open Escape restores trigger`);
    }
    await trigger.focus(); await page.keyboard.press("ArrowDown");
    await eventually(() => focused(panel.getByRole("menuitem").first()), `${kind} ArrowDown focuses first item`);
    await panel.getByRole("menuitem").nth(1).hover(); await settle();
    const changedToPointer = await panel.getByRole("menuitem").evaluateAll(items => items.map(item => ({ background: getComputedStyle(item).backgroundColor, hover: item.matches(":hover"), outlineWidth: getComputedStyle(item).outlineWidth, outlineStyle: getComputedStyle(item).outlineStyle })));
    assert.equal(await panel.getAttribute("data-navigation"), "pointer");
    assert.equal(changedToPointer.filter(item => !transparent(item.background)).length, 1, "keyboard-to-pointer input never leaves two highlighted rows");
    assert.equal(changedToPointer[1].hover, true);
    assert.ok(parseFloat(changedToPointer[0].outlineWidth) === 0 || changedToPointer[0].outlineStyle === "none", "keyboard-focus outline is suppressed after pointer takes over");
    await snapshot(`${kind === "图片" ? "image" : "video"}-menu-keyboard-pointer`);
    await page.keyboard.press("ArrowDown"); await settle();
    assert.equal(await panel.getAttribute("data-navigation"), "keyboard");
    assert.equal(await focused(panel.getByRole("menuitem").nth(1)), true);
    const changedToKeyboard = await panel.getByRole("menuitem").evaluateAll(items => items.map(item => ({ background: getComputedStyle(item).backgroundColor })));
    assert.equal(changedToKeyboard.filter(item => !transparent(item.background)).length, 1, "returning to keyboard maintains one highlight");
    await page.mouse.move(1300, 800);
    await pause(240);
    assert.equal(await panel.isVisible(), true, "pointer movement cannot change a keyboard-open menu into hover dismissal");
    await page.keyboard.press("End"); assert.equal(await focused(panel.getByRole("menuitem").last()), true);
    await page.keyboard.press("Home"); assert.equal(await focused(panel.getByRole("menuitem").first()), true);
    await page.keyboard.press("ArrowUp"); assert.equal(await focused(panel.getByRole("menuitem").last()), true);
    await page.keyboard.press("Escape"); await eventually(() => focused(trigger), `${kind} Escape restores trigger`);
    await page.keyboard.press("ArrowUp"); await eventually(() => focused(panel.getByRole("menuitem").last()), `${kind} ArrowUp opens on last item`);
    await page.keyboard.press("Tab"); assert.equal(await panel.count(), 0);
    assert.equal(await page.locator(`#after-${kind === "图片" ? "image" : "video"}`).evaluate(element => document.activeElement === element), true);
    await trigger.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Shift+Tab");
    assert.equal(await panel.count(), 0);
    assert.equal(await page.locator(`#before-${kind === "图片" ? "image" : "video"}`).evaluate(element => document.activeElement === element), true);
  }
  passed("both menus support first/last arrows, Home/End, Escape focus restoration, and natural Tab/Shift+Tab exit");

  for (const position of ["top", "bottom", "right"]) {
    await page.mouse.move(1300, 800);
    await eventually(async () => await menu("视频工具").count() === 0, "close the previous position menu");
    await control({ position }); await button("视频工具").hover(); await menu("视频工具").waitFor();
    const box = await menu("视频工具").boundingBox();
    const triggerBox = await button("视频工具").boundingBox();
    const placement = await menu("视频工具").getAttribute("data-placement");
    assert.ok(box.x >= 7 && box.y >= 7 && box.x + box.width <= 1440 - 7 && box.y + box.height <= 960 - 7);
    if (position === "right") assert.ok(box.x + box.width <= triggerBox.x + triggerBox.width + 1, "right-edge triggers align the panel to the trigger's right edge");
    if (position === "bottom") { assert.equal(placement, "above"); assert.ok(box.y + box.height <= triggerBox.y - 6); }
    else { assert.equal(placement, "below"); assert.ok(box.y >= triggerBox.y + triggerBox.height + 6); }
    measurements[`placement-${position}`] = { box, triggerBox, placement };
  }
  await control({ position: "normal", long: true });
  await button("长列表工具").hover(); await menu("长列表工具").waitFor();
  const longMenu = menu("长列表工具");
  assert.equal(await longMenu.getByRole("menuitem").count(), 40);
  assert.equal(await longMenu.evaluate(element => element.scrollHeight > element.clientHeight + 100), true);
  await button("长列表工具").focus(); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  measurements.longListAfterEnd = await longMenu.evaluate(element => {
    const panel = element.getBoundingClientRect(), last = element.querySelector("button:last-child")?.getBoundingClientRect();
    return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, panel: { top: panel.top, bottom: panel.bottom }, last: last && { top: last.top, bottom: last.bottom }, focused: document.activeElement?.textContent };
  });
  await eventually(() => longMenu.getByRole("menuitem").last().evaluate(element => {
    const bounds = element.getBoundingClientRect(), panel = element.closest("[role='menu']").getBoundingClientRect();
    return bounds.top >= panel.top - 1 && bounds.bottom <= panel.bottom + 1;
  }), "End immediately after opening reveals the last command", 2500);
  await page.keyboard.press("Home");
  assert.equal(await focused(longMenu.getByRole("menuitem").first()), true);
  await longMenu.hover(); await page.mouse.wheel(0, 900); await settle();
  assert.ok(await longMenu.evaluate(element => element.scrollTop) > 0);
  await page.keyboard.press("End"); assert.equal(await focused(longMenu.getByRole("menuitem").last()), true);
  await eventually(() => longMenu.getByRole("menuitem").last().evaluate(element => {
    const bounds = element.getBoundingClientRect(), panel = element.closest("[role='menu']").getBoundingClientRect();
    return bounds.top >= panel.top - 1 && bounds.bottom <= panel.bottom + 1 && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  }), "keyboard End scrolls the last menu item into the panel viewport", 2500);
  await page.keyboard.press("Escape"); await control({ long: false });
  passed("menus stay attached and inside top/bottom/right viewport edges; long lists scroll and reveal keyboard-focused commands");

  await control({ captureReady: false }); await button("视频工具").hover(); await menu("视频工具").waitFor();
  const disabledSecond = menu("视频工具").getByRole("menuitem").nth(1);
  const disabledStyleBefore = await disabledSecond.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, icon: getComputedStyle(element.querySelector("svg")).color }));
  await disabledSecond.hover(); await settle();
  const disabledStyleAfter = await disabledSecond.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, icon: getComputedStyle(element.querySelector("svg")).color }));
  assert.deepEqual(disabledStyleAfter, disabledStyleBefore, "hover cannot brighten a disabled item or icon");
  for (const name of videoNames) {
    const item = menu("视频工具").getByRole("menuitem", { name, exact: true });
    assert.equal(await item.isDisabled(), true);
    assert.equal(await item.getAttribute("title"), "视频加载完成后可使用");
  }
  await page.keyboard.press("Escape"); await control({ captureReady: true });
  await control({ busy: true });
  assert.equal(await button("视频工具").isDisabled(), true);
  await button("视频工具").hover(); await pause(300);
  assert.equal(await menu("视频工具").count(), 0, "disabled tool triggers never open from hover");
  await control({ busy: false });
  await openTool("视频", "截取当前帧");
  assert.equal((await stats()).captures, 1); assert.equal(await menu("视频工具").count(), 0);
  await eventually(() => focused(button("视频工具")), "capture restores trigger focus");
  passed("unready-video commands explain their disabled state, and capture closes the menu and restores focus");

  await openTool("视频", "裁剪视频");
  const trimDialog = dialog("裁剪视频"); await trimDialog.waitFor();
  await trimDialog.getByRole("slider", { name: "裁剪开始位置", exact: true }).waitFor();
  assert.equal(await trimDialog.getByRole("button", { name: "确认裁剪", exact: true }).count(), 1);
  const trimStartBefore = await trimDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).inputValue();
  await trimDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).fill("4");
  assert.equal(await trimDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).inputValue(), "4");
  await trimDialog.getByRole("slider", { name: "裁剪开始位置", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await trimDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).inputValue(), trimStartBefore);
  await page.keyboard.press("Escape"); await trimDialog.waitFor({ state: "hidden" });
  await openTool("视频", "裁剪视频");
  await dialog("裁剪视频").getByRole("button", { name: "确认裁剪", exact: true }).click();
  await dialog("裁剪视频").getByRole("button", { name: "取消处理", exact: true }).waitFor();
  assert.equal((await stats()).processCalls.at(-1).operation, "trim");
  await dialog("裁剪视频").getByRole("button", { name: "取消处理", exact: true }).click();
  await dialog("裁剪视频").getByRole("alert").waitFor();
  await page.keyboard.press("Escape"); await dialog("裁剪视频").waitFor({ state: "hidden" });
  passed("video trim workspace exposes linked preview controls, timeline handles, keyboard nudging, cancellation, and trim export requests");

  await openTool("视频", "视频压缩");
  const videoDialog = dialog("视频压缩"); await videoDialog.waitFor();
  await snapshot("video-dialog");
  const desktopVideoActions = await videoDialog.locator(".image-tool-actions > button").evaluateAll(buttons => {
    const parent = buttons[0]?.parentElement?.getBoundingClientRect();
    return { parent: { left: parent.left, right: parent.right }, buttons: buttons.map(button => { const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }) };
  });
  assert.ok(desktopVideoActions.buttons.every(button => button.left >= desktopVideoActions.parent.left - 1 && button.right <= desktopVideoActions.parent.right + 1));
  assert.equal(new Set(desktopVideoActions.buttons.map(button => button.top)).size, 1, "desktop video actions stay on one row");
  await eventually(() => focused(videoDialog.getByRole("spinbutton", { name: "开始时间", exact: true })), "video dialog focuses first editable control");
  const videoFocusables = videoDialog.locator("button:not(:disabled),input:not(:disabled),select:not(:disabled)");
  await videoFocusables.last().focus(); await page.keyboard.press("Tab"); assert.equal(await focused(videoFocusables.first()), true);
  await page.keyboard.press("Shift+Tab"); assert.equal(await focused(videoFocusables.last()), true);
  await videoDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).fill("4");
  await videoDialog.getByRole("combobox", { name: "最大宽度", exact: true }).selectOption("480");
  await videoDialog.getByRole("button", { name: "重置", exact: true }).click();
  assert.equal(await videoDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).inputValue(), "0");
  assert.equal(await videoDialog.getByRole("combobox", { name: "最大宽度", exact: true }).inputValue(), "720");
  await page.keyboard.press("Escape"); await videoDialog.waitFor({ state: "hidden" });
  await openTool("视频", "视频压缩"); await page.mouse.click(20, 20); await videoDialog.waitFor({ state: "hidden" });
  await openTool("视频", "视频压缩");
  await videoDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).fill("4");
  await videoDialog.getByRole("combobox", { name: "最大宽度", exact: true }).selectOption("480");
  await videoDialog.getByRole("button", { name: "开始处理", exact: true }).click();
  await videoDialog.getByRole("button", { name: "取消处理", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await page.mouse.click(20, 20);
  assert.equal(await videoDialog.isVisible(), true, "busy processing cannot be dismissed by Escape or backdrop");
  await videoDialog.getByRole("button", { name: "取消处理", exact: true }).click();
  await videoDialog.getByRole("alert").waitFor();
  assert.equal(await videoDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).inputValue(), "4");
  assert.equal(await videoDialog.getByRole("combobox", { name: "最大宽度", exact: true }).inputValue(), "480");
  await videoDialog.getByRole("button", { name: "重试处理", exact: true }).click();
  await videoDialog.getByRole("button", { name: "取消处理", exact: true }).waitFor();
  await control({ busy: false, error: "编码失败：测试错误" });
  await videoDialog.getByRole("alert").waitFor();
  assert.equal(await videoDialog.getByRole("spinbutton", { name: "开始时间", exact: true }).inputValue(), "4");
  assert.equal(await videoDialog.getByRole("combobox", { name: "最大宽度", exact: true }).inputValue(), "480");
  assert.equal((await stats()).processCalls.length, 2);
  await videoDialog.getByRole("button", { name: "重置", exact: true }).click();
  assert.equal(await videoDialog.getByRole("alert").count(), 0);
  assert.equal(await videoDialog.getByRole("combobox", { name: "最大宽度", exact: true }).inputValue(), "720");
  await page.keyboard.press("Escape");
  passed("video dialogs focus and trap controls, close by Escape/backdrop, protect active work, and preserve/retry/reset cancelled or failed parameters");

  const beforeResolve = (await stats()).resolveCalls;
  await openTool("图片", "裁剪 / 压缩 / 镜像");
  const imageDialog = page.getByRole("dialog"); await imageDialog.waitFor();
  await eventually(() => focused(imageDialog.getByRole("spinbutton", { name: "左", exact: true })), "image dialog focuses crop control");
  await imageDialog.locator(".image-tool-source").waitFor();
  assert.equal(await imageDialog.locator(".image-tool-source").evaluate(element => element.naturalWidth), 1200);
  for (let tick = 1; tick <= 4; tick++) await control({ tick });
  await pause(100);
  assert.equal((await stats()).resolveCalls - beforeResolve, 1, "inline resolver identity changes do not restart original loading");
  assert.equal(await imageDialog.getByRole("tab").count(), 3);
  await imageDialog.getByRole("spinbutton", { name: "左", exact: true }).fill("20");
  await imageDialog.getByRole("button", { name: "重置", exact: true }).click();
  assert.equal(await imageDialog.getByRole("spinbutton", { name: "左", exact: true }).inputValue(), "5");
  await snapshot("image-dialog");
  const desktopImageActions = await imageDialog.locator(".image-tool-actions > button").evaluateAll(buttons => {
    const parent = buttons[0]?.parentElement?.getBoundingClientRect();
    return { parent: { left: parent.left, right: parent.right }, buttons: buttons.map(button => { const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }) };
  });
  assert.ok(desktopImageActions.buttons.every(button => button.left >= desktopImageActions.parent.left - 1 && button.right <= desktopImageActions.parent.right + 1));
  assert.equal(new Set(desktopImageActions.buttons.map(button => button.top)).size, 1, "desktop image actions stay on one row");
  await imageDialog.getByRole("tab", { name: "裁剪", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await imageDialog.getByRole("tab", { name: "压缩", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("End");
  assert.equal(await imageDialog.getByRole("tab", { name: "镜像", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal((await stats()).resolveCalls - beforeResolve, 1, "switching basic-operation tabs reuses the resolved original");
  const imageFocusables = imageDialog.locator("button:not(:disabled):not([tabindex='-1']),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)");
  await imageFocusables.last().focus(); await page.keyboard.press("Tab"); assert.equal(await focused(imageFocusables.first()), true);
  await page.keyboard.press("Shift+Tab"); assert.equal(await focused(imageFocusables.last()), true);
  await imageDialog.getByRole("button", { name: "生成派生图片", exact: true }).click();
  await imageDialog.waitFor({ state: "hidden" });
  const imageStats = await stats();
  assert.equal(imageStats.outputs.length, 1); assert.equal(imageStats.outputs[0].operationId, "mirror");
  assert.equal(imageStats.outputs[0].width, 1200); assert.equal(imageStats.outputs[0].height, 800);
  assert.equal(imageStats.resolveCalls - beforeResolve, 1, "applying reuses the source already loaded for editing");
  await eventually(() => focused(button("图片工具")), "image apply restores trigger focus");
  passed("image basics share accessible tabs, focus editable controls, resolve the original only once across rerenders/tabs/apply, reset parameters, and generate original-resolution output");

  await control({ sourceFailures: 1 });
  await openTool("图片", "图片调整");
  await imageDialog.getByRole("alert").waitFor();
  assert.match(await imageDialog.getByRole("alert").textContent(), /原图加载失败/);
  await imageDialog.getByRole("button", { name: "重试加载", exact: true }).click();
  await imageDialog.locator(".image-tool-source").waitFor();
  assert.equal(await imageDialog.locator(".image-tool-source").evaluate(element => element.naturalWidth), 1200);
  assert.equal((await stats()).resolveCalls - imageStats.resolveCalls, 2);
  await page.keyboard.press("Escape"); await imageDialog.waitFor({ state: "hidden" });
  await openTool("图片", "宫格裁剪"); await page.mouse.click(20, 20); await imageDialog.waitFor({ state: "hidden" });
  passed("original-source failures remain visible and retryable; image Escape and backdrop dismissal both return to the canvas");

  // Hold only the apply-time browser decode so busy keyboard/backdrop behavior
  // can be verified deterministically without making processing artificially
  // expensive or changing production component behavior.
  await openTool("图片", "裁剪 / 压缩 / 镜像");
  await imageDialog.locator(".image-tool-source").waitFor();
  await page.evaluate(() => {
    window.__mediaToolsNativeImage = window.Image;
    window.Image = class extends window.__mediaToolsNativeImage {
      set onload(callback) { super.onload = event => new Promise(resolve => { window.__mediaToolsReleaseImageDecode = resolve; }).then(() => callback?.call(this, event)); }
      get onload() { return super.onload; }
    };
  });
  await imageDialog.getByRole("button", { name: "生成派生图片", exact: true }).click();
  await page.waitForFunction(() => typeof window.__mediaToolsReleaseImageDecode === "function");
  assert.equal(await imageDialog.getAttribute("aria-busy"), "true");
  await page.keyboard.press("Tab");
  assert.equal(await imageDialog.evaluate(element => element.contains(document.activeElement)), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await imageDialog.evaluate(element => element.contains(document.activeElement)), true);
  await page.keyboard.press("Escape"); await page.mouse.click(20, 20);
  assert.equal(await imageDialog.isVisible(), true);
  assert.equal(await imageDialog.getByRole("button", { name: "关闭图片工具", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.Image = window.__mediaToolsNativeImage; window.__mediaToolsReleaseImageDecode(); });
  await imageDialog.waitFor({ state: "hidden" });
  const busyOutput = (await stats()).outputs.at(-1);
  assert.equal(busyOutput.operationId, "crop"); assert.equal(busyOutput.width, 1080); assert.equal(busyOutput.height, 720);
  passed("busy image processing keeps focus inside the dialog, disables dismiss actions, and completes with original-resolution crop output");

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const touchPage = await touchContext.newPage();
  await mount(touchPage);
  await touchPage.evaluate(() => window.mediaToolsFixture.update({ position: "top" }));
  const touchImageTrigger = touchPage.getByRole("button", { name: "图片工具", exact: true });
  const touchVideoTrigger = touchPage.getByRole("button", { name: "视频工具", exact: true });
  const touchImageMenu = touchPage.getByRole("menu", { name: "图片工具菜单", exact: true });
  const touchVideoMenu = touchPage.getByRole("menu", { name: "视频工具菜单", exact: true });
  await touchImageTrigger.tap(); await touchImageMenu.waitFor();
  await pause(400); assert.equal(await touchImageMenu.isVisible(), true, "touch menus stay open until an explicit action");
  await touchImageTrigger.tap(); await touchImageMenu.waitFor({ state: "hidden" });
  await touchImageTrigger.tap(); await touchImageMenu.waitFor();
  await touchVideoTrigger.tap(); await touchVideoMenu.waitFor();
  assert.equal(await touchImageMenu.count(), 0, "touch menus are mutually exclusive");
  await touchPage.touchscreen.tap(15, 750); await touchVideoMenu.waitFor({ state: "hidden" });
  await touchContext.close();
  passed("touch devices retain tap-to-toggle menus, mutual exclusion, and outside-tap dismissal without relying on hover");

  await page.setViewportSize({ width: 390, height: 844 });
  await control({ position: "top" });
  await button("视频工具").hover(); await menu("视频工具").waitFor();
  const mobileVideoBox = await menu("视频工具").boundingBox();
  assert.ok(mobileVideoBox.x >= 7 && mobileVideoBox.y >= 7 && mobileVideoBox.x + mobileVideoBox.width <= 383 && mobileVideoBox.y + mobileVideoBox.height <= 837);
  await snapshot("mobile-video-menu"); await page.keyboard.press("Escape");
  await openTool("图片", "裁剪 / 压缩 / 镜像");
  await imageDialog.locator(".image-tool-source").waitFor();
  const mobileImageBox = await imageDialog.boundingBox();
  assert.ok(mobileImageBox.x >= 0 && mobileImageBox.y >= 0 && mobileImageBox.x + mobileImageBox.width <= 390 && mobileImageBox.y + mobileImageBox.height <= 844);
  assert.equal(await imageDialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "mobile image settings never overflow horizontally");
  const mobileImageActions = await imageDialog.locator(".image-tool-actions > button").evaluateAll(buttons => {
    const parent = buttons[0]?.parentElement?.getBoundingClientRect();
    return { parent: { left: parent.left, right: parent.right }, buttons: buttons.map(button => { const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }) };
  });
  assert.ok(mobileImageActions.buttons.every(button => button.left >= mobileImageActions.parent.left - 1 && button.right <= mobileImageActions.parent.right + 1));
  assert.equal(new Set(mobileImageActions.buttons.map(button => button.top)).size, 1, "mobile image actions stay on one row");
  const mobileGrid = await imageDialog.locator(".image-tool-workspace").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  assert.equal(mobileGrid, 1);
  await snapshot("mobile-image-dialog");
  await page.keyboard.press("Escape"); await imageDialog.waitFor({ state: "hidden" });
  measurements.mobile = { videoMenu: mobileVideoBox, imageDialog: mobileImageBox };
  passed("390px mobile menu and image dialog stay within the viewport with stacked image settings and no horizontal overflow");

  assert.deepEqual(errors, [], "no browser runtime errors");
  assert.deepEqual(unexpectedNetworks, [], "no non-loopback network requests");
  assert.deepEqual(consoleErrors, [], "no browser console errors");
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) {
    measurements.failureState = await page.evaluate(() => ({ active: document.activeElement?.outerHTML?.slice(0, 240), imageTrigger: (() => { const element = document.querySelector(".image-tools-trigger"); return element && { disabled: element.disabled, expanded: element.getAttribute("aria-expanded"), connected: element.isConnected }; })(), dialogs: [...document.querySelectorAll("[role='dialog']")].map(element => ({ name: element.getAttribute("aria-label"), busy: element.getAttribute("aria-busy") })) })).catch(() => null);
    await snapshot("failure").catch(() => {});
  }
} finally {
  measurements.checks = checks.length;
  await writeFile(`${artifacts}media-tools-results.json`, JSON.stringify({ passed: !failure, checks, measurements, errors, consoleErrors, unexpectedNetworks, ...(failure ? { failure: failure.stack || String(failure), fixtureOutput: fixtureOutput.slice(-8000) } : {}) }, null, 2));
  await browser?.close().catch(() => {});
  fixture.kill("SIGTERM");
  if (fixture.exitCode === null && fixture.signalCode === null) await Promise.race([new Promise(resolve => fixture.once("exit", resolve)), pause(5000)]);
  if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill("SIGKILL");
}
if (failure) throw failure;
console.log(`PASS ${checks.length} media tool interaction groups; screenshots: ${artifacts}media-tools-*.png`);
