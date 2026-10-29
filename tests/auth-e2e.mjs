/** Gateway-only Canvas admission regression against a disposable fixture.
 *
 * The browser receives an `ast_*` App Session through the same sessionStorage
 * handoff used by the Portal. It never calls a browser `/auth/*` relay or a
 * platform runtime endpoint. `?fixture_session=none` exercises the closed
 * state when a handoff is missing.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../", import.meta.url).pathname;
const base = "http://127.0.0.1:5199";
const api = "http://127.0.0.1:5200";
const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", "--port=5199", "--api-port=5200"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Gateway fixture did not become ready: ${output}`)), 20000);
  const onData = (chunk) => {
    output += String(chunk);
    if (output.includes('"event":"ready"')) {
      clearTimeout(timer);
      resolve();
    }
  };
  fixture.stdout.on("data", onData);
  fixture.stderr.on("data", onData);
  fixture.once("error", (error) => { clearTimeout(timer); reject(error); });
  fixture.once("exit", (code) => {
    clearTimeout(timer);
    if (code !== 0) reject(new Error(`Gateway fixture exited ${code}: ${output}`));
  });
});

const forbiddenPath = /(?:^|\/)(?:auth|__platform)(?:\/|$)|(?:^|\/)api\/(?:portal|app-runtime|admin|market)(?:\/|$)|(?:^|\/)bridge(?:\/|$)/i;
const canvas = (page) => page.locator('[aria-label="无限创作画布"]');
const gate = (page) => page.locator("dialog.platform-gate-overlay");

async function eventually(check, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function runCase(browser, withSession) {
  await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: true }),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const requests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname, url: request.url() });
  });
  await page.goto(`${base}/${withSession ? "" : "?fixture_session=none"}`);
  if (withSession) await canvas(page).waitFor();
  else await gate(page).waitFor();
  return { context, page, requests };
}

try {
  await ready;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  try {
    const missing = await runCase(browser, false);
    try {
      assert.equal(await canvas(missing.page).count(), 0, "Canvas stays blocked without an App Session handoff");
      assert.equal(missing.requests.filter((request) => request.path.startsWith("/v1/")).length, 0, "missing handoff makes no Gateway request");
      assert.equal(missing.requests.some((request) => forbiddenPath.test(request.path)), false, "missing handoff makes no control-plane request");
      assert.equal(await missing.page.getByRole("button", { name: /登录并进入画布|重新登录/ }).count(), 0, "web Canvas does not expose a browser login action");
      console.log("PASS missing App Session stays closed without auth or runtime requests");
    } finally {
      await missing.context.close();
    }

    const authenticated = await runCase(browser, true);
    try {
      const profile = authenticated.requests.filter((request) => request.path === "/v1/profile");
      assert.equal(profile.length, 1, "startup validates the handoff once through Gateway /v1/profile");
      await eventually(() => authenticated.requests.some((request) => request.path === "/v1/images/models"), "models load through Gateway");
      assert.ok(authenticated.requests.some((request) => request.path === "/v1/images/models"), "models load through Gateway");
      assert.ok(authenticated.requests.some((request) => request.path === "/v1/storage/keys"), "cloud storage loads through Gateway");
      assert.equal(authenticated.requests.some((request) => forbiddenPath.test(request.path)), false, "authenticated Canvas makes no control-plane request");
      assert.equal(await authenticated.page.evaluate(() => location.href.includes("ast_")), false, "App Session never enters the URL");
      assert.equal(await authenticated.page.evaluate(() => sessionStorage.getItem("proxy-app:gateway-session:canvas")?.startsWith("{\"access_token\":\"ast_")), true, "Portal handoff is scoped to sessionStorage");
      const beforeReload = authenticated.requests.length;
      await authenticated.page.reload();
      await canvas(authenticated.page).waitFor();
      assert.ok(authenticated.requests.slice(beforeReload).some((request) => request.path === "/v1/profile"), "reload revalidates through Gateway");
      assert.equal(authenticated.requests.some((request) => forbiddenPath.test(request.path)), false, "reload still stays on the Gateway data plane");
      console.log("PASS handed-off App Session validates and serves Canvas only through Gateway /v1");
    } finally {
      await authenticated.context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  if (fixture.exitCode === null) fixture.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => fixture.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
