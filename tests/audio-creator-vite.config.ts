import { mergeConfig } from "vite";
import base from "../vite.config";

// Concurrent repository edits must not replace a disposable interaction harness.
export default mergeConfig(base, { server: { hmr: false } });
