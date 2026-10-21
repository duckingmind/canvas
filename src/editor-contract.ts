import type { Document } from "./canvas-types";

/** Imperative boundary exposed by the mounted editor to the workspace shell. */
export type CanvasEditorHandle = {
  prepareLeave: () => Promise<boolean>;
  flush: () => Promise<Document>;
  rename: (name: string) => Promise<void>;
  resume: () => void;
};
