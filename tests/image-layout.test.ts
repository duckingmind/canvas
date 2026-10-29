import assert from "node:assert/strict";
import test from "node:test";
import { fitImageNodeSize, imageAspectRatioFromDimensions, imageAspectRatioFromSettings, imageNodeSizeFromSettings } from "../src/image-layout.ts";

test("image nodes fit portrait, landscape and square images inside their bounds", () => {
  assert.deepEqual(fitImageNodeSize(9, 16), { width: 338, height: 600 });
  assert.deepEqual(fitImageNodeSize(16, 9), { width: 360, height: 203 });
  assert.deepEqual(fitImageNodeSize(1, 1), { width: 360, height: 360 });
});

test("generation settings provide a safe frame before a signed image preview loads", () => {
  assert.deepEqual(imageNodeSizeFromSettings({ aspectRatio: "9:16" }), { width: 338, height: 600 });
  assert.deepEqual(imageNodeSizeFromSettings({ size: "1024x1536" }), { width: 360, height: 540 });
  assert.equal(imageNodeSizeFromSettings({ aspectRatio: "0:16", size: "bad" }), undefined);
});

test("image aspect provenance is normalized from supported ratio, size and bitmap dimensions", () => {
  assert.equal(imageAspectRatioFromSettings({ aspectRatio: " 9 : 16 " }), "9:16");
  assert.equal(imageAspectRatioFromSettings({ size: "1024x1536" }), "1024:1536");
  assert.equal(imageAspectRatioFromSettings({ aspectRatio: "0:16" }), undefined);
  assert.equal(imageAspectRatioFromDimensions(1024, 1536), "1024:1536");
  assert.equal(imageAspectRatioFromDimensions(0, 0), undefined);
});
