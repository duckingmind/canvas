export type Rect = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };

type Size = { width: number; height: number };
type Point = { x: number; y: number };
/** Edges used by the layout engine share the canvas workflow/reference graph. */
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
 * Arrange a flat directed workflow into columns. Groups are deliberately
 * handled by the public wrapper below so this graph algorithm can continue to
 * reason about one layout unit per node. Cyclic groups share a column, and
 * iterative graph walks handle large imports without recursive stack growth.
 */
function arrangeFlatNodes<T extends Rect & { id: string }>(
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
  const predecessors = groups.map(() => new Set<number>());
  const indegree = groups.map(() => 0),
    depths = groups.map(() => 0);
  for (const id of ids) {
    const from = component.get(id)!;
    for (const target of forward.get(id)!) {
      const to = component.get(target)!;
      if (from !== to && !successors[from].has(to)) {
        successors[from].add(to);
        predecessors[to].add(from);
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
  const layers = new Map<number, number[]>();
  for (let componentId = 0; componentId < groups.length; componentId++) {
    const depth = depths[componentId];
    const layer = layers.get(depth) || [];
    layer.push(componentId);
    layers.set(depth, layer);
  }

  // Stable initial ordering keeps an already readable canvas readable while
  // still using the user's current vertical order as a useful hint. The
  // component ID is the final tie-breaker, so imports and repeated runs are
  // deterministic even when nodes have identical coordinates.
  const componentOrder = new Map<number, number>();
  const componentKey = (componentId: number) => {
    const members = groups[componentId];
    const first = members
      .map((id) => byId.get(id)!)
      .sort((a, b) =>
        finite(a.y) - finite(b.y) ||
        finite(a.x) - finite(b.x) ||
        a.id.localeCompare(b.id),
      )[0];
    return {
      y: finite(first?.y),
      x: finite(first?.x),
      id: members[0] || String(componentId),
    };
  };
  for (const layer of layers.values()) {
    layer.sort((a, b) => {
      const left = componentKey(a), right = componentKey(b);
      return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id) || a - b;
    });
    layer.forEach((componentId, index) => componentOrder.set(componentId, index));
  }

  const layerDepths = [...layers.keys()].sort((a, b) => a - b);
  const positionInLayer = (componentId: number) => {
    const depth = depths[componentId];
    const layer = layers.get(depth) || [];
    const index = layer.indexOf(componentId);
    return index < 0 ? 0 : index / Math.max(1, layer.length - 1);
  };
  const scoreAgainst = (
    componentId: number,
    direction: "predecessor" | "successor",
    depth: number,
  ): number | undefined => {
    const neighbours = (direction === "predecessor"
      ? predecessors[componentId]
      : successors[componentId]);
    const adjacentDepth = direction === "predecessor" ? depth - 1 : depth + 1;
    const adjacent = [...neighbours].filter((candidate) => depths[candidate] === adjacentDepth);
    const candidates = adjacent.length
      ? adjacent
      : [...neighbours].filter((candidate) =>
          direction === "predecessor" ? depths[candidate] < depth : depths[candidate] > depth,
        );
    if (!candidates.length) return undefined;
    return candidates.reduce((sum, candidate) => sum + positionInLayer(candidate), 0) / candidates.length;
  };
  const reorderLayer = (
    depth: number,
    direction: "predecessor" | "successor",
  ) => {
    const layer = layers.get(depth);
    if (!layer || layer.length < 2) return;
    const previousOrder = new Map(layer.map((componentId, index) => [componentId, index]));
    layer.sort((left, right) => {
      const leftScore = scoreAgainst(left, direction, depth);
      const rightScore = scoreAgainst(right, direction, depth);
      if (leftScore !== undefined || rightScore !== undefined) {
        const normalizedLeft = leftScore ?? Number.POSITIVE_INFINITY;
        const normalizedRight = rightScore ?? Number.POSITIVE_INFINITY;
        if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
      }
      return (previousOrder.get(left) || 0) - (previousOrder.get(right) || 0) ||
        (componentOrder.get(left) || 0) - (componentOrder.get(right) || 0) ||
        left - right;
    });
  };

  // Barycenter/median sweeps are the standard crossing-reduction step in a
  // Sugiyama layout. A few alternating passes are cheap for canvas-sized
  // graphs and substantially improve fan-in/fan-out readability. Long edges
  // use normalized positions when there is no adjacent-layer neighbour.
  for (let pass = 0; pass < 6; pass++) {
    for (const depth of layerDepths) reorderLayer(depth, "predecessor");
    for (let index = layerDepths.length - 1; index >= 0; index--) {
      reorderLayer(layerDepths[index], "successor");
    }
  }

  const positions = new Map<string, Point>();
  const maxLayerRows = 8;
  const maxRowsBeforeWrapping = 4;
  const cardGap = 64;
  const layerColumnGap = 64;
  const depthGap = 120;
  let x = 100;
  for (const depth of layerDepths) {
    const layer = layers.get(depth) || [];
    const entries = layer.map((componentId) => {
      const members = groups[componentId].map((id) => byId.get(id)!);
      return {
        componentId,
        members,
        width: members.reduce((max, node) => Math.max(max, Math.max(0, finite(node.width))), 0),
        height: members.reduce((sum, node) => sum + Math.max(0, finite(node.height)), 0) +
          Math.max(0, members.length - 1) * cardGap,
      };
    });
    // A tall fan-out is easier to scan when it wraps into a few columns.
    // Keep small layers in their familiar single column; cap row count for
    // large imports so a wide graph does not turn into one endless stack.
    const rowLimit = entries.length > maxRowsBeforeWrapping
      ? Math.min(maxLayerRows, Math.max(maxRowsBeforeWrapping, Math.ceil(Math.sqrt(entries.length))))
      : entries.length;
    const columnCount = Math.max(1, Math.ceil(entries.length / Math.max(1, rowLimit)));
    const rowCount = Math.ceil(entries.length / columnCount);
    const columnWidths = Array.from({ length: columnCount }, (_, column) =>
      entries.reduce((max, entry, index) => index % columnCount === column ? Math.max(max, entry.width) : max, 0),
    );
    const rowHeights = Array.from({ length: rowCount }, (_, row) =>
      entries.slice(row * columnCount, (row + 1) * columnCount)
        .reduce((max, entry) => Math.max(max, entry.height), 0),
    );
    const columnOffsets = columnWidths.map((_, column) =>
      columnWidths.slice(0, column).reduce((sum, width) => sum + width + layerColumnGap, 0),
    );
    const rowOffsets = rowHeights.map((_, row) =>
      rowHeights.slice(0, row).reduce((sum, height) => sum + height + cardGap, 0),
    );
    entries.forEach((entry, index) => {
      const row = Math.floor(index / columnCount);
      const column = index % columnCount;
      let memberY = 100 + rowOffsets[row];
      for (const node of entry.members) {
        positions.set(node.id, { x: x + columnOffsets[column], y: memberY });
        memberY += Math.max(0, finite(node.height)) + cardGap;
      }
    });
    const layerWidth = columnWidths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, columnCount - 1) * layerColumnGap;
    x += layerWidth + depthGap;
  }
  return nodes.map((node) => ({ ...node, ...positions.get(node.id)! }));
}

/** Arrange connected workflow modules as islands and pack loose units together. */
const MIN_WEAK_MODULE_NODES = 4;
const MAX_WEAK_MODULE_ANALYSIS_NODES = 256;

type WeakGraphPiece = { ids: string[]; edgeCount: number; contacts: number };
type WeakGraphCut = { articulation: Set<string>; bridges: Array<[string, string]> };

function weakEdgeKey(left: string, right: string): string {
  return left < right ? JSON.stringify([left, right]) : JSON.stringify([right, left]);
}

/** Tarjan cut detection. The caller limits this to small components so the
 * recursive walk stays shallow; large graphs keep their current linear layout. */
function weakGraphCuts(ids: readonly string[], neighbours: Map<string, Set<string>>): WeakGraphCut {
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const articulation = new Set<string>();
  const bridges: Array<[string, string]> = [];
  let clock = 0;

  const visit = (id: string, parent?: string) => {
    discovery.set(id, ++clock);
    low.set(id, clock);
    let children = 0;
    for (const next of [...(neighbours.get(id) || [])].filter((candidate) => ids.includes(candidate)).sort()) {
      if (!discovery.has(next)) {
        children++;
        visit(next, id);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
        if (parent !== undefined && low.get(next)! >= discovery.get(id)!) articulation.add(id);
        if (low.get(next)! > discovery.get(id)!) bridges.push([id, next]);
      } else if (next !== parent) {
        low.set(id, Math.min(low.get(id)!, discovery.get(next)!));
      }
    }
    if (parent === undefined && children > 1) articulation.add(id);
  };

  for (const id of [...ids].sort()) if (!discovery.has(id)) visit(id);
  bridges.sort((left, right) => weakEdgeKey(...left).localeCompare(weakEdgeKey(...right)));
  return { articulation, bridges };
}

function weakGraphPieces(
  ids: readonly string[],
  neighbours: Map<string, Set<string>>,
  removedNode?: string,
  removedEdge?: string,
): WeakGraphPiece[] {
  const allowed = new Set(ids);
  const visited = new Set<string>(removedNode ? [removedNode] : []);
  const pieces: WeakGraphPiece[] = [];
  for (const start of [...ids].sort()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [start];
    const members: string[] = [];
    while (stack.length) {
      const id = stack.pop()!;
      members.push(id);
      for (const next of neighbours.get(id) || []) {
        if (!allowed.has(next) || visited.has(next) || weakEdgeKey(id, next) === removedEdge) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    const memberSet = new Set(members);
    const edgeCount = members.reduce((sum, id) =>
      sum + [...(neighbours.get(id) || [])].filter((next) => memberSet.has(next)).length, 0,
    ) / 2;
    pieces.push({ ids: members.sort(), edgeCount, contacts: 0 });
  }
  return pieces.sort((left, right) => left.ids[0].localeCompare(right.ids[0]));
}

/**
 * Split only when a small cut joins multiple self-supporting modules. A
 * branch of a simple chain or a shared input fan-out has no redundant internal
 * links, so it remains one workflow. Cross-module edges stay in the document;
 * they simply stop forcing both modules into one layout column structure.
 */
function weakModulePartition(
  ids: readonly string[],
  neighbours: Map<string, Set<string>>,
): string[][] | null {
  if (ids.length < MIN_WEAK_MODULE_NODES * 2 || ids.length > MAX_WEAK_MODULE_ANALYSIS_NODES) return null;
  const cuts = weakGraphCuts(ids, neighbours);
  const candidates: Array<{ groups: string[][]; ratio: number; balance: number; key: string }> = [];
  const isStrongPiece = (piece: WeakGraphPiece) =>
    piece.ids.length >= MIN_WEAK_MODULE_NODES &&
    piece.edgeCount >= piece.ids.length &&
    piece.contacts * 4 <= piece.edgeCount;

  for (const separator of [...cuts.articulation].sort()) {
    if ((neighbours.get(separator)?.size || 0) < 3) continue;
    const pieces = weakGraphPieces(ids, neighbours, separator);
    for (const piece of pieces) {
      piece.contacts = [...(neighbours.get(separator) || [])].filter((next) => piece.ids.includes(next)).length;
    }
    const strong = pieces.filter(isStrongPiece);
    if (strong.length < 2) continue;
    const owner = [...strong].sort((left, right) =>
      right.contacts - left.contacts ||
      right.edgeCount - left.edgeCount ||
      right.ids.length - left.ids.length ||
      left.ids[0].localeCompare(right.ids[0]),
    )[0];
    const ownerIds = new Set([separator, ...owner.ids]);
    for (const piece of pieces) if (!strong.includes(piece)) piece.ids.forEach((id) => ownerIds.add(id));
    const groups = [
      [...ownerIds].sort(),
      ...strong.filter((piece) => piece !== owner).map((piece) => piece.ids),
    ];
    const ratio = strong.reduce((sum, piece) => sum + piece.contacts / Math.max(1, piece.edgeCount), 0);
    const balance = Math.min(...strong.map((piece) => piece.ids.length));
    candidates.push({ groups, ratio, balance, key: `node:${separator}` });
  }

  for (const [left, right] of cuts.bridges) {
    const pieces = weakGraphPieces(ids, neighbours, undefined, weakEdgeKey(left, right));
    if (pieces.length !== 2) continue;
    for (const piece of pieces) piece.contacts = 1;
    if (!pieces.every(isStrongPiece)) continue;
    candidates.push({
      groups: pieces.map((piece) => piece.ids),
      ratio: pieces.reduce((sum, piece) => sum + 1 / Math.max(1, piece.edgeCount), 0),
      balance: Math.min(...pieces.map((piece) => piece.ids.length)),
      key: `edge:${weakEdgeKey(left, right)}`,
    });
  }

  candidates.sort((left, right) =>
    left.ratio - right.ratio ||
    right.balance - left.balance ||
    left.key.localeCompare(right.key),
  );
  return candidates[0]?.groups || null;
}

function splitWeaklyConnectedModules(
  component: readonly string[],
  neighbours: Map<string, Set<string>>,
): string[][] {
  const pending: string[][] = [[...component]];
  const modules: string[][] = [];
  while (pending.length) {
    const current = pending.pop()!;
    const partition = weakModulePartition(current, neighbours);
    if (!partition) {
      modules.push(current);
      continue;
    }
    pending.push(...partition);
  }
  return modules;
}

function arrangeWorkflowIslands<T extends Rect & { id: string }>(
  nodes: readonly T[],
  edges: readonly Edge[],
): T[] {
  if (nodes.length < 2) return nodes.map((node) => ({ ...node }));

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbours = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (
      edge.from === edge.to ||
      !byId.has(edge.from) ||
      !byId.has(edge.to)
    ) continue;
    neighbours.get(edge.from)!.add(edge.to);
    neighbours.get(edge.to)!.add(edge.from);
  }

  const orderedNodes = [...nodes].sort((left, right) =>
    finite(left.y) - finite(right.y) ||
    finite(left.x) - finite(right.x) ||
    left.id.localeCompare(right.id),
  );
  const visited = new Set<string>();
  const components: T[][] = [];
  for (const start of orderedNodes) {
    if (visited.has(start.id)) continue;
    visited.add(start.id);
    const stack = [start.id];
    const componentIds: string[] = [];
    while (stack.length) {
      const id = stack.pop()!;
      componentIds.push(id);
      for (const next of neighbours.get(id) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    components.push(componentIds.map((id) => byId.get(id)!));
  }

  const modules = components.flatMap((component) =>
    splitWeaklyConnectedModules(component.map((node) => node.id), neighbours)
      .map((ids) => ids.map((id) => byId.get(id)!)),
  );
  const connectedModules = modules.filter((module) => module.length > 1);
  const isolatedUnits = modules
    .filter((module) => module.length === 1)
    .flat()
    .sort((left, right) =>
      finite(left.y) - finite(right.y) ||
      finite(left.x) - finite(right.x) ||
      left.id.localeCompare(right.id),
    );
  if (connectedModules.length === 1 && isolatedUnits.length === 0) {
    return arrangeFlatNodes(nodes, edges);
  }

  const islandGap = 112;
  const makeIsland = (component: readonly T[], arranged: readonly T[], key: string) => {
    const originalBounds = getBounds(component) || { x: 0, y: 0, width: 0, height: 0 };
    const bounds = getBounds(arranged) || { x: 0, y: 0, width: 0, height: 0 };
    const normalized = arranged.map((node) => ({
      ...node,
      x: finite(node.x) - bounds.x,
      y: finite(node.y) - bounds.y,
    }));
    return {
      nodes: normalized,
      width: bounds.width,
      height: bounds.height,
      originalBounds,
      key,
    };
  };
  const islands = connectedModules.map((component) => {
    const componentIds = new Set(component.map((node) => node.id));
    const componentEdges = edges.filter((edge) => componentIds.has(edge.from) && componentIds.has(edge.to));
    const arranged = arrangeFlatNodes(component, componentEdges);
    return makeIsland(component, arranged, component.map((node) => node.id).sort()[0] || "");
  });
  if (isolatedUnits.length) {
    const rows = Math.max(1, Math.ceil(Math.sqrt(layoutUnitCount(isolatedUnits))));
    const arranged = arrangeGridNodes(isolatedUnits, rows, 32);
    const key = `isolated:${isolatedUnits.map((node) => node.id).sort()[0] || ""}`;
    islands.push(makeIsland(isolatedUnits, arranged, key));
  }
  islands.sort((left, right) =>
    left.originalBounds.y - right.originalBounds.y ||
    left.originalBounds.x - right.originalBounds.x ||
    left.key.localeCompare(right.key),
  );

  const totalArea = islands.reduce((sum, island) => sum + island.width * island.height, 0);
  const widestIsland = Math.max(...islands.map((island) => island.width));
  // Keep at least two islands on a row, while scaling the shelf width for
  // larger canvases. Loose units have already been compacted into one grid
  // island, so standalone cards do not each consume a full island gap.
  const targetRowWidth = Math.max(
    widestIsland * 2 + islandGap,
    Math.sqrt(totalArea * 2),
  );
  const placed: T[] = [];
  let x = 100;
  let y = 100;
  let rowHeight = 0;
  for (const island of islands) {
    if (x > 100 && x + island.width > 100 + targetRowWidth) {
      x = 100;
      y += rowHeight + islandGap;
      rowHeight = 0;
    }
    for (const node of island.nodes) placed.push({ ...node, x: node.x + x, y: node.y + y });
    x += island.width + islandGap;
    rowHeight = Math.max(rowHeight, island.height);
  }
  const placedById = new Map(placed.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const position = placedById.get(node.id);
    return position ? { ...node, x: position.x, y: position.y } : { ...node };
  });
}

type LayoutUnit<T extends Rect & { id: string }> = Rect & {
  id: string;
  members: T[];
};

function visibleLayoutMembers<T extends Rect & { id: string }>(members: readonly T[]): readonly T[] {
  // Completed creator prompts remain in the document for task recovery, but
  // their result cards are the visible group composition. Keep those metadata
  // records in the unit for translation while excluding them from its bounds.
  const resultOwners = new Set(
    members
      .map((member) => (member as T & { resultOf?: string }).resultOf)
      .filter((id): id is string => Boolean(id)),
  );
  const visible = members.filter((member) => {
    const candidate = member as T & { type?: string };
    return !(candidate.type === "prompt" && resultOwners.has(member.id));
  });
  return visible.length ? visible : members;
}

function collectLayoutUnits<T extends Rect & { id: string }>(
  nodes: readonly T[],
): LayoutUnit<T>[] {
  type GroupedNode = T & {
    groupId?: string;
    resultOf?: string;
    continuationOf?: string;
  };
  const grouped = nodes as readonly GroupedNode[];
  const counts = new Map<string, number>();
  const byId = new Map(grouped.map((node) => [node.id, node]));
  for (const node of grouped) {
    const groupId = typeof node.groupId === "string" ? node.groupId.trim() : "";
    if (groupId) counts.set(groupId, (counts.get(groupId) || 0) + 1);
  }

  // A generated result can outlive its creator card in the visible canvas,
  // but it still belongs to the same logical unit. Treat resultOf and
  // continuationOf as an implicit module when no explicit group exists, so a
  // flow pass never separates the hidden task metadata from its visible
  // result. Explicit groupId remains authoritative when present.
  const parentById = new Map<string, string>();
  for (const node of grouped) {
    const parent = typeof node.resultOf === "string" && byId.has(node.resultOf)
      ? node.resultOf
      : typeof node.continuationOf === "string" && byId.has(node.continuationOf)
        ? node.continuationOf
        : undefined;
    if (parent && parent !== node.id) parentById.set(node.id, parent);
  }
  const rootCache = new Map<string, string>();
  const lineageRoot = (id: string): string => {
    const cached = rootCache.get(id);
    if (cached) return cached;
    const path: string[] = [];
    const visited = new Map<string, number>();
    let current = id;
    while (true) {
      const known = rootCache.get(current);
      if (known) {
        path.forEach((member) => rootCache.set(member, known));
        return known;
      }
      const cycleStart = visited.get(current);
      if (cycleStart !== undefined) {
        const root = [...path.slice(cycleStart), current].sort()[0] || current;
        path.forEach((member) => rootCache.set(member, root));
        return root;
      }
      visited.set(current, path.length);
      path.push(current);
      const parent = parentById.get(current);
      if (!parent) {
        path.forEach((member) => rootCache.set(member, current));
        return current;
      }
      current = parent;
    }
  };
  const lineageCounts = new Map<string, number>();
  for (const node of grouped) {
    const root = lineageRoot(node.id);
    lineageCounts.set(root, (lineageCounts.get(root) || 0) + 1);
  }
  const unitsById = new Map<string, LayoutUnit<T>>();
  for (const node of grouped) {
    const groupId = typeof node.groupId === "string" ? node.groupId.trim() : "";
    // JSON tuple IDs keep group units disjoint from arbitrary node IDs.
    const root = lineageRoot(node.id);
    // Include the root creator as well as its generated descendants. Without
    // the root in the same unit, a creator/result pair can still be split
    // across two columns when the creator has no explicit groupId.
    const hasImplicitLineage = !groupId && (lineageCounts.get(root) || 0) > 1;
    const unitId = groupId && (counts.get(groupId) || 0) > 1
      ? JSON.stringify(["group", groupId])
      : hasImplicitLineage
        ? JSON.stringify(["lineage", root])
        : JSON.stringify(["node", node.id]);
    let unit = unitsById.get(unitId);
    if (!unit) {
      unit = {
        id: unitId,
        x: finite(node.x),
        y: finite(node.y),
        width: Math.max(0, finite(node.width)),
        height: Math.max(0, finite(node.height)),
        members: [],
      };
      unitsById.set(unitId, unit);
    } else {
      const right = Math.max(unit.x + unit.width, finite(node.x) + Math.max(0, finite(node.width)));
      const bottom = Math.max(unit.y + unit.height, finite(node.y) + Math.max(0, finite(node.height)));
      unit.x = Math.min(unit.x, finite(node.x));
      unit.y = Math.min(unit.y, finite(node.y));
      unit.width = right - unit.x;
      unit.height = bottom - unit.y;
    }
    unit.members.push(node);
  }
  for (const unit of unitsById.values()) {
    const members = visibleLayoutMembers(unit.members);
    const x = Math.min(...members.map((node) => finite(node.x)));
    const y = Math.min(...members.map((node) => finite(node.y)));
    const right = Math.max(...members.map((node) => finite(node.x) + Math.max(0, finite(node.width))));
    const bottom = Math.max(...members.map((node) => finite(node.y) + Math.max(0, finite(node.height))));
    unit.x = x;
    unit.y = y;
    unit.width = Math.max(0, right - x);
    unit.height = Math.max(0, bottom - y);
  }
  return [...unitsById.values()];
}

function translateLayoutUnits<T extends Rect & { id: string }>(
  units: readonly LayoutUnit<T>[],
  placed: readonly (Rect & { id: string })[],
  nodes: readonly T[],
): T[] {
  const originalByNode = new Map<string, LayoutUnit<T>>();
  units.forEach((unit) => unit.members.forEach((node) => originalByNode.set(node.id, unit)));
  const placedById = new Map(placed.map((unit) => [unit.id, unit]));
  return nodes.map((node) => {
    const original = originalByNode.get(node.id);
    const position = original ? placedById.get(original.id) : undefined;
    if (!original || !position) return { ...node };
    return { ...node, x: finite(node.x) + position.x - original.x, y: finite(node.y) + position.y - original.y };
  });
}

/** Number of independent cards or groups a layout operation will move. */
export function layoutUnitCount<T extends Rect & { id: string }>(nodes: readonly T[]): number {
  return collectLayoutUnits(nodes).length;
}

/**
 * Arrange nodes while keeping each existing group together. Group bounds are
 * laid out as composite units, then every member receives the same movement
 * so its internal spacing and ordering stay intact. Cross-group edges are
 * collapsed between units; edges inside one group do not affect placement.
 */
export function arrangeNodes<T extends Rect & { id: string }>(
  nodes: readonly T[],
  edges: readonly Edge[],
): T[] {
  if (!nodes.length) return [];
  const units = collectLayoutUnits(nodes);
  if (units.length < 2) return nodes.map((node) => ({ ...node }));
  if (units.every((unit) => unit.members.length === 1)) return arrangeWorkflowIslands(nodes, edges);

  const unitByNode = new Map<string, string>();
  units.forEach((unit) => unit.members.forEach((node) => unitByNode.set(node.id, unit.id)));
  const unitEdges: Edge[] = [];
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const from = unitByNode.get(edge.from);
    const to = unitByNode.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    unitEdges.push({ from, to });
  }
  const arrangedUnits = arrangeWorkflowIslands(units, unitEdges);
  return translateLayoutUnits(units, arrangedUnits, nodes);
}

/** Arrange a grid of cards and group bounds while preserving each group's geometry. */
export function arrangeGridNodes<T extends Rect & { id: string }>(
  nodes: readonly T[],
  rows: number,
  gap = 32,
): T[] {
  if (!nodes.length) return [];
  const units = collectLayoutUnits(nodes);
  if (units.length < 2) return nodes.map((node) => ({ ...node }));
  const rowCount = Math.max(1, Math.min(Math.floor(finite(rows, 1)), units.length));
  const columnCount = Math.ceil(units.length / rowCount);
  const columnWidths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(...units.filter((_, index) => index % columnCount === column).map((unit) => unit.width)),
  );
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(...units.filter((_, index) => Math.floor(index / columnCount) === row).map((unit) => unit.height)),
  );
  const startX = Math.min(...units.map((unit) => unit.x));
  const startY = Math.min(...units.map((unit) => unit.y));
  const spacing = Math.max(0, finite(gap, 32));
  const xOffsets = columnWidths.map((_, column) => columnWidths.slice(0, column).reduce((sum, width) => sum + width + spacing, 0));
  const yOffsets = rowHeights.map((_, row) => rowHeights.slice(0, row).reduce((sum, height) => sum + height + spacing, 0));
  const placed = units.map((unit, index) => ({
    id: unit.id,
    x: startX + xOffsets[index % columnCount],
    y: startY + yOffsets[Math.floor(index / columnCount)],
    width: unit.width,
    height: unit.height,
  }));
  return translateLayoutUnits(units, placed, nodes);
}

/**
 * Arrange a canvas without exposing layout parameters to the user. Connected
 * workflow graphs use directional island layout; canvases without workflow
 * dependencies use a compact grid, with a roughly square row count derived
 * from the number of independent cards/groups.
 */
export function arrangeSmartNodes<T extends Rect & { id: string }>(
  nodes: readonly T[],
  edges: readonly Edge[],
): T[] {
  if (nodes.length < 2) return nodes.map((node) => ({ ...node }));
  const ids = new Set(nodes.map((node) => node.id));
  const workflowEdges = edges.filter((edge) =>
    edge.from !== edge.to &&
    ids.has(edge.from) &&
    ids.has(edge.to),
  );
  if (workflowEdges.length) return arrangeNodes(nodes, workflowEdges);

  const ordered = [...nodes].sort((left, right) =>
    finite(left.y) - finite(right.y) ||
    finite(left.x) - finite(right.x) ||
    left.id.localeCompare(right.id),
  );
  const rows = Math.max(1, Math.ceil(Math.sqrt(layoutUnitCount(ordered))));
  return arrangeGridNodes(ordered, rows, 48);
}

/**
 * Arrange the visible members inside one manually selected group. This is an
 * explicit opt-in operation, so temporarily ignore group and generated
 * lineage metadata while computing positions; return the original node shape
 * and membership with only coordinates changed.
 */
export function arrangeGroupMembers<T extends Rect & { id: string }>(
  nodes: readonly T[],
  edges: readonly Edge[],
): T[] {
  if (nodes.length < 2) return nodes.map((node) => ({ ...node }));
  const layoutNodes = nodes.map((node) => {
    const copy = { ...node } as T & {
      groupId?: string;
      resultOf?: string;
      continuationOf?: string;
    };
    delete copy.groupId;
    delete copy.resultOf;
    delete copy.continuationOf;
    return copy;
  });
  const positions = new Map(arrangeSmartNodes(layoutNodes, edges).map((node) => [node.id, node]));
  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, x: position.x, y: position.y } : { ...node };
  });
}
