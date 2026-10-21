/** Thumbnail-first details and automatic current-image original loading regression. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.CANVAS_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "http://127.0.0.1:5271";
const bitmap = await readFile(new URL("./fixtures/aspect-ratio.png", import.meta.url));
const server = spawn("npm", ["run", "dev:server", "--", "--host", "127.0.0.1", "--port", "5271", "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "", browser, page, context;
const waitServer = new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error(`Vite startup timeout: ${serverOutput}`)), 30000);
  const onData = chunk => {
    serverOutput += String(chunk);
    if (serverOutput.includes("127.0.0.1:5271")) { clearTimeout(deadline); resolve(); }
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
  const requests = [];
  let thumbnailBitmap = bitmap, originalBitmap = bitmap;
  let releaseLateThumbnail, releaseLateErrorThumbnail;
  const thumbUrl = "https://preview-fixture.myqcloud.com/image.png?q-url-param-list=imageMogr2%2Fthumbnail%2F240x240&q-signature=thumb";
  const originalUrl = "https://preview-fixture.myqcloud.com/image.png?q-signature=original";
  const routeImages = async route => {
    const url = route.request().url();
    requests.push(url);
    if (url.includes("q-signature=broken")) {
      await route.fulfill({ status: 403, contentType: "text/plain", body: "expired" });
      return;
    }
    if (url.includes("q-signature=late-error-thumb")) {
      await new Promise(resolve => { releaseLateErrorThumbnail = resolve; });
      await route.fulfill({ status: 403, contentType: "text/plain", body: "expired thumbnail" });
      return;
    }
    if (url.includes("q-signature=late-thumb")) await new Promise(resolve => { releaseLateThumbnail = resolve; });
    const isThumbnail = url.includes("-thumb") || url.includes("q-signature=thumb");
    await route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": isThumbnail ? "public, max-age=3600" : "no-store" }, body: isThumbnail ? thumbnailBitmap : originalBitmap });
  };
  await page.route("https://preview-fixture.myqcloud.com/**", routeImages);
  await page.route("https://preview-direct-fixture.example.com/**", routeImages);
  await page.goto(base);
  await page.waitForFunction(async () => (await fetch("/src/MediaPreview.tsx")).ok);
  const lightboxSurface = await page.evaluate(() => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop media-preview-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal image-modal";
    backdrop.append(modal);
    document.body.append(backdrop);
    const backdropStyle = getComputedStyle(backdrop);
    const modalStyle = getComputedStyle(modal);
    const surface = {
      blur: backdropStyle.backdropFilter,
      background: modalStyle.backgroundColor,
      border: modalStyle.borderWidth,
      radius: modalStyle.borderRadius,
      shadow: modalStyle.boxShadow,
      width: modalStyle.width,
    };
    backdrop.remove();
    return surface;
  });
  assert.match(lightboxSurface.blur, /blur\(/, "lightbox backdrop applies blur to the canvas behind it");
  assert.equal(lightboxSurface.background, "rgba(0, 0, 0, 0)", "lightbox modal has no opaque card fill");
  assert.equal(lightboxSurface.border, "0px", "lightbox modal has no card border");
  assert.equal(lightboxSurface.radius, "0px", "lightbox modal has no card corners");
  assert.equal(lightboxSurface.shadow, "none", "lightbox modal has no card shadow");
  const bitmaps = await page.evaluate(() => {
    const create = (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#4263eb";
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    return { thumbnail: create(240, 120), original: create(1200, 600) };
  });
  thumbnailBitmap = Buffer.from(bitmaps.thumbnail, "base64");
  originalBitmap = Buffer.from(bitmaps.original, "base64");
  await page.exposeFunction("releaseLateThumbnail", () => {
    assert.ok(releaseLateThumbnail, "delayed thumbnail request was intercepted");
    releaseLateThumbnail();
  });
  await page.exposeFunction("releaseLateErrorThumbnail", () => {
    assert.ok(releaseLateErrorThumbnail, "delayed failing thumbnail request was intercepted");
    releaseLateErrorThumbnail();
  });
  const reactSources = await page.evaluate(async () => {
    const [preview, main] = await Promise.all([fetch("/src/MediaPreview.tsx").then(response => response.text()), fetch("/src/main.tsx").then(response => response.text())]);
    return {
      reactPath: /from\s+["']([^"']*\/react\.js[^"']*)["']/.exec(preview)?.[1],
      domPath: /from\s+["']([^"']*\/react-dom_client\.js[^"']*)["']/.exec(main)?.[1],
    };
  });
  assert.ok(reactSources.reactPath && reactSources.domPath, "Vite exposes its active React runtime");

  const result = await page.evaluate(async ({ reactPath, domPath, thumbUrl, originalUrl }) => {
    const React = (await import(reactPath)).default;
    const dom = await import(domPath), createRoot = dom.createRoot || dom.default.createRoot;
    const MediaPreview = (await import("/src/MediaPreview.tsx")).default;
    const flush = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const until = async (predicate, message) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 20)); }
    };
    const host = document.createElement("div");
    Object.assign(host.style, { position: "fixed", inset: "40px", width: "640px", height: "500px", zIndex: "999999", background: "#111" });
    document.body.append(host);
    let root = createRoot(host);
    let calls = 0, finishOriginal;
    const node = { id: "signed-thumbnail", type: "image", title: "渐进预览", image: thumbUrl, assetId: "fixture-image" };
    root.render(React.createElement(MediaPreview, {
      node, items: [node], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: source => source,
      onImageOriginalRequest: () => { calls++; return new Promise(resolve => { finishOriginal = resolve; }); },
    }));
    const image = () => host.querySelector(".media-preview-image");
    await until(() => image()?.complete && image().naturalWidth > 0 && image().classList.contains("is-ready"), "thumbnail renders immediately");
    if (host.querySelector(".media-preview-gallery")?.textContent.includes("1 / 1") !== true) throw new Error("single-item previews should still show the bottom thumbnail gallery and count");
    if (!host.querySelector(".media-preview-thumbnails [aria-current=\"true\"]") || !host.querySelector(".media-preview-thumbnails-row [aria-label=\"上一个结果\"]")?.disabled || !host.querySelector(".media-preview-thumbnails-row [aria-label=\"下一个结果\"]")?.disabled) throw new Error("single-item gallery should identify its thumbnail and disable unavailable navigation");
    if (!image().src.includes("q-signature=thumb")) throw new Error("initial preview should use its signed thumbnail");
    await until(() => calls === 1, "opening details automatically resolves the current original without zoom");
    host.querySelector('[aria-label="查看媒体信息"]').click(); await flush();
    if (host.querySelector(".media-preview-info")?.textContent.includes("240 × 120px")) throw new Error("media information must not report thumbnail dimensions as the original dimensions");
    const zoom = host.querySelector('[aria-label="放大图片"]');
    zoom.click(); await flush(); zoom.click(); await flush();
    if (calls !== 1) throw new Error("repeated zoom input must share one original refresh request");
    if (!image().src.includes("q-signature=thumb")) throw new Error("thumbnail must remain visible while the original resolves");
    if (!image().classList.contains("is-ready")) throw new Error("fetching the original must not return a decoded thumbnail to its loading appearance");
    await until(() => host.textContent.includes("正在获取原图"), "pending state explains that the original is being fetched");
    finishOriginal(originalUrl); await flush();
    await until(() => host.querySelector(".media-preview-image-detail")?.complete && host.querySelector(".media-preview-image-detail")?.naturalWidth > 0, "original layer loads");
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready"), "original replaces the thumbnail after decode");
    if (!host.querySelector(".media-preview-image-detail").src.includes("q-signature=original")) throw new Error("decoded layer should use the canonical original URL");
    const detailPointerEvents = (() => {
      const image = document.querySelector(".media-preview-image-detail.is-ready");
      if (!image) return "missing";
      return getComputedStyle(image).pointerEvents;
    })();
    if (detailPointerEvents !== "auto") throw new Error("native image context actions should target the visible full-resolution image");
    if (calls !== 1) throw new Error("loading the original must not issue a second refresh");
    if (!host.querySelector(".media-preview-info")?.textContent.includes("1200 × 600px")) throw new Error("media information should show the original dimensions after loading");
    host.querySelector('[aria-label="适配图片"]').click(); await flush();
    if (!host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready")) throw new Error("returning to fit must retain the decoded original");
    root.unmount(); root = createRoot(host);
    const retryThumb = thumbUrl.replace("q-signature=thumb", "q-signature=thumb-retry");
    const brokenOriginal = originalUrl.replace("q-signature=original", "q-signature=broken");
    const retryNode = { ...node, id: "retry-thumbnail", image: retryThumb };
    let retryCalls = 0;
    root.render(React.createElement(MediaPreview, {
      node: retryNode, items: [retryNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: source => source,
      onImageOriginalRequest: () => {
        retryCalls++;
        if (retryCalls === 1) return brokenOriginal;
        if (retryCalls === 2) return undefined;
        return originalUrl;
      },
    }));
    await until(() => host.querySelector(".media-preview-image")?.complete && host.querySelector(".media-preview-image")?.naturalWidth > 0, "retry thumbnail renders");
    await until(() => host.textContent.includes("原图暂时无法获取"), "failed original keeps a usable thumbnail and retry action");
    if (!host.querySelector(".media-preview-image").src.includes("q-signature=thumb-retry")) throw new Error("a failed original must leave the thumbnail visible");
    if (retryCalls !== 2) throw new Error("a failed original should receive one automatic recovery attempt");
    host.querySelector(".media-preview-original-error button").click();
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready"), "manual retry loads the original");
    if (retryCalls !== 3) throw new Error("manual retry should issue exactly one further refresh");

    root.unmount(); root = createRoot(host);
    const canonicalOriginal = originalUrl.replace("q-signature=original", "q-signature=canonical-original");
    const canonicalThumb = thumbUrl.replace("q-signature=thumb", "q-signature=canonical-thumb");
    const canonicalNode = { ...node, id: "valid-canonical", image: canonicalOriginal, imageThumbnail: canonicalThumb };
    let canonicalCalls = 0;
    root.render(React.createElement(MediaPreview, {
      node: canonicalNode, items: [canonicalNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: (_source, thumbnail) => thumbnail,
      onImageOriginalRequest() { canonicalCalls++; return canonicalOriginal; },
    }));
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready"), "an already valid canonical address loads automatically");
    if (canonicalCalls !== 0) throw new Error("a valid original address must not trigger an extra metadata request");
    if (!host.querySelector(".media-preview-image")?.src.includes("canonical-thumb")) throw new Error("canonical originals should still preserve the explicit thumbnail as the first layer");

    root.unmount(); root = createRoot(host);
    const lateOriginal = originalUrl.replace("q-signature=original", "q-signature=late-original");
    const lateThumb = thumbUrl.replace("q-signature=thumb", "q-signature=late-thumb");
    const lateNode = { ...node, id: "late-thumbnail", image: lateOriginal, imageThumbnail: lateThumb };
    root.render(React.createElement(MediaPreview, {
      node: lateNode, items: [lateNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: (_source, thumbnail) => thumbnail,
    }));
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready"), "a fast original may load before its slow thumbnail");
    if (host.querySelector(".media-preview-image")?.complete) throw new Error("late-thumbnail fixture should still be pending when the original becomes ready");
    await window.releaseLateThumbnail();
    await until(() => host.querySelector(".media-preview-image")?.complete && host.querySelector(".media-preview-image")?.naturalWidth === 240, "the slow thumbnail eventually loads");
    host.querySelector('[aria-label="查看媒体信息"]').click(); await flush();
    if (!host.querySelector(".media-preview-info")?.textContent.includes("1200 × 600px")) throw new Error("a late thumbnail load must not overwrite original dimensions");

    root.unmount(); root = createRoot(host);
    const lateErrorOriginal = originalUrl.replace("q-signature=original", "q-signature=late-error-original");
    const lateErrorThumb = thumbUrl.replace("q-signature=thumb", "q-signature=late-error-thumb");
    const lateErrorNode = { ...node, id: "late-thumbnail-error", image: lateErrorOriginal, imageThumbnail: lateErrorThumb };
    let lateErrorCalls = 0;
    root.render(React.createElement(MediaPreview, {
      node: lateErrorNode, items: [lateErrorNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: (_source, thumbnail) => thumbnail,
      onImageOriginalRequest() { lateErrorCalls++; return lateErrorOriginal; },
    }));
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready"), "the original loads while a failing thumbnail is still pending");
    await window.releaseLateErrorThumbnail();
    await until(() => host.querySelector(".media-preview-image")?.complete && host.querySelector(".media-preview-image")?.naturalWidth === 0, "the late thumbnail request fails");
    await flush();
    if (!host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready")) throw new Error("a late thumbnail failure must retain the decoded original");
    host.querySelector('[aria-label="查看媒体信息"]').click(); await flush();
    if (!host.querySelector(".media-preview-info")?.textContent.includes("1200 × 600px")) throw new Error("a late thumbnail failure must retain original dimensions");
    if (lateErrorCalls !== 0 || host.querySelector(".media-preview-original-error")) throw new Error("a failed fallback thumbnail must not refresh or mark a successful original as failed");

    root.unmount(); root = createRoot(host);
    const rotatingThumb = thumbUrl.replace("q-signature=thumb", "q-signature=rotating-thumb");
    let rotatingNode = { ...node, id: "rotating-expired-originals", image: rotatingThumb, imageThumbnail: rotatingThumb };
    let rotatingCalls = 0;
    const renderRotating = () => root.render(React.createElement(MediaPreview, {
      node: rotatingNode, items: [rotatingNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: (_source, thumbnail) => thumbnail,
      onImageOriginalRequest() {
        rotatingCalls++;
        if (rotatingCalls > 2) throw new Error("unexpected extra automatic metadata recovery");
        const refreshed = originalUrl.replace("q-signature=original", `q-signature=broken-rotating-${rotatingCalls}`);
        rotatingNode = { ...rotatingNode, image: refreshed };
        renderRotating();
        return refreshed;
      },
    }));
    renderRotating();
    await until(() => rotatingCalls >= 2 && Boolean(host.querySelector(".media-preview-original-error")), "repeatedly failing refreshed signed originals stop after one automatic recovery");
    await new Promise(resolve => setTimeout(resolve, 350));
    if (rotatingCalls !== 2) throw new Error("new signed URLs must not reset the same image's automatic recovery budget");
    if (!host.querySelector(".media-preview-image")?.src.includes("rotating-thumb")) throw new Error("bounded recovery must preserve a usable thumbnail");

    root.unmount(); root = createRoot(host);
    let thumbnailOnlyNode = { ...node, id: "thumbnail-only-metadata", image: thumbUrl.replace("q-signature=thumb", "q-signature=thumbnail-only-thumb") };
    let thumbnailOnlyCalls = 0;
    const renderThumbnailOnly = () => root.render(React.createElement(MediaPreview, {
      node: thumbnailOnlyNode, items: [thumbnailOnlyNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: source => source,
      onImageOriginalRequest() {
        thumbnailOnlyCalls++;
        if (thumbnailOnlyCalls > 1) throw new Error("unexpected repeated lookup of thumbnail-only metadata");
        const refreshed = thumbUrl.replace("q-signature=thumb", `q-signature=thumbnail-only-refreshed-${thumbnailOnlyCalls}-thumb`);
        thumbnailOnlyNode = { ...thumbnailOnlyNode, image: refreshed };
        renderThumbnailOnly();
        return refreshed;
      },
    }));
    renderThumbnailOnly();
    await until(() => thumbnailOnlyCalls >= 1 && Boolean(host.querySelector(".media-preview-original-error")), "thumbnail-only metadata leaves an explicit original retry instead of repeated automatic lookups");
    await new Promise(resolve => setTimeout(resolve, 350));
    if (thumbnailOnlyCalls !== 1) throw new Error("a newly signed thumbnail must not cause endless original metadata queries");

    root.unmount(); root = createRoot(host);
    const renewedOriginal = originalUrl.replace("q-signature=original", "q-signature=renewed-original");
    const renewedThumb = thumbUrl.replace("q-signature=thumb", "q-signature=renewed-thumb");
    let renewedNode = { ...node, id: "metadata-renewal", image: renewedThumb, imageThumbnail: renewedThumb };
    let renewalCalls = 0;
    const renderRenewal = () => root.render(React.createElement(MediaPreview, {
      node: renewedNode, items: [renewedNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: (_source, thumbnail) => thumbnail,
      onImageOriginalRequest() {
        renewalCalls++;
        renewedNode = { ...renewedNode, image: renewedOriginal };
        renderRenewal();
        return renewedOriginal;
      },
    }));
    renderRenewal();
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready") && host.querySelector(".media-preview-image-detail")?.src.includes("renewed-original"), "metadata renewal preserves the thumbnail and displays its refreshed original");
    if (renewalCalls !== 1) throw new Error("updating the canonical image URL must not resolve the metadata twice");
    if (host.querySelector(".media-preview-load-indicator")?.classList.contains("is-visible")) throw new Error("an unchanged loaded thumbnail must not leave metadata renewal in a permanent loading state");

    root.unmount(); root = createRoot(host);
    const directOriginal = originalUrl.replace("q-signature=original", "q-signature=direct-original");
    const directNode = { ...node, id: "without-thumbnail", image: directOriginal };
    let directCalls = 0;
    root.render(React.createElement(MediaPreview, {
      node: directNode, items: [directNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
      resolveImageThumbnail: () => undefined,
      onImageOriginalRequest() { directCalls++; return directOriginal; },
    }));
    await until(() => host.querySelector(".media-preview-image")?.src.includes("direct-original"), "an image without a signed thumbnail mounts its available original immediately");
    if (Number(getComputedStyle(host.querySelector(".media-preview-image")).opacity) < 0.9) throw new Error("the first available original must remain visible while it loads");
    await until(() => [...host.querySelectorAll(".media-preview-image")].some(image => image.src.includes("direct-original") && image.complete && image.naturalWidth === 1200), "a detail without a thumbnail displays the available original");
    if (directCalls !== 0) throw new Error("an available COS original without a thumbnail must not need a metadata roundtrip");
    if (host.textContent.includes("正在获取缩略图")) throw new Error("missing thumbnails must not block access to the detail image");

    root.unmount(); root = createRoot(host);
    const sameOriginal = "https://preview-direct-fixture.example.com/direct.png?q-signature=same-original";
    const sameNode = { ...node, id: "same-source-refresh", image: sameOriginal };
    let sameSourceCalls = 0;
    root.render(React.createElement(MediaPreview, {
      node: sameNode, items: [sameNode], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      shouldRefreshImageOriginal: true,
      resolveImageSource: source => source,
      resolveImageThumbnail: () => undefined,
      onImageOriginalRequest() { sameSourceCalls++; return sameOriginal; },
    }));
    await until(() => host.querySelector(".media-preview-image")?.complete && host.querySelector(".media-preview-image")?.naturalWidth === 1200 && !host.querySelector('[aria-label="刷新预览"]')?.disabled && !host.querySelector(".media-preview-load-indicator")?.classList.contains("is-visible"), "an available main original settles even when marked for address refresh");
    if (sameSourceCalls > 1) throw new Error("opening a same-source original must not repeatedly query its metadata");
    host.querySelector('[aria-label="查看媒体信息"]').click(); await flush();
    if (!host.querySelector(".media-preview-info")?.textContent.includes("1200 × 600px")) throw new Error("a same-source refreshed original must expose its true dimensions");
    const previousSameSourceCalls = sameSourceCalls;
    host.querySelector('[aria-label="刷新预览"]').click();
    await until(() => sameSourceCalls > previousSameSourceCalls && !host.querySelector('[aria-label="刷新预览"]')?.disabled, "manually refreshing the same original URL also completes");
    if (sameSourceCalls !== previousSameSourceCalls + 1 || host.querySelector(".media-preview-load-indicator")?.classList.contains("is-visible")) throw new Error("manual same-source refresh must not leave a permanent pending state");

    root.unmount(); root = createRoot(host);
    const galleryThumb = name => `https://preview-fixture.myqcloud.com/${name}.png?q-url-param-list=imageMogr2%2Fthumbnail%2F240x240&q-signature=${name}-thumb`;
    const galleryOriginal = name => `https://preview-fixture.myqcloud.com/${name}.png?q-signature=${name}-original`;
    const galleryItems = [
      { id: "gallery-a", type: "image", title: "画廊 A", image: galleryThumb("gallery-a"), assetId: "asset-a" },
      { id: "gallery-b", type: "image", title: "画廊 B", image: galleryThumb("gallery-b"), assetId: "asset-b" },
      { id: "gallery-c", type: "image", title: "画廊 C", image: galleryThumb("gallery-c"), assetId: "asset-c" },
    ];
    let selected = galleryItems[0];
    const originalRequests = [];
    const renderGallery = () => {
      const current = selected;
      root.render(React.createElement(MediaPreview, {
        node: current,
        items: galleryItems,
        index: galleryItems.findIndex(item => item.id === current.id),
        sources: [{ id: "gallery-source", type: "prompt" }],
        error: "",
        onSelect(item) { selected = item; renderGallery(); },
        onLocate() {},
        resolveImageSource: source => source,
        resolveImageThumbnail: source => source,
        onImageOriginalRequest() { originalRequests.push(current.id); return galleryOriginal(current.id); },
      }));
    };
    renderGallery();
    await until(() => host.querySelector(".media-preview-image")?.complete && host.querySelector(".media-preview-image")?.naturalWidth > 0, "first gallery thumbnail renders");
    await until(() => [...host.querySelectorAll(".media-preview-thumbnails img")].some(image => image.src.includes("gallery-b-thumb")), "second gallery thumbnail is present");
    const galleryStyle = getComputedStyle(host.querySelector(".media-preview-gallery"));
    const blurFilter = `${galleryStyle.backdropFilter} ${galleryStyle.webkitBackdropFilter}`;
    if (!blurFilter.includes("blur")) throw new Error("gallery background should use a translucent blur surface");
    const thumbnailRow = host.querySelector(".media-preview-thumbnails-row");
    if (getComputedStyle(thumbnailRow).display !== "grid" || thumbnailRow.children.length !== 3) throw new Error("thumbnail rail should reserve space for both navigation arrows");
    if (host.querySelector(".media-preview-navigation")) throw new Error("result navigation should sit with the thumbnail gallery, not over the media");
    if (!host.querySelector(".media-preview-thumbnails-row [aria-label=\"上一个结果\"]") || !host.querySelector(".media-preview-thumbnails-row [aria-label=\"下一个结果\"]")) throw new Error("gallery arrows should flank the thumbnail rail");
    const stagePrevious = host.querySelector('[aria-label="上一个结果（主图）"]');
    const stageNext = host.querySelector('[aria-label="下一个结果（主图）"]');
    if (!stagePrevious || !stageNext || !stagePrevious.disabled || stageNext.disabled) throw new Error("stage arrows should be visible with the previous arrow disabled at the first result");
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready"), "opening the gallery automatically loads the selected original");
    if (originalRequests.length !== 1 || originalRequests[0] !== "gallery-a") throw new Error("opening the gallery must resolve only the current original");
    host.querySelector('[aria-label="查看第 2 个结果"]').click();
    await until(() => selected.id === "gallery-b" && host.querySelector(".media-preview-image")?.src.includes("gallery-b-thumb"), "second gallery item loads its thumbnail");
    await until(() => host.querySelector(".media-preview-image-viewport.is-switching"), "switching gallery items starts a short media transition");
    if (getComputedStyle(host.querySelector(".media-preview-image")).animationName !== "preview-media-switch-in") throw new Error("the newly selected image should use the gallery transition");
    if (getComputedStyle(host.querySelector(".media-preview-image")).animationDuration !== "0.12s") throw new Error("gallery changes should use a short 120ms fade");
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready") && host.querySelector(".media-preview-image-detail")?.src.includes("gallery-b-original"), "switching details automatically loads the new current original");
    if (originalRequests.join(",") !== "gallery-a,gallery-b") throw new Error("only selected results should resolve their originals");
    if (host.querySelector('[aria-label="上一个结果（主图）"]')?.disabled || host.querySelector('[aria-label="下一个结果（主图）"]')?.disabled) throw new Error("both stage arrows should be enabled for a middle result");
    host.querySelector('[aria-label="下一个结果（主图）"]').click();
    await until(() => selected.id === "gallery-c" && host.querySelector(".media-preview-image")?.src.includes("gallery-c-thumb"), "stage next arrow selects the next image");
    await until(() => host.querySelector('[aria-label="下一个结果（主图）"]')?.disabled, "stage next arrow becomes disabled at the last result");
    host.querySelector('[aria-label="上一个结果（主图）"]').click();
    await until(() => selected.id === "gallery-b" && host.querySelector(".media-preview-image")?.src.includes("gallery-b-thumb"), "stage previous arrow selects the previous image");
    host.querySelector('[aria-label="下一个结果"]').click();
    await until(() => selected.id === "gallery-c" && host.querySelector('[aria-current="true"]')?.getAttribute("aria-label") === "查看第 3 个结果", "next arrow selects the next thumbnail");
    await until(() => host.querySelector(".media-preview-image")?.src.includes("gallery-c-thumb"), "next arrow updates the main image");
    host.querySelector('[aria-label="上一个结果"]').click();
    await until(() => selected.id === "gallery-b" && host.querySelector('[aria-current="true"]')?.getAttribute("aria-label") === "查看第 2 个结果", "previous arrow returns to the previous thumbnail");
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready") && host.querySelector(".media-preview-image-detail")?.src.includes("gallery-b-original"), "previous arrow restores the selected original");
    const navigatedRequestCount = originalRequests.length;
    await new Promise(resolve => setTimeout(resolve, 900));
    if (host.querySelector(".media-preview-image-viewport.is-switching")) throw new Error("the gallery transition should settle after navigation");
    if (originalRequests.length !== navigatedRequestCount) throw new Error("idle adjacent warming must not resolve an unselected original");
    root.unmount(); root = createRoot(host);
    const soloItem = { id: "solo-gallery", type: "image", title: "单张图片", image: galleryOriginal("solo-gallery") };
    root.render(React.createElement(MediaPreview, {
      node: soloItem, items: [soloItem], index: 0, sources: [], error: "", onSelect() {}, onLocate() {},
      resolveImageSource: source => source,
    }));
    await until(() => host.querySelector(".media-preview-image")?.complete && host.querySelector(".media-preview-image")?.naturalWidth > 0, "single image without service thumbnail loads in the detail stage");
    await until(() => host.querySelector(".media-preview-thumbnails img")?.complete && host.querySelector(".media-preview-thumbnails img")?.naturalWidth > 0, "single image without service thumbnail is reused in the gallery strip");
    if (host.querySelector(".media-preview-thumbnails img")?.src !== host.querySelector(".media-preview-image")?.src) throw new Error("single gallery should reuse its decoded detail image when no separate thumbnail exists");
    if (!host.querySelector('[aria-label="上一个结果（主图）"]')?.disabled || !host.querySelector('[aria-label="下一个结果（主图）"]')?.disabled) throw new Error("single-item stage arrows should remain visible but disabled");
    root.unmount(); root = createRoot(host);
    const raceItems = [
      { ...galleryItems[0], id: "race-a", image: galleryThumb("race-a") },
      { ...galleryItems[1], id: "race-b", image: galleryThumb("race-b") },
    ];
    let raceSelected = raceItems[0], releaseA, releaseB;
    const raceRequests = [];
    const renderRace = () => {
      const current = raceSelected;
      root.render(React.createElement(MediaPreview, {
        node: current, items: raceItems, index: raceItems.indexOf(current), sources: [], error: "", onLocate() {},
        onSelect(item) { raceSelected = item; renderRace(); },
        resolveImageSource: source => source,
        resolveImageThumbnail: source => source,
        onImageOriginalRequest() {
          raceRequests.push(current.id);
          return new Promise(resolve => { if (current.id === "race-a") releaseA = resolve; else releaseB = resolve; });
        },
      }));
    };
    renderRace();
    await until(() => Boolean(releaseA), "first detail begins an original request");
    host.querySelector('[aria-label="查看第 2 个结果"]').click();
    await until(() => Boolean(releaseB), "switching during a pending request begins only the new current original");
    releaseB(galleryOriginal("race-b"));
    await until(() => host.querySelector(".media-preview-image-detail")?.classList.contains("is-ready") && host.querySelector(".media-preview-image-detail")?.src.includes("race-b-original"), "new current original is shown");
    host.querySelector('[aria-label="查看媒体信息"]').click(); await flush();
    releaseA(galleryOriginal("race-a")); await flush();
    if (!host.querySelector(".media-preview-image-detail")?.src.includes("race-b-original")) throw new Error("a late original response must not overwrite the current detail");
    if (!host.querySelector(".media-preview-info")?.textContent.includes("1200 × 600px")) throw new Error("a stale response must not clear the current original dimensions");
    if (raceRequests.join(",") !== "race-a,race-b") throw new Error("rapid navigation must issue exactly one original request for each selected image");
    root.unmount(); host.remove();
    return { calls, retryCalls, canonicalCalls, directCalls, renewalCalls, lateErrorCalls, rotatingCalls, thumbnailOnlyCalls, sameSourceCalls, originalLayerRetained: true, thumbnailRetainedAfterFailure: true, originalDimensions: "1200 × 600px", lateThumbnailDimensionsIgnored: true, galleryOriginalRequests: originalRequests, raceRequests, staleOriginalIgnored: true };
  }, { ...reactSources, thumbUrl, originalUrl });

  assert.equal(result.calls, 1);
  const signatures = requests.map(url => new URL(url).searchParams.get("q-signature"));
  assert.equal(signatures.filter(signature => signature === "thumb").length, 1);
  assert.equal(signatures.filter(signature => signature === "thumb-retry").length, 1);
  const originalLoads = signatures.filter(signature => signature === "original").length;
  assert.ok(originalLoads >= 1 && originalLoads <= 2, "each original is loaded at most once per scenario and decoded browser cache may be reused");
  assert.equal(signatures.filter(signature => signature === "broken").length, 1);
  assert.equal(signatures.filter(signature => signature === "canonical-original").length, 1);
  assert.equal(signatures.filter(signature => signature === "late-error-original").length, 1);
  assert.equal(signatures.filter(signature => signature === "broken-rotating-1").length, 1);
  assert.equal(signatures.filter(signature => signature === "broken-rotating-2").length, 1);
  assert.equal(signatures.filter(signature => signature === "direct-original").length, 1);
  assert.equal(signatures.filter(signature => signature === "gallery-a-thumb").length, 1);
  assert.equal(signatures.filter(signature => signature === "gallery-b-thumb").length, 1);
  assert.equal(signatures.filter(signature => signature === "gallery-b-original").length, 1);
  assert.equal(signatures.filter(signature => signature === "gallery-a-original").length, 1);
  assert.equal(signatures.filter(signature => signature === "gallery-c-original").length, 0);
  assert.equal(signatures.filter(signature => signature === "race-a-original").length, 0);
  assert.equal(signatures.filter(signature => signature === "race-b-original").length, 1);
  console.log(JSON.stringify({ passed: true, result, requests }));
} finally {
  await context?.close(); await browser?.close();
  server.kill("SIGTERM");
  if (server.exitCode === null && server.signalCode === null) await new Promise(resolve => {
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
