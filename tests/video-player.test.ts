import assert from "node:assert/strict";
import test from "node:test";
import { captureVideoFrame, clampVideoTime, formatVideoTime, isVideoPlayerGlobalShortcut, videoPlaybackErrorMessage } from "../src/video-player.ts";

test("video time is stable across missing duration, hour-long clips and seek bounds", () => {
  assert.equal(formatVideoTime(65.9), "1:05");
  assert.equal(formatVideoTime(3603), "1:00:03");
  for (const time of [-1, NaN, Infinity]) assert.equal(formatVideoTime(time), "0:00");
  assert.equal(clampVideoTime(8, 5), 5);
  assert.equal(clampVideoTime(-2, 5), 0);
  assert.equal(clampVideoTime(1.25, 5), 1.25);
  for (const duration of [0, NaN, Infinity, -1]) assert.equal(clampVideoTime(1, duration), 0);
});

test("focused video controls preserve undo, redo, save and escape without leaking playback keys", () => {
  const key = (key: string, metaKey = false, ctrlKey = false) => isVideoPlayerGlobalShortcut({ key, metaKey, ctrlKey });
  assert.equal(key("Escape"), true);
  for (const value of ["z", "Z", "y", "s"]) {
    assert.equal(key(value, true), true);
    assert.equal(key(value, false, true), true);
    assert.equal(key(value), false);
  }
  for (const value of [" ", "Enter", "ArrowLeft", "ArrowRight", "Delete", "Backspace", "m", "h", "v"]) {
    assert.equal(key(value), false);
  }
});

test("video playback errors distinguish interruption, network, decode and unsupported formats", () => {
  assert.match(videoPlaybackErrorMessage(1), /已中断/);
  assert.match(videoPlaybackErrorMessage(2), /网络/);
  assert.match(videoPlaybackErrorMessage(3), /无法解码/);
  assert.match(videoPlaybackErrorMessage(4), /不受支持/);
  assert.match(videoPlaybackErrorMessage(4), /跨域.*签名/);
  assert.match(videoPlaybackErrorMessage(), /重新加载或替换/);
});

function fixture(t: { after: (fn: () => void) => void }, options: { noContext?: boolean; tainted?: boolean; oversized?: boolean } = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const calls: unknown[][] = [];
  const video = { readyState: 2, seeking: false, currentTime: 3.25, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
  const canvas = {
    width: 0, height: 0,
    getContext: () => options.noContext ? null : { drawImage: (...args: unknown[]) => calls.push(args) },
    toDataURL: (type: string) => {
      if (options.tainted) throw new DOMException("origin", "SecurityError");
      return options.oversized ? `data:${type};base64,${"a".repeat(8 * 1024 * 1024)}` : `data:${type};base64,Y3VycmVudC1mcmFtZQ==`;
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (name: string) => { assert.equal(name, "canvas"); return canvas; } } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return { video, canvas, calls };
}

test("captures the playing element at the current position without seeking or creating another decoder", t => {
  const { video, canvas, calls } = fixture(t);
  const result = captureVideoFrame(video);
  assert.equal(result.time, 3.25);
  assert.equal(video.currentTime, 3.25);
  assert.deepEqual([result.width, result.height], [1920, 1080]);
  assert.match(result.dataUrl, /^data:image\/jpeg;base64,/);
  assert.deepEqual(calls, [[video, 0, 0, 1920, 1080]]);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});

test("capture preserves portrait aspect ratio and bounds large frames", t => {
  const { video } = fixture(t);
  Object.assign(video, { videoWidth: 4320, videoHeight: 7680 });
  const result = captureVideoFrame(video);
  assert.deepEqual([result.width, result.height], [2160, 3840]);
});

test("capture never upscales small video sources", t => {
  const { video } = fixture(t);
  Object.assign(video, { videoWidth: 180, videoHeight: 320 });
  const result = captureVideoFrame(video);
  assert.deepEqual([result.width, result.height], [180, 320]);
});

test("capture rejects undecoded/seeking frames and invalid metadata", t => {
  const { video, calls } = fixture(t);
  video.readyState = 1;
  assert.throws(() => captureVideoFrame(video), /尚未准备好/);
  video.readyState = 2; video.seeking = true;
  assert.throws(() => captureVideoFrame(video), /尚未准备好/);
  video.seeking = false; video.videoWidth = 0;
  assert.throws(() => captureVideoFrame(video), /尺寸/);
  assert.equal(calls.length, 0);
});

test("tainted sources explain recovery without bypassing CORS or leaking a blank image", t => {
  const { video, canvas } = fixture(t, { tainted: true });
  assert.throws(() => captureVideoFrame(video), /来源不允许截帧.*上传/);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test("capture reports a missing canvas context and releases memory", t => {
  const { video, canvas } = fixture(t, { noContext: true });
  assert.throws(() => captureVideoFrame(video), /无法截取/);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test("oversized captures fail rather than bloating persisted canvas documents", t => {
  const { video, canvas } = fixture(t, { oversized: true });
  assert.throws(() => captureVideoFrame(video), /画面过大/);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});
