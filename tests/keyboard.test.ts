import assert from "node:assert/strict";
import test from "node:test";
import { isComposingKey, isGenerateShortcut, zoomShortcutDirection } from "../src/keyboard.ts";

test("prompt Enter and Shift+Enter remain newline keys; only Cmd/Ctrl+Enter submits", () => {
  assert.equal(isGenerateShortcut({ key: "Enter" }), false);
  assert.equal(isGenerateShortcut({ key: "Enter", shiftKey: true }), false);
  assert.equal(isGenerateShortcut({ key: "Enter", metaKey: true }), true);
  assert.equal(isGenerateShortcut({ key: "Enter", ctrlKey: true }), true);
  assert.equal(isGenerateShortcut({ key: "Enter", code: "NumpadEnter", ctrlKey: true }), true);
});

test("IME confirmation and cancellation never trigger generation or canvas shortcuts", () => {
  for (const key of ["Enter", "Escape", "Backspace", "Delete", "t"]) {
    for (const composition of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
      const event = { key, ctrlKey: true, ...composition };
      assert.equal(isComposingKey(event), true);
      assert.equal(isGenerateShortcut(event), false);
    }
  }
  assert.equal(isComposingKey({ key: "Enter", keyCode: 13 }), false);
});

test("held keys, handled events and other modifier combinations cannot submit", () => {
  for (const extra of [{ repeat: true }, { defaultPrevented: true }, { altKey: true }, { shiftKey: true }]) {
    assert.equal(isGenerateShortcut({ key: "Enter", metaKey: true, ...extra }), false);
    assert.equal(isGenerateShortcut({ key: "Enter", ctrlKey: true, ...extra }), false);
  }
  assert.equal(isGenerateShortcut({ key: "Backspace", ctrlKey: true }), false);
});

test("Cmd/Ctrl plus, equals and minus zoom the canvas, including numpad keys", () => {
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    for (const event of [
      { key: "+" },
      { key: "=" },
      { key: "+", shiftKey: true },
      { key: "+", code: "NumpadAdd" },
      { key: "Add" },
      { key: "Unidentified", code: "NumpadAdd" },
    ]) {
      assert.equal(zoomShortcutDirection({ ...event, ...modifier }), 1);
    }
    for (const event of [
      { key: "-" },
      { key: "-", code: "NumpadSubtract" },
      { key: "Subtract" },
      { key: "Unidentified", code: "NumpadSubtract" },
    ]) {
      assert.equal(zoomShortcutDirection({ ...event, ...modifier }), -1);
    }
  }
});

test("zoom shortcuts allow key repeat but ignore input composition and handled events", () => {
  for (const key of ["+", "=", "-"]) {
    assert.equal(zoomShortcutDirection({ key, ctrlKey: true, repeat: true }), key === "-" ? -1 : 1);
    for (const blocked of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { altKey: true }]) {
      assert.equal(zoomShortcutDirection({ key, metaKey: true, ...blocked }), 0);
    }
    assert.equal(zoomShortcutDirection({ key }), 0);
    assert.equal(zoomShortcutDirection({ key, shiftKey: true }), 0);
  }
  assert.equal(zoomShortcutDirection({ key: "+", code: "NumpadAdd", ctrlKey: true, isComposing: true }), 0);
  assert.equal(zoomShortcutDirection({ key: "0", metaKey: true }), 0);
  assert.equal(zoomShortcutDirection({ key: "e" }), 0);
});
