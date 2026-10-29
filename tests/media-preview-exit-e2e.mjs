/** The lightbox must keep its full-screen presentation while PresenceLayer exits. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "http://127.0.0.1:5272";
const server = spawn("npm", ["run", "dev:server", "--", "--host", "127.0.0.1", "--port", "5272", "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "", browser, context, page;
const waitServer = new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error(`Vite startup timeout: ${serverOutput}`)), 30000);
  const onData = chunk => {
    serverOutput += String(chunk);
    if (serverOutput.includes("127.0.0.1:5272")) { clearTimeout(deadline); resolve(); }
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  server.once("error", error => { clearTimeout(deadline); reject(error); });
  server.once("exit", code => { clearTimeout(deadline); reject(new Error(`Vite exited ${code}: ${serverOutput}`)); });
});

try {
  await waitServer;
  browser = await chromium.launch({ headless: true, timeout: 90000, ...(process.env.CANVAS_BROWSER_CHANNEL === "chromium" ? {} : { channel: process.env.CANVAS_BROWSER_CHANNEL || "chrome" }) });
  context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(async () => (await fetch("/src/motion.tsx")).ok);
  const runtime = await page.evaluate(async () => {
    const [motion, main] = await Promise.all([
      fetch("/src/motion.tsx").then(response => response.text()),
      fetch("/src/main.tsx").then(response => response.text()),
    ]);
    return {
      motionPath: /from\s+["']([^"']*\/react\.js[^"']*)["']/.exec(motion)?.[1],
      domPath: /from\s+["']([^"']*\/react-dom_client\.js[^"']*)["']/.exec(main)?.[1],
    };
  });
  assert.ok(runtime.motionPath && runtime.domPath, "Vite exposes its active React runtime");

  await page.evaluate(async ({ motionPath, domPath }) => {
    const React = (await import(motionPath)).default;
    const dom = await import(domPath), createRoot = dom.createRoot || dom.default.createRoot;
    const { PresenceLayer } = await import("/src/motion.tsx");
    await import("/src/MediaPreview.tsx"); // Loads the production lightbox CSS for computed-style checks.
    await import("/src/styles.css");
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "999999";
    document.body.append(host);
    let root = createRoot(host);
    function Harness() {
      const [open, setOpen] = React.useState(true);
      window.__setPreviewOpen = setOpen;
      React.useEffect(() => {
        const onKeyDown = event => { if (event.key === "Escape") setOpen(false); };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, []);
      return React.createElement(PresenceLayer, {
        open,
        // Match App's state-dependent class: clearing preview otherwise drops
        // the lightbox modifier before its retained content finishes exiting.
        className: open ? "modal-backdrop media-preview-backdrop" : "modal-backdrop",
        onMouseDown: event => { if (event.target === event.currentTarget) setOpen(false); },
        onKeyDown: event => { if (event.key === "Escape") setOpen(false); },
      }, React.createElement("div", {
        className: "modal image-modal",
        role: "dialog",
        tabIndex: -1,
      },
        React.createElement("div", { className: "media-preview-stage" }, "detail stage"),
        React.createElement("div", { className: "media-preview-gallery" },
          React.createElement("div", { className: "media-preview-thumbnails" },
            [1, 2, 3].map(index => React.createElement("button", { key: index, type: "button" }, `thumbnail ${index}`)))),
        React.createElement("button", { type: "button", "aria-label": "关闭画廊", onClick: () => setOpen(false) }, "close")));
    }
    window.__resetPreviewHarness = () => {
      root.unmount();
      root = createRoot(host);
      root.render(React.createElement(Harness));
    };
    window.__previewTriggers = {
      closeButton: () => { host.querySelector('[aria-label="关闭画廊"]')?.click(); window.__setPreviewOpen(false); },
      backdrop: () => { host.querySelector(".media-preview-backdrop")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); window.__setPreviewOpen(false); },
      escape: () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.__setPreviewOpen(false); },
    };
    window.__cleanupPreviewHarness = () => { root.unmount(); host.remove(); };
    root.render(React.createElement(Harness));
  }, runtime);

  const results = [];
  for (const trigger of ["close-button", "backdrop", "escape"]) {
    if (trigger !== "close-button") await page.evaluate(() => window.__resetPreviewHarness());
    await page.locator(".media-preview-gallery").waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(trigger => window.__previewTriggers[trigger](), trigger === "close-button" ? "closeButton" : trigger);
    const exitLayer = page.locator('[data-motion-phase="exit"]').filter({ has: page.locator(".media-preview-gallery") });
    await exitLayer.waitFor({ state: "attached" });
    const sample = await exitLayer.evaluate(layer => {
      const modal = layer.querySelector(".modal.image-modal");
      return {
        trigger: "",
        previewPresentationRetained: layer.classList.contains("media-preview-backdrop"),
        galleryRetained: Boolean(layer.querySelector(".media-preview-gallery")),
        modalAnimation: modal && getComputedStyle(modal).animationName,
      };
    });
    sample.trigger = trigger;
    assert.equal(sample.previewPresentationRetained, true, `${trigger}: lightbox presentation remains through exit`);
    assert.equal(sample.galleryRetained, true, `${trigger}: thumbnail gallery remains mounted through exit`);
    assert.notEqual(sample.modalAnimation, "modal-panel-out", `${trigger}: full-screen panel does not take the generic modal scale animation`);
    results.push(sample);
    await exitLayer.waitFor({ state: "detached" });
  }
  await page.evaluate(() => window.__cleanupPreviewHarness());
  assert.deepEqual(results.map(result => result.trigger), ["close-button", "backdrop", "escape"]);
  console.log(JSON.stringify({ passed: true, results }));
} finally {
  await context?.close(); await browser?.close();
  server.kill("SIGTERM");
  if (server.exitCode === null && server.signalCode === null) await new Promise(resolve => {
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
