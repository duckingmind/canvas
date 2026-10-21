import assert from "node:assert/strict";
import test from "node:test";
import { resolveCloudDocumentVersion } from "../src/cloud-version.ts";
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

const signature = (value: Document) => JSON.stringify(value.nodes);
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

test("matching content with a newer local revision still syncs the newer version", () => {
  const local = document("2026-09-17T01:05:00.000Z", "same content");
  const remote = {
    ...structuredClone(local),
    updatedAt: "2026-09-17T01:04:00.000Z",
    viewport: { x: 10, y: 0, zoom: 1 },
  };
  assert.equal(
    resolveCloudDocumentVersion(local, remote, signature, revision),
    "prefer-local",
  );
});

test("matching content with a newer cloud revision still hydrates the newer version", () => {
  const local = document("2026-09-17T01:04:00.000Z", "same content");
  const remote = {
    ...structuredClone(local),
    updatedAt: "2026-09-17T01:05:00.000Z",
    viewport: { x: 10, y: 0, zoom: 1 },
  };
  assert.equal(
    resolveCloudDocumentVersion(local, remote, signature, revision),
    "prefer-cloud",
  );
});
