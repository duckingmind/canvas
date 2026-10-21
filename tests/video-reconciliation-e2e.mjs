/** Video reconciliation closure regression using a disposable loopback fixture.
 * CANVAS_PLAYWRIGHT_MODULE can point to an already installed Playwright module.
 * No production account, supplier endpoint or media generation is used.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5271", api = "http://127.0.0.1:5272";
const canvasId = "video-reconciliation-regression", taskId = "closed-video-task";
const privatePrompt = "PRIVATE_PROMPT_7491 镜头缓慢掠过湖面，保持角色一致。";
const privateReference = `${base}/v1/fixture-image.png?private-reference=9273`;
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5271", "--api-port=5272"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "", browser, page;
const errors = [], unexpectedNetworks = [], taskReads = [], submissions = [], checks = [];
let reconciled = false, failNextRead = false;
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Reconciliation fixture timeout: ${fixtureOutput}`)), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += String(chunk);
    if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timer); resolve(); }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += String(chunk); });
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { clearTimeout(timer); if (code) reject(new Error(`Reconciliation fixture exited ${code}: ${fixtureOutput}`)); });
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventually = async (check, message) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await pause(50); }
  throw new Error(`Timed out: ${message}`);
};
const passed = message => { checks.push(message); console.log(`PASS ${message}`); };
const projection = (resolved) => ({
  id: taskId, object: "video", model: "fixture-video-public", status: "failed", task_status: "failed", phase: "failed",
  request_id: "original-request-closed", execution_mode: "async", asset_status: "none", asset_count: 0,
  reconciliation_state: resolved ? "resolved" : "closed",
  supplier_confirmation: {
    state: resolved ? "confirmed" : "unconfirmed_after_timeout", status: resolved ? "failed" : "unknown",
    source: resolved ? "manual_evidence" : "platform", reason: resolved ? "provider confirmed no task was created" : "platform deadline reached",
  },
  error: { code: resolved ? "unknown_reconciled" : "unknown_resolution_expired", message: resolved ? "provider confirmed no task was created" : "upstream media result could not be reconciled before the task deadline" },
});

try {
  await ready;
  const now = new Date().toISOString();
  const doc = {
    id: canvasId, name: "视频核查闭环回归", createdAt: now, updatedAt: now,
    nodes: [
      { id: "source-text", type: "note", title: "动作描述", text: privatePrompt, x: 140, y: 90, width: 270, height: 140, color: "#aac4a0" },
      { id: "source-image-1", type: "image", title: "参考图片一", text: "", image: privateReference, x: 150, y: 300, width: 150, height: 135, color: "#9ba9c5" },
      { id: "source-image-2", type: "image", title: "参考图片二", text: "", image: `${privateReference}&version=2`, x: 330, y: 315, width: 150, height: 135, color: "#9ba9c5" },
      {
        id: "task-node", type: "prompt", mediaType: "video", title: "视频创作", text: "", taskPrompt: privatePrompt,
        x: 620, y: 120, width: 420, height: 260, color: "#77bbcc", modelId: "fixture-video-public",
        taskId, status: "failed", error: projection(false).error.message,
        taskDiagnostic: {
          status: "failed", code: "unknown_resolution_expired", requestId: "original-request-closed", phase: "failed", assetStatus: "none", createdAt: now,
          summary: { model: "fixture-video-public", reference_count: 2, duration: 6, resolution: "1080p", aspect_ratio: "9:16" },
          supplierConfirmation: { state: "unconfirmed_after_timeout", status: "unknown", source: "platform" },
        },
      },
    ],
    edges: [
      { id: "text-edge", from: "source-text", to: "task-node" },
      { id: "image-edge-1", from: "source-image-1", to: "task-node" },
      { id: "image-edge-2", from: "source-image-2", to: "task-node" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const seeded = await fetch(`${api}/__fixture/control`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: true, storage: { [`canvas:doc:v1:${canvasId}`]: doc } }),
  });
  assert.equal(seeded.status, 200);
  browser = await chromium.launch({ headless: true, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      unexpectedNetworks.push(url.origin);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await page.route("**/v1/estimates", route => route.fulfill({ json: { known: false, amount: null, currency: "USD" } }));
  await page.route("**/v1/videos/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/videos/models") return route.continue();
    taskReads.push({ path: url.pathname, method: route.request().method() });
    assert.equal(route.request().method(), "GET", "status refresh must be read-only");
    if (url.pathname === `/v1/videos/${taskId}`) {
      if (failNextRead) {
        failNextRead = false;
        return route.fulfill({ status: 503, json: { error: { code: "fixture_status_unavailable", message: "Disposable task observation is temporarily unavailable." } } });
      }
      return route.fulfill({ json: projection(reconciled) });
    }
    assert.equal(url.pathname, "/v1/videos/explicit-retry-task");
    return route.fulfill({ json: {
      id: "explicit-retry-task", status: "failed", task_status: "failed", phase: "failed", asset_status: "none", asset_count: 0,
      supplier_confirmation: { state: "confirmed", status: "failed", source: "provider" },
      error: { code: "provider_rejected_request", message: "Disposable fixture deliberately ends the retry." },
    } });
  });
  await page.route("**/v1/videos", async route => {
    assert.equal(route.request().method(), "POST");
    submissions.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    return route.fulfill({ status: 202, json: { id: "explicit-retry-task", status: "in_progress", task_status: "queued", phase: "queued", asset_status: "pending", asset_count: 0 } });
  });
  await page.goto(`${base}/#/canvas/${canvasId}`);
  const target = page.locator('[data-node-id="task-node"]');
  await target.locator(".creation-failure-summary").waitFor();
  const collapse = page.getByRole("button", { name: "收起画布列表", exact: true }).first();
  if (await collapse.isVisible()) await collapse.click();
  const editor = page.getByRole("complementary", { name: "视频创作", exact: true });
  const generate = editor.getByRole("button", { name: "生成视频", exact: true });
  const originalTaskRead = { path: `/v1/videos/${taskId}`, method: "GET" };
  const technicalText = /供应商|核查|刷新任务状态|复制任务信息|原提交|任务\s*ID|task[_ -]?id|unknown_resolution_expired|creation_result_unknown|closed-video-task|original-request-closed|upstream media/i;
  const assertSimpleFailure = async () => {
    assert.equal(await target.locator(".creation-placeholder.is-failed").count(), 1);
    assert.equal(await target.locator(".creation-error").count(), 0);
    assert.equal(await target.locator(".creation-failure-actions").count(), 0);
    assert.match(await target.innerText(), /视频生成失败/);
    assert.match(await target.innerText(), /生成超时/);
    assert.doesNotMatch(await target.innerText(), /准备生成/);
    for (const surface of [target, ...(await editor.isVisible() ? [editor] : [])]) {
      assert.doesNotMatch(await surface.innerText(), technicalText);
      const hints = await surface.locator("[title], [aria-label]").evaluateAll(elements => elements
        .map(element => `${element.getAttribute("title") || ""} ${element.getAttribute("aria-label") || ""}`).join("\n"));
      assert.doesNotMatch(hints, technicalText, "technical task details must not return through tooltips or accessible labels");
    }
  };
  const openCreator = async () => {
    await target.dblclick({ position: { x: 180, y: 22 } });
    await editor.waitFor();
  };
  const closeCreator = async () => {
    await editor.getByRole("button", { name: "关闭视频创作", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
  };
  await assertSimpleFailure();
  await pause(2500);
  assert.deepEqual(taskReads, [], "a closed task must stay idle before the creator is opened");
  assert.deepEqual(submissions, [], "closed reconciliation must not resubmit");
  await page.evaluate(() => {
    window.__videoTaskNotices = [];
    new MutationObserver(() => {
      for (const notice of document.querySelectorAll(".toast")) {
        const text = notice.textContent?.trim();
        if (text && window.__videoTaskNotices.at(-1) !== text) window.__videoTaskNotices.push(text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const assertNoNotices = async () => {
    assert.deepEqual(await page.evaluate(() => window.__videoTaskNotices), [], "background task observation must stay silent");
    assert.equal(await page.locator(".toast").count(), 0);
  };
  await openCreator();
  await eventually(() => taskReads.length === 1, "opening the creator reads the original task once");
  assert.equal(await generate.isDisabled(), true);
  assert.equal(await page.getByLabel("视频创作描述", { exact: true }).inputValue(), "");
  await assertSimpleFailure();
  // Longer than the reconciliation poll interval: this failed task gets an
  // observation only when the creator opens, never a recurring polling loop.
  await pause(17000);
  assert.deepEqual(taskReads, [originalTaskRead]);
  assert.deepEqual(submissions, []);
  await assertNoNotices();
  passed("closed failure shows only failure and timeout, silently reads once on open and keeps retry disabled without polling");

  const checkLayout = async label => {
    const layout = await target.evaluate(node => {
      const box = node.getBoundingClientRect(), notice = node.querySelector(".creation-placeholder.is-failed");
      const summary = node.querySelector(".creation-failure-summary").getBoundingClientRect();
      return {
        width: parseFloat(getComputedStyle(node).width), height: parseFloat(getComputedStyle(node).height),
        horizontalOverflow: notice.scrollWidth > notice.clientWidth + 1,
        summaryInside: summary.left >= box.left && summary.right <= box.right && summary.top >= box.top && summary.bottom <= box.bottom,
      };
    });
    assert.deepEqual(layout, { width: 420, height: 260, horizontalOverflow: false, summaryInside: true }, label);
  };
  await checkLayout("simple failure at 420x260");
  await page.screenshot({ path: `${artifacts}/video-reconciliation-closed.png` });
  await target.screenshot({ path: `${artifacts}/video-reconciliation-simple-failure.png` });
  passed("420x260 failure node contains one short summary and exposes no operator controls or technical fields");

  await closeCreator();
  failNextRead = true;
  await openCreator();
  await eventually(() => taskReads.length === 2 && !failNextRead, "reopening the creator performs one failing read");
  await pause(2200);
  assert.deepEqual(taskReads, [originalTaskRead, originalTaskRead]);
  assert.equal(submissions.length, 0);
  assert.equal(await generate.isDisabled(), true);
  await assertSimpleFailure();
  await assertNoNotices();
  passed("a silent status read failure preserves the simple failure and disabled retry without a toast or resubmission");

  reconciled = true;
  await closeCreator();
  await openCreator();
  await eventually(async () => taskReads.length === 3 && await generate.isEnabled(), "reopening observes resolved evidence and unlocks retry");
  assert.equal(taskReads.length, 3);
  assert.equal(submissions.length, 0);
  assert.equal(await page.getByLabel("视频创作描述", { exact: true }).inputValue(), "");
  assert.doesNotMatch(await target.innerText(), technicalText);
  assert.doesNotMatch(await editor.innerText(), technicalText);
  await assertNoNotices();
  await page.screenshot({ path: `${artifacts}/video-reconciliation-retry-ready.png` });
  await generate.click();
  await eventually(() => submissions.length === 1 && taskReads.some(item => item.path === "/v1/videos/explicit-retry-task"), "explicit retry reaches only the disposable route");
  assert.equal(submissions[0].body.prompt, privatePrompt);
  assert.equal(submissions[0].body.model, "fixture-video-public");
  assert.equal(submissions[0].body.input_references.length, 2);
  assert.ok(submissions[0].key, "explicit new task must get an idempotency key");
  await eventually(() => generate.isEnabled(), "fixture retry terminal status stops polling");
  assert.equal(submissions.length, 1);
  assert.deepEqual(taskReads, [
    originalTaskRead,
    originalTaskRead,
    originalTaskRead,
    { path: "/v1/videos/explicit-retry-task", method: "GET" },
  ]);
  passed("resolved evidence silently unlocks one explicit retry using connected text while the local textarea stays empty");
  assert.deepEqual(unexpectedNetworks, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, taskReads, posts: submissions.length, artifacts }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${artifacts}/video-reconciliation-failure.png`, timeout: 5000 }).catch(() => {});
    console.error(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  }
  console.error(JSON.stringify({ taskReads, posts: submissions.length, errors, unexpectedNetworks }));
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
  if (fixture.exitCode === null) await Promise.race([new Promise(resolve => fixture.once("exit", resolve)), pause(3000)]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
