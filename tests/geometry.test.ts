import assert from "node:assert/strict";
import test from "node:test";
import {
  arrangeNodes,
  clampZoom,
  displayGridStep,
  connectorPath,
  connectorPortSide,
  fitViewport,
  getBounds,
  magneticPortDistance,
  magneticRadiusForZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  minimapBounds,
  nearestMagneticPort,
  isRectInViewport,
  intersectsRect,
  viewportBounds,
  zoomAt,
  zoomIndicatorPosition,
} from "../src/geometry.ts";

const rect = (x: number, y: number, width = 240, height = 180) => ({
  x,
  y,
  width,
  height,
});
const node = (id: string, width = 240, height = 180) => ({
  id,
  ...rect(0, 0, width, height),
  title: `Node ${id}`,
});

test("bounds include full rectangles at negative coordinates, and tolerate empty documents", () => {
  assert.equal(getBounds([]), null);
  assert.deepEqual(
    getBounds([rect(-500, -200, 200, 300), rect(40, 60, 300, 100)]),
    rect(-500, -200, 840, 360),
  );
  assert.equal(getBounds([rect(NaN, 0)]), null);
});

test("fit uses actual bounds, centers the document and leaves the requested screen padding", () => {
  const nodes = [rect(-600, -200, 300, 200), rect(300, 300, 600, 400)];
  const size = { width: 1100, height: 800 },
    view = fitViewport(nodes, size, 100);
  const bounds = getBounds(nodes)!;
  assert.equal(view.zoom, 0.6);
  assert.equal(
    view.x + (bounds.x + bounds.width / 2) * view.zoom,
    size.width / 2,
  );
  assert.equal(
    view.y + (bounds.y + bounds.height / 2) * view.zoom,
    size.height / 2,
  );
  assert.ok(view.x + bounds.x * view.zoom >= 100);
  assert.ok(view.y + bounds.y * view.zoom >= 100);
  assert.equal(fitViewport([rect(0, 0, 10, 10)], size).zoom, 1);
  assert.deepEqual(fitViewport([], size), { x: 0, y: 0, zoom: 1 });
});

test("fit can show large canvases below 20% while preserving padding", () => {
  const bounds = rect(-4000, -2000, 10000, 5000);
  const size = { width: 1200, height: 800 };
  const view = fitViewport([bounds], size, 100);
  assert.equal(view.zoom, 0.1);
  assert.ok(view.x + bounds.x * view.zoom >= 100);
  assert.ok(view.x + (bounds.x + bounds.width) * view.zoom <= size.width - 100);
  assert.ok(view.y + bounds.y * view.zoom >= 100);
  assert.ok(view.y + (bounds.y + bounds.height) * view.zoom <= size.height - 100);
});

test("pointer anchored zoom preserves the world coordinate even at both zoom limits", () => {
  const view = { x: -380, y: 145, zoom: 0.8 },
    pointer = { x: 465, y: 230 };
  for (const requested of [0.01, 1.3, 8]) {
    const next = zoomAt(view, requested, pointer);
    assert.ok(next.zoom >= MIN_ZOOM && next.zoom <= MAX_ZOOM);
    assert.ok(
      Math.abs(
        (pointer.x - next.x) / next.zoom - (pointer.x - view.x) / view.zoom,
      ) < 1e-9,
    );
    assert.ok(
      Math.abs(
        (pointer.y - next.y) / next.zoom - (pointer.y - view.y) / view.zoom,
      ) < 1e-9,
    );
  }
});

test("zoom scale exposes one stable minimum and maximum contract", () => {
  assert.equal(MIN_ZOOM, 0.05);
  assert.equal(MAX_ZOOM, 3);
  assert.equal(clampZoom(0), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
});

test("display grid stays readable throughout the zoom range without changing snap intervals", () => {
  for (const size of [10, 20, 40]) {
    for (let percent = 5; percent <= 300; percent++) {
      const zoom = percent / 100;
      const step = displayGridStep(size, zoom);
      assert.ok(step * zoom >= 16 - 1e-9);
      assert.ok(step * zoom <= Math.max(32, size * zoom));
      assert.ok(Number.isInteger(Math.log2(step / size)));
    }
  }
  assert.equal(displayGridStep(20, 1), 20);
  assert.equal(displayGridStep(20, 0.05) * 0.05, 16);
});

test("zoom ruler keeps 100% centered and moves monotonically with zoom", () => {
  assert.equal(zoomIndicatorPosition(MIN_ZOOM), 0);
  assert.equal(zoomIndicatorPosition(1), 50);
  assert.equal(zoomIndicatorPosition(MAX_ZOOM), 100);
  assert.ok(zoomIndicatorPosition(0.46) < 50);
  assert.ok(zoomIndicatorPosition(1.5) > 50);
  assert.ok(zoomIndicatorPosition(0.6) < zoomIndicatorPosition(0.8));
  assert.ok(zoomIndicatorPosition(1.5) < zoomIndicatorPosition(2.5));
});

test("viewport bounds convert screen margins to world coordinates", () => {
  assert.deepEqual(
    viewportBounds({ x: 100, y: -40, zoom: 2 }, { width: 800, height: 600 }, 20),
    { x: -60, y: 10, width: 420, height: 320 },
  );
  assert.equal(
    isRectInViewport(rect(-80, 10, 20, 20), { x: 100, y: -40, zoom: 2 }, { width: 800, height: 600 }, 0),
    false,
  );
  assert.equal(
    isRectInViewport(rect(-30, 20, 20, 20), { x: 100, y: -40, zoom: 2 }, { width: 800, height: 600 }, 0),
    true,
  );
});

test("viewport intersection rejects invalid rectangles without throwing", () => {
  assert.equal(intersectsRect(rect(0, 0), rect(300, 300)), false);
  assert.equal(intersectsRect(rect(0, 0), { x: NaN, y: 0, width: 20, height: 20 }), false);
  assert.equal(intersectsRect(rect(0, 0), rect(300, 200, 20, 20)), false);
});

test("connector paths follow the facing ports when a node is moved either side", () => {
  const left = rect(0, 40, 200, 100);
  const right = rect(500, 80, 220, 140);
  const forward = connectorPath(left, right);
  assert.match(forward, /^M 200 90 C /);
  assert.match(forward, / 500 150$/);

  const backward = connectorPath(right, left);
  assert.match(backward, /^M 500 150 C /);
  assert.match(backward, / 200 90$/);
  // A backwards connection must never leave the source's right port and
  // travel around the entire board.
  assert.ok(!backward.includes("M 720"));
});

test("connector port sides stay aligned with the facing connector path", () => {
  const left = rect(0, 40, 200, 100);
  const right = rect(500, 80, 220, 140);
  assert.equal(connectorPortSide(left, right, "source"), "right");
  assert.equal(connectorPortSide(left, right, "target"), "left");
  assert.equal(connectorPortSide(right, left, "source"), "left");
  assert.equal(connectorPortSide(right, left, "target"), "right");
});

test("nearest magnetic port floats in the closest outside semicircle", () => {
  const nodes = [{ id: "card", ...rect(100, 80, 240, 160) }];
  const right = nearestMagneticPort(nodes, { x: 352, y: 160 }, 12);
  assert.deepEqual(right, { nodeId: "card", side: "right", x: 352, y: 160 });

  const left = nearestMagneticPort(nodes, { x: 88, y: 180 }, 24);
  assert.deepEqual(left, { nodeId: "card", side: "left", x: 88, y: 180 });
});

test("nearest magnetic port only accepts the outside half of each semicircle", () => {
  const nodes = [{ id: "card", ...rect(100, 80, 240, 160) }];
  assert.deepEqual(
    nearestMagneticPort(nodes, { x: 80, y: 180 }, 60),
    { nodeId: "card", side: "left", x: 80, y: 180 },
  );
  assert.equal(nearestMagneticPort(nodes, { x: 200, y: 160 }, 60), null);
  assert.equal(nearestMagneticPort(nodes, { x: 100, y: 300 }, 60), null);
  assert.equal(nearestMagneticPort(nodes, { x: NaN, y: 120 }, 12), null);
});

test("magnetic port side filters keep wire targets on the facing side", () => {
  const nodes = [{ id: "card", ...rect(100, 80, 240, 160) }];
  const rightOnly = nearestMagneticPort(
    nodes,
    { x: 350, y: 160 },
    20,
    (_node, side) => side === "right",
  );
  assert.deepEqual(rightOnly, { nodeId: "card", side: "right", x: 350, y: 160 });
  assert.equal(
    magneticPortDistance(nodes[0], "left", { x: 350, y: 160 }),
    Infinity,
  );
  assert.equal(
    magneticPortDistance(nodes[0], "right", { x: 350, y: 160 }),
    Math.hypot(10, 0),
  );
});

test("custom connector endpoints stay aligned with floating magnetic ports", () => {
  const from = rect(0, 40, 200, 100);
  const to = rect(500, 80, 220, 140);
  const path = connectorPath(from, to, { x: 214, y: 104 }, { x: 486, y: 180 });
  assert.match(path, /^M 214 104 C /);
  assert.match(path, / 486 180$/);
});

test("straight connectors keep facing endpoints and floating magnetic coordinates", () => {
  const from = rect(0, 40, 200, 100), to = rect(500, 80, 220, 140);
  assert.equal(connectorPath(from, to, undefined, undefined, "straight"), "M 200 90 L 500 150");
  assert.equal(connectorPath(to, from, undefined, undefined, "straight"), "M 500 150 L 200 90");
  assert.equal(connectorPath(from, to, { x: 214, y: 104 }, { x: 486, y: 180 }, "straight"), "M 214 104 L 486 180");
  assert.equal(connectorPath(from, to, undefined, undefined, "bezier"), connectorPath(from, to));
});

test("orthogonal connectors route around horizontal, stacked and closely spaced cards", () => {
  const cases = [
    [rect(0, 0, 200, 100), rect(500, 80, 220, 140)],
    [rect(0, 0, 200, 100), rect(40, 200, 220, 140)],
    [rect(0, 0, 200, 100), rect(0, 200, 200, 100)],
    [rect(0, 0, 200, 100), rect(208, 60, 200, 100)],
  ];
  for (const pair of cases) for (const [from, to] of [pair, [...pair].reverse()]) {
    const path = connectorPath(from, to, undefined, undefined, "orthogonal");
    assert.doesNotMatch(path, /C|NaN|Infinity/);
    const coordinates = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const points = Array.from({ length: coordinates.length / 2 }, (_, index) => ({ x: coordinates[index * 2], y: coordinates[index * 2 + 1] }));
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      assert.ok(a.x === b.x || a.y === b.y, `segment should be orthogonal: ${path}`);
      for (const card of [from, to]) {
        const crosses = a.x === b.x
          ? a.x > card.x && a.x < card.x + card.width && Math.max(a.y, b.y) > card.y && Math.min(a.y, b.y) < card.y + card.height
          : a.y > card.y && a.y < card.y + card.height && Math.max(a.x, b.x) > card.x && Math.min(a.x, b.x) < card.x + card.width;
        assert.equal(crosses, false, `segment must not pass through either card: ${path}`);
      }
    }
  }
});

test("straight connectors detour when a direct line would pass through a stacked card", () => {
  const from = rect(0, 0, 200, 100), to = rect(0, 200, 200, 100);
  assert.equal(
    connectorPath(from, to, undefined, undefined, "straight"),
    connectorPath(from, to, undefined, undefined, "orthogonal"),
  );
  const floating = connectorPath(from, to, { x: 214, y: 60 }, { x: -14, y: 260 }, "orthogonal");
  assert.match(floating, /^M 214 60 L /);
  assert.match(floating, / L -14 260$/);
  assert.doesNotMatch(connectorPath(from, from, undefined, undefined, "orthogonal"), /NaN|Infinity/);
});

test("magnetic hit areas keep a usable minimum and grow at high zoom", () => {
  const nodes = [{ id: "card", ...rect(100, 80, 240, 160) }];
  const edgeX = 340;
  const centerY = 160;

  const lowZoom = 0.2;
  const lowRadius = magneticRadiusForZoom(44, lowZoom);
  const lowPointer = { x: edgeX + 40 / lowZoom, y: centerY };
  assert.deepEqual(
    nearestMagneticPort(nodes, lowPointer, lowRadius),
    { nodeId: "card", side: "right", ...lowPointer },
    "low zoom keeps at least a 40px screen affordance",
  );

  const highZoom = 3;
  const highRadius = magneticRadiusForZoom(44, highZoom);
  const highPointer = { x: edgeX + 72 / highZoom, y: centerY };
  assert.deepEqual(
    nearestMagneticPort(nodes, highPointer, highRadius),
    { nodeId: "card", side: "right", ...highPointer },
    "high zoom grows the affordance with the visually larger node",
  );
  const outsideHighPointer = { x: edgeX + 88 / highZoom, y: centerY };
  assert.equal(
    nearestMagneticPort(nodes, outsideHighPointer, highRadius),
    null,
    "high zoom still detaches outside the adaptive enter range",
  );
});

test("magnetic enter and exit radii preserve hysteresis across adaptive zoom ranges", () => {
  const card = { id: "card", ...rect(100, 80, 240, 160) };
  const edgeX = card.x + card.width;
  const centerY = card.y + card.height / 2;
  for (const zoom of [0.2, 1, 3]) {
    const enterRadius = magneticRadiusForZoom(44, zoom);
    const exitRadius = magneticRadiusForZoom(60, zoom);
    const screenGap = ((enterRadius + exitRadius) / 2) * zoom;
    const betweenRadii = { x: edgeX + screenGap / zoom, y: centerY };
    assert.equal(
      nearestMagneticPort([card], betweenRadii, enterRadius),
      null,
      `a new handle should not enter in the hysteresis band for zoom ${zoom}`,
    );
    assert.ok(
      magneticPortDistance(card, "right", betweenRadii) <= exitRadius,
      `an active handle should remain attached in the hysteresis band for zoom ${zoom}`,
    );
    const outsideExit = { x: edgeX + (exitRadius * zoom + 1) / zoom, y: centerY };
    assert.ok(
      magneticPortDistance(card, "right", outsideExit) > exitRadius,
      `an active handle should detach after the adaptive exit radius for zoom ${zoom}`,
    );
  }
});

test("minimap includes the visible world and offscreen content on both sides of the origin", () => {
  const view = { x: 200, y: -100, zoom: 0.5 },
    size = { width: 800, height: 600 };
  assert.deepEqual(minimapBounds([], view, size), rect(-400, 200, 1600, 1200));
  assert.deepEqual(
    minimapBounds(
      [rect(-900, -500, 200, 100), rect(1900, 1800, 300, 200)],
      view,
      size,
    ),
    rect(-900, -500, 3100, 2500),
  );
});

test("arrange respects dependency depth, actual dimensions, metadata, and input immutability", () => {
  const nodes = [
    node("a", 470, 120),
    node("b", 220, 400),
    node("c", 330, 250),
    node("d", 180, 510),
  ];
  const original = structuredClone(nodes);
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "d", to: "c" },
  ];
  const arranged = arrangeNodes(nodes, edges),
    [a, b, c, d] = arranged;
  assert.deepEqual(nodes, original);
  assert.equal(a.x, d.x);
  assert.ok(d.y > a.y + a.height);
  assert.ok(b.x > Math.max(a.x + a.width, d.x + d.width));
  assert.ok(c.x > b.x + b.width);
  assert.deepEqual(
    arranged.map(({ id, title, width, height }) => ({
      id,
      title,
      width,
      height,
    })),
    original.map(({ id, title, width, height }) => ({
      id,
      title,
      width,
      height,
    })),
  );
  for (let first = 0; first < arranged.length; first++) {
    for (let second = first + 1; second < arranged.length; second++) {
      const l = arranged[first],
        r = arranged[second];
      assert.ok(
        l.x + l.width <= r.x ||
          r.x + r.width <= l.x ||
          l.y + l.height <= r.y ||
          r.y + r.height <= l.y,
      );
    }
  }
});

test("cycles, duplicate edges, self edges and missing targets cannot break arrangement", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => node(id));
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
    { from: "a", to: "a" },
    { from: "b", to: "c" },
    { from: "b", to: "c" },
    { from: "c", to: "missing" },
  ];
  const arranged = arrangeNodes(nodes, edges),
    [a, b, c] = arranged;
  assert.equal(a.x, b.x);
  assert.notEqual(a.y, b.y);
  assert.ok(c.x > b.x);
  const shuffled = arrangeNodes(
    [...nodes].reverse(),
    [...edges].reverse(),
  ).sort((l, r) => l.id.localeCompare(r.id));
  assert.deepEqual(shuffled, arranged);
  assert.deepEqual(arrangeNodes(arranged, edges), arranged);
});

test("large chains arrange without recursive stack overflow", () => {
  const nodes = Array.from({ length: 12000 }, (_, index) =>
    node(String(index).padStart(5, "0"), 100, 100),
  );
  const edges = nodes
    .slice(1)
    .map((item, index) => ({ from: nodes[index].id, to: item.id }));
  const arranged = arrangeNodes(nodes, edges);
  assert.equal(arranged.length, nodes.length);
  assert.ok(arranged[11999].x > arranged[11998].x + arranged[11998].width);
});
