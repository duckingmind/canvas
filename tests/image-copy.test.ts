import assert from "node:assert/strict";
import test from "node:test";
import { imageCopySource, isImageCopySource } from "../src/image-copy.ts";

const cosImage = "https://mzy-private-1259753336.cos.ap-shanghai.myqcloud.com/media/image/a.png?q-signature=test";

test("image copy accepts a COS delivery URL and rejects browser-local representations", () => {
  assert.equal(imageCopySource({ image: cosImage }), cosImage);
  assert.equal(imageCopySource({ image: "data:image/png;base64,AAAA", localImage: "ignored" } as never), undefined);
  assert.equal(imageCopySource({ image: "blob:https://canvas.example/123" }), undefined);
  assert.equal(imageCopySource({ image: "https://cdn.example/image.png" }), undefined);
});

test("an asset identity authorizes its deployment-specific signed delivery", () => {
  const delivery = "https://gateway.example/v1/media/image/a.png?signature=test";
  assert.equal(imageCopySource({ image: delivery, assetId: "asset-1" }), delivery);
  assert.equal(imageCopySource({ image: "https://cdn.example/image.png", imageThumbnail: cosImage }), undefined,
    "a non-COS original must not silently downgrade to a thumbnail");
});

test("only COS URLs pass the unauthenticated copy-source check", () => {
  assert.equal(isImageCopySource(cosImage), true);
  assert.equal(isImageCopySource("https://cdn.example/image.png"), false);
  assert.equal(isImageCopySource("data:image/png;base64,AAAA"), false);
});

