/** Automatic task closure regression on disposable loopback ports 5211/5212.
 * No supplier calls. CANVAS_PLAYWRIGHT_MODULE may name an installed Playwright.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5211", api = "http://127.0.0.1:5212";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5211", "--api-port=5212"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser, context, page;
const errors = [], checks = [];
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Fixture startup timeout")), 30000);
  fixture.stdout.on("data", chunk => { output += chunk; if (output.includes('"event":"ready"')) { clearTimeout(timeout); resolve(); } });
  fixture.stderr.on("data", chunk => { output += chunk; });
  fixture.once("error", error => { clearTimeout(timeout); reject(error); });
  fixture.once("exit", code => { clearTimeout(timeout); reject(new Error("Fixture exited " + code + ": " + output)); });
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const control = async value => {
  const response = await fetch(api + "/__fixture/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.equal(response.status, 200);
};
const state = async () => (await fetch(api + "/__fixture/state")).json();
const eventually = async (check, message, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(100); }
  throw new Error("Timed out: " + message);
};
const passed = message => { checks.push(message); console.log("PASS " + message); };
const posts = state => state.requests.filter(r => r.path === "/v1/videos" && r.method === "POST");
const reads = state => state.requests.filter(r => /^\/v1\/videos\/[^/]+$/.test(r.path) && r.path !== "/v1/videos/models");
const noTaskPanel = async () => {
  assert.equal(await page.getByRole("complementary", { name: "生成状态", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^(查看任务|恢复原提交|继续查询原任务|暂停查询)$/ }).count(), 0);
};
async function makeCase(name, { frozen = false, missingImages = false, accepted = false, mode = "in_progress", ...settings } = {}) {
  await context?.close();
  const canvasId = "closure-" + name, taskId = "video-" + name;
  const key = "canvas:doc:v1:" + canvasId, now = new Date().toISOString();
  const submission = { key: "original-" + name, model: "fixture-video-public", prompt: "镜头缓慢掠过海面。", images: missingImages ? [{ localImage: "missing-original-reference" }] : [], duration: 6, resolution: "1080p", aspect_ratio: "9:16", generate_audio: false };
  const node = { id: "task-node", type: "prompt", mediaType: "video", title: "视频创作", text: submission.prompt, taskPrompt: submission.prompt, modelId: submission.model,
    x: 300, y: 200, width: 420, height: 260, color: "#77bbcc", status: "queued",
    ...(frozen ? { videoSubmission: submission, videoPollingPaused: true, videoPollingReason: "user" } : { taskId }) };
  await control({ reset: true, storage: { [key]: { id: canvasId, name, createdAt: now, updatedAt: now, nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } },
    videoTasks: frozen && !accepted ? [] : [{ id: taskId, ...(accepted ? { key: submission.key } : {}) }], videoMode: mode, ...settings });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/#/canvas/" + canvasId);
  await page.locator('[data-node-id="task-node"]').waitFor({ state: "attached" });
  return { taskId, submission, node: async () => page.evaluate(async id => {
    // A missing local reference intentionally blocks cloud synchronization.
    // Observe the committed local draft, rather than mistaking an older cloud
    // copy for the live node's generation state.
    const { getCanvas } = await import('/src/library-store.ts');
    const document = await getCanvas(id);
    return document?.nodes.find(node => node.id === 'task-node');
  }, canvasId) };
}
try {
  await ready;
  browser = await chromium.launch({ headless: true, timeout: 90000, args: ["--disable-gpu"], ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  const missingAccepted = await makeCase("missing-accepted", { frozen: true, missingImages: true, accepted: true, mode: "completed" });
  await eventually(async () => (await missingAccepted.node())?.status === "completed", "recover accepted task without original image bytes");
  assert.equal((await missingAccepted.node()).taskId, missingAccepted.taskId);
  assert.equal(posts(await state()).length, 0);
  await noTaskPanel();
  passed("missing local images do not block recovering an already accepted task by its original key");

  const missing = await makeCase("missing-unaccepted", { frozen: true, missingImages: true });
  await eventually(async () => (await missing.node())?.status === "failed", "missing input stops local waiting after confirmed lookup miss");
  assert.equal((await missing.node()).videoSubmission.key, missing.submission.key);
  assert.equal((await missing.node()).taskDiagnostic.code, "VIDEO_SUBMISSION_INPUT_MISSING");
  assert.equal((await missing.node()).taskId, undefined);
  assert.equal(posts(await state()).length, 0);
  const missingLookups = (await state()).requests.filter(r => r.path.includes("by-idempotency-key")).length;
  await pause(4000);
  assert.equal((await state()).requests.filter(r => r.path.includes("by-idempotency-key")).length, missingLookups);
  await noTaskPanel();
  passed("missing inputs surface a local failure and retain the original identity without repeatedly querying or submitting");

  const missingUnauthorized = await makeCase("missing-reauthorize", { frozen: true, missingImages: true, accepted: true, mode: "unauthorized" });
  const lookupGate = page.locator("dialog.platform-gate-overlay");
  await lookupGate.waitFor();
  assert.notEqual((await missingUnauthorized.node())?.status, "failed");
  await control({ videoMode: "completed" });
  await lookupGate.getByRole("button", { name: /^(登录并进入画布|重新登录)$/ }).click();
  await eventually(async () => (await missingUnauthorized.node())?.status === "completed", "original frozen lookup resumes after reauthorization");
  assert.equal((await missingUnauthorized.node()).taskId, missingUnauthorized.taskId);
  assert.equal(posts(await state()).length, 0);
  passed("lookup reauthorization preserves the frozen identity and resumes without creating a task");

  const lost = await makeCase("lost-response", { frozen: true, mode: "read-failure", videoLostResponsesRemaining: 1 });
  // Stay unavailable past three complete read windows, then recover automatically.
  await eventually(async () => reads(await state()).length > 15, "automatic recovery continues beyond three windows", 150000);
  await noTaskPanel();
  const before = await state();
  assert.equal(Object.keys(before.videoTasks).length, 1);
  assert.equal(posts(before).length, 1);
  assert.equal(posts(before)[0].idempotencyKey, lost.submission.key);
  assert.notEqual((await lost.node()).status, "failed");
  await control({ videoMode: "completed" });
  await eventually(async () => (await lost.node())?.status === "completed", "automatic completion after prolonged outage", 45000);
  assert.equal(posts(await state()).length, 1);
  await page.screenshot({ path: artifacts + "task-closure-success.png" });
  passed("lost response and prolonged read failures recover automatically with one durable task");

  const accepted = await makeCase("accepted-error", { frozen: true, videoCreateError: true, mode: "completed" });
  await eventually(async () => (await accepted.node())?.status === "completed", "accepted create error is observed to completion");
  assert.equal(posts(await state()).length, 1);
  passed("a create 503 containing task_id saves the identity and continues with GET only");

  const unauthorized = await makeCase("reauthorize", { mode: "unauthorized" });
  const gate = page.locator("dialog.platform-gate-overlay");
  await gate.waitFor();
  await control({ videoMode: "completed" });
  await gate.getByRole("button", { name: /^(登录并进入画布|重新登录)$/ }).click();
  await eventually(async () => (await unauthorized.node())?.status === "completed", "reauthorization resumes original task");
  assert.equal(posts(await state()).length, 0);
  assert.equal((await unauthorized.node()).taskId, unauthorized.taskId);
  passed("login recovery preserves the original task without submitting generation");

  const cancelled = await makeCase("cancel-pending", { mode: "cancel_pending" });
  await eventually(async () => reads(await state()).length >= 2, "pending cancellation stays observable");
  assert.notEqual((await cancelled.node()).status, "failed");
  await control({ videoMode: "completed" });
  await eventually(async () => (await cancelled.node())?.status === "completed", "unconfirmed cancellation can still complete");
  assert.equal(posts(await state()).length, 0);
  passed("cancel_pending remains processing until the backend supplies a terminal result");

  const failed = await makeCase("failed", { mode: "failed" });
  await eventually(async () => (await failed.node())?.status === "failed", "server-confirmed failure");
  await noTaskPanel();
  const readCount = reads(await state()).length;
  await pause(4000);
  assert.equal(reads(await state()).length, readCount);
  assert.equal(posts(await state()).length, 0);
  await page.screenshot({ path: artifacts + "task-closure-failed.png" });
  passed("server-confirmed failure stops observation and exposes no recovery panel");
  assert.deepEqual(errors, []);
  await writeFile(artifacts + "task-recovery-result.json", JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await writeFile(artifacts + "task-recovery-fixture.log", output);
  await writeFile(artifacts + "task-recovery-fixture-state.json", JSON.stringify(await state().catch(() => null), null, 2));
  const body = await Promise.race([page?.locator('body').innerText({ timeout: 3000 }).catch(() => ''), pause(4000).then(() => '')]);
  await writeFile(artifacts + "task-recovery-failure.txt", body || '');
  await page?.screenshot({ path: artifacts + "task-recovery-failure.png", timeout: 3000 }).catch(() => {});
  await writeFile(artifacts + "task-recovery-result.json", JSON.stringify({ passed: false, error: String(error), checks, errors }, null, 2));
  throw error;
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
  await Promise.race([new Promise(resolve => fixture.once("exit", resolve)), pause(5000)]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
