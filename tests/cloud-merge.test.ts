import assert from "node:assert/strict";
import test from "node:test";
import { advanceCloudBaseAfterConfirmedSave, mergeCloudDocuments, planCloudDocumentMerge } from "../src/cloud-merge.ts";
import type { Document } from "../src/canvas-types.ts";

const base: Document = {
  id: "canvas",
  name: "画布",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-17T01:00:00.000Z",
  nodes: [
    { id: "a", type: "note", title: "A", text: "base A", x: 0, y: 0, width: 120, height: 80, color: "#fff" },
    { id: "b", type: "note", title: "B", text: "base B", x: 200, y: 0, width: 120, height: 80, color: "#fff" },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

test("merges independent edits to different nodes and fields", () => {
  const local = structuredClone(base);
  local.nodes[0].text = "local text";
  const remote = structuredClone(base);
  remote.nodes[1].title = "remote title";

  const result = mergeCloudDocuments(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.document?.nodes[0].text, "local text");
  assert.equal(result.document?.nodes[1].title, "remote title");
});

test("reports divergent edits to the same field for manual resolution", () => {
  const local = structuredClone(base);
  local.nodes[0].text = "local text";
  const remote = structuredClone(base);
  remote.nodes[0].text = "remote text";

  const result = mergeCloudDocuments(base, local, remote);
  assert.equal(result.document, null);
  assert.deepEqual(result.conflicts, ["nodes.a.text"]);
});

test("combines independent node and edge additions", () => {
  const local = structuredClone(base);
  local.nodes.push({ id: "local", type: "note", title: "Local", text: "", x: 0, y: 120, width: 120, height: 80, color: "#fff" });
  local.edges.push({ id: "edge-local", from: "a", to: "local" });
  const remote = structuredClone(base);
  remote.nodes.push({ id: "remote", type: "note", title: "Remote", text: "", x: 200, y: 120, width: 120, height: 80, color: "#fff" });
  remote.edges.push({ id: "edge-remote", from: "b", to: "remote" });

  const result = mergeCloudDocuments(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.document?.nodes.map((node) => node.id), ["a", "b", "local", "remote"]);
  assert.deepEqual(result.document?.edges.map((edge) => edge.id), ["edge-local", "edge-remote"]);
  assert.deepEqual(result.conflicts, []);
});

test("treats deletion versus edit as a conflict", () => {
  const local = structuredClone(base);
  local.nodes = local.nodes.filter((node) => node.id !== "a");
  const remote = structuredClone(base);
  remote.nodes[0].text = "remote edit";

  const result = mergeCloudDocuments(base, local, remote);
  assert.equal(result.document, null);
  assert.deepEqual(result.conflicts, ["nodes.a"]);
});

test("auto merge keeps independent edits and chooses cloud values for collisions", () => {
  const local = structuredClone(base);
  local.nodes[0].text = "local text";
  local.nodes[1].title = "local title";
  const remote = structuredClone(base);
  remote.nodes[0].text = "remote text";
  remote.nodes[1].text = "remote text";

  const result = mergeCloudDocuments(base, local, remote, {
    conflictResolution: "prefer-remote",
  });
  assert.ok(result.document);
  assert.equal(result.document.nodes[0].text, "remote text");
  assert.equal(result.document.nodes[1].title, "local title");
  assert.equal(result.document.nodes[1].text, "remote text");
  assert.deepEqual(result.conflicts, ["nodes.a.text"]);
});

test("auto merge with unknown ancestry unions additions and resolves same-field edits", () => {
  const local = structuredClone(base);
  local.name = "本机名称";
  local.nodes.push({ id: "local", type: "note", title: "Local", text: "", x: 0, y: 120, width: 120, height: 80, color: "#fff" });
  local.nodes[0].text = "local text";
  const remote = structuredClone(base);
  remote.name = "云端名称";
  remote.nodes.push({ id: "remote", type: "note", title: "Remote", text: "", x: 200, y: 120, width: 120, height: 80, color: "#fff" });
  remote.nodes[0].text = "remote text";

  const result = mergeCloudDocuments(null, local, remote, {
    conflictResolution: "prefer-remote",
  });
  assert.ok(result.document);
  assert.equal(result.document.name, "云端名称");
  assert.equal(result.document.nodes[0].text, "remote text");
  assert.deepEqual(result.document.nodes.map((node) => node.id), ["a", "b", "local", "remote"]);
  assert.deepEqual(result.conflicts, ["document.name", "nodes.a.text"]);
});

test("plans a remote-only version for explicit reload without guessing at intent", () => {
  const remote = structuredClone(base);
  remote.nodes[0].text = "remote edit";

  const plan = planCloudDocumentMerge(base, structuredClone(base), remote);
  assert.equal(plan.kind, "remote-only");
  if (plan.kind === "remote-only") assert.equal(plan.document.nodes[0].text, "remote edit");
});

test("automatically plans independent concurrent changes for background merge", () => {
  const local = structuredClone(base);
  local.nodes[0].text = "local edit";
  const remote = structuredClone(base);
  remote.nodes[1].title = "remote title";

  const plan = planCloudDocumentMerge(base, local, remote);
  assert.equal(plan.kind, "merge");
  if (plan.kind === "merge") {
    assert.equal(plan.document.nodes[0].text, "local edit");
    assert.equal(plan.document.nodes[1].title, "remote title");
  }
});

test("without a retained base, independent additions still merge silently", () => {
  const local = structuredClone(base);
  local.nodes.push({ id: "local", type: "note", title: "Local", text: "", x: 0, y: 120, width: 120, height: 80, color: "#fff" });
  const remote = structuredClone(base);
  remote.nodes.push({ id: "remote", type: "note", title: "Remote", text: "", x: 200, y: 120, width: 120, height: 80, color: "#fff" });

  const plan = planCloudDocumentMerge(null, local, remote);
  assert.equal(plan.kind, "merge");
  if (plan.kind === "merge")
    assert.deepEqual(plan.document.nodes.map((node) => node.id), ["a", "b", "local", "remote"]);
});

test("without a retained base, divergent edits remain a real conflict", () => {
  const local = structuredClone(base);
  local.nodes[0].text = "local edit";
  const remote = structuredClone(base);
  remote.nodes[0].text = "remote edit";

  const plan = planCloudDocumentMerge(null, local, remote);
  assert.equal(plan.kind, "conflict");
  if (plan.kind === "conflict") assert.ok(plan.conflicts.length > 0);
});

test("a confirmed in-flight save becomes the base for the editor's next change", () => {
  const saved = structuredClone(base);
  saved.nodes[0].text = "first local edit";
  const current = structuredClone(saved);
  current.nodes[0].text = "next local edit";

  // Before the write acknowledgement advances the baseline, this sequence of
  // edits in one editor looks like a same-field conflict with itself.
  assert.equal(planCloudDocumentMerge(base, current, saved).kind, "conflict");

  const nextBase = advanceCloudBaseAfterConfirmedSave(base, base, saved);
  assert.deepEqual(nextBase, saved);
  const plan = planCloudDocumentMerge(nextBase, current, saved);
  assert.equal(plan.kind, "local-only");
  if (plan.kind === "local-only") assert.equal(plan.document.nodes[0].text, "next local edit");
});

test("a save acknowledgement cannot move a newer cloud baseline backwards", () => {
  const originalBase = structuredClone(base);
  const newerBase = structuredClone(base);
  newerBase.nodes[1].title = "newer cloud edit";
  const acknowledged = structuredClone(base);
  acknowledged.nodes[0].text = "saved local edit";

  const result = advanceCloudBaseAfterConfirmedSave(newerBase, originalBase, acknowledged);
  assert.equal(result, newerBase);
});

test("keeps true same-field edits behind the explicit reload flow", () => {
  const local = structuredClone(base);
  local.nodes[0].text = "local edit";
  const remote = structuredClone(base);
  remote.nodes[0].text = "remote edit";

  const plan = planCloudDocumentMerge(base, local, remote);
  assert.equal(plan.kind, "conflict");
  if (plan.kind === "conflict") assert.deepEqual(plan.conflicts, ["nodes.a.text"]);
});

test("runtime task updates do not conflict with node deletion", () => {
  const local = structuredClone(base);
  local.nodes = local.nodes.filter(node => node.id !== "a");
  const remote = structuredClone(base);
  remote.nodes[0].status = "running";
  remote.nodes[0].taskDiagnostic = { phase: "processing", requestId: "r-1" };

  const plan = planCloudDocumentMerge(base, local, remote);
  assert.equal(plan.kind, "local-only");
  if (plan.kind === "local-only") assert.deepEqual(plan.document.nodes.map(node => node.id), ["b"]);
});

test("camera and short-lived runtime state never create merge conflicts", () => {
  const local = structuredClone(base);
  local.nodes[0].text = "local edit";
  local.nodes[0].status = "running";
  local.viewport = { x: 80, y: 120, zoom: 1.2 };
  const remote = structuredClone(base);
  remote.nodes[1].title = "remote title";
  remote.nodes[0].status = "failed";
  remote.viewport = { x: -240, y: 50, zoom: 0.7 };

  const plan = planCloudDocumentMerge(base, local, remote);
  assert.equal(plan.kind, "merge");
  if (plan.kind === "merge") {
    assert.equal(plan.document.nodes[0].text, "local edit");
    assert.equal(plan.document.nodes[1].title, "remote title");
    assert.equal(plan.document.nodes[0].status, "running");
    assert.deepEqual(plan.document.viewport, local.viewport);
  }
});

test("concurrent movement of the same node is a single conflict, not mixed coordinates", () => {
  const local = structuredClone(base);
  local.nodes[0].x = 40;
  local.nodes[0].y = 60;
  const remote = structuredClone(base);
  remote.nodes[0].x = 80;
  remote.nodes[0].y = 100;

  const plan = planCloudDocumentMerge(base, local, remote);
  assert.equal(plan.kind, "conflict");
  if (plan.kind === "conflict") assert.deepEqual(plan.conflicts, ["nodes.a.x+y"]);
  const resolved = mergeCloudDocuments(base, local, remote, { conflictResolution: "prefer-remote" });
  assert.deepEqual(
    { x: resolved.document?.nodes[0].x, y: resolved.document?.nodes[0].y },
    { x: 80, y: 100 },
  );
});

test("deleting a node conflicts with a new remote edge that references it", () => {
  const local = structuredClone(base);
  local.nodes = local.nodes.filter(node => node.id !== "a");
  const remote = structuredClone(base);
  remote.nodes.push({ id: "c", type: "note", title: "C", text: "", x: 400, y: 0, width: 120, height: 80, color: "#fff" });
  remote.edges.push({ id: "edge-new", from: "a", to: "c" });

  const plan = planCloudDocumentMerge(base, local, remote);
  assert.equal(plan.kind, "conflict");
  if (plan.kind === "conflict") assert.deepEqual(plan.conflicts, ["edges.edge-new.endpoint"]);
  const resolved = mergeCloudDocuments(base, local, remote, { conflictResolution: "prefer-remote" });
  assert.ok(resolved.document?.nodes.some(node => node.id === "a"));
  assert.ok(resolved.document?.edges.some(edge => edge.id === "edge-new"));
});
