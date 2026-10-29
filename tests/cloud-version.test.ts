import assert from "node:assert/strict";
import test from "node:test";
import { canvasContentSignature, resolveCloudDocumentVersion } from "../src/cloud-version.ts";
import type { Document } from "../src/canvas-types.ts";

const document = (updatedAt: string, text: string): Document => ({
  id: "canvas",
  name: "画布",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt,
  nodes: [{
    id: "node",
    type: "note",
    title: "节点",
    text,
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    color: "#fff",
  }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const signature = canvasContentSignature;
const revision = (value: Document) => JSON.stringify(value);

test("identical versions are treated as synchronized", () => {
  const local = document("2026-09-17T01:00:00.000Z", "same");
  assert.equal(resolveCloudDocumentVersion(local, structuredClone(local), signature, revision), "same");
});

test("the newer cloud version is adopted and the local one can be recovered", () => {
  assert.equal(
    resolveCloudDocumentVersion(
      document("2026-09-17T01:00:00.000Z", "local"),
      document("2026-09-17T01:01:00.000Z", "cloud"),
      signature,
      revision,
    ),
    "prefer-cloud",
  );
});

test("the newer local version is automatically synchronized", () => {
  assert.equal(
    resolveCloudDocumentVersion(
      document("2026-09-17T01:02:00.000Z", "local"),
      document("2026-09-17T01:01:00.000Z", "cloud"),
      signature,
      revision,
    ),
    "prefer-local",
  );
});

test("equal timestamps with different content remain recoverable", () => {
  const timestamp = "2026-09-17T01:03:00.000Z";
  assert.equal(
    resolveCloudDocumentVersion(
      document(timestamp, "local"),
      document(timestamp, "cloud"),
      signature,
      revision,
    ),
    "manual",
  );
});

test("matching content with a newer local revision stays synchronized", () => {
  const local = document("2026-09-17T01:05:00.000Z", "same content");
  const remote = {
    ...structuredClone(local),
    updatedAt: "2026-09-17T01:04:00.000Z",
    viewport: { x: 10, y: 0, zoom: 1 },
  };
  assert.equal(
    resolveCloudDocumentVersion(local, remote, signature, revision),
    "same",
  );
});

test("matching content with a newer cloud revision stays synchronized", () => {
  const local = document("2026-09-17T01:04:00.000Z", "same content");
  const remote = {
    ...structuredClone(local),
    updatedAt: "2026-09-17T01:05:00.000Z",
    viewport: { x: 10, y: 0, zoom: 1 },
  };
  assert.equal(
    resolveCloudDocumentVersion(local, remote, signature, revision),
    "same",
  );
});

test("camera movement and save timestamps do not create a competing version", () => {
  const local = document("2026-09-17T01:06:00.000Z", "same content");
  const remote = {
    ...structuredClone(local),
    updatedAt: "2026-09-17T01:07:00.000Z",
    viewport: { x: -240, y: 90, zoom: 1.6 },
  };

  assert.equal(signature(local), signature(remote));
  assert.equal(resolveCloudDocumentVersion(local, remote, signature, revision), "same");
});

test("temporary task and media delivery changes do not create a competing version", () => {
  const local = document("2026-09-17T01:08:00.000Z", "same content");
  local.nodes[0] = {
    ...local.nodes[0],
    status: "queued",
    error: "正在提交",
    videoPollingPaused: false,
    videoPollingReason: "reconciliation",
    taskDiagnostic: { phase: "submitting", requestId: "request-1" },
    imageThumbnail: "https://example.test/thumbnail?signature=old",
    uploadState: "uploading",
    uploadProgress: 20,
  };
  const remote = structuredClone(local);
  remote.updatedAt = "2026-09-17T01:09:00.000Z";
  remote.nodes[0] = {
    ...remote.nodes[0],
    status: "failed",
    error: "任务暂时失败",
    videoPollingPaused: true,
    videoPollingReason: "user",
    taskDiagnostic: { phase: "processing", requestId: "request-2" },
    imageThumbnail: "https://example.test/thumbnail?signature=new",
    uploadState: "completing",
    uploadProgress: 95,
  };

  assert.equal(signature(local), signature(remote));
  assert.equal(resolveCloudDocumentVersion(local, remote, signature, revision), "same");
});

test("authored content changes remain visible as a new cloud version", () => {
  const local = document("2026-09-17T01:10:00.000Z", "local edit");
  const remote = document("2026-09-17T01:11:00.000Z", "cloud edit");

  assert.notEqual(signature(local), signature(remote));
  assert.equal(resolveCloudDocumentVersion(local, remote, signature, revision), "prefer-cloud");
});
