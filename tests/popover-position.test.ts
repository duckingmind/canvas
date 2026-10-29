import assert from "node:assert/strict";
import test from "node:test";
import { calculatePopoverPosition, intersectPopoverRects, type PopoverRect } from "../src/popover-position.ts";

const bounds: PopoverRect = { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 };
const rect = (left: number, top: number, width: number, height: number): PopoverRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

test("popover flips below when the preferred side cannot fit", () => {
  const result = calculatePopoverPosition({
    anchor: rect(180, 8, 40, 24),
    bounds,
    popoverWidth: 220,
    popoverHeight: 160,
    preferredPlacement: "above",
    gap: 8,
    edgePadding: 8,
  });

  assert.equal(result.placement, "below");
  assert.equal(result.top, 40);
  assert.equal(result.height, 160);
});

test("popover chooses the roomier side and caps oversized content to its available height", () => {
  const result = calculatePopoverPosition({
    anchor: rect(180, 120, 40, 24),
    bounds,
    popoverWidth: 220,
    popoverHeight: 500,
    preferredPlacement: "above",
    gap: 8,
    edgePadding: 8,
  });

  assert.equal(result.placement, "below");
  assert.equal(result.maxHeight, 140);
  assert.equal(result.height, 140);
  assert.equal(result.top, 152);
  assert.ok(result.top + result.height <= bounds.bottom - 8);
});

test("popover clamps horizontally and keeps its caret within a safe inset", () => {
  const result = calculatePopoverPosition({
    anchor: rect(370, 130, 24, 24),
    bounds,
    popoverWidth: 200,
    popoverHeight: 60,
    preferredPlacement: "below",
    align: "start",
    edgePadding: 8,
    arrowInset: 16,
  });

  assert.equal(result.left, 192);
  assert.ok(result.left >= 8);
  assert.ok(result.left + result.width <= bounds.right - 8);
  assert.ok(result.arrowOffset >= 16);
  assert.ok(result.arrowOffset <= result.width - 16);
});

test("popover width and height stay inside a narrow clipped viewport", () => {
  const clipped = intersectPopoverRects(rect(10, 20, 200, 180), rect(0, 0, 120, 120));
  const result = calculatePopoverPosition({
    anchor: rect(70, 45, 30, 20),
    bounds: clipped,
    popoverWidth: 320,
    popoverHeight: 240,
    preferredPlacement: "above",
    edgePadding: 8,
  });

  assert.equal(clipped.left, 10);
  assert.equal(clipped.top, 20);
  assert.equal(result.width, 94);
  assert.equal(result.maxWidth, 94);
  assert.ok(result.left >= clipped.left + 8);
  assert.ok(result.left + result.width <= clipped.right - 8);
  assert.ok(result.top >= clipped.top + 8);
  assert.ok(result.top + result.height <= clipped.bottom - 8);
});
