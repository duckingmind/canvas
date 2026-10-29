import assert from "node:assert/strict";
import test from "node:test";
import { hasStableMediaIdentity, hasStableMediaInput, requireStableMediaIdentity } from "../src/media-identity.ts";

test("generated media accepts an asset, task, or durable URL as its identity", () => {
  assert.equal(hasStableMediaIdentity({ assetId: "asset-1", url: "blob:temporary" }), true);
  assert.equal(hasStableMediaIdentity({ taskId: "task-1", url: "/videos/task-1/content" }), true);
  assert.equal(hasStableMediaIdentity({ taskId: "task-1", url: "https://app.example.test/v1/videos/task-1/content" }), true);
  assert.equal(hasStableMediaIdentity({ url: "https://cdn.example.test/image.png" }), true);
  assert.equal(hasStableMediaIdentity({ url: "https://cdn.example.test/image.png?token=temporary" }), false);
  assert.equal(hasStableMediaIdentity({ url: "data:image/png;base64,QQ==" }), false);
});

test("input media does not treat a task ID or browser cache as a durable source", () => {
  assert.equal(hasStableMediaInput({ taskId: "task-1" }), false);
  assert.equal(hasStableMediaInput({ url: "blob:temporary" }), false);
  assert.equal(hasStableMediaInput({ assetId: "asset-1" }), true);
  assert.equal(hasStableMediaInput({ url: "https://cdn.example.test/input.png" }), true);
  assert.equal(hasStableMediaInput({ url: "https://app.example.test/v1/videos/task-1/content" }), false);
});

test("missing generated identity fails before a completed node can be committed", () => {
  assert.throws(
    () => requireStableMediaIdentity({ url: "https://cdn.example.test/out.png?signature=temporary" }, "图片生成结果"),
    error => error && typeof error === "object" && "code" in error && error.code === "CANVAS_MEDIA_IDENTITY_MISSING",
  );
});
