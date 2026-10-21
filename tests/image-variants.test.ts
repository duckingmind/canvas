import assert from "node:assert/strict";
import test from "node:test";
import { imageOriginalURL, imagePreviewURL, imageThumbnailURL, isThumbnailURL } from "../src/image-variants.ts";

const original = "https://fixture-private.cos.na-siliconvalley.myqcloud.com/tenant/media/image/user/2026/10/06/result.png?q-sign-time=1%3B2&q-signature=signed";

test("COS signed source is not modified with an unsigned thumbnail process", () => {
  const thumbnail = imageThumbnailURL(original);
  assert.equal(thumbnail, original);
  assert.equal(isThumbnailURL(thumbnail), false);
});

test("thumbnail URLs resolve back to the canonical original", () => {
  const thumbnail = `${original}&imageMogr2%2Fthumbnail%2F480x480%3E=`;
  assert.equal(imageOriginalURL(thumbnail), original);
  assert.equal(imageThumbnailURL(thumbnail), thumbnail);
});

test("server-signed processing parameters are not stripped", () => {
  for (const operation of ["thumbnail/480x480>", "crop/480x480/gravity/center"]) {
    const encoded = encodeURIComponent(`imageMogr2/${operation}`);
    const signedThumbnail = `https://bucket.cos.na-siliconvalley.myqcloud.com/image.png?q-url-param-list=${encoded}&imageMogr2%2F${operation.replaceAll("/", "%2F").replace(">", "%3E")}=&q-signature=signed`;
    assert.equal(imageOriginalURL(signedThumbnail), signedThumbnail);
    assert.equal(imageThumbnailURL(signedThumbnail), signedThumbnail);
  }
});

test("q-url-param-list alone identifies a signed bounded preview", () => {
  const source = "https://bucket.cos.na-siliconvalley.myqcloud.com/image.png?q-url-param-list=imagemogr2%252fcrop%252f480x480%252fgravity%252fcenter&q-signature=signed";
  assert.equal(isThumbnailURL(source), true);
  assert.equal(imageOriginalURL(source), source);
});

test("bounded surfaces never use a COS original without a signed thumbnail", () => {
  const signedOriginal = "https://fixture-private.cos.ap-shanghai.myqcloud.com/tenant/media/image/20260430154541aa66/2026/10/08/result.png?q-url-param-list=&q-signature=signed";
  assert.equal(imagePreviewURL(signedOriginal), undefined);
  assert.equal(imagePreviewURL(signedOriginal, signedOriginal), undefined);
  const thumbnail = `${signedOriginal}&q-url-param-list=imagemogr2%2Fcrop%2F480x480%2Fgravity%2Fcenter`;
  assert.equal(imagePreviewURL(signedOriginal, thumbnail), thumbnail);
});

test("non-COS and local images are unchanged", () => {
  for (const source of [
    "https://cdn.example.test/image.png",
    "data:image/png;base64,AA==",
    undefined,
  ]) {
    assert.equal(imageOriginalURL(source), source);
    assert.equal(imageThumbnailURL(source), source);
    assert.equal(isThumbnailURL(source), false);
  }
});
