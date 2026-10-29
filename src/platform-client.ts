import { createAppClient } from "@ducking-mind/proxy-app-sdk";
import manifest from "../manifest.json";
import { readGatewaySession } from "./gateway-session.ts";
import { setCanvasLocalDevelopmentEnabled } from "./network-boundary.ts";

setCanvasLocalDevelopmentEnabled(import.meta.env.DEV);

/**
 * The canvas platform client is an application boundary, not an editor
 * concern.  Keeping the singleton here prevents the workspace shell and the
 * editor from importing one another just to reach SDK services.
 */
// A server-runtime Canvas is always a top-level document in the Portal.
// Preserve only the explicit Electron bridge as a separate desktop runtime.
const electronHost = typeof window !== "undefined" && Boolean(
  (window as Window & { proxyApp?: unknown }).proxyApp,
);

// Published Canvas pages receive a user-bound App Session from the Portal
// launch handoff.  The document never needs to call the Admin runtime to
// discover or proxy a session: all model, media and KV traffic goes directly
// to the Gateway's canonical `/v1` surface.
const gatewaySession = !electronHost ? readGatewaySession(manifest.id) : undefined;

export const client = createAppClient(manifest.id, {
  // Published and local Canvas pages use the same Gateway App Session runtime;
  // Electron keeps its credential-owning preload bridge.
  runtime: import.meta.env.DEV ? "local" : electronHost ? "electron" : "direct",
  localDevelopment: import.meta.env.DEV,
  localAppVersion: manifest.version,
  // `proxy-app dev` injects the Portal paired with the Admin API that signed
  // this local preview grant. Falling back to the production Portal makes
  // that Portal exchange the grant against a different environment.
  ...(import.meta.env.DEV && import.meta.env.VITE_PROXY_PORTAL_URL
    ? { portalURL: import.meta.env.VITE_PROXY_PORTAL_URL }
    : {}),
  ...(gatewaySession ? { appSession: gatewaySession } : {}),
});
