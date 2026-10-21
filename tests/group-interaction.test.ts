import assert from "node:assert/strict";
import test from "node:test";
import {
  frameForGroupNodes,
  rebuildGroupState,
  regroupNodes,
  selectionForGroupMember,
  translateGroup,
  ungroupNodes,
} from "../src/group-interaction.ts";

const node = (
  id: string,
  x: number,
  y: number,
  groupId?: string,
  width = 100,
  height = 80,
) => ({ id, x, y, width, height, groupId, label: id });

test("a group frame is always derived from the current member bounds", () => {
  assert.deepEqual(
    frameForGroupNodes("group-a", [node("a", -20, 40), node("b", 140, -10, undefined, 160, 120)]),
    { id: "group-a", x: -38, y: -28, width: 356, height: 166 },
  );
  assert.equal(frameForGroupNodes("group-a", []), null);
});

test("regrouping clears the invisible singleton left in an old group", () => {
  const result = regroupNodes(
    [node("a", 0, 0, "old"), node("b", 140, 0, "old"), node("c", 280, 0)],
    ["b", "c"],
    "new",
  );
  assert.deepEqual(
    result.nodes.map(({ id, groupId }) => ({ id, groupId })),
    [
      { id: "a", groupId: undefined },
      { id: "b", groupId: "new" },
      { id: "c", groupId: "new" },
    ],
  );
  assert.deepEqual(result.groups.map((group) => group.id), ["new"]);
});

test("removing one member shrinks the frame and dissolves a remaining singleton", () => {
  const source = [
    node("a", 0, 0, "group"),
    node("b", 140, 0, "group"),
    node("c", 600, 0, "group"),
  ];
  const partial = ungroupNodes(source, ["c"]);
  assert.deepEqual(partial.groups, [
    { id: "group", x: -18, y: -18, width: 276, height: 116 },
  ]);
  const dissolved = ungroupNodes(partial.nodes, ["b"]);
  assert.equal(dissolved.groups.length, 0);
  assert.equal(dissolved.nodes.find((item) => item.id === "a")?.groupId, undefined);
});

test("whole-group ungrouping includes members hidden from the canvas selection", () => {
  const result = ungroupNodes(
    [
      { ...node("hidden-task", 0, 0, "group"), hidden: true },
      node("result-a", 140, 0, "group"),
      node("result-b", 280, 0, "group"),
    ],
    ["result-a", "result-b"],
    true,
  );
  assert.ok(result.nodes.every((item) => item.groupId === undefined));
  assert.deepEqual(result.groups, []);
});

test("dragging a group moves hidden metadata with visible cards", () => {
  const source = [
    { ...node("hidden-task", 20, 40, "group"), hidden: true },
    node("result-a", 180, 40, "group"),
    node("outside", 0, 300),
  ];
  const result = translateGroup(source, "group", 60, -25);
  assert.deepEqual(
    result.nodes.map(({ id, x, y }) => ({ id, x, y })),
    [
      { id: "hidden-task", x: 80, y: 15 },
      { id: "result-a", x: 240, y: 15 },
      { id: "outside", x: 0, y: 300 },
    ],
  );
  assert.deepEqual(result.groups, [
    { id: "group", x: 62, y: -3, width: 296, height: 116 },
  ]);
});

test("plain clicks select a group while shift-click keeps member-level toggles", () => {
  const visible = [
    node("a", 0, 0, "group"),
    node("b", 140, 0, "group"),
    node("outside", 300, 0),
  ];
  assert.deepEqual(selectionForGroupMember(visible, "a", [], false), ["a", "b"]);
  assert.deepEqual(selectionForGroupMember(visible, "a", ["outside"], true), ["outside", "a"]);
  assert.deepEqual(selectionForGroupMember(visible, "b", ["outside", "a", "b"], true), ["outside", "a"]);
  assert.deepEqual(selectionForGroupMember(visible, "outside", ["a"], false), ["outside"]);
});

test("rebuilding group state is immutable and discards stale persisted frames by construction", () => {
  const source = [node("a", 0, 0, "group"), node("b", 140, 0, "group")];
  const before = structuredClone(source);
  const result = rebuildGroupState(source);
  assert.deepEqual(source, before);
  assert.notEqual(result.nodes[0], source[0]);
  assert.deepEqual(result.groups, [
    { id: "group", x: -18, y: -18, width: 276, height: 116 },
  ]);
});
