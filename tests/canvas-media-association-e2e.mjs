/** Unified media connection regression, including a legacy node with a signed-only URL. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
const port = 5337, apiPort = 5338, base = `http://127.0.0.1:${port}`;
const canvasId = "media-association-regression";
await mkdir(artifacts, { recursive: true });

const fixture = spawn(process.execPath, ["tests/platform-fixture.mjs", `--port=${port}`, `--api-port=${apiPort}`], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureOutput = "", browser;
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Media association fixture timeout: ${fixtureOutput}`)), 20000);
  fixture.stdout.on("data", chunk => {
    fixtureOutput += chunk.toString();
    if (fixtureOutput.includes('"event":"ready"')) { clearTimeout(timer); resolve(); }
  });
  fixture.stderr.on("data", chunk => { fixtureOutput += chunk.toString(); });
  fixture.once("error", error => { clearTimeout(timer); reject(error); });
  fixture.once("exit", code => { if (code) reject(new Error(`Fixture exited ${code}: ${fixtureOutput}`)); });
});

const control = async body => {
  const response = await fetch(`http://127.0.0.1:${apiPort}/__fixture/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
};
const eventually = async (check, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};

let page;
try {
  await ready;
  const now = new Date().toISOString();
  const doc = {
    id: canvasId,
    name: "旧媒体节点关联回归",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "new-image-node", type: "image", title: "新图片", text: "", x: 100, y: 150,
        width: 260, height: 180, color: "#77bbcc",
        image: `${base}/v1/fixture-image.png?asset=new-image`, assetId: "new-image-asset", status: "completed",
      },
      {
        id: "legacy-image-node", type: "prompt", mediaType: "image", title: "旧图片", text: "", x: 620, y: 150,
        width: 260, height: 180, color: "#77bbcc",
        image: `${base}/v1/fixture-image.png?token=legacy-signed-preview`, status: "completed",
      },
      {
        id: "legacy-association-source", type: "image", title: "旧关联来源", text: "", x: 100, y: 460,
        width: 260, height: 180, color: "#bb9977",
        image: `${base}/v1/fixture-image.png?asset=legacy-source`, assetId: "legacy-source-asset", status: "completed",
      },
      {
        id: "legacy-association-target", type: "image", title: "旧关联目标", text: "", x: 620, y: 460,
        width: 260, height: 180, color: "#bb9977",
        image: `${base}/v1/fixture-image.png?token=legacy-association-signed-preview`, status: "completed",
      },
    ],
    edges: [{ id: "legacy-association", from: "legacy-association-source", to: "legacy-association-target", kind: "association" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  await control({ reset: true, storage: { [`canvas:doc:v1:${canvasId}`]: doc } });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/#/canvas/${canvasId}`);
  await page.locator('[data-node-id="new-image-node"] img.node-image').waitFor();
  await page.locator('[data-node-id="legacy-image-node"] img.node-image').waitFor();
  await page.locator('[data-node-id="legacy-association-target"] img.node-image').waitFor();
  const closeLibrary = page.getByRole("button", { name: "收起画布列表", exact: true }).first();
  if (await closeLibrary.isVisible()) await closeLibrary.click();

  const targetPort = page.getByRole("button", { name: "旧图片 连接输入", exact: true });
  await targetPort.waitFor({ state: "attached" });
  const sourcePort = page.getByRole("button", { name: "新图片 连接输出", exact: true });
  const sourceBounds = await sourcePort.boundingBox();
  const targetBounds = await page.locator('[data-node-id="legacy-image-node"]').boundingBox();
  assert.ok(sourceBounds && targetBounds, "both existing media nodes expose connectable ports");
  const start = { x: sourceBounds.x + sourceBounds.width / 2, y: sourceBounds.y + sourceBounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await eventually(() => sourcePort.evaluate(element => element.classList.contains("is-near")), "source magnetic port becomes actionable");
  await page.mouse.down();
  await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height / 2, { steps: 12 });
  await page.mouse.up();
  const edge = page.locator('.edge[data-edge-from="new-image-node"][data-edge-to="legacy-image-node"]');
  await edge.waitFor({ state: "attached" });
  assert.equal(
    await edge.locator(".edge-line").evaluate(element => getComputedStyle(element).strokeDasharray),
    "none",
    "canvas connections use one solid visual style",
  );
  const migratedEdge = page.locator('.edge[data-edge-from="legacy-association-source"][data-edge-to="legacy-association-target"]');
  await migratedEdge.waitFor({ state: "attached" });
  assert.equal(
    await migratedEdge.locator(".edge-line").evaluate(element => getComputedStyle(element).strokeDasharray),
    "none",
    "legacy association edges are rendered with the unified solid style",
  );
  await eventually(async () => page.evaluate(async documentId => {
    const { client } = await import("/src/platform-client.ts");
    const stored = await client.storage.get(`canvas:doc:v1:${documentId}`);
    return !stored?.edges?.some(edge => edge && typeof edge === "object" &&
      (Object.hasOwn(edge, "kind") || Object.hasOwn(edge, "source") || Object.hasOwn(edge, "target")));
  }, canvasId), "legacy edge fields are removed from the cloud document");

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出画布", exact: true }).click();
  const exportFile = await downloaded;
  const exportPath = `${artifacts}/media-association-export.json`;
  await exportFile.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  assert.deepEqual(
    exported.edges.filter(item => item.from === "new-image-node" && item.to === "legacy-image-node").map(item => item.kind),
    [undefined],
    "references use the same workflow edge shape and do not persist a second association kind",
  );
  assert.deepEqual(
    exported.edges.filter(item => item.from === "legacy-association-source" && item.to === "legacy-association-target").map(item => item.kind),
    [undefined],
    "legacy associations are migrated to the ordinary workflow edge shape",
  );

  // Simulate cloud projection: the signed legacy URL is removed, but the
  // unified reference edge must survive normalization and a fresh page load.
  await page.evaluate(async ({ documentId, value }) => {
    const { storageDocument } = await import("/src/cloud-document.ts");
    const projected = storageDocument(value);
    const { client } = await import("/src/platform-client.ts");
    await client.storage.set(`canvas:doc:v1:${documentId}`, projected);
  }, { documentId: canvasId, value: exported });
  await page.reload();
  await page.locator('[data-node-id="legacy-image-node"]').waitFor();
  await page.locator('[data-node-id="legacy-association-target"]').waitFor();
  await page.locator('.edge[data-edge-from="new-image-node"][data-edge-to="legacy-image-node"]').waitFor({ state: "attached" });
  await page.locator('.edge[data-edge-from="legacy-association-source"][data-edge-to="legacy-association-target"]').waitFor({ state: "attached" });
  assert.deepEqual(errors, []);
  console.log("PASS a new media node links to a legacy signed-URL node and the unified edge survives cloud projection");
} finally {
  if (browser) await browser.close();
  fixture.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 100));
  if (fixture.exitCode === null) fixture.kill("SIGKILL");
}
