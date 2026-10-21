import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_MEDIA_REFERENCE_MAX_BYTES, localMediaDataUrl } from "../src/local-media-reference.ts";

test("local media references become typed data URLs for the gateway", async () => {
  assert.equal(await localMediaDataUrl(new Blob(["video"], { type: "video/webm" }), "video"), "data:video/webm;base64,dmlkZW8=");
  assert.equal(await localMediaDataUrl(new Blob(["audio"], { type: "audio/webm" }), "audio"), "data:audio/webm;base64,YXVkaW8=");
});

test("local media reference encoding rejects missing, mismatched, or oversized content", async () => {
  await assert.rejects(localMediaDataUrl(new Blob([], { type: "video/mp4" }), "video"), /内容为空/);
  await assert.rejects(localMediaDataUrl(new Blob(["x"], { type: "audio/mpeg" }), "video"), /格式无效/);
  const oversized = new Blob(["x"], { type: "video/mp4" });
  Object.defineProperty(oversized, "size", { value: LOCAL_MEDIA_REFERENCE_MAX_BYTES + 1 });
  await assert.rejects(localMediaDataUrl(oversized, "video"), /超过 64 MiB/);
});
