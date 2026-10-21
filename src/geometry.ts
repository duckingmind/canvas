export type Rect = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };

type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Edge = { from: string; to: string };
export type PortSide = "left" | "right";
export type ConnectorStyle = "bezier" | "straight" | "orthogonal";
export type MagneticPort = {
  nodeId: string;
  side: PortSide;
  /** World-space position of the transient port inside the side semicircle. */
  x: number;
  y: number;
};

/** Supported canvas scale range. Keep this contract shared by gestures and UI. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;
const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

/**
 * Build a connector path using the side of each card that faces the other
 * card. Older canvases always started on the right and ended on the left;
 * moving a result back to the left therefore made the edge loop around the
 * whole board and appear to connect to unrelated nodes. Cards expose
 * horizontal connection sides; during a live drag the optional endpoints may
 * float in the corresponding outside semicircles while persisted edges use
 * the card edges.
 */
export function connectorPath(
  from: Rect,
  to: Rect,
  fromPort?: Point,
  toPort?: Point,
  style: ConnectorStyle = "bezier",
): string {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const forward = toCenter.x >= fromCenter.x;
  const start = {
    x: forward ? from.x + from.width : from.x,
    y: fromCenter.y,
  };
  const end = { x: forward ? to.x : to.x + to.width, y: toCenter.y };
  const resolvedStart = fromPort && Number.isFinite(fromPort.x) && Number.isFinite(fromPort.y)
    ? fromPort
    : start;
  const resolvedEnd = toPort && Number.isFinite(toPort.x) && Number.isFinite(toPort.y)
    ? toPort
    : end;
  if (style !== "bezier") {
    const obstacles = [from, to];
    if (style === "straight" && !obstacles.some((rect) => segmentCrossesInterior(resolvedStart, resolvedEnd, rect))) {
      return `M ${resolvedStart.x} ${resolvedStart.y} L ${resolvedEnd.x} ${resolvedEnd.y}`;
    }
    return orthogonalConnector(resolvedStart, resolvedEnd, from, to);
  }
  const distance = Math.abs(resolvedEnd.x - resolvedStart.x);
  // Keep a visible horizontal lead even when cards are stacked vertically,
  // while avoiding huge loops for nearby cards.
  const lead = Math.max(42, Math.min(180, distance * 0.45));
  const direction = resolvedEnd.x >= resolvedStart.x ? 1 : -1;
  return `M ${resolvedStart.x} ${resolvedStart.y} C ${resolvedStart.x + direction * lead} ${resolvedStart.y}, ${resolvedEnd.x - direction * lead} ${resolvedEnd.y}, ${resolvedEnd.x} ${resolvedEnd.y}`;
}

/** Whether the segment enters an open rectangle; touching its border is safe. */
function segmentCrossesInterior(start: Point, end: Point, rect: Rect): boolean {
  let enter = 0, exit = 1;
  for (const [a, b, low, high] of [
    [start.x, end.x, rect.x, rect.x + rect.width],
    [start.y, end.y, rect.y, rect.y + rect.height],
  ]) {
    if (low === high) return false;
    if (a === b) {
      if (a <= low || a >= high) return false;
    } else {
      const first = (low - a) / (b - a), last = (high - a) / (b - a);
      enter = Math.max(enter, Math.min(first, last));
      exit = Math.min(exit, Math.max(first, last));
    }
  }
  return enter < exit - 1e-9;
}

/** Route around the two endpoint cards, including vertically stacked cards. */
function orthogonalConnector(start: Point, end: Point, from: Rect, to: Rect): string {
  const clearance = 24;
  const obstacles = [from, to];
  const lead = (point: Point, card: Rect, other: Rect): Point => {
    const direction = point.x >= card.x + card.width / 2 ? 1 : -1;
    let distance = clearance;
    if (point.y > other.y && point.y < other.y + other.height) {
      const gap = direction > 0 ? other.x - point.x : point.x - other.x - other.width;
      if (gap >= 0) distance = Math.min(distance, gap / 2);
    }
    return { x: point.x + direction * distance, y: point.y };
  };
  const first = lead(start, from, to), last = lead(end, to, from);
  const candidates: Point[][] = [];
  for (const x of [
    (start.x + end.x) / 2,
    Math.min(from.x, to.x, start.x, end.x) - clearance,
    Math.max(from.x + from.width, to.x + to.width, start.x, end.x) + clearance,
  ]) candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
  const gapY = from.y + from.height <= to.y
    ? (from.y + from.height + to.y) / 2
    : to.y + to.height <= from.y ? (to.y + to.height + from.y) / 2 : (start.y + end.y) / 2;
  for (const y of [
    gapY,
    Math.min(from.y, to.y, start.y, end.y) - clearance,
    Math.max(from.y + from.height, to.y + to.height, start.y, end.y) + clearance,
  ]) candidates.push([start, first, { x: first.x, y }, { x: last.x, y }, last, end]);
  const length = (points: Point[]) => points.slice(1).reduce((sum, point, index) =>
    sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
  const safe = candidates.filter((points) => points.slice(1).every((point, index) =>
    obstacles.every((rect) => !segmentCrossesInterior(points[index], point, rect))));
  // Overlapping cards may contain each other's ports, so no obstacle-free
  // route exists. Keep a finite, deterministic route until they are separated.
  const points = (safe.length ? safe.sort((a, b) => length(a) - length(b))[0] : candidates[0])
    .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

/**
 * Return the horizontal port side used by a connector between two cards.
 * Keeping this rule beside connectorPath prevents the visual port and the
 * SVG edge from disagreeing when the source is positioned to the right of its
 * target.
 */
export function connectorPortSide(
  from: Rect,
  to: Rect,
  role: "source" | "target",
): PortSide {
  const fromCenter = from.x + from.width / 2;
  const toCenter = to.x + to.width / 2;
  const forward = toCenter >= fromCenter;
  if (role === "source") return forward ? "right" : "left";
  return forward ? "left" : "right";
}

/**
 * Resolve the magnetic range in world coordinates. The range keeps a minimum
 * screen affordance while still growing with the canvas at high zoom, so a
 * visually large node does not require pixel-perfect pointer placement.
 */
export function magneticRadiusForZoom(baseRadius: number, zoom: number): number {
  if (!Number.isFinite(baseRadius) || baseRadius <= 0) return 0;
  const safeZoom = Math.max(MIN_ZOOM, finite(zoom, 1));
  const screenStable = baseRadius / safeZoom;
  const worldFloor = baseRadius * 0.65;
  return Math.max(screenStable, worldFloor);
}

/**
 * Distance from a pointer to one of a node's outside side semicircles.
 *
 * Each semicircle is centered on the midpoint of the corresponding node edge
 * and only includes the outside half-plane. `Infinity` means the pointer is
 * on the wrong side (or the rectangle/point is invalid). Keeping the midpoint
 * anchor preserves the detached half-arc interaction instead of making the
 * handle slide along the whole edge.
 */
export function magneticPortDistance(
  node: Rect,
  side: PortSide,
  pointer: Point,
): number {
  if (!validRect(node) || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return Infinity;
  const edgeX = side === "left" ? node.x : node.x + node.width;
  const centerY = node.y + node.height / 2;
  const outside = side === "left" ? pointer.x <= edgeX : pointer.x >= edgeX;
  if (!outside) return Infinity;
  return Math.hypot(pointer.x - edgeX, pointer.y - centerY);
}

/**
 * Find the one port nearest to a pointer in the nodes' outside semicircles.
 *
 * `radius` is in world coordinates. A fixed world radius therefore grows and
 * shrinks with the canvas view; callers can use `magneticRadiusForZoom` to keep
 * the range usable across zoom levels. The returned position is the pointer
 * itself, allowing the transient handle to float freely through the semicircle
 * instead of sliding along the node edge. An optional side filter is used
 * by wire-target hit testing when a connection must enter the side facing its
 * source.
 */
export function nearestMagneticPort<T extends Rect & { id: string }>(
  nodes: readonly T[],
  pointer: Point,
  radius: number,
  allowSide?: (node: T, side: PortSide) => boolean,
): MagneticPort | null {
  if (!Number.isFinite(radius) || radius < 0) return null;
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;

  let best: { result: MagneticPort; distance: number; order: number } | null = null;
  let order = 0;
  for (const node of nodes) {
    if (!validRect(node) || !node.id) continue;
    for (const side of ["left", "right"] as const) {
      if (allowSide && !allowSide(node, side)) {
        order += 1;
        continue;
      }
      const distance = magneticPortDistance(node, side, pointer);
      const result = { nodeId: node.id, side, x: pointer.x, y: pointer.y };
      // Keep the first candidate on an exact tie. This preserves document
      // order and avoids a port flickering between overlapping cards.
      if (
        distance <= radius &&
        (!best || distance < best.distance || (distance === best.distance && order < best.order))
      ) {
        best = { result, distance, order };
      }
      order += 1;
    }
  }
  return best?.result || null;
}
export const clampZoom = (value: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finite(value, 1)));

/** Thin the rendered grid at low zoom without changing the snapping grid. */
export function displayGridStep(gridSize: number, zoom: number): number {
  const base = Math.max(1, finite(gridSize, 20));
  const screenStep = base * clampZoom(zoom);
  const level = Math.max(0, Math.ceil(Math.log2(16 / screenStep)));
  return base * 2 ** level;
}

/** Map the supported zoom range to the visual ruler, keeping 100% centered. */
export function zoomIndicatorPosition(value: number): number {
  const zoom = clampZoom(value);
  if (zoom <= 1) {
    return (
      (Math.log(zoom) - Math.log(MIN_ZOOM)) /
      (Math.log(1) - Math.log(MIN_ZOOM)) *
      50
    );
  }
  return 50 + (
    (Math.log(zoom) - Math.log(1)) /
    (Math.log(MAX_ZOOM) - Math.log(1)) *
    50
  );
}
const validRect = (rect: Rect) =>
  [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
  rect.width >= 0 &&
  rect.height >= 0;

/** Convert the screen viewport to world coordinates with a screen-space margin. */
export function viewportBounds(
  viewport: Viewport,
  size: Size,
  margin = 0,
): Rect {
  const zoom = clampZoom(viewport.zoom);
  const width = Math.max(0, finite(size.width));
  const height = Math.max(0, finite(size.height));
  const inset = Math.max(0, finite(margin));
  return {
    x: (-finite(viewport.x) - inset) / zoom,
    y: (-finite(viewport.y) - inset) / zoom,
    width: (width + inset * 2) / zoom,
    height: (height + inset * 2) / zoom,
  };
}

/** True when a world-space rectangle intersects the visible world window. */
export function intersectsRect(a: Rect, b: Rect): boolean {
  if (!validRect(a) || !validRect(b)) return false;
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/** Viewport test kept pure so rendering and performance tests share the rule. */
export function isRectInViewport(
  rect: Rect,
  viewport: Viewport,
  size: Size,
  margin = 0,
): boolean {
  return intersectsRect(rect, viewportBounds(viewport, size, margin));
}

/** World-space bounds; empty and invalid-only inputs have no bounds. */
export function getBounds(nodes: readonly Rect[]): Rect | null {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const node of nodes) {
    if (!validRect(node)) continue;
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return left === Infinity
    ? null
    : { x: left, y: top, width: right - left, height: bottom - top };
}

/** Center the content in the available board, without enlarging it by default. */
export function fitViewport(
  nodes: readonly Rect[],
  size: Size,
  padding = 100,
  maxZoom = 1,
): Viewport {
  const bounds = getBounds(nodes);
  if (!bounds) return { x: 0, y: 0, zoom: 1 };
  const width = Math.max(0, finite(size.width)),
    height = Math.max(0, finite(size.height));
  const inset = Math.max(0, finite(padding));
  const zoom = clampZoom(
    Math.min(
      clampZoom(maxZoom),
      Math.max(1, width - inset * 2) / Math.max(1, bounds.width),
      Math.max(1, height - inset * 2) / Math.max(1, bounds.height),
    ),
  );
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}

/** Keep the world point beneath a board-local pointer stationary while zooming. */
export function zoomAt(view: Viewport, zoom: number, point: Point): Viewport {
  const nextZoom = clampZoom(zoom);
  const previousZoom =
    Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
  const x = finite(point.x),
    y = finite(point.y);
  return {
    x: x - ((x - finite(view.x)) / previousZoom) * nextZoom,
    y: y - ((y - finite(view.y)) / previousZoom) * nextZoom,
    zoom: nextZoom,
  };
}

/** Distances are CSS pixels, independent of the canvas zoom. */
export const dragThreshold = (pointerType: string) => pointerType === "touch" ? 8 : 5;

/** Ctrl/Meta (including browser pinch) always zooms; Shift temporarily pans. */
export function wheelViewport(
  view: Viewport,
  event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  pointer: Point,
  size: Size,
  options: { defaultAction?: "pan" | "zoom"; panSensitivity?: number } = {},
): Viewport {
  const dx = finite(event.deltaX) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.width : 1);
  const dy = finite(event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
  if (event.ctrlKey || event.metaKey || (options.defaultAction === "zoom" && !event.shiftKey))
    return zoomAt(view, view.zoom * Math.exp(Math.max(-2, Math.min(2, -dy * 0.01))), pointer);
  const sensitivity = Math.min(3, Math.max(0.25, finite(options.panSensitivity ?? 1, 1)));
  return event.shiftKey && dx === 0
    ? { ...view, x: view.x - dy * sensitivity }
    : { ...view, x: view.x - dx * sensitivity, y: view.y - dy * sensitivity };
}

/** Preserve the world point under the moving midpoint, including at zoom limits. */
export function pinchViewport(view: Viewport, start: readonly [Point, Point], current: readonly [Point, Point]): Viewport {
  const midpoint = (points: readonly [Point, Point]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const distance = (points: readonly [Point, Point]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const from = midpoint(start), to = midpoint(current);
  const initialDistance = distance(start);
  const zoomed = zoomAt(view, view.zoom * (initialDistance < 1 ? 1 : distance(current) / initialDistance), from);
  return { ...zoomed, x: zoomed.x + to.x - from.x, y: zoomed.y + to.y - from.y };
}

/** Include the visible world so the minimap remains useful while panning away. */
export function minimapBounds(
  nodes: readonly Rect[],
  viewport: Viewport,
  size: Size,
): Rect {
  const zoom =
    Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const visible = {
    x: -finite(viewport.x) / zoom,
    y: -finite(viewport.y) / zoom,
    width: Math.max(0, finite(size.width)) / zoom,
    height: Math.max(0, finite(size.height)) / zoom,
  };
  return getBounds([...nodes, visible])!;
}

/**
 * Arrange a directed workflow into columns, using the longest upstream depth.
 * Cyclic groups share a column. Iterative graph walks also handle large imports.
 * IDs provide stable ordering; the returned array keeps the caller's node order.
 */
export function arrangeNodes<T extends Rect & { id: string }>(
  nodes: readonly T[],
  edges: readonly Edge[],
): T[] {
  if (!nodes.length) return [];
  const ids = [...new Set(nodes.map((node) => node.id))].sort();
  const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
  const incoming = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    if (
      !outgoing.has(edge.from) ||
      !outgoing.has(edge.to) ||
      edge.from === edge.to
    )
      continue;
    outgoing.get(edge.from)!.add(edge.to);
    incoming.get(edge.to)!.add(edge.from);
  }
  const forward = new Map(ids.map((id) => [id, [...outgoing.get(id)!].sort()]));
  const reverse = new Map(ids.map((id) => [id, [...incoming.get(id)!].sort()]));

  // Finishing order, followed by a reversed traversal, identifies strongly
  // connected components without letting a cycle repeatedly increase depth.
  const visited = new Set<string>(),
    finished: string[] = [];
  for (const start of ids) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [{ id: start, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1],
        neighbours = forward.get(frame.id)!;
      if (frame.next === neighbours.length) {
        finished.push(frame.id);
        stack.pop();
      } else {
        const next = neighbours[frame.next++];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, next: 0 });
        }
      }
    }
  }
  const component = new Map<string, number>(),
    groups: string[][] = [];
  for (let index = finished.length - 1; index >= 0; index--) {
    const start = finished[index];
    if (component.has(start)) continue;
    const group: string[] = [],
      componentId = groups.length,
      stack = [start];
    component.set(start, componentId);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const next of reverse.get(id)!) {
        if (!component.has(next)) {
          component.set(next, componentId);
          stack.push(next);
        }
      }
    }
    groups.push(group.sort());
  }

  const successors = groups.map(() => new Set<number>());
  const indegree = groups.map(() => 0),
    depths = groups.map(() => 0);
  for (const id of ids) {
    const from = component.get(id)!;
    for (const target of forward.get(id)!) {
      const to = component.get(target)!;
      if (from !== to && !successors[from].has(to)) {
        successors[from].add(to);
        indegree[to]++;
      }
    }
  }
  const queue = groups.flatMap((_, index) =>
    indegree[index] === 0 ? [index] : [],
  );
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    for (const to of successors[from]) {
      depths[to] = Math.max(depths[to], depths[from] + 1);
      if (--indegree[to] === 0) queue.push(to);
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const depth = depths[component.get(id)!];
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth)!.push(id);
  }
  const positions = new Map<string, Point>();
  let x = 100;
  for (const depth of [...columns.keys()].sort((a, b) => a - b)) {
    let y = 100,
      columnWidth = 0;
    for (const id of columns.get(depth)!) {
      const node = byId.get(id)!;
      positions.set(id, { x, y });
      columnWidth = Math.max(columnWidth, Math.max(0, finite(node.width)));
      y += Math.max(0, finite(node.height)) + 64;
    }
    x += columnWidth + 120;
  }
  return nodes.map((node) => ({ ...node, ...positions.get(node.id)! }));
}
