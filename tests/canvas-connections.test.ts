import assert from "node:assert/strict";
import test from "node:test";
import {
  areCompatibleMediaValues,
  canKeepMediaEdge,
  shouldKeepMediaEdge,
} from "../src/canvas-connections.ts";

const media = (id: string, type: "image" | "video" | "audio" | "prompt", extra: Record<string, unknown> = {}) => ({
  id,
  type,
  ...(type === "prompt" ? { mediaType: "image" } : {}),
  ...extra,
});

test("media values may stay linked while an endpoint refreshes", () => {
  const source = media("new", "image", { image: "https://cdn.example/new.png" });
  const target = media("legacy", "image", { image: "https://cdn.example/old.png?token=expired" });
  assert.equal(canKeepMediaEdge(source, target, node => Boolean(node.image)), true);
  assert.equal(shouldKeepMediaEdge({ from: source.id }, source, target, node => Boolean(node.image)), true);
});

test("media edges survive cloud projections that unload signed media URLs", () => {
  const source = media("source", "video", { status: "completed" });
  const target = media("target", "video", { status: "completed" });
  const edge = { id: "link", from: source.id, to: target.id };
  assert.equal(shouldKeepMediaEdge(edge, source, target, () => false), true);
});

test("media compatibility rejects non-media and audio cross-kind links", () => {
  assert.equal(areCompatibleMediaValues(media("image", "image"), media("video", "video")), true);
  assert.equal(areCompatibleMediaValues(media("audio", "audio"), media("image", "image")), false);
  assert.equal(areCompatibleMediaValues(media("note", "prompt", { mediaType: "text" }), media("image", "image")), false);
  assert.equal(areCompatibleMediaValues(media("image", "image"), media("note", "prompt", { mediaType: "text" })), false);
});

test("completed prompt media can receive a reference edge", () => {
  const source = media("source", "image", { image: "source.png" });
  const target = media("creator-result", "prompt", { image: "result.png", status: "completed" });
  assert.equal(areCompatibleMediaValues(source, target), true);
  assert.equal(canKeepMediaEdge(source, target, node => Boolean(node.image)), true);
});

test("completed media remains linkable after cloud projection removes its URL", () => {
  const source = media("source", "image", { image: "source.png", status: "completed" });
  const target = media("legacy", "prompt", { status: "completed" });
  assert.equal(canKeepMediaEdge(source, target, () => false), true);
});

test("canonical media edges remain stable after normalization", () => {
  const source = media("source", "image", { image: "source.png" });
  const target = media("target", "image", { image: "target.png" });
  assert.equal(shouldKeepMediaEdge({ from: source.id }, source, target, () => true), true);
  assert.equal(shouldKeepMediaEdge({ from: source.id }, source, { ...target, resultOf: source.id }, () => true), true);
});
