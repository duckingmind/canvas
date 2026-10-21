import assert from "node:assert/strict";
import test from "node:test";
import { extractVideoPoster } from "../src/video-poster.ts";

const POSTER = "data:image/jpeg;base64,c21hbGwtZnJhbWU=";

class FakeVideo extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  muted = false;
  playsInline = false;
  preload = "";
  crossOrigin = "";
  src = "";
  currentTime = 0;
  seeking = false;
  readyState = 0;
  videoWidth = 1920;
  videoHeight = 1080;
  pauseCalls = 0;
  loadCalls = 0;

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (callback) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(callback);
      this.listeners.set(type, listeners);
    }
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null) {
    if (callback) this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback);
  }
  pause() { this.pauseCalls++; }
  load() { this.loadCalls++; }
  removeAttribute(attribute: string) { if (attribute === "src") this.src = ""; }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function mockMedia(t: { after: (fn: () => void) => void }, options: { frame?: (width: number, quality?: number) => string; drawFails?: boolean; contextMissing?: boolean } = {}) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const video = new FakeVideo();
  const draws: number[][] = [];
  const encodes: Array<[string, number | undefined]> = [];
  const context = { drawImage(_video: unknown, _x: number, _y: number, width: number, height: number) {
    if (options.drawFails) throw new Error("tainted canvas");
    draws.push([width, height]);
  } };
  const canvas = {
    width: 0, height: 0,
    getContext: () => options.contextMissing ? null : context,
    toDataURL(type: string, quality?: number) { encodes.push([type, quality]); return options.frame?.(this.width, quality) ?? POSTER; },
  };
  const created: string[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement(type: string) {
    created.push(type);
    return type === "video" ? video : canvas;
  } } });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  function assertClean() {
    assert.equal(video.src, "");
    assert.equal(video.pauseCalls, 1);
    assert.equal(video.loadCalls, 2);
    assert.equal(video.listenerCount, 0);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  }
  return { video, canvas, draws, encodes, created, assertClean };
}

test("extracts the first decoded frame within 640px and cleans up without revoking the caller's URL", async t => {
  const media = mockMedia(t);
  const revoke = t.mock.method(URL, "revokeObjectURL", () => { throw new Error("caller owns this URL"); });
  const create = t.mock.method(URL, "createObjectURL", () => { throw new Error("no new URL needed"); });
  const result = extractVideoPoster("blob:owned-by-caller");
  assert.equal(media.video.src, "blob:owned-by-caller");
  assert.equal(media.video.muted, true);
  assert.equal(media.video.playsInline, true);
  assert.equal(media.video.preload, "metadata");
  assert.equal(media.video.crossOrigin, "anonymous");
  media.video.readyState = 1;
  media.video.emit("loadedmetadata");
  assert.equal(media.draws.length, 0, "metadata alone does not contain a decoded frame");
  media.video.readyState = 2;
  media.video.emit("loadeddata");
  assert.equal(await result, POSTER);
  assert.deepEqual(media.draws, [[640, 360]]);
  assert.deepEqual(media.encodes, [["image/jpeg", 0.74]]);
  assert.equal(revoke.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
  media.assertClean();
  media.video.emit("canplay");
  assert.equal(media.draws.length, 1);
});

test("seeks a restored video position back to zero before extracting the cover", async t => {
  const media = mockMedia(t);
  const result = extractVideoPoster("https://cdn.example/video.mp4#t=10");
  media.video.currentTime = 10;
  media.video.readyState = 2;
  media.video.emit("loadedmetadata");
  assert.equal(media.video.currentTime, 0);
  assert.equal(media.draws.length, 0);
  media.video.seeking = true;
  media.video.emit("loadeddata");
  assert.equal(media.draws.length, 0);
  media.video.seeking = false;
  media.video.emit("seeked");
  assert.equal(await result, POSTER);
  media.assertClean();
});

test("reduces dimensions when JPEG quality alone cannot satisfy the persistent size limit", async t => {
  const oversized = `data:image/jpeg;base64,${"a".repeat(48 * 1024)}`;
  const media = mockMedia(t, { frame: width => width > 480 ? oversized : POSTER });
  const result = extractVideoPoster("blob:video");
  media.video.readyState = 2;
  media.video.emit("loadeddata");
  assert.equal(await result, POSTER);
  assert.deepEqual(media.draws, [[640, 360], [480, 270]]);
  assert.equal(media.encodes.length, 4);
  media.assertClean();
});

test("omits an oversized poster instead of persisting an unbounded data URL", async t => {
  const media = mockMedia(t, { frame: () => `data:image/jpeg;base64,${"a".repeat(48 * 1024)}` });
  const result = extractVideoPoster("blob:video");
  media.video.readyState = 2;
  media.video.emit("loadeddata");
  assert.equal(await result, undefined);
  assert.equal(media.encodes.length, 12);
  media.assertClean();
});

test("does not upscale small or portrait video frames", async t => {
  const media = mockMedia(t);
  media.video.videoWidth = 180;
  media.video.videoHeight = 320;
  const result = extractVideoPoster("blob:video");
  media.video.readyState = 2;
  media.video.emit("loadeddata");
  assert.equal(await result, POSTER);
  assert.deepEqual(media.draws, [[180, 320]]);
  media.assertClean();
});

test("timeouts resolve without a poster and release the pending decoder", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const media = mockMedia(t);
  const result = extractVideoPoster("blob:video");
  t.mock.timers.tick(12_000);
  assert.equal(await result, undefined);
  media.assertClean();
});

test("decode failures resolve without a poster", async t => {
  const media = mockMedia(t);
  const result = extractVideoPoster("blob:video");
  media.video.emit("error");
  assert.equal(await result, undefined);
  media.assertClean();
});

test("CORS-tainted canvas failures leave video playback independent", async t => {
  const media = mockMedia(t, { drawFails: true });
  const result = extractVideoPoster("https://cdn.example/video.mp4");
  media.video.readyState = 2;
  media.video.emit("loadeddata");
  assert.equal(await result, undefined);
  media.assertClean();
});

test("unavailable canvas contexts resolve without a poster", async t => {
  const media = mockMedia(t, { contextMissing: true });
  const result = extractVideoPoster("blob:video");
  media.video.readyState = 2;
  media.video.emit("loadeddata");
  assert.equal(await result, undefined);
  media.assertClean();
});

test("cancellation aborts extraction and removes the signal listener", async t => {
  const media = mockMedia(t);
  const controller = new AbortController();
  const remove = t.mock.method(controller.signal, "removeEventListener");
  const result = extractVideoPoster("blob:video", { signal: controller.signal });
  controller.abort();
  assert.equal(await result, undefined);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(remove.mock.calls[0].arguments[0], "abort");
  media.assertClean();
});

test("already cancelled or empty sources never allocate a decoder", async t => {
  const media = mockMedia(t);
  assert.equal(await extractVideoPoster("blob:video", { signal: AbortSignal.abort() }), undefined);
  assert.equal(await extractVideoPoster(""), undefined);
  assert.deepEqual(media.created, []);
});

test("Blob sources get a helper-owned object URL that is revoked after extraction", async t => {
  const media = mockMedia(t);
  const create = t.mock.method(URL, "createObjectURL", () => "blob:helper-owned");
  const revoke = t.mock.method(URL, "revokeObjectURL", () => undefined);
  const result = extractVideoPoster(new Blob(["video"], { type: "video/mp4" }));
  assert.equal(media.video.src, "blob:helper-owned");
  media.video.readyState = 2;
  media.video.emit("loadeddata");
  assert.equal(await result, POSTER);
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(revoke.mock.calls[0]?.arguments, ["blob:helper-owned"]);
  media.assertClean();
});
