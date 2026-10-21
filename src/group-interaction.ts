import type { GroupFrame } from "./canvas-types";

export const GROUP_FRAME_PADDING = 18;

export type GroupableNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string;
};

export type GroupState<T extends GroupableNode> = {
  nodes: T[];
  groups: GroupFrame[];
};

const validNode = (node: GroupableNode) =>
  Boolean(node.id) &&
  [node.x, node.y, node.width, node.height].every(Number.isFinite) &&
  node.width >= 0 &&
  node.height >= 0;

/** Exact world-space frame for a group. Frames are derived state. */
export function frameForGroupNodes(
  id: string,
  nodes: readonly GroupableNode[],
  padding = GROUP_FRAME_PADDING,
): GroupFrame | null {
  const members = nodes.filter(validNode);
  if (!id || !members.length) return null;
  const inset = Math.max(0, Number.isFinite(padding) ? padding : GROUP_FRAME_PADDING);
  const x = Math.min(...members.map((node) => node.x));
  const y = Math.min(...members.map((node) => node.y));
  const right = Math.max(...members.map((node) => node.x + node.width));
  const bottom = Math.max(...members.map((node) => node.y + node.height));
  return {
    id,
    x: x - inset,
    y: y - inset,
    width: right - x + inset * 2,
    height: bottom - y + inset * 2,
  };
}

/**
 * Remove one-member groups and rebuild every remaining frame from its members.
 * A group frame has no independent geometry in the product, so retaining an
 * old larger frame after regrouping or removing a child creates a dead hit
 * area that can capture later drops.
 */
export function rebuildGroupState<T extends GroupableNode>(
  source: readonly T[],
  padding = GROUP_FRAME_PADDING,
): GroupState<T> {
  const counts = new Map<string, number>();
  source.forEach((node) => {
    if (node.groupId) counts.set(node.groupId, (counts.get(node.groupId) || 0) + 1);
  });
  const nodes = source.map((node) =>
    node.groupId && (counts.get(node.groupId) || 0) < 2
      ? { ...node, groupId: undefined }
      : { ...node },
  );
  const ids = [...new Set(
    nodes.map((node) => node.groupId).filter((id): id is string => Boolean(id)),
  )];
  const groups = ids
    .map((id) => frameForGroupNodes(id, nodes.filter((node) => node.groupId === id), padding))
    .filter((frame): frame is GroupFrame => Boolean(frame));
  return { nodes, groups };
}

/** Assign selected nodes to a new group and clean up groups they left. */
export function regroupNodes<T extends GroupableNode>(
  source: readonly T[],
  selectedIds: readonly string[],
  groupId: string,
  padding = GROUP_FRAME_PADDING,
): GroupState<T> {
  const selected = new Set(selectedIds);
  if (!groupId || selected.size < 2) return rebuildGroupState(source, padding);
  return rebuildGroupState(
    source.map((node) => selected.has(node.id) ? { ...node, groupId } : node),
    padding,
  );
}

/**
 * Remove selected members, or their complete groups, then shrink all frames.
 */
export function ungroupNodes<T extends GroupableNode>(
  source: readonly T[],
  selectedIds: readonly string[],
  wholeGroups = false,
  padding = GROUP_FRAME_PADDING,
): GroupState<T> {
  const selected = new Set(selectedIds);
  const groupIds = new Set(
    source
      .filter((node) => selected.has(node.id) && node.groupId)
      .map((node) => node.groupId as string),
  );
  return rebuildGroupState(
    source.map((node) => {
      const remove = selected.has(node.id) ||
        Boolean(wholeGroups && node.groupId && groupIds.has(node.groupId));
      return remove && node.groupId ? { ...node, groupId: undefined } : node;
    }),
    padding,
  );
}

/**
 * Translate every logical member, including hidden task metadata. If only the
 * visible members move, deleting their results later revives the hidden task
 * at the group's previous position.
 */
export function translateGroup<T extends GroupableNode>(
  source: readonly T[],
  groupId: string,
  dx: number,
  dy: number,
  padding = GROUP_FRAME_PADDING,
): GroupState<T> {
  const tx = Number.isFinite(dx) ? dx : 0;
  const ty = Number.isFinite(dy) ? dy : 0;
  return rebuildGroupState(
    source.map((node) =>
      node.groupId === groupId
        ? { ...node, x: node.x + tx, y: node.y + ty }
        : node,
    ),
    padding,
  );
}

/**
 * Resolve a node click without changing the editor's modifier contract:
 * plain clicks select a group as one target, while Shift keeps the member
 * level toggle used by multi-select. Hidden task metadata is handled by the
 * drag/command layer.
 */
export function selectionForGroupMember(
  visibleNodes: readonly Pick<GroupableNode, "id" | "groupId">[],
  nodeId: string,
  currentIds: readonly string[],
  extend: boolean,
): string[] {
  const node = visibleNodes.find((candidate) => candidate.id === nodeId);
  if (!node?.groupId) {
    if (!extend) return [nodeId];
    return currentIds.includes(nodeId)
      ? currentIds.filter((id) => id !== nodeId)
      : [...new Set([...currentIds, nodeId])];
  }
  const members = visibleNodes
    .filter((candidate) => candidate.groupId === node.groupId)
    .map((candidate) => candidate.id);
  if (!extend) return members;
  return currentIds.includes(nodeId)
    ? currentIds.filter((id) => id !== nodeId)
    : [...new Set([...currentIds, nodeId])];
}
