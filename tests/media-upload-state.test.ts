import assert from "node:assert/strict";
import test from "node:test";
import { markMediaUploadFailed } from "../src/media-upload-state.ts";

test("upload failure keeps the last measured progress for retry feedback", () => {
  const states = {
    "image-1": { state: "uploading" as const, progress: 67 },
  };
  const next = markMediaUploadFailed(states, "image-1", "网络中断");

  assert.deepEqual(next["image-1"], {
    state: "failed",
    progress: 67,
    error: "网络中断",
  });
  assert.equal(states["image-1"].state, "uploading");
});

test("malformed progress cannot produce an invalid progress bar value", () => {
  const next = markMediaUploadFailed({ "image-1": { state: "completing", progress: 140 } }, "image-1", "上传失败");
  assert.equal(next["image-1"].progress, 100);
  assert.equal(markMediaUploadFailed({}, "image-2", "上传失败")["image-2"].progress, 0);
});
