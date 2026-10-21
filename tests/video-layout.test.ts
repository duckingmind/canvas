import assert from "node:assert/strict";
import test from "node:test";
import { fitVideoNodeSize, videoAspectRatio } from "../src/video-layout.ts";

test("video node dimensions preserve landscape, portrait and square source ratios", () => {
  assert.deepEqual(fitVideoNodeSize(16, 9), { width: 480, height: 270 });
  assert.deepEqual(fitVideoNodeSize(9, 16), { width: 203, height: 360 });
  assert.deepEqual(fitVideoNodeSize(1, 1), { width: 360, height: 360 });
});

test("video aspect ratio parsing safely falls back for missing or malformed values", () => {
  assert.equal(videoAspectRatio("9:16"), 9 / 16);
  assert.equal(videoAspectRatio("16:9"), 16 / 9);
  assert.equal(videoAspectRatio("bad"), 16 / 9);
  assert.equal(videoAspectRatio("0:2", 1), 1);
});

test("extreme source ratios stay within the canvas bounds", () => {
  const portrait = fitVideoNodeSize(1, 10);
  const landscape = fitVideoNodeSize(10, 1);
  assert.ok(portrait.width > 0 && portrait.height <= 360);
  assert.ok(landscape.height > 0 && landscape.width <= 480);
  assert.ok(Math.abs(portrait.width / portrait.height - 0.1) < 0.01);
  assert.ok(Math.abs(landscape.width / landscape.height - 10) < 0.1);
});
