export type AlignmentNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AlignmentGuide = { x1: number; y1: number; x2: number; y2: number };

const valid = (node: AlignmentNode) =>
  Boolean(node.id) &&
  [node.x, node.y, node.width, node.height, node.x + node.width, node.y + node.height].every(Number.isFinite) &&
  node.width >= 0 && node.height >= 0;

/**
 * Show the nearest edge/center alignment on each axis, within four screen
 * pixels. The moving selection is one bounding box; this never changes its
 * position or snaps an individual member out of the group.
 */
export function alignmentGuides(
  nodes: readonly AlignmentNode[],
  movingIds: readonly string[],
  zoom: number,
): AlignmentGuide[] {
  if (!Number.isFinite(zoom) || zoom <= 0 || !movingIds.length) return [];
  const movingSet = new Set(movingIds);
  const usable = nodes.filter(valid);
  const moving = usable.filter((node) => movingSet.has(node.id));
  if (!moving.length) return [];
  const bounds = moving.reduce((box, node) => ({
    left: Math.min(box.left, node.x),
    top: Math.min(box.top, node.y),
    right: Math.max(box.right, node.x + node.width),
    bottom: Math.max(box.bottom, node.y + node.height),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  type Candidate = { distance: number; span: number; guide: AlignmentGuide };
  let vertical: Candidate | undefined, horizontal: Candidate | undefined;
  const threshold = 4 / zoom;
  const nearer = (next: Candidate, previous: Candidate | undefined) =>
    next.distance <= threshold + 1e-9 &&
    (!previous || next.distance < previous.distance ||
      (next.distance === previous.distance && next.span < previous.span));
  for (const node of usable) {
    if (movingSet.has(node.id)) continue;
    const left = Math.min(bounds.left, node.x), right = Math.max(bounds.right, node.x + node.width);
    const top = Math.min(bounds.top, node.y), bottom = Math.max(bounds.bottom, node.y + node.height);
    for (const x of [node.x, node.x + node.width / 2, node.x + node.width]) {
      const candidate = {
        distance: Math.min(...[bounds.left, (bounds.left + bounds.right) / 2, bounds.right].map((anchor) => Math.abs(x - anchor))),
        span: bottom - top,
        guide: { x1: x, y1: top, x2: x, y2: bottom },
      };
      if (nearer(candidate, vertical)) vertical = candidate;
    }
    for (const y of [node.y, node.y + node.height / 2, node.y + node.height]) {
      const candidate = {
        distance: Math.min(...[bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom].map((anchor) => Math.abs(y - anchor))),
        span: right - left,
        guide: { x1: left, y1: y, x2: right, y2: y },
      };
      if (nearer(candidate, horizontal)) horizontal = candidate;
    }
  }
  return [vertical, horizontal].flatMap((candidate) => candidate ? [candidate.guide] : []);
}
