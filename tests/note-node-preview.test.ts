import assert from "node:assert/strict";
import test from "node:test";
import { noteTextStats, noteTextSummary } from "../src/note-node.ts";

test("note summary trims repeated whitespace for compact node previews", () => {
  assert.equal(
    noteTextSummary("  第一段\n\n第二段   继续  ", 20),
    "第一段 第二段 继续",
  );
});

test("note summary is bounded for canvas cards", () => {
  assert.equal(noteTextSummary("一".repeat(20), 8), "一".repeat(7) + "…");
});

test("note stats count compact characters and visible lines", () => {
  assert.deepEqual(noteTextStats("角色 A\n\n动作：奔跑"), {
    chars: 8,
    lines: 2,
  });
  assert.deepEqual(noteTextStats("   "), { chars: 0, lines: 0 });
});
