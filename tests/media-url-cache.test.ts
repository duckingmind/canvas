import assert from "node:assert/strict";
import test from "node:test";
import { immutableImageUrlIdentity, isTemporaryMediaUrl, mediaUrlNeedsRefresh } from "../src/media-url-cache.ts";

const object = "https://bucket.example.test/app/media/image/user-a/2026/09/22/task-a-0-0123456789abcdef.png";
const now = Date.UTC(2026, 8, 22, 5), seconds = now / 1000;
const signed = (start: number, end: number) => `${object}?q-sign-time=${start};${end}&q-signature=abc`;

test("content-versioned images share a cache identity when only COS credentials rotate", () => {
  const first = `${object}?q-signature=one&q-ak=key-a&q-sign-time=1;2&x-cos-security-token=a`;
  const second = `${object}?q-sign-time=3%3B4&q-ak=key-b&q-signature=two&x-cos-security-token=b`;
  assert.equal(immutableImageUrlIdentity(first), object);
  assert.equal(immutableImageUrlIdentity(second), object);
});

test("different image transformations, object versions, origins and prefixes never alias", () => {
  const identity = immutableImageUrlIdentity(object);
  for (const distinct of [
    object + "?imageMogr2/thumbnail/480x480>=&q-signature=new",
    object + "?versionId=v2&q-signature=new",
    object.replace("0123456789abcdef", "fedcba9876543210"),
    object.replace("bucket.example.test", "other.example.test"),
    object.replace("/app/", "/other-app/"),
    object.replace("/user-a/", "/user-b/"),
  ]) assert.notEqual(immutableImageUrlIdentity(distinct), identity);
});

test("mutable external URLs do not acquire signature-independent cache identities", () => {
  assert.equal(immutableImageUrlIdentity("https://example.test/avatar.png?q-signature=a"), undefined);
  assert.equal(immutableImageUrlIdentity("data:image/png;base64,QQ=="), undefined);
});

test("valid COS addresses survive page reload; missing and nearly expired addresses renew", () => {
  assert.equal(mediaUrlNeedsRefresh(signed(seconds - 10, seconds + 3600), now), false);
  assert.equal(mediaUrlNeedsRefresh(signed(seconds - 10, seconds + 60), now), true);
  assert.equal(mediaUrlNeedsRefresh(signed(seconds - 10, seconds - 1), now), true);
  assert.equal(mediaUrlNeedsRefresh(undefined, now), true);
  assert.equal(mediaUrlNeedsRefresh("data:image/png;base64,QQ==", now), false);
  assert.equal(mediaUrlNeedsRefresh("https://example.test/image.png", now), false);
});

test("unreadable, reversed and not-yet-valid signing intervals retain recovery", () => {
  for (const url of [object + "?q-signature=opaque", object + "?q-sign-time=bad", signed(seconds + 1, seconds + 3600), signed(seconds, seconds - 1)]) {
    assert.equal(mediaUrlNeedsRefresh(url, now), true);
  }
  assert.equal(isTemporaryMediaUrl("https://example.test/q-signature.png"), false);
  assert.equal(isTemporaryMediaUrl(object + "?X-Amz-Signature=abc"), true);
});
