import assert from "node:assert/strict";
import test from "node:test";
import type { Document } from "../src/canvas-types.ts";
import {
  classifyCloudAcknowledgement,
  classifyCloudDocument,
  markCloudLibraryLocalSave,
  type CloudLibraryStatus,
} from "../src/cloud-library-status.ts";

const document = (updatedAt: string, text: string, deletedAt?: string): Document => ({
  id: "canvas",
  name: "画布",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt,
  ...(deletedAt ? { deletedAt } : {}),
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
const state = (local: Document | null, remote: Document | null): CloudLibraryStatus =>
  classifyCloudDocument(local, remote, signature, revision).state;

test("classifies local-only and cloud-only documents", () => {
  assert.equal(state(document("2026-09-17T01:00:00.000Z", "local"), null), "local-only");
  assert.equal(state(null, document("2026-09-17T01:00:00.000Z", "cloud")), "cloud-newer");
  assert.equal(
    state(document("2026-09-17T01:00:00.000Z", "local", "2026-09-17T01:00:00.000Z"), null),
    "local-deleted",
  );
});

test("classifies synchronized, newer and conflicting versions", () => {
  const same = document("2026-09-17T01:00:00.000Z", "same");
  assert.equal(state(same, structuredClone(same)), "synced");
  assert.equal(
    state(
      document("2026-09-17T01:00:00.000Z", "local"),
      document("2026-09-17T01:01:00.000Z", "cloud"),
    ),
    "cloud-newer",
  );
  assert.equal(
    state(
      document("2026-09-17T01:02:00.000Z", "local"),
      document("2026-09-17T01:01:00.000Z", "cloud"),
    ),
    "local-newer",
  );
  assert.equal(
    state(
      document("2026-09-17T01:03:00.000Z", "local"),
      document("2026-09-17T01:03:00.000Z", "cloud"),
    ),
    "conflict",
  );
});

test("a newer cloud tombstone is visible without deleting the local copy", () => {
  assert.equal(
    state(
      document("2026-09-17T01:00:00.000Z", "local"),
      document("2026-09-17T01:01:00.000Z", "cloud", "2026-09-17T01:01:00.000Z"),
    ),
    "cloud-deleted",
  );
});

test("local save markers follow the snapshot instead of the active canvas", () => {
  const first = document("2026-09-17T01:00:00.000Z", "first");
  const later = document("2026-09-17T01:01:00.000Z", "later");
  const stale = document("2026-09-17T00:59:00.000Z", "stale");
  const marked = markCloudLibraryLocalSave(undefined, later);
  assert.equal(marked.state, "local-newer");
  assert.equal(marked.localUpdatedAt, later.updatedAt);
  assert.deepEqual(markCloudLibraryLocalSave(marked, stale), marked);
  assert.equal(
    markCloudLibraryLocalSave(
      { state: "synced", localUpdatedAt: first.updatedAt, remoteUpdatedAt: first.updatedAt },
      later,
    ).state,
    "local-newer",
  );
});

test("cloud acknowledgement cannot clear a newer local snapshot", () => {
  const acknowledged = document("2026-09-17T01:00:00.000Z", "saved");
  const newer = document("2026-09-17T01:01:00.000Z", "edited");
  const pending = {
    state: "local-newer" as const,
    localUpdatedAt: newer.updatedAt,
    remoteUpdatedAt: acknowledged.updatedAt,
  };
  assert.deepEqual(
    classifyCloudAcknowledgement(newer, acknowledged, pending, signature, revision),
    pending,
  );
  assert.equal(
    classifyCloudAcknowledgement(acknowledged, acknowledged, pending, signature, revision).state,
    "synced",
  );
});
