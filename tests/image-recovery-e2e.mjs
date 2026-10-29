/** Broken signed-image recovery against a disposable, loopback-only fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
  process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("../", import.meta.url));
// Keep this recovery regression independent from the editor's aspect-ratio
// repair lifecycle. The signed source changes, while the node geometry does not.
const fixtureImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const uiPort = 5255;
const apiPort = 5256;
const base = `http://127.0.0.1:${uiPort}`;
const api = `http://127.0.0.1:${apiPort}`;
const canvasId = "signed-image-recovery";
const taskId = "fixture-image-task";
const objectPath = `/tenant/media/image/fixture-user/2026/09/13/${taskId}-0-0123456789abcdef.png`;
const expiredUrl = `${base}${objectPath}?q-signature=expired`;
const refreshedUrl = `${base}${objectPath}?q-signature=fresh`;
const cloudKey = `canvas:doc:v1:${canvasId}`;
const timestamp = "2026-09-16T12:00:00.000Z";
const document = {
  id: canvasId,
  name: "图片恢复验证",
  createdAt: timestamp,
  updatedAt: timestamp,
  nodes: [{
    id: "expired-image",
    type: "image",
    title: "过期签名图片",
    text: "",
    x: 160,
    y: 120,
    width: 360,
    height: 360,
    color: "#202024",
    image: expiredUrl,
    resultIndex: 0,
    status: "completed",
  }],
  edges: [],
  groups: [],
  viewport: { x: 160, y: 120, zoom: 1 },
};

function recoveryMetrics() {
  return {
    expiredReads: 0,
    refreshedReads: 0,
    assetReads: 0,
    taskReads: 0,
  };
}

async function installRecoveryRoutes(page, metrics) {
  await page.route(/\/v1\/media\/(?:storage\/usage|assets)(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/media/assets") {
      metrics.assetReads++;
      await route.fulfill({
        json: {
          items: [{
            id: "fixture-asset",
            task_id: taskId,
            type: "image",
            size_bytes: fixtureImage.byteLength,
            url: refreshedUrl,
            created_at: timestamp,
          }],
          total: 1,
          page: Number(url.searchParams.get("page") || 1),
          limit: Number(url.searchParams.get("limit") || 12),
        },
      });
      return;
    }
    if (url.pathname === "/v1/media/storage/usage") {
      await route.fulfill({
        json: {
          used_bytes: fixtureImage.byteLength,
          reserved_bytes: 0,
          quota_bytes: 1024 * 1024,
          available_bytes: 1024 * 1024 - fixtureImage.byteLength,
          status: "ok",
        },
      });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/v1/images/tasks/${taskId}`, async (route) => {
    metrics.taskReads++;
    await route.fulfill({
      json: {
        id: taskId,
        task_id: taskId,
        status: "completed",
        data: [{ url: refreshedUrl }],
      },
    });
  });
  await page.route(`**${objectPath}*`, async (route) => {
    const signature = new URL(route.request().url()).searchParams.get("q-signature");
    if (signature === "fresh") {
      metrics.refreshedReads++;
      await route.fulfill({ status: 200, contentType: "image/png", body: fixtureImage });
    } else {
      metrics.expiredReads++;
      await route.fulfill({ status: 403, contentType: "text/plain", body: "expired" });
    }
  });
}

async function waitForRecoveredImage(page) {
  const selector = '[data-node-id="expired-image"] img.node-image';
  await page.locator(selector).waitFor();
  await page.waitForFunction(({ selector, expectedSource }) => {
    const image = globalThis.document.querySelector(selector);
    return image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0 &&
      (image.src.includes(expectedSource) || image.src.startsWith("data:image/"));
  }, { selector, expectedSource: "q-signature=fresh" });
  return page.locator(selector);
}

async function readLocalDocument(page) {
  return page.evaluate((id) => new Promise((resolve, reject) => {
    const open = indexedDB.open("proxy-canvas:library:v1:account:acs_" + "f".repeat(64));
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const request = database
        .transaction("documents", "readonly")
        .objectStore("documents")
        .get(id);
      request.onerror = () => {
        database.close();
        reject(request.error);
      };
      request.onsuccess = () => {
        database.close();
        resolve(request.result);
      };
    };
  }), canvasId);
}

function isCloudDocumentRead(response) {
  if (response.request().method() !== "GET") return false;
  const url = new URL(response.url());
  return url.pathname === "/v1/storage/items" &&
    url.searchParams.get("key") === cloudKey;
}

async function assertNoVersionConflict(page, phase) {
  await page.locator(".save-status").waitFor();
  try {
    await page.waitForFunction(() => {
      const status = globalThis.document
        .querySelector(".save-status")
        ?.textContent
        ?.trim();
      return Boolean(status?.startsWith("已保存"));
    });
  } catch (error) {
    const local = await readLocalDocument(page).catch((cause) => ({ error: String(cause) }));
    const state = await (await fetch(`${api}/__fixture/state`)).json();
    const remote = state.storage?.[cloudKey];
    const signatures = await page.evaluate(async ({ local, remote }) => {
      const module = await import("/src/App.tsx");
      return {
        local: local?.nodes ? module.documentSignature(local) : null,
        localRevision: local?.nodes ? module.documentRevisionSignature?.(local) : null,
        remote: remote?.nodes ? module.documentSignature(remote) : null,
        remoteRevision: remote?.nodes ? module.documentRevisionSignature?.(remote) : null,
      };
    }, { local, remote }).catch((cause) => ({ error: String(cause) }));
    console.error(JSON.stringify({
      phase,
      status: await page.locator(".save-status").innerText().catch((cause) => String(cause)),
      bodyText: (await page.locator("body").innerText()).slice(0, 1000),
      local,
      remote,
      signatures,
    }, null, 2));
    throw error;
  }
  const conflictCount = await page
    .getByText("本机与云端版本不同", { exact: false })
    .count();
  if (conflictCount) {
    const local = await readLocalDocument(page);
    const state = await (await fetch(`${api}/__fixture/state`)).json();
    const remote = state.storage?.[cloudKey];
    const signatures = await page.evaluate(async ({ local, remote }) => {
      const module = await import("/src/App.tsx");
      return {
        local: module.documentSignature(local),
        remote: module.documentSignature(remote),
      };
    }, { local, remote });
    console.error(JSON.stringify({
      phase,
      status: (await page.locator(".save-status").innerText()).trim(),
      local,
      remote,
      signatures,
    }, null, 2));
  }
  assert.equal(
    conflictCount,
    0,
    `${phase} must not treat a refreshed signed URL as a different document`,
  );
  assert.doesNotMatch(
    (await page.locator(".save-status").innerText()).trim(),
    /本机与云端版本不同/,
    `${phase} save status must not report a cloud conflict`,
  );
}

const fixture = spawn(
  process.env.CANVAS_FIXTURE_NODE || process.execPath,
  ["tests/platform-fixture.mjs", `--port=${uiPort}`, `--api-port=${apiPort}`],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let fixtureOutput = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`image recovery fixture timeout: ${fixtureOutput}`)),
    20000,
  );
  fixture.stdout.on("data", (chunk) => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) {
      clearTimeout(timer);
      resolve();
    }
  });
  fixture.stderr.on("data", (chunk) => { fixtureOutput += chunk.toString(); });
  fixture.once("error", reject);
  fixture.once("exit", (code) => {
    if (code) reject(new Error(`image recovery fixture exited ${code}: ${fixtureOutput}`));
  });
});

let browser;
let freshContext;
try {
  await ready;
  const seeded = await fetch(`${api}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reset: true,
      storage: {
        [cloudKey]: document,
      },
    }),
  });
  assert.equal(seeded.status, 200);

  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  const storageRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("storage")) storageRequests.push(request.url());
  });
  const metrics = recoveryMetrics();
  await installRecoveryRoutes(page, metrics);

  await page.goto(`${base}/#/canvas/${canvasId}`);
  let image;
  try {
    image = await waitForRecoveredImage(page);
  } catch (error) {
    const node = page.locator('[data-node-id="expired-image"]');
    const fixtureState = await (await fetch(`${api}/__fixture/state`)).json();
    console.error(JSON.stringify({
      metrics,
      url: page.url(),
      nodeCount: await node.count(),
      nodeText: await node.count() ? await node.innerText() : "",
      nodeHtml: await node.count() ? await node.innerHTML() : "",
      bodyText: (await page.locator("body").innerText()).slice(0, 1000),
      pageErrors,
      storageRequests,
      requests: fixtureState.requests,
    }, null, 2));
    throw error;
  }
  assert.ok(metrics.expiredReads >= 1, "the test must observe the expired source failure");
  assert.ok(metrics.refreshedReads >= 1, "the refreshed source must load");
  assert.ok(metrics.assetReads >= 1, "recovery must query the application asset index");

  const deadline = Date.now() + 10000;
  let migrated;
  while (Date.now() < deadline) {
    const state = await (await fetch(`${api}/__fixture/state`)).json();
    migrated = state.storage?.[cloudKey]?.nodes?.find(
      (node) => node.id === "expired-image",
    );
    if (migrated?.taskId === taskId && migrated.image === undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (migrated?.taskId !== taskId || migrated?.image !== undefined) {
    const state = await (await fetch(`${api}/__fixture/state`)).json();
    const signatures = await page.evaluate(async ({ canvasId, remote, expiredUrl }) => {
      const local = await new Promise((resolve, reject) => {
    const open = indexedDB.open("proxy-canvas:library:v1:account:acs_" + "f".repeat(64));
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("documents", "readonly").objectStore("documents").get(canvasId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        };
      });
      const module = await import("/src/App.tsx");
      const beforeRecovery = structuredClone(local);
      const node = beforeRecovery.nodes.find((item) => item.id === "expired-image");
      node.image = expiredUrl;
      delete node.taskId;
      return {
        local,
        localBeforeSignature: module.documentSignature(beforeRecovery),
        remoteSignature: module.documentSignature(remote),
      };
    }, { canvasId, remote: document, expiredUrl });
    console.error(JSON.stringify({
      migrated,
      signatures,
      bodyText: (await page.locator("body").innerText()).slice(0, 1000),
      storageRequests,
      requests: state.requests,
    }, null, 2));
  }
  assert.equal(migrated?.taskId, taskId, "cloud document must retain the stable task ID");
  assert.equal(migrated?.image, undefined, "cloud document must not retain a signed URL");

  const localAfterMigration = await readLocalDocument(page);
  const localNode = localAfterMigration?.nodes?.find(
    (node) => node.id === "expired-image",
  );
  assert.equal(localNode?.taskId, taskId, "local document must retain the recovered task ID");
  assert.equal(localNode?.image, refreshedUrl, "local document must retain its display URL");

  const taskReadsBeforeReload = metrics.taskReads;
  const refreshedReadsBeforeReload = metrics.refreshedReads;
  await Promise.all([
    page.waitForResponse(isCloudDocumentRead),
    page.reload(),
  ]);
  image = await waitForRecoveredImage(page);
  assert.equal(
    metrics.taskReads > taskReadsBeforeReload,
    true,
    "reload should recover the remote image from its stable task identity",
  );
  assert.equal(
    metrics.refreshedReads > refreshedReadsBeforeReload,
    true,
    "reload should fetch a fresh signed image URL instead of restoring remote bytes locally",
  );
  await assertNoVersionConflict(page, "reload");

  freshContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const freshPage = await freshContext.newPage();
  freshPage.setDefaultTimeout(20000);
  const freshPageErrors = [];
  freshPage.on("pageerror", (error) => freshPageErrors.push(error.message));
  const freshMetrics = recoveryMetrics();
  await installRecoveryRoutes(freshPage, freshMetrics);
  await freshPage.goto(`${base}/#/canvas/${canvasId}`);
  await waitForRecoveredImage(freshPage);
  assert.ok(
    freshMetrics.taskReads >= 1,
    "a fresh browser must recover a taskId-only cloud image through the task API",
  );
  await assertNoVersionConflict(freshPage, "fresh cloud load");
  assert.deepEqual(freshPageErrors, []);
  assert.deepEqual(pageErrors, []);
  console.log("PASS signed image migration, reload equality, and task-only cloud recovery");
} finally {
  await freshContext?.close();
  await browser?.close();
  fixture.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => fixture.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
