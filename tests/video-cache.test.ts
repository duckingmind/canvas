import assert from "node:assert/strict";
import test from "node:test";
import { setLocalStorageScope } from "../src/local-storage-scope.ts";
import { deleteLocalVideo, isLocalVideoKey, LOCAL_VIDEO_MAX_BYTES, readLocalVideo, storeLocalVideo } from "../src/video-cache.ts";

test("local videos use scoped session fallback and can be deleted", async () => {
  setLocalStorageScope("video-cache-account-A");
  const source = new Blob(["video-bytes"], { type: "video/webm" });
  const key = await storeLocalVideo(source);
  assert.equal(isLocalVideoKey(key), true);
  assert.deepEqual(await readLocalVideo(key), source);

  setLocalStorageScope("video-cache-account-B");
  assert.equal(await readLocalVideo(key), null);
  setLocalStorageScope("video-cache-account-A");
  assert.deepEqual(await readLocalVideo(key), source);
  await deleteLocalVideo(key);
  assert.equal(await readLocalVideo(key), null);
});

test("local video keys and payload sizes are validated", async () => {
  assert.equal(isLocalVideoKey("proxy-canvas:video:v1:short"), false);
  assert.equal(await readLocalVideo("invalid"), null);
  await deleteLocalVideo("invalid");
  await assert.rejects(storeLocalVideo(new Blob()), /视频文件为空/);

  class OversizedBlob extends Blob {
    override get size() { return LOCAL_VIDEO_MAX_BYTES + 1; }
  }
  await assert.rejects(storeLocalVideo(new OversizedBlob()), /160 MiB/);
});
