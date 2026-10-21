import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CANVAS_PREFERENCES, loadCanvasPreferences, normalizeCanvasPreferences, resetCanvasPreferences, saveCanvasPreferences } from "../src/canvas-preferences.ts";

test("legacy preferences retain supported behavior while discarding unimplemented fields", () => {
  const preferences = normalizeCanvasPreferences({
    ...DEFAULT_CANVAS_PREFERENCES,
    panSensitivity: 2,
    backgroundPreset: "warm",
    referenceNaming: "number",
    delayedSubmit: true,
    touchSnapRange: 250,
    minimalZoom: true,
    linkedPreview: false,
    browserNotification: true,
    notificationSound: true,
    notifySave: true,
    collapseCompletedResults: true,
    theme: "light",
    simplifiedPalette: true,
    unknownFutureSetting: true,
  });
  assert.equal(preferences.panSensitivity, 2);
  assert.equal(preferences.backgroundPreset, "warm");
  assert.equal(preferences.referenceNaming, "number");
  assert.deepEqual(Object.keys(preferences).sort(), Object.keys(DEFAULT_CANVAS_PREFERENCES).sort());
  for (const key of ["delayedSubmit", "touchSnapRange", "minimalZoom", "linkedPreview", "browserNotification", "notificationSound", "notifySave", "collapseCompletedResults", "theme", "simplifiedPalette", "unknownFutureSetting"]) {
    assert.equal(key in preferences, false, `${key} must not be persisted again`);
  }
});

test("the former hidden-grid style migrates to the single visibility control", () => {
  const preferences = normalizeCanvasPreferences({ gridStyle: "none", gridVisible: true, gridSize: 40 });
  assert.equal(preferences.gridVisible, false);
  assert.equal(preferences.gridStyle, "dots");
  assert.equal(preferences.gridSize, 40);
  assert.equal(normalizeCanvasPreferences({ ...preferences, gridVisible: true }).gridVisible, true);
});

test("preferences constrain numeric values to the ranges offered by their controls", () => {
  const low = normalizeCanvasPreferences({ panSensitivity: -10, locateAnimationLimit: -20, gridSize: 1 });
  assert.equal(low.panSensitivity, 0.5);
  assert.equal(low.locateAnimationLimit, 0);
  assert.equal(low.gridSize, 20);
  const high = normalizeCanvasPreferences({ panSensitivity: 10, locateAnimationLimit: 10000, gridSize: 40 });
  assert.equal(high.panSensitivity, 2.5);
  assert.equal(high.locateAnimationLimit, 300);
  assert.equal(high.gridSize, 40);
  assert.equal(normalizeCanvasPreferences({ panSensitivity: Infinity, locateAnimationLimit: NaN }).panSensitivity, 1.5);
  assert.equal(normalizeCanvasPreferences({ locateAnimationLimit: NaN }).locateAnimationLimit, 100);
});

test("invalid stored preferences return valid defaults without string coercion of switches", () => {
  assert.deepEqual(normalizeCanvasPreferences(null), DEFAULT_CANVAS_PREFERENCES);
  assert.deepEqual(normalizeCanvasPreferences("broken"), DEFAULT_CANVAS_PREFERENCES);
  assert.deepEqual(normalizeCanvasPreferences({ notifyFailure: "false", connectionStyle: "unknown", nodeDensity: 3 }), DEFAULT_CANVAS_PREFERENCES);
  assert.equal(DEFAULT_CANVAS_PREFERENCES.blankAreaAction, "double");
  assert.equal(DEFAULT_CANVAS_PREFERENCES.alignmentGuides, false);
  assert.equal(normalizeCanvasPreferences({ blankAreaAction: "invalid" }).blankAreaAction, "double");
  assert.equal(normalizeCanvasPreferences({ notifyFailure: false }).notifyFailure, false);
  assert.equal(normalizeCanvasPreferences({ alignmentGuides: false }).alignmentGuides, false);
});


test("saving removes legacy fields, survives reload and restores all defaults", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } },
  });
  try {
    storage.set("codex.canvas.preferences.v1", JSON.stringify({
      ...DEFAULT_CANVAS_PREFERENCES,
      theme: "system",
      gridStyle: "none",
      nodeDensity: "compact",
      reduceMotion: true,
      connectionColor: "node",
      notifyGeneration: false,
    }));
    const migrated = loadCanvasPreferences();
    saveCanvasPreferences(migrated);
    const saved = JSON.parse(storage.get("codex.canvas.preferences.v1")!);
    assert.equal("theme" in saved, false);
    assert.equal(saved.gridStyle, "dots");
    assert.equal(saved.gridVisible, false);
    assert.equal(saved.nodeDensity, "compact");
    assert.equal(saved.reduceMotion, true);
    assert.equal(saved.connectionColor, "node");
    assert.equal(saved.notifyGeneration, false);
    assert.deepEqual(loadCanvasPreferences(), migrated);
    assert.deepEqual(resetCanvasPreferences(), DEFAULT_CANVAS_PREFERENCES);
    assert.deepEqual(loadCanvasPreferences(), DEFAULT_CANVAS_PREFERENCES);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
