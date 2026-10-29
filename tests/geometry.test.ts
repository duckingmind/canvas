import assert from "node:assert/strict";
import test from "node:test";
import {
  arrangeGroupMembers,
  arrangeNodes,
  arrangeSmartNodes,
  arrangeGridNodes,
  layoutUnitCount,
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

test("all canvas edges participate in workflow depth calculation", () => {
  const nodes = [node("source"), node("value"), node("next")];
  const arranged = arrangeNodes(nodes, [
    { from: "source", to: "value" },
    { from: "value", to: "next" },
    { from: "source", to: "next" },
  ]);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  assert.equal(byId.get("source")!.x + byId.get("source")!.width + 120, byId.get("value")!.x);
  assert.ok(byId.get("next")!.x > byId.get("value")!.x);
});

test("independent workflow components are packed as separate islands", () => {
  const nodes = [
    { ...node("a"), x: 0, y: 0 },
    { ...node("b"), x: 300, y: 0 },
    { ...node("c"), x: 0, y: 900 },
    { ...node("d"), x: 300, y: 900 },
  ];
  const arranged = arrangeNodes(nodes, [
    { from: "a", to: "b" },
    { from: "c", to: "d" },
  ]);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  const first = getBounds([byId.get("a")!, byId.get("b")!])!;
  const second = getBounds([byId.get("c")!, byId.get("d")!])!;
  assert.ok(
    second.x >= first.x + first.width + 112,
    "disconnected workflows should have a visible island gap",
  );
  assert.equal(byId.get("a")!.y, byId.get("c")!.y);
  assert.deepEqual(
    arranged.map(({ id }) => id),
    nodes.map(({ id }) => id),
    "arrangement preserves the document node order",
  );
});

test("shared inputs and references remain one connected layout island", () => {
  const nodes = [
    { ...node("shared"), x: 0, y: 0 },
    { ...node("left"), x: 300, y: 0 },
    { ...node("right"), x: 300, y: 300 },
    { ...node("other"), x: 0, y: 900 },
    { ...node("other-result"), x: 300, y: 900 },
  ];
  const arranged = arrangeNodes(nodes, [
    { from: "shared", to: "left" },
    { from: "shared", to: "right" },
    { from: "other", to: "other-result" },
    { from: "left", to: "other" },
  ]);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  assert.equal(byId.get("left")!.x, byId.get("right")!.x);
  const sharedIsland = getBounds([byId.get("shared")!, byId.get("left")!, byId.get("right")!])!;
  const otherIsland = getBounds([byId.get("other")!, byId.get("other-result")!])!;
  assert.ok(otherIsland.x < sharedIsland.x + sharedIsland.width + 320);
});

test("weak connector between two dense workflow modules is separated into islands", () => {
  const first = Array.from({ length: 6 }, (_, index) => ({
    ...node(`first-${index}`, 100, 80),
    x: index * 130,
    y: 0,
  }));
  const second = Array.from({ length: 6 }, (_, index) => ({
    ...node(`second-${index}`, 100, 80),
    x: index * 130,
    y: 1200,
  }));
  const connector = { ...node("connector", 100, 80), x: 0, y: 1200 };
  const leaf = { ...node("connector-leaf", 100, 80), x: 130, y: 1200 };
  const nodes = [...first, ...second, connector, leaf];
  const edges = [
    ...first.flatMap((source, sourceIndex) => first.slice(sourceIndex + 1).map((target) => ({ from: source.id, to: target.id }))),
    ...second.flatMap((source, sourceIndex) => second.slice(sourceIndex + 1).map((target) => ({ from: source.id, to: target.id }))),
    // The connector touches the second module more often. A small leaf must
    // remain with that module instead of becoming its own island.
    { from: first[0].id, to: connector.id },
    { from: connector.id, to: second[0].id },
    { from: connector.id, to: second[1].id },
    { from: connector.id, to: second[2].id },
    { from: connector.id, to: leaf.id },
  ];
  const arranged = arrangeNodes(nodes, edges);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  const firstBounds = getBounds(first.map((item) => byId.get(item.id)!))!;
  const secondBounds = getBounds([...second, connector, leaf].map((item) => byId.get(item.id)!))!;
  assert.ok(
    secondBounds.x >= firstBounds.x + firstBounds.width + 112,
    "a sparse articulation should not collapse two internally dense modules into one island",
  );
  assert.equal(arranged.length, nodes.length);
  assert.deepEqual(arranged.map(({ id }) => id), nodes.map(({ id }) => id));
});

test("large fan-out layers wrap into columns without reversing workflow direction", () => {
  const source = node("source");
  const targets = Array.from({ length: 12 }, (_, index) => node(`target-${index}`));
  const nodes = [source, ...targets];
  const edges = targets.map((target) => ({ from: source.id, to: target.id }));
  const arranged = arrangeNodes(nodes, edges);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  const targetNodes = targets.map((target) => byId.get(target.id)!);
  const bounds = getBounds(arranged)!;

  assert.ok(new Set(targetNodes.map((target) => target.x)).size > 1,
    "a large same-depth layer should wrap into more than one horizontal lane");
  assert.ok(targetNodes.every((target) => target.x > byId.get(source.id)!.x),
    "wrapping a layer must keep dependency edges flowing to the right");
  assert.ok(bounds.height <= 1800,
    "fan-out layouts should avoid an unnecessarily long vertical stack");
});

test("smart arrangement chooses dependency flow for workflows and a compact grid otherwise", () => {
  const workflow = [
    { ...node("source"), x: 0, y: 0 },
    { ...node("result"), x: 900, y: 700 },
    { ...node("independent"), x: 0, y: 1400 },
  ];
  const flowed = arrangeSmartNodes(workflow, [{ from: "source", to: "result" }]);
  const flowById = new Map(flowed.map((item) => [item.id, item]));
  assert.ok(flowById.get("result")!.x > flowById.get("source")!.x);

  const cards = ["a", "b", "c", "d"].map((id, index) => ({
    ...node(id),
    x: index * 420,
    y: index * 170,
  }));
  const gridded = arrangeSmartNodes(cards, []);
  const gridById = new Map(gridded.map((item) => [item.id, item]));
  assert.equal(gridById.get("a")!.y, gridById.get("b")!.y);
  assert.ok(gridById.get("c")!.y > gridById.get("a")!.y);
  assert.deepEqual(arrangeSmartNodes(gridded, []), gridded);
});

test("smart arrangement gathers disconnected units into a compact grid beside workflows", () => {
  const workflow = [
    { ...node("source", 100, 80), x: 0, y: 0 },
    { ...node("result", 100, 80), x: 500, y: 0 },
  ];
  const loose = Array.from({ length: 6 }, (_, index) => ({
    ...node(`loose-${index}`, 100, 80),
    x: (index % 2) * 900,
    y: 500 + Math.floor(index / 2) * 500,
  }));
  const arranged = arrangeSmartNodes([...workflow, ...loose], [
    { from: "source", to: "result" },
  ]);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  const workflowBounds = getBounds([byId.get("source")!, byId.get("result")!])!;
  const looseBounds = getBounds(loose.map((item) => byId.get(item.id)!))!;

  assert.ok(byId.get("result")!.x > byId.get("source")!.x,
    "connected workflow keeps its directional layout");
  assert.ok(looseBounds.x >= workflowBounds.x + workflowBounds.width + 112,
    "loose units should form a separate nearby area instead of individual distant islands");
  assert.ok(looseBounds.width <= 2 * 100 + 32,
    "six loose units should wrap into a compact two-column grid");
  assert.ok(looseBounds.height <= 3 * 80 + 2 * 32,
    "six loose units should fit in three compact rows");
});

test("a single link forces workflow flow layout", () => {
  const nodes = [
    { ...node("a"), x: 0, y: 0 },
    { ...node("b"), x: 800, y: 400 },
  ];
  const arranged = arrangeSmartNodes(nodes, [{ from: "a", to: "b" }]);
  assert.ok(arranged[1].x > arranged[0].x);
});

test("references merge grouped units into one island", () => {
  const nodes = [
    { ...node("group-a", 100, 80), x: 0, y: 0, groupId: "g" },
    { ...node("group-b", 100, 80), x: 130, y: 20, groupId: "g" },
    { ...node("value", 120, 90), x: 400, y: 0 },
  ];
  const arranged = arrangeNodes(nodes, [
    { from: "group-a", to: "value" },
  ]);
  assert.ok(arranged[2].x > arranged[0].x);
});

test("barycenter sweeps still run inside each workflow island", () => {
  const nodes = [
    { ...node("a", 100, 80), x: 0, y: 0 },
    { ...node("b", 100, 80), x: 0, y: 400 },
    { ...node("c", 100, 80), x: 300, y: 0 },
    { ...node("d", 100, 80), x: 300, y: 400 },
  ];
  const arranged = arrangeNodes(nodes, [
    { from: "a", to: "d" },
    { from: "b", to: "c" },
  ]);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  assert.equal(byId.get("a")!.y, byId.get("d")!.y);
  assert.equal(byId.get("b")!.y, byId.get("c")!.y);
  assert.ok(byId.get("c")!.x >= byId.get("a")!.x + 100 + 112);
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

test("arrangement treats a group as one unit and preserves member offsets", () => {
  const nodes = [
    { ...node("group-a", 100, 80), x: 0, y: 0, groupId: "g" },
    { ...node("group-b", 120, 90), x: 260, y: 40, groupId: "g" },
    { ...node("outside", 100, 80), x: 30, y: 400 },
  ];
  const before = nodes.map(({ x, y }) => ({ x, y }));
  const arranged = arrangeNodes(nodes, [{ from: "group-b", to: "outside" }]);
  const groupOffset = { x: arranged[0].x - before[0].x, y: arranged[0].y - before[0].y };
  assert.deepEqual(
    { x: arranged[1].x - before[1].x, y: arranged[1].y - before[1].y },
    groupOffset,
  );
  assert.equal(layoutUnitCount(nodes), 2);
  assert.ok(arranged[2].x > arranged[1].x + arranged[1].width);
});

test("grid arrangement keeps grouped cards together and sizes rows by group bounds", () => {
  const nodes = [
    { ...node("a", 100, 80), x: 0, y: 0, groupId: "g" },
    { ...node("b", 120, 90), x: 260, y: 40, groupId: "g" },
    { ...node("c", 80, 60), x: 900, y: 0 },
  ];
  const arranged = arrangeGridNodes(nodes, 1);
  assert.equal(arranged[0].y, arranged[1].y - 40);
  assert.equal(arranged[0].x + 260, arranged[1].x);
  assert.ok(arranged[2].x >= arranged[1].x + arranged[1].width + 32);
});

test("explicit group-content arrangement changes positions without changing membership or lineage", () => {
  const nodes = [
    { ...node("a", 100, 80), x: 0, y: 0, groupId: "g", resultOf: "creator" },
    { ...node("b", 120, 90), x: 900, y: 500, groupId: "g", resultOf: "creator" },
  ];
  const arranged = arrangeGroupMembers(nodes, []);
  assert.notDeepEqual(
    arranged.map(({ x, y }) => ({ x, y })),
    nodes.map(({ x, y }) => ({ x, y })),
  );
  assert.deepEqual(
    arranged.map(({ groupId, resultOf }) => ({ groupId, resultOf })),
    nodes.map(({ groupId, resultOf }) => ({ groupId, resultOf })),
  );
  assert.deepEqual(arrangeGroupMembers(arranged, []), arranged);
});

test("hidden completed creator metadata does not inflate the visible group unit", () => {
  const nodes = [
    { ...node("creator", 160, 100), x: -900, y: -900, type: "prompt", groupId: "g" },
    { ...node("result", 200, 140), x: 0, y: 0, type: "image", resultOf: "creator", groupId: "g" },
    { ...node("outside", 100, 80), x: 600, y: 0, type: "note" },
  ];
  const arranged = arrangeNodes(nodes, [{ from: "result", to: "outside" }]);
  assert.equal(arranged[1].x, 100);
  assert.equal(arranged[1].y, 100);
  assert.equal(arranged[0].x, -800);
  assert.equal(arranged[0].y, -800);
});

test("implicit result and continuation lineage remains one layout unit", () => {
  const nodes = [
    { ...node("creator", 140, 90), x: 0, y: 0, type: "prompt" },
    { ...node("result", 180, 120), x: 300, y: 20, type: "image", resultOf: "creator" },
    { ...node("continuation", 160, 100), x: 620, y: 40, type: "prompt", continuationOf: "result" },
    { ...node("outside", 120, 80), x: 900, y: 0 },
  ];
  const before = nodes.map(({ id, x, y }) => ({ id, x, y }));
  const arranged = arrangeNodes(nodes, [
    { from: "continuation", to: "outside" },
  ]);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  const original = new Map(before.map((item) => [item.id, item]));
  const creator = byId.get("creator")!, result = byId.get("result")!, continuation = byId.get("continuation")!;
  assert.equal(layoutUnitCount(nodes), 2);
  assert.equal(result.x - creator.x, original.get("result")!.x - original.get("creator")!.x);
  assert.equal(continuation.x - result.x, original.get("continuation")!.x - original.get("result")!.x);
  assert.ok(byId.get("outside")!.x > continuation.x);
});
