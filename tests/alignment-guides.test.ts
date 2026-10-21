import assert from "node:assert/strict";
import test from "node:test";
import { alignmentGuides, type AlignmentNode } from "../src/alignment-guides.ts";

const node = (id: string, x: number, y: number, width = 100, height = 80): AlignmentNode => ({ id, x, y, width, height });

test("guides use the closest stationary edge on each axis and span both objects", () => {
  const nodes = [node("moving", 0, 0), node("vertical", 3, 300), node("closer", 1, 500), node("horizontal", 300, 2)];
  assert.deepEqual(alignmentGuides(nodes, ["moving"], 1), [
    { x1: 1, y1: 0, x2: 1, y2: 580 },
    { x1: 0, y1: 2, x2: 400, y2: 2 },
  ]);
});

test("screen-space tolerance stays four pixels across supported zoom levels", () => {
  for (const zoom of [0.05, 0.5, 1, 3]) {
    const moving = node("moving", 0, 0, 1000, 800);
    const near = node("near", 4 / zoom, 10000, 1000, 800);
    assert.equal(alignmentGuides([moving, near], [moving.id], zoom).length, 1);
    const outside = { ...near, x: (4 + 0.01) / zoom };
    assert.deepEqual(alignmentGuides([moving, outside], [moving.id], zoom), []);
  }
});

test("group alignment uses the selection bounds rather than individual member edges", () => {
  const nodes = [node("a", 0, 0), node("b", 200, 100), node("individual-only", 150, 500, 20, 30)];
  // Group center is 150, despite neither member having its center there.
  assert.deepEqual(alignmentGuides(nodes, ["a", "b"], 1), [{ x1: 150, y1: 0, x2: 150, y2: 530 }]);
  // 100 is a member's right edge but is not a group edge or center.
  assert.deepEqual(alignmentGuides([nodes[0], nodes[1], node("peer", 100, 500, 20, 30)], ["a", "b"], 1), []);
});

test("cross-edge and center alignment are supported without mutating the document", () => {
  const nodes = [node("a", 103, 201, 100, 80), node("b", 0, 0, 100, 400)];
  const original = structuredClone(nodes);
  assert.deepEqual(alignmentGuides(nodes, ["a"], 1), [
    { x1: 100, y1: 0, x2: 100, y2: 400 },
    { x1: 0, y1: 200, x2: 203, y2: 200 },
  ]);
  assert.deepEqual(nodes, original);
});

test("guides exclude selected nodes and malformed geometry", () => {
  const a = node("a", 0, 0);
  const invalid = [node("nan", NaN, 0), node("negative", 0, 0, -1), node("infinite", 0, Infinity), node("", 0, 0)];
  assert.deepEqual(alignmentGuides([a, ...invalid], ["a"], 1), []);
  assert.deepEqual(alignmentGuides([a, node("b", 0, 0)], ["a", "b"], 1), []);
  assert.deepEqual(alignmentGuides([a], ["missing"], 1), []);
  assert.deepEqual(alignmentGuides([a], [], 1), []);
  for (const zoom of [0, -1, NaN, Infinity]) assert.deepEqual(alignmentGuides([a, node("b", 0, 0)], ["a"], zoom), []);
});

test("equal-distance matches prefer the shorter guide and return at most two", () => {
  const nodes = [node("a", 0, 0), node("far", 0, 1000), node("close", 0, 200), node("horizontal", 200, 0)];
  const result = alignmentGuides(nodes, ["a"], 1);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { x1: 0, y1: 0, x2: 0, y2: 280 });
});
