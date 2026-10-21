import assert from "node:assert/strict";
import test from "node:test";
import { zoomAt, type Viewport } from "../src/geometry.ts";
import { ViewportMotion } from "../src/viewport-motion.ts";

function camera(initial: Viewport = { x: 0, y: 0, zoom: 1 }, reducedMotion = false) {
  let viewport = { ...initial };
  let time = 0;
  let nextFrameId = 0;
  const frames = new Map<number, (time: number) => void>();
  const renders: { viewport: Viewport; edited: boolean }[] = [];
  const motion = new ViewportMotion({
    read: () => viewport,
    render: (next, edited) => {
      viewport = { ...next };
      renders.push({ viewport, edited });
    },
    requestFrame: (callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => { frames.delete(id); },
    now: () => time,
    reducedMotion: () => reducedMotion,
  });
  return {
    motion,
    renders,
    read: () => viewport,
    pending: () => frames.size,
    advanceTo: (nextTime: number) => { time = nextTime; },
    replaceDocument: (next: Viewport) => { viewport = { ...next }; },
    frameAt: (nextTime: number) => {
      time = nextTime;
      // Frames scheduled by a callback belong to the following paint.
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}

test("direct pointer moves render immediately at the physical position", () => {
  const view = camera();
  for (let x = 1; x <= 100; x++) {
    view.motion.move({ x, y: -x, zoom: 1 });
  }
  assert.deepEqual(view.read(), { x: 100, y: -100, zoom: 1 });
  assert.equal(view.pending(), 0);
  assert.equal(view.renders.length, 100);
});

test("pointer release after direct input has no delayed paint", () => {
  const view = camera();
  view.motion.move({ x: 80, y: -35, zoom: 1 });
  view.motion.stop();
  assert.deepEqual(view.read(), { x: 80, y: -35, zoom: 1 });
  assert.equal(view.pending(), 0);
  assert.equal(view.renders[0].edited, true);
  view.frameAt(32);
  assert.equal(view.renders.length, 1);
});

test("a same-frame resize does not erase an unsaved direct gesture", () => {
  const view = camera();
  view.motion.move({ x: 20, y: 10, zoom: 1 });
  view.motion.move({ x: 30, y: 15, zoom: 1 }, { edited: false });
  assert.deepEqual(view.renders, [
    { viewport: { x: 20, y: 10, zoom: 1 }, edited: true },
    { viewport: { x: 30, y: 15, zoom: 1 }, edited: false },
  ]);
});

test("wheel bursts accumulate unpainted deltas and settle on the next paint without a tail", () => {
  const view = camera();
  for (const [time, dx, dy] of [[0, 40, -10], [4, 30, -20], [8, 50, 5]]) {
    view.advanceTo(time);
    const target = view.motion.target("wheel");
    view.motion.move({ ...target, x: target.x + dx, y: target.y + dy }, { mode: "wheel" });
  }
  assert.deepEqual(view.motion.target("wheel"), { x: 120, y: -25, zoom: 1 });
  assert.equal(view.pending(), 1);
  view.frameAt(24);
  assert.deepEqual(view.read(), { x: 120, y: -25, zoom: 1 });
  assert.equal(view.pending(), 0);
  const paints = view.renders.length;
  view.frameAt(1000);
  assert.equal(view.renders.length, paints, "no synthetic momentum continues after settling");
});

test("reversing wheel direction replaces the pending destination without snapping", () => {
  const view = camera();
  view.motion.move({ x: 100, y: 0, zoom: 1 }, { mode: "wheel" });
  view.frameAt(30);
  const beforeReverse = { ...view.read() };
  const target = view.motion.target("wheel");
  view.motion.move({ ...target, x: target.x - 150 }, { mode: "wheel" });
  assert.deepEqual(view.read(), beforeReverse);
  view.frameAt(46);
  assert.deepEqual(view.read(), { x: -50, y: 0, zoom: 1 });
  assert.equal(view.pending(), 0);
});

test("explicit navigation eases toward its destination and settles after 220ms", () => {
  const view = camera();
  view.motion.move({ x: 800, y: -400, zoom: 2 }, { mode: "navigate", edited: false });
  view.frameAt(110);
  assert.ok(view.read().x > 0 && view.read().x < 800);
  assert.ok(view.read().y < 0 && view.read().y > -400);
  assert.ok(view.read().zoom > 1 && view.read().zoom < 2);
  assert.equal(view.renders[0].edited, false);
  view.frameAt(220);
  assert.deepEqual(view.read(), { x: 800, y: -400, zoom: 2 });
  assert.equal(view.pending(), 0);
});

test("a new drag takes over the displayed navigation position, not its unseen endpoint", () => {
  const view = camera();
  view.motion.move({ x: 1000, y: 500, zoom: 2 }, { mode: "navigate" });
  view.frameAt(70);
  const displayed = { ...view.read() };
  view.motion.stop();
  assert.deepEqual(view.read(), displayed);
  assert.deepEqual(view.motion.target("direct"), displayed);
  view.motion.move({ ...displayed, x: displayed.x + 12, y: displayed.y - 6 });
  view.frameAt(86);
  assert.deepEqual(view.read(), { ...displayed, x: displayed.x + 12, y: displayed.y - 6 });
  view.frameAt(1000);
  assert.equal(view.renders.length, 2);
});

test("switching from wheel to direct input also discards the unseen wheel endpoint", () => {
  const view = camera();
  view.motion.move({ x: 100, y: 0, zoom: 1 }, { mode: "wheel" });
  view.frameAt(30);
  const displayed = { ...view.read() };
  view.motion.move({ ...displayed, x: displayed.x + 5 });
  view.frameAt(46);
  assert.deepEqual(view.read(), { ...displayed, x: displayed.x + 5 });
  assert.equal(view.pending(), 0);
});

test("continuous wheel zoom keeps the pointer's world point fixed without a synthetic tail", () => {
  const initial = { x: -230, y: 90, zoom: 0.75 };
  const view = camera(initial);
  const pointer = { x: 420, y: 250 };
  const world = {
    x: (pointer.x - initial.x) / initial.zoom,
    y: (pointer.y - initial.y) / initial.zoom,
  };
  const assertAnchor = () => {
    assert.ok(Math.abs(view.read().x + world.x * view.read().zoom - pointer.x) < 1e-9);
    assert.ok(Math.abs(view.read().y + world.y * view.read().zoom - pointer.y) < 1e-9);
  };
  view.motion.move(zoomAt(view.motion.target("wheel"), 1, pointer), { mode: "wheel" });
  view.advanceTo(5);
  view.motion.move(zoomAt(view.motion.target("wheel"), 1.5, pointer), { mode: "wheel" });
  view.frameAt(21);
  assertAnchor();
  assert.equal(view.read().zoom, 1.5);
  view.advanceTo(25);
  view.motion.move(zoomAt(view.motion.target("wheel"), 2.25, pointer), { mode: "wheel" });
  view.frameAt(41);
  assertAnchor();
  assert.equal(view.read().zoom, 2.25);
  assert.equal(view.pending(), 0);
});

test("reduced motion reaches the latest destination on the first frame in every mode", () => {
  for (const mode of ["direct", "wheel", "navigate"] as const) {
    const view = camera(undefined, true);
    const target = { x: -120, y: 70, zoom: 1.8 };
    view.motion.move(target, { mode });
    view.frameAt(1);
    assert.deepEqual(view.read(), target);
    assert.equal(view.renders.length, 1);
    assert.equal(view.pending(), 0);
  }
});

test("document replacement cancels both pending pointer writes and animated camera writes", () => {
  for (const mode of ["direct", "wheel", "navigate"] as const) {
    const view = camera();
    view.motion.move({ x: 900, y: 500, zoom: 2 }, { mode });
    view.motion.cancel();
    const replacement = { x: -50, y: -80, zoom: 0.5 };
    view.replaceDocument(replacement);
    view.frameAt(500);
    assert.deepEqual(view.read(), replacement);
    assert.deepEqual(view.motion.target(mode), replacement);
    assert.equal(view.pending(), 0);
    assert.equal(view.renders.length, mode === "direct" ? 1 : 0);
  }
});

test("unmount cancellation during an animation leaves no delayed render", () => {
  const view = camera();
  view.motion.move({ x: 100, y: 200, zoom: 2 }, { mode: "navigate" });
  view.frameAt(16);
  const displayed = { ...view.read() };
  view.motion.cancel();
  view.frameAt(220);
  assert.deepEqual(view.read(), displayed);
  assert.equal(view.renders.length, 1);
  assert.equal(view.pending(), 0);
});

test("invalid coordinates and zooms are ignored without corrupting a pending valid move", () => {
  const invalid = [
    { x: NaN, y: 0, zoom: 1 },
    { x: 0, y: Infinity, zoom: 1 },
    { x: -Infinity, y: 0, zoom: 1 },
    { x: 0, y: 0, zoom: NaN },
    { x: 0, y: 0, zoom: Infinity },
    { x: 0, y: 0, zoom: 0 },
    { x: 0, y: 0, zoom: -1 },
  ];
  const view = camera();
  for (const target of invalid) view.motion.move(target);
  assert.equal(view.pending(), 0);
  assert.equal(view.renders.length, 0);
  const valid = { x: 80, y: 40, zoom: 1.5 };
  view.motion.move(valid, { mode: "wheel" });
  for (const target of invalid) view.motion.move(target);
  assert.deepEqual(view.motion.target("wheel"), valid);
  view.frameAt(90);
  assert.deepEqual(view.read(), valid);
  assert.equal(view.renders.length, 1);
});
