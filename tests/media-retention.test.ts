import assert from "node:assert/strict";
import test from "node:test";
import { touchRetainedMediaNode } from "../src/media-retention.ts";

test("touchRetainedMediaNode keeps recent media in LRU order", () => {
  const initial = new Set(["a", "b", "c"]);
  const next = touchRetainedMediaNode(initial, "b", 3);
  assert.deepEqual([...next], ["a", "c", "b"]);
  assert.deepEqual([...initial], ["a", "b", "c"]);
});

test("touchRetainedMediaNode evicts the oldest loaded media", () => {
  const next = touchRetainedMediaNode(new Set(["a", "b", "c"]), "d", 3);
  assert.deepEqual([...next], ["b", "c", "d"]);
});

test("touchRetainedMediaNode handles zero and invalid capacities", () => {
  assert.deepEqual([...touchRetainedMediaNode(new Set(["a"]), "b", 0)], []);
  assert.deepEqual([...touchRetainedMediaNode(new Set(["a"]), "b", -2)], []);
  assert.deepEqual([...touchRetainedMediaNode(new Set(["a"]), "b", Number.NaN)], []);
});

