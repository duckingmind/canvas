/** Login-first UX regression. Owns disposable fixture ports 5199/5200.
 * No real account, login portal, token, browser profile or paid API is used.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
  process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const base = "http://127.0.0.1:5199";
const api = "http://127.0.0.1:5200";
await mkdir(artifacts, { recursive: true });
const fixture = spawn(
  process.execPath,
  ["tests/platform-fixture.mjs", "--port=5199", "--api-port=5200"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Auth fixture did not become ready")),
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
      reject(new Error(`Auth fixture exited ${code}: ${fixtureOutput}`));
  });
});
let browser;
const cases = [];
const errors = [];
const checks = [];
const button = (page, name) => page.getByRole("button", { name, exact: true });
const gate = (page) => page.locator("dialog.platform-gate-overlay");
const loginButton = (page) =>
  gate(page).getByRole("button", { name: /^(登录并进入画布|重新登录)$/ });
const settings = (page) => page.getByRole("dialog", { name: "自定义画布" });
const creator = (page) => page.getByRole("complementary", { name: "图片创作" });
const canvas = (page) => page.getByLabel("无限创作画布");
const eventually = async (check, description, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
};
const passed = (description) => {
  checks.push(description);
  console.log(`PASS ${description}`);
};
const makeCase = async ({
  authenticated = false,
  runtimeHTML = false,
  statusFailure = false,
  statusResponse,
  models,
  loginResponse,
  blockPopup = false,
  deferLogin = false,
  deferStatus = false,
  viewport = { width: 1440, height: 960 },
} = {}) => {
  const reset = await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: true }),
  });
  assert.equal(reset.status, 200);
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    ({ blockPopup }) => {
      window.__authPopupGestures = [];
      const originalOpen = window.open.bind(window);
      window.open = (...args) => {
        window.__authPopupGestures.push(navigator.userActivation.isActive);
        return blockPopup ? null : originalOpen(...args);
      };
    },
    { blockPopup },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const requests = {
    status: 0,
    start: 0,
    models: 0,
    storage: 0,
    adminRuntime: [],
    popups: 0,
    loginForces: [],
    protected: [],
  };
  let completeLogin = () => {};
  let completeStatus = () => {};
  const pendingLogin = deferLogin
    ? new Promise((resolve) => {
        completeLogin = resolve;
      })
    : Promise.resolve();
  let pendingStatus = deferStatus
    ? new Promise((resolve) => {
        completeStatus = resolve;
      })
    : Promise.resolve();
  const testCase = {
    page,
    context,
    requests,
    completeLogin,
    completeStatus,
    setAuthenticated(value) {
      authenticated = value;
    },
    setStatusFailure(value) {
      statusFailure = value;
    },
    setStatusResponse(value) {
      statusResponse = value;
    },
    deferNextStatus() {
      pendingStatus = new Promise((resolve) => {
        completeStatus = resolve;
      });
      return completeStatus;
    },
  };
  cases.push(testCase);
  context.on("page", () => requests.popups++);
  page.on("pageerror", (error) => errors.push(error.message));
  // Forced reauthorization must exercise the relay's login-details contract,
  // not the cached-auth shortcut. This disposable callback never opens a real
  // Portal or accesses credentials; status polling remains a fallback.
  await context.route("**/__fixture/auth/complete**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><title>Fixture authorization</title><script>
      window.opener?.postMessage({ protocol: "proxy-app/auth/v1", type: "login-complete", state: new URLSearchParams(location.search).get("state") }, location.origin);
      window.close();
    </script>`,
  }));
  await page.route("**/__fixture/auth/status", async (route) => {
    requests.status++;
    await pendingStatus;
    if (statusFailure) return route.abort("failed");
    if (statusResponse)
      return route.fulfill({
        contentType: "application/json",
        ...statusResponse,
      });
    await route.fulfill(
      runtimeHTML
        ? {
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Vite fallback</title>",
          }
        : {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: { authenticated, ...(authenticated ? { account_scope: "acs_" + "f".repeat(64) } : {}) } }),
          },
    );
  });
  await page.route("**/__fixture/auth/start*", async (route) => {
    requests.start++;
    const forceLogin = new URL(route.request().url()).searchParams.get("force_login");
    requests.loginForces.push(forceLogin);
    if (loginResponse)
      return route.fulfill({
        contentType: "application/json",
        ...loginResponse,
      });
    await pendingLogin;
    authenticated = true;
    const state = `fixture-login-${requests.start}`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: forceLogin === "1" ? {
        login_url: `${base}/__fixture/auth/complete?state=${encodeURIComponent(state)}`,
        auth_state: state,
        relay_url: base,
        force_login: true,
      } : { authenticated: true, account_scope: "acs_" + "f".repeat(64) } }),
    });
  });
  await page.route("**/v1/images/models", async (route) => {
    requests.models++;
    if (models)
      await route.fulfill({ contentType: "application/json", ...models });
    else await route.continue();
  });
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/v1/storage/items") requests.storage++;
    if (pathname.startsWith("/api/app-runtime/")) requests.adminRuntime.push(pathname);
    if (pathname.startsWith("/v1/")) requests.protected.push(pathname);
  });
  await page.goto(base);
  if (!deferStatus) {
    if (authenticated && !runtimeHTML && !statusFailure && !statusResponse)
      await canvas(page).waitFor();
    else await gate(page).waitFor();
  }
  return testCase;
};
const openSettings = async (page) => {
  await button(page, "自定义画布").click();
  await settings(page).waitFor();
  await settings(page).getByRole("button", { name: "账户与保存", exact: true }).click();
};
const assertNoImplicitLogin = ({ requests }) => {
  assert.ok(requests.status > 0, "startup reads authentication state");
  assert.equal(
    requests.start,
    0,
    "startup never initiates login without a user gesture",
  );
  assert.equal(requests.popups, 0, "startup never opens a browser login popup");
};
const assertNoWorkspace = async ({ page, requests }) => {
  assert.equal(
    await canvas(page).count(),
    0,
    "editor is not mounted before verified login",
  );
  assert.equal(
    await button(page, "新建画布").count(),
    0,
    "canvas creation is unavailable before login",
  );
  assert.equal(
    await button(page, "创建图片").count(),
    0,
    "image creation is unavailable before login",
  );
  assert.deepEqual(
    requests.protected,
    [],
    "protected requests wait for verified login",
  );
  assert.deepEqual(
    await page.evaluate(async () =>
      (await indexedDB.databases()).map(({ name }) => name),
    ),
    [],
    "startup does not create local canvas storage before login",
  );
};
const assertFocusInGate = async (page) => {
  assert.equal(
    await gate(page).evaluate((dialog) =>
      dialog.contains(document.activeElement),
    ),
    true,
    "keyboard focus remains inside the login dialog",
  );
};

try {
  await ready;
  console.log("READY isolated authentication fixture 5199/5200");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });

  const checking = await makeCase({ deferStatus: true });
  await eventually(
    () => checking.requests.status > 0,
    "startup requests authorization status",
  );
  await checking.page
    .locator(".platform-gate-loading-only")
    .waitFor();
  assert.equal(
    await checking.page.locator(".platform-gate-card").count(),
    0,
    "transient platform checks do not render a second startup card",
  );
  await assertNoWorkspace(checking);
  assertNoImplicitLogin(checking);
  checking.completeStatus();
  await gate(checking.page).waitFor();
  await loginButton(checking.page).waitFor();
  passed(
    "pending startup authorization blocks editor mounting, canvas creation and protected requests",
  );
  await checking.context.close();

  const disconnected = await makeCase();
  const first = disconnected.page;
  await loginButton(first).waitFor();
  await first.waitForLoadState("networkidle");
  assertNoImplicitLogin(disconnected);
  await assertNoWorkspace(disconnected);
  assert.doesNotMatch(
    await gate(first).innerText(),
    /当前账户没有可用图片模型/,
  );
  await loginButton(first).focus();
  for (const key of ["Tab", "Tab", "Shift+Tab", "Escape", "n", "t", "Delete"]) {
    await first.keyboard.press(key);
    await assertFocusInGate(first);
  }
  await assertNoWorkspace(disconnected);
  await first.screenshot({
    path: `${artifacts}/auth-login-required.png`,
    fullPage: true,
  });
  passed(
    "unauthenticated startup shows a mandatory focused login dialog with no keyboard or background bypass",
  );

  await loginButton(first).click();
  await canvas(first).waitFor();
  await gate(first).waitFor({ state: "hidden" });
  await eventually(
    () => disconnected.requests.models > 0 && disconnected.requests.storage > 0,
    "login loads models and cloud storage",
  );
  assert.equal(
    disconnected.requests.start,
    1,
    "explicit login starts one attempt",
  );
  assert.deepEqual(
    await first.evaluate(() => window.__authPopupGestures),
    [true],
    "the browser login window is opened inside the user gesture",
  );
  await button(first, "创建图片").click();
  await creator(first).waitFor();
  await first
    .getByLabel("创作图片模型")
    .locator('option[value="fixture-sync"]')
    .waitFor({ state: "attached" });
  await first.getByLabel("创作画面描述").fill("授权后继续的本机创作草稿");
  await first.keyboard.press("Escape");
  await button(first, "保存画布").click();
  await eventually(
    async () => /已保存/.test(await first.locator(".save-status").innerText()),
    "draft is saved before testing reload recovery",
  );
  const authenticatedURL = first.url();
  await first.reload();
  await canvas(first).waitFor();
  await openSettings(first);
  await settings(first).getByText("已连接平台账户", { exact: true }).waitFor();
  assert.equal(
    first.url(),
    authenticatedURL,
    "cached authorization keeps the selected canvas deep link",
  );
  assert.equal(
    disconnected.requests.start,
    1,
    "cached authorization bypasses a new login",
  );
  assert.equal(await gate(first).count(), 0);
  await first.screenshot({
    path: `${artifacts}/auth-connected.png`,
    fullPage: true,
  });
  passed(
    "one user-gesture login enters the workspace and loads models/cloud; cached authorization bypasses login on reload",
  );

  disconnected.setAuthenticated(false);
  await first.reload();
  await gate(first).waitFor();
  assert.equal(
    first.url(),
    authenticatedURL,
    "expired authorization preserves the requested canvas deep link",
  );
  assert.equal(await canvas(first).count(), 0);
  await loginButton(first).click();
  await canvas(first).waitFor();
  assert.equal(
    first.url(),
    authenticatedURL,
    "login returns to the same canvas deep link",
  );
  await first
    .locator(".node")
    .filter({ hasText: "授权后继续的本机创作草稿" })
    .first()
    .click();
  await creator(first).waitFor();
  assert.equal(
    await first.getByLabel("创作画面描述").inputValue(),
    "授权后继续的本机创作草稿",
    "reauthorization preserves the saved local draft",
  );
  assert.equal(disconnected.requests.start, 2);
  passed(
    "reauthorization after reload retains the canvas deep link and existing local draft",
  );

  const editorBeforeExpiry = await canvas(first).elementHandle();
  const promptBeforeExpiry = await first
    .locator(".node.selected")
    .getAttribute("data-node-id");
  await first
    .getByLabel("创作画面描述")
    .fill("编辑中的画面描述在授权过期后仍需完整保留");
  await openSettings(first);
  disconnected.setAuthenticated(false);
  await settings(first)
    .getByRole("button", { name: "检查并刷新", exact: true })
    .click();
  await gate(first).waitFor();
  assert.equal(
    await editorBeforeExpiry.evaluate(
      (element) =>
        element.isConnected &&
        element === document.querySelector('[aria-label="无限创作画布"]'),
    ),
    true,
    "reauthorization retains the mounted editor instance",
  );
  assert.equal(
    await editorBeforeExpiry.evaluate(
      (element) => !!element.closest("[inert]"),
    ),
    true,
    "the retained workspace is inert behind the login dialog",
  );
  for (const key of ["Escape", "Delete", "n", "Tab", "Shift+Tab"]) {
    await first.keyboard.press(key);
    await assertFocusInGate(first);
  }
  assert.equal(
    await first.locator(`[data-node-id="${promptBeforeExpiry}"]`).count(),
    1,
    "login dialog keys do not delete the selected prompt",
  );
  assert.equal(first.url(), authenticatedURL);
  await loginButton(first).click();
  await gate(first).waitFor({ state: "hidden" });
  assert.equal(
    await editorBeforeExpiry.evaluate(
      (element) =>
        element.isConnected &&
        element === document.querySelector('[aria-label="无限创作画布"]'),
    ),
    true,
    "successful reauthorization reuses the same editor instance",
  );
  await settings(first).getByRole("button", { name: "关闭浮窗", exact: true }).click();
  await first.locator(`[data-node-id="${promptBeforeExpiry}"]`).click();
  await creator(first).waitFor();
  assert.equal(
    await first.getByLabel("创作画面描述").inputValue(),
    "编辑中的画面描述在授权过期后仍需完整保留",
  );
  assert.equal(first.url(), authenticatedURL);
  assert.equal(disconnected.requests.start, 3);
  assert.equal(
    disconnected.requests.loginForces.at(-1),
    "1",
    "reauthorization after an in-session expiry forces a fresh platform login",
  );
  passed(
    "in-session authorization expiry makes the existing workspace inert and restores the same editor, selection and draft after login",
  );
  await first.evaluate(async () => {
    const { client } = await import("/src/platform-client.ts");
    const { captureDocumentStorageSession } = await import("/src/document-storage.ts");
    window.__staleCanvasSave = captureDocumentStorageSession(client.storage);
    window.dispatchEvent(new CustomEvent("proxy-app:session-ended", {
      detail: { appId: "another-app", code: "APP_ACCOUNT_CHANGED" },
    }));
  });
  assert.equal(await gate(first).count(), 0, "another app's session event cannot block Canvas");
  const staleSaveCode = await first.evaluate(async () => {
    const { client } = await import("/src/platform-client.ts");
    window.dispatchEvent(new CustomEvent("proxy-app:session-ended", {
      detail: { appId: client.appId, code: "APP_ACCOUNT_CHANGED" },
    }));
    try { window.__staleCanvasSave(); return "not-blocked"; }
    catch (error) { return error.code; }
  });
  assert.equal(staleSaveCode, "CANVAS_STORAGE_SESSION_CHANGED", "session event stops queued saves synchronously");
  await gate(first).waitFor();
  await gate(first).getByText(/平台账户已切换，当前画布已暂停同步/).waitFor();
  assert.equal(await editorBeforeExpiry.evaluate(element => !!element.closest("[inert]")), true);
  assert.equal(first.url(), authenticatedURL, "account changes do not discard the current canvas route");
  passed("account-switch events immediately suspend old saves and block the existing editor without losing the draft");
  await disconnected.context.close();

  const delayed = await makeCase({ deferLogin: true });
  await loginButton(delayed.page).click();
  await eventually(
    () => delayed.requests.start === 1,
    "login waits for authorization",
  );
  await gate(delayed.page).waitFor();
  for (const key of ["Escape", "n", "Delete", "Tab", "Enter"])
    await delayed.page.keyboard.press(key);
  await assertNoWorkspace(delayed);
  assert.equal(
    delayed.requests.start,
    1,
    "keyboard actions cannot duplicate the pending login",
  );
  delayed.completeLogin();
  await canvas(delayed.page).waitFor();
  await eventually(
    () => delayed.requests.models > 0 && delayed.requests.storage > 0,
    "pending authorization completion loads resources",
  );
  assert.equal(delayed.requests.start, 1);
  passed(
    "pending login cannot create a canvas, edit the background or submit duplicate authorization",
  );
  await delayed.context.close();

  const mobile = await makeCase({ viewport: { width: 390, height: 844 } });
  await loginButton(mobile.page).waitFor();
  await loginButton(mobile.page).focus();
  await mobile.page.keyboard.press("Shift+Tab");
  await assertFocusInGate(mobile.page);
  const mobileBounds = await gate(mobile.page).boundingBox();
  assert.ok(
    mobileBounds &&
      mobileBounds.x >= 0 &&
      mobileBounds.y >= 0 &&
      mobileBounds.x + mobileBounds.width <= 391 &&
      mobileBounds.y + mobileBounds.height <= 845,
    "mobile login dialog fits the viewport",
  );
  assert.equal(
    await mobile.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile login has no horizontal overflow",
  );
  await assertNoWorkspace(mobile);
  await mobile.page.screenshot({
    path: `${artifacts}/auth-login-mobile.png`,
    fullPage: true,
  });
  passed("mobile login dialog fits the viewport and traps keyboard focus");
  await mobile.context.close();

  const html = await makeCase({ runtimeHTML: true });
  await gate(html.page)
    .getByText(/npm run dev/)
    .first()
    .waitFor();
  assertNoImplicitLogin(html);
  await assertNoWorkspace(html);
  await button(html.page, "重新检查连接").waitFor();
  assert.doesNotMatch(
    await gate(html.page).innerText(),
    /当前账户没有可用图片模型/,
  );
  await html.page.screenshot({
    path: `${artifacts}/auth-runtime-missing.png`,
    fullPage: true,
  });
  passed(
    "missing runtime shows a startup/configuration error with connection retry and no workspace access",
  );
  await html.context.close();

  for (const [scopeCase, scopeData] of [
    ["missing", {}],
    ["malformed", { account_scope: "confidential-invalid-account-scope" }],
  ]) {
    const account = await makeCase({
      authenticated: true,
      viewport: scopeCase === "malformed"
        ? { width: 375, height: 812 }
        : { width: 1440, height: 960 },
      loginResponse: {
        status: 200,
        body: JSON.stringify({
          data: {
            login_url: `${base}/__fixture-login-portal`,
            relay_url: base,
            auth_state: `fixture-account-${scopeCase}`,
          },
        }),
      },
      statusResponse: {
        status: 200,
        body: JSON.stringify({
          data: {
            authenticated: true,
            ...scopeData,
            details: {
              login_url: "https://example.test/callback?token=confidential",
              access_token: "confidential-token",
            },
          },
        }),
      },
    });
    await account.context.route(`${base}/__fixture-login-portal*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Fixture login portal</title><p>Local authorization fixture</p>",
      }),
    );
    const accountGate = gate(account.page);
    const assertAccountFailure = async () => {
      await accountGate
        .getByRole("heading", { name: "暂时无法确认账户信息", exact: true })
        .waitFor();
      assert.equal(
        await accountGate.getAttribute("aria-label"),
        "暂时无法确认账户信息",
        "the accessible dialog name matches the account failure heading",
      );
      await accountGate
        .getByText("为保护你的画布数据，暂时无法进入。请重新登录后再试。", { exact: true })
        .waitFor();
      await accountGate
        .getByText("重新登录后仍无法进入，请更新平台或桌面客户端，并联系管理员检查账户信息接口。", { exact: true })
        .waitFor();
      await button(account.page, "重新登录").waitFor();
      await button(account.page, "重试").waitFor();
      assert.equal(await button(account.page, "重新检查连接").count(), 0);
      assert.equal(await accountGate.getByRole("alert").count(), 0);
      assert.doesNotMatch(
        await accountGate.textContent(),
        /confidential|https:|隔离标识|同步到其他账户|暂时无法连接平台/,
      );
      await assertNoWorkspace(account);
      assert.equal(account.requests.models, 0);
      assert.equal(account.requests.storage, 0);
    };
    await assertAccountFailure();
    assertNoImplicitLogin(account);
    assert.equal(
      await account.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "account recovery fits the viewport without horizontal overflow",
    );

    const details = accountGate.locator("details");
    const summary = details.locator("summary");
    assert.equal(await summary.innerText(), "查看技术详情");
    assert.equal(await details.evaluate((element) => element.open), false);
    await button(account.page, "重新登录").focus();
    let summaryReached = false;
    for (let index = 0; index < 3; index++) {
      await account.page.keyboard.press("Tab");
      await assertFocusInGate(account.page);
      if (await summary.evaluate((element) => element === document.activeElement)) {
        summaryReached = true;
        break;
      }
    }
    assert.equal(summaryReached, true, "technical details are keyboard accessible within the dialog");
    await account.page.keyboard.press("Enter");
    assert.equal(await details.evaluate((element) => element.open), true);
    assert.match(
      await details.innerText(),
      /平台未返回有效的账户标识，可能与登录会话或平台配置有关。/,
    );
    await assertAccountFailure();
    await account.page.keyboard.press("Enter");
    assert.equal(await details.evaluate((element) => element.open), false);

    const accountStatusCount = account.requests.status;
    const finishRetry = account.deferNextStatus();
    await button(account.page, "重试").click();
    await accountGate
      .getByRole("status")
      .filter({ hasText: "正在重新检查平台连接…" })
      .waitFor();
    assert.equal(await accountGate.locator(".platform-gate-card").count(), 0);
    assert.equal(await accountGate.getAttribute("aria-busy"), "true");
    assert.equal(await accountGate.getByRole("button").count(), 0);
    await assertFocusInGate(account.page);
    await assertNoWorkspace(account);
    finishRetry();
    await assertAccountFailure();
    await accountGate.getByRole("status").filter({ hasText: "已重新检查，仍无法确认账户信息。" }).waitFor();
    assert.equal(await accountGate.getAttribute("aria-busy"), "false");
    await assertFocusInGate(account.page);
    assert.ok(account.requests.status > accountStatusCount);
    assertNoImplicitLogin(account);
    await account.page.screenshot({
      path: `${artifacts}/auth-account-retry-${scopeCase}.png`,
      fullPage: true,
    });

    await button(account.page, "重新登录").click();
    await assertAccountFailure();
    assert.equal(account.requests.start, 1);
    assert.deepEqual(account.requests.loginForces, ["1"]);
    assert.deepEqual(
      await account.page.evaluate(() => window.__authPopupGestures),
      [true],
      "account recovery starts forced login from the user gesture",
    );
    await account.page.screenshot({
      path: `${artifacts}/auth-account-${scopeCase}.png`,
      fullPage: true,
    });

    account.setStatusResponse(undefined);
    await button(account.page, "重新登录").click();
    await canvas(account.page).waitFor();
    await accountGate.waitFor({ state: "hidden" });
    await eventually(
      () => account.requests.models > 0 && account.requests.storage > 0,
      "restoring valid account scope loads workspace resources",
    );
    assert.equal(account.requests.start, 2);
    assert.deepEqual(account.requests.loginForces, ["1", "1"]);
    passed(
      `${scopeCase} account scope blocks the workspace with safe accessible recovery; retry reports pending/completed state and forced login stays blocked until a valid account is restored`,
    );
    await account.context.close();
  }

  const managed = await makeCase({
    loginResponse: {
      status: 409,
      body: JSON.stringify({ error: { code: "APP_LOGIN_UNAVAILABLE", message: "由平台管理登录" } }),
    },
  });
  await loginButton(managed.page).click();
  await gate(managed.page).getByRole("heading", { name: "请先在平台登录", exact: true }).waitFor();
  await button(managed.page, "重新检查登录状态").waitFor();
  assert.equal(await loginButton(managed.page).count(), 0);
  await gate(managed.page).getByText("如果仍无法进入，请在平台重新打开应用，或联系平台管理员。", { exact: true }).waitFor();
  assert.equal(managed.requests.start, 1);
  const finishManagedRetry = managed.deferNextStatus();
  await button(managed.page, "重新检查登录状态").click();
  await gate(managed.page)
    .getByRole("status")
    .filter({ hasText: "正在重新检查平台连接…" })
    .waitFor();
  assert.equal(await gate(managed.page).locator(".platform-gate-card").count(), 0);
  finishManagedRetry();
  await gate(managed.page).getByRole("status").filter({ hasText: "已重新检查，尚未完成登录。" }).waitFor();
  assert.equal(managed.requests.start, 1, "host-managed retry does not repeat an unavailable login");
  await assertNoWorkspace(managed);
  await assertFocusInGate(managed.page);
  managed.setStatusResponse({
    status: 409,
    body: JSON.stringify({ error: { code: "APP_ACCOUNT_SCOPE_UNAVAILABLE" } }),
  });
  await button(managed.page, "重新检查登录状态").click();
  await gate(managed.page).getByRole("heading", { name: "暂时无法确认账户信息", exact: true }).waitFor();
  await gate(managed.page).getByText("为保护你的画布数据，暂时无法进入。请返回平台确认登录状态后重试。", { exact: true }).waitFor();
  assert.equal(await loginButton(managed.page).count(), 0);
  await gate(managed.page).getByRole("status").filter({ hasText: "已重新检查，仍无法确认账户信息。" }).waitFor();
  await assertNoWorkspace(managed);
  await managed.page.screenshot({ path: `${artifacts}/auth-host-account-retry.png`, fullPage: true });
  managed.setStatusResponse(undefined);
  managed.setAuthenticated(true);
  await button(managed.page, "重新检查登录状态").click();
  await canvas(managed.page).waitFor();
  assert.equal(managed.requests.start, 1, "completing login in the host restores the workspace through a status retry");
  passed("a host-managed login error changes the action to an executable status retry and restores access after platform login");
  await managed.context.close();

  const network = await makeCase({ statusFailure: true });
  await gate(network.page)
    .getByRole("heading", { name: "暂时无法连接平台", exact: true })
    .waitFor();
  await gate(network.page)
    .getByText(/无法连接平台，请检查网络/)
    .first()
    .waitFor();
  assertNoImplicitLogin(network);
  await assertNoWorkspace(network);
  assert.equal(await button(network.page, "重新登录").count(), 0);
  assert.equal(await gate(network.page).locator("details").count(), 0);
  await button(network.page, "重新检查连接").click();
  await gate(network.page).getByRole("status").filter({ hasText: "已重新检查，问题仍未解决。请按提示处理后重试。" }).waitFor();
  assertNoImplicitLogin(network);
  network.setStatusFailure(false);
  await button(network.page, "重新检查连接").click();
  await loginButton(network.page).waitFor();
  assert.ok(network.requests.status >= 2);
  assert.equal(
    network.requests.start,
    0,
    "retrying a status failure does not automatically log in",
  );
  passed(
    "status network failure retries status safely and then shows the correct login action",
  );
  await network.context.close();

  const popup = await makeCase({
    blockPopup: true,
    loginResponse: {
      status: 200,
      body: JSON.stringify({
        data: {
          login_url: `${base}/__fixture-login-portal`,
          relay_url: base,
          auth_state: "fixture-popup-state",
        },
      }),
    },
  });
  await loginButton(popup.page).click();
  await gate(popup.page)
    .getByText(/浏览器阻止了登录窗口，请允许弹窗/)
    .waitFor();
  assert.equal(popup.requests.start, 1);
  assert.equal(popup.requests.popups, 0);
  assert.equal(await loginButton(popup.page).isEnabled(), true);
  await assertNoWorkspace(popup);
  passed(
    "blocked browser login window keeps the gate visible and provides an enabled retry action",
  );
  await popup.context.close();

  const denied = await makeCase({
    loginResponse: {
      status: 403,
      body: JSON.stringify({
        error: {
          code: "APP_LOGIN_NOT_ALLOWED",
          message: "fixture authorization denied",
        },
      }),
    },
  });
  await loginButton(denied.page).click();
  await gate(denied.page)
    .getByText(/当前账户无权使用此应用/)
    .waitFor();
  assert.equal(denied.requests.start, 1);
  assert.equal(await loginButton(denied.page).isEnabled(), true);
  await assertNoWorkspace(denied);
  passed(
    "authorization denial keeps the gate visible with a specific explanation and login retry",
  );
  await denied.context.close();

  const registration404 = {
    status: 404,
    body: JSON.stringify({
      code: "APP_APP_REGISTRATION_FAILED",
      error: "app not found",
    }),
  };
  const registration = await makeCase({ loginResponse: registration404 });
  await loginButton(registration.page).click();
  await gate(registration.page)
    .getByRole("heading", { name: "开发应用配置未完成", exact: true })
    .waitFor();
  await assertNoWorkspace(registration);
  assert.equal(registration.requests.start, 1);
  assert.deepEqual(
    registration.requests.loginForces,
    [null],
    "normal authorization reuses the platform login",
  );
  assert.match(await gate(registration.page).innerText(), /manifest\.json/);
  assert.equal(
    await loginButton(registration.page).count(),
    0,
    "application registration failure is not presented as a normal login retry",
  );
  registration.setStatusResponse(registration404);
  const registrationStatusCount = registration.requests.status;
  await button(registration.page, "重新检查应用绑定").click();
  await gate(registration.page)
    .getByRole("heading", { name: "开发应用配置未完成", exact: true })
    .waitFor();
  assert.ok(
    registration.requests.status > registrationStatusCount,
    "checking the binding refreshes authorization status",
  );
  assert.equal(
    registration.requests.start,
    1,
    "checking application binding does not repeat login",
  );
  await button(registration.page, "使用其他开发账户登录").click();
  await gate(registration.page)
    .getByRole("heading", { name: "开发应用配置未完成", exact: true })
    .waitFor();
  assert.equal(registration.requests.start, 2);
  assert.deepEqual(
    registration.requests.loginForces,
    [null, "1"],
    "only explicit developer account switching forces platform login",
  );
  assert.deepEqual(
    await registration.page.evaluate(() => window.__authPopupGestures),
    [true, true],
    "developer account switching opens login within the explicit user gesture",
  );
  await assertNoWorkspace(registration);
  await registration.page.screenshot({
    path: `${artifacts}/auth-developer-binding.png`,
    fullPage: true,
  });
  passed(
    "registration HTTP 404 explains developer binding, rechecks without repeating login, and switches developer account only on explicit action",
  );
  await registration.context.close();

  const restoredRegistration = await makeCase({
    statusResponse: registration404,
  });
  await gate(restoredRegistration.page)
    .getByRole("heading", { name: "开发应用配置未完成", exact: true })
    .waitFor();
  assertNoImplicitLogin(restoredRegistration);
  await assertNoWorkspace(restoredRegistration);
  await button(restoredRegistration.page, "重新检查应用绑定").click();
  await gate(restoredRegistration.page)
    .getByRole("heading", { name: "开发应用配置未完成", exact: true })
    .waitFor();
  assert.ok(restoredRegistration.requests.status >= 2);
  assertNoImplicitLogin(restoredRegistration);
  passed(
    "cached authorization registration failure is a developer configuration gate, with status-only retry and no automatic login",
  );
  await restoredRegistration.context.close();

  const developerDenied = await makeCase({
    loginResponse: {
      status: 403,
      body: JSON.stringify({
        error: {
          code: "APP_LOGIN_NOT_ALLOWED",
          message: "platform user is not allowed to use this app",
          stage: "app_registration",
          status: 403,
        },
      }),
    },
  });
  await loginButton(developerDenied.page).click();
  await gate(developerDenied.page)
    .getByRole("heading", { name: "开发应用配置未完成", exact: true })
    .waitFor();
  await button(developerDenied.page, "重新检查应用绑定").waitFor();
  await button(developerDenied.page, "使用其他开发账户登录").waitFor();
  assert.equal(await loginButton(developerDenied.page).count(), 0);
  await assertNoWorkspace(developerDenied);
  passed(
    "registration-stage HTTP 403 provides developer configuration recovery instead of generic end-user login denial",
  );
  await developerDenied.context.close();

  const manifestConflict = await makeCase({
    loginResponse: {
      status: 409,
      body: JSON.stringify({
        code: "APP_APP_REGISTRATION_FAILED",
        upstream_code: "APP_LOCAL_MANIFEST_CONFLICT",
        error:
          "平台登录已完成，但本地 manifest 与已上传或发布的同版本内容不同。请更新 manifest.version 后重启 proxy-app dev。",
      }),
    },
  });
  await loginButton(manifestConflict.page).click();
  await gate(manifestConflict.page)
    .getByRole("heading", { name: "开发应用配置未完成", exact: true })
    .waitFor();
  await gate(manifestConflict.page)
    .getByRole("alert")
    .getByText(/manifest.version/)
    .waitFor();
  assert.doesNotMatch(
    await gate(manifestConflict.page).getByRole("alert").innerText(),
    /应用不存在|不是应用创建者|无权开发/,
  );
  assert.equal(
    await button(manifestConflict.page, "使用其他开发账户登录").count(),
    0,
    "manifest conflict does not suggest changing account",
  );
  await button(manifestConflict.page, "重新检查应用绑定").waitFor();
  await assertNoWorkspace(manifestConflict);
  passed(
    "manifest version conflict retains the specific correction and does not suggest missing ownership or switching account",
  );
  await manifestConflict.context.close();

  const registrationUnavailable = await makeCase({
    loginResponse: {
      status: 503,
      body: JSON.stringify({
        code: "APP_APP_REGISTRATION_FAILED",
        error: "应用开发登记失败（HTTP 503），请根据请求编号检查平台日志。",
      }),
    },
  });
  await loginButton(registrationUnavailable.page).click();
  await gate(registrationUnavailable.page)
    .getByRole("heading", { name: "暂时无法连接平台", exact: true })
    .waitFor();
  await button(registrationUnavailable.page, "重新检查连接").waitFor();
  assert.equal(
    await button(registrationUnavailable.page, "使用其他开发账户登录").count(),
    0,
  );
  assert.equal(
    await button(registrationUnavailable.page, "重新检查应用绑定").count(),
    0,
  );
  await assertNoWorkspace(registrationUnavailable);
  passed(
    "registration HTTP 503 stays a service availability failure and never suggests account ownership or binding changes",
  );
  await registrationUnavailable.context.close();

  for (const [status, code, message] of [
    [403, "APP_SCOPE_DENIED", "图片模型权限尚未授予（本机验证）"],
    [500, "fixture_models_unavailable", "模型目录服务暂时故障（本机验证）"],
  ]) {
    const failure = await makeCase({
      authenticated: true,
      models: { status, body: JSON.stringify({ error: { code, message } }) },
    });
    await openSettings(failure.page);
    await settings(failure.page).getByText(message).waitFor();
    assertNoImplicitLogin(failure);
    assert.equal(
      await gate(failure.page).count(),
      0,
      "model permission/service failure does not invalidate a verified login",
    );
    assert.doesNotMatch(
      await settings(failure.page).innerText(),
      /当前账户没有可用图片模型/,
    );
    assert.ok(failure.requests.models > 0);
    passed(
      `model HTTP ${status} retains the authenticated workspace and reports the API failure`,
    );
    await failure.context.close();
  }

  const empty = await makeCase({
    authenticated: true,
    models: { status: 200, body: JSON.stringify({ data: [] }) },
  });
  await openSettings(empty.page);
  await settings(empty.page)
    .getByText(/当前账户没有可用图片模型/)
    .waitFor();
  assertNoImplicitLogin(empty);
  assert.equal(await gate(empty.page).count(), 0);
  assert.ok(empty.requests.models > 0);
  assert.doesNotMatch(
    await settings(empty.page).innerText(),
    /图片服务暂不可用|模型目录服务暂时故障/,
  );
  passed(
    "a successful empty model catalog remains an authenticated workspace and is distinguished from login/API failures",
  );
  await empty.context.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(
    cases.flatMap(({ requests }) => requests.adminRuntime),
    [],
    "Canvas never calls the Admin App Runtime",
  );
  await writeFile(
    `${artifacts}/auth-result.json`,
    JSON.stringify({ passed: true, errors, checks }, null, 2),
  );
  console.log("PASS all authentication regressions");
} catch (error) {
  for (let index = 0; index < cases.length; index++) {
    const page = cases[index].page;
    if (page.isClosed()) continue;
    await writeFile(
      `${artifacts}/auth-failure-${index}.html`,
      await page.content(),
    ).catch(() => {});
    await page
      .screenshot({
        path: `${artifacts}/auth-failure-${index}.png`,
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      `PAGE ${index}: ${(
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 6000)}`,
    );
  }
  throw error;
} finally {
  if (browser) await browser.close();
  fixture.kill("SIGTERM");
}
