export type CanvasPreferences = {
  panSensitivity: number;
  locateAnimationLimit: number;
  blankAreaAction: "context" | "double";
  wheelDefaultAction: "pan" | "zoom";
  referenceNaming: "name" | "number";
  snapToGrid: boolean;
  alignmentGuides: boolean;
  focusOnDrag: boolean;
  clearFocusAfterSubmit: boolean;
  hoverVideoAutoplay: boolean;
  notifyGeneration: boolean;
  notifyFailure: boolean;
  connectionStyle: "bezier" | "straight" | "orthogonal";
  showConnectionArrows: boolean;
  magneticSnap: boolean;
  connectionPreview: boolean;
  gridVisible: boolean;
  gridSize: number;
  gridStyle: "dots" | "lines";
  showMinimap: boolean;
  showEdges: boolean;
  showNodeStatus: boolean;
  nodeDensity: "comfortable" | "compact";
  autoLayout: "flow" | "grid";
  backgroundPreset: "midnight" | "graphite" | "warm";
  accent: "mono" | "cyan" | "violet";
  connectionColor: "muted" | "accent" | "node";
  reduceMotion: boolean;
};

export const DEFAULT_CANVAS_PREFERENCES: CanvasPreferences = {
  panSensitivity: 1.5,
  locateAnimationLimit: 100,
  blankAreaAction: "double",
  wheelDefaultAction: "pan",
  referenceNaming: "name",
  snapToGrid: false,
  alignmentGuides: false,
  focusOnDrag: true,
  clearFocusAfterSubmit: false,
  hoverVideoAutoplay: true,
  notifyGeneration: true,
  notifyFailure: true,
  connectionStyle: "bezier",
  showConnectionArrows: true,
  magneticSnap: true,
  connectionPreview: true,
  gridVisible: true,
  gridSize: 20,
  gridStyle: "dots",
  showMinimap: false,
  showEdges: true,
  showNodeStatus: true,
  nodeDensity: "comfortable",
  autoLayout: "flow",
  backgroundPreset: "midnight",
  accent: "mono",
  connectionColor: "muted",
  reduceMotion: false,
};

const STORAGE_KEY = "codex.canvas.preferences.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeCanvasPreferences(value: unknown): CanvasPreferences {
  const raw = isRecord(value) ? value : {};
  const bool = (key: keyof CanvasPreferences) => typeof raw[key] === "boolean" ? raw[key] as boolean : DEFAULT_CANVAS_PREFERENCES[key] as boolean;
  return {
    panSensitivity: finiteNumber(raw.panSensitivity, 1.5, 0.5, 2.5),
    locateAnimationLimit: Math.round(finiteNumber(raw.locateAnimationLimit, 100, 0, 300)),
    blankAreaAction: oneOf(raw.blankAreaAction, ["context", "double"], "double"),
    wheelDefaultAction: oneOf(raw.wheelDefaultAction, ["pan", "zoom"], "pan"),
    referenceNaming: oneOf(raw.referenceNaming, ["name", "number"], "name"),
    snapToGrid: bool("snapToGrid"),
    alignmentGuides: bool("alignmentGuides"),
    focusOnDrag: bool("focusOnDrag"),
    clearFocusAfterSubmit: bool("clearFocusAfterSubmit"),
    hoverVideoAutoplay: bool("hoverVideoAutoplay"),
    notifyGeneration: bool("notifyGeneration"),
    notifyFailure: bool("notifyFailure"),
    connectionStyle: oneOf(raw.connectionStyle, ["bezier", "straight", "orthogonal"], "bezier"),
    showConnectionArrows: bool("showConnectionArrows"),
    magneticSnap: bool("magneticSnap"),
    connectionPreview: bool("connectionPreview"),
    // Old versions had two controls for hiding the grid. Preserve the visible result.
    gridVisible: raw.gridStyle === "none" ? false : bool("gridVisible"),
    gridSize: [10, 20, 40].includes(Number(raw.gridSize)) ? Number(raw.gridSize) : 20,
    gridStyle: oneOf(raw.gridStyle, ["dots", "lines"], "dots"),
    showMinimap: bool("showMinimap"),
    showEdges: bool("showEdges"),
    showNodeStatus: bool("showNodeStatus"),
    nodeDensity: oneOf(raw.nodeDensity, ["comfortable", "compact"], "comfortable"),
    autoLayout: oneOf(raw.autoLayout, ["flow", "grid"], "flow"),
    backgroundPreset: oneOf(raw.backgroundPreset, ["midnight", "graphite", "warm"], "midnight"),
    accent: oneOf(raw.accent, ["mono", "cyan", "violet"], "mono"),
    connectionColor: oneOf(raw.connectionColor, ["muted", "accent", "node"], "muted"),
    reduceMotion: bool("reduceMotion"),
  };
}

export function loadCanvasPreferences(): CanvasPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_CANVAS_PREFERENCES };
  try { return normalizeCanvasPreferences(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}")); }
  catch { return { ...DEFAULT_CANVAS_PREFERENCES }; }
}

export function saveCanvasPreferences(value: CanvasPreferences): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCanvasPreferences(value))); } catch { /* private mode */ }
}

export function resetCanvasPreferences(): CanvasPreferences {
  const value = { ...DEFAULT_CANVAS_PREFERENCES };
  saveCanvasPreferences(value);
  return value;
}
