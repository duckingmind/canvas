import assert from "node:assert/strict";
import test from "node:test";
import { dragThreshold, MAX_ZOOM, MIN_ZOOM, pinchViewport, wheelViewport } from "../src/geometry.ts";

const initial = { x: 120, y: -40, zoom: 0.75 };
const wheel = { deltaX: 24, deltaY: 60, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };
const point = { x: 350, y: 280 }, size = { width: 1200, height: 800 };

test("trackpad two-axis scroll and Shift wheel pan without changing zoom", () => {
  assert.deepEqual(wheelViewport(initial, wheel, point, size), { x: 96, y: -100, zoom: 0.75 });
  assert.deepEqual(wheelViewport(initial, { ...wheel, deltaX: 0, shiftKey: true }, point, size), { x: 60, y: -40, zoom: 0.75 });
  assert.deepEqual(wheelViewport(initial, { ...wheel, shiftKey: true }, point, size), { x: 96, y: -100, zoom: 0.75 });
});

test("line and page wheel units are normalized before panning", () => {
  assert.deepEqual(wheelViewport(initial, { ...wheel, deltaX: 1, deltaY: 2, deltaMode: 1 }, point, size), { x: 104, y: -72, zoom: 0.75 });
  assert.deepEqual(wheelViewport(initial, { ...wheel, deltaX: 1, deltaY: 1, deltaMode: 2 }, point, size), { x: -1080, y: -840, zoom: 0.75 });
});

test("Ctrl and Meta wheel zoom around the pointer and respect both zoom limits", () => {
  for (const modifier of ["ctrlKey", "metaKey"]) for (const deltaY of [-10000, -20, 20, 10000]) {
    const next = wheelViewport(initial, { ...wheel, [modifier]: true, deltaY }, point, size);
    assert.ok(next.zoom >= MIN_ZOOM && next.zoom <= MAX_ZOOM);
    assert.ok(Math.abs((point.x - next.x) / next.zoom - (point.x - initial.x) / initial.zoom) < 1e-8);
    assert.ok(Math.abs((point.y - next.y) / next.zoom - (point.y - initial.y) / initial.zoom) < 1e-8);
  }
});

test("wheel default action changes ordinary scroll without changing pinch or Shift pan", () => {
  const options = { defaultAction: "zoom" as const };
  const zoomed = wheelViewport(initial, wheel, point, size, options);
  assert.ok(zoomed.zoom < initial.zoom);
  assert.ok(Math.abs((point.x - zoomed.x) / zoomed.zoom - (point.x - initial.x) / initial.zoom) < 1e-8);
  assert.ok(Math.abs((point.y - zoomed.y) / zoomed.zoom - (point.y - initial.y) / initial.zoom) < 1e-8);
  for (const defaultAction of ["pan", "zoom"] as const) {
    for (const modifier of ["ctrlKey", "metaKey"]) {
      const event = { ...wheel, [modifier]: true };
      assert.deepEqual(wheelViewport(initial, event, point, size, { defaultAction }), wheelViewport(initial, event, point, size));
    }
    assert.deepEqual(wheelViewport(initial, { ...wheel, deltaX: 0, shiftKey: true }, point, size, { defaultAction }), { x: 60, y: -40, zoom: 0.75 });
  }
  for (const deltaY of [-10000, 10000]) {
    const next = wheelViewport(initial, { ...wheel, deltaY }, point, size, options);
    assert.ok(next.zoom >= MIN_ZOOM && next.zoom <= MAX_ZOOM);
  }
});

test("pan sensitivity scales normalized screen movement but never changes zoom speed", () => {
  assert.deepEqual(wheelViewport(initial, wheel, point, size, { panSensitivity: 1.5 }), { x: 84, y: -130, zoom: 0.75 });
  assert.deepEqual(wheelViewport(initial, { ...wheel, deltaX: 0, deltaY: 2, deltaMode: 1, shiftKey: true }, point, size, { panSensitivity: 2 }), { x: 56, y: -40, zoom: 0.75 });
  const pinch = { ...wheel, ctrlKey: true };
  assert.deepEqual(wheelViewport(initial, pinch, point, size, { panSensitivity: 3 }), wheelViewport(initial, pinch, point, size));
  assert.deepEqual(wheelViewport(initial, wheel, point, size, { panSensitivity: NaN }), wheelViewport(initial, wheel, point, size));
  assert.deepEqual(wheelViewport(initial, wheel, point, size, { panSensitivity: -2 }), wheelViewport(initial, wheel, point, size, { panSensitivity: 0.25 }));
  assert.deepEqual(wheelViewport(initial, wheel, point, size, { panSensitivity: 100 }), wheelViewport(initial, wheel, point, size, { panSensitivity: 3 }));
});

test("two fingers can pan and zoom together without moving the midpoint's world anchor", () => {
  const start = [{ x: 100, y: 100 }, { x: 300, y: 100 }] as const;
  for (const separation of [1, 100, 400, 10000]) {
    const next = pinchViewport(initial, start, [{ x: 250 - separation / 2, y: 180 }, { x: 250 + separation / 2, y: 180 }]);
    assert.ok(Math.abs((250 - next.x) / next.zoom - (200 - initial.x) / initial.zoom) < 1e-8);
    assert.ok(Math.abs((180 - next.y) / next.zoom - (100 - initial.y) / initial.zoom) < 1e-8);
    assert.ok(next.zoom >= MIN_ZOOM && next.zoom <= MAX_ZOOM);
  }
});

test("coincident fingers avoid invalid zoom and touch has a larger screen-pixel drag threshold", () => {
  assert.deepEqual(pinchViewport(initial, [point, point], [{ x: 400, y: 300 }, { x: 400, y: 300 }]), { x: 170, y: -20, zoom: 0.75 });
  assert.ok(dragThreshold("touch") > dragThreshold("mouse"));
  assert.equal(dragThreshold("pen"), dragThreshold("mouse"));
});
