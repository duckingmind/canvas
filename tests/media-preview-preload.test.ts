import assert from "node:assert/strict";
import test from "node:test";
import { adjacentImagePreloadSource } from "../src/media-preview-preload.ts";

const original = "https://bucket.cos.na-siliconvalley.myqcloud.com/image.png?q-signature=signed";

test("does not preload a full-resolution image when no bounded variant is available", () => {
  assert.equal(adjacentImagePreloadSource(original, value => value, value => value), undefined);
});

test("preloads an explicitly signed thumbnail and preserves its URL", () => {
  const thumbnail = `${original}&imageMogr2%2Fthumbnail%2F480x480%3E=`;
  assert.equal(adjacentImagePreloadSource(original, value => original, value => thumbnail), thumbnail);
});

test("does not preload when the thumbnail resolver is absent", () => {
  assert.equal(adjacentImagePreloadSource(original), undefined);
});

test("recognizes an already signed thumbnail without a resolver", () => {
  const thumbnail = `${original}&imageMogr2%2Fthumbnail%2F480x480%3E=`;
  assert.equal(adjacentImagePreloadSource(thumbnail), thumbnail);
});

test("allows a non-remote bounded data URL", () => {
  const poster = "data:image/jpeg;base64,c21hbGwtZnJhbWU=";
  assert.equal(adjacentImagePreloadSource(poster), poster);
});
